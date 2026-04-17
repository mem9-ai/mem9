package service

import (
	"errors"
	"testing"

	dto "github.com/prometheus/client_model/go"
	"github.com/qiffang/mnemos/server/internal/metrics"
)

func TestObserveRecallEmbeddingRequestUsesSuccessStatus(t *testing.T) {
	resetRecallEmbeddingMetrics()

	observeRecallEmbeddingRequest(nil, nil)

	if got := recallEmbeddingCounterValue(t, "unknown", "success"); got != 1 {
		t.Fatalf("success counter = %v, want 1", got)
	}
}

func TestObserveRecallAutoEmbeddingRequestUsesAutoModel(t *testing.T) {
	resetRecallEmbeddingMetrics()

	observeRecallAutoEmbeddingRequest("tidbcloud_free/amazon/titan-embed-text-v2", nil)

	if got := recallEmbeddingCounterValue(t, "tidbcloud_free/amazon/titan-embed-text-v2", "success"); got != 1 {
		t.Fatalf("auto-model success counter = %v, want 1", got)
	}
}

func TestObserveRecallAutoEmbeddingRequestTracksErrors(t *testing.T) {
	resetRecallEmbeddingMetrics()

	observeRecallAutoEmbeddingRequest("tidbcloud_free/amazon/titan-embed-text-v2", errors.New("boom"))

	if got := recallEmbeddingCounterValue(t, "tidbcloud_free/amazon/titan-embed-text-v2", "error"); got != 1 {
		t.Fatalf("auto-model error counter = %v, want 1", got)
	}
}

func resetRecallEmbeddingMetrics() {
	metrics.EmbeddingRequestsTotal.Reset()
}

func recallEmbeddingCounterValue(t *testing.T, model, status string) float64 {
	t.Helper()

	metric, err := metrics.EmbeddingRequestsTotal.GetMetricWithLabelValues("recall", "query_embedding", model, status)
	if err != nil {
		t.Fatalf("get embedding metric %s %s: %v", model, status, err)
	}

	var pb dto.Metric
	if err := metric.Write(&pb); err != nil {
		t.Fatalf("write embedding metric %s %s: %v", model, status, err)
	}
	if pb.Counter == nil {
		return 0
	}
	return pb.Counter.GetValue()
}
