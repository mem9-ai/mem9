package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/llm"
)

type memoryRepoMock struct {
	mu                   sync.Mutex
	createCalls          []*domain.Memory
	getByID              map[string]*domain.Memory
	getByIDErr           error
	updateOptimisticErr  error
	setStateCalls        []setStateCall  // track SetState invocations
	setStateErr          error           // configurable return value for SetState
	vectorResults        []domain.Memory // configurable results for AutoVectorSearch
	vectorErr            error           // configurable error for AutoVectorSearch / VectorSearch
	listResults          []domain.Memory // configurable results for List
	ftsResults           []domain.Memory // configurable results for FTSSearch
	ftsErr               error           // configurable error for FTSSearch
	kwResults            []domain.Memory // configurable results for KeywordSearch
	kwErr                error           // configurable error for KeywordSearch
	ftsAvail             bool            // configurable FTSAvailable() return
	lastVectorFilter     domain.MemoryFilter
	lastAutoVectorFilter domain.MemoryFilter
	lastKeywordFilter    domain.MemoryFilter
	lastFTSFilter        domain.MemoryFilter
	autoVectorSearchHook func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	keywordSearchHook    func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	ftsSearchHook        func(context.Context, string, domain.MemoryFilter, int) ([]domain.Memory, error)
	bulkSoftDeleteCalls  [][]string
	bulkSoftDeleteAgent  string
	bulkSoftDeleteResult int64
	bulkSoftDeleteErr    error
	contentHashResults   map[string]domain.Memory
	entityLinks          map[string][]domain.MemoryEntity
	entityBoosts         map[string]float64
}

type setStateCall struct {
	ID    string
	State domain.MemoryState
}

func (m *memoryRepoMock) Create(ctx context.Context, mem *domain.Memory) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.createCalls = append(m.createCalls, mem)
	return nil
}

func (m *memoryRepoMock) GetByID(ctx context.Context, id string) (*domain.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.getByIDErr != nil {
		return nil, m.getByIDErr
	}
	if mem, ok := m.getByID[id]; ok {
		cp := *mem
		return &cp, nil
	}
	for _, mem := range m.createCalls {
		if mem.ID == id {
			cp := *mem
			return &cp, nil
		}
	}
	return nil, domain.ErrNotFound
}

func TestExtractFactsReturnsTags(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22\n\nAssistant: Got it.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(facts))
	}
	if facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected text %q, got %q", "Uses Go 1.22", facts[0].Text)
	}
	if len(facts[0].Tags) != 1 || facts[0].Tags[0] != "tech" {
		t.Fatalf("expected tags [tech], got %v", facts[0].Tags)
	}
}

func TestNormalizeTemporalFacts_ResolvesNextMonthAgainstTimestamp(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[1:14 pm on 25 May, 2023] My kids are so excited about summer break! We're thinking about going camping next month."},
		{Role: "assistant", Content: "That sounds fun."},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "Melanie is planning to go camping next month", Tags: []string{"event", "timeline"}},
	})
	if len(got) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(got))
	}
	if got[0].Text != "Melanie is planning to go camping in June 2023" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "Melanie is planning to go camping in June 2023")
	}
}

func TestNormalizeTemporalFacts_ResolvesLastYearAgainstTimestamp(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[1:56 pm on 8 May, 2023] I painted a sunrise last year."},
		{Role: "assistant", Content: "Nice work."},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "Melanie painted a sunrise last year", Tags: []string{"event", "timeline"}},
	})
	if got[0].Text != "Melanie painted a sunrise in 2022" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "Melanie painted a sunrise in 2022")
	}
}

func TestNormalizeTemporalFacts_ResolvesLastWeekToAnchoredPeriod(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[10:37 am on 27 June, 2023] I took my family camping in the mountains last week - it was a really nice time together!"},
		{Role: "assistant", Content: "Sounds relaxing."},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "Melanie went camping in the mountains last week", Tags: []string{"event", "timeline"}},
	})
	if got[0].Text != "Melanie went camping in the mountains the week before 27 June 2023" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "Melanie went camping in the mountains the week before 27 June 2023")
	}
}

func TestNormalizeTemporalFacts_UsesCurrentDateForChineseRelativeDayWithoutTimestamp(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.April, 11, 9, 30, 0, 0, time.Local)
	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "今天我很开心。"},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFactsAt(input, []ExtractedFact{
		{Text: "今天我很开心", Tags: []string{"personal"}},
	}, now)
	if got[0].Text != "今天我很开心" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "今天我很开心")
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "2026-04-11" || got[0].Temporal.AnchorSource != temporalAnchorSourceNow {
		t.Fatalf("temporal metadata = %+v, want display 2026-04-11 from now", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_UsesTimestampForChineseRelativeDay(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.May, 1, 8, 0, 0, 0, time.Local)
	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[8:00 am on 11 April, 2026] 今天我很开心。"},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFactsAt(input, []ExtractedFact{
		{Text: "今天我很开心", Tags: []string{"personal"}},
	}, now)
	if got[0].Text != "2026年4月11日我很开心" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "2026年4月11日我很开心")
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "2026-04-11" || got[0].Temporal.AnchorSource != temporalAnchorSourceHeader {
		t.Fatalf("temporal metadata = %+v, want display 2026-04-11 from header", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_StoresChineseRawFallbackInTemporalMetadata(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.April, 11, 9, 30, 0, 0, time.Local)
	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "下个月要去旅游。"},
	}, maxExtractionConversationRunes)

	got := normalizeRawFallbackFactsAt(input, []ExtractedFact{
		{Text: "下个月要去旅游", FactType: factTypeRawFallback, Tags: []string{rawFallbackTag}},
	}, now)
	if got[0].Text != "下个月要去旅游" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "下个月要去旅游")
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "2026-05" || got[0].Temporal.AnchorSource != temporalAnchorSourceNow {
		t.Fatalf("temporal metadata = %+v, want display 2026-05 from now", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_LeavesRawFallbackUntouched(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[1:14 pm on 25 May, 2023] We're thinking about going camping next month."},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "We're thinking about going camping next month.", FactType: factTypeRawFallback, Tags: []string{rawFallbackTag}},
	})
	if got[0].Text != "We're thinking about going camping next month." {
		t.Fatalf("raw fallback fact should remain unchanged, got %q", got[0].Text)
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "2023-06" || got[0].Temporal.AnchorSource != temporalAnchorSourceHeader {
		t.Fatalf("temporal metadata = %+v, want display 2023-06 from header", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_LeavesExplicitAbsoluteDatesUntouched(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "James plans to call Samantha on 11 August 2022."},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "James plans to call Samantha on 11 August 2022", Tags: []string{"event", "timeline"}},
	})
	if got[0].Text != "James plans to call Samantha on 11 August 2022" {
		t.Fatalf("normalized fact = %q, want unchanged", got[0].Text)
	}
	if got[0].Temporal != nil {
		t.Fatalf("expected no temporal metadata, got %+v", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_ResolvesChineseLocalAnchorWithoutInventingYear(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "小明4月23日的前一天打了网球。"},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "小明4月23日的前一天打了网球", Tags: []string{"event", "timeline"}},
	})
	if got[0].Text != "小明4月22日打了网球" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "小明4月22日打了网球")
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "4月22日" || got[0].Temporal.AnchorSource != temporalAnchorSourceLocal {
		t.Fatalf("temporal metadata = %+v, want display 4月22日 from local anchor", got[0].Temporal)
	}
}

func TestNormalizeTemporalFacts_ResolvesChineseHeaderAnchoredMonthNaturally(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[1:14 pm on 25 May, 2023] 我下个月要去旅游。"},
	}, maxExtractionConversationRunes)

	got := normalizeTemporalFacts(input, []ExtractedFact{
		{Text: "我下个月要去旅游", Tags: []string{"event", "timeline"}},
	})
	if got[0].Text != "我2023年6月要去旅游" {
		t.Fatalf("normalized fact = %q, want %q", got[0].Text, "我2023年6月要去旅游")
	}
	if got[0].Temporal == nil || got[0].Temporal.Display != "2023-06" || got[0].Temporal.AnchorSource != temporalAnchorSourceHeader {
		t.Fatalf("temporal metadata = %+v, want display 2023-06 from header", got[0].Temporal)
	}
}

func TestNormalizeStandaloneTemporalContent_PureDeicticUsesMetadataOnly(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.April, 11, 9, 30, 0, 0, time.Local)
	text, meta := NormalizeStandaloneTemporalContent("今天我很开心", now)
	if text != "今天我很开心" {
		t.Fatalf("normalized text = %q, want unchanged", text)
	}
	if meta == nil || meta.Display != "2026-04-11" || meta.AnchorSource != temporalAnchorSourceNow {
		t.Fatalf("temporal metadata = %+v, want display 2026-04-11 from now", meta)
	}
}

func TestExtractFactsTagsOmitted(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [{"text": "Uses Go 1.22"}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22\n\nAssistant: Got it.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(facts))
	}
	if facts[0].Tags != nil {
		t.Fatalf("expected nil tags, got %v", facts[0].Tags)
	}
}

