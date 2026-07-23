package handler

import (
	"context"
	"errors"
	"time"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	memoryListBudgetErrorMessage = "all-types memory list budget exceeded"
	memoryListBudgetErrorCode    = "memory_list_budget_exceeded"

	localAllTypeMaxPages   = 20
	localAllTypeMaxRows    = 3000
	localAllTypeMaxElapsed = 5 * time.Second
	localAllTypePageSize   = 200
)

type memoryListBudgetExceededError struct {
	dimension string
	source    string
}

func (e *memoryListBudgetExceededError) Error() string {
	return memoryListBudgetErrorMessage
}

type localListBudgetLimits struct {
	maxPages   int
	maxRows    int
	maxElapsed time.Duration
	pageSize   int
}

type localListBudget struct {
	limits localListBudgetLimits
	pages  int
	rows   int
}

func defaultLocalListBudgetLimits() localListBudgetLimits {
	return localListBudgetLimits{
		maxPages:   localAllTypeMaxPages,
		maxRows:    localAllTypeMaxRows,
		maxElapsed: localAllTypeMaxElapsed,
		pageSize:   localAllTypePageSize,
	}
}

func newLocalListBudget(
	parent context.Context,
	limits localListBudgetLimits,
) (context.Context, *localListBudget, context.CancelFunc) {
	cause := &memoryListBudgetExceededError{dimension: "elapsed"}
	ctx, cancel := context.WithTimeoutCause(parent, limits.maxElapsed, cause)
	return ctx, &localListBudget{limits: limits}, cancel
}

func (b *localListBudget) preparePage(ctx context.Context, source string, filter *domain.MemoryFilter) error {
	if err := b.contextError(ctx, source); err != nil {
		return err
	}
	if b.pages >= b.limits.maxPages {
		return &memoryListBudgetExceededError{dimension: "pages", source: source}
	}
	remainingRows := b.limits.maxRows - b.rows
	if remainingRows < 0 {
		return &memoryListBudgetExceededError{dimension: "rows", source: source}
	}
	if remainingRows == 0 {
		filter.Limit = 1
		return nil
	}
	filter.Limit = min(b.limits.pageSize, remainingRows)
	return nil
}

func (b *localListBudget) recordPage(rows int) {
	b.pages++
	b.rows += rows
}

func (b *localListBudget) pageResultError(ctx context.Context, source string, err error) error {
	if contextErr := b.contextError(ctx, source); contextErr != nil {
		return contextErr
	}
	if err != nil {
		return err
	}
	if b.rows > b.limits.maxRows {
		return &memoryListBudgetExceededError{dimension: "rows", source: source}
	}
	return nil
}

func (b *localListBudget) contextError(ctx context.Context, source string) error {
	if ctx.Err() == nil {
		return nil
	}
	var budgetErr *memoryListBudgetExceededError
	if errors.As(context.Cause(ctx), &budgetErr) {
		return &memoryListBudgetExceededError{dimension: budgetErr.dimension, source: source}
	}
	return ctx.Err()
}
