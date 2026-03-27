package domain

import "time"

// EventType represents a webhook event type.
type EventType string

const (
	EventTypeIngestCompleted  EventType = "memory.ingest.completed"
	EventTypeRecallPerformed  EventType = "memory.recall.performed"
	EventTypeLifecycleChanged EventType = "memory.lifecycle.changed"
)

// AllEventTypes lists all v1 event types.
var AllEventTypes = []EventType{
	EventTypeIngestCompleted,
	EventTypeRecallPerformed,
	EventTypeLifecycleChanged,
}

// Webhook represents a registered webhook endpoint.
type Webhook struct {
	ID         string      `json:"id"`
	TenantID   string      `json:"-"`
	URL        string      `json:"url"`
	Secret     string      `json:"-"` // write-only; never serialised
	EventTypes []EventType `json:"event_types"`
	CreatedAt  time.Time   `json:"created_at"`
	UpdatedAt  time.Time   `json:"updated_at"`
}

// Subscribes reports whether the webhook is subscribed to the given event type.
func (w *Webhook) Subscribes(et EventType) bool {
	for _, t := range w.EventTypes {
		if t == et {
			return true
		}
	}
	return false
}

// WebhookSubject identifies the primary subject of an event.
type WebhookSubject struct {
	Kind      string   `json:"kind"`
	IDs       []string `json:"ids"`
	PrimaryID *string  `json:"primaryId"`
}

// WebhookEvent is the envelope sent to webhook consumers.
type WebhookEvent struct {
	SchemaVersion string         `json:"schemaVersion"`
	EventID       string         `json:"eventId"`
	EventType     EventType      `json:"eventType"`
	OccurredAt    time.Time      `json:"occurredAt"`
	SpaceID       string         `json:"spaceId"`
	SourceApp     string         `json:"sourceApp"`
	AgentID       string         `json:"agentId,omitempty"`
	SessionID     string         `json:"sessionId,omitempty"`
	Subject       WebhookSubject `json:"subject"`
	Data          any            `json:"data"`
}

// IngestCompletedData is the data payload for memory.ingest.completed.
type IngestCompletedData struct {
	Status          string               `json:"status"`
	MemoriesChanged int                  `json:"memoriesChanged"`
	MemoryIDs       []string             `json:"memoryIds"`
	MemorySummaries []MemorySummaryEntry `json:"memorySummaries,omitempty"`
	Warnings        int                  `json:"warnings"`
}

// MemorySummaryEntry is a lightweight per-memory summary included in ingest events.
type MemorySummaryEntry struct {
	MemoryID string   `json:"memoryId"`
	Tags     []string `json:"tags,omitempty"`
}

// RecallPerformedData is the data payload for memory.recall.performed.
type RecallPerformedData struct {
	HitCount  int            `json:"hitCount"`
	QueryHash string         `json:"queryHash"`
	Intent    string         `json:"intent"`
	Results   []RecallResult `json:"results"`
}

// RecallResult is a single hit in a recall event.
type RecallResult struct {
	MemoryID string   `json:"memoryId"`
	Rank     int      `json:"rank"`
	Score    *float64 `json:"score"`
}

// LifecycleChangedData is the data payload for memory.lifecycle.changed.
type LifecycleChangedData struct {
	Transition   string  `json:"transition"`
	MemoryID     string  `json:"memoryId"`
	OldMemoryID  *string `json:"oldMemoryId,omitempty"`
	SupersededBy *string `json:"supersededBy,omitempty"`
}
