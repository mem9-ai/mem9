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
	"github.com/qiffang/mnemos/server/internal/handler"
	"github.com/qiffang/mnemos/server/internal/middleware"
	"github.com/qiffang/mnemos/server/internal/repository/tidb"
	"github.com/qiffang/mnemos/server/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "err", err)
		os.Exit(1)
	}

	db, err := tidb.NewDB(cfg.DSN)
	if err != nil {
		logger.Error("failed to connect database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	// Repositories.
	memoryRepo := tidb.NewMemoryRepo(db)
	tokenRepo := tidb.NewSpaceTokenRepo(db)

	// Services.
	memorySvc := service.NewMemoryService(memoryRepo)
	spaceSvc := service.NewSpaceService(tokenRepo, memoryRepo)

	// Middleware.
	authMW := middleware.Auth(tokenRepo)
	rl := middleware.NewRateLimiter(cfg.RateLimit, cfg.RateBurst)
	defer rl.Stop()
	rateMW := rl.Middleware()

	// Handler.
	srv := handler.NewServer(memorySvc, spaceSvc, logger)
	router := srv.Router(authMW, rateMW)

	httpSrv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info("received signal, shutting down", "signal", sig)

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
