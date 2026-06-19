package service

import (
	"context"
	"encoding/json"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Raw-session edit overlay (display-only). EditSessionOverlay /
// GetSessionOverlay / DeleteSessionOverlay manage the single overlay row
// per session turn; ApplySessionOverlay rewrites Session Search results so
// an edited turn renders its edited content. None of this mutates the
// `sessions` table, its embedding, or its FTS index — so retrieval and
// memory/fact recall are unaffected; only rendering of already-matched
// session rows changes.

// EditSessionOverlay upserts the overlay for a raw session row (id ==
// sessions.id). It snapshots the current (immutable) session content as the
// overlay's original_content, then returns the stored overlay plus the
// effective (edited) session view for the response. Returns
// domain.ErrNotFound if the session row does not exist / is not active.
func (s *SessionService) EditSessionOverlay(
	ctx context.Context,
	id, content string,
	tags *[]string,
	editedBy, reason string,
) (*domain.SessionEdit, *domain.Memory, error) {
	base, err := s.sessions.GetByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}

	edit := &domain.SessionEdit{
		ID:              id,
		AppID:           base.AppID,
		SessionID:       base.SessionID,
		Seq:             sessionSeqFromMemoryMeta(base),
		AgentID:         base.AgentID,
		OriginalContent: base.Content,
		EditedContent:   content,
		EditedBy:        editedBy,
		Reason:          reason,
		State:           domain.StateActive,
	}
	// nil tags = "leave display tags unchanged"; a non-nil slice (incl. an
	// empty one) is an explicit override.
	if tags != nil {
		edit.EditedTags = *tags
		edit.EditedTagsSet = true
	}
	if err := s.sessions.UpsertSessionEdit(ctx, edit); err != nil {
		return nil, nil, err
	}

	stored, err := s.sessions.GetSessionEdit(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	effective := applyOverlayToMemory(*base, stored)
	return stored, &effective, nil
}

// GetSessionOverlay returns the active overlay for a session row, or
// domain.ErrNotFound when the row has not been edited.
func (s *SessionService) GetSessionOverlay(ctx context.Context, id string) (*domain.SessionEdit, error) {
	return s.sessions.GetSessionEdit(ctx, id)
}

// DeleteSessionOverlay removes the overlay (revert to original). It also
// confirms the underlying session row exists so callers can return 404 for
// an unknown id rather than a silent no-op. Returns the rows removed.
func (s *SessionService) DeleteSessionOverlay(ctx context.Context, id string) (int64, error) {
	if _, err := s.sessions.GetByID(ctx, id); err != nil {
		return 0, err
	}
	return s.sessions.DeleteSessionEdit(ctx, id)
}

// ApplySessionOverlay rewrites session-type results in place: for every
// memory whose id has an active overlay, the content/tags are replaced with
// the edited versions and edited/edit_version/edited_at markers are merged
// into metadata. Non-session memories and rows without an overlay are
// returned untouched. A repository failure is non-fatal — results degrade
// to original content rather than failing the whole search.
func (s *SessionService) ApplySessionOverlay(ctx context.Context, memories []domain.Memory) []domain.Memory {
	if len(memories) == 0 {
		return memories
	}
	ids := make([]string, 0, len(memories))
	for _, m := range memories {
		if m.MemoryType == domain.TypeSession && m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return memories
	}
	overlays, err := s.sessions.GetSessionEditsByIDs(ctx, ids)
	if err != nil || len(overlays) == 0 {
		return memories
	}
	for i := range memories {
		ov, ok := overlays[memories[i].ID]
		if !ok {
			continue
		}
		memories[i] = applyOverlayToMemory(memories[i], ov)
	}
	return memories
}

// applyOverlayToMemory returns a copy of base with the overlay's edited
// content/tags applied and edit markers merged into metadata.
func applyOverlayToMemory(base domain.Memory, ov *domain.SessionEdit) domain.Memory {
	if ov == nil {
		return base
	}
	base.Content = ov.EditedContent
	// Only override rendered tags when the edit explicitly set them; a
	// content-only edit must leave the original session tags intact.
	if ov.EditedTagsSet {
		base.Tags = ov.EditedTags
	}
	base.Metadata = mergeEditMarkers(base.Metadata, ov)
	return base
}

// mergeEditMarkers adds edited / edit_version / edited_at onto existing
// session metadata without dropping role/seq/content_type.
func mergeEditMarkers(existing json.RawMessage, ov *domain.SessionEdit) json.RawMessage {
	payload := map[string]any{}
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &payload); err != nil {
			payload = map[string]any{}
		}
	}
	payload["edited"] = true
	payload["edit_version"] = ov.Version
	payload["edited_at"] = ov.UpdatedAt
	raw, err := json.Marshal(payload)
	if err != nil {
		return existing
	}
	return raw
}

// sessionSeqFromMemoryMeta extracts the seq a session row was stored with
// (session GetByID encodes it in metadata as {"seq": N}).
func sessionSeqFromMemoryMeta(m *domain.Memory) int {
	if m == nil || len(m.Metadata) == 0 {
		return 0
	}
	var meta struct {
		Seq int `json:"seq"`
	}
	if err := json.Unmarshal(m.Metadata, &meta); err != nil {
		return 0
	}
	return meta.Seq
}
