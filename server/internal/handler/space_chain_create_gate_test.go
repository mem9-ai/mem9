package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

const (
	createGateSecret = "gate-secret-value"
	createGateBody   = `{"name":"fresh"}`
)

// countingChainRepo counts the chains the service asked the repository to
// create, so a refused request can be shown to have created nothing.
type countingChainRepo struct {
	*chainReadRepo
	creates int
}

func (r *countingChainRepo) Create(ctx context.Context, chain *domain.SpaceChain, binding *domain.SpaceChainBinding) error {
	r.creates++
	return r.chainReadRepo.Create(ctx, chain, binding)
}

type createGateFixture struct {
	router http.Handler
	repo   *countingChainRepo
	logs   *bytes.Buffer
}

// newCreateGateFixture builds the real router over an in-memory repository,
// with the create gate set as given and the server log captured.
func newCreateGateFixture(t *testing.T, required bool, secret string) *createGateFixture {
	t.Helper()
	repo := &countingChainRepo{chainReadRepo: &chainReadRepo{}}
	logs := &bytes.Buffer{}
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.New(slog.NewJSONHandler(logs, nil))).
		WithSpaceChainService(service.NewSpaceChainService(repo), 0.8).
		WithSpaceChainCreateGate(required, secret)
	pass := func(next http.Handler) http.Handler { return next }
	return &createGateFixture{router: srv.Router(pass, pass, pass, pass), repo: repo, logs: logs}
}

// createGatePost sends POST /v1alpha2/space-chains with exactly the given
// extra headers.
func createGatePost(t *testing.T, router http.Handler, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1alpha2/space-chains", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	return rr
}

func TestCreateSpaceChainGateOnRefusesCreateWithoutAuthorization(t *testing.T) {
	f := newCreateGateFixture(t, true, createGateSecret)

	rr := createGatePost(t, f.router, createGateBody, nil)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", rr.Code, rr.Body.String())
	}
	if f.repo.creates != 0 {
		t.Fatalf("repository saw %d create calls, want 0", f.repo.creates)
	}
}

func TestCreateSpaceChainGateOnAcceptsCreateWithTheSecret(t *testing.T) {
	f := newCreateGateFixture(t, true, createGateSecret)

	rr := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer " + createGateSecret})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
	}
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "POST chain", body, "chain", "chain_api_key", "binding_id", "key_prefix", "key_preview")
	if f.repo.creates != 1 {
		t.Fatalf("repository saw %d create calls, want 1", f.repo.creates)
	}
}

func TestCreateSpaceChainGateOnRefusesEveryOtherCredentialTheSameWay(t *testing.T) {
	reference := createGatePost(t, newCreateGateFixture(t, true, createGateSecret).router, createGateBody, nil)
	if reference.Code != http.StatusUnauthorized {
		t.Fatalf("reference status = %d, want 401", reference.Code)
	}

	tests := []struct {
		name    string
		headers map[string]string
	}{
		{"empty Authorization header", map[string]string{"Authorization": ""}},
		{"wrong secret", map[string]string{"Authorization": "Bearer wrong-secret-value"}},
		{"secret in another case", map[string]string{"Authorization": "Bearer GATE-SECRET-VALUE"}},
		{"prefix of the secret", map[string]string{"Authorization": "Bearer gate-secret"}},
		{"secret with one extra character", map[string]string{"Authorization": "Bearer " + createGateSecret + "x"}},
		{"right token under another scheme", map[string]string{"Authorization": "Basic " + createGateSecret}},
		{"another scheme name", map[string]string{"Authorization": "Token " + createGateSecret}},
		{"token without scheme", map[string]string{"Authorization": createGateSecret}},
		{"scheme without token", map[string]string{"Authorization": "Bearer"}},
		{"scheme with only a space", map[string]string{"Authorization": "Bearer "}},
		{"scheme with only a tab", map[string]string{"Authorization": "Bearer\t"}},
		{"no separator after the scheme", map[string]string{"Authorization": "Bearer" + createGateSecret}},
		{"colon after the scheme", map[string]string{"Authorization": "Bearer: " + createGateSecret}},
		{"chain key in X-API-Key only", map[string]string{"X-API-Key": domain.ChainKeyPrefix + "0123456789abcdef0123456789abcdef"}},
		{"Space key in X-API-Key only", map[string]string{"X-API-Key": "0123456789abcdef0123456789abcdef"}},
		{"secret in X-API-Key only", map[string]string{"X-API-Key": createGateSecret}},
		{"wrong secret together with a chain key", map[string]string{
			"Authorization": "Bearer wrong-secret-value",
			"X-API-Key":     domain.ChainKeyPrefix + "0123456789abcdef0123456789abcdef",
		}},
		{"wrong secret together with a Space key", map[string]string{
			"Authorization": "Bearer wrong-secret-value",
			"X-API-Key":     "0123456789abcdef0123456789abcdef",
		}},
		{"malformed Authorization together with a chain key", map[string]string{
			"Authorization": "Bearer",
			"X-API-Key":     domain.ChainKeyPrefix + "0123456789abcdef0123456789abcdef",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newCreateGateFixture(t, true, createGateSecret)

			rr := createGatePost(t, f.router, createGateBody, tt.headers)

			if rr.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", rr.Code, rr.Body.String())
			}
			if got, want := rr.Header().Get("Content-Type"), reference.Header().Get("Content-Type"); got != want {
				t.Fatalf("Content-Type = %q, want %q like the missing-header refusal", got, want)
			}
			if got, want := rr.Body.String(), reference.Body.String(); got != want {
				t.Fatalf("body = %q, want %q like the missing-header refusal", got, want)
			}
			if f.repo.creates != 0 {
				t.Fatalf("repository saw %d create calls, want 0", f.repo.creates)
			}
		})
	}
}

