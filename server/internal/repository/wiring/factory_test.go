package wiring

import (
	"testing"

	"github.com/qiffang/mnemos/server/internal/repository/db9"
	"github.com/qiffang/mnemos/server/internal/repository/postgres"
	"github.com/qiffang/mnemos/server/internal/repository/tidb"
)

func TestNewTenantRepoSelectsBackend(t *testing.T) {
	tests := []struct {
		name    string
		backend string
		assert  func(t *testing.T, got any)
	}{
		{
			name:    "db9",
			backend: "db9",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*postgres.TenantRepoImpl); !ok {
					t.Fatalf("NewTenantRepo(%q) returned %T, want *postgres.TenantRepoImpl", "db9", got)
				}
			},
		},
		{
			name:    "postgres",
			backend: "postgres",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*postgres.TenantRepoImpl); !ok {
					t.Fatalf("NewTenantRepo(%q) returned %T, want *postgres.TenantRepoImpl", "postgres", got)
				}
			},
		},
		{
			name:    "default tidb",
			backend: "tidb",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*tidb.TenantRepoImpl); !ok {
					t.Fatalf("NewTenantRepo(%q) returned %T, want *tidb.TenantRepoImpl", "tidb", got)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewTenantRepo(tt.backend, nil)
			if got == nil {
				t.Fatal("NewTenantRepo returned nil")
			}
			tt.assert(t, got)
		})
	}
}

func TestNewUploadTaskRepoSelectsBackend(t *testing.T) {
	tests := []struct {
		name    string
		backend string
		assert  func(t *testing.T, got any)
	}{
		{
			name:    "db9",
			backend: "db9",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*db9.UploadTaskRepoImpl); !ok {
					t.Fatalf("NewUploadTaskRepo(%q) returned %T, want *db9.UploadTaskRepoImpl", "db9", got)
				}
			},
		},
		{
			name:    "postgres",
			backend: "postgres",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*postgres.UploadTaskRepoImpl); !ok {
					t.Fatalf("NewUploadTaskRepo(%q) returned %T, want *postgres.UploadTaskRepoImpl", "postgres", got)
				}
			},
		},
		{
			name:    "default tidb",
			backend: "tidb",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*tidb.UploadTaskRepoImpl); !ok {
					t.Fatalf("NewUploadTaskRepo(%q) returned %T, want *tidb.UploadTaskRepoImpl", "tidb", got)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewUploadTaskRepo(tt.backend, nil)
			if got == nil {
				t.Fatal("NewUploadTaskRepo returned nil")
			}
			tt.assert(t, got)
		})
	}
}

func TestNewMemoryRepoSelectsBackend(t *testing.T) {
	tests := []struct {
		name    string
		backend string
		assert  func(t *testing.T, got any)
	}{
		{
			name:    "db9",
			backend: "db9",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*db9.DB9MemoryRepo); !ok {
					t.Fatalf("NewMemoryRepo(%q) returned %T, want *db9.DB9MemoryRepo", "db9", got)
				}
			},
		},
		{
			name:    "postgres",
			backend: "postgres",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*postgres.MemoryRepo); !ok {
					t.Fatalf("NewMemoryRepo(%q) returned %T, want *postgres.MemoryRepo", "postgres", got)
				}
			},
		},
		{
			name:    "default tidb",
			backend: "tidb",
			assert: func(t *testing.T, got any) {
				t.Helper()
				if _, ok := got.(*tidb.MemoryRepo); !ok {
					t.Fatalf("NewMemoryRepo(%q) returned %T, want *tidb.MemoryRepo", "tidb", got)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewMemoryRepo(tt.backend, nil, "", false)
			if got == nil {
				t.Fatal("NewMemoryRepo returned nil")
			}
			tt.assert(t, got)
		})
	}
}

func TestNewDBRejectsUnsupportedBackend(t *testing.T) {
	if _, err := NewDB("sqlite", "dsn"); err == nil {
		t.Fatal("NewDB returned nil error for unsupported backend")
	}
}
