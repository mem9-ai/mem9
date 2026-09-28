package service

import (
	"encoding/json"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// FinalizeSearchResultsWithSessionContext reuses already-fetched neighboring
// turns. The caller gates this additive evidence policy by query language.
// Selected IDs, confidence, order and count are unchanged; source snippets share
// the same 800-rune/2400-rune caps with insight evidence. No I/O is performed.
func FinalizeSearchResultsWithSessionContext(memories []domain.Memory, candidates []RecallCandidate, query string) []domain.Memory {
	if len(memories) == 0 {
		return memories // preserve a non-nil empty slice for the JSON array contract
	}
	type turnKey struct {
		app, agent, session string
		seq                 int
	}
	byTurn := make(map[turnKey]domain.Memory)
	for _, candidate := range candidates {
		m := candidate.Memory
		seq, ok := sessionSeqFromMemory(m)
		if !ok || seq < 0 || m.MemoryType != domain.TypeSession || m.SessionID == "" || sessionContextRole(m) == "" {
			continue
		}
		key := turnKey{m.AppID, m.AgentID, m.SessionID, seq}
		if previous, exists := byTurn[key]; !exists || m.ID < previous.ID {
			byTurn[key] = m
		}
	}
	queryTokens := sourceTokenSet(query)
	for token := range queryTokens {
		if len([]rune(token)) < 4 || isSpanishContextStopword(token) {
			delete(queryTokens, token)
		}
	}
	out := append([]domain.Memory(nil), memories...)
	eligible := make(map[string]bool)
	selectedIDs := make(map[string]bool, len(memories))
	for _, m := range memories {
		selectedIDs[m.ID] = true
	}
	for i, m := range out {
		seq, ok := sessionSeqFromMemory(m)
		role := sessionContextRole(m)
		if !ok || m.MemoryType != domain.TypeSession || m.SessionID == "" || role == "" ||
			strings.Contains(m.Content, searchSourceTurnHeader) || len(m.Metadata) > maxSearchSourceMetadataBytes {
			continue
		}
		body := sessionContextBody(m.Content)
		if countTokenOverlap(queryTokens, sourceTokenSet(body)) == 0 {
			continue
		}
		var turns []sourceTurnMetadata
		for _, offset := range []int{-1, 1} {
			neighbor, exists := byTurn[turnKey{m.AppID, m.AgentID, m.SessionID, seq + offset}]
			if !exists || selectedIDs[neighbor.ID] || sessionContextRole(neighbor) == role || isTrivialSpanishContext(sessionContextBody(neighbor.Content)) {
				continue
			}
			turns = append(turns, sourceTurnMetadata{Seq: seq + offset, Role: sessionContextRole(neighbor), Content: neighbor.Content})
		}
		if len(turns) == 0 {
			continue
		}
		out[i].Metadata = SetSourceProvenanceMetadata(m.Metadata, sourceTurnSeqs(turns), turns)
		eligible[m.ID] = true
	}
	return populateRelativeAge(decorateSearchResultsWithEvidence(out, query, eligible))
}

func sessionContextRole(memory domain.Memory) string {
	if len(memory.Metadata) > maxSearchSourceMetadataBytes {
		return ""
	}
	var meta struct {
		Role string `json:"role"`
	}
	if json.Unmarshal(memory.Metadata, &meta) != nil {
		return ""
	}
	role := strings.ToLower(strings.TrimSpace(meta.Role))
	if role == "user" || role == "assistant" {
		return role
	}
	return ""
}

func sessionContextBody(content string) string {
	return strings.TrimSpace(temporalAnchorBracketRunRe.ReplaceAllString(searchSourceScoringPrefix(content), ""))
}

func isSpanishContextStopword(token string) bool {
	switch token {
	case "cuál", "cual", "cuáles", "cuales", "cómo", "como", "cuando", "cuándo", "donde", "dónde", "quien", "quién", "usuario", "usuaria", "persona", "respecto", "sobre", "para", "entre", "tiene", "menciona", "mencionó", "situación", "situaciones", "experiencias", "temas":
		return true
	}
	return false
}

func isTrivialSpanishContext(body string) bool {
	text := strings.Trim(strings.ToLower(body), " \t\n.,;:!?¡¿")
	switch text {
	case "", "hola", "gracias", "muchas gracias", "de nada", "perfecto", "ok", "vale", "dale", "sí", "si", "no", "bien":
		return true
	}
	return false
}