func TestCreateSpaceChainGateOnAcceptsTheSecretInEverySupportedSpelling(t *testing.T) {
	tests := []struct {
		name    string
		headers map[string]string
	}{
		{"canonical", map[string]string{"Authorization": "Bearer " + createGateSecret}},
		{"lower-case scheme", map[string]string{"Authorization": "bearer " + createGateSecret}},
		{"upper-case scheme", map[string]string{"Authorization": "BEARER " + createGateSecret}},
		{"mixed-case scheme", map[string]string{"Authorization": "BeArEr " + createGateSecret}},
		{"several spaces after the scheme", map[string]string{"Authorization": "Bearer    " + createGateSecret}},
		{"a tab after the scheme", map[string]string{"Authorization": "Bearer\t" + createGateSecret}},
		{"whitespace around the whole value", map[string]string{"Authorization": " \t Bearer " + createGateSecret + " \t"}},
		{"together with an X-API-Key", map[string]string{
			"Authorization": "Bearer " + createGateSecret,
			"X-API-Key":     "anything",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newCreateGateFixture(t, true, createGateSecret)

			rr := createGatePost(t, f.router, createGateBody, tt.headers)

			if rr.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
			}
			if f.repo.creates != 1 {
				t.Fatalf("repository saw %d create calls, want 1", f.repo.creates)
			}
		})
	}
}

func TestCreateSpaceChainGateOffIgnoresTheAuthorizationHeader(t *testing.T) {
	tests := []struct {
		name    string
		secret  string
		headers map[string]string
	}{
		{"no header and no secret", "", nil},
		{"no header with a secret set", createGateSecret, nil},
		{"wrong bearer token", createGateSecret, map[string]string{"Authorization": "Bearer wrong-secret-value"}},
		{"another scheme", createGateSecret, map[string]string{"Authorization": "Basic wrong-secret-value"}},
		{"malformed value", createGateSecret, map[string]string{"Authorization": "Bearer"}},
		{"chain key in X-API-Key only", createGateSecret, map[string]string{"X-API-Key": domain.ChainKeyPrefix + "0123456789abcdef0123456789abcdef"}},
		{"Space key in X-API-Key only", createGateSecret, map[string]string{"X-API-Key": "0123456789abcdef0123456789abcdef"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newCreateGateFixture(t, false, tt.secret)

			rr := createGatePost(t, f.router, createGateBody, tt.headers)

			if rr.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201: %s", rr.Code, rr.Body.String())
			}
			assertJSONKeys(t, "POST chain", decodeJSONObject(t, rr.Body.Bytes()),
				"chain", "chain_api_key", "binding_id", "key_prefix", "key_preview")
			if f.repo.creates != 1 {
				t.Fatalf("repository saw %d create calls, want 1", f.repo.creates)
			}
		})
	}
}

