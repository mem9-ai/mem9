package tenant

import (
	"context"
	"database/sql"
)

// Provisioner abstracts cluster acquisition and schema initialization
type Provisioner interface {
	Provision(ctx context.Context) (*ClusterInfo, error)
	InitSchema(ctx context.Context, db *sql.DB) error
}

// ClusterInfo contains connection details for a provisioned cluster
type ClusterInfo struct {
	ID       string
	Host     string
	Port     int
	Username string
	Password string
	DBName   string
}
