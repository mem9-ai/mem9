package tenant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const testDigestChallenge = `Digest realm="tidbcloud", nonce="abc123", qop="auth"`

func setTiDBCloudCreds(t *testing.T) {
	t.Helper()
	t.Setenv("MNEMO_TIDBCLOUD_API_KEY", "test-key")
	t.Setenv("MNEMO_TIDBCLOUD_API_SECRET", "test-secret")
}

type spendLimitMockConfig struct {
	expectedMethod  string
	responseStatus  int
	responseBody    string
	expectedMonthly *int
}

func newSpendLimitDigestServer(t *testing.T, cfg spendLimitMockConfig) *httptest.Server {
	t.Helper()

	var requestCount int32
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Helper()

		count := atomic.AddInt32(&requestCount, 1)
		if r.Method != cfg.expectedMethod {
			t.Fatalf("request %d method = %s, want %s", count, r.Method, cfg.expectedMethod)
		}
		if r.URL.Path != "/v1beta1/clusters/cluster-123" {
			t.Fatalf("request %d path = %s, want %s", count, r.URL.Path, "/v1beta1/clusters/cluster-123")
		}

		if count == 1 {
			if got := r.Header.Get("Authorization"); got != "" {
				t.Fatalf("first request Authorization = %q, want empty", got)
			}
			w.Header().Set("WWW-Authenticate", testDigestChallenge)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		auth := r.Header.Get("Authorization")
		if auth == "" {
			t.Fatal("second request Authorization header is empty")
		}
		if !strings.HasPrefix(auth, "Digest ") {
			t.Fatalf("second request Authorization = %q, want Digest auth", auth)
		}

		if cfg.expectedMonthly != nil {
			var req struct {
				UpdateMask string `json:"updateMask"`
				Cluster    struct {
					SpendingLimit struct {
						Monthly int `json:"monthly"`
					} `json:"spendingLimit"`
				} `json:"cluster"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("decode request body: %v", err)
			}
			if req.UpdateMask != "spendingLimit" {
				t.Fatalf("updateMask = %q, want %q", req.UpdateMask, "spendingLimit")
			}
			if req.Cluster.SpendingLimit.Monthly != *cfg.expectedMonthly {
				t.Fatalf("monthly = %d, want %d", req.Cluster.SpendingLimit.Monthly, *cfg.expectedMonthly)
			}
		} else {
			_, _ = io.ReadAll(r.Body)
		}

		w.WriteHeader(cfg.responseStatus)
		if cfg.responseBody != "" {
			_, _ = w.Write([]byte(cfg.responseBody))
		}
	}))
}

func TestTiDBCloudProvisioner_SpendLimit_GetSpendLimit_Success(t *testing.T) {
	setTiDBCloudCreds(t)

	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod: http.MethodGet,
		responseStatus: http.StatusOK,
		responseBody:   `{"cluster":{"spendingLimit":{"monthly":500}}}`,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	got, err := p.GetSpendLimit(context.Background(), "cluster-123")
	if err != nil {
		t.Fatalf("GetSpendLimit error: %v", err)
	}
	if got != 500 {
		t.Fatalf("GetSpendLimit = %d, want %d", got, 500)
	}
}

func TestTiDBCloudProvisioner_SpendLimit_GetSpendLimit_InvalidJSON(t *testing.T) {
	setTiDBCloudCreds(t)

	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod: http.MethodGet,
		responseStatus: http.StatusOK,
		responseBody:   `{"cluster":{"spendingLimit":{"monthly":500}}`,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	_, err := p.GetSpendLimit(context.Background(), "cluster-123")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTiDBCloudProvisioner_SpendLimit_GetSpendLimit_APIError(t *testing.T) {
	setTiDBCloudCreds(t)

	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod: http.MethodGet,
		responseStatus: http.StatusInternalServerError,
		responseBody:   `{"error":"boom"}`,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	_, err := p.GetSpendLimit(context.Background(), "cluster-123")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "status 500") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTiDBCloudProvisioner_SpendLimit_IncreaseSpendLimit_Success(t *testing.T) {
	setTiDBCloudCreds(t)

	wantMonthly := 1000
	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod:  http.MethodPatch,
		responseStatus:  http.StatusOK,
		expectedMonthly: &wantMonthly,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	if err := p.IncreaseSpendLimit(context.Background(), "cluster-123", wantMonthly); err != nil {
		t.Fatalf("IncreaseSpendLimit error: %v", err)
	}
}

func TestTiDBCloudProvisioner_SpendLimit_IncreaseSpendLimit_403(t *testing.T) {
	setTiDBCloudCreds(t)

	wantMonthly := 1000
	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod:  http.MethodPatch,
		responseStatus:  http.StatusForbidden,
		responseBody:    `{"error":"forbidden"}`,
		expectedMonthly: &wantMonthly,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	err := p.IncreaseSpendLimit(context.Background(), "cluster-123", wantMonthly)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "403") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTiDBCloudProvisioner_SpendLimit_IncreaseSpendLimit_404(t *testing.T) {
	setTiDBCloudCreds(t)

	wantMonthly := 1000
	server := newSpendLimitDigestServer(t, spendLimitMockConfig{
		expectedMethod:  http.MethodPatch,
		responseStatus:  http.StatusNotFound,
		responseBody:    `{"error":"not found"}`,
		expectedMonthly: &wantMonthly,
	})
	defer server.Close()

	p := NewTiDBCloudProvisioner(server.URL, "test-pool")
	err := p.IncreaseSpendLimit(context.Background(), "cluster-123", wantMonthly)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Fatalf("unexpected error: %v", err)
	}
}
