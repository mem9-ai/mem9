package handler

import (
	"io"
	"log/slog"
	"testing"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/service"
)

func TestResolveServicesReturnsFreshInstances(t *testing.T) {
	t.Parallel()

	srv := &Server{
		dbBackend:  "tidb",
		ingestMode: service.ModeSmart,
		logger:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	auth := &domain.AuthInfo{}

	first := srv.resolveServices(auth)
	second := srv.resolveServices(auth)

	if first.memory == nil || first.ingest == nil || second.memory == nil || second.ingest == nil {
		t.Fatal("resolveServices() returned nil service")
	}
	if first.memory == second.memory {
		t.Fatal("resolveServices() reused cached memory service; want fresh instance")
	}
	if first.ingest == second.ingest {
		t.Fatal("resolveServices() reused cached ingest service; want fresh instance")
	}
}
