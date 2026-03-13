package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"

	chimw "github.com/go-chi/chi/v5/middleware"
)

func writeError(w http.ResponseWriter, r *http.Request, status int, msg string) {
	reqID := chimw.GetReqID(r.Context())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"error":      msg,
		"request_id": reqID,
	}); err != nil {
		slog.Warn("failed to encode error response", "err", err, "request_id", reqID)
	}
}
