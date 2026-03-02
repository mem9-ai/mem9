package domain

import (
	"encoding/json"
	"time"
)

// Memory represents a piece of shared knowledge stored in a space.
type Memory struct {
	ID        string          `json:"id"`
	SpaceID   string          `json:"-"`
	Content   string          `json:"content"`
	KeyName   string          `json:"key,omitempty"`
	Source    string          `json:"source,omitempty"`
	Tags      []string        `json:"tags,omitempty"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
	Embedding []float32       `json:"-"`
	Version   int             `json:"version"`
	UpdatedBy string          `json:"updated_by,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	Score     *float64        `json:"score,omitempty"`

	VectorClock map[string]uint64 `json:"clock,omitempty"`
	OriginAgent string            `json:"origin_agent,omitempty"`
	Tombstone   bool              `json:"tombstone"`
	WriteID     string            `json:"-"`
}

// WriteResult is returned by the service layer to the handler for CRDT-aware writes.
// It is never serialized directly to the HTTP response body.
type WriteResult struct {
	Memory    *Memory
	Dominated bool   // true when incoming write lost to existing
	Winner    string // origin_agent of the winning record
	Merged    bool   // true when concurrent writes were resolved by section merge
}

type UserToken struct {
	APIToken  string    `json:"api_token"`
	UserID    string    `json:"user_id"`
	UserName  string    `json:"user_name"`
	CreatedAt time.Time `json:"created_at"`
}

type SpaceToken struct {
	APIToken     string    `json:"api_token"`
	SpaceID      string    `json:"space_id"`
	SpaceName    string    `json:"space_name"`
	AgentName    string    `json:"agent_name"`
	AgentType    string    `json:"agent_type,omitempty"`
	UserID       string    `json:"user_id,omitempty"`
	WorkspaceKey string    `json:"workspace_key,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// SpaceInfo is the response for GET /api/spaces/:id/info.
type SpaceInfo struct {
	SpaceID     string      `json:"space_id"`
	SpaceName   string      `json:"space_name"`
	MemoryCount int         `json:"memory_count"`
	Agents      []AgentInfo `json:"agents"`
}

// AgentInfo describes one agent in a space.
type AgentInfo struct {
	AgentName string `json:"agent_name"`
	AgentType string `json:"agent_type,omitempty"`
}

type AuthInfo struct {
	SpaceID   string
	AgentName string
	UserID    string
}

// MemoryFilter encapsulates search/list query parameters.
type MemoryFilter struct {
	Query  string
	Tags   []string
	Source string
	Key    string
	Limit  int
	Offset int
}
