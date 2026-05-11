package tenant

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestZeroClient_CreateInstance_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/instances" {
			t.Fatalf("path = %s, want /instances", r.URL.Path)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Fatalf("Content-Type header = %q, want %q", got, "application/json")
		}

		var req zeroCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Tag != "mnemos-test" {
			t.Fatalf("tag = %q, want %q", req.Tag, "mnemos-test")
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "instance": {
    "id": "cluster-test",
    "expiresAt": "2026-04-07T12:00:00Z",
    "connection": {
      "host": "test.tidbcloud.com",
      "port": 4000,
      "username": "testuser",
      "password": "testpass"
    },
    "claimInfo": {
      "claimUrl": "https://tidbcloud.com/claim/test"
    }
  }
}`))
	}))
	defer server.Close()

	client := NewZeroClient(server.URL)
	instance, err := client.CreateInstance(context.Background(), "mnemos-test")
	if err != nil {
		t.Fatalf("CreateInstance error: %v", err)
	}
	if instance == nil {
		t.Fatal("expected instance, got nil")
	}
	if instance.ID != "cluster-test" {
		t.Fatalf("ID = %q, want %q", instance.ID, "cluster-test")
	}
	if instance.Host != "test.tidbcloud.com" {
		t.Fatalf("Host = %q, want %q", instance.Host, "test.tidbcloud.com")
	}
	if instance.Port != 4000 {
		t.Fatalf("Port = %d, want %d", instance.Port, 4000)
	}
	if instance.Username != "testuser" {
		t.Fatalf("Username = %q, want %q", instance.Username, "testuser")
	}
	if instance.Password != "testpass" {
		t.Fatalf("Password = %q, want %q", instance.Password, "testpass")
	}
	if instance.ClaimURL != "https://tidbcloud.com/claim/test" {
		t.Fatalf("ClaimURL = %q, want %q", instance.ClaimURL, "https://tidbcloud.com/claim/test")
	}
	if instance.ClaimExpiresAt == nil {
		t.Fatal("ClaimExpiresAt = nil, want non-nil")
	}
	wantExpiry := "2026-04-07T12:00:00Z"
	if got := instance.ClaimExpiresAt.Format(time.RFC3339); got != wantExpiry {
		t.Fatalf("ClaimExpiresAt = %q, want %q", got, wantExpiry)
	}
}

func TestZeroClient_CreateInstance_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer server.Close()

	client := NewZeroClient(server.URL)
	_, err := client.CreateInstance(context.Background(), "mnemos-test")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "status 500") || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestZeroClient_CreateInstance_RateLimitRetry(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"message":"Rate limit exceeded. The limit is 2 requests per second."}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"instance":{"id":"cluster-test","connection":{"host":"test.tidbcloud.com","port":4000,"username":"root","password":"secret"},"claimInfo":{"claimUrl":"https://tidbcloud.com/claim/test"}}}`))
	}))
	defer server.Close()

	client := NewZeroClient(server.URL)
	client.limiter = nil
	client.maxAttempts = 2
	client.retryBase = time.Millisecond

	instance, err := client.CreateInstance(context.Background(), "mnemos-test")
	if err != nil {
		t.Fatalf("CreateInstance error: %v", err)
	}
	if instance.ID != "cluster-test" {
		t.Fatalf("ID = %q, want cluster-test", instance.ID)
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
}

func TestZeroClient_CreateInstance_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not-json"))
	}))
	defer server.Close()

	client := NewZeroClient(server.URL)
	_, err := client.CreateInstance(context.Background(), "mnemos-test")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestZeroClient_CreateInstance_ContextCancel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"instance":{"id":"x","connection":{"host":"h","port":1,"username":"u","password":"p"},"claimInfo":{"claimUrl":"c"}}}`))
	}))
	defer server.Close()

	client := NewZeroClient(server.URL)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := client.CreateInstance(ctx, "mnemos-test")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context canceled error, got %v", err)
	}
}
