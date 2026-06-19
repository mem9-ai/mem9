package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
)

// Raw-session edit overlay: the edit endpoints write only the overlay and
// never the sessions/memories tables; Session Search renders the edited
// content for matched session rows while memory/fact recall is untouched.

func sessionRow(id, content string) *domain.Memory {
	meta, _ := json.Marshal(map[string]any{"role": "user", "seq": 3, "content_type": "text"})
	return &domain.Memory{
		ID: id, Content: content, MemoryType: domain.TypeSession,
		SessionID: "sess-1", State: domain.StateActive, Metadata: meta,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
}

func TestEditSessionMessage_UpsertVersionAndEffectiveView(t *testing.T) {
	sessionRepo := &testSessionRepo{getResult: sessionRow("turn-1", "original text")}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)

	// First edit -> version 1, edited content echoed back.
	req := withURLParam(makeRequest(t, http.MethodPut, "/session-messages/turn-1",
		editSessionMessageRequest{Content: "corrected text"}), "id", "turn-1")
	rr := httptest.NewRecorder()
	srv.editSessionMessage(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	var resp editSessionMessageResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Version != 1 {
		t.Fatalf("first edit version = %d, want 1", resp.Version)
	}
	if resp.Session == nil || resp.Session.Content != "corrected text" {
		t.Fatalf("effective content = %+v, want 'corrected text'", resp.Session)
	}
	if resp.Edit.OriginalContent != "original text" {
		t.Fatalf("original snapshot = %q, want 'original text'", resp.Edit.OriginalContent)
	}

	// Second edit on the same row -> version 2, original snapshot preserved.
	req = withURLParam(makeRequest(t, http.MethodPut, "/session-messages/turn-1",
		editSessionMessageRequest{Content: "corrected again"}), "id", "turn-1")
	rr = httptest.NewRecorder()
	srv.editSessionMessage(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("re-edit status = %d: %s", rr.Code, rr.Body.String())
	}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if resp.Version != 2 {
		t.Fatalf("re-edit version = %d, want 2", resp.Version)
	}
	if resp.Edit.OriginalContent != "original text" {
		t.Fatalf("original snapshot must survive re-edit, got %q", resp.Edit.OriginalContent)
	}
	// Still exactly one overlay row for the turn.
	if len(sessionRepo.overlays) != 1 {
		t.Fatalf("want one overlay row, got %d", len(sessionRepo.overlays))
	}
}

func TestEditSessionMessage_RequiresContent(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{getResult: sessionRow("turn-1", "x")})
	req := withURLParam(makeRequest(t, http.MethodPut, "/session-messages/turn-1",
		editSessionMessageRequest{Content: "   "}), "id", "turn-1")
	rr := httptest.NewRecorder()
	srv.editSessionMessage(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestEditSessionMessage_NotFound(t *testing.T) {
	// No getResult -> GetByID returns ErrNotFound.
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	req := withURLParam(makeRequest(t, http.MethodPut, "/session-messages/missing",
		editSessionMessageRequest{Content: "x"}), "id", "missing")
	rr := httptest.NewRecorder()
	srv.editSessionMessage(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404: %s", rr.Code, rr.Body.String())
	}
}

func TestSessionSearch_AppliesOverlay(t *testing.T) {
	row := sessionRow("turn-1", "original text")
	sessionRepo := &testSessionRepo{
		getResult:   row,
		listResults: []domain.Memory{*row},
		listTotal:   1,
	}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)

	// Edit the turn.
	er := withURLParam(makeRequest(t, http.MethodPut, "/session-messages/turn-1",
		editSessionMessageRequest{Content: "edited for display"}), "id", "turn-1")
	srv.editSessionMessage(httptest.NewRecorder(), er)

	// Session list/search should render the edited content + edited marker.
	req := makeRequest(t, http.MethodGet, "/memories?memory_type=session", nil)
	rr := httptest.NewRecorder()
	srv.listMemories(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rr.Code, rr.Body.String())
	}
	var resp listResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Memories) != 1 || resp.Memories[0].Content != "edited for display" {
		t.Fatalf("overlay not applied to search: %+v", resp.Memories)
	}
	var meta map[string]any
	_ = json.Unmarshal(resp.Memories[0].Metadata, &meta)
	if meta["edited"] != true {
		t.Fatalf("expected edited marker in metadata, got %v", meta)
	}
}