func TestExtractPhase1FactTagsPopulated(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}], "message_tags": [["tech"], ["answer"]]}`
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "I use Go 1.22"},
		{Role: "assistant", Content: "Got it."},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(result.Facts))
	}
	if len(result.Facts[0].Tags) != 1 || result.Facts[0].Tags[0] != "tech" {
		t.Fatalf("expected fact tags [tech], got %v", result.Facts[0].Tags)
	}
	if len(result.MessageTags) != 2 {
		t.Fatalf("expected 2 message tag entries, got %d", len(result.MessageTags))
	}
	if len(result.MessageTags[0]) != 1 || result.MessageTags[0][0] != "tech" {
		t.Fatalf("expected message_tags[0] = [tech], got %v", result.MessageTags[0])
	}
}

func TestExtractPhase1AuditsLowDensityFacts(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	calls := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		call := calls
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		resp := `{"memory":[{"text":"Alice likes jazz"},{"text":"Bob visited Kyoto in 2024"}]}`
		if call == 2 {
			resp = `{"memory":[{"text":"Alice adopted a cat named Nori"},{"text":"Bob owns a signed basketball"},{"text":"Alice likes jazz"}]}`
		}
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	messages := []IngestMessage{
		{Role: "user", Content: "Alice likes jazz."},
		{Role: "assistant", Content: "Bob visited Kyoto in 2024."},
		{Role: "user", Content: "Alice adopted a cat named Nori."},
		{Role: "assistant", Content: "Bob owns a signed basketball."},
		{Role: "user", Content: "Alice started a pottery class."},
		{Role: "assistant", Content: "Bob recommended Little Women."},
		{Role: "user", Content: "Alice moved to Portland."},
		{Role: "assistant", Content: "Bob plans a March hiking trip."},
		{Role: "user", Content: "Alice prefers oat milk."},
		{Role: "assistant", Content: "Bob plays violin."},
	}
	result, err := svc.ExtractPhase1(context.Background(), messages)
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}

	mu.Lock()
	gotCalls := calls
	mu.Unlock()
	if gotCalls != 2 {
		t.Fatalf("expected first-pass extraction plus audit call, got %d calls", gotCalls)
	}
	if len(result.Facts) != 4 {
		t.Fatalf("expected 4 deduped facts after audit, got %d: %+v", len(result.Facts), result.Facts)
	}
	texts := map[string]bool{}
	for _, fact := range result.Facts {
		texts[fact.Text] = true
	}
	for _, want := range []string{"Alice likes jazz", "Bob visited Kyoto in 2024", "Alice adopted a cat named Nori", "Bob owns a signed basketball"} {
		if !texts[want] {
			t.Fatalf("expected audited fact %q in %+v", want, result.Facts)
		}
	}
}

func TestExtractPhase1AnnotatesSourceSeqs(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := `{"facts": [{"text": "Jon lost his job, which motivated him to start his own dance studio", "tags": ["work", "dance"]}], "message_tags": [["career"], ["answer"]]}`
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "[date:1 January 2023] [speaker:Jon] I lost my job and decided to start my own dance studio.", Seq: intPtr(41)},
		{Role: "assistant", Content: "That is a big step.", Seq: intPtr(42)},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(result.Facts))
	}
	if !reflect.DeepEqual(result.Facts[0].SourceSeqs, []int{41}) {
		t.Fatalf("expected source seq [41], got %v", result.Facts[0].SourceSeqs)
	}
	if len(result.Facts[0].SourceTurns) != 1 || result.Facts[0].SourceTurns[0].Seq != 41 {
		t.Fatalf("expected source turn seq [41], got %+v", result.Facts[0].SourceTurns)
	}
}

func TestExtractPhase1AnnotatesAssistantSourceSeqs(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := `{"facts": [{"text": "Maria adopted a cat named Bailey", "tags": ["pets"], "attributed_to": "Maria"}], "message_tags": [["pets"]]}`
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "assistant", Content: "[date:1 January 2023] [speaker:Maria] I adopted a cat named Bailey.", Seq: intPtr(42)},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(result.Facts))
	}
	if !reflect.DeepEqual(result.Facts[0].SourceSeqs, []int{42}) {
		t.Fatalf("expected assistant source seq [42], got %v", result.Facts[0].SourceSeqs)
	}
	if len(result.Facts[0].SourceTurns) != 1 || result.Facts[0].SourceTurns[0].Seq != 42 {
		t.Fatalf("expected assistant source turn seq [42], got %+v", result.Facts[0].SourceTurns)
	}
}

func TestAnnotateFactsWithSourceSeqsFallsBackToSingleAssistantMessage(t *testing.T) {
	t.Parallel()

	input := prepareExtractionInput([]IngestMessage{
		{Role: "assistant", Content: "[date:1 January 2023] [speaker:Maria] I took the overnight train to Porto.", Seq: intPtr(77)},
	}, maxExtractionConversationRunes)

	facts := annotateFactsWithSourceSeqs(input, []ExtractedFact{{
		Text: "Maria prefers slow travel for memorable trips",
		Tags: []string{"travel"},
	}})
	if len(facts) != 1 {
		t.Fatalf("expected 1 fact, got %d", len(facts))
	}
	if !reflect.DeepEqual(facts[0].SourceSeqs, []int{77}) {
		t.Fatalf("expected fallback source seq [77], got %v", facts[0].SourceSeqs)
	}
	if len(facts[0].SourceTurns) != 1 || facts[0].SourceTurns[0].Seq != 77 {
		t.Fatalf("expected fallback source turn seq [77], got %+v", facts[0].SourceTurns)
	}
}

func TestReconcilePhase2PersistsSourceSeqMetadata(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{Text: "Jon lost his job, which motivated him to start a dance studio", Tags: []string{"work"}, SourceSeqs: []int{4, 2, 4}},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 created memory, got %d", len(memRepo.createCalls))
	}
	var metadata struct {
		SourceSeqs  []int                `json:"source_seqs"`
		SourceTurns []sourceTurnMetadata `json:"source_turns"`
	}
	if err := json.Unmarshal(memRepo.createCalls[0].Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if !reflect.DeepEqual(metadata.SourceSeqs, []int{2, 4}) {
		t.Fatalf("source_seqs = %v, want [2 4]", metadata.SourceSeqs)
	}
	if len(metadata.SourceTurns) != 0 {
		t.Fatalf("source_turns should be empty when facts did not provide turn payloads, got %+v", metadata.SourceTurns)
	}
}

func TestReconcilePhase2AddPersistsSourceTurnMetadata(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{
			Text:       "Jon lost his job, which motivated him to start a dance studio",
			Tags:       []string{"work"},
			SourceSeqs: []int{4, 2, 4},
			SourceTurns: []sourceTurnMetadata{
				{Seq: 4, Content: "[date:1 January 2023] [speaker:Jon] I lost my job and decided to start a dance studio."},
				{Seq: 2, Content: "[date:1 January 2023] [speaker:Gina] You should open your own studio."},
			},
		},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 created memory, got %d", len(memRepo.createCalls))
	}
	var metadata struct {
		SourceSeqs  []int                `json:"source_seqs"`
		SourceTurns []sourceTurnMetadata `json:"source_turns"`
	}
	if err := json.Unmarshal(memRepo.createCalls[0].Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if !reflect.DeepEqual(metadata.SourceSeqs, []int{2, 4}) {
		t.Fatalf("source_seqs = %v, want [2 4]", metadata.SourceSeqs)
	}
	if len(metadata.SourceTurns) != 2 || metadata.SourceTurns[0].Seq != 2 || metadata.SourceTurns[1].Seq != 4 {
		t.Fatalf("source_turns = %+v, want seqs [2 4]", metadata.SourceTurns)
	}
}

func TestExtractFactsParsesMem0AdditiveOutput(t *testing.T) {
	t.Parallel()

	var body string
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory":[{"text":"Assistant recommended pgvector for semantic search","tags":["tech"],"attributed_to":"assistant","linked_memory_ids":["mem-1"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		kwResults: []domain.Memory{{ID: "mem-1", Content: "Uses PostgreSQL", MemoryType: domain.TypeInsight, State: domain.StateActive}},
		getByID:   map[string]*domain.Memory{"mem-1": &domain.Memory{ID: "mem-1", AgentID: "agent-1", State: domain.StateActive}},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "", ModeSmart)

	facts, err := svc.extractFactsForAgentWithContext(context.Background(), "agent-1", "Assistant: Use pgvector for semantic search.", ExtractionContext{
		ObservationDate: "1:56 pm on 8 May, 2023",
		LastMessages: []IngestMessage{
			{Role: "user", Content: "We use PostgreSQL."},
		},
		RecentlyExtractedMemories: []domain.Memory{
			{ID: "recent-1", Content: "User uses PostgreSQL", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	})
	if err != nil {
		t.Fatalf("extractFactsForAgent() error = %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 fact, got %v", facts)
	}
	if facts[0].Text != "Assistant recommended pgvector for semantic search" {
		t.Fatalf("unexpected fact text: %q", facts[0].Text)
	}
	if facts[0].AttributedTo != "assistant" {
		t.Fatalf("expected attributed_to assistant, got %q", facts[0].AttributedTo)
	}
	if len(facts[0].LinkedMemoryIDs) != 1 || facts[0].LinkedMemoryIDs[0] != "mem-1" {
		t.Fatalf("expected linked_memory_ids [mem-1], got %v", facts[0].LinkedMemoryIDs)
	}
	for _, want := range []string{
		"Summary:",
		"Last k Messages:",
		"Recently Extracted Memories:",
		"Existing Memories:",
		"New Messages:",
		"Observation Date: 2023-05-08",
		"Current Date:",
		"When in doubt, extract",
		"Casual topics are still extractable",
		"Extract from BOTH user and assistant messages",
		"Compact High-Recall Check",
		"middle and",
		"5-12 memories",
		"shared photo or",
		"short answer to a prior question",
		"concert featuring Matt Patterson",
		"recent-1",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected prompt to contain %q, got %s", want, body)
		}
	}
}

func TestExtractFactsAddsBirthdayConcertShortAnswerBridge(t *testing.T) {
	t.Parallel()

	resp := `{"facts": [], "message_tags": [["family"], ["music"], ["music"]]}`
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "assistant", Content: "[date:2:24 pm on 14 August, 2023] [speaker:Melanie] We celebrated my daughter's birthday with a concert surrounded by music.", Seq: intPtr(1)},
		{Role: "assistant", Content: "[date:2:24 pm on 14 August, 2023] [speaker:Caroline] What concert was it?", Seq: intPtr(2)},
		{Role: "assistant", Content: "[date:2:24 pm on 14 August, 2023] [speaker:Melanie] Thanks, Caroline! It was Matt Patterson, he is so talented!", Seq: intPtr(3)},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 bridged fact, got %+v", result.Facts)
	}
	got := result.Facts[0]
	if got.Text != "Melanie celebrated her daughter's birthday with a concert featuring Matt Patterson." {
		t.Fatalf("bridged fact text = %q", got.Text)
	}
	if !reflect.DeepEqual(got.SourceSeqs, []int{1, 3}) {
		t.Fatalf("source seqs = %v, want [1 3]", got.SourceSeqs)
	}
}

func TestAdditiveExtractionObservationDateFallsBackToMessageDateTag(t *testing.T) {
	t.Parallel()

	var body string
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory":[{"text":"Alice visited the museum last week"}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "", ModeSmart)

	_, err := svc.extractFactsForAgent(context.Background(), "agent-1", "User: [date:1:56 pm on 8 May, 2023] [speaker:Alice] I visited the museum last week.")
	if err != nil {
		t.Fatalf("extractFactsForAgent() error = %v", err)
	}
	if !strings.Contains(body, "Observation Date: 2023-05-08") {
		t.Fatalf("expected observation date from message date tag, got %s", body)
	}
}

func TestReconcilePhase2AddOnlyNeverUpdatesOrDeletes(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{{ID: "old", Content: "Prefers light mode", MemoryType: domain.TypeInsight, State: domain.StateActive}},
		setStateErr:   fmt.Errorf("delete should not be called"),
	}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	result, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{Text: "Prefers dark mode", Tags: []string{"preference"}},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if result.MemoriesChanged != 1 || len(memRepo.createCalls) != 1 {
		t.Fatalf("expected one ADD, result=%+v createCalls=%d", result, len(memRepo.createCalls))
	}
	if len(memRepo.setStateCalls) != 0 {
		t.Fatalf("expected no automatic deletes, got %v", memRepo.setStateCalls)
	}
}

func TestReconcilePhase2SkipsExistingDuplicateHash(t *testing.T) {
	t.Parallel()

	text := "Prefers dark mode"
	hash := memoryContentHash(text)
	memRepo := &memoryRepoMock{
		contentHashResults: map[string]domain.Memory{
			hash: {ID: "existing", Content: text, AgentID: "agent-1", ContentHash: hash, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	result, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{{Text: text}})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if result.MemoriesChanged != 0 || len(memRepo.createCalls) != 0 {
		t.Fatalf("expected existing hash duplicate skipped, result=%+v createCalls=%d", result, len(memRepo.createCalls))
	}
}

func TestReconcilePhase2SkipsSameBatchDuplicateHash(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	result, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{Text: "Prefers dark mode", Tags: []string{"preference"}},
		{Text: "Prefers dark mode", Tags: []string{"preference"}},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if result.MemoriesChanged != 1 || len(memRepo.createCalls) != 1 {
		t.Fatalf("expected one create after same-batch duplicate skip, result=%+v createCalls=%d", result, len(memRepo.createCalls))
	}
}

func TestExtractPhase1AssistantOnlyRecommendationCanBecomeMemory(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory":[{"text":"Assistant recommended using pgvector for semantic search","tags":["tech"]}],"message_tags":[["tech"]]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{{Role: "assistant", Content: "Use pgvector for semantic search."}})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 || result.Facts[0].Text != "Assistant recommended using pgvector for semantic search" {
		t.Fatalf("expected assistant-only recommendation fact, got %+v", result.Facts)
	}
}

func TestReconcilePhase2FiltersUnknownLinkedMemoryIDs(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		getByID: map[string]*domain.Memory{
			"valid":       {ID: "valid", AgentID: "agent-1", State: domain.StateActive},
			"other-agent": {ID: "other-agent", AgentID: "agent-2", State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	_, err := svc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{Text: "Uses pgvector", LinkedMemoryIDs: []string{"valid", "missing", "other-agent"}},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected one create, got %d", len(memRepo.createCalls))
	}
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal(memRepo.createCalls[0].Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal: %v", err)
	}
	var linked []string
	if err := json.Unmarshal(metadata[linkedMemoryIDsMetadataKey], &linked); err != nil {
		t.Fatalf("linked ids unmarshal: %v", err)
	}
	if len(linked) != 1 || linked[0] != "valid" {
		t.Fatalf("expected only valid linked id retained, got %v", linked)
	}
}

func TestEntityLinksCreatedAndRecallBoostApplied(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		kwResults: []domain.Memory{
			{ID: "m1", Content: "General running shoes", MemoryType: domain.TypeInsight, State: domain.StateActive},
			{ID: "m2", Content: `Definitely "Under Armour" right now.`, MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	ingestSvc := NewIngestService(memRepo, nil, nil, "", ModeSmart)
	_, err := ingestSvc.ReconcilePhase2(context.Background(), "agent-1", "agent-1", "sess-1", []ExtractedFact{
		{Text: `Assistant recommended "Under Armour" shoes`, Tags: []string{"recommendation"}},
	})
	if err != nil {
		t.Fatalf("ReconcilePhase2() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected one created memory, got %d", len(memRepo.createCalls))
	}
	createdID := memRepo.createCalls[0].ID
	if len(memRepo.entityLinks[createdID]) == 0 {
		t.Fatalf("expected entity links for created memory")
	}
	createdMemory := *memRepo.createCalls[0]
	memRepo.kwResults = []domain.Memory{
		{ID: "m1", Content: "General running shoes", MemoryType: domain.TypeInsight, State: domain.StateActive},
		createdMemory,
	}

	memSvc := NewMemoryService(memRepo, nil, nil, "", ModeSmart)
	candidates, err := memSvc.SearchCandidates(context.Background(), domain.MemoryFilter{Query: "Under Armour", AgentID: "agent-1", Limit: 2}, RecallSourceInsight, RecallCandidateOptions{})
	if err != nil {
		t.Fatalf("SearchCandidates() error = %v", err)
	}
	if len(candidates) < 2 {
		t.Fatalf("expected at least 2 candidates, got %d", len(candidates))
	}
	if candidates[0].Memory.ID != createdID {
		t.Fatalf("expected entity-linked candidate boosted to top, got order %s, %s", candidates[0].Memory.ID, candidates[1].Memory.ID)
	}
	if candidates[0].EntityBoost <= 0 {
		t.Fatalf("expected entity boost on top candidate, got %+v", candidates[0])
	}
}

func TestSetSourceSeqMetadataClearsStaleSourceSeqs(t *testing.T) {
	t.Parallel()

	metadata := SetSourceSeqMetadata(json.RawMessage(`{"source_seqs":[1,2],"temporal":{"display":"2023"}}`), nil)
	var decoded map[string]any
	if err := json.Unmarshal(metadata, &decoded); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if _, ok := decoded["source_seqs"]; ok {
		t.Fatalf("source_seqs should be removed from metadata: %s", metadata)
	}
	if _, ok := decoded["temporal"]; !ok {
		t.Fatalf("temporal metadata should be preserved: %s", metadata)
	}
}

func TestExtractFactsSingleMessageUsesLLMExtraction(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 LLM call for single-message extraction, got %d", callCount)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 extracted fact, got %d", len(facts))
	}
	if facts[0].FactType != "" || facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected normal extracted fact, got %+v", facts[0])
	}
	if len(facts[0].Tags) != 1 || facts[0].Tags[0] != "tech" {
		t.Fatalf("expected tags [tech], got %v", facts[0].Tags)
	}
}

func TestExtractPhase1SingleMessageUsesLLMExtraction(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}], "message_tags": [["tech"]]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "I use Go 1.22"},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 LLM call for single-message extraction, got %d", callCount)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 extracted fact, got %v", result.Facts)
	}
	if result.Facts[0].FactType != "" || result.Facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected normal extracted fact, got %+v", result.Facts[0])
	}
	if len(result.MessageTags) != 1 || len(result.MessageTags[0]) != 1 || result.MessageTags[0][0] != "tech" {
		t.Fatalf("expected message_tags[0] = [tech], got %v", result.MessageTags)
	}
}

func TestExtractFactsEmptyAdditiveResultStaysEmpty(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": []}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22\n\nAssistant: Noted.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 0 {
		t.Fatalf("expected no facts after empty additive extraction, got %v", facts)
	}
}

func TestExtractFactsSingleMessageEmptyAdditiveResultStaysEmpty(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": []}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 LLM call for single-message extraction, got %d", callCount)
	}
	if len(facts) != 0 {
		t.Fatalf("expected no facts after empty additive extraction, got %v", facts)
	}
}

func TestExtractPhase1SingleMessageEmptyAdditiveResultStaysEmpty(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [], "message_tags": [["tech"]]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "I use Go 1.22"},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 LLM call for single-message extraction, got %d", callCount)
	}
	if len(result.Facts) != 0 {
		t.Fatalf("expected no facts after empty additive extraction, got %v", result.Facts)
	}
	if len(result.MessageTags) != 1 || len(result.MessageTags[0]) != 1 || result.MessageTags[0][0] != "tech" {
		t.Fatalf("expected message_tags[0] = [tech], got %v", result.MessageTags)
	}
}

func TestExtractFactsRetryFallbackDropsFlattenedQueryIntent(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")

		resp := `{"facts":[`
		if callCount == 2 {
			resp = `{"facts":":[{","text":"User searched for how to configure nginx","tags":["tech"],"fact_type":"query_intent"}`
		}

		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: how do I configure nginx?\n\nAssistant: Let me check.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 LLM calls, got %d", callCount)
	}
	if len(facts) != 0 {
		t.Fatalf("expected query_intent-only additive extraction to stay empty, got %v", facts)
	}
}

func TestExtractFactsAndTagsRetryFallbackDropsFlattenedQueryIntent(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")

		resp := `{"facts":[`
		if callCount == 2 {
			resp = `{"facts":":[{","text":"User searched for how to configure nginx","tags":["tech"],"fact_type":"query_intent","message_tags":[["question"],["answer"]]}`
		}

		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, messageTags, err := svc.extractFactsAndTags(context.Background(), "User: how do I configure nginx?\n\nAssistant: Let me check.", 2)
	if err != nil {
		t.Fatalf("extractFactsAndTags() error = %v", err)
	}
	if callCount != 2 {
		t.Fatalf("expected 2 LLM calls, got %d", callCount)
	}
	if len(facts) != 0 {
		t.Fatalf("expected query_intent-only additive extraction to stay empty, got %v", facts)
	}
	if len(messageTags) != 2 {
		t.Fatalf("expected 2 message_tags entries, got %d", len(messageTags))
	}
	if len(messageTags[0]) != 1 || messageTags[0][0] != "question" {
		t.Fatalf("expected message_tags[0] = [question], got %v", messageTags[0])
	}
	if len(messageTags[1]) != 1 || messageTags[1][0] != "answer" {
		t.Fatalf("expected message_tags[1] = [answer], got %v", messageTags[1])
	}
}

func TestColdStartAddAllFactsSetsTags(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		resp := `{"facts": [{"text": "Works at company Y", "tags": ["work"]}]}`
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-cold",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I work at company Y"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "work" {
		t.Fatalf("expected tags [work], got %v", got)
	}
}

func TestReconcileAddSetsTagsOnMemory(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`
		} else {
			resp = `{"memory": [{"id": "new", "text": "Uses Go 1.22", "event": "ADD", "tags": ["tech", "work"]}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-add",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "tech" {
		t.Fatalf("expected extraction tags [tech], got %v", got)
	}
}

func TestReconcileUpdateSetsTagsOnMemory(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Works at company Y", "tags": ["work"]}]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X", "tags": ["work"]}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "mem-startup", Content: "Works at startup X", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-update",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I now work at company Y"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call (via ArchiveAndCreate), got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "work" {
		t.Fatalf("expected tags [work], got %v", got)
	}
}

func TestReconcileUpdateTagsOmitted(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Works at company Y", "tags": ["work"]}]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "mem-startup", Content: "Works at startup X", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-update-notags",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I now work at company Y"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings, got %d", res.Warnings)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "work" {
		t.Fatalf("expected extraction tags [work], got %v", got)
	}
}

func TestReconcileTagsOmittedGracefully(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Uses Go 1.22"}]}`
		} else {
			resp = `{"memory": [{"id": "new", "text": "Uses Go 1.22", "event": "ADD"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-notags",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings, got %d", res.Warnings)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	if memRepo.createCalls[0].Tags != nil {
		t.Fatalf("expected nil tags, got %v", memRepo.createCalls[0].Tags)
	}
}

func TestReconcileTagsClamped(t *testing.T) {
	t.Parallel()

	manyTags := make([]string, 25)
	for i := range manyTags {
		manyTags[i] = fmt.Sprintf("tag%d", i)
	}
	manyTagsJSON, _ := json.Marshal(manyTags)

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = fmt.Sprintf(`{"facts": [{"text": "Uses Go 1.22", "tags": %s}]}`, string(manyTagsJSON))
		} else {
			resp = fmt.Sprintf(`{"memory": [{"id": "new", "text": "Uses Go 1.22", "event": "ADD", "tags": %s}]}`, string(manyTagsJSON))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-clamp",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	if len(memRepo.createCalls[0].Tags) != maxTags {
		t.Fatalf("expected tags clamped to %d, got %d", maxTags, len(memRepo.createCalls[0].Tags))
	}
}

func TestReconcilePinnedFallbackCarriesTags(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "Uses Go 1.22", "event": "UPDATE", "old_memory": "Uses Python", "tags": ["tech"]}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "pinned-1", Content: "Uses Python", MemoryType: domain.TypePinned, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-pinned",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call (pinned fallback ADD), got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "tech" {
		t.Fatalf("expected tags [tech], got %v", got)
	}
}

func TestReconcileAddPreservesRawFallbackTag(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory": [{"id": "new", "text": "I use Go 1.22", "event": "ADD", "tags": ["tech"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-raw-fallback-tag",
		AgentID:   "agent-1",
		Messages:  []IngestMessage{{Role: "user", Content: "I use Go 1.22"}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 additive extraction LLM call, got %d", callCount)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "tech" {
		t.Fatalf("expected additive extraction tags [tech], got %v", got)
	}
}

func (m *memoryRepoMock) UpdateOptimistic(ctx context.Context, mem *domain.Memory, expectedVersion int) error {
	return m.updateOptimisticErr
}

func (m *memoryRepoMock) SoftDelete(ctx context.Context, id, agentName string) error {
	return nil
}

func (m *memoryRepoMock) BulkSoftDelete(ctx context.Context, ids []string, agentName string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bulkSoftDeleteCalls = append(m.bulkSoftDeleteCalls, append([]string(nil), ids...))
	m.bulkSoftDeleteAgent = agentName
	if m.bulkSoftDeleteErr != nil {
		return 0, m.bulkSoftDeleteErr
	}
	return m.bulkSoftDeleteResult, nil
}

func (m *memoryRepoMock) ArchiveMemory(ctx context.Context, id, supersededBy string) error {
	return nil
}

func (m *memoryRepoMock) ArchiveAndCreate(ctx context.Context, archiveID, supersededBy string, newMem *domain.Memory) error {
	m.createCalls = append(m.createCalls, newMem)
	return nil
}

func (m *memoryRepoMock) SetState(ctx context.Context, id string, state domain.MemoryState) error {
	m.setStateCalls = append(m.setStateCalls, setStateCall{ID: id, State: state})
	return m.setStateErr
}

func (m *memoryRepoMock) List(ctx context.Context, f domain.MemoryFilter) ([]domain.Memory, int, error) {
	if m.listResults != nil {
		return m.listResults, len(m.listResults), nil
	}
	return nil, 0, nil
}

func (m *memoryRepoMock) Count(ctx context.Context) (int, error) {
	return 0, nil
}

func (m *memoryRepoMock) BulkCreate(ctx context.Context, memories []*domain.Memory) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.createCalls = append(m.createCalls, memories...)
	return nil
}

func (m *memoryRepoMock) ListByContentHashes(ctx context.Context, agentID string, hashes []string) (map[string]domain.Memory, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]domain.Memory)
	for _, hash := range hashes {
		if m.contentHashResults != nil {
			if mem, ok := m.contentHashResults[hash]; ok {
				out[hash] = mem
				continue
			}
		}
		for _, mem := range m.createCalls {
			if mem.ContentHash != hash || mem.State != domain.StateActive {
				continue
			}
			if agentID != "" && mem.AgentID != agentID {
				continue
			}
			out[hash] = *mem
			break
		}
	}
	return out, nil
}

func (m *memoryRepoMock) ReplaceMemoryEntities(ctx context.Context, agentID, memoryID string, entities []domain.MemoryEntity) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entityLinks == nil {
		m.entityLinks = map[string][]domain.MemoryEntity{}
	}
	cp := append([]domain.MemoryEntity(nil), entities...)
	m.entityLinks[memoryID] = cp
	return nil
}

func (m *memoryRepoMock) DeleteMemoryEntities(ctx context.Context, memoryID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entityLinks, memoryID)
	return nil
}

func (m *memoryRepoMock) EntityMemoryBoosts(ctx context.Context, agentID string, entityKeys []string, limit int) (map[string]float64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entityBoosts != nil {
		out := make(map[string]float64, len(m.entityBoosts))
		for id, boost := range m.entityBoosts {
			out[id] = boost
		}
		return out, nil
	}
	out := map[string]float64{}
	keySet := make(map[string]struct{}, len(entityKeys))
	for _, key := range entityKeys {
		keySet[key] = struct{}{}
	}
	for memoryID, entities := range m.entityLinks {
		var matches int
		for _, entity := range entities {
			if _, ok := keySet[entity.Key]; ok {
				matches++
			}
		}
		if matches > 0 {
			out[memoryID] = float64(matches) / float64(max(1, len(entityKeys)))
		}
	}
	return out, nil
}

func (m *memoryRepoMock) VectorSearch(ctx context.Context, queryVec []float32, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.mu.Lock()
	m.lastVectorFilter = f
	vectorErr := m.vectorErr
	vectorResults := m.vectorResults
	m.mu.Unlock()
	if vectorErr != nil {
		return nil, vectorErr
	}
	if vectorResults != nil {
		return vectorResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) AutoVectorSearch(ctx context.Context, queryText string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.mu.Lock()
	m.lastAutoVectorFilter = f
	hook := m.autoVectorSearchHook
	vectorErr := m.vectorErr
	vectorResults := m.vectorResults
	m.mu.Unlock()
	if hook != nil {
		return hook(ctx, queryText, f, limit)
	}
	if vectorErr != nil {
		return nil, vectorErr
	}
	if vectorResults != nil {
		return vectorResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) KeywordSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.mu.Lock()
	m.lastKeywordFilter = f
	hook := m.keywordSearchHook
	kwErr := m.kwErr
	kwResults := m.kwResults
	m.mu.Unlock()
	if hook != nil {
		return hook(ctx, query, f, limit)
	}
	if kwErr != nil {
		return nil, kwErr
	}
	if kwResults != nil {
		return kwResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) FTSSearch(ctx context.Context, query string, f domain.MemoryFilter, limit int) ([]domain.Memory, error) {
	m.mu.Lock()
	m.lastFTSFilter = f
	hook := m.ftsSearchHook
	ftsErr := m.ftsErr
	ftsResults := m.ftsResults
	m.mu.Unlock()
	if hook != nil {
		return hook(ctx, query, f, limit)
	}
	if ftsErr != nil {
		return nil, ftsErr
	}
	if ftsResults != nil {
		return ftsResults, nil
	}
	return nil, nil
}

func (m *memoryRepoMock) FTSAvailable() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.ftsAvail
}

func (m *memoryRepoMock) ListBootstrap(ctx context.Context, limit int) ([]domain.Memory, error) {
	return nil, nil
}

func (m *memoryRepoMock) NearDupSearch(_ context.Context, _ string) (string, float64, error) {
	return "", 0, nil
}

func TestDropQueryIntentFacts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input []ExtractedFact
		want  []ExtractedFact
	}{
		{
			name:  "empty input",
			input: []ExtractedFact{},
			want:  []ExtractedFact{},
		},
		{
			name: "all facts kept when no query_intent",
			input: []ExtractedFact{
				{Text: "Uses Go for backend", Tags: []string{"tech"}},
				{Text: "Works at Acme Corp", Tags: []string{"work"}},
			},
			want: []ExtractedFact{
				{Text: "Uses Go for backend", Tags: []string{"tech"}},
				{Text: "Works at Acme Corp", Tags: []string{"work"}},
			},
		},
		{
			name: "query_intent facts dropped",
			input: []ExtractedFact{
				{Text: "Uses nginx as reverse proxy", Tags: []string{"tech"}, FactType: "fact"},
				{Text: "User asked about the Ming dynasty", FactType: "query_intent"},
				{Text: "User searched for nginx config", FactType: "query_intent"},
			},
			want: []ExtractedFact{
				{Text: "Uses nginx as reverse proxy", Tags: []string{"tech"}, FactType: "fact"},
			},
		},
		{
			name: "omitted fact_type kept (safe default)",
			input: []ExtractedFact{
				{Text: "Lives in Shanghai"},
			},
			want: []ExtractedFact{
				{Text: "Lives in Shanghai"},
			},
		},
		{
			name: "case-insensitive query_intent match",
			input: []ExtractedFact{
				{Text: "keep me", FactType: "fact"},
				{Text: "drop me", FactType: "QUERY_INTENT"},
				{Text: "also drop", FactType: "Query_Intent"},
			},
			want: []ExtractedFact{
				{Text: "keep me", FactType: "fact"},
			},
		},
		{
			name: "all query_intent returns empty",
			input: []ExtractedFact{
				{Text: "User asked about X", FactType: "query_intent"},
				{Text: "User searched for Y", FactType: "query_intent"},
			},
			want: []ExtractedFact{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := dropQueryIntentFacts(tc.input)
			if got == nil {
				got = []ExtractedFact{}
			}
			if len(got) != len(tc.want) {
				t.Fatalf("len=%d want=%d", len(got), len(tc.want))
			}
			for i := range got {
				if got[i].Text != tc.want[i].Text {
					t.Errorf("[%d] text=%q want=%q", i, got[i].Text, tc.want[i].Text)
				}
			}
		})
	}
}

func (m *memoryRepoMock) CountStats(ctx context.Context) (int64, int64, error) { return 0, 0, nil }

func TestStripInjectedContext(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    []IngestMessage
		expected []IngestMessage
	}{
		{
			name: "removes relevant memories tag",
			input: []IngestMessage{{
				Role:    "user",
				Content: "keep <relevant-memories>remove</relevant-memories> text",
			}},
			expected: []IngestMessage{{Role: "user", Content: "keep  text"}},
		},
		{
			name: "handles no tags",
			input: []IngestMessage{{
				Role:    "assistant",
				Content: "no tags here",
			}},
			expected: []IngestMessage{{Role: "assistant", Content: "no tags here"}},
		},
		{
			name: "handles malformed tag",
			input: []IngestMessage{{
				Role:    "user",
				Content: "keep <relevant-memories>broken",
			}},
			expected: []IngestMessage{{Role: "user", Content: "keep"}},
		},
		{
			name: "drops empty content",
			input: []IngestMessage{{
				Role:    "system",
				Content: "<relevant-memories>only</relevant-memories>",
			}},
			expected: []IngestMessage{},
		},
		{
			name: "handles multiple tags",
			input: []IngestMessage{{
				Role:    "user",
				Content: "a<relevant-memories>x</relevant-memories>b<relevant-memories>y</relevant-memories>c",
			}},
			expected: []IngestMessage{{Role: "user", Content: "abc"}},
		},
		{
			name: "preserves explicit seq",
			input: []IngestMessage{{
				Role:    "user",
				Content: "keep <relevant-memories>drop</relevant-memories> text",
				Seq:     intPtr(9),
			}},
			expected: []IngestMessage{{Role: "user", Content: "keep  text", Seq: intPtr(9)}},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := stripInjectedContext(tt.input)
			if len(got) != len(tt.expected) {
				t.Fatalf("stripInjectedContext() len = %d, expected %d; got %#v", len(got), len(tt.expected), got)
			}
			for i := range got {
				if !reflect.DeepEqual(got[i], tt.expected[i]) {
					t.Fatalf("stripInjectedContext()[%d] = %#v, expected %#v", i, got[i], tt.expected[i])
				}
			}
		})
	}
}

func TestStripMemoryTags(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "single tag",
			input:    "a<relevant-memories>b</relevant-memories>c",
			expected: "ac",
		},
		{
			name:     "multiple tags",
			input:    "a<relevant-memories>b</relevant-memories>c<relevant-memories>d</relevant-memories>e",
			expected: "ace",
		},
		{
			name:     "malformed tag",
			input:    "prefix<relevant-memories>broken",
			expected: "prefix",
		},
		{
			name:     "nested tags",
			input:    "a<relevant-memories>one<relevant-memories>two</relevant-memories>three</relevant-memories>b",
			expected: "athree</relevant-memories>b",
		},
		{
			name:     "no tags",
			input:    "plain text",
			expected: "plain text",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := stripMemoryTags(tt.input)
			if got != tt.expected {
				t.Fatalf("stripMemoryTags() = %q, expected %q", got, tt.expected)
			}
		})
	}
}

func TestFormatConversation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    []IngestMessage
		expected string
	}{
		{
			name: "formats role content pairs",
			input: []IngestMessage{{
				Role:    "user",
				Content: "hi",
			}, {
				Role:    "assistant",
				Content: "hello",
			}},
			expected: "User: hi\n\nAssistant: hello",
		},
		{
			name:     "handles empty messages",
			input:    nil,
			expected: "",
		},
		{
			name: "capitalizes first letter only",
			input: []IngestMessage{{
				Role:    "uSER",
				Content: "case",
			}},
			expected: "USER: case",
		},
		{
			name: "trims trailing whitespace",
			input: []IngestMessage{{
				Role:    "user",
				Content: "trail",
			}},
			expected: "User: trail",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := formatConversation(tt.input)
			if got != tt.expected {
				t.Fatalf("formatConversation() = %q, expected %q", got, tt.expected)
			}
		})
	}
}

func TestParseIntID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{name: "valid integer", input: "42", expected: 42},
		{name: "negative integer", input: "-7", expected: -7},
		{name: "invalid string", input: "abc", expected: -1},
		{name: "empty string", input: "", expected: -1},
		{name: "trailing text", input: "12x", expected: -1},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseIntID(tt.input)
			if got != tt.expected {
				t.Fatalf("parseIntID() = %d, expected %d", got, tt.expected)
			}
		})
	}
}

func TestIngestEmptyMessages(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{})
	if err == nil {
		t.Fatalf("expected validation error")
	}
	var vErr *domain.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if vErr.Field != "messages" {
		t.Fatalf("expected field 'messages', got %q", vErr.Field)
	}
}

func TestIngestModeRawStoresInsight(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	req := IngestRequest{
		Mode:      ModeRaw,
		SessionID: "session-1",
		AgentID:   "agent-1",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "hello",
		}, {
			Role:    "assistant",
			Content: "world",
		}},
	}

	res, err := svc.Ingest(context.Background(), "agent-1", req)
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}

	created := memRepo.createCalls[0]
	expectedContent := "User: hello\n\nAssistant: world"
	if created.Content != expectedContent {
		t.Fatalf("unexpected content: %q", created.Content)
	}
	if created.MemoryType != domain.TypeInsight {
		t.Fatalf("expected memory type insight, got %q", created.MemoryType)
	}
}

func TestIngestNilLLMFallsBackToRaw(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	req := IngestRequest{
		Mode:      ModeSmart,
		SessionID: "session-2",
		AgentID:   "agent-2",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "hello",
		}},
	}

	res, err := svc.Ingest(context.Background(), "agent-2", req)
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}
	if got := memRepo.createCalls[0].Content; got != "User: hello" {
		t.Fatalf("unexpected content: %q", got)
	}
}

func TestIngestRawStripsInjectedContextWithoutLLM(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{}
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-3", IngestRequest{
		Mode:    ModeSmart,
		AgentID: "agent-3",
		Messages: []IngestMessage{{
			Role:    "user",
			Content: "<relevant-memories>remove this</relevant-memories>keep this",
		}},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil || res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 insight added, got %#v", res)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}
	if got := memRepo.createCalls[0].Content; got != "User: keep this" {
		t.Fatalf("unexpected sanitized content: %q", got)
	}
}

func TestIngestStripsInjectedContextAcrossModes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		mode               IngestMode
		withLLM            bool
		wantCreatedContent string
		wantLLMCalls       int
	}{
		{name: "raw mode without llm", mode: ModeRaw, withLLM: false, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "smart mode without llm", mode: ModeSmart, withLLM: false, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "raw mode with llm", mode: ModeRaw, withLLM: true, wantCreatedContent: "User: keep this", wantLLMCalls: 0},
		{name: "smart mode with llm", mode: ModeSmart, withLLM: true, wantCreatedContent: "keep this", wantLLMCalls: 1},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			memRepo := &memoryRepoMock{}
			if tt.withLLM && tt.mode == ModeSmart {
				memRepo.vectorResults = []domain.Memory{{ID: "mem-1", Content: "existing", MemoryType: domain.TypeInsight, State: domain.StateActive}}
			}
			var llmClient *llm.Client
			llmBodies := make([]string, 0, 2)
			var mu sync.Mutex
			callCount := 0

			if tt.withLLM {
				mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					body, _ := io.ReadAll(r.Body)
					mu.Lock()
					llmBodies = append(llmBodies, string(body))
					callCount++
					currentCall := callCount
					mu.Unlock()

					resp := `{"facts": [{"text": "keep this"}]}`
					if currentCall == tt.wantLLMCalls {
						resp = `{"memory": [{"id": "new", "text": "keep this", "event": "ADD"}]}`
					}
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]any{
						"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
					})
				}))
				defer mockLLM.Close()

				llmClient = llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
			}

			svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)
			res, err := svc.Ingest(context.Background(), "agent-strip", IngestRequest{
				Mode:    tt.mode,
				AgentID: "agent-strip",
				Messages: []IngestMessage{{
					Role:    "user",
					Content: "<relevant-memories>drop this</relevant-memories>keep this",
				}},
			})
			if err != nil {
				t.Fatalf("Ingest() error = %v", err)
			}
			if res == nil || res.MemoriesChanged != 1 {
				t.Fatalf("expected 1 insight added, got %#v", res)
			}
			if len(memRepo.createCalls) != 1 {
				t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
			}

			created := memRepo.createCalls[0]
			if created.Content != tt.wantCreatedContent {
				t.Fatalf("unexpected content: %q", created.Content)
			}
			if strings.Contains(created.Content, "<relevant-memories>") {
				t.Fatalf("injected context leaked into stored content: %q", created.Content)
			}

			if callCount != tt.wantLLMCalls {
				t.Fatalf("unexpected llm call count: got %d want %d", callCount, tt.wantLLMCalls)
			}
			for _, reqBody := range llmBodies {
				if strings.Contains(reqBody, "<relevant-memories>") {
					t.Fatalf("injected context leaked into llm request: %s", reqBody)
				}
			}
		})
	}
}

// TestReconcileDoesNotAutoDelete verifies ADD-only reconcile never deletes
// existing memories during ingest.
func TestReconcileDoesNotAutoDelete(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory": [{"text": "user prefers dark mode", "tags": ["preference"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	memRepo := &memoryRepoMock{
		setStateErr: domain.ErrNotFound,
		vectorResults: []domain.Memory{
			{ID: "mem-123", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-1",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted, dark mode preference saved."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	// ErrNotFound from SetState should NOT count as a warning.
	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings, got %d", res.Warnings)
	}

	if callCount != 1 {
		t.Fatalf("expected 1 additive extraction call, got %d", callCount)
	}
	if len(memRepo.setStateCalls) != 0 {
		t.Fatalf("expected no SetState calls in ADD-only ingest, got %d", len(memRepo.setStateCalls))
	}
}

func TestReconcileNeverSurfacesDeleteErrors(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory": [{"text": "user prefers dark mode", "tags": ["preference"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	memRepo := &memoryRepoMock{
		setStateErr: fmt.Errorf("database connection lost"),
		vectorResults: []domain.Memory{
			{ID: "mem-456", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-2",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings because ADD-only ingest never deletes, got %d", res.Warnings)
	}
	if len(memRepo.setStateCalls) != 0 {
		t.Fatalf("expected no SetState calls in ADD-only ingest, got %d", len(memRepo.setStateCalls))
	}
}

func TestIngestInvalidModeReturnsValidationError(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:     IngestMode("unknown"),
		Messages: []IngestMessage{{Role: "user", Content: "hello"}},
	})
	if err == nil {
		t.Fatal("expected validation error for invalid mode")
	}
	var vErr *domain.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected ValidationError, got %T: %v", err, err)
	}
	if vErr.Field != "mode" {
		t.Fatalf("expected field 'mode', got %q", vErr.Field)
	}
}

func TestTruncateRunes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		max      int
		expected string
	}{
		{name: "short ASCII", input: "hello", max: 10, expected: "hello"},
		{name: "exact ASCII", input: "hello", max: 5, expected: "hello"},
		{name: "truncate ASCII", input: "hello world", max: 5, expected: "hello..."},
		{name: "multibyte no truncate", input: "caf\u00e9", max: 4, expected: "caf\u00e9"},
		{name: "multibyte truncate", input: "caf\u00e9 latt\u00e9", max: 4, expected: "caf\u00e9..."},
		{name: "emoji content", input: "hello\U0001F600world", max: 7, expected: "hello\U0001F600w..."},
		{name: "empty string", input: "", max: 5, expected: ""},
		{name: "zero max", input: "hello", max: 0, expected: "..."},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := truncateRunes(tt.input, tt.max)
			if got != tt.expected {
				t.Fatalf("truncateRunes(%q, %d) = %q, expected %q", tt.input, tt.max, got, tt.expected)
			}
		})
	}
}

// TestAddOnlyExtractionWritesWithoutSecondReconcile verifies smart ingest now
// persists extraction output directly without a second reconcile LLM call.
func TestAddOnlyExtractionWritesWithoutSecondReconcile(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"memory": [{"text": "user prefers dark mode", "tags": ["preference"]}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{
		APIKey:  "test-key",
		BaseURL: mockLLM.URL,
		Model:   "test-model",
	})

	// Repo has existing memories so reconcile path is taken (not addAllFacts bypass).
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "mem-existing", Content: "user prefers light mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-fallback",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	if res.MemoriesChanged != 1 {
		t.Fatalf("expected 1 memory changed, got %d", res.MemoriesChanged)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 Create call, got %d", len(memRepo.createCalls))
	}
	if callCount != 1 {
		t.Fatalf("expected 1 LLM call, got %d", callCount)
	}
	if res.Warnings != 0 {
		t.Fatalf("expected 0 warnings, got %d", res.Warnings)
	}
}

// TestGatherExistingMemoriesFiltersLowScoreVectorResults verifies that vector
// search results with scores below the minimum threshold are excluded from the
// gathered memories, preventing low-relevance candidates from wasting LLM context.
func TestGatherExistingMemoriesFiltersLowScoreVectorResults(t *testing.T) {
	t.Parallel()

	// Pin scores close to the 0.3 boundary to catch accidental threshold changes.
	highScore := 0.31
	lowScore := 0.29

	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "high-relevance", Content: "relevant memory", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
			{ID: "low-relevance", Content: "unrelated memory", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &lowScore},
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// Only the high-score result should be included.
	if len(result) != 1 {
		t.Fatalf("expected 1 memory (filtered by threshold), got %d", len(result))
	}
	if result[0].ID != "high-relevance" {
		t.Fatalf("expected high-relevance memory, got %s", result[0].ID)
	}
}

// TestGatherExistingMemoriesFTSOnlyMode verifies that when no embedder and no
// autoModel are configured but FTS is available, gatherExistingMemories runs
// per-fact FTS search instead of falling back to List().
func TestGatherExistingMemoriesFTSOnlyMode(t *testing.T) {
	t.Parallel()

	memRepo := &memoryRepoMock{
		ftsAvail: true,
		ftsResults: []domain.Memory{
			{ID: "fts-1", Content: "user likes Go", MemoryType: domain.TypeInsight, State: domain.StateActive},
			{ID: "fts-2", Content: "user uses TiDB", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	// No embedder, no autoModel — FTS-only deployment.
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"Go programming", "TiDB database"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// FTS results should appear (2 unique memories, returned for both facts but deduped).
	if len(result) != 2 {
		t.Fatalf("expected 2 memories from FTS-only mode, got %d", len(result))
	}
	// Verify both FTS results are present.
	ids := map[string]bool{}
	for _, m := range result {
		ids[m.ID] = true
	}
	if !ids["fts-1"] || !ids["fts-2"] {
		t.Fatalf("expected fts-1 and fts-2, got %v", ids)
	}
}

// TestGatherExistingMemoriesHybridDedup verifies that overlapping vector and
// FTS results are deduplicated (same ID appears only once).
func TestGatherExistingMemoriesHybridDedup(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	memRepo := &memoryRepoMock{
		ftsAvail: true,
		vectorResults: []domain.Memory{
			{ID: "shared-1", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
			{ID: "vec-only", Content: "user is a backend engineer", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
		},
		ftsResults: []domain.Memory{
			{ID: "shared-1", Content: "user prefers dark mode", MemoryType: domain.TypeInsight, State: domain.StateActive},
			{ID: "fts-only", Content: "uses Go 1.22", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"dark mode preference"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	// shared-1 should appear once (deduped), vec-only and fts-only each once = 3 total.
	if len(result) != 3 {
		t.Fatalf("expected 3 deduplicated memories, got %d", len(result))
	}
	ids := map[string]bool{}
	for _, m := range result {
		ids[m.ID] = true
	}
	if !ids["shared-1"] || !ids["vec-only"] || !ids["fts-only"] {
		t.Fatalf("expected shared-1, vec-only, fts-only; got %v", ids)
	}
}

func TestGatherExistingMemoriesParallelMergeKeepsFactOrder(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	memRepo := &memoryRepoMock{
		ftsAvail: true,
		autoVectorSearchHook: func(_ context.Context, query string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if query == "fact-1" {
				time.Sleep(25 * time.Millisecond)
				return []domain.Memory{{ID: "vec-1", Content: "vector one", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore}}, nil
			}
			return []domain.Memory{{ID: "vec-2", Content: "vector two", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore}}, nil
		},
		ftsSearchHook: func(_ context.Context, query string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			if query == "fact-1" {
				time.Sleep(25 * time.Millisecond)
				return []domain.Memory{{ID: "fts-1", Content: "fts one", MemoryType: domain.TypeInsight, State: domain.StateActive}}, nil
			}
			return []domain.Memory{{ID: "fts-2", Content: "fts two", MemoryType: domain.TypeInsight, State: domain.StateActive}}, nil
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"fact-1", "fact-2"})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}

	if len(result) != 4 {
		t.Fatalf("expected 4 memories, got %d", len(result))
	}
	gotIDs := []string{result[0].ID, result[1].ID, result[2].ID, result[3].ID}
	wantIDs := []string{"vec-1", "fts-1", "vec-2", "fts-2"}
	if strings.Join(gotIDs, ",") != strings.Join(wantIDs, ",") {
		t.Fatalf("expected stable merge order %v, got %v", wantIDs, gotIDs)
	}
}

func TestGatherExistingMemoriesSearchesFactsInParallel(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	var (
		maxConcurrent int
		current       int
		mu            sync.Mutex
	)

	memRepo := &memoryRepoMock{
		autoVectorSearchHook: func(_ context.Context, query string, _ domain.MemoryFilter, _ int) ([]domain.Memory, error) {
			mu.Lock()
			current++
			if current > maxConcurrent {
				maxConcurrent = current
			}
			mu.Unlock()

			time.Sleep(20 * time.Millisecond)

			mu.Lock()
			current--
			mu.Unlock()

			return []domain.Memory{{
				ID:         "vec-" + query,
				Content:    "vector result for " + query,
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				Score:      &highScore,
			}}, nil
		},
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{
		"fact-1",
		"fact-2",
		"fact-3",
		"fact-4",
		"fact-5",
		"fact-6",
	})
	if err != nil {
		t.Fatalf("gatherExistingMemories() error = %v", err)
	}
	if maxConcurrent <= 1 {
		t.Fatalf("expected parallel fact searches, max concurrent calls = %d", maxConcurrent)
	}
}

// TestGatherExistingMemoriesTotalOutageReturnsError verifies that when every
// single search attempt fails (total outage), gatherExistingMemories returns
// an error instead of silently returning an empty list (which would cause
// addAllFacts to create duplicate memories).
func TestGatherExistingMemoriesTotalOutageReturnsError(t *testing.T) {
	t.Parallel()

	// All search backends fail.
	memRepo := &memoryRepoMock{
		vectorErr: errors.New("connection refused"),
		kwErr:     errors.New("connection refused"),
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	_, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err == nil {
		t.Fatal("expected error on total search outage, got nil")
	}
	if !errors.Is(err, err) { // sanity check
		t.Fatalf("unexpected error type: %v", err)
	}
}

// TestGatherExistingMemoriesPartialLegFailureContinues verifies that when one
// search leg fails but the other succeeds, results from the successful leg are
// returned (no hard abort).
func TestGatherExistingMemoriesPartialLegFailureContinues(t *testing.T) {
	t.Parallel()

	highScore := 0.8
	// Vector succeeds, keyword/FTS fails.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "vec-1", Content: "from vector", MemoryType: domain.TypeInsight, State: domain.StateActive, Score: &highScore},
		},
		kwErr: errors.New("FTS temporarily unavailable"),
	}

	svc := NewIngestService(memRepo, nil, nil, "auto-model", ModeSmart)

	result, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err != nil {
		t.Fatalf("expected partial success, got error: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 memory from vector leg, got %d", len(result))
	}
	if result[0].ID != "vec-1" {
		t.Fatalf("expected vec-1, got %s", result[0].ID)
	}
}

// TestGatherExistingMemoriesFTSOnlyTotalOutage verifies the no-vector path
// also detects total outage when all keyword/FTS searches fail.
func TestGatherExistingMemoriesFTSOnlyTotalOutage(t *testing.T) {
	t.Parallel()

	// No vector configured, FTS available but all FTS searches fail.
	memRepo := &memoryRepoMock{
		ftsAvail: true,
		ftsErr:   errors.New("connection refused"),
	}

	// No embedder, no autoModel — FTS-only deployment.
	svc := NewIngestService(memRepo, nil, nil, "", ModeSmart)

	_, err := svc.gatherExistingMemories(context.Background(), "agent-1", []string{"test fact"})
	if err == nil {
		t.Fatal("expected error on FTS-only total outage, got nil")
	}
}

func TestReconcileContentRequiresLLM(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.ReconcileContent(context.Background(), "agent", "agent", "", []string{"prefers dark mode"})
	if err == nil {
		t.Fatal("expected error when llm is nil")
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "llm" {
		t.Fatalf("expected field llm, got %s", ve.Field)
	}
}

func TestReconcileContentValidatesInput(t *testing.T) {
	t.Parallel()

	svc := NewIngestService(&memoryRepoMock{}, nil, nil, "", ModeSmart)
	_, err := svc.ReconcileContent(context.Background(), "agent", "agent", "", nil)
	if err == nil {
		t.Fatal("expected validation error for empty contents")
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %T", err)
	}
	if ve.Field != "content" {
		t.Fatalf("expected field content, got %s", ve.Field)
	}
}

// TestReconcileIncludesMemoryAge verifies that the reconciliation prompt sent to
// the LLM includes the "age" field for existing memories, giving the LLM temporal
// context to resolve conflicts (e.g., stale "Lives in Beijing" vs new "Lives in Shanghai").
func TestReconcileIncludesMemoryAge(t *testing.T) {
	t.Parallel()

	var extractionBody string
	var mu sync.Mutex

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		var resp string
		if strings.Contains(bodyStr, "Existing Memories:") {
			mu.Lock()
			extractionBody = bodyStr
			mu.Unlock()
			resp = `{"memory": [{"text": "Lives in Shanghai", "tags": ["location"], "linked_memory_ids": ["mem-old"]}]}`
		} else {
			resp = `{"facts": [{"text": "Lives in Shanghai", "tags": ["location"]}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})

	// Existing memory has a non-zero UpdatedAt so age will be populated.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-old",
				Content:    "Lives in Beijing",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				UpdatedAt:  time.Now().Add(-365 * 24 * time.Hour), // ~1 year ago
			},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-age",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I moved to Shanghai last month"},
			{Role: "assistant", Content: "Got it!"},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}

	// Verify the additive extraction LLM call includes existing-memory age in the prompt body.
	mu.Lock()
	body := extractionBody
	mu.Unlock()

	if !strings.Contains(body, `"age"`) && !strings.Contains(body, `\"age\"`) {
		t.Fatalf("expected extraction prompt to contain age field, got: %s", body)
	}
	if !strings.Contains(body, "year") {
		t.Fatalf("expected age to contain 'year' for a 1-year-old memory, got: %s", body)
	}

	if len(memRepo.createCalls) == 0 {
		t.Fatal("expected ADD-only ingest to create a new memory")
	}
}

