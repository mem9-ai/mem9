package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/llm"
)

func TestExtractionExplicitSourcesSurviveTranslation(t *testing.T) {
	var calls int
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Messages) < 2 || !strings.Contains(body.Messages[0].Content, "source_seqs") ||
			!strings.Contains(body.Messages[1].Content, "[source_seq:41]") {
			t.Error("structured source IDs were not sent in the extraction call")
		}
		text := `{"facts":[{"text":"Nora renewed her travel pass yesterday","source_seqs":[41,41,42,99,-1],"source_turns":[{"seq":41,"content":"invented source"}]}],"message_tags":[[],[]]}`
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": text}}}})
	}))
	defer mock.Close()
	client := llm.New(llm.Config{APIKey: "test", BaseURL: mock.URL, Model: "test"})
	svc := NewIngestService(&memoryRepoMock{}, client, nil, "auto-model", ModeSmart)
	original := "[session_timestamp:2021-02-10T11:30:00] Ayer renové mi abono de transporte."
	result, err := svc.ExtractPhase1(context.Background(), []IngestMessage{
		{Role: "user", Seq: intPtr(41), Content: original},
		{Role: "assistant", Seq: intPtr(42), Content: "I suggest a yearly pass."},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || len(result.Facts) != 1 {
		t.Fatalf("calls=%d facts=%+v", calls, result.Facts)
	}
	f := result.Facts[0]
	if !reflect.DeepEqual(f.SourceSeqs, []int{41}) || len(f.SourceTurns) != 1 || f.SourceTurns[0].Content != original {
		t.Fatalf("unverified model sources escaped validation: %+v", f)
	}
	if strings.Contains(f.Text, "yesterday") || !strings.Contains(f.Text, "9 February 2021") {
		t.Fatalf("historical translation lost its timestamp: %q", f.Text)
	}
}

func TestExtractionSourcesAreScopedBoundedAndVisible(t *testing.T) {
	input := prepareExtractionInputWithPolicy([]IngestMessage{
		{Role: "user", Seq: intPtr(10), Content: "First fact."},
		{Role: "assistant", Seq: intPtr(11), Content: "Second fact."},
		{Role: "system", Seq: intPtr(12), Content: "Untrusted fact source."},
		{Role: "user", Seq: intPtr(13), Content: "Duplicate one."},
		{Role: "user", Seq: intPtr(13), Content: "Duplicate two."},
	}, 1000, true)
	if got := validateExtractionSourceSeqs(input, []int{99, 12, 13, 11, 10, 10, -1}); !reflect.DeepEqual(got, []int{10, 11}) {
		t.Fatalf("allowed refs=%v", got)
	}
	truncated := prepareExtractionInput([]IngestMessage{
		{Role: "user", Seq: intPtr(1), Content: strings.Repeat("x", 100)},
		{Role: "user", Seq: intPtr(2), Content: "Not visible."},
	}, 50)
	if got := validateExtractionSourceSeqs(truncated, []int{1, 2}); !reflect.DeepEqual(got, []int{1}) {
		t.Fatalf("truncated refs=%v", got)
	}
	var many []IngestMessage
	var refs []int
	for i := 0; i < 12; i++ {
		many = append(many, IngestMessage{Role: "user", Seq: intPtr(i), Content: "A fact."})
		refs = append(refs, i)
	}
	bounded := prepareExtractionInput(many, 10000)
	if got := validateExtractionSourceSeqs(bounded, refs); len(got) != maxSourceSeqsPerFact {
		t.Fatalf("too many refs: %v", got)
	}
	legacy := prepareExtractionInput([]IngestMessage{{Role: "user", Content: "I work in Lisbon."}}, 1000)
	if legacy.formatted != "User: I work in Lisbon." || extractionSourcePrompt(legacy) != "" {
		t.Fatal("legacy unnumbered input changed")
	}
}

func TestSourceTokensKeepAccentedWordsWhole(t *testing.T) {
	tokens := sourceTokenSet("Una devolución necesita autorización")
	if _, ok := tokens["devolución"]; !ok {
		t.Fatal("accented word split")
	}
	if _, ok := tokens["devoluci"]; ok {
		t.Fatal("ASCII fragment present")
	}
	if !reflect.DeepEqual(sourceTokenSet("deploy release tomorrow"), map[string]struct{}{"deploy": {}, "release": {}, "tomorrow": {}}) {
		t.Fatal("ASCII token behavior changed")
	}
}
