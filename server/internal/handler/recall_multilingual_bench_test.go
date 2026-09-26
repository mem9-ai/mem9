package handler

import (
	"testing"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func BenchmarkRecallMultilingualScoring(b *testing.B) {
	for _, tt := range []struct{ name, query, content string }{
		{"English", "What changed in the account?", "The customer updated the account billing address after moving to Madrid."},
		{"Spanish", "¿Qué cambió en la cuenta?", "El cliente actualizó la dirección de facturación después de mudarse a Madrid."},
		{"Chinese", "什么项目上线了？", "上海团队在五月上线了新的订单管理项目。"},
	} {
		b.Run(tt.name, func(b *testing.B) {
			profile := buildRecallQueryProfile(tt.query)
			candidate := service.RecallCandidate{Memory: domain.Memory{ID: "m", Content: tt.content, UpdatedAt: time.Now()}, SourcePool: service.RecallSourceSession, RRFScore: 1.0 / 61, InVector: true, VectorSimilarity: .82}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				buildRecallConfidence(profile, candidate)
			}
		})
	}
}
