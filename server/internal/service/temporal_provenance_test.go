package service

import (
	"strings"
	"testing"
	"time"
)

func TestHistoricalISOHeadersAndSpanishRelativeDates(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct{ header, text, want string }{
		{"[session_timestamp:2021-02-10T11:30:00]", "Renovó su abono ayer.", "2021-02-09"},
		{"[date:2021-02-10]", "Renovó su abono anteayer.", "2021-02-08"},
		{"[timestamp:2021-02-10T23:30:00-03:00]", "Firma el contrato mañana.", "2021-02-11"},
		{"[session_timestamp:2021-02-10T11:30:00]", "Llegó esta mañana.", "2021-02-10"},
		{"[session_timestamp:2021-02-10T11:30:00]", "Ocurrió el martes pasado.", "2021-02-09"},
	} {
		t.Run(tt.text, func(t *testing.T) {
			input := prepareExtractionInput([]IngestMessage{{Role: "user", Content: tt.header + " " + tt.text}}, 1000)
			got := normalizeTemporalFactsAt(input, []ExtractedFact{{Text: tt.text}}, now)[0]
			if got.Text != tt.text || got.Temporal == nil || got.Temporal.Display != tt.want || got.Temporal.AnchorSource != temporalAnchorSourceHeader {
				t.Fatalf("got %+v", got)
			}
		})
	}
	for _, text := range []string{"Trabajo por la mañana.", "Viajó ayer y vuelve mañana."} {
		if got := spanishRelativeTemporalMetadata(text, now, temporalAnchorSourceNow); got != nil {
			t.Fatalf("ambiguous/non-relative text %q resolved: %+v", text, got)
		}
	}
}

func TestReconciliationKeepsSourceTimeAndRealtimeFallback(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	fact := ExtractedFact{Text: "Nora renewed her pass yesterday", SourceSeqs: []int{2}, SourceTurns: []sourceTurnMetadata{{Seq: 2, Content: "[session_timestamp:2021-02-10T11:30:00] Ayer renové mi abono."}}}
	text, meta := normalizeReconciledTemporalContentAt("Nora completed her pass renewal yesterday", []ExtractedFact{fact}, now)
	if !strings.Contains(text, "9 February 2021") || meta == nil || meta.AnchorSource != temporalAnchorSourceHeader {
		t.Fatalf("historical reconcile: %q %+v", text, meta)
	}
	fact.Temporal = &TemporalMetadata{AnchorSource: temporalAnchorSourceHeader, Display: "2021-02-09"}
	text, meta = normalizeReconciledTemporalContentAt(fact.Text, []ExtractedFact{fact}, now)
	if text != fact.Text || meta == nil || meta.Display != "2021-02-09" || meta == fact.Temporal {
		t.Fatal("unchanged fact lost or aliased its metadata")
	}
	text, meta = normalizeReconciledTemporalContentAt("今天我很开心", nil, now)
	if text != "今天我很开心" || meta == nil || meta.Display != "2026-09-28" {
		t.Fatalf("realtime fallback changed: %q %+v", text, meta)
	}
}

func TestTemporalSourcesResolveSameDayButNotConflictingDays(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	sameDay := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[session_timestamp:2021-02-10T09:00:00] Ayer renové mi abono."},
		{Role: "user", Content: "[session_timestamp:2021-02-10T11:30:00] Me dieron un recibo."},
	}, 1000)
	got := normalizeTemporalFactsAt(sameDay, []ExtractedFact{{Text: "Nora renewed her pass yesterday"}}, now)[0]
	if !strings.Contains(got.Text, "9 February 2021") {
		t.Fatalf("same-day translation: %+v", got)
	}
	conflict := prepareExtractionInput([]IngestMessage{
		{Role: "user", Content: "[session_timestamp:2021-02-10T09:00:00] Ayer renové mi abono."},
		{Role: "user", Content: "[session_timestamp:2021-06-20T09:00:00] Me dieron un recibo."},
	}, 1000)
	got = normalizeTemporalFactsAt(conflict, []ExtractedFact{{Text: "Nora renewed her pass yesterday"}}, now)[0]
	if got.Text != "Nora renewed her pass yesterday" || got.Temporal != nil {
		t.Fatalf("ambiguous history became ingest-time fact: %+v", got)
	}
	malformed := prepareExtractionInput([]IngestMessage{{Role: "user", Content: "[session_timestamp:not-a-date] Updated yesterday."}}, 1000)
	got = normalizeTemporalFactsAt(malformed, []ExtractedFact{{Text: "Updated yesterday"}}, now)[0]
	if got.Temporal != nil || got.Text != "Updated yesterday" {
		t.Fatalf("invalid history date became current time: %+v", got)
	}
	_, meta := normalizeReconciledTemporalContentAt("Updated yesterday", []ExtractedFact{
		{Text: "Updated yesterday", Temporal: &TemporalMetadata{Display: "2021-02-09"}},
		{Text: "Updated yesterday", Temporal: &TemporalMetadata{Display: "2021-06-19"}},
	}, now)
	if meta != nil {
		t.Fatal("conflicting exact facts chose an arbitrary date")
	}
}