// TestReconcileOmitsAgeForZeroTimestamp verifies that when a memory has a zero
// UpdatedAt (e.g., from test fixtures without timestamps), the "age" field is
// omitted from the JSON sent to the LLM rather than showing a nonsensical value.
func TestReconcileOmitsAgeForZeroTimestamp(t *testing.T) {
	t.Parallel()

	var extractionBody string
	var mu sync.Mutex

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		var resp string
		if strings.Contains(bodyStr, "Existing Memories:") {
			mu.Lock()
			extractionBody = bodyStr
			mu.Unlock()
			resp = `{"memory": []}`
		} else {
			resp = `{"facts": [{"text": "Prefers dark mode", "tags": ["preference"]}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})

	// Zero UpdatedAt — age should be omitted.
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-notime",
				Content:    "Prefers light mode",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				// UpdatedAt is zero value
			},
		},
	}

	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-noage",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}

	mu.Lock()
	body := extractionBody
	mu.Unlock()

	// Check only the memory data section (system prompt examples contain "age").
	if idx := strings.Index(body, "Existing Memories:"); idx >= 0 {
		endIdx := strings.Index(body[idx:], "New Messages:")
		if endIdx < 0 {
			t.Fatal("could not find 'New Messages' marker in extraction body")
		}
		memorySection := body[idx : idx+endIdx]
		if strings.Contains(memorySection, "age") {
			t.Fatalf("expected no age in memory data for zero timestamp, but found it in: %s", memorySection)
		}
	} else {
		t.Fatal("could not find 'Existing Memories:' marker in extraction body")
	}
}

func TestReconcileAcceptsEmptyChangeList(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		resp := `{"memory": []}`
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-dark-mode",
				Content:    "Prefers dark mode",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
			},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	res, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-empty-changes",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I prefer dark mode"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if res == nil {
		t.Fatal("expected non-nil result")
	}
	if len(memRepo.createCalls) != 0 {
		t.Fatalf("expected no create calls for empty change list, got %d", len(memRepo.createCalls))
	}
	if len(memRepo.setStateCalls) != 0 {
		t.Fatalf("expected no delete/state calls for empty change list, got %d", len(memRepo.setStateCalls))
	}
}

func TestReconcileUpdatePreservesExistingTagsWhenLLMOmits(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Works at company Y", "tags": ["work"]}]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "Works at company Y", "event": "UPDATE", "old_memory": "Works at startup X"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "mem-startup",
				Content:    "Works at startup X",
				MemoryType: domain.TypeInsight,
				State:      domain.StateActive,
				Tags:       []string{"work", "career"},
			},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-preserve-tags",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I now work at company Y"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "work" {
		t.Fatalf("expected extraction tags [work], got %v", got)
	}
}

func TestReconcilePinnedFallbackPreservesExistingTagsWhenLLMOmits(t *testing.T) {
	t.Parallel()

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		if callCount == 1 {
			resp = `{"facts": [{"text": "Uses Go 1.22", "tags": ["tech"]}]}`
		} else {
			resp = `{"memory": [{"id": "0", "text": "Uses Go 1.22", "event": "UPDATE", "old_memory": "Uses Python"}]}`
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{
				ID:         "pinned-1",
				Content:    "Uses Python",
				MemoryType: domain.TypePinned,
				State:      domain.StateActive,
				Tags:       []string{"tech", "language"},
			},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-pinned-preserve",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call (pinned fallback ADD), got %d", len(memRepo.createCalls))
	}
	got := memRepo.createCalls[0].Tags
	if len(got) != 1 || got[0] != "tech" {
		t.Fatalf("expected extraction tags [tech], got %v", got)
	}
}

func TestExtractFactsLegacyStringArrayFallback(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": ["Uses Go 1.22", "Works remotely"]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22 and work remotely\n\nAssistant: Got it.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 2 {
		t.Fatalf("expected 2 facts from legacy format, got %d", len(facts))
	}
	if facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected facts[0].Text = %q, got %q", "Uses Go 1.22", facts[0].Text)
	}
	if facts[1].Text != "Works remotely" {
		t.Fatalf("expected facts[1].Text = %q, got %q", "Works remotely", facts[1].Text)
	}
	if facts[0].Tags != nil || facts[1].Tags != nil {
		t.Fatalf("expected nil tags from legacy format, got %v / %v", facts[0].Tags, facts[1].Tags)
	}
}

func TestExtractPhase1LegacyStringArrayFallback(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		resp := `{"facts": ["Uses Go 1.22"], "message_tags": [["tech"], ["answer"]]}`
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": resp}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "I use Go 1.22"},
		{Role: "assistant", Content: "Got it."},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 fact from legacy format, got %d", len(result.Facts))
	}
	if result.Facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected fact text %q, got %q", "Uses Go 1.22", result.Facts[0].Text)
	}
	if result.Facts[0].Tags != nil {
		t.Fatalf("expected nil tags from legacy format, got %v", result.Facts[0].Tags)
	}
	if len(result.MessageTags) != 2 || result.MessageTags[0][0] != "tech" {
		t.Fatalf("expected message_tags intact, got %v", result.MessageTags)
	}
}

func TestExtractFactsFencedLegacyStringArrayFallback(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fenced := "```json\n{\"facts\": [\"Uses Go 1.22\"]}\n```"
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": fenced}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22\n\nAssistant: Got it.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 fact from fenced legacy format, got %d", len(facts))
	}
	if facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected fact text %q, got %q", "Uses Go 1.22", facts[0].Text)
	}
	if facts[0].Tags != nil {
		t.Fatalf("expected nil tags from legacy format, got %v", facts[0].Tags)
	}
}

