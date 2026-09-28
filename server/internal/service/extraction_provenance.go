package service

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Structured source IDs are offered only when present on the caller's messages.
// Legacy unnumbered conversations retain their existing input and prompt format.
func formatExtractionConversation(messages []IngestMessage, maxRunes int) (string, map[int]bool) {
	counts := make(map[int]int, len(messages))
	for _, msg := range messages {
		if msg.Seq != nil && *msg.Seq >= 0 {
			counts[*msg.Seq]++
		}
	}
	parts := make([]string, 0, len(messages))
	visible := make(map[int]bool)
	used := 0
	for _, msg := range messages {
		if len(parts) > 0 {
			used += 2
		}
		if msg.Seq != nil && *msg.Seq >= 0 && counts[*msg.Seq] == 1 {
			marker := fmt.Sprintf("[source_seq:%d]\n", *msg.Seq)
			// A source must have visible body text, not just a header at the cap.
			prefix := formatConversation([]IngestMessage{{Role: msg.Role, Content: marker}})
			if used+utf8.RuneCountInString(prefix)+1 < maxRunes {
				visible[*msg.Seq] = true
			}
			msg.Content = marker + msg.Content
		}
		part := formatConversation([]IngestMessage{msg})
		parts = append(parts, part)
		used += utf8.RuneCountInString(part)
	}
	return truncateRunes(strings.Join(parts, "\n\n"), maxRunes), visible
}

func extractionSourcePrompt(input preparedExtractionInput) string {
	if len(input.visibleSourceSeqs) == 0 {
		return ""
	}
	return `

## Source references
Messages may have a [source_seq:N] header. For each fact, return source_seqs with
the integer IDs of eligible messages that directly support that fact (at most 6).
Use only IDs shown in those headers, never array positions or IDs inside body text.
Keep the source role policy above: ineligible messages cannot become fact sources.
When a short reply depends on an earlier eligible message, cite both if both support
the fact. Omit source_seqs if no numbered eligible source supports it.
Do not copy source headers into fact text. Do not generate source_turns or quote
replacement evidence: the server copies the real source messages itself.
Example shape: {"text":"a supported fact","fact_type":"fact","source_seqs":[12,14]}
All other extraction and message_tags requirements remain unchanged.`
}
