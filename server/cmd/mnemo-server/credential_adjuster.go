package main

import (
	"context"
	"errors"
	"strings"

	"github.com/qiffang/mnemos/server/internal/credentials"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

// Only the provider boundary needs a real cluster ID. Keep its credential
// reference in internal metadata, logs, metrics and legacy metering paths.
type credentialSpendLimitAdjuster struct {
	tenant.SpendLimitAdjuster
	store *credentials.Store
}

func (a credentialSpendLimitAdjuster) GetSpendLimit(ctx context.Context, id string) (int, error) {
	raw, err := a.store.ResolveReference(ctx, id)
	if err != nil {
		return 0, err
	}
	limit, err := a.SpendLimitAdjuster.GetSpendLimit(ctx, raw)
	if err != nil && strings.HasPrefix(id, credentials.ReferencePrefix) {
		return 0, errors.New("provider spend-limit lookup failed")
	}
	return limit, err
}

func (a credentialSpendLimitAdjuster) IncreaseSpendLimit(ctx context.Context, id string, amount int) error {
	raw, err := a.store.ResolveReference(ctx, id)
	if err != nil {
		return err
	}
	err = a.SpendLimitAdjuster.IncreaseSpendLimit(ctx, raw, amount)
	if err != nil && strings.HasPrefix(id, credentials.ReferencePrefix) {
		return errors.New("provider spend-limit adjustment failed")
	}
	return err
}
