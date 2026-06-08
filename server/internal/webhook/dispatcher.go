package webhook

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"time"
)

type DispatcherConfig struct {
	PollInterval time.Duration
	BatchSize    int
	Timeout      time.Duration
	MaxAttempts  int
}

type Dispatcher struct {
	store  Store
	svc    *Service
	client *http.Client
	cfg    DispatcherConfig
	logger *slog.Logger
}

func NewDispatcher(store Store, svc *Service, cfg DispatcherConfig, logger *slog.Logger) *Dispatcher {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 25
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 8
	}
	if logger == nil {
		logger = slog.Default()
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: guardedDialContext(
			&net.Dialer{
				Timeout:   cfg.Timeout,
				KeepAlive: 30 * time.Second,
			},
			svc != nil && svc.allowLocalHTTP,
		),
		TLSHandshakeTimeout:   cfg.Timeout,
		ResponseHeaderTimeout: cfg.Timeout,
	}
	return &Dispatcher{
		store: store,
		svc:   svc,
		client: &http.Client{
			Timeout:   cfg.Timeout,
			Transport: transport,
			CheckRedirect: func(req *http.Request, _ []*http.Request) error {
				return validateDeliveryURL(req.Context(), req.URL.String(), svc != nil && svc.allowLocalHTTP)
			},
		},
		cfg:    cfg,
		logger: logger,
	}
}

func (d *Dispatcher) Run(ctx context.Context) error {
	ticker := time.NewTicker(d.cfg.PollInterval)
	defer ticker.Stop()
	for {
		if err := d.drain(ctx); err != nil && err != context.Canceled {
			d.logger.WarnContext(ctx, "webhook dispatcher drain failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (d *Dispatcher) drain(ctx context.Context) error {
	jobs, err := d.store.FetchDueDeliveries(ctx, d.cfg.BatchSize)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if err := d.deliver(ctx, job); err != nil {
			d.logger.WarnContext(ctx, "webhook delivery failed", "delivery_id", job.ID, "event_id", job.EventID, "err", err)
		}
	}
	return nil
}

func (d *Dispatcher) deliver(ctx context.Context, job DeliveryJob) error {
	secret, err := d.svc.DecryptSecret(ctx, job.SecretCiphertext)
	if err != nil {
		return d.recordFailure(ctx, job, nil, fmt.Errorf("decrypt webhook secret: %w", err))
	}
	if err := validateDeliveryURL(ctx, job.URL, d.svc != nil && d.svc.allowLocalHTTP); err != nil {
		return d.recordFailure(ctx, job, nil, err)
	}
	timestamp := time.Now().Unix()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, job.URL, bytes.NewReader(job.Payload))
	if err != nil {
		return d.recordFailure(ctx, job, nil, fmt.Errorf("build webhook request: %w", err))
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "mem9-webhooks/1")
	req.Header.Set("X-Mem9-Event-Id", job.EventID)
	req.Header.Set("X-Mem9-Event-Type", job.EventType)
	req.Header.Set("X-Mem9-Timestamp", fmt.Sprintf("%d", timestamp))
	req.Header.Set("X-Mem9-Signature", SignPayload(secret, timestamp, job.EventID, job.Payload))

	resp, err := d.client.Do(req)
	if err != nil {
		return d.recordFailure(ctx, job, nil, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return d.store.MarkDeliveryDelivered(ctx, job.ID, resp.StatusCode)
	}
	return d.recordFailure(ctx, job, &resp.StatusCode, fmt.Errorf("webhook returned status %d", resp.StatusCode))
}

func guardedDialContext(dialer *net.Dialer, allowLocalHTTP bool) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := allowedDestinationIPs(ctx, host, allowLocalHTTP)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, ip := range ips {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("webhook destination has no allowed IPs")
	}
}

func (d *Dispatcher) recordFailure(ctx context.Context, job DeliveryJob, httpStatus *int, err error) error {
	nextAttempt := job.AttemptCount + 1
	terminal := nextAttempt >= d.cfg.MaxAttempts
	next := time.Now().UTC().Add(backoff(nextAttempt))
	if terminal {
		next = time.Now().UTC()
	}
	if markErr := d.store.MarkDeliveryFailedAttempt(ctx, job.ID, terminal, next, httpStatus, err.Error()); markErr != nil {
		return markErr
	}
	return err
}

func backoff(attempt int) time.Duration {
	switch {
	case attempt <= 1:
		return time.Minute
	case attempt == 2:
		return 5 * time.Minute
	case attempt == 3:
		return 30 * time.Minute
	case attempt == 4:
		return 2 * time.Hour
	case attempt == 5:
		return 6 * time.Hour
	default:
		return 24 * time.Hour
	}
}
