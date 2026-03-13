package tenant

import (
	"context"
	"database/sql"
	"time"
)

// Provisioner abstracts cluster acquisition and schema initialization
type Provisioner interface {
	Provision(ctx context.Context) (*ClusterInfo, error)
	InitSchema(ctx context.Context, db *sql.DB) error
	ProviderType() string // Returns "tidb_zero" or "tidb_cloud_starter"
}

// ClusterInfo contains connection details for a provisioned cluster
type ClusterInfo struct {
	ID             string
	Host           string
	Port           int
	Username       string
	Password       string
	DBName         string
	ClaimURL       string     // Only for Zero provisioner
	ClaimExpiresAt *time.Time // Only for Zero provisioner
}
