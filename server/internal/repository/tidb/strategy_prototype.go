package tidb

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// RecallStrategyPrototypeRepo searches the control-plane recall_strategy_prototypes table.
type RecallStrategyPrototypeRepo struct {
	db        *sql.DB
	autoModel string
}

func NewRecallStrategyPrototypeRepo(db *sql.DB, autoModel string) *RecallStrategyPrototypeRepo {
	return &RecallStrategyPrototypeRepo{db: db, autoModel: autoModel}
}

func (r *RecallStrategyPrototypeRepo) VectorSearch(ctx context.Context, query string, limit int) ([]domain.RecallStrategyPrototypeMatch, error) {
	if r.autoModel == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}

	sqlQuery := `SELECT id, pattern_text, strategy_class, answer_family, language,
		VEC_EMBED_COSINE_DISTANCE(embedding, ?) AS distance
		FROM recall_strategy_prototypes
		WHERE active = 1 AND embedding IS NOT NULL
		ORDER BY VEC_EMBED_COSINE_DISTANCE(embedding, ?)
		LIMIT ?`

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, query, query, limit)
	if err != nil {
		slog.Error("strategy prototype vector search failed",
			"duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("strategy prototype vector search: %w", err)
	}
	defer rows.Close()

	var matches []domain.RecallStrategyPrototypeMatch
	for rows.Next() {
		var m domain.RecallStrategyPrototypeMatch
		var answerFamily sql.NullString
		var distance float64
		if err := rows.Scan(&m.ID, &m.PatternText, &m.StrategyClass, &answerFamily, &m.Language, &distance); err != nil {
			return nil, fmt.Errorf("scan strategy prototype vector row: %w", err)
		}
		m.AnswerFamily = answerFamily.String
		m.Score = 1 - distance
		m.Source = "vector"
		matches = append(matches, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slog.Debug("strategy prototype vector search done",
		"duration_ms", time.Since(start).Milliseconds(), "count", len(matches))
	return matches, nil
}

func (r *RecallStrategyPrototypeRepo) FTSSearch(ctx context.Context, query string, limit int) ([]domain.RecallStrategyPrototypeMatch, error) {
	if limit <= 0 {
		limit = 10
	}

	safeQ := ftsSafeLiteral(query)
	sqlQuery := `SELECT id, pattern_text, strategy_class, answer_family, language,
		fts_match_word('` + safeQ + `', pattern_text) AS fts_score
		FROM recall_strategy_prototypes
		WHERE active = 1 AND fts_match_word('` + safeQ + `', pattern_text)
		ORDER BY fts_match_word('` + safeQ + `', pattern_text) DESC
		LIMIT ?`

	start := time.Now()
	rows, err := r.db.QueryContext(ctx, sqlQuery, limit)
	if err != nil {
		slog.Error("strategy prototype FTS search failed",
			"duration_ms", time.Since(start).Milliseconds(), "err", err)
		return nil, fmt.Errorf("strategy prototype FTS search: %w", err)
	}
	defer rows.Close()

	var matches []domain.RecallStrategyPrototypeMatch
	for rows.Next() {
		var m domain.RecallStrategyPrototypeMatch
		var answerFamily sql.NullString
		if err := rows.Scan(&m.ID, &m.PatternText, &m.StrategyClass, &answerFamily, &m.Language, &m.Score); err != nil {
			return nil, fmt.Errorf("scan strategy prototype FTS row: %w", err)
		}
		m.AnswerFamily = answerFamily.String
		m.Source = "fts"
		matches = append(matches, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slog.Debug("strategy prototype FTS search done",
		"duration_ms", time.Since(start).Milliseconds(), "count", len(matches))
	return matches, nil
}
