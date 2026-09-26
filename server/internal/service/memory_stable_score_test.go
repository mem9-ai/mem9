package service

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestSortByScoreTiesProduceStableSeedPrefix(t *testing.T) {
	ids := []string{"z", "d", "b", "a", "c", "high"}
	scores := map[string]float64{"z": .01, "a": 1.0 / 61, "b": 1.0 / 61, "c": 1.0 / 61, "d": 1.0 / 61, "high": 2.0 / 61}
	want := []string{"high", "a", "b", "c", "d", "z"}
	for insertion := 0; insertion < len(ids); insertion++ {
		mems := make(map[string]domain.Memory, len(ids))
		for n := range ids {
			id := ids[(n+insertion)%len(ids)]
			mems[id] = domain.Memory{ID: id, Content: id}
		}
		for repeat := 0; repeat < 100; repeat++ {
			sorted := sortByScore(mems, scores)
			got := make([]string, len(sorted))
			for i, memory := range sorted {
				got[i] = memory.ID
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("unstable seed/page ordering at insertion=%d iteration=%d: got %v want %v", insertion, repeat, got, want)
			}
		}
	}
}

func BenchmarkSortByScoreTies(b *testing.B) {
	mems := make(map[string]domain.Memory, 64)
	scores := make(map[string]float64, 64)
	for i := 0; i < 64; i++ {
		id := fmt.Sprintf("memory-%03d", i)
		mems[id] = domain.Memory{ID: id}
		scores[id] = 1.0 / float64(61+i/4)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sortByScore(mems, scores)
	}
}
