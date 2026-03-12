package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

func TestBuildMemorySchema(t *testing.T) {
	commonChecks := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"id              VARCHAR(36)",
		"INDEX idx_updated",
	}

	t.Run("no auto-model uses plain VECTOR(1536)", func(t *testing.T) {
		schema := buildMemorySchema("", 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1536)") {
			t.Fatal("schema missing VECTOR(1536) for no-auto-model mode")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("auto-model emits EMBED_TEXT generated column with correct dims", func(t *testing.T) {
		schema := buildMemorySchema("tidbcloud_free/amazon/titan-embed-text-v2", 1024)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1024)") {
			t.Fatal("schema missing VECTOR(1024) for auto-model mode")
		}
		if !strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema missing GENERATED ALWAYS AS for auto-model mode")
		}
		if !strings.Contains(schema, "EMBED_TEXT") {
			t.Fatal("schema missing EMBED_TEXT for auto-model mode")
		}
		if !strings.Contains(schema, "tidbcloud_free/amazon/titan-embed-text-v2") {
			t.Fatal("schema missing model name")
		}
	})
}

func TestProvisionRejectsNonTiDBBackend(t *testing.T) {
	t.Parallel()

	pool := tenant.NewPool(tenant.PoolConfig{Backend: "db9"})
	defer pool.Close()

	svc := NewTenantService(nil, nil, pool, nil, "", 0, false)
	_, err := svc.Provision(context.Background())
	if err == nil {
		t.Fatal("expected validation error for non-tidb backend")
	}

	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if !strings.Contains(ve.Message, "requires tidb backend") {
		t.Fatalf("unexpected error message: %q", ve.Message)
	}
}

func TestBuildDB9MemorySchema(t *testing.T) {
	commonChecks := []string{
		"CREATE TABLE IF NOT EXISTS memories",
		"id              VARCHAR(36)",
		"idx_memory_updated",
		"update_updated_at()",
	}

	t.Run("no auto-model uses plain VECTOR(1536)", func(t *testing.T) {
		schema := buildDB9MemorySchema("", 0)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1536)") {
			t.Fatal("schema missing VECTOR(1536) for no-auto-model mode")
		}
		if strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema must not contain GENERATED ALWAYS AS for no-auto-model mode")
		}
	})

	t.Run("auto-model emits EMBED_TEXT generated column with correct dims", func(t *testing.T) {
		schema := buildDB9MemorySchema("amazon.titan-embed-text-v2:0", 1024)
		for _, needle := range commonChecks {
			if !strings.Contains(schema, needle) {
				t.Fatalf("schema missing %q", needle)
			}
		}
		if !strings.Contains(schema, "VECTOR(1024)") {
			t.Fatal("schema missing VECTOR(1024) for auto-model mode")
		}
		if !strings.Contains(schema, "GENERATED ALWAYS AS") {
			t.Fatal("schema missing GENERATED ALWAYS AS for auto-model mode")
		}
		if !strings.Contains(schema, "EMBED_TEXT") {
			t.Fatal("schema missing EMBED_TEXT for auto-model mode")
		}
		if !strings.Contains(schema, "amazon.titan-embed-text-v2:0") {
			t.Fatal("schema missing model name")
		}
		// Verify dimensions arg is included in EMBED_TEXT call
		if !strings.Contains(schema, `'{"dimensions": 1024}'`) {
			t.Fatal("schema missing dimensions arg in EMBED_TEXT call")
		}
	})

	t.Run("auto-model with 512 dims", func(t *testing.T) {
		schema := buildDB9MemorySchema("some-model", 512)
		if !strings.Contains(schema, "VECTOR(512)") {
			t.Fatal("schema missing VECTOR(512)")
		}
		if !strings.Contains(schema, `'{"dimensions": 512}'`) {
			t.Fatal("schema missing dimensions 512 in EMBED_TEXT call")
		}
	})

	t.Run("single-quote in model name is escaped", func(t *testing.T) {
		schema := buildDB9MemorySchema("model'inject", 1024)
		// Should be escaped to double single-quotes
		if !strings.Contains(schema, "model''inject") {
			t.Fatal("single quote in model name not escaped")
		}
	})
}

func TestBuildMemorySchema_DimensionsArg(t *testing.T) {
	t.Run("auto-model includes dimensions in EMBED_TEXT", func(t *testing.T) {
		schema := buildMemorySchema("tidbcloud_free/amazon/titan-embed-text-v2", 1024)
		if !strings.Contains(schema, `'{"dimensions": 1024}'`) {
			t.Fatal("schema missing dimensions arg in EMBED_TEXT call")
		}
	})

	t.Run("single-quote in model name is escaped", func(t *testing.T) {
		schema := buildMemorySchema("model'inject", 1024)
		if !strings.Contains(schema, "model''inject") {
			t.Fatal("single quote in model name not escaped")
		}
	})
}
