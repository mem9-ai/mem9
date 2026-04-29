package service

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"strconv"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func TestBulkDelete_EmptyIDs_ReturnsValidationError(t *testing.T) {
	repo := &memoryRepoMock{}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	n, err := svc.BulkDelete(context.Background(), nil, "agent-a")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if n != 0 {
		t.Fatalf("deleted = %d, want 0", n)
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) || ve.Field != "ids" {
		t.Fatalf("expected ValidationError on ids, got %T: %v", err, err)
	}
	if len(repo.bulkSoftDeleteCalls) != 0 {
		t.Fatalf("repo must not be called on validation failure, calls=%d", len(repo.bulkSoftDeleteCalls))
	}
}

func TestBulkDelete_AllEmptyStrings_ReturnsValidationError(t *testing.T) {
	repo := &memoryRepoMock{}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	n, err := svc.BulkDelete(context.Background(), []string{"", "", ""}, "agent-a")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if n != 0 {
		t.Fatalf("deleted = %d, want 0", n)
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) || ve.Field != "ids" {
		t.Fatalf("expected ValidationError on ids, got %T: %v", err, err)
	}
	if len(repo.bulkSoftDeleteCalls) != 0 {
		t.Fatalf("repo must not be called when all ids are empty, calls=%d", len(repo.bulkSoftDeleteCalls))
	}
}

func TestBulkDelete_TooManyIDs_ReturnsValidationError(t *testing.T) {
	repo := &memoryRepoMock{}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	ids := make([]string, maxBulkDeleteSize+1)
	for i := range ids {
		ids[i] = "id-" + strconv.Itoa(i)
	}

	n, err := svc.BulkDelete(context.Background(), ids, "agent-a")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if n != 0 {
		t.Fatalf("deleted = %d, want 0", n)
	}
	var ve *domain.ValidationError
	if !errors.As(err, &ve) || ve.Field != "ids" {
		t.Fatalf("expected ValidationError on ids, got %T: %v", err, err)
	}
	if len(repo.bulkSoftDeleteCalls) != 0 {
		t.Fatalf("repo must not be called when over the cap, calls=%d", len(repo.bulkSoftDeleteCalls))
	}
}

func TestBulkDelete_DeduplicatesAndSkipsEmpty(t *testing.T) {
	repo := &memoryRepoMock{bulkSoftDeleteResult: 3}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	n, err := svc.BulkDelete(context.Background(), []string{"a", "a", "", "b", "c", "b"}, "agent-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 3 {
		t.Fatalf("deleted = %d, want 3", n)
	}
	if len(repo.bulkSoftDeleteCalls) != 1 {
		t.Fatalf("expected repo called once, got %d", len(repo.bulkSoftDeleteCalls))
	}

	got := append([]string(nil), repo.bulkSoftDeleteCalls[0]...)
	sort.Strings(got)
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("repo ids = %v, want %v", got, want)
	}
	if repo.bulkSoftDeleteAgent != "agent-a" {
		t.Fatalf("agent = %q, want agent-a", repo.bulkSoftDeleteAgent)
	}
}

func TestBulkDelete_DeletedCountFromRepoIsReturned(t *testing.T) {
	repo := &memoryRepoMock{bulkSoftDeleteResult: 2}
	svc := NewMemoryService(repo, nil, nil, "", ModeSmart)

	n, err := svc.BulkDelete(context.Background(), []string{"a", "b", "c"}, "agent-a")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 2 {
		t.Fatalf("deleted = %d, want 2 (count must come from repo, not input size)", n)
	}
}
