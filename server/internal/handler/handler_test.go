package handler

import (
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRouterRegistersMemoryUtilityRoutes(t *testing.T) {
	t.Parallel()

	srv := &Server{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	identity := func(next http.Handler) http.Handler { return next }

	router := srv.Router(identity, identity)
	mux, ok := router.(*chi.Mux)
	if !ok {
		t.Fatalf("Router() returned %T, want *chi.Mux", router)
	}

	routes := make(map[string]struct{})
	if err := chi.Walk(mux, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = struct{}{}
		return nil
	}); err != nil {
		t.Fatalf("chi.Walk() error = %v", err)
	}

	for _, route := range []string{
		"POST /v1alpha1/mem9s/{tenantID}/memories/bulk",
		"GET /v1alpha1/mem9s/{tenantID}/memories/bootstrap",
	} {
		if _, ok := routes[route]; !ok {
			t.Fatalf("missing route %q", route)
		}
	}
}
