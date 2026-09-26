package handler

import (
	"reflect"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestClassifyRecallQueryShapeSpanishUsesBoundedShapes(t *testing.T) {
	cases := []struct {
		query string
		shape recallQueryShape
	}{
		{"¿Dónde está la oficina?", recallQueryShapeLocation},
		{"Donde está la oficina?", recallQueryShapeLocation},
		{"¿En dónde trabajó antes?", recallQueryShapeLocation},
		{"¿Cuándo empezó el contrato?", recallQueryShapeTime},
		{"¿A qué hora abrió?", recallQueryShapeTime},
		{"¿Quién aprobó el cambio?", recallQueryShapeEntity},
		{"¿Cuál es su proveedor?", recallQueryShapeGeneral},
		{"¿Qué cambió en la cuenta?", recallQueryShapeGeneral},
		{"¿Que cambió en la cuenta?", recallQueryShapeGeneral},
		{"¿Cuáles son los requisitos?", recallQueryShapeGeneral},
		{"¿Qué tipos de transporte utiliza?", recallQueryShapeGeneral},
		{"¿Cuántas oficinas abrió?", recallQueryShapeCount},
		{"¿Cuánto tiempo duró?", recallQueryShapeGeneral},
		{"¿Por qué cambió el contrato?", recallQueryShapeGeneral},
		{"¿Cómo funciona la entrega?", recallQueryShapeGeneral},
		{"Tell me about dónde clauses", recallQueryShapeGeneral},
		{"whereabouts of a contract", recallQueryShapeGeneral},
		{"Quebec deployment notes", recallQueryShapeGeneral},
	}
	for _, tt := range cases {
		t.Run(tt.query, func(t *testing.T) {
			got := classifyRecallQueryShape(tt.query)
			if got != tt.shape {
				t.Fatalf("shape=%v want=%v", got, tt.shape)
			}
			if effectiveRecallBudget(got, 5) != 5 {
				t.Fatal("Spanish shape expanded caller budget")
			}
			for _, pool := range []service.RecallSourcePool{service.RecallSourceInsight, service.RecallSourceSession} {
				if recallCandidateLimit(got, pool) > defaultSessionCandidateLimit {
					t.Fatal("Spanish shape expanded candidate limit")
				}
			}
		})
	}
}

func TestRecallAccentedLatinWordEvidence(t *testing.T) {
	if got := recallExactTokenMatchCount(domain.Memory{Content: "Una devolución requiere autorización y revisión."}, []string{"devolución", "autorización", "revisión"}); got != 3 {
		t.Fatalf("accented exact matches=%d want3", got)
	}
	if got := recallExactTokenMatchCount(domain.Memory{Content: "Una devolución requiere autorización."}, []string{"devoluci", "autorizaci"}); got != 0 {
		t.Fatalf("fragment matches=%d want0", got)
	}
	ascii := "HTTP 2024 API user_id alpha-beta it's 3party storage account"
	if got, want := recallCoverageWordTokens(ascii), recallCoverageEnglishTokenRe.FindAllString(ascii, -1); !reflect.DeepEqual(got, want) {
		t.Fatalf("ASCII tokens changed: %q want%q", got, want)
	}
	mixed := "devolución HTTP 2024 API autorización"
	if got, want := recallCoverageWordTokens(mixed), []string{"devolución", "autorización"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("mixed tokens=%q want%q", got, want)
	}
	for _, tt := range []struct {
		text string
		want int
	}{{"devolución", 1}, {"acción revisión", 2}, {"revisio\u0301n", 1}, {"HTTP 2024 API", 3}, {"在上海办公", 3}, {"在上海 office devolución", 4}} {
		if got := recallAnswerUnitCount(tt.text); got != tt.want {
			t.Fatalf("units(%q)=%d want%d", tt.text, got, tt.want)
		}
	}
	if got, want := recallCoverageWordTokens("中文billing及storage devolución"), []string{"billing", "storage", "devolución"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("mixed CJK tokens=%q want%q", got, want)
	}
	if got, want := recallCoverageWordTokens("'library' devolución"), []string{"library", "devolución"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("quoted tokens=%q want%q", got, want)
	}
	for _, ascii := range []string{"'library'", "--billing--", "cat-", "a'bc", "config_key", "billing' --cat-- field_name owner's alpha-beta", "2024-billing", "config_key-storage", "HTTP-protocol"} {
		got := recallCoverageWordTokens("中文 " + ascii)
		want := recallCoverageEnglishTokenRe.FindAllString(ascii, -1)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("mixed ASCII parity for %q: %q want%q", ascii, got, want)
		}
	}
	// Spanish question glue must not prevent the same content words matching.
	got := looseRecallQueryTokens("¿Qué revisión de la devolución es necesaria?")
	if want := []string{"revisión", "devolución", "necesaria"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("query tokens=%q want%q", got, want)
	}
	if got, want := looseRecallQueryTokens("What does my son do?"), []string{"my", "son", "do"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("English son was removed: %q want%q", got, want)
	}
	// The separate CJK coverage path remains available.
	if got := recallExactTokenMatchCount(domain.Memory{Content: "上海办公室"}, []string{"上海办公室"}); got != 1 {
		t.Fatalf("CJK matches=%d", got)
	}
}

func TestSpanishRecallConfidenceParityAndNoiseCutoff(t *testing.T) {
	now := time.Now()
	for _, queries := range [][2]string{{"Where is the office?", "¿Dónde está la oficina?"}, {"When exactly?", "¿Cuándo exactamente?"}} {
		relevant := service.RecallCandidate{Memory: domain.Memory{ID: "m", Content: "The office is in Madrid.", UpdatedAt: now}, SourcePool: service.RecallSourceSession, RRFScore: 1.0 / 61, RRFRank: 1, InVector: true, VectorSimilarity: .82}
		english, spanish := buildRecallQueryProfile(queries[0]), buildRecallQueryProfile(queries[1])
		if a, b := buildRecallConfidence(english, relevant), buildRecallConfidence(spanish, relevant); a != b {
			t.Fatalf("language scoring differs %q=%d %q=%d", queries[0], a, queries[1], b)
		}
		irrelevant := relevant
		irrelevant.Memory.Content = "unrelated generic passage with no supporting facts about the requested subject and several additional words to avoid a short answer bonus"
		irrelevant.VectorSimilarity = .31
		irrelevant.RRFScore = 1.0 / 100
		irrelevant.RRFRank = 40
		if got := buildRecallConfidence(spanish, irrelevant); got >= defaultMixedMinConfidence {
			t.Fatalf("irrelevant candidate confidence=%d >=%d", got, defaultMixedMinConfidence)
		}
	}
	relevant := service.RecallCandidate{Memory: domain.Memory{ID: "m", Content: "The office is in Madrid.", UpdatedAt: now}, SourcePool: service.RecallSourceSession, RRFScore: 1.0 / 61, RRFRank: 1, InVector: true, VectorSimilarity: .82}
	profile := buildRecallQueryProfile("¿Dónde está la oficina?")
	if got := buildRecallConfidence(profile, relevant); got < defaultMixedMinConfidence {
		t.Fatalf("Spanish location evidence discarded: %d", got)
	}
	memories, _, _ := selectMixedRecallCandidates(profile, 5, applyRecallConfidence(profile, []service.RecallCandidate{relevant}), nil)
	if len(memories) != 1 {
		t.Fatalf("expected matching location selected, got %d", len(memories))
	}
}