func TestExtractPhase1FencedLegacyStringArrayFallback(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fenced := "```json\n{\"facts\": [\"Uses Go 1.22\"], \"message_tags\": [[\"tech\"], [\"answer\"]]}\n```"
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": fenced}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "I use Go 1.22"},
		{Role: "assistant", Content: "Got it."},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 fact from fenced legacy format, got %d", len(result.Facts))
	}
	if result.Facts[0].Text != "Uses Go 1.22" {
		t.Fatalf("expected fact text %q, got %q", "Uses Go 1.22", result.Facts[0].Text)
	}
	if result.Facts[0].Tags != nil {
		t.Fatalf("expected nil tags from legacy format, got %v", result.Facts[0].Tags)
	}
	if len(result.MessageTags) != 2 || result.MessageTags[0][0] != "tech" {
		t.Fatalf("expected message_tags intact, got %v", result.MessageTags)
	}
}

func TestExtractFactsAlternativeKeyEmptyAdditiveResultStaysEmpty(t *testing.T) {
	t.Parallel()

	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": `{"facts": [{"content": "Uses Go 1.22"}]}`}},
			},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: I use Go 1.22\n\nAssistant: Got it.")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 0 {
		t.Fatalf("expected no facts for unsupported additive schema, got %v", facts)
	}
}

