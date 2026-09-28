package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func contextMemory(id, app, session string, seq int, role, content string) domain.Memory {
	meta, _ := json.Marshal(map[string]any{"seq": seq, "role": role})
	confidence := 80
	return domain.Memory{ID: id, AppID: app, AgentID: "agent", SessionID: session,
		MemoryType: domain.TypeSession, Metadata: meta, Content: content, Confidence: &confidence}
}

func TestSessionContextKeepsVerifiedNeighborWithoutChangingSelection(t *testing.T) {
	question := contextMemory("question", "app", "s", 10, "assistant", "¿Tu abono es mensual o anual?")
	answer := contextMemory("answer", "app", "s", 11, "user", "Es anual.")
	foreign := contextMemory("aaa-foreign", "other-app", "s", 11, "user", "Private unrelated answer.")
	nonAdjacent := contextMemory("far", "app", "s", 13, "user", "No corresponde.")
	candidates := []RecallCandidate{{Memory: foreign}, {Memory: nonAdjacent}, {Memory: answer}}
	before := string(question.Metadata)
	got := FinalizeSearchResultsWithSessionContext([]domain.Memory{question}, candidates, "¿Qué tipo de abono tiene Clara?")
	if len(got) != 1 || got[0].ID != question.ID || *got[0].Confidence != 80 || got[0].MemoryType != domain.TypeSession {
		t.Fatalf("selection changed: %+v", got)
	}
	if !strings.Contains(got[0].Content, "Es anual.") || strings.Contains(got[0].Content, "Private") || strings.Contains(got[0].Content, "No corresponde") {
		t.Fatalf("bad evidence assembly: %q", got[0].Content)
	}
	if string(question.Metadata) != before {
		t.Fatal("source metadata mutated")
	}
	turns := parseSourceTurnsFromMetadata(got[0].Metadata)
	if len(turns) != 1 || turns[0].Seq != 11 {
		t.Fatalf("bad provenance: %+v", turns)
	}

	// A fact from a different event or an acknowledgment cannot be appended.
	answer.Content = "Muchas gracias!"
	got = FinalizeSearchResultsWithSessionContext([]domain.Memory{question}, []RecallCandidate{{Memory: answer}}, "¿Qué tipo de abono tiene Clara?")
	if got[0].Content != question.Content {
		t.Fatal("acknowledgment added as evidence")
	}
	answer.Content = "Es anual."
	answer.AgentID = "other-agent"
	got = FinalizeSearchResultsWithSessionContext([]domain.Memory{question}, []RecallCandidate{{Memory: answer}}, "¿Qué tipo de abono tiene Clara?")
	if got[0].Content != question.Content {
		t.Fatal("cross-agent context leaked")
	}
}

func TestSessionAndInsightEvidenceShareResponseCap(t *testing.T) {
	var selected []domain.Memory
	var candidates []RecallCandidate
	for i := 0; i < 6; i++ {
		q := contextMemory(fmt.Sprint("q", i), "app", fmt.Sprint(i), 0, "user", "La suscripción tiene problemas con la renovación.")
		a := contextMemory(fmt.Sprint("a", i), "app", fmt.Sprint(i), 1, "assistant", strings.Repeat("La suscripción se puede revisar con estos ejemplos. ", 40))
		selected = append(selected, q)
		candidates = append(candidates, RecallCandidate{Memory: a})
	}
	selected = append(selected, domain.Memory{ID: "insight", MemoryType: domain.TypeInsight,
		Content: "La suscripción requiere una revisión.", Metadata: SetSourceProvenanceMetadata(nil, []int{1}, []sourceTurnMetadata{{Seq: 1, Content: strings.Repeat("La suscripción necesita revisión. ", 50)}})})
	got := FinalizeSearchResultsWithSessionContext(selected, candidates, "¿Qué problemas tiene la suscripción?")
	added := 0
	for i, m := range got {
		added += utf8.RuneCountInString(m.Content) - utf8.RuneCountInString(selected[i].Content)
		for _, turn := range parseSourceTurnsFromMetadata(m.Metadata) {
			if utf8.RuneCountInString(turn.Content)+searchSourceRoleRunes(turn) > maxSearchSourceTurnRunes {
				t.Fatal("fragment cap exceeded")
			}
		}
	}
	if len(got) != len(selected) || added <= 0 || added > maxSearchSourceResponseRunes {
		t.Fatalf("result count or shared budget changed: added=%d", added)
	}
}

func TestSessionToMemoryPreservesApplicationScope(t *testing.T) {
	m := sessionToMemory(&domain.Session{AppID: "app", SessionID: "conversation", AgentID: "agent"})
	if m.AppID != "app" || m.SessionID != "conversation" || m.AgentID != "agent" {
		t.Fatalf("lost context scope: %+v", m)
	}
}
