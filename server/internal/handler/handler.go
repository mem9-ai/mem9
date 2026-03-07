package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/repository/tidb"
	"github.com/qiffang/mnemos/server/internal/service"
)

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	tenant      *service.TenantService
	uploadTasks repository.UploadTaskRepo
	uploadDir   string
	// Dependencies for creating tenant-mode services on-the-fly.
	embedder   *embed.Embedder
	llmClient  *llm.Client
	autoModel  string
	ingestMode service.IngestMode
	logger     *slog.Logger
	svcCache   sync.Map
}

// NewServer creates a new HTTP handler server.
func NewServer(
	tenantSvc *service.TenantService,
	uploadTasks repository.UploadTaskRepo,
	uploadDir string,
	embedder *embed.Embedder,
	llmClient *llm.Client,
	autoModel string,
	ingestMode service.IngestMode,
	logger *slog.Logger,
) *Server {
	return &Server{
		tenant:      tenantSvc,
		uploadTasks: uploadTasks,
		uploadDir:   uploadDir,
		embedder:    embedder,
		llmClient:   llmClient,
		autoModel:   autoModel,
		ingestMode:  ingestMode,
		logger:      logger,
	}
}

// resolvedSvc holds the correct service instances for a request.
// Services are always backed by the tenant's dedicated DB.
type resolvedSvc struct {
	memory *service.MemoryService
	ingest *service.IngestService
}

type tenantSvcKey string

// resolveServices returns the correct services for a request.
func (s *Server) resolveServices(auth *domain.AuthInfo) resolvedSvc {
	if auth.TenantID == "" {
		key := tenantSvcKey(fmt.Sprintf("db-%p", auth.TenantDB))
		if cached, ok := s.svcCache.Load(key); ok {
			return cached.(resolvedSvc)
		}
		memRepo := tidb.NewMemoryRepo(auth.TenantDB, s.autoModel)
		svc := resolvedSvc{
			memory: service.NewMemoryService(memRepo, s.embedder, s.autoModel),
			ingest: service.NewIngestService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
		}
		s.svcCache.Store(key, svc)
		return svc
	}
	key := tenantSvcKey(auth.TenantID)
	if cached, ok := s.svcCache.Load(key); ok {
		return cached.(resolvedSvc)
	}
	memRepo := tidb.NewMemoryRepo(auth.TenantDB, s.autoModel)
	svc := resolvedSvc{
		memory: service.NewMemoryService(memRepo, s.embedder, s.autoModel),
		ingest: service.NewIngestService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
	}
	s.svcCache.Store(key, svc)
	return svc
}

// Router builds the chi router with all routes and middleware.
func (s *Server) Router(tenantMW, rateLimitMW func(http.Handler) http.Handler) http.Handler {
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

	// Provision a new tenant — no auth, no body.
	r.Post("/v1alpha1/mem9s", s.provisionMem9s)

	// Tenant-scoped routes — tenantMW resolves {tenantID} to DB connection.
	r.Route("/v1alpha1/mem9s/{tenantID}", func(r chi.Router) {
		r.Use(tenantMW)

		// Memory CRUD.
		r.Post("/memories", s.createMemory)
		r.Get("/memories", s.listMemories)
		r.Get("/memories/bootstrap", s.bootstrapMemories)
		r.Post("/memories/bulk", s.bulkCreateMemories)
		r.Get("/memories/{id}", s.getMemory)
		r.Put("/memories/{id}", s.updateMemory)
		r.Delete("/memories/{id}", s.deleteMemory)
		r.Post("/memories/ingest", s.ingestMemories)

		// Tasks (async file ingest).
		r.Post("/tasks", s.createTask)
		r.Get("/tasks", s.listTasks)
		r.Get("/tasks/{id}", s.getTask)

		// Tenant info.
		r.Get("/info", s.getTenantInfo)
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
