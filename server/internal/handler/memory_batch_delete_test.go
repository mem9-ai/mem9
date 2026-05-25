package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
)

func TestBatchDeleteMemories_Success_ReturnsDeletedCount(t *testing.T) {
	memRepo := &testMemoryRepo{bulkSoftDeleteResult: 2}
	srv := newTestServer(memRepo, &testSessionRepo{})

	body := map[string]any{"ids": []string{"a", "a", "", "b", "c", "b"}}
	req := makeRequest(t, http.MethodPost, "/memories/batch-delete", body)
	rr := httptest.NewRecorder()

	srv.batchDeleteMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Deleted int64 `json:"deleted"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Deleted != 2 {
		t.Fatalf("deleted = %d, want 2", resp.Deleted)
	}

	if len(memRepo.bulkSoftDeleteCalls) != 1 {
		t.Fatalf("expected repo BulkSoftDelete called once, got %d", len(memRepo.bulkSoftDeleteCalls))
	}
	got := append([]string(nil), memRepo.bulkSoftDeleteCalls[0]...)
	sort.Strings(got)
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("repo ids len = %d, want %d (ids=%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("repo ids = %v, want %v", got, want)
		}
	}
}

func TestBatchDeleteMemories_IncludesSessionRows(t *testing.T) {
	memRepo := &testMemoryRepo{bulkSoftDeleteResult: 2}
	sessionRepo := &testSessionRepo{bulkSoftDeleteResult: 1}
	srv := newTestServer(memRepo, sessionRepo)

	body := map[string]any{"ids": []string{"mem-1", "sess-row-1", "mem-2"}}
	req := makeRequest(t, http.MethodPost, "/memories/batch-delete", body)
	rr := httptest.NewRecorder()

	srv.batchDeleteMemories(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Deleted int64 `json:"deleted"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Deleted != 3 {
		t.Fatalf("deleted = %d, want 3", resp.Deleted)
	}
	if len(sessionRepo.bulkSoftDeleteCalls) != 1 {
		t.Fatalf("expected session BulkSoftDelete called once, got %d", len(sessionRepo.bulkSoftDeleteCalls))
	}
	got := append([]string(nil), sessionRepo.bulkSoftDeleteCalls[0]...)
	sort.Strings(got)
	want := []string{"mem-1", "mem-2", "sess-row-1"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("session repo ids = %v, want %v", got, want)
		}
	}
}

func TestBatchDeleteMemories_EmptyIDs_Returns400(t *testing.T) {
	memRepo := &testMemoryRepo{}
	srv := newTestServer(memRepo, &testSessionRepo{})

	body := map[string]any{"ids": []string{}}
	req := makeRequest(t, http.MethodPost, "/memories/batch-delete", body)
	rr := httptest.NewRecorder()

	srv.batchDeleteMemories(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(memRepo.bulkSoftDeleteCalls) != 0 {
		t.Fatalf("repo must not be called, calls=%d", len(memRepo.bulkSoftDeleteCalls))
	}
}

func TestBatchDeleteMemories_AllEmptyStrings_Returns400(t *testing.T) {
	memRepo := &testMemoryRepo{}
	srv := newTestServer(memRepo, &testSessionRepo{})

	body := map[string]any{"ids": []string{"", "", ""}}
	req := makeRequest(t, http.MethodPost, "/memories/batch-delete", body)
	rr := httptest.NewRecorder()

	srv.batchDeleteMemories(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(memRepo.bulkSoftDeleteCalls) != 0 {
		t.Fatalf("repo must not be called, calls=%d", len(memRepo.bulkSoftDeleteCalls))
	}
}
