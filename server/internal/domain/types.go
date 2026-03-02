package domain

import (
	"encoding/json"
	"time"
)

// Memory represents a piece of shared knowledge stored in a space.
type Memory struct {
	ID        string            `json:"id"`
	SpaceID   string            `json:"-"`
	Content   string            `json:"content"`
	KeyName   string            `json:"key,omitempty"`
	Source    string            `json:"source,omitempty"`
	Tags      []string          `json:"tags,omitempty"`
	Metadata  json.RawMessage   `json:"metadata,omitempty"`
	Embedding []float32         `json:"-"`
	Version   int               `json:"version"`
	UpdatedBy string            `json:"updated_by,omitempty"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
	Score     *float64          `json:"score,omitempty"`
}

// SpaceToken maps an API token to a space and identifies an agent.
type SpaceToken struct {
	APIToken  string    `json:"api_token"`
	SpaceID   string    `json:"space_id"`
	SpaceName string    `json:"space_name"`
	AgentName string    `json:"agent_name"`
	AgentType string    `json:"agent_type,omitempty"`
	CreatedAt time.Time `json:"created_at"`
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

// AuthInfo is extracted from the bearer token and carried in context.
type AuthInfo struct {
	SpaceID   string
	AgentName string
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
