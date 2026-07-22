package tidb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSpaceChainCreateBindingMapsDuplicateKey(t *testing.T) {
	db := sql.OpenDB(spaceChainExecErrorConnector{
		err: &mysql.MySQLError{Number: 1062, Message: "Duplicate entry for key idx_space_chain_bindings_key"},
	})
	t.Cleanup(func() { _ = db.Close() })

	repo := NewSpaceChainRepo(db)
	err := repo.CreateBinding(context.Background(), &domain.SpaceChainBinding{
		ID:          "binding-2",
		ChainID:     "chain-1",
		ChainAPIKey: "chain_existing",
	})
	if !errors.Is(err, domain.ErrDuplicateKey) {
		t.Fatalf("CreateBinding error = %v, want domain.ErrDuplicateKey", err)
	}
}

type spaceChainExecErrorConnector struct {
	err error
}

func (c spaceChainExecErrorConnector) Connect(context.Context) (driver.Conn, error) {
	return spaceChainExecErrorConn{err: c.err}, nil
}

func (spaceChainExecErrorConnector) Driver() driver.Driver {
	return spaceChainExecErrorDriver{}
}

type spaceChainExecErrorDriver struct{}

func (spaceChainExecErrorDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("Open is unused with sql.OpenDB")
}

type spaceChainExecErrorConn struct {
	err error
}

func (c spaceChainExecErrorConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c spaceChainExecErrorConn) Close() error                        { return nil }
func (c spaceChainExecErrorConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (c spaceChainExecErrorConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	return nil, c.err
}