func makeFlattenedFactServer(raw string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]string{"content": raw}},
			},
		})
	}))
}

func TestExtractFactsFlattenedFactNoTextNoTags(t *testing.T) {
	t.Parallel()

	raw := `{"facts":":[{",": ":", "}`
	srv := makeFlattenedFactServer(raw)
	defer srv.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: hello\n\nAssistant: ok")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 || facts[0].FactType != factTypeRawFallback || facts[0].Text != "hello" {
		t.Fatalf("expected raw fallback fact for unrecoverable junk response, got %v", facts)
	}
}

func TestExtractFactsFlattenedFactTagsOnly(t *testing.T) {
	t.Parallel()

	raw := `{"facts":":[{","tags":["mnemos","api","testing"]}`
	srv := makeFlattenedFactServer(raw)
	defer srv.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: hello\n\nAssistant: ok")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 || facts[0].FactType != factTypeRawFallback || facts[0].Text != "hello" {
		t.Fatalf("expected raw fallback fact when flattened-fact has tags but no text, got %v", facts)
	}
}

func TestExtractFactsFlattenedFactWithText(t *testing.T) {
	t.Parallel()

	raw := `{"facts":":[{","text":"mnemos API smoke test round-2 uses a poll loop to wait for async memory creation","tags":["mnemos","api","testing"]}`
	srv := makeFlattenedFactServer(raw)
	defer srv.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	facts, err := svc.extractFacts(context.Background(), "User: hello\n\nAssistant: ok")
	if err != nil {
		t.Fatalf("extractFacts() error = %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 recovered fact, got %d", len(facts))
	}
	want := "mnemos API smoke test round-2 uses a poll loop to wait for async memory creation"
	if facts[0].Text != want {
		t.Fatalf("expected text %q, got %q", want, facts[0].Text)
	}
	if len(facts[0].Tags) != 3 || facts[0].Tags[0] != "mnemos" {
		t.Fatalf("expected tags [mnemos api testing], got %v", facts[0].Tags)
	}
}

