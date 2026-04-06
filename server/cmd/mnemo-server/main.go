package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/qiffang/mnemos/server/internal/config"
	"github.com/qiffang/mnemos/server/internal/embed"
	"github.com/qiffang/mnemos/server/internal/encrypt"
	"github.com/qiffang/mnemos/server/internal/handler"
	"github.com/qiffang/mnemos/server/internal/llm"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository"
	"github.com/qiffang/mnemos/server/internal/reqid"
	"github.com/qiffang/mnemos/server/internal/service"
	"github.com/qiffang/mnemos/server/internal/tenant"
)

func main() {
	logger := slog.New(reqid.NewHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     slog.LevelInfo,
		AddSource: true,
	})))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "err", err)
		os.Exit(1)
	}

	db, err := repository.NewDB(cfg.DBBackend, cfg.DSN)
	if err != nil {
		logger.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer db.Close()
	logger.Info("database connected", "backend", cfg.DBBackend)

	// Warn if encryption type is non-default — changing this later breaks existing tenants.
	if cfg.EncryptType != "" && cfg.EncryptType != "plain" {
		logger.Warn("MNEMO_ENCRYPT_TYPE is non-plain; ensure this matches your deployment's initial configuration. Changing encryption type on existing tenants will cause failures.",
			"encrypt_type", cfg.EncryptType)
	}

	// Embedder (nil if not configured → keyword-only search).
	embedder := embed.New(embed.Config{
		APIKey:  cfg.EmbedAPIKey,
		BaseURL: cfg.EmbedBaseURL,
		Model:   cfg.EmbedModel,
		Dims:    cfg.EmbedDims,
	})
	if cfg.EmbedAutoModel != "" {
		if cfg.DBBackend == "tidb" || cfg.DBBackend == "db9" {
			logger.Info("auto-embedding enabled (EMBED_TEXT)", "model", cfg.EmbedAutoModel, "dims", cfg.EmbedAutoDims)
		} else {
			logger.Warn("auto-embedding (EMBED_TEXT) is only supported with TiDB or db9; clearing and falling back to client-side embedding", "model", cfg.EmbedAutoModel, "backend", cfg.DBBackend)
			cfg.EmbedAutoModel = ""
			cfg.EmbedAutoDims = 0
		}
	} else if embedder != nil {
		logger.Info("client-side embedding configured", "model", cfg.EmbedModel, "dims", cfg.EmbedDims)
	} else {
		logger.Info("no embedding configured, keyword-only search active")
	}
	// LLM client (nil if not configured → raw ingest mode).
	llmClient := llm.New(llm.Config{
		APIKey:      cfg.LLMAPIKey,
		BaseURL:     cfg.LLMBaseURL,
		Model:       cfg.LLMModel,
		Temperature: cfg.LLMTemperature,
		DebugLLM:    cfg.DebugLLM,
	})
	if llmClient != nil {
		logger.Info("LLM configured for smart ingest", "model", cfg.LLMModel)
	} else {
		logger.Info("no LLM configured, ingest will use raw mode")
	}

	// Encryption for sensitive data.
	encryptor, err := encrypt.New(encrypt.Config{
		Type: encrypt.Type(cfg.EncryptType),
		Key:  cfg.EncryptKey,
	})
	if err != nil {
		logger.Error("failed to create encryptor", "err", err)
		os.Exit(1)
	}
	logger.Info("encryption configured", "type", cfg.EncryptType)

	// Repositories.
	tenantRepo := repository.NewTenantRepo(cfg.DBBackend, db)
	uploadTaskRepo := repository.NewUploadTaskRepo(cfg.DBBackend, db)
	tenantPool := tenant.NewPool(tenant.PoolConfig{
		MaxIdle:     cfg.TenantPoolMaxIdle,
		MaxOpen:     cfg.TenantPoolMaxOpen,
		IdleTimeout: cfg.TenantPoolIdleTimeout,
		TotalLimit:  cfg.TenantPoolTotalLimit,
		Backend:     cfg.DBBackend,
	})
	defer tenantPool.Close()

	// Services.
	// Select provisioner based on configuration
	var provisioner tenant.Provisioner
	if cfg.TiDBZeroEnabled && cfg.DBBackend == "tidb" {
		// Zero mode (explicit toggle takes precedence)
		provisioner = tenant.NewZeroProvisioner(cfg.TiDBZeroAPIURL, cfg.DBBackend, cfg.EmbedAutoModel, cfg.EmbedAutoDims, cfg.FTSEnabled)
		logger.Info("using TiDB Zero provisioner")
	} else if cfg.TiDBZeroEnabled {
		logger.Warn("TiDB Zero provisioning is only supported with tidb backend; disabling auto-provisioning", "backend", cfg.DBBackend)
	}

	// Check for TiDB Cloud credentials (only if Zero is not enabled)
	if provisioner == nil && cfg.DBBackend == "tidb" {
		if os.Getenv("MNEMO_TIDBCLOUD_API_KEY") != "" && os.Getenv("MNEMO_TIDBCLOUD_API_SECRET") != "" {
			provisioner = tenant.NewTiDBCloudProvisioner(cfg.TiDBCloudAPIURL, cfg.TiDBCloudPoolID)
			logger.Info("using TiDB Cloud Pool provisioner")
		}
	}

	// Note: nil provisioner is valid for deployments with pre-existing tenants
	if provisioner == nil {
		logger.Info("no provisioner configured (pre-existing tenants mode)")
	}

	tenantSvc := service.NewTenantService(tenantRepo, provisioner, tenantPool, logger, cfg.EmbedAutoModel, cfg.EmbedAutoDims, cfg.FTSEnabled, encryptor)

	// Middleware.
	tenantMW := middleware.ResolveTenant(tenantRepo, tenantPool, encryptor, cfg.ClusterBlacklist)
	apiKeyMW := middleware.ResolveApiKey(tenantRepo, tenantPool, encryptor, cfg.ClusterBlacklist)
	rl := middleware.NewRateLimiter(cfg.RateLimit, cfg.RateBurst)
	defer rl.Stop()
	rateMW := rl.Middleware()

	// Handler.
	srv := handler.NewServer(tenantSvc, uploadTaskRepo, cfg.UploadDir, embedder, llmClient, cfg.EmbedAutoModel, cfg.FTSEnabled, service.IngestMode(cfg.IngestMode), cfg.DBBackend, logger)
	router := srv.Router(tenantMW, rateMW, apiKeyMW)

	httpSrv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second, // extended from 30s to support sync ingest (LLM reconcile can take >30s)
		IdleTimeout:  60 * time.Second,
	}

	// Upload worker (async file ingest).
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()
	uploadWorker := service.NewUploadWorker(
		uploadTaskRepo,
		tenantRepo,
		tenantPool,
		embedder,
		llmClient,
		cfg.EmbedAutoModel,
		cfg.FTSEnabled,
		service.IngestMode(cfg.IngestMode),
		logger,
		cfg.WorkerConcurrency,
		encryptor,
	)
	go func() {
		if err := uploadWorker.Run(workerCtx); err != nil {
			logger.Error("upload worker error", "err", err)
		}
	}()

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info("received signal, shutting down", "signal", sig)

		workerCancel() // Stop upload worker first.

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(ctx); err != nil {
			logger.Error("shutdown error", "err", err)
		}
	}()

	logger.Info("starting mnemo server", "port", cfg.Port)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server error", "err", err)
		os.Exit(1)
	}
	logger.Info("server stopped")
}
