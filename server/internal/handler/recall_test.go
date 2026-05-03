package handler

import (
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestClassifyRecallQueryShape_Bilingual(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  recallQueryShape
	}{
		{name: "general english", query: "tell me about john", want: recallQueryShapeGeneral},
		{name: "entity english", query: "who is john", want: recallQueryShapeEntity},
		{name: "count english", query: "how many deployments happened", want: recallQueryShapeCount},
		{name: "time english", query: "when did it ship", want: recallQueryShapeTime},
		{name: "location english", query: "where is the office", want: recallQueryShapeLocation},
		{name: "enumeration english activities", query: "What activities does Melanie partake in?", want: recallQueryShapeEnumeration},
		{name: "enumeration english books", query: "What books has Melanie read?", want: recallQueryShapeEnumeration},
		{name: "enumeration english names", query: "What are Melanie's pets' names?", want: recallQueryShapeEnumeration},
		{name: "exact english", query: "what company does john like", want: recallQueryShapeExact},
		{name: "entity chinese", query: "谁负责这个项目", want: recallQueryShapeEntity},
		{name: "entity chinese 哪一个", query: "哪一个团队负责", want: recallQueryShapeEntity},
		{name: "count chinese 多少", query: "多少次发布失败了", want: recallQueryShapeCount},
		{name: "count chinese 有多少", query: "有多少个服务", want: recallQueryShapeCount},
		{name: "count chinese 几个", query: "几个团队参与了", want: recallQueryShapeCount},
		{name: "time chinese 什么时候", query: "什么时候上线的", want: recallQueryShapeTime},
		{name: "time chinese 何时", query: "何时发布", want: recallQueryShapeTime},
		{name: "time chinese 几号", query: "几号发版", want: recallQueryShapeTime},
		{name: "time chinese 什么时间", query: "什么时间发布", want: recallQueryShapeTime},
		{name: "location chinese 哪里", query: "哪里部署的", want: recallQueryShapeLocation},
		{name: "location chinese 在哪", query: "在哪办公", want: recallQueryShapeLocation},
		{name: "location chinese 什么地方", query: "什么地方部署", want: recallQueryShapeLocation},
		{name: "location chinese 哪座城市", query: "哪座城市有办公室", want: recallQueryShapeLocation},
		{name: "enumeration chinese 哪些", query: "哪些活动是她参加过的？", want: recallQueryShapeEnumeration},
		{name: "exact chinese", query: "什么公司是客户", want: recallQueryShapeExact},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyRecallQueryShape(tt.query); got != tt.want {
				t.Fatalf("classifyRecallQueryShape(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestRecallAnswerUnitCount_CJKAware(t *testing.T) {
	if got := recallAnswerUnitCount("在上海办公"); got <= 1 {
		t.Fatalf("expected CJK-aware token count > 1, got %d", got)
	}
}

func TestAnswerEvidenceBonus_BilingualSignals(t *testing.T) {
	tests := []struct {
		name   string
		shape  recallQueryShape
		strong string
		weak   string
	}{
		{
			name:   "count chinese list and numerals",
			shape:  recallQueryShapeCount,
			strong: "2024年发布了三次，分别在1月、3月和5月。",
			weak:   "经常发布。",
		},
		{
			name:   "time chinese date",
			shape:  recallQueryShapeTime,
			strong: "2024年3月15日上线",
			weak:   "很快上线",
		},
		{
			name:   "location chinese verb cue",
			shape:  recallQueryShapeLocation,
			strong: "在上海办公",
			weak:   "经常出差",
		},
		{
			name:   "location chinese direct cue",
			shape:  recallQueryShapeLocation,
			strong: "位于北京",
			weak:   "经常出差",
		},
		{
			name:   "exact chinese named answer",
			shape:  recallQueryShapeExact,
			strong: "清华大学",
			weak:   "客户很多",
		},
		{
			name:   "exact mixed script quoted brand",
			shape:  recallQueryShapeExact,
			strong: `“Under Armour”`,
			weak:   "户外品牌",
		},
		{
			name:   "enumeration prefers itemized evidence",
			shape:  recallQueryShapeEnumeration,
			strong: `Melanie enjoys pottery, camping, and painting.`,
			weak:   "Melanie enjoys many activities.",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			profile := recallQueryProfile{shape: tt.shape}
			strong := answerEvidenceBonus(profile, domain.Memory{Content: tt.strong})
			weak := answerEvidenceBonus(profile, domain.Memory{Content: tt.weak})
			if strong <= weak {
				t.Fatalf("answerEvidenceBonus(%v, %q) = %.2f, want > %.2f for %q", tt.shape, tt.strong, strong, weak, tt.weak)
			}
		})
	}
}

func TestAnswerEvidenceBonus_TimePrefersNaturalDatesOverMetadataProjection(t *testing.T) {
	profile := recallQueryProfile{shape: recallQueryShapeTime}

	natural := answerEvidenceBonus(profile, domain.Memory{
		Content: "[10:37 am on 27 June, 2023] I took my family camping in the mountains last week.",
	})
	synthetic := answerEvidenceBonus(profile, domain.Memory{
		Content:  "今天我很开心",
		Metadata: service.MergeTemporalMetadata(nil, &service.TemporalMetadata{Kind: "deictic_relative", Display: "2026-04-11"}),
	})
	if natural <= synthetic {
		t.Fatalf("expected natural anchored evidence %.2f to outrank metadata-only evidence %.2f", natural, synthetic)
	}
}

func TestAnswerEvidenceBonus_IgnoresLegacyInjectedDateWhenBodyAlreadyExplicit(t *testing.T) {
	profile := recallQueryProfile{shape: recallQueryShapeTime}

	natural := answerEvidenceBonus(profile, domain.Memory{
		Content: "James' mother and her friend visited him on 19 October 2022.",
	})
	legacyPolluted := answerEvidenceBonus(profile, domain.Memory{
		Content: "James' mother and her friend visited him on 19 October 2022(2026-04-09|2026年4月9日)",
	})
	if legacyPolluted != natural {
		t.Fatalf("expected legacy polluted score %.2f to equal natural score %.2f", legacyPolluted, natural)
	}
}

func TestBuildRecallConfidence_TimePrefersRelativeCueOverHeaderOnlyTimestamp(t *testing.T) {
	profile := buildRecallQueryProfile("When did Melanie go camping in June?")
	now := time.Now()

	headerOnly := service.RecallCandidate{
		Memory: domain.Memory{
			ID:        "s1",
			Content:   "[8:56 pm on 20 July, 2023] Hey Melanie! Just wanted to say hi!",
			UpdatedAt: now,
		},
		SourcePool: service.RecallSourceSession,
		RRFScore:   recallRRFMaxScore * 0.6,
		InKeyword:  true,
	}
	relevant := service.RecallCandidate{
		Memory: domain.Memory{
			ID:        "s2",
			Content:   "[10:37 am on 27 June, 2023] I took my family camping in the mountains last week - it was a really nice time together!",
			UpdatedAt: now,
		},
		SourcePool: service.RecallSourceSession,
		RRFScore:   recallRRFMaxScore * 0.5,
		InKeyword:  true,
	}

	if gotRel, gotHeader := buildRecallConfidence(profile, relevant), buildRecallConfidence(profile, headerOnly); gotRel <= gotHeader {
		t.Fatalf("expected relative temporal evidence to outrank header-only timestamp: relevant=%d header_only=%d", gotRel, gotHeader)
	}
}

func TestBuildRecallConfidence_TimeFutureIntentPrefersPlannedFutureEvidence(t *testing.T) {
	profile := buildRecallQueryProfile("When is Melanie planning on going camping?")
	now := time.Now()

	pastEvent := service.RecallCandidate{
		Memory: domain.Memory{
			ID:        "m1",
			Content:   "Melanie went camping with her family on October 19, 2023.",
			UpdatedAt: now,
		},
		SourcePool: service.RecallSourceInsight,
		RRFScore:   recallRRFMaxScore * 0.6,
		InKeyword:  true,
	}
	futurePlan := service.RecallCandidate{
		Memory: domain.Memory{
			ID:        "s2",
			Content:   "[1:14 pm on 25 May, 2023] My kids are so excited about summer break! We're thinking about going camping next month.",
			UpdatedAt: now,
		},
		SourcePool: service.RecallSourceSession,
		RRFScore:   recallRRFMaxScore * 0.2,
		InKeyword:  true,
	}

	if gotFuture, gotPast := buildRecallConfidence(profile, futurePlan), buildRecallConfidence(profile, pastEvent); gotFuture <= gotPast {
		t.Fatalf("expected future-planning evidence to outrank past event for future time query: future=%d past=%d", gotFuture, gotPast)
	}
}

func TestRecallCandidateOptions_EnumerationExpandsAdjacentTurns(t *testing.T) {
	opts := recallCandidateOptions(recallQueryProfile{shape: recallQueryShapeEnumeration}, true)

	if !opts.EnableAdjacentTurns {
		t.Fatal("enumeration recall should expand adjacent session turns")
	}
	if opts.AdjacentTurnRadius != sessionAdjacentTurnRadius {
		t.Fatalf("adjacent radius = %d, want %d", opts.AdjacentTurnRadius, sessionAdjacentTurnRadius)
	}
	if opts.AdjacentTurnTopN != enumerationAdjacentTurnTopN {
		t.Fatalf("adjacent topN = %d, want %d", opts.AdjacentTurnTopN, enumerationAdjacentTurnTopN)
	}
	if opts.FetchMultiplier != enumerationFetchMultiplier {
		t.Fatalf("fetch multiplier = %d, want %d", opts.FetchMultiplier, enumerationFetchMultiplier)
	}
	if opts.SecondHopTopN != enumerationSecondHopTopN {
		t.Fatalf("second hop topN = %d, want %d", opts.SecondHopTopN, enumerationSecondHopTopN)
	}
}

func TestRecallCandidateOptions_PerformanceBridgeUsesRadiusTwo(t *testing.T) {
	profile := buildRecallQueryProfile("Who performed at the concert Melanie attended for her daughter's birthday?")

	if !profile.performanceBridgeQuery {
		t.Fatal("expected performer concert question to enable bridge adjacent turn expansion")
	}
	opts := recallCandidateOptions(profile, false)
	if !opts.EnableAdjacentTurns {
		t.Fatal("performance bridge recall should expand adjacent session turns")
	}
	if opts.AdjacentTurnRadius != 2 {
		t.Fatalf("adjacent radius = %d, want 2", opts.AdjacentTurnRadius)
	}
	regular := recallCandidateOptions(buildRecallQueryProfile("Who is John?"), false)
	if regular.AdjacentTurnRadius != sessionAdjacentTurnRadius {
		t.Fatalf("regular entity adjacent radius = %d, want %d", regular.AdjacentTurnRadius, sessionAdjacentTurnRadius)
	}
}

func TestAnswerEvidenceBonus_PerformanceBridgePrefersResolvedPerformerFact(t *testing.T) {
	profile := buildRecallQueryProfile("Who performed at the concert at Melanie's daughter's birthday?")

	bridge := domain.Memory{Content: "Melanie celebrated her daughter's birthday with a concert featuring Matt Patterson."}
	rawEvent := domain.Memory{Content: "[speaker:Melanie] We celebrated my daughter's birthday with a concert surrounded by music."}
	wrongConcert := domain.Memory{Content: "Melanie attended a concert by the band 'Summer Sounds', who performed pop songs."}

	gotBridge := answerEvidenceBonus(profile, bridge)
	if gotRaw := answerEvidenceBonus(profile, rawEvent); gotBridge <= gotRaw {
		t.Fatalf("bridge evidence bonus = %.2f, want > raw event %.2f", gotBridge, gotRaw)
	}
	if gotWrong := answerEvidenceBonus(profile, wrongConcert); gotBridge <= gotWrong {
		t.Fatalf("bridge evidence bonus = %.2f, want > wrong concert %.2f", gotBridge, gotWrong)
	}
}

func TestSelectTopRecallCandidates_PerformanceBridgeKeepsAnswerInsightDespiteRawSourceSeen(t *testing.T) {
	profile := buildRecallQueryProfile("Who performed at the concert at Melanie's daughter's birthday?")
	high := 90
	mid := 86
	candidates := []service.RecallCandidate{
		{
			Memory: domain.Memory{
				ID:         "raw-1",
				Content:    "[speaker:Melanie] We celebrated my daughter's birthday with a concert surrounded by music.",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":1}`),
				Confidence: &high,
			},
			SourcePool: service.RecallSourceSession,
		},
		{
			Memory: domain.Memory{
				ID:         "bridge",
				Content:    "Melanie celebrated her daughter's birthday with a concert featuring Matt Patterson.",
				MemoryType: domain.TypeInsight,
				SessionID:  "session-1",
				Metadata:   service.SetSourceSeqMetadata(nil, []int{1, 3}),
				Confidence: &mid,
			},
			SourcePool: service.RecallSourceInsight,
		},
	}

	selected, _ := selectTopRecallCandidates(profile, 2, 0, false, candidates, nil)
	if len(selected) != 2 {
		t.Fatalf("selected len = %d, want 2", len(selected))
	}
	if selected[0].ID != "raw-1" || selected[1].ID != "bridge" {
		t.Fatalf("selected IDs = [%s %s], want [raw-1 bridge]", selected[0].ID, selected[1].ID)
	}
}

func TestSelectTopRecallCandidatesDedupesInsightAndRawSessionBySourceSeq(t *testing.T) {
	high := 90
	mid := 85
	low := 80
	sessionMetadata := []byte(`{"seq":3}`)
	candidates := []service.RecallCandidate{
		{
			Memory: domain.Memory{
				ID:         "raw-3",
				Content:    "raw turn about homemade ice cream",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   sessionMetadata,
				Confidence: &high,
			},
			SourcePool: service.RecallSourceSession,
		},
		{
			Memory: domain.Memory{
				ID:         "insight-3",
				Content:    "Nate made homemade ice cream.",
				MemoryType: domain.TypeInsight,
				SessionID:  "session-1",
				Metadata:   service.SetSourceSeqMetadata(nil, []int{3}),
				Confidence: &mid,
			},
			SourcePool: service.RecallSourceInsight,
		},
		{
			Memory: domain.Memory{
				ID:         "recipe",
				Content:    "Nate made ice cream with coconut milk, vanilla extract, sugar, and salt.",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":8}`),
				Confidence: &low,
			},
			SourcePool: service.RecallSourceSession,
		},
	}

	selected, _ := selectTopRecallCandidates(recallQueryProfile{shape: recallQueryShapeExact}, 2, 0, false, candidates, nil)
	if len(selected) != 2 {
		t.Fatalf("selected len = %d, want 2", len(selected))
	}
	if selected[0].ID != "raw-3" || selected[1].ID != "recipe" {
		t.Fatalf("selected IDs = [%s %s], want [raw-3 recipe]", selected[0].ID, selected[1].ID)
	}
}

func TestSelectTopRecallCandidatesKeepsDistinctInsightsFromSameSourceSeq(t *testing.T) {
	high := 90
	mid := 88
	rawConfidence := 86
	low := 80
	candidates := []service.RecallCandidate{
		{
			Memory: domain.Memory{
				ID:         "insight-3-a",
				Content:    "Nate made homemade ice cream.",
				MemoryType: domain.TypeInsight,
				SessionID:  "session-1",
				Metadata:   service.SetSourceSeqMetadata(nil, []int{3}),
				Confidence: &high,
			},
			SourcePool: service.RecallSourceInsight,
		},
		{
			Memory: domain.Memory{
				ID:         "insight-3-b",
				Content:    "Nate used coconut milk for the ice cream.",
				MemoryType: domain.TypeInsight,
				SessionID:  "session-1",
				Metadata:   service.SetSourceSeqMetadata(nil, []int{3}),
				Confidence: &mid,
			},
			SourcePool: service.RecallSourceInsight,
		},
		{
			Memory: domain.Memory{
				ID:         "raw-3",
				Content:    "raw turn about homemade coconut milk ice cream",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":3}`),
				Confidence: &rawConfidence,
			},
			SourcePool: service.RecallSourceSession,
		},
		{
			Memory: domain.Memory{
				ID:         "raw-8",
				Content:    "Nate also painted miniatures.",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":8}`),
				Confidence: &low,
			},
			SourcePool: service.RecallSourceSession,
		},
	}

	selected, _ := selectTopRecallCandidates(recallQueryProfile{shape: recallQueryShapeExact}, 3, 0, false, candidates, nil)
	if len(selected) != 3 {
		t.Fatalf("selected len = %d, want 3", len(selected))
	}
	if selected[0].ID != "insight-3-a" || selected[1].ID != "insight-3-b" || selected[2].ID != "raw-8" {
		t.Fatalf("selected IDs = [%s %s %s], want [insight-3-a insight-3-b raw-8]", selected[0].ID, selected[1].ID, selected[2].ID)
	}
}

func TestSelectEnumerationRecallCandidatesDedupesInsightAndRawSessionBySourceSeq(t *testing.T) {
	high := 90
	mid := 85
	low := 80
	profile := recallQueryProfile{shape: recallQueryShapeEnumeration, lower: "what activities does nate do"}
	candidates := []service.RecallCandidate{
		{
			Memory: domain.Memory{
				ID:         "insight-2",
				Content:    "Nate likes cooking and gaming.",
				MemoryType: domain.TypeInsight,
				SessionID:  "session-1",
				Metadata:   service.SetSourceSeqMetadata(nil, []int{2}),
				Confidence: &high,
			},
			SourcePool: service.RecallSourceInsight,
		},
		{
			Memory: domain.Memory{
				ID:         "raw-2",
				Content:    "Nate talked about cooking and gaming.",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":2}`),
				Confidence: &mid,
			},
			SourcePool: service.RecallSourceSession,
		},
		{
			Memory: domain.Memory{
				ID:         "raw-7",
				Content:    "Nate also paints miniatures.",
				MemoryType: domain.TypeSession,
				SessionID:  "session-1",
				Metadata:   []byte(`{"seq":7}`),
				Confidence: &low,
			},
			SourcePool: service.RecallSourceSession,
		},
	}

	selected, _, _ := selectEnumerationRecallCandidates(profile, 2, candidates, nil)
	if len(selected) != 2 {
		t.Fatalf("selected len = %d, want 2", len(selected))
	}
	if selected[0].ID != "insight-2" || selected[1].ID != "raw-7" {
		t.Fatalf("selected IDs = [%s %s], want [insight-2 raw-7]", selected[0].ID, selected[1].ID)
	}
}
