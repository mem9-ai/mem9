package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/repository"
)

type contextKey string

const authInfoKey contextKey = "authInfo"

// Auth returns middleware that resolves a Bearer token to AuthInfo and injects it into context.
func Auth(tokens repository.SpaceTokenRepo) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearerToken(r)
			if token == "" {
				writeError(w, http.StatusUnauthorized, "missing authorization token")
				return
			}

			st, err := tokens.GetByToken(r.Context(), token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			ctx := context.WithValue(r.Context(), authInfoKey, &domain.AuthInfo{
				SpaceID:   st.SpaceID,
				AgentName: st.AgentName,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AuthFromContext extracts the AuthInfo set by the Auth middleware.
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
