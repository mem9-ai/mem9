package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Overlay application is display-only: it rewrites session-type rows that
// have an active edit and leaves everything else (including memory/fact
// rows) byte-identical.

func TestApplySessionOverlay_RewritesOnlyEditedSessions(t *testing.T) {
	repo := &stubSessionRepo{overlays: map[string]*domain.SessionEdit{
		"s1": {ID: "s1", EditedContent: "edited one", Version: 2, State: domain.StateActive},
	}}
	svc := newTestSessionService(repo)

	meta, _ := json.Marshal(map[string]any{"role": "user", "seq": 1})
	in := []domain.Memory{
		{ID: "s1", Content: "orig one", MemoryType: domain.TypeSession, Metadata: meta},
		{ID: "s2", Content: "orig two", MemoryType: domain.TypeSession, Metadata: meta},
		{ID: "f1", Content: "a fact", MemoryType: domain.TypeInsight},
	}
	out := svc.ApplySessionOverlay(context.Background(), in)

	if out[0].Content != "edited one" {
		t.Fatalf("edited session not rewritten: %q", out[0].Content)
	}
	var m map[string]any
	_ = json.Unmarshal(out[0].Metadata, &m)
	if m["edited"] != true || m["role"] != "user" {
		t.Fatalf("edit markers must merge without dropping role: %v", m)
	}
	if out[1].Content != "orig two" {
		t.Fatalf("un-edited session must be untouched: %q", out[1].Content)
	}
	if out[2].Content != "a fact" {
		t.Fatalf("fact/memory rows must never be overlaid: %q", out[2].Content)
	}
}

func TestEditSessionOverlay_SnapshotsOriginalAndBumpsVersion(t *testing.T) {
	base := &domain.Memory{ID: "s1", Content: "original", MemoryType: domain.TypeSession, AppID: "app"}
	repo := &stubSessionRepo{getResult: base}
	svc := newTestSessionService(repo)

	edit, effective, err := svc.EditSessionOverlay(context.Background(), "s1", "v1 edit", nil, "alice", "")
	if err != nil {
		t.Fatal(err)
	}
	if edit.Version != 1 || edit.OriginalContent != "original" || effective.Content != "v1 edit" {
		t.Fatalf("first edit: %+v / effective %q", edit, effective.Content)
	}
	edit, _, err = svc.EditSessionOverlay(context.Background(), "s1", "v2 edit", nil, "alice", "")
	if err != nil {
		t.Fatal(err)
	}
	if edit.Version != 2 || edit.OriginalContent != "original" {
		t.Fatalf("re-edit must bump version, keep original: %+v", edit)
	}
}

func TestDeleteSessionOverlay_NotFoundWhenSessionMissing(t *testing.T) {
	repo := &stubSessionRepo{getErr: domain.ErrNotFound} // underlying session row absent
	svc := newTestSessionService(repo)
	if _, err := svc.DeleteSessionOverlay(context.Background(), "missing"); err == nil {
		t.Fatal("expected error when underlying session row is missing")
	}
}
