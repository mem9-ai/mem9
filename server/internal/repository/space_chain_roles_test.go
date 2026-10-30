package repository_test

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/repository/sqltest"
)

// db9 reuses the Postgres SQL, so it runs through the same cases as the others.
var spaceChainBackends = []string{"tidb", "postgres", "db9"}

func newTestChain() (*domain.SpaceChain, *domain.SpaceChainBinding, *domain.SpaceChainBinding) {
	chain := &domain.SpaceChain{ID: "chain-1", Name: "example"}
	management := &domain.SpaceChainBinding{ID: "b-m", ChainID: "chain-1", ChainAPIKey: "chain_management_key", Role: domain.SpaceChainRoleManagement}
	memory := &domain.SpaceChainBinding{ID: "b-k", ChainID: "chain-1", ChainAPIKey: "chain_memory_key", Role: domain.SpaceChainRoleMemory}
	return chain, management, memory
}

func bindingInserts(stmts []sqltest.Stmt) []sqltest.Stmt {
	var out []sqltest.Stmt
	for _, s := range stmts {
		if strings.Contains(s.Query, "INSERT INTO space_chain_bindings") {
			out = append(out, s)
		}
	}
	return out
}

func hasArg(s sqltest.Stmt, want string) bool {
	for _, a := range s.Args {
		if a == want {
			return true
		}
	}
	return false
}

func TestSpaceChainCreateStoresBothBindingsInOneTransaction(t *testing.T) {
	for _, backend := range spaceChainBackends {
		t.Run(backend, func(t *testing.T) {
			db, rec := sqltest.New(t)
			chain, management, memory := newTestChain()

			if err := repository.NewSpaceChainRepo(backend, db).Create(context.Background(), chain, management, memory); err != nil {
				t.Fatalf("Create: %v", err)
			}

			stmts := rec.Statements()
			for _, s := range stmts {
				if !s.InTx {
					t.Fatalf("statement ran outside the transaction: %s", s.Query)
				}
			}
			inserts := bindingInserts(stmts)
			if len(inserts) != 2 {
				t.Fatalf("binding inserts = %d, want 2", len(inserts))
			}
			for _, want := range []struct{ role, key string }{
				{domain.SpaceChainRoleManagement, "chain_management_key"},
				{domain.SpaceChainRoleMemory, "chain_memory_key"},
			} {
				found := false
				for _, ins := range inserts {
					if hasArg(ins, want.key) {
						found = true
						if !strings.Contains(ins.Query, "role") || !hasArg(ins, want.role) {
							t.Fatalf("insert for %s key does not write role %q: %s %v", want.role, want.role, ins.Query, ins.Args)
						}
					}
				}
				if !found {
					t.Fatalf("no binding insert carries the %s key", want.role)
				}
			}
			if rec.Commits() != 1 || rec.Rollbacks() != 0 {
				t.Fatalf("commits/rollbacks = %d/%d, want 1/0", rec.Commits(), rec.Rollbacks())
			}
		})
	}
}

func TestSpaceChainCreateRollsBackWhenABindingInsertFails(t *testing.T) {
	boom := errors.New("insert failed")
	for _, backend := range spaceChainBackends {
		t.Run(backend, func(t *testing.T) {
			db, rec := sqltest.New(t, sqltest.Rule{Match: "INSERT INTO space_chain_bindings", Nth: 2, Err: boom})
			chain, management, memory := newTestChain()

			err := repository.NewSpaceChainRepo(backend, db).Create(context.Background(), chain, management, memory)

			if !errors.Is(err, boom) {
				t.Fatalf("Create error = %v, want it to wrap the insert error", err)
			}
			if rec.Commits() != 0 || rec.Rollbacks() != 1 {
				t.Fatalf("commits/rollbacks = %d/%d, want 0/1", rec.Commits(), rec.Rollbacks())
			}
		})
	}
}

