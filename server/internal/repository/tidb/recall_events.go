package tidb

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	internaltenant "github.com/qiffang/mnemos/server/internal/tenant"
)

type RecallEventRepo struct {
	db        *sql.DB
	clusterID string
}

func NewRecallEventRepo(db *sql.DB, clusterID string) *RecallEventRepo {
	return &RecallEventRepo{db: db, clusterID: clusterID}
}

func (r *RecallEventRepo) BulkRecord(ctx context.Context, events []*domain.RecallEvent) error {
	if len(events) == 0 {
		return nil
	}

	const rowPlaceholder = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`
	placeholders := make([]string, len(events))
	args := make([]any, 0, len(events)*10)

	for i, e := range events {
		placeholders[i] = rowPlaceholder
		args = append(args,
			e.ID, e.SearchID, e.Query, e.QueryHash,
			nullString(e.AgentID), nullString(e.SessionID),
			e.MemoryID, e.MemoryType, marshalTags(e.Tags), e.Score,
		)
	}

	query := `INSERT IGNORE INTO recall_events
		(id, search_id, query, query_hash, agent_id, session_id, memory_id, memory_type, tags, score, created_at)
		VALUES ` + strings.Join(placeholders, ",")

	if _, err := r.db.ExecContext(ctx, query, args...); err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			return nil
		}
		return fmt.Errorf("recall_events bulk record: %w", err)
	}
	return nil
}

func (r *RecallEventRepo) Aggregate(ctx context.Context, f domain.InterestFilter) (*domain.InterestProfile, error) {
	profile := &domain.InterestProfile{
		Period:     domain.PeriodRange{From: f.From, To: f.To},
		AgentID:    f.AgentID,
		TagProfile: []domain.TagStat{},
	}

	tagSQL := `SELECT tag.value AS tag,
		COUNT(*) AS recall_count,
		COUNT(DISTINCT query_hash) AS unique_queries,
		SUM(memory_type = 'insight') AS insight_count,
		SUM(memory_type = 'session') AS session_count,
		SUM(memory_type = 'pinned') AS pinned_count
		FROM recall_events,
		JSON_TABLE(tags, '$[*]' COLUMNS (value VARCHAR(100) PATH '$')) AS tag
		WHERE created_at BETWEEN ? AND ?
		AND (? = '' OR agent_id = ?)
		GROUP BY tag.value
		ORDER BY recall_count DESC
		LIMIT ?`

	rows, err := r.db.QueryContext(ctx, tagSQL, f.From, f.To, f.AgentID, f.AgentID, f.Top)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			slog.Error("recall_events table not found — EnsureRecallEventsTable may still be running",
				"cluster_id", r.clusterID, "err", err)
			return profile, nil
		}
		return nil, fmt.Errorf("recall_events aggregate tags: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var ts domain.TagStat
		var insightCount, sessionCount, pinnedCount int
		if err := rows.Scan(&ts.Tag, &ts.RecallCount, &ts.UniqueQueries,
			&insightCount, &sessionCount, &pinnedCount); err != nil {
			return nil, fmt.Errorf("recall_events aggregate tags scan: %w", err)
		}
		ts.MemoryTypes = map[string]int{
			"insight": insightCount,
			"session": sessionCount,
			"pinned":  pinnedCount,
		}
		profile.TagProfile = append(profile.TagProfile, ts)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("recall_events aggregate tags rows: %w", err)
	}

	if !f.IncludeQueries {
		return profile, nil
	}

	querySQL := `SELECT query_hash,
		MIN(query) AS sample_query,
		COUNT(DISTINCT search_id) AS count
		FROM recall_events
		WHERE created_at BETWEEN ? AND ?
		AND (? = '' OR agent_id = ?)
		GROUP BY query_hash
		ORDER BY count DESC
		LIMIT 10`

	qrows, err := r.db.QueryContext(ctx, querySQL, f.From, f.To, f.AgentID, f.AgentID)
	if err != nil {
		if internaltenant.IsTableNotFoundError(err) {
			slog.Error("recall_events table not found during top_queries query",
				"cluster_id", r.clusterID, "err", err)
			return profile, nil
		}
		return nil, fmt.Errorf("recall_events aggregate queries: %w", err)
	}
	defer qrows.Close()

	profile.TopQueries = []domain.QueryStat{}
	for qrows.Next() {
		var qs domain.QueryStat
		if err := qrows.Scan(&qs.QueryHash, &qs.SampleQuery, &qs.Count); err != nil {
			return nil, fmt.Errorf("recall_events aggregate queries scan: %w", err)
		}
		profile.TopQueries = append(profile.TopQueries, qs)
	}
	if err := qrows.Err(); err != nil {
		return nil, fmt.Errorf("recall_events aggregate queries rows: %w", err)
	}

	return profile, nil
}
