package service

import (
	"context"
	"reflect"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSecondHopTieOrderIsStableAcrossProviderOrders(t *testing.T) {
	high, tie, low := .95, .85, .7
	for order := 0; order < 12; order++ {
		provider := []domain.Memory{{ID: "z", Score: &tie}, {ID: "a", Score: &tie}, {ID: "top", Score: &high}, {ID: "a", Score: &low}}
		if order%2 != 0 {
			for i, j := 0, len(provider)-1; i < j; i, j = i+1, j-1 {
				provider[i], provider[j] = provider[j], provider[i]
			}
		}
		repo := &memoryRepoMock{vectorResults: provider}
		svc := NewMemoryService(repo, nil, nil, "auto-model", ModeSmart)
		got := svc.secondHopAutoSearch(context.Background(), map[string]domain.Memory{"seed": {ID: "seed", Content: "seed"}}, map[string]float64{"seed": 1}, domain.MemoryFilter{}, 5, 1)
		var ids []string
		for _, m := range got {
			ids = append(ids, m.ID)
		}
		if !reflect.DeepEqual(ids, []string{"top", "a", "z"}) {
			t.Fatalf("unstable second-hop order: %v", ids)
		}
	}
}