func TestCreateSpaceChainGateChecksTheCredentialBeforeReadingTheBody(t *testing.T) {
	const malformedBody = `{"name":`
	f := newCreateGateFixture(t, true, createGateSecret)

	noCredential := createGatePost(t, f.router, malformedBody, nil)
	wrongCredential := createGatePost(t, f.router, malformedBody, map[string]string{"Authorization": "Bearer wrong-secret-value"})
	rightCredential := createGatePost(t, f.router, malformedBody, map[string]string{"Authorization": "Bearer " + createGateSecret})

	if noCredential.Code != http.StatusUnauthorized {
		t.Fatalf("no credential: status = %d, want 401 (not 400): %s", noCredential.Code, noCredential.Body.String())
	}
	if wrongCredential.Code != http.StatusUnauthorized {
		t.Fatalf("wrong credential: status = %d, want 401 (not 400): %s", wrongCredential.Code, wrongCredential.Body.String())
	}
	if rightCredential.Code != http.StatusBadRequest {
		t.Fatalf("right credential: status = %d, want 400 for the malformed body: %s", rightCredential.Code, rightCredential.Body.String())
	}
	if f.repo.creates != 0 {
		t.Fatalf("repository saw %d create calls, want 0", f.repo.creates)
	}
}

func TestCreateSpaceChainGateChecksTheCredentialBeforeServiceAvailability(t *testing.T) {
	// A server without the Space Chain service answers 503 to a caller who
	// passed the gate, but must not tell an unauthenticated caller that.
	srv := NewServer(nil, nil, "", nil, nil, "", false, service.ModeSmart, "", slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))).
		WithSpaceChainCreateGate(true, createGateSecret)
	pass := func(next http.Handler) http.Handler { return next }
	router := srv.Router(pass, pass, pass, pass)

	missing := createGatePost(t, router, createGateBody, nil)
	wrong := createGatePost(t, router, createGateBody, map[string]string{"Authorization": "Bearer wrong-secret-value"})
	right := createGatePost(t, router, createGateBody, map[string]string{"Authorization": "Bearer " + createGateSecret})

	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing credential: status = %d, want 401", missing.Code)
	}
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong credential: status = %d, want 401", wrong.Code)
	}
	if right.Code != http.StatusServiceUnavailable {
		t.Fatalf("right credential: status = %d, want 503", right.Code)
	}
}

func TestCreateSpaceChainGateOnWithoutSecretRefusesEveryCreate(t *testing.T) {
	// Configuration refuses to start in this state. If the server is built
	// like this anyway, the gate must stay shut rather than open.
	tests := []struct {
		name    string
		headers map[string]string
	}{
		{"no header", nil},
		{"scheme without token", map[string]string{"Authorization": "Bearer"}},
		{"scheme with only a space", map[string]string{"Authorization": "Bearer "}},
		{"some token", map[string]string{"Authorization": "Bearer " + createGateSecret}},
		{"chain key in X-API-Key only", map[string]string{"X-API-Key": domain.ChainKeyPrefix + "0123456789abcdef0123456789abcdef"}},
	}
	for _, secret := range []string{"", " \t\r\n "} {
		for _, tt := range tests {
			t.Run(fmt.Sprintf("secret %q, %s", secret, tt.name), func(t *testing.T) {
				f := newCreateGateFixture(t, true, secret)

				rr := createGatePost(t, f.router, createGateBody, tt.headers)

				if rr.Code != http.StatusUnauthorized {
					t.Fatalf("status = %d, want 401: %s", rr.Code, rr.Body.String())
				}
				if f.repo.creates != 0 {
					t.Fatalf("repository saw %d create calls, want 0", f.repo.creates)
				}
			})
		}
	}
}

