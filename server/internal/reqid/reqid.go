package reqid

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	chimw "github.com/go-chi/chi/v5/middleware"
)

const (
	Header          = "X-Request-Id"
	albTraceHeader  = "X-Amzn-Trace-Id"
	maxALBTraceSize = 8 << 10
)

var readRandom = rand.Read

type contextKey struct{}

func FromContext(ctx context.Context) string {
	v, _ := ctx.Value(contextKey{}).(string)
	return v
}

func NewContext(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID, err := resolve(r.Header)
		if err != nil {
			slog.LogAttrs(r.Context(), slog.LevelError, "failed to generate request id", slog.String("error_type", fmt.Sprintf("%T", err)))
			http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
			return
		}

		r.Header.Set(Header, requestID)
		w.Header().Set(Header, requestID)

		ctx := context.WithValue(r.Context(), chimw.RequestIDKey, requestID)
		ctx = NewContext(ctx, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func resolve(header http.Header) (string, error) {
	if trace := header.Get(albTraceHeader); trace != "" {
		if requestID, ok := albRequestID(trace); ok {
			return requestID, nil
		}
		return generate()
	}

	if requestID := header.Get(Header); valid(requestID) {
		return requestID, nil
	}
	return generate()
}

func albRequestID(trace string) (string, bool) {
	if len(trace) > maxALBTraceSize {
		return "", false
	}

	var self, root string
	var seenSelf, seenRoot bool
	for field := range strings.SplitSeq(trace, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(field), "=")
		if !ok {
			continue
		}
		switch key {
		case "Self":
			if seenSelf {
				return "", false
			}
			seenSelf = true
			self = strings.TrimSpace(value)
		case "Root":
			if seenRoot {
				return "", false
			}
			seenRoot = true
			root = strings.TrimSpace(value)
		}
	}
	if seenSelf {
		return self, validALB(self)
	}
	return root, seenRoot && validALB(root)
}

func valid(value string) bool {
	return validGenerated(value) || validALB(value)
}

func validGenerated(value string) bool {
	const prefix = "req_"
	if len(value) != 26 || !strings.HasPrefix(value, prefix) {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	return err == nil && len(raw) == 16
}

func validALB(value string) bool {
	if len(value) != 35 || value[0] != '1' || value[1] != '-' || value[10] != '-' {
		return false
	}
	for i, char := range value {
		if i == 0 || i == 1 || i == 10 {
			continue
		}
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func generate() (string, error) {
	var random [16]byte
	n, err := readRandom(random[:])
	if err != nil {
		return "", err
	}
	if n != len(random) {
		return "", io.ErrUnexpectedEOF
	}
	return "req_" + base64.RawURLEncoding.EncodeToString(random[:]), nil
}

type Handler struct {
	inner slog.Handler
}

func NewHandler(inner slog.Handler) *Handler {
	return &Handler{inner: inner}
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	if id := FromContext(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.inner.Handle(ctx, r)
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &Handler{inner: h.inner.WithAttrs(attrs)}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	return &Handler{inner: h.inner.WithGroup(name)}
}
