package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadStatesAndSkipTenant(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, successFileName), []byte("tenant-ok\t2026-06-04T00:00:00Z\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, failedFileName), []byte("tenant-failed\t2026-06-04T00:00:00Z\tboom\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	states, err := loadStates(dir)
	if err != nil {
		t.Fatal(err)
	}

	if skip, reason := shouldSkipTenant("tenant-ok", states, false); !skip || reason != "already-successful" {
		t.Fatalf("successful tenant skip = %t %q, want true already-successful", skip, reason)
	}
	if skip, reason := shouldSkipTenant("tenant-failed", states, false); !skip || reason != "already-failed" {
		t.Fatalf("failed tenant skip = %t %q, want true already-failed", skip, reason)
	}
	if skip, reason := shouldSkipTenant("tenant-failed", states, true); skip || reason != "" {
		t.Fatalf("retry failed tenant skip = %t %q, want false empty", skip, reason)
	}
	if skip, reason := shouldSkipTenant("tenant-new", states, false); skip || reason != "" {
		t.Fatalf("new tenant skip = %t %q, want false empty", skip, reason)
	}
}

func TestLoadIDSetIgnoresEmptyCommentsAndHeader(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, successFileName)
	if err := os.WriteFile(path, []byte("\n# comment\ntenant_id\tfinished_at\ntenant-1\t2026-06-04T00:00:00Z\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	ids, err := loadIDSet(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ids["tenant-1"]; !ok {
		t.Fatal("tenant-1 not loaded")
	}
	if _, ok := ids["tenant_id"]; ok {
		t.Fatal("header should not be loaded as tenant id")
	}
}

func TestSplitBatches(t *testing.T) {
	records := []tenantRecord{{id: "1"}, {id: "2"}, {id: "3"}, {id: "4"}, {id: "5"}}

	batches := splitBatches(records, 2)

	if len(batches) != 3 {
		t.Fatalf("len(batches) = %d, want 3", len(batches))
	}
	if len(batches[0]) != 2 || len(batches[1]) != 2 || len(batches[2]) != 1 {
		t.Fatalf("batch sizes = %d,%d,%d; want 2,2,1", len(batches[0]), len(batches[1]), len(batches[2]))
	}
	if batches[2][0].id != "5" {
		t.Fatalf("last record id = %q, want 5", batches[2][0].id)
	}
}

func TestTenantQueryScopesActiveNonDeletedTenants(t *testing.T) {
	query := tenantQuery()

	for _, want := range []string{
		"FROM tenants",
		"status = 'active'",
		"deleted_at IS NULL",
		"ORDER BY created_at ASC, id ASC",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("tenantQuery() missing %q in:\n%s", want, query)
		}
	}
}

func TestSanitizeTSV(t *testing.T) {
	got := sanitizeTSV("  a\tb\nc\rd  ")
	if got != "a b c d" {
		t.Fatalf("sanitizeTSV() = %q, want %q", got, "a b c d")
	}
}

func TestWriteStateLine(t *testing.T) {
	var buf strings.Builder
	at := time.Date(2026, 6, 4, 1, 2, 3, 0, time.FixedZone("CST", 8*60*60))

	if err := writeStateLine(&buf, "tenant-1", at, "line\nbreak"); err != nil {
		t.Fatal(err)
	}

	want := "tenant-1\t2026-06-03T17:02:03Z\tline break\n"
	if buf.String() != want {
		t.Fatalf("state line = %q, want %q", buf.String(), want)
	}
}
