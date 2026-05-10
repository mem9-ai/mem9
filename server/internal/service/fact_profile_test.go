package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestMergeAdditiveMemoryMetadataAddsFactProfileV2(t *testing.T) {
	fact := ExtractedFact{
		Text:             "Melanie read Becoming Nicole after Caroline suggested it.",
		Tags:             []string{"books"},
		FactKind:         "artifact",
		AttributedTo:     "Melanie",
		Entities:         FactEntityList{{Text: "Becoming Nicole", Type: "title"}, {Text: "Caroline", Type: "person"}},
		AnswerShapes:     []string{"title", "person"},
		SourcePacketHint: true,
		LinkedMemoryIDs:  []string{"mem-1"},
	}

	metadata := mergeAdditiveMemoryMetadata(nil, fact, "hash-1", fact.LinkedMemoryIDs)

	var decoded struct {
		SchemaVersion   int          `json:"fact_schema_version"`
		Kind            string       `json:"fact_kind"`
		AttributedTo    string       `json:"attributed_to"`
		Entities        []FactEntity `json:"entities"`
		AnswerShapes    []string     `json:"answer_shapes"`
		SourcePacket    bool         `json:"source_packet_hint"`
		LinkedMemoryIDs []string     `json:"linked_memory_ids"`
		ContentHash     string       `json:"content_hash"`
	}
	if err := json.Unmarshal(metadata, &decoded); err != nil {
		t.Fatalf("metadata unmarshal: %v", err)
	}
	if decoded.SchemaVersion != 2 {
		t.Fatalf("schema version = %d, want 2", decoded.SchemaVersion)
	}
	if decoded.Kind != "artifact" || decoded.AttributedTo != "Melanie" || !decoded.SourcePacket {
		t.Fatalf("unexpected profile metadata: %+v", decoded)
	}
	if len(decoded.Entities) != 2 {
		t.Fatalf("entities = %+v, want 2", decoded.Entities)
	}
	if strings.Join(decoded.AnswerShapes, ",") != "person,title" {
		t.Fatalf("answer_shapes = %v, want [person title]", decoded.AnswerShapes)
	}
	if decoded.ContentHash != "hash-1" || len(decoded.LinkedMemoryIDs) != 1 || decoded.LinkedMemoryIDs[0] != "mem-1" {
		t.Fatalf("dedupe/link metadata = hash %q links %v", decoded.ContentHash, decoded.LinkedMemoryIDs)
	}
}

func TestMetadataFactEntitiesIncludesProfileEntities(t *testing.T) {
	metadata := mergeAdditiveMemoryMetadata(nil, ExtractedFact{
		Text:     "A generic lowercase sentence",
		Entities: FactEntityList{{Text: "Under Armour", Type: "brand"}},
	}, "hash-1", nil)

	entities := metadataFactEntities(metadata)
	if len(entities) != 1 {
		t.Fatalf("metadata entities = %+v, want 1", entities)
	}
	if entities[0].Text != "Under Armour" || entities[0].Type != "brand" {
		t.Fatalf("metadata entity = %+v", entities[0])
	}
}

func TestExpandMemoryEntityAliasesAddsSurnameAndLemma(t *testing.T) {
	entities := expandMemoryEntityAliases([]domain.MemoryEntity{
		{Text: "Matt Patterson", Type: "person"},
		{Text: "recommended books", Type: "title"},
	})
	keys := map[string]bool{}
	for _, entity := range entities {
		keys[strings.ToLower(entity.Text)] = true
	}
	for _, want := range []string{"matt patterson", "patterson", "matt", "recommend book"} {
		if !keys[want] {
			t.Fatalf("missing alias %q in %+v", want, entities)
		}
	}
}

func TestReplaceMemoryEntityLinksStoresAliases(t *testing.T) {
	repo := &memoryRepoMock{}
	replaceMemoryEntityLinks(context.Background(), repo, nil, "", "agent-1", "mem-1", "Jon opened Dance Studio Alpha.", nil)
	links := repo.entityLinks["mem-1"]
	keys := map[string]bool{}
	for _, entity := range links {
		keys[strings.ToLower(entity.Text)] = true
	}
	if !keys["dance studio alpha"] || !keys["alpha"] {
		t.Fatalf("entity aliases not stored: %+v", links)
	}
}

func TestReplaceMemoryEntityLinksStoresRelationshipEdges(t *testing.T) {
	repo := &memoryRepoMock{}
	metadata := mergeAdditiveMemoryMetadata(nil, ExtractedFact{
		Text:     "Caroline is Melanie's friend.",
		FactKind: "relationship",
		Entities: FactEntityList{
			{Text: "Caroline", Type: "person"},
			{Text: "Melanie", Type: "person"},
		},
	}, "hash-1", nil)

	replaceMemoryEntityLinks(context.Background(), repo, nil, "", "agent-1", "mem-1", "Caroline is Melanie's friend.", metadata)
	rels := repo.relationships["mem-1"]
	if len(rels) != 1 {
		t.Fatalf("expected one relationship, got %+v", rels)
	}
	if rels[0].SourceEntityKey == "" || rels[0].TargetEntityKey == "" || rels[0].SourceEntityKey == rels[0].TargetEntityKey {
		t.Fatalf("invalid relationship keys: %+v", rels[0])
	}
}

func TestApplyFactProfileScoringPromotesMatchingShapeAndEntity(t *testing.T) {
	matchingMetadata := mergeAdditiveMemoryMetadata(nil, ExtractedFact{
		Text:         "Melanie read Becoming Nicole.",
		FactKind:     "artifact",
		Entities:     FactEntityList{{Text: "Becoming Nicole", Type: "title"}},
		AnswerShapes: []string{"title"},
	}, "hash-1", nil)
	genericMetadata := mergeAdditiveMemoryMetadata(nil, ExtractedFact{
		Text:         "Melanie discussed books.",
		FactKind:     "generic",
		AnswerShapes: []string{"generic"},
	}, "hash-2", nil)

	candidates := []RecallCandidate{
		{
			Memory:    domain.Memory{ID: "generic", Content: "Melanie discussed books.", Metadata: genericMetadata},
			RRFScore:  0.020,
			RRFRank:   1,
			InKeyword: true,
		},
		{
			Memory:           domain.Memory{ID: "matching", Content: "Melanie read Becoming Nicole.", Metadata: matchingMetadata},
			RRFScore:         0.019,
			RRFRank:          2,
			InVector:         true,
			InKeyword:        true,
			VectorSimilarity: 0.80,
		},
	}

	got := applyFactProfileScoring(domain.MemoryFilter{Query: "Which book did Melanie read Becoming Nicole?", Limit: 2}, candidates)
	if got[0].Memory.ID != "matching" {
		t.Fatalf("top candidate = %s, want matching; got %+v", got[0].Memory.ID, got)
	}
	if got[0].ProfileBoost <= got[1].ProfileBoost {
		t.Fatalf("profile boost did not distinguish candidates: %+v", got)
	}
}

func TestFormatSearchMemoryWithSourceTurnsUsesSourcePacketPrefix(t *testing.T) {
	t.Setenv("MEM9_SOURCE_PACKET_V2", "1")
	got := formatSearchMemoryWithSourceTurns("Melanie read Becoming Nicole.", []sourceTurnMetadata{
		{Seq: 2, Content: "[date:12 July 2023] [speaker:Melanie] I read Becoming Nicole."},
	})
	if !strings.Contains(got, "[source-turns]\nsource: [date:12 July 2023]") {
		t.Fatalf("source packet formatting = %q", got)
	}
}
