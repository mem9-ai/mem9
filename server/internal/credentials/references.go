package credentials

import (
	"context"
	"errors"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
)

func (s *Store) ClusterReference(ctx context.Context, value string) (string, error) {
	if value == "" {
		return value, nil
	}
	r, err := s.ByKey(ctx, value)
	if errors.Is(err, domain.ErrNotFound) {
		return value, nil
	}
	if err != nil {
		return "", err
	}
	if r.Kind == "space" {
		return ReferencePrefix + r.ID, nil
	}
	return value, nil
}

// ExpandClaimURL restores only the credential reference created for this
// Space. Keep the template in internal records; expand at an explicit reveal
// boundary rather than reintroducing the key into ordinary tenant metadata.
func (s *Store) ExpandClaimURL(ctx context.Context, id, template string) (string, error) {
	marker := ReferencePrefix + id
	if !strings.Contains(template, marker) {
		return template, nil
	}
	key, err := s.Recover(ctx, id)
	if err != nil {
		return "", err
	}
	return strings.ReplaceAll(template, marker, key), nil
}
