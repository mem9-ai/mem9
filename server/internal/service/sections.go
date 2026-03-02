package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type sectionDoc struct {
	Sections map[string]sectionEntry `json:"sections"`
}

type sectionEntry struct {
	Title      string `json:"title"`
	Body       string `json:"body"`
	LastAuthor string `json:"last_author"`
}

func parseSectionDoc(raw json.RawMessage) *sectionDoc {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var doc sectionDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	if len(doc.Sections) == 0 {
		return nil
	}
	return &doc
}

// MergeSectionMetadata merges two metadata blobs by section ownership.
// For each section, incoming wins if last_author == incomingAgent; existing wins otherwise.
// Returns (mergedMeta, mergedContent, true) on success, or (nil, "", false) if either
// side has no sections structure — caller should fall back to tie-break.
func MergeSectionMetadata(
	existingMeta json.RawMessage,
	incomingMeta json.RawMessage,
	incomingAgent string,
) (mergedMeta json.RawMessage, mergedContent string, ok bool) {
	existingDoc := parseSectionDoc(existingMeta)
	incomingDoc := parseSectionDoc(incomingMeta)

	if existingDoc == nil || incomingDoc == nil {
		return nil, "", false
	}

	merged := make(map[string]sectionEntry, len(existingDoc.Sections))
	for k, v := range existingDoc.Sections {
		merged[k] = v
	}
	for name, sec := range incomingDoc.Sections {
		if sec.LastAuthor == incomingAgent {
			merged[name] = sec
		}
	}
	for name, sec := range incomingDoc.Sections {
		if _, exists := merged[name]; !exists {
			merged[name] = sec
		}
	}

	var extraKeys map[string]json.RawMessage
	if err := json.Unmarshal(incomingMeta, &extraKeys); err == nil {
		delete(extraKeys, "sections")
		out := make(map[string]json.RawMessage, len(extraKeys)+2)
		for k, v := range extraKeys {
			out[k] = v
		}
		sectionsJSON, err := json.Marshal(merged)
		if err != nil {
			return nil, "", false
		}
		out["sections"] = sectionsJSON
		out["merged_by"] = json.RawMessage(fmt.Sprintf("%q", incomingAgent))
		mergedMetaBytes, err := json.Marshal(out)
		if err != nil {
			return nil, "", false
		}
		return mergedMetaBytes, RenderSectionIndex(merged), true
	}

	type fullDoc struct {
		Sections map[string]sectionEntry `json:"sections"`
		MergedBy string                  `json:"merged_by"`
	}
	mergedMetaBytes, err := json.Marshal(fullDoc{Sections: merged, MergedBy: incomingAgent})
	if err != nil {
		return nil, "", false
	}
	return mergedMetaBytes, RenderSectionIndex(merged), true
}

// RenderSectionIndex builds a compact one-line-per-section content string, e.g.:
//
//	[section-01] Section 1: Title | first line of body
func RenderSectionIndex(sections map[string]sectionEntry) string {
	names := make([]string, 0, len(sections))
	for name := range sections {
		names = append(names, name)
	}
	sort.Strings(names)

	lines := make([]string, 0, len(names))
	for _, name := range names {
		sec := sections[name]
		firstLine := sec.Body
		if idx := strings.IndexByte(firstLine, '\n'); idx >= 0 {
			firstLine = firstLine[:idx]
		}
		lines = append(lines, fmt.Sprintf("[%s] %s | %s", name, sec.Title, firstLine))
	}
	return strings.Join(lines, "\n")
}
