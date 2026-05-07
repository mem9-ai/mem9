package service

import (
	"strings"
	"unicode"
)

var bm25IrregularLemmas = map[string]string{
	"ate":         "eat",
	"bought":      "buy",
	"brought":     "bring",
	"children":    "child",
	"did":         "do",
	"done":        "do",
	"drove":       "drive",
	"feet":        "foot",
	"felt":        "feel",
	"found":       "find",
	"gave":        "give",
	"gone":        "go",
	"had":         "have",
	"has":         "have",
	"heard":       "hear",
	"held":        "hold",
	"kept":        "keep",
	"knew":        "know",
	"known":       "know",
	"left":        "leave",
	"made":        "make",
	"men":         "man",
	"met":         "meet",
	"paid":        "pay",
	"people":      "person",
	"ran":         "run",
	"read":        "read",
	"recommended": "recommend",
	"saw":         "see",
	"seen":        "see",
	"sent":        "send",
	"spent":       "spend",
	"told":        "tell",
	"took":        "take",
	"went":        "go",
	"were":        "be",
	"was":         "be",
	"women":       "woman",
	"wrote":       "write",
}

var bm25ProtectedSuffixWords = map[string]struct{}{
	"business": {}, "class": {}, "glass": {}, "news": {}, "series": {}, "species": {},
}

// lemmatizeForBM25 mirrors mem0's keyword-search preprocessing at a lightweight
// level without adding a runtime NLP dependency. It is intentionally conservative:
// preserve token order and only normalize common English inflections that matter
// for LoCoMo-style keyword recall.
func lemmatizeForBM25(text string) string {
	if containsNonASCII(text) {
		return strings.TrimSpace(text)
	}
	tokens := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	if len(tokens) == 0 {
		return strings.TrimSpace(text)
	}
	out := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if token == "" {
			continue
		}
		out = append(out, bm25LemmaToken(token))
	}
	return strings.Join(out, " ")
}

func containsNonASCII(text string) bool {
	for _, r := range text {
		if r > unicode.MaxASCII {
			return true
		}
	}
	return false
}

func bm25LemmaToken(token string) string {
	if lemma, ok := bm25IrregularLemmas[token]; ok {
		return lemma
	}
	if _, ok := bm25ProtectedSuffixWords[token]; ok {
		return token
	}
	n := len(token)
	switch {
	case n > 5 && strings.HasSuffix(token, "ies"):
		return token[:n-3] + "y"
	case n > 5 && strings.HasSuffix(token, "ing"):
		stem := token[:n-3]
		return trimDoubledFinalConsonant(stem)
	case n > 4 && strings.HasSuffix(token, "ed"):
		stem := token[:n-2]
		if strings.HasSuffix(stem, "i") {
			return stem[:len(stem)-1] + "y"
		}
		return trimDoubledFinalConsonant(stem)
	case n > 5 && strings.HasSuffix(token, "sses"):
		return token[:n-2]
	case n > 4 && strings.HasSuffix(token, "es") && !strings.HasSuffix(token, "ses"):
		return token[:n-2]
	case n > 3 && strings.HasSuffix(token, "s") && !strings.HasSuffix(token, "ss"):
		return token[:n-1]
	default:
		return token
	}
}

func trimDoubledFinalConsonant(stem string) string {
	if len(stem) < 2 {
		return stem
	}
	last := stem[len(stem)-1]
	prev := stem[len(stem)-2]
	if last == prev && !strings.ContainsRune("aeiou", rune(last)) {
		return stem[:len(stem)-1]
	}
	return stem
}
