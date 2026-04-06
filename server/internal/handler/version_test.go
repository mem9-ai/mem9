package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVersionz_ReturnsStartedAt(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	router := srv.Router(func(h http.Handler) http.Handler { return h }, func(h http.Handler) http.Handler { return h }, func(h http.Handler) http.Handler { return h })

	req := httptest.NewRequest(http.MethodGet, "/versionz", nil)
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["started_at"] == "" {
		t.Fatal("expected started_at in versionz response")
	}
	if body["go_version"] == "" {
		t.Fatal("expected go_version in versionz response")
	}
}
