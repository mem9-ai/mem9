package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

type contextKey string

const authInfoKey contextKey = "authInfo"

const AgentIDHeader = "X-Mnemo-Agent-Id"

func Auth(spaceTokens repository.SpaceTokenRepo, userTokens repository.UserTokenRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearerToken(r)
			if token == "" {
				writeError(w, http.StatusUnauthorized, "missing authorization token")
				return
			}

			info, err := resolveToken(r.Context(), token, spaceTokens, userTokens)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			if agentID := r.Header.Get(AgentIDHeader); agentID != "" {
				info.AgentName = agentID
			}

			ctx := context.WithValue(r.Context(), authInfoKey, info)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func resolveToken(ctx context.Context, token string, spaceTokens repository.SpaceTokenRepo, userTokens repository.UserTokenRepo) (*domain.AuthInfo, error) {
	st, err := spaceTokens.GetByToken(ctx, token)
	if err == nil {
		return &domain.AuthInfo{
			SpaceID:   st.SpaceID,
			AgentName: st.AgentName,
			UserID:    st.UserID,
		}, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}

	ut, err := userTokens.GetByToken(ctx, token)
	if err != nil {
		return nil, err
	}
	return &domain.AuthInfo{
		UserID: ut.UserID,
	}, nil
}

func AuthFromContext(ctx context.Context) *domain.AuthInfo {
	info, _ := ctx.Value(authInfoKey).(*domain.AuthInfo)
	return info
}

func extractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
