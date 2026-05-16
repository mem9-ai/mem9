package tenant

import (
	"errors"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestValidateEmbeddingSchemaCompatibility(t *testing.T) {
	tests := []struct {
		name             string
		autoModelEnabled bool
		columns          []embeddingColumnInfo
		wantErrContains  string
	}{
		{
			name:             "auto model with generated columns",
			autoModelEnabled: true,
			columns: []embeddingColumnInfo{
				{table: "memories", generated: true},
				{table: "sessions", generated: true},
			},
		},
		{
			name:             "no auto model with regular columns",
			autoModelEnabled: false,
			columns: []embeddingColumnInfo{
				{table: "memories", generated: false},
				{table: "sessions", generated: false},
			},
		},
		{
			name:             "missing tables are ignored",
			autoModelEnabled: false,
		},
		{
			name:             "generated column with auto model disabled",
			autoModelEnabled: false,
			columns: []embeddingColumnInfo{
				{table: "memories", generated: true},
			},
			wantErrContains: "memories.embedding is a generated Auto Embed column, but MNEMO_EMBED_AUTO_MODEL is disabled",
		},
		{
			name:             "regular column with auto model enabled",
			autoModelEnabled: true,
			columns: []embeddingColumnInfo{
				{table: "sessions", generated: false},
			},
			wantErrContains: "sessions.embedding is a regular vector column, but MNEMO_EMBED_AUTO_MODEL is enabled",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateEmbeddingSchemaCompatibility(tt.autoModelEnabled, tt.columns)
			if tt.wantErrContains == "" {
				if err != nil {
					t.Fatalf("expected nil error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !errors.Is(err, domain.ErrSchemaIncompatible) {
				t.Fatalf("expected ErrSchemaIncompatible, got %v", err)
			}
			if !strings.Contains(err.Error(), tt.wantErrContains) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tt.wantErrContains)
			}
		})
	}
}

func TestIsGeneratedColumn(t *testing.T) {
	tests := []struct {
		name                 string
		extra                string
		generationExpression string
		want                 bool
	}{
		{name: "stored generated extra", extra: "STORED GENERATED", want: true},
		{name: "virtual generated extra", extra: "VIRTUAL GENERATED", want: true},
		{name: "generation expression", generationExpression: "embed_text(...)", want: true},
		{name: "regular column", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isGeneratedColumn(tt.extra, tt.generationExpression); got != tt.want {
				t.Fatalf("isGeneratedColumn() = %v, want %v", got, tt.want)
			}
		})
	}
}
