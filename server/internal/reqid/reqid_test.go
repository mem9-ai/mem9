package reqid

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chimw "github.com/go-chi/chi/v5/middleware"
)

func TestMiddlewareResolvesCanonicalID(t *testing.T) {
	const (
		albRequestID      = "1-67891233-12456789abcdef0123456789"
		internalRequestID = "req_AAAAAAAAAAAAAAAAAAAAAA"
	)
	tests := []struct {
		name          string
		albTraceID    string
		inboundID     string
		want          string
		wantGenerated bool
	}{
		{
			name:       "ALB Self takes precedence",
			albTraceID: "Root=1-67891233-abcdef012345678912345678;Self=" + albRequestID,
			inboundID:  internalRequestID,
			want:       albRequestID,
		},
		{
			name:       "ALB Root is used when Self is absent",
			albTraceID: "Root=" + albRequestID,
			inboundID:  internalRequestID,
			want:       albRequestID,
		},
		{
			name:      "internal generated ID is preserved",
			inboundID: internalRequestID,
			want:      internalRequestID,
		},
		{
			name:      "internal ALB ID is preserved",
			inboundID: albRequestID,
			want:      albRequestID,
		},
		{
			name:          "invalid internal ID generates a replacement",
			inboundID:     "req_12345678",
			wantGenerated: true,
		},
		{
			name:          "oversized internal ID generates a replacement",
			inboundID:     "req_" + strings.Repeat("a", maxALBTraceSize),
			wantGenerated: true,
		},
		{
			name:          "invalid ALB Self generates a replacement",
			albTraceID:    "Root=1-67891233-abcdef012345678912345678;Self=invalid",
			inboundID:     internalRequestID,
			wantGenerated: true,
		},
		{
			name:          "duplicate ALB Self generates a replacement",
			albTraceID:    "Self=;Self=" + albRequestID,
			wantGenerated: true,
		},
		{
			name:          "oversized ALB trace generates a replacement",
			albTraceID:    strings.Repeat("a", maxALBTraceSize+1),
			wantGenerated: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var contextRequestID string
			var chiRequestID string
			var forwardedRequestID string
			handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				contextRequestID = FromContext(r.Context())
				chiRequestID = chimw.GetReqID(r.Context())
				forwardedRequestID = r.Header.Get(Header)
				w.WriteHeader(http.StatusNoContent)
			}))

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
			request.Header.Set(albTraceHeader, tt.albTraceID)
			request.Header.Set(Header, tt.inboundID)

			handler.ServeHTTP(recorder, request)

			got := recorder.Header().Get(Header)
			if got == "" {
				t.Fatalf("%s header is empty", Header)
			}
			if tt.wantGenerated && !validGenerated(got) {
				t.Fatalf("%s header = %q, want generated request id", Header, got)
			}
			if !tt.wantGenerated && got != tt.want {
				t.Fatalf("%s header = %q, want %q", Header, got, tt.want)
			}
			if contextRequestID != got {
				t.Fatalf("context request id = %q, want %q", contextRequestID, got)
			}
			if chiRequestID != got {
				t.Fatalf("chi request id = %q, want %q", chiRequestID, got)
			}
			if forwardedRequestID != got {
				t.Fatalf("forwarded request id = %q, want %q", forwardedRequestID, got)
			}
		})
	}
}

func TestMiddlewareFailsClosedWhenRandomSourceFails(t *testing.T) {
	originalReadRandom := readRandom
	t.Cleanup(func() {
		readRandom = originalReadRandom
	})
	readRandom = func([]byte) (int, error) {
		return 0, errors.New("random unavailable")
	}

	handlerCalled := false
	handler := Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerCalled = true
	}))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	handler.ServeHTTP(recorder, request)

	if handlerCalled {
		t.Fatal("next handler was called")
	}
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	if got := recorder.Header().Get(Header); got != "" {
		t.Fatalf("%s header = %q, want empty on random failure", Header, got)
	}
}
