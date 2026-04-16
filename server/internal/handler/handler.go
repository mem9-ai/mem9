package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/qiffang/mnemos/server/internal/domain"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/metrics"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/service"
)

// Server holds the HTTP handlers and their dependencies.
type Server struct {
	tenant        *service.TenantService
	uploadTasks   repository.UploadTaskRepo
	uploadDir     string
	embedder      *embed.Embedder
	llmClient     *llm.Client
	autoModel     string
	ftsEnabled    bool
	ingestMode    service.IngestMode
	dbBackend     string
	logger        *slog.Logger
	startedAt     time.Time
	svcCache      sync.Map
	gaugeDebounce sync.Map // cluster_id -> time.Time of last Gauge refresh
}

// NewServer creates a new HTTP handler server.
func NewServer(
	tenantSvc *service.TenantService,
	uploadTasks repository.UploadTaskRepo,
	uploadDir string,
	embedder *embed.Embedder,
	llmClient *llm.Client,
	autoModel string,
	ftsEnabled bool,
	ingestMode service.IngestMode,
	dbBackend string,
	logger *slog.Logger,
) *Server {
	return &Server{
		tenant:      tenantSvc,
		uploadTasks: uploadTasks,
		uploadDir:   uploadDir,
		embedder:    embedder,
		llmClient:   llmClient,
		autoModel:   autoModel,
		ftsEnabled:  ftsEnabled,
		ingestMode:  ingestMode,
		dbBackend:   dbBackend,
		logger:      logger,
		startedAt:   time.Now().UTC(),
	}
}

// resolvedSvc holds the correct service instances for a request.
// Services are always backed by the tenant's dedicated DB.
type resolvedSvc struct {
	memory  *service.MemoryService
	ingest  *service.IngestService
	session *service.SessionService
}

type tenantSvcKey string

// resolveServices returns the correct services for a request.
func (s *Server) resolveServices(auth *domain.AuthInfo) resolvedSvc {
	if auth.TenantID == "" {
		key := tenantSvcKey(fmt.Sprintf("db-%p", auth.TenantDB))
		if cached, ok := s.svcCache.Load(key); ok {
			return cached.(resolvedSvc)
		}
		memRepo := repository.NewMemoryRepo(s.dbBackend, auth.TenantDB, s.autoModel, s.ftsEnabled, auth.ClusterID)
		sessRepo := repository.NewSessionRepo(s.dbBackend, auth.TenantDB, s.autoModel, s.ftsEnabled, auth.ClusterID)
		svc := resolvedSvc{
			memory:  service.NewMemoryService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
			ingest:  service.NewIngestService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
			session: service.NewSessionService(sessRepo, s.embedder, s.autoModel),
		}
		actual, loaded := s.svcCache.LoadOrStore(key, svc)
		if !loaded {
			go func() {
				if err := s.tenant.EnsureSessionsTable(context.Background(), auth.TenantDB); err != nil {
					s.logger.Warn("sessions table migration failed",
						"cluster_id", auth.ClusterID,
						"err", err) // no tenant field: TenantID is empty in this branch
				}
			}()
		}
		return actual.(resolvedSvc)
	}
	key := tenantSvcKey(fmt.Sprintf("%s-%p", auth.TenantID, auth.TenantDB))
	if cached, ok := s.svcCache.Load(key); ok {
		return cached.(resolvedSvc)
	}
	memRepo := repository.NewMemoryRepo(s.dbBackend, auth.TenantDB, s.autoModel, s.ftsEnabled, auth.ClusterID)
	sessRepo := repository.NewSessionRepo(s.dbBackend, auth.TenantDB, s.autoModel, s.ftsEnabled, auth.ClusterID)
	svc := resolvedSvc{
		memory:  service.NewMemoryService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
		ingest:  service.NewIngestService(memRepo, s.llmClient, s.embedder, s.autoModel, s.ingestMode),
		session: service.NewSessionService(sessRepo, s.embedder, s.autoModel),
	}
	actual, loaded := s.svcCache.LoadOrStore(key, svc)
	if !loaded {
		go func() {
			if err := s.tenant.EnsureSessionsTable(context.Background(), auth.TenantDB); err != nil {
				s.logger.Warn("sessions table migration failed",
					"cluster_id", auth.ClusterID,
					"tenant", auth.TenantID,
					"err", err)
			}
		}()
	}
	return actual.(resolvedSvc)
}

// Router builds the chi router with all routes and middleware.
func (s *Server) Router(
	tenantMW func(http.Handler) http.Handler,
	rateLimitMW func(http.Handler) http.Handler,
	apiKeyMW func(http.Handler) http.Handler,
) http.Handler {
	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimw.Recoverer)
	r.Use(chimw.RequestID)
	r.Use(reqid.NewContextMiddleware)
	r.Use(requestLogger(s.logger))
	r.Use(rateLimitMW)
	r.Use(metrics.Middleware)

	// Health check.
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/versionz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{
			"go_version": runtime.Version(),
			"started_at": s.startedAt.Format(time.RFC3339Nano),
		})
	})

	r.Get("/metrics", promhttp.Handler().ServeHTTP)

	// Provision a new tenant — no auth, no body.
	r.Post("/v1alpha1/mem9s", s.provisionMem9s)

	// Tenant-scoped routes — tenantMW resolves {tenantID} to DB connection.
	r.Route("/v1alpha1/mem9s/{tenantID}", func(r chi.Router) {
		r.Use(tenantMW)

		// Memory CRUD.
		r.Post("/memories", s.createMemory)
		r.Get("/memories", s.listMemories)
		r.Get("/memories/{id}", s.getMemory)
		r.Put("/memories/{id}", s.updateMemory)
		r.Delete("/memories/{id}", s.deleteMemory)

		// Imports (async file ingest).
		r.Post("/imports", s.createTask)
		r.Get("/imports", s.listTasks)
		r.Get("/imports/{id}", s.getTask)

		// Session messages (raw captured turns).
		r.Get("/session-messages", s.handleListSessionMessages)
	})

	r.Route("/v1alpha2/mem9s", func(r chi.Router) {
		r.Use(apiKeyMW)

		r.Post("/memories", s.createMemory)
		r.Get("/memories", s.listMemories)
		r.Get("/memories/{id}", s.getMemory)
		r.Put("/memories/{id}", s.updateMemory)
		r.Delete("/memories/{id}", s.deleteMemory)

		r.Post("/imports", s.createTask)
		r.Get("/imports", s.listTasks)
		r.Get("/imports/{id}", s.getTask)

		// Session messages (raw captured turns).
		r.Get("/session-messages", s.handleListSessionMessages)
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
func (s *Server) handleError(ctx context.Context, w http.ResponseWriter, err error) {
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
	case errors.Is(err, domain.ErrNotSupported):
		respondError(w, http.StatusNotImplemented, err.Error())
	default:
		s.logger.Error("internal error", "err", err, "request_id", reqid.FromContext(ctx))
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
// It uses the chi route pattern (e.g. /v1alpha1/mem9s/{tenantID}/memories)
// instead of the raw URL path to avoid logging sensitive tenant IDs.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			// Use route pattern to avoid exposing sensitive path params (e.g. tenantID).
			routeCtx := chi.RouteContext(r.Context())
			path := r.URL.Path
			if routeCtx != nil {
				if pattern := routeCtx.RoutePattern(); pattern != "" {
					path = pattern
				}
			}
			level := slog.LevelInfo
			if ww.Status() >= 500 {
				level = slog.LevelError
			}
			logger.Log(
				r.Context(),
				level,
				"handle request done",
				"method", r.Method,
				"path", path,
				"status", ww.Status(),
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}