func TestSpaceChainListBindingsKeepsRole(t *testing.T) {
	created := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	row := func(id, key, role string) map[string]driver.Value {
		return map[string]driver.Value{
			"id": id, "chain_id": "chain-1", "chain_api_key": key, "role": role,
			"disabled": false, "created_at": created,
		}
	}
	for _, backend := range spaceChainBackends {
		t.Run(backend, func(t *testing.T) {
			db, _ := sqltest.New(t, sqltest.Rule{
				Match: "FROM space_chain_bindings",
				Rows:  []map[string]driver.Value{row("b-m", "chain_management_key", "management"), row("b-k", "chain_memory_key", "memory")},
			})

			got, err := repository.NewSpaceChainRepo(backend, db).ListBindings(context.Background(), "chain-1")
			if err != nil {
				t.Fatalf("ListBindings: %v", err)
			}

			if len(got) != 2 || got[0].Role != domain.SpaceChainRoleManagement || got[1].Role != domain.SpaceChainRoleMemory {
				t.Fatalf("bindings = %+v, want roles management then memory", got)
			}
		})
	}
}

func TestSpaceChainCreateBindingStoresRole(t *testing.T) {
	for _, backend := range spaceChainBackends {
		t.Run(backend, func(t *testing.T) {
			db, rec := sqltest.New(t)
			_, _, memory := newTestChain()

			if err := repository.NewSpaceChainRepo(backend, db).CreateBinding(context.Background(), memory); err != nil {
				t.Fatalf("CreateBinding: %v", err)
			}

			inserts := bindingInserts(rec.Statements())
			if len(inserts) != 1 || !strings.Contains(inserts[0].Query, "role") || !hasArg(inserts[0], domain.SpaceChainRoleMemory) {
				t.Fatalf("insert = %+v, want one statement that writes role %q", inserts, domain.SpaceChainRoleMemory)
			}
		})
	}
}

func TestEnsureSpaceChainSchema(t *testing.T) {
	columns := func(names ...string) []map[string]driver.Value {
		rows := make([]map[string]driver.Value, len(names))
		for i, n := range names {
			rows[i] = map[string]driver.Value{"column_name": n}
		}
		return rows
	}
	withoutRole := columns("id", "chain_id", "chain_api_key", "disabled")
	withRole := columns("id", "chain_id", "chain_api_key", "role", "disabled")
	boom := errors.New("ddl failed")

	tests := []struct {
		name     string
		rules    []sqltest.Rule
		tidbOnly bool
		wantErr  error
		wantAdd  bool
	}{
		{name: "adds the column when it is missing", rules: []sqltest.Rule{{Match: "information_schema", Rows: withoutRole}}, wantAdd: true},
		{name: "leaves a table that already has the column alone", rules: []sqltest.Rule{{Match: "information_schema", Rows: withRole}}},
		{name: "skips when the bindings table does not exist", rules: []sqltest.Rule{{Match: "information_schema"}}},
		{
			name:     "tolerates another instance adding the column first",
			rules:    []sqltest.Rule{{Match: "information_schema", Rows: withoutRole}, {Match: "ALTER TABLE", Err: &mysql.MySQLError{Number: 1060, Message: "Duplicate column name 'role'"}}},
			tidbOnly: true,
			wantAdd:  true,
		},
		{name: "reports a failed change", rules: []sqltest.Rule{{Match: "information_schema", Rows: withoutRole}, {Match: "ALTER TABLE", Err: boom}}, wantErr: boom, wantAdd: true},
		{name: "reports a failed catalog lookup", rules: []sqltest.Rule{{Match: "information_schema", Err: boom}}, wantErr: boom},
	}
	for _, backend := range spaceChainBackends {
		for _, tt := range tests {
			if tt.tidbOnly && backend != "tidb" {
				continue
			}
			t.Run(backend+"/"+tt.name, func(t *testing.T) {
				db, rec := sqltest.New(t, tt.rules...)

				err := repository.EnsureSpaceChainSchema(context.Background(), backend, db)

				if tt.wantErr == nil && err != nil {
					t.Fatalf("EnsureSpaceChainSchema: %v", err)
				}
				if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want it to wrap %v", err, tt.wantErr)
				}
				var alters []sqltest.Stmt
				for _, s := range rec.Statements() {
					if strings.Contains(s.Query, "ALTER TABLE") {
						alters = append(alters, s)
					}
				}
				if !tt.wantAdd {
					if len(alters) != 0 {
						t.Fatalf("unexpected change: %s", alters[0].Query)
					}
					return
				}
				if len(alters) != 1 {
					t.Fatalf("changes = %d, want 1", len(alters))
				}
				for _, want := range []string{"space_chain_bindings", "role", "NOT NULL", "DEFAULT 'management'"} {
					if !strings.Contains(alters[0].Query, want) {
						t.Fatalf("change %q does not contain %q", alters[0].Query, want)
					}
				}
			})
		}
	}
}
