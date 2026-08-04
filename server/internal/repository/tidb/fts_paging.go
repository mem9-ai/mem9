package tidb

import (
	"context"
	"log/slog"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	// TiDB keeps text-search Top-K bounded when FTS is the only predicate.
	// Business filters run in a second ID-hydration query, so candidate pages
	// start at the requested result count and expand only from observed yield.
	maxFTSCandidatePageSize   = 2000
	maxFTSTotalCandidates     = 10000
	maxFTSCandidatePages      = 8
	maxFTSCandidateMultiplier = 256
	maxFTSPageGrowth          = 4
	maxFTSPagingElapsed       = 5 * time.Second

	ftsPageSizeInitial   = "requested_results"
	ftsPageSizePassRatio = "observed_pass_ratio"
	ftsPageSizeZeroPass  = "zero_pass_growth"

	ftsStopRequestedLimit  = "requested_results"
	ftsStopSourceExhausted = "source_exhausted"
	ftsStopCandidateLimit  = "candidate_limit"
	ftsStopPageLimit       = "page_limit"
	ftsStopElapsedLimit    = "elapsed_limit"
	ftsStopRepeatedPage    = "repeated_page"
	ftsStopError           = "error"
)

type ftsCandidatePager struct {
	requested           int
	totalCandidateLimit int
	startedAt           time.Time
	currentPageSize     int
	pages               int
	candidates          int
	uniqueCandidates    int
	accepted            int
	maxPageSize         int
	lastPageSizeReason  string
	maxPageSizeReason   string
	repeatedCandidates  int
}

func newFTSCandidatePager(requested int, startedAt time.Time) *ftsCandidatePager {
	totalCandidateLimit := maxFTSTotalCandidates
	if requested > 0 && requested <= maxFTSTotalCandidates/maxFTSCandidateMultiplier {
		totalCandidateLimit = requested * maxFTSCandidateMultiplier
	}
	return &ftsCandidatePager{
		requested:           requested,
		totalCandidateLimit: totalCandidateLimit,
		startedAt:           startedAt,
	}
}

func (p *ftsCandidatePager) nextPage(now time.Time) (int, string, string) {
	switch {
	case p.requested <= 0 || p.accepted >= p.requested:
		return 0, "", ftsStopRequestedLimit
	case !now.Before(p.startedAt.Add(maxFTSPagingElapsed)):
		return 0, "", ftsStopElapsedLimit
	case p.candidates >= p.totalCandidateLimit:
		return 0, "", ftsStopCandidateLimit
	case p.pages >= maxFTSCandidatePages:
		return 0, "", ftsStopPageLimit
	}

	remainingCandidates := p.totalCandidateLimit - p.candidates
	pageSize := p.requested
	sizeReason := ftsPageSizeInitial
	if p.pages > 0 {
		remainingResults := p.requested - p.accepted
		if p.accepted == 0 {
			pageSize = p.currentPageSize * 2
			sizeReason = ftsPageSizeZeroPass
		} else {
			pageSize = (remainingResults*p.uniqueCandidates + p.accepted - 1) / p.accepted
			growthLimit := p.currentPageSize * maxFTSPageGrowth
			if pageSize > growthLimit {
				pageSize = growthLimit
			}
			sizeReason = ftsPageSizePassRatio
		}
	}
	pageSize = min(pageSize, maxFTSCandidatePageSize, remainingCandidates)
	p.lastPageSizeReason = sizeReason
	return pageSize, sizeReason, ""
}

func (p *ftsCandidatePager) recordPage(pageSize, candidates, uniqueCandidates, accepted int) {
	p.currentPageSize = pageSize
	p.pages++
	p.candidates += candidates
	p.uniqueCandidates += uniqueCandidates
	p.accepted += accepted
	p.repeatedCandidates += candidates - uniqueCandidates
	if pageSize > p.maxPageSize {
		p.maxPageSize = pageSize
		p.maxPageSizeReason = p.lastPageSizeReason
	}
}

type ftsSearchStats struct {
	requested          int
	candidates         int
	accepted           int
	pages              int
	maxPageSize        int
	maxPageSizeReason  string
	repeatedCandidates int
	stopReason         string
	passRatio          float64
}

func (p *ftsCandidatePager) stats(stopReason string) ftsSearchStats {
	passRatio := 0.0
	if p.uniqueCandidates > 0 {
		passRatio = float64(p.accepted) / float64(p.uniqueCandidates)
	}
	return ftsSearchStats{
		requested:          p.requested,
		candidates:         p.candidates,
		accepted:           p.accepted,
		pages:              p.pages,
		maxPageSize:        p.maxPageSize,
		maxPageSizeReason:  p.maxPageSizeReason,
		repeatedCandidates: p.repeatedCandidates,
		stopReason:         stopReason,
		passRatio:          passRatio,
	}
}

