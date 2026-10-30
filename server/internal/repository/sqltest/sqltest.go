// Package sqltest is a recording database/sql driver for repository tests that
// must not need a real database. It records every statement and transaction
// outcome and replays scripted results, so a test can assert on the SQL and
// arguments a repository sends and on how it reacts to scripted rows and errors.
package sqltest

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
)

// Stmt is one statement the repository sent.
type Stmt struct {
	Query string
	Args  []driver.Value
	InTx  bool
}

// Rule scripts the answer to statements that contain Match.
type Rule struct {
	// Match is a substring of the statement.
	Match string
	// Nth limits the rule to the nth matching statement (1-based). Zero applies it to every match.
	Nth int
	// Rows answers a query. Each row maps a column name to a value; the driver lays
	// the values out in the order of the statement's own SELECT list, so tests do
	// not depend on column order. Names are matched without regard to case.
	Rows []map[string]driver.Value
	// Err is returned instead of running the statement.
	Err error
}

// Recorder collects what happened on the database it backs.
type Recorder struct {
	mu        sync.Mutex
	rules     []Rule
	seen      []int
	stmts     []Stmt
	commits   int
	rollbacks int
}

// New opens a database backed by a Recorder that follows rules.
func New(t *testing.T, rules ...Rule) (*sql.DB, *Recorder) {
	t.Helper()
	rec := &Recorder{rules: rules, seen: make([]int, len(rules))}
	db := sql.OpenDB(connector{rec: rec})
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db, rec
}

// Statements returns the statements sent so far, in order.
func (r *Recorder) Statements() []Stmt {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Stmt(nil), r.stmts...)
}

// Commits is the number of committed transactions.
func (r *Recorder) Commits() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.commits
}

// Rollbacks is the number of rolled back transactions.
func (r *Recorder) Rollbacks() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rollbacks
}

// answer records a statement and returns the scripted result for it.
func (r *Recorder) answer(query string, args []driver.NamedValue, inTx bool) (*Rule, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	values := make([]driver.Value, len(args))
	for i, a := range args {
		values[i] = a.Value
	}
	r.stmts = append(r.stmts, Stmt{Query: query, Args: values, InTx: inTx})
	for i := range r.rules {
		rule := &r.rules[i]
		if !strings.Contains(query, rule.Match) {
			continue
		}
		r.seen[i]++
		if rule.Nth != 0 && rule.Nth != r.seen[i] {
			continue
		}
		if rule.Err != nil {
			return nil, rule.Err
		}
		return rule, nil
	}
	return nil, nil
}

type connector struct{ rec *Recorder }

func (c connector) Connect(context.Context) (driver.Conn, error) { return &conn{rec: c.rec}, nil }
func (connector) Driver() driver.Driver                          { return unusedDriver{} }

type unusedDriver struct{}

func (unusedDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("sqltest: Open is unused with sql.OpenDB")
}

type conn struct {
	rec  *Recorder
	inTx bool
}

func (c *conn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *conn) Close() error                        { return nil }
func (c *conn) Begin() (driver.Tx, error)           { return c.BeginTx(context.Background(), driver.TxOptions{}) }

func (c *conn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.inTx = true
	return &tx{conn: c}, nil
}

func (c *conn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if _, err := c.rec.answer(query, args, c.inTx); err != nil {
		return nil, err
	}
	return driver.RowsAffected(1), nil
}

func (c *conn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	rule, err := c.rec.answer(query, args, c.inTx)
	if err != nil {
		return nil, err
	}
	cols := selectColumns(query)
	result := &rows{cols: cols}
	if rule != nil {
		for _, scripted := range rule.Rows {
			lowered := make(map[string]driver.Value, len(scripted))
			for name, value := range scripted {
				lowered[strings.ToLower(name)] = value
			}
			row := make([]driver.Value, len(cols))
			for i, col := range cols {
				row[i] = lowered[strings.ToLower(col)]
			}
			result.data = append(result.data, row)
		}
	}
	return result, nil
}

type tx struct{ conn *conn }

func (t *tx) Commit() error {
	t.conn.inTx = false
	t.conn.rec.mu.Lock()
	t.conn.rec.commits++
	t.conn.rec.mu.Unlock()
	return nil
}

func (t *tx) Rollback() error {
	t.conn.inTx = false
	t.conn.rec.mu.Lock()
	t.conn.rec.rollbacks++
	t.conn.rec.mu.Unlock()
	return nil
}

type rows struct {
	cols []string
	data [][]driver.Value
	next int
}

func (r *rows) Columns() []string { return r.cols }
func (r *rows) Close() error      { return nil }

func (r *rows) Next(dest []driver.Value) error {
	if r.next >= len(r.data) {
		return io.EOF
	}
	copy(dest, r.data[r.next])
	r.next++
	return nil
}

// selectColumns returns the column names of a simple "SELECT a, b AS c FROM ..."
// statement: aliases and table prefixes are dropped, and only plain column
// lists are supported, which is all the repositories under test use.
func selectColumns(query string) []string {
	upper := strings.ToUpper(query)
	start := strings.Index(upper, "SELECT")
	end := strings.Index(upper, " FROM ")
	if start < 0 || end < start {
		return nil
	}
	var cols []string
	for _, item := range strings.Split(query[start+len("SELECT"):end], ",") {
		name := strings.Fields(item)
		if len(name) == 0 {
			continue
		}
		col := name[0]
		if dot := strings.LastIndex(col, "."); dot >= 0 {
			col = col[dot+1:]
		}
		cols = append(cols, col)
	}
	return cols
}
