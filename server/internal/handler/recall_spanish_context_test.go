package handler

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func overviewCandidate(id, session string, confidence int) service.RecallCandidate {
	return service.RecallCandidate{SourcePool: service.RecallSourceInsight, Memory: domain.Memory{
		ID: id, SessionID: session, AppID: "app", AgentID: "agent", MemoryType: domain.TypeInsight,
		Content: id + " is a distinct supported topic", Confidence: &confidence}}
}

func TestSpanishOverviewDiversifiesOnlyNearTiedEligibleSessions(t *testing.T) {
	profile := buildRecallQueryProfile("¿Sobre qué temas consulta Clara con mayor frecuencia?")
	candidates := []service.RecallCandidate{overviewCandidate("a", "one", 90), overviewCandidate("b", "one", 89), overviewCandidate("c", "two", 88), overviewCandidate("low", "three", 64)}
	got, _, stats := selectMixedRecallCandidates(profile, 2, candidates, nil)
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "c" || stats.mode != "overview" {
		t.Fatalf("overview=%+v stats=%+v", got, stats)
	}
	if effectiveRecallBudget(profile.shape, 5) != 5 || recallCandidateLimit(profile.shape, service.RecallSourceSession) != defaultSessionCandidateLimit {
		t.Fatal("overview increased fetch/response budget")
	}
	candidates[2] = overviewCandidate("distant", "two", 75)
	got, _, _ = selectMixedRecallCandidates(profile, 2, candidates, nil)
	if got[1].ID != "b" {
		t.Fatal("diversity displaced much stronger evidence")
	}
	got, _, _ = selectMixedRecallCandidates(profile, 5, candidates, nil)
	for _, m := range got {
		if m.ID == "low" {
			t.Fatal("low-confidence evidence rescued")
		}
	}
}

func TestOverviewDoesNotChangeEnglishChineseOrSpanishFactQueries(t *testing.T) {
	candidates := []service.RecallCandidate{overviewCandidate("a", "one", 90), overviewCandidate("b", "one", 89), overviewCandidate("c", "two", 88)}
	for _, query := range []string{"What topics does Clara discuss most often?", "她经常咨询什么问题？", "¿Qué tarjeta tiene Clara?", "¿Cuándo consulta habitualmente?"} {
		profile := buildRecallQueryProfile(query)
		got, _, stats := selectMixedRecallCandidates(profile, 2, candidates, nil)
		if stats.mode == "overview" {
			t.Fatalf("unexpected overview policy: %q", query)
		}
		var want []domain.Memory
		if shouldUseBalancedTopSelection(profile.shape) {
			want, _, _ = selectBalancedRecallCandidates(profile, 2, candidates, nil)
		} else {
			want, _ = selectTopRecallCandidates(profile.shape, 2, defaultMixedMinConfidence, true, candidates, nil)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("original selection changed: %q", query)
		}
	}
}

func TestSessionContextIsAdditiveAndSpanishOnly(t *testing.T) {
	meta, _ := json.Marshal(map[string]any{"seq": 2, "role": "assistant"})
	answerMeta, _ := json.Marshal(map[string]any{"seq": 3, "role": "user"})
	selected := []domain.Memory{{ID: "q", MemoryType: domain.TypeSession, SessionID: "s", Metadata: meta, Content: "¿Tu suscripción es mensual o anual?"}}
	candidates := []service.RecallCandidate{{Memory: domain.Memory{ID: "a", MemoryType: domain.TypeSession, SessionID: "s", Metadata: answerMeta, Content: "Es anual."}}}
	for _, query := range []string{"What subscription does Clara have?", "她的订阅类型是什么？"} {
		got := finalizeRecallContext(selected, candidates, query)
		want := service.FinalizeSearchResults(selected, query)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("non-Spanish context changed: %q", query)
		}
	}
	got := finalizeRecallContext(selected, candidates, "¿Qué tipo de suscripción tiene Clara?")
	if len(got) != 1 || got[0].ID != "q" || got[0].Content == selected[0].Content {
		t.Fatal("Spanish adjacent answer not retained")
	}
}
