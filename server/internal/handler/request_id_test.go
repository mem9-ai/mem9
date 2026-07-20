package handler

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qiffang/mnemos/server/internal/reqid"
)

func TestRouterPreservesCanonicalRequestID(t *testing.T) {
	const requestID = "req_AAAAAAAAAAAAAAAAAAAAAA"
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	pass := func(h http.Handler) http.Handler { return h }
	router := srv.Router(pass, pass, pass, pass)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-Id", requestID)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("X-Request-Id"); got != requestID {
		t.Fatalf("X-Request-Id header = %q, want %q", got, requestID)
	}
}

func TestRouterPanicResponseAndLogShareRequestID(t *testing.T) {
	const requestID = "req_AAAAAAAAAAAAAAAAAAAAAA"
	var logBuffer bytes.Buffer
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(&logBuffer, nil)))
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	srv.logger = logger
	pass := func(h http.Handler) http.Handler { return h }
	panicMiddleware := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("request-id-test")
		})
	}
	router := srv.Router(pass, panicMiddleware, pass, pass)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-Id", requestID)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if got := recorder.Header().Get("X-Request-Id"); got != requestID {
		t.Fatalf("X-Request-Id header = %q, want %q", got, requestID)
	}
	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logBuffer.Bytes()), &entry); err != nil {
		t.Fatalf("decode request log: %v\n%s", err, logBuffer.String())
	}
	if got := entry["request_id"]; got != requestID {
		t.Fatalf("request_id = %v, want %q", got, requestID)
	}
	if got := entry["status"]; got != float64(http.StatusInternalServerError) {
		t.Fatalf("status = %v, want %d", got, http.StatusInternalServerError)
	}
}
