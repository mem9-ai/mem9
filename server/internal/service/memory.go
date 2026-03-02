package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
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
	embedder *embed.Embedder // nil = keyword-only mode
}

func NewMemoryService(memories repository.MemoryRepo, embedder *embed.Embedder) *MemoryService {
	return &MemoryService{memories: memories, embedder: embedder}
}

// Create stores a new memory. If keyName is provided and already exists, it upserts
// atomically via INSERT ... ON DUPLICATE KEY UPDATE to avoid race conditions.
func (s *MemoryService) Create(ctx context.Context, spaceID, agentName, content, keyName string, tags []string, metadata json.RawMessage) (*domain.Memory, error) {
	if err := validateMemoryInput(content, keyName, tags); err != nil {
		return nil, err
	}

	// Generate embedding if provider is configured.
	var embedding []float32
	if s.embedder != nil {
		var err error
		embedding, err = s.embedder.Embed(ctx, content)
		if err != nil {
			return nil, err
		}
	}

	now := time.Now()
	m := &domain.Memory{
		ID:        uuid.New().String(),
		SpaceID:   spaceID,
		Content:   content,
		KeyName:   keyName,
		Source:    agentName,
		Tags:      tags,
		Metadata:  metadata,
		Embedding: embedding,
		Version:   1,
		UpdatedBy: agentName,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if keyName != "" {
		// Atomic upsert: INSERT ... ON DUPLICATE KEY UPDATE.
		if err := s.memories.Upsert(ctx, m); err != nil {
			return nil, err
		}
		// Re-read to get the actual state (version may have been incremented by ON DUPLICATE KEY).
		existing, err := s.memories.GetByKey(ctx, spaceID, keyName)
		if err != nil {
			return m, nil
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
// If an embedder is configured and a query is provided, performs hybrid search.
func (s *MemoryService) Search(ctx context.Context, spaceID string, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	// Hybrid search: embedder configured + query provided
	if s.embedder != nil && filter.Query != "" {
		return s.hybridSearch(ctx, spaceID, filter)
	}
	// Keyword-only search
	return s.memories.List(ctx, spaceID, filter)
}

// hybridSearch performs vector + keyword search, merges and ranks results.
func (s *MemoryService) hybridSearch(ctx context.Context, spaceID string, filter domain.MemoryFilter) ([]domain.Memory, int, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	fetchLimit := limit * 3

	// Embed the query.
	queryVec, err := s.embedder.Embed(ctx, filter.Query)
	if err != nil {
		// Fall back to keyword-only if embedding fails.
		slog.Warn("embedding failed, falling back to keyword search", "err", err)
		return s.memories.List(ctx, spaceID, filter)
	}

	// Vector search (ANN).
	vecResults, err := s.memories.VectorSearch(ctx, spaceID, queryVec, filter, fetchLimit)
	if err != nil {
		slog.Warn("vector search failed, falling back to keyword search", "err", err)
		return s.memories.List(ctx, spaceID, filter)
	}

	// Keyword search.
	kwResults, err := s.memories.KeywordSearch(ctx, spaceID, filter.Query, filter, fetchLimit)
	if err != nil {
		return nil, 0, err
	}

	// Merge by ID — vector score takes priority.
	type scored struct {
		mem   domain.Memory
		score float64
	}
	byID := make(map[string]*scored, len(vecResults)+len(kwResults))

	for _, m := range vecResults {
		s := 0.0
		if m.Score != nil {
			s = *m.Score
		}
		byID[m.ID] = &scored{mem: m, score: s}
	}
	for _, m := range kwResults {
		if _, exists := byID[m.ID]; !exists {
			neutralScore := 0.5
			m.Score = &neutralScore
			byID[m.ID] = &scored{mem: m, score: neutralScore}
		}
	}

	// Sort by score descending.
	merged := make([]scored, 0, len(byID))
	for _, s := range byID {
		merged = append(merged, *s)
	}
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].score > merged[j].score
	})

	total := len(merged)

	// Paginate after merge.
	if offset >= len(merged) {
		return []domain.Memory{}, total, nil
	}
	end := offset + limit
	if end > len(merged) {
		end = len(merged)
	}
	page := merged[offset:end]

	result := make([]domain.Memory, len(page))
	for i, s := range page {
		result[i] = s.mem
	}
	return result, total, nil
}

// Update modifies an existing memory with LWW conflict resolution.
func (s *MemoryService) Update(ctx context.Context, spaceID, agentName, id, content string, tags []string, metadata json.RawMessage, ifMatch int) (*domain.Memory, error) {
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
	}

	contentChanged := false
	if content != "" {
		if len(content) > maxContentLen {
			return nil, &domain.ValidationError{Field: "content", Message: "too long (max 50000)"}
		}
		current.Content = content
		contentChanged = true
	}
	if tags != nil {
		if len(tags) > maxTags {
			return nil, &domain.ValidationError{Field: "tags", Message: "too many (max 20)"}
		}
		current.Tags = tags
	}
	if metadata != nil {
		current.Metadata = metadata
	}
	current.UpdatedBy = agentName

	// Re-generate embedding only if content changed and embedder exists.
	if contentChanged && s.embedder != nil {
		embedding, err := s.embedder.Embed(ctx, current.Content)
		if err != nil {
			return nil, err
		}
		current.Embedding = embedding
	}

	if err := s.memories.UpdateOptimistic(ctx, current, 0); err != nil {
		return nil, err
	}

	updated, err := s.memories.GetByID(ctx, spaceID, id)
	if err != nil {
		current.Version++
		return current, nil
	}
	return updated, nil
}

// Delete removes a memory.
func (s *MemoryService) Delete(ctx context.Context, spaceID, id string) error {
	return s.memories.Delete(ctx, spaceID, id)
}

// BulkCreate creates multiple memories at once.
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

		var embedding []float32
		if s.embedder != nil {
			var err error
			embedding, err = s.embedder.Embed(ctx, item.Content)
			if err != nil {
				return nil, err
			}
		}

		memories = append(memories, &domain.Memory{
			ID:        uuid.New().String(),
			SpaceID:   spaceID,
			Content:   item.Content,
			KeyName:   item.Key,
			Source:    agentName,
			Tags:      item.Tags,
			Metadata:  item.Metadata,
			Embedding: embedding,
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
	Content  string          `json:"content"`
	Key      string          `json:"key,omitempty"`
	Tags     []string        `json:"tags,omitempty"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
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
