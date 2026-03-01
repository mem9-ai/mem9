package service

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

const (
	maxContentLen = 50000
	maxTags       = 20
	maxKeyLen     = 255
	maxBulkSize   = 100
)

type MemoryService struct {
	memories repository.MemoryRepo
}

func NewMemoryService(memories repository.MemoryRepo) *MemoryService {
	return &MemoryService{memories: memories}
}

// Create stores a new memory. If keyName is provided and already exists, it upserts
// atomically via INSERT ... ON DUPLICATE KEY UPDATE to avoid race conditions.
func (s *MemoryService) Create(ctx context.Context, spaceID, agentName, content, keyName string, tags []string) (*domain.Memory, error) {
	if err := validateMemoryInput(content, keyName, tags); err != nil {
		return nil, err
	}

	now := time.Now()
	m := &domain.Memory{
		ID:        uuid.New().String(),
		SpaceID:   spaceID,
		Content:   content,
		KeyName:   keyName,
		Source:    agentName,
		Tags:      tags,
		Version:   1,
		UpdatedBy: agentName,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if keyName != "" {
		// Atomic upsert: INSERT ... ON DUPLICATE KEY UPDATE.
		// No read-then-write race condition.
		if err := s.memories.Upsert(ctx, m); err != nil {
			return nil, err
		}
		// Re-read to get the actual state (version may have been incremented by ON DUPLICATE KEY).
		existing, err := s.memories.GetByKey(ctx, spaceID, keyName)
		if err != nil {
			return m, nil // Upsert succeeded; return best-effort result.
		}
		return existing, nil
	}

	if err := s.memories.Create(ctx, m); err != nil {
		return nil, err
	}
	return m, nil
}

// Get returns a single memory by ID.
func (s *MemoryService) Get(ctx context.Context, spaceID, id string) (*domain.Memory, error) {
	return s.memories.GetByID(ctx, spaceID, id)
}

// Search returns filtered and paginated memories.
func (s *MemoryService) Search(ctx context.Context, spaceID string, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	return s.memories.List(ctx, spaceID, filter)
}

// Update modifies an existing memory with LWW conflict resolution.
// Version is incremented atomically in SQL (SET version = version + 1).
// ifMatch=0 means no version check (direct overwrite).
func (s *MemoryService) Update(ctx context.Context, spaceID, agentName, id, content string, tags []string, ifMatch int) (*domain.Memory, error) {
	current, err := s.memories.GetByID(ctx, spaceID, id)
	if err != nil {
		return nil, err
	}

	if ifMatch > 0 && ifMatch != current.Version {
		slog.Warn("version conflict, applying LWW",
			"memory_id", id,
			"expected_version", ifMatch,
			"actual_version", current.Version,
			"agent", agentName,
		)
		// LWW: proceed with the write regardless. Version will be atomically
		// incremented in the DB. Set expectedVersion=0 to skip the WHERE check.
	}

	if content != "" {
		if len(content) > maxContentLen {
			return nil, &domain.ValidationError{Field: "content", Message: "too long (max 50000)"}
		}
		current.Content = content
	}
	if tags != nil {
		if len(tags) > maxTags {
			return nil, &domain.ValidationError{Field: "tags", Message: "too many (max 20)"}
		}
		current.Tags = tags
	}
	current.UpdatedBy = agentName

	// Atomic version increment in SQL: SET version = version + 1.
	// Pass expectedVersion=0 for LWW (no version guard).
	if err := s.memories.UpdateOptimistic(ctx, current, 0); err != nil {
		return nil, err
	}

	// Re-read to get the actual version and timestamps from DB.
	updated, err := s.memories.GetByID(ctx, spaceID, id)
	if err != nil {
		// Update succeeded; return best-effort with incremented version.
		current.Version++
		return current, nil
	}
	return updated, nil
}

// Delete removes a memory.
func (s *MemoryService) Delete(ctx context.Context, spaceID, id string) error {
	return s.memories.Delete(ctx, spaceID, id)
}

// BulkCreate creates multiple memories at once. Returns the created memories.
// Note: BulkCreate does NOT support upsert. If a key already exists, the insert will fail.
// Use single Create for upsert semantics.
func (s *MemoryService) BulkCreate(ctx context.Context, spaceID, agentName string, items []BulkMemoryInput) ([]domain.Memory, error) {
	if len(items) == 0 {
		return nil, &domain.ValidationError{Field: "memories", Message: "required"}
	}
	if len(items) > maxBulkSize {
		return nil, &domain.ValidationError{Field: "memories", Message: "too many (max 100)"}
	}

	now := time.Now()
	memories := make([]*domain.Memory, 0, len(items))
	for i, item := range items {
		if err := validateMemoryInput(item.Content, item.Key, item.Tags); err != nil {
			var ve *domain.ValidationError
			if errors.As(err, &ve) {
				ve.Field = "memories[" + strconv.Itoa(i) + "]." + ve.Field
			}
			return nil, err
		}
		memories = append(memories, &domain.Memory{
			ID:        uuid.New().String(),
			SpaceID:   spaceID,
			Content:   item.Content,
			KeyName:   item.Key,
			Source:    agentName,
			Tags:      item.Tags,
			Version:   1,
			UpdatedBy: agentName,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	if err := s.memories.BulkCreate(ctx, memories); err != nil {
		return nil, err
	}

	result := make([]domain.Memory, len(memories))
	for i, m := range memories {
		result[i] = *m
	}
	return result, nil
}

// BulkMemoryInput is the input shape for each item in a bulk create request.
type BulkMemoryInput struct {
	Content string   `json:"content"`
	Key     string   `json:"key,omitempty"`
	Tags    []string `json:"tags,omitempty"`
}

func validateMemoryInput(content, key string, tags []string) error {
	if content == "" {
		return &domain.ValidationError{Field: "content", Message: "required"}
	}
	if len(content) > maxContentLen {
		return &domain.ValidationError{Field: "content", Message: "too long (max 50000)"}
	}
	if len(key) > maxKeyLen {
		return &domain.ValidationError{Field: "key", Message: "too long (max 255)"}
	}
	if len(tags) > maxTags {
		return &domain.ValidationError{Field: "tags", Message: "too many (max 20)"}
	}
	return nil
}