func TestExtractPhase1FlattenedFactWithText(t *testing.T) {
	t.Parallel()

	raw := `{"facts":":[{","text":"mnemos API smoke test round-2 uses a poll loop to wait for async memory creation","tags":["mnemos","api","testing"]}`
	srv := makeFlattenedFactServer(raw)
	defer srv.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"})
	svc := NewIngestService(&memoryRepoMock{}, llmClient, nil, "auto-model", ModeSmart)

	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Content: "User: hello"},
		{Role: "assistant", Content: "ok"},
	})
	if err != nil {
		t.Fatalf("ExtractPhase1() error = %v", err)
	}
	if len(result.Facts) != 1 {
		t.Fatalf("expected 1 recovered fact, got %d", len(result.Facts))
	}
	want := "mnemos API smoke test round-2 uses a poll loop to wait for async memory creation"
	if result.Facts[0].Text != want {
		t.Fatalf("expected text %q, got %q", want, result.Facts[0].Text)
	}
}

func TestReconcileTagsClampedViaReconcilePath(t *testing.T) {
	t.Parallel()

	manyTags := make([]string, 25)
	for i := range manyTags {
		manyTags[i] = fmt.Sprintf("tag%d", i)
	}
	manyTagsJSON, _ := json.Marshal(manyTags)

	callCount := 0
	mockLLM := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var resp string
		resp = fmt.Sprintf(`{"memory": [{"text": "Uses Go 1.22", "tags": %s}]}`, string(manyTagsJSON))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]string{"content": resp}}},
		})
	}))
	defer mockLLM.Close()

	llmClient := llm.New(llm.Config{APIKey: "test-key", BaseURL: mockLLM.URL, Model: "test-model"})
	memRepo := &memoryRepoMock{
		vectorResults: []domain.Memory{
			{ID: "existing-1", Content: "Works remotely", MemoryType: domain.TypeInsight, State: domain.StateActive},
		},
	}
	svc := NewIngestService(memRepo, llmClient, nil, "auto-model", ModeSmart)

	_, err := svc.Ingest(context.Background(), "agent-1", IngestRequest{
		Mode:      ModeSmart,
		SessionID: "sess-clamp-reconcile",
		AgentID:   "agent-1",
		Messages: []IngestMessage{
			{Role: "user", Content: "I use Go 1.22"},
			{Role: "assistant", Content: "Noted."},
		},
	})
	if err != nil {
		t.Fatalf("Ingest() error = %v", err)
	}
	if len(memRepo.createCalls) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(memRepo.createCalls))
	}
	if len(memRepo.createCalls[0].Tags) != maxTags {
		t.Fatalf("expected extraction tags clamped to %d via ADD-only path, got %d", maxTags, len(memRepo.createCalls[0].Tags))
	}
}