func TestDeleteSessionMessageEdit_Reverts(t *testing.T) {
	row := sessionRow("turn-1", "original text")
	sessionRepo := &testSessionRepo{
		getResult:   row,
		listResults: []domain.Memory{*row},
		listTotal:   1,
	}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)

	srv.editSessionMessage(httptest.NewRecorder(), withURLParam(makeRequest(t, http.MethodPut,
		"/session-messages/turn-1", editSessionMessageRequest{Content: "edited"}), "id", "turn-1"))

	// Delete the overlay.
	dr := withURLParam(makeRequest(t, http.MethodDelete, "/session-messages/turn-1/edit", nil), "id", "turn-1")
	drr := httptest.NewRecorder()
	srv.deleteSessionMessageEdit(drr, dr)
	if drr.Code != http.StatusOK {
		t.Fatalf("delete status = %d: %s", drr.Code, drr.Body.String())
	}

	// Search now renders the original again.
	req := makeRequest(t, http.MethodGet, "/memories?memory_type=session", nil)
	rr := httptest.NewRecorder()
	srv.listMemories(rr, req)
	var resp listResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp.Memories) != 1 || resp.Memories[0].Content != "original text" {
		t.Fatalf("revert failed, content = %+v", resp.Memories)
	}
}

func TestEditSessionMessage_ChainRejected(t *testing.T) {
	srv := newTestServer(&testMemoryRepo{}, &testSessionRepo{})
	req := makeRequest(t, http.MethodPut, "/session-messages/turn-1",
		editSessionMessageRequest{Content: "x"})
	// Promote to a chain auth context (IsChain() == Chain != nil).
	auth := &domain.AuthInfo{AgentName: "chain-agent", Chain: &domain.ChainAuth{}}
	req = req.WithContext(middleware.WithAuthContext(req.Context(), auth))
	req = withURLParam(req, "id", "turn-1")
	rr := httptest.NewRecorder()
	srv.editSessionMessage(rr, req)
	if rr.Code == http.StatusOK {
		t.Fatalf("chain key must not be allowed to edit raw sessions: %d", rr.Code)
	}
}

func TestSessionSearch_ContentOnlyEditKeepsOriginalTags(t *testing.T) {
	row := sessionRow("turn-1", "original text")
	row.Tags = []string{"old"}
	sessionRepo := &testSessionRepo{getResult: row, listResults: []domain.Memory{*row}, listTotal: 1}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)

	// Content-only edit (tags field omitted) must not touch display tags.
	srv.editSessionMessage(httptest.NewRecorder(), withURLParam(makeRequest(t, http.MethodPut,
		"/session-messages/turn-1", editSessionMessageRequest{Content: "edited"}), "id", "turn-1"))

	rr := httptest.NewRecorder()
	srv.listMemories(rr, makeRequest(t, http.MethodGet, "/memories?memory_type=session", nil))
	var resp listResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp.Memories) != 1 || resp.Memories[0].Content != "edited" {
		t.Fatalf("content not applied: %+v", resp.Memories)
	}
	if len(resp.Memories[0].Tags) != 1 || resp.Memories[0].Tags[0] != "old" {
		t.Fatalf("content-only edit must keep original tags, got %v", resp.Memories[0].Tags)
	}
}

func TestSessionSearch_ExplicitTagsOverride(t *testing.T) {
	row := sessionRow("turn-1", "original text")
	row.Tags = []string{"old"}
	sessionRepo := &testSessionRepo{getResult: row, listResults: []domain.Memory{*row}, listTotal: 1}
	srv := newTestServer(&testMemoryRepo{}, sessionRepo)

	newTags := []string{"new"}
	srv.editSessionMessage(httptest.NewRecorder(), withURLParam(makeRequest(t, http.MethodPut,
		"/session-messages/turn-1", editSessionMessageRequest{Content: "edited", Tags: &newTags}), "id", "turn-1"))

	rr := httptest.NewRecorder()
	srv.listMemories(rr, makeRequest(t, http.MethodGet, "/memories?memory_type=session", nil))
	var resp listResponse
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp.Memories[0].Tags) != 1 || resp.Memories[0].Tags[0] != "new" {
		t.Fatalf("explicit tags must override, got %v", resp.Memories[0].Tags)
	}
}