func TestCreateSpaceChainGateOnLeavesEveryOtherRouteAlone(t *testing.T) {
	f := newCreateGateFixture(t, true, createGateSecret)
	created := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer " + createGateSecret})
	if created.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, want 201: %s", created.Code, created.Body.String())
	}
	body := decodeJSONObject(t, created.Body.Bytes())
	chainKey, _ := body["chain_api_key"].(string)
	chain, _ := body["chain"].(map[string]any)
	chainID, _ := chain["id"].(string)
	if chainKey == "" || chainID == "" {
		t.Fatalf("create response lacks the chain key or id: %v", body)
	}

	health := chainReadDo(t, f.router, http.MethodGet, "/healthz", "", nil)
	if health.Code != http.StatusOK {
		t.Fatalf("GET /healthz: status = %d, want 200", health.Code)
	}
	byKey := chainReadDo(t, f.router, http.MethodGet, "/v1alpha2/space-chains/by-key", chainKey, nil)
	if byKey.Code != http.StatusOK {
		t.Fatalf("GET by-key with a chain key: status = %d, want 200: %s", byKey.Code, byKey.Body.String())
	}
	binding := chainReadDo(t, f.router, http.MethodPost, "/v1alpha2/space-chains/"+chainID+"/bindings", chainKey,
		map[string]any{"created_by_user_id": "user-new"})
	if binding.Code != http.StatusCreated {
		t.Fatalf("POST binding with a chain key: status = %d, want 201: %s", binding.Code, binding.Body.String())
	}
}

func TestCreateSpaceChainGateNeverEchoesOrLogsACredential(t *testing.T) {
	const wrong = "wrong-secret-value"
	f := newCreateGateFixture(t, true, createGateSecret)

	refused := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer " + wrong})
	accepted := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer " + createGateSecret})
	if refused.Code != http.StatusUnauthorized || accepted.Code != http.StatusCreated {
		t.Fatalf("statuses = %d and %d, want 401 and 201", refused.Code, accepted.Code)
	}

	texts := map[string]string{
		"401 body": refused.Body.String(),
		"201 body": accepted.Body.String(),
		"log":      f.logs.String(),
	}
	for label, text := range texts {
		for _, credential := range []string{createGateSecret, wrong} {
			if strings.Contains(text, credential) {
				t.Fatalf("%s contains a credential", label)
			}
		}
	}
	if strings.Contains(f.logs.String(), "Authorization") {
		t.Fatal("log contains Authorization header text")
	}
}

func TestCreateSpaceChainGateRefusalIsLoggedOnceWithRouteAndStatus(t *testing.T) {
	f := newCreateGateFixture(t, true, createGateSecret)

	rr := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer wrong-secret-value"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	lines := strings.Split(strings.TrimSpace(f.logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("refused request wrote %d log lines, want 1", len(lines))
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("decode log line: %v", err)
	}
	if entry["msg"] != "handle request done" || entry["method"] != "POST" ||
		entry["path"] != "/v1alpha2/space-chains" || entry["status"] != float64(http.StatusUnauthorized) {
		t.Fatalf("log line = msg %v, method %v, path %v, status %v; want the request line for the create route with status 401",
			entry["msg"], entry["method"], entry["path"], entry["status"])
	}
}

func TestCreateSpaceChainGateIgnoresWhitespaceAroundTheSecretItIsGiven(t *testing.T) {
	// Configuration loading trims the secret; a server built directly must
	// treat the same text the same way.
	f := newCreateGateFixture(t, true, " \t"+createGateSecret+"\r\n")

	accepted := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer " + createGateSecret})
	refused := createGatePost(t, f.router, createGateBody, map[string]string{"Authorization": "Bearer wrong-secret-value"})

	if accepted.Code != http.StatusCreated {
		t.Fatalf("right secret: status = %d, want 201: %s", accepted.Code, accepted.Body.String())
	}
	if refused.Code != http.StatusUnauthorized {
		t.Fatalf("wrong secret: status = %d, want 401: %s", refused.Code, refused.Body.String())
	}
	if f.repo.creates != 1 {
		t.Fatalf("repository saw %d create calls, want 1", f.repo.creates)
	}
}

func TestCreateSpaceChainGateRefusalIsTheStandardErrorAnswer(t *testing.T) {
	f := newCreateGateFixture(t, true, createGateSecret)

	rr := createGatePost(t, f.router, createGateBody, nil)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	body := decodeJSONObject(t, rr.Body.Bytes())
	assertJSONKeys(t, "401 body", body, "error")
	if message, _ := body["error"].(string); message == "" {
		t.Fatalf("401 body has no error message: %v", body)
	}
	if got := rr.Header().Get("WWW-Authenticate"); got != "" {
		t.Fatalf("WWW-Authenticate = %q, want none (the other 401s of this API send none)", got)
	}
}
