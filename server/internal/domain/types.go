package domain

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// MemoryType classifies how a memory was created.
type MemoryType string

const (
	TypePinned  MemoryType = "pinned"
	TypeInsight MemoryType = "insight"
)

// MemoryState represents the lifecycle state of a memory.
type MemoryState string

const (
	StateActive   MemoryState = "active"
	StatePaused   MemoryState = "paused"
	StateArchived MemoryState = "archived"
	StateDeleted  MemoryState = "deleted"
)

// Memory represents a piece of shared knowledge stored in a space.
type Memory struct {
	ID         string          `json:"id"`
	Content    string          `json:"content"`
	MemoryType MemoryType      `json:"memory_type"`
	Source     string          `json:"source,omitempty"`
	Tags       []string        `json:"tags,omitempty"`
	Metadata   json.RawMessage `json:"metadata,omitempty"`
	Embedding  []float32       `json:"-"`

	AgentID      string `json:"agent_id,omitempty"`
	SessionID    string `json:"session_id,omitempty"`
	UpdatedBy    string `json:"updated_by,omitempty"`
	SupersededBy string `json:"superseded_by,omitempty"`

	State     MemoryState `json:"state"`
	Version   int         `json:"version"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`

	Score *float64 `json:"score,omitempty"`
}

type AuthInfo struct {
	AgentName string

	// Dedicated-cluster model (non-empty when using tenant token)
	TenantID string
	TenantDB *sql.DB
}

// MemoryFilter encapsulates search/list query parameters.
type MemoryFilter struct {
	Query      string
	Tags       []string
	Source     string
	State      string
	MemoryType string
	AgentID    string
	SessionID  string
	Limit      int
	Offset     int
	MinScore   float64 // minimum cosine similarity for vector results; 0 = use default (0.3); -1 = disabled (return all)
}

// TenantStatus represents the lifecycle status of a tenant.
type TenantStatus string

const (
	TenantProvisioning TenantStatus = "provisioning"
	TenantActive       TenantStatus = "active"
	TenantSuspended    TenantStatus = "suspended"
	TenantDeleted      TenantStatus = "deleted"
)

// Tenant represents a provisioned customer with a dedicated database.
type Tenant struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	// Connection info (never exposed in API responses)
	DBHost     string `json:"-"`
	DBPort     int    `json:"-"`
	DBUser     string `json:"-"`
	DBPassword string `json:"-"`
	DBName     string `json:"-"`
	DBTLS      bool   `json:"-"`

	// Provisioning metadata
	Provider       string     `json:"provider"`
	ClusterID      string     `json:"cluster_id,omitempty"`
	ClaimURL       string     `json:"-"`
	ClaimExpiresAt *time.Time `json:"-"`

	// Lifecycle
	Status        TenantStatus `json:"status"`
	SchemaVersion int          `json:"schema_version"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
	DeletedAt     *time.Time   `json:"-"`
}

// DSNForBackend builds a connection string for the specified backend.
// backend must be "postgres" or "tidb" (MySQL-compatible); empty string panics.
func (t *Tenant) DSNForBackend(backend string) string {
	if backend == "" {
		panic("DSNForBackend: backend must be specified explicitly (\"postgres\" or \"tidb\")")
	}
	switch backend {
	case "postgres":
		sslmode := "disable"
		if t.DBTLS {
			sslmode = "require"
		}
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
			t.DBUser, t.DBPassword, t.DBHost, t.DBPort, t.DBName, sslmode)
	default:
		// MySQL/TiDB format
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true",
			t.DBUser, t.DBPassword, t.DBHost, t.DBPort, t.DBName)
		if t.DBTLS {
			dsn += "&tls=true"
		}
		return dsn
	}
}

// TenantInfo describes tenant metadata.
type TenantInfo struct {
	TenantID    string       `json:"tenant_id"`
	Name        string       `json:"name"`
	Status      TenantStatus `json:"status"`
	Provider    string       `json:"provider"`
	MemoryCount int          `json:"memory_count"`
	CreatedAt   time.Time    `json:"created_at"`
}
