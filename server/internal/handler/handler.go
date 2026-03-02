package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/service"
)

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	memory *service.MemoryService
	space  *service.SpaceService
	logger *slog.Logger
}

// NewServer creates a new HTTP handler server.
func NewServer(memory *service.MemoryService, space *service.SpaceService, logger *slog.Logger) *Server {
	return &Server{memory: memory, space: space, logger: logger}
}

// Router builds the chi router with all routes and middleware.
func (s *Server) Router(authMW, rateLimitMW func(http.Handler) http.Handler) http.Handler {
	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(requestLogger(s.logger))
	r.Use(rateLimitMW)

	// Health check.
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Create space — no auth (bootstrap endpoint).
	r.Post("/api/spaces", s.createSpace)

	// Create user — no auth (bootstrap endpoint).
	r.Post("/api/users", s.createUser)

	// Authenticated routes.
	r.Group(func(r chi.Router) {
		r.Use(authMW)

		// Space management.
		r.Post("/api/spaces/provision", s.provisionSpace)
		r.Post("/api/spaces/{spaceID}/tokens", s.addToken)
		r.Get("/api/spaces/{spaceID}/info", s.getSpaceInfo)

		// Memory CRUD.
		r.Post("/api/memories", s.createMemory)
		r.Get("/api/memories", s.listMemories)
		r.Get("/api/memories/bootstrap", s.bootstrapMemories)
		r.Post("/api/memories/bulk", s.bulkCreateMemories)
		r.Get("/api/memories/{id}", s.getMemory)
		r.Put("/api/memories/{id}", s.updateMemory)
		r.Delete("/api/memories/{id}", s.deleteMemory)
	})

	return r
}

// respond writes a JSON response.
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		if err := json.NewEncoder(w).Encode(data); err != nil {
			slog.Error("failed to encode response", "err", err)
		}
	}
}

// respondError writes a JSON error response.
func respondError(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}

// handleError maps domain errors to HTTP status codes.
func (s *Server) handleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		respondError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, domain.ErrWriteConflict):
		respondError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, domain.ErrConflict):
		respondError(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrDuplicateKey):
		respondError(w, http.StatusConflict, "duplicate key: "+err.Error())
	case errors.Is(err, domain.ErrValidation):
		respondError(w, http.StatusBadRequest, err.Error())
	default:
		s.logger.Error("internal error", "err", err)
		respondError(w, http.StatusInternalServerError, "internal server error")
	}
}

// decode reads and JSON-decodes the request body.
func decode(r *http.Request, dst any) error {
	if r.Body == nil {
		return &domain.ValidationError{Message: "request body required"}
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return &domain.ValidationError{Message: "invalid JSON: " + err.Error()}
	}
	return nil
}

// authInfo extracts AuthInfo from context.
func authInfo(r *http.Request) *domain.AuthInfo {
	return middleware.AuthFromContext(r.Context())
}

// requestLogger returns a middleware that logs each request.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", chimw.GetReqID(r.Context()),
			)
		})
	}
}
