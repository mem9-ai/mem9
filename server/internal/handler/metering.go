package handler

import (
	"context"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/metering"
)

const meteringCategoryAPI = "mem9-api"

func (s *Server) afterSuccessfulWrite(auth *domain.AuthInfo, svc resolvedSvc, written int64) {
	if s == nil {
		return
	}
	s.refreshWriteMetrics(auth, svc, written)
	if s.activity == nil || auth == nil {
		return
	}
	s.activity.RecordMemoryActivity(auth.TenantID, time.Now().UTC())
}

func (s *Server) afterSuccessfulIngest(auth *domain.AuthInfo, svc resolvedSvc, written int64) {
	s.afterSuccessfulWrite(auth, svc, written)
	s.recordIngestMetering(auth, svc)
}

func (s *Server) recordRecallMetering(auth *domain.AuthInfo) {
	if s == nil || s.metering == nil || auth == nil {
		return
	}
	s.metering.Record(metering.Event{
		Category:  meteringCategoryAPI,
		TenantID:  auth.TenantID,
		ClusterID: auth.ClusterID,
		Data: map[string]any{
			"event_type":        "recall",
			"recall_call_count": 1,
		},
	})
}

func (s *Server) recordIngestMetering(auth *domain.AuthInfo, svc resolvedSvc) {
	if s == nil || s.metering == nil || auth == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	total, _, err := svc.memory.CountStats(ctx)
	if err != nil {
		logger := s.logger
		if logger == nil {
			logger = slog.Default()
		}
		logger.Warn("ingest metering skipped: count stats failed",
			"tenant_id", auth.TenantID,
			"cluster_id", auth.ClusterID,
			"err", err,
		)
		return
	}

	s.metering.Record(metering.Event{
		Category:  meteringCategoryAPI,
		TenantID:  auth.TenantID,
		ClusterID: auth.ClusterID,
		Data: map[string]any{
			"event_type":          "ingest",
			"active_memory_count": total,
		},
	})
}