func runAdaptiveFTSSearch[T any](
	ctx context.Context,
	requested int,
	candidateID func(T) string,
	fetchCandidates func(context.Context, int, int) ([]T, error),
	fetchFiltered func(context.Context, []T) ([]domain.Memory, error),
) ([]domain.Memory, ftsSearchStats, error) {
	startedAt := time.Now()
	pager := newFTSCandidatePager(requested, startedAt)
	if requested <= 0 {
		return nil, pager.stats(ftsStopRequestedLimit), nil
	}

	pagingCtx, cancel := context.WithTimeout(ctx, maxFTSPagingElapsed)
	defer cancel()

	filtered := make([]domain.Memory, 0, min(requested, maxFTSTotalCandidates))
	seenCandidates := make(map[string]struct{})
	seenResults := make(map[string]struct{})
	offset := 0

	for {
		pageSize, _, stopReason := pager.nextPage(time.Now())
		if stopReason != "" {
			return filtered, pager.stats(stopReason), nil
		}

		candidates, err := fetchCandidates(pagingCtx, pageSize, offset)
		if err != nil {
			if ctx.Err() != nil {
				return filtered, pager.stats(ftsStopError), err
			}
			if pagingCtx.Err() != nil {
				return filtered, pager.stats(ftsStopElapsedLimit), nil
			}
			return filtered, pager.stats(ftsStopError), err
		}

		newCandidates := make([]T, 0, len(candidates))
		for _, candidate := range candidates {
			id := candidateID(candidate)
			if _, seen := seenCandidates[id]; seen {
				continue
			}
			seenCandidates[id] = struct{}{}
			newCandidates = append(newCandidates, candidate)
		}

		if len(candidates) == 0 {
			pager.recordPage(pageSize, 0, 0, 0)
			return filtered, pager.stats(ftsStopSourceExhausted), nil
		}
		if len(newCandidates) == 0 {
			pager.recordPage(pageSize, len(candidates), 0, 0)
			return filtered, pager.stats(ftsStopRepeatedPage), nil
		}

		page, err := fetchFiltered(pagingCtx, newCandidates)
		if err != nil {
			pager.recordPage(pageSize, len(candidates), len(newCandidates), 0)
			if ctx.Err() != nil {
				return filtered, pager.stats(ftsStopError), err
			}
			if pagingCtx.Err() != nil {
				return filtered, pager.stats(ftsStopElapsedLimit), nil
			}
			return filtered, pager.stats(ftsStopError), err
		}

		accepted := 0
		for _, memory := range page {
			if len(filtered) >= requested {
				break
			}
			if _, seen := seenResults[memory.ID]; seen {
				continue
			}
			seenResults[memory.ID] = struct{}{}
			filtered = append(filtered, memory)
			accepted++
		}
		pager.recordPage(pageSize, len(candidates), len(newCandidates), accepted)
		offset += len(candidates)

		switch {
		case len(filtered) >= requested:
			return filtered, pager.stats(ftsStopRequestedLimit), nil
		case len(candidates) < pageSize:
			return filtered, pager.stats(ftsStopSourceExhausted), nil
		case pagingCtx.Err() != nil:
			if ctx.Err() != nil {
				return filtered, pager.stats(ftsStopError), ctx.Err()
			}
			return filtered, pager.stats(ftsStopElapsedLimit), nil
		}
	}
}

func logFTSSearchStats(ctx context.Context, message, resource, clusterID string, duration time.Duration, stats ftsSearchStats) {
	slog.InfoContext(ctx, message,
		"cluster_id", clusterID,
		"resource", resource,
		"requested_results", stats.requested,
		"candidates", stats.candidates,
		"accepted", stats.accepted,
		"pages", stats.pages,
		"pass_ratio", stats.passRatio,
		"duration_ms", duration.Milliseconds(),
		"stop_reason", stats.stopReason,
		"max_page_size", stats.maxPageSize,
		"max_page_size_reason", stats.maxPageSizeReason,
		"repeated_candidates", stats.repeatedCandidates,
	)
}

func ftsCandidateBudgetError(stats ftsSearchStats) error {
	switch stats.stopReason {
	case ftsStopCandidateLimit, ftsStopPageLimit, ftsStopElapsedLimit:
		return domain.ErrFTSSearchTruncated
	default:
		return nil
	}
}
