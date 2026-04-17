package metering

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type fakePut struct {
	Bucket string
	Key    string
	Body   []byte
}

type fakeS3 struct {
	mu  sync.Mutex
	ops []fakePut
	err error
}

func (f *fakeS3) PutObject(ctx context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	var body []byte
	if in.Body != nil {
		data, err := io.ReadAll(in.Body)
		if err != nil {
			return nil, err
		}
		body = append([]byte(nil), data...)
	}

	bucket := ""
	if in.Bucket != nil {
		bucket = *in.Bucket
	}
	key := ""
	if in.Key != nil {
		key = *in.Key
	}

	f.mu.Lock()
	f.ops = append(f.ops, fakePut{Bucket: bucket, Key: key, Body: body})
	f.mu.Unlock()

	if f.err != nil {
		return nil, f.err
	}
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeS3) snapshot() []fakePut {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]fakePut, len(f.ops))
	copy(out, f.ops)
	return out
}

type payload struct {
	Timestamp int64            `json:"timestamp"`
	Category  string           `json:"category"`
	TenantID  string           `json:"tenant_id"`
	ClusterID string           `json:"cluster_id"`
	Part      int              `json:"part"`
	Data      []map[string]any `json:"data"`
}

func newTestLogger() (*slog.Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return logger, buf
}

func decodePayload(t *testing.T, body []byte) payload {
	t.Helper()
	r, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer r.Close()

	raw, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("io.ReadAll: %v", err)
	}

	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return p
}

func waitForOps(t *testing.T, f *fakeS3, want int, timeout time.Duration) []fakePut {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		ops := f.snapshot()
		if len(ops) == want {
			return ops
		}
		time.Sleep(5 * time.Millisecond)
	}
	ops := f.snapshot()
	t.Fatalf("timed out waiting for %d ops, got %d", want, len(ops))
	return nil
}

func newManualWriter(cfg Config, client s3PutObjecter, logger *slog.Logger, now time.Time) *s3Writer {
	cfg = cfg.withDefaults()
	return &s3Writer{
		cfg:     cfg,
		s3:      client,
		bucket:  cfg.Bucket,
		logger:  logger,
		batches: make(map[batchKey][]map[string]any),
		parts:   make(map[batchKey]int),
		gz:      newGzipPool(),
		now: func() time.Time {
			return now
		},
	}
}

func TestNew_Disabled_ReturnsNoop(t *testing.T) {
	logger, buf := newTestLogger()
	w, err := New(context.Background(), Config{Enabled: false, Bucket: "bucket"}, logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := w.(noopWriter); !ok {
		t.Fatalf("New returned %T, want noopWriter", w)
	}
	if !strings.Contains(buf.String(), "metering disabled") {
		t.Fatalf("expected disabled log, got %q", buf.String())
	}
}

func TestNew_EmptyBucket_ReturnsNoop(t *testing.T) {
	logger, buf := newTestLogger()
	w, err := New(context.Background(), Config{Enabled: true, Bucket: ""}, logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := w.(noopWriter); !ok {
		t.Fatalf("New returned %T, want noopWriter", w)
	}
	if !strings.Contains(buf.String(), "bucket_set=false") {
		t.Fatalf("expected bucket_set=false log, got %q", buf.String())
	}
}

func TestRecord_SingleEvent_Flushes(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", AgentID: "agent-a", Data: map[string]any{"op": "store"}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	ops := waitForOps(t, client, 1, time.Second)
	if ops[0].Key != "metering/mem9/1710000000/mem9-api/tenant-a/10006636-0.json.gz" {
		t.Fatalf("unexpected key %q", ops[0].Key)
	}
	p := decodePayload(t, ops[0].Body)
	if p.Timestamp != 1710000000 || p.Category != "mem9-api" || p.TenantID != "tenant-a" || p.ClusterID != "10006636" || p.Part != 0 {
		t.Fatalf("unexpected payload header: %+v", p)
	}
	if len(p.Data) != 1 {
		t.Fatalf("payload data len = %d, want 1", len(p.Data))
	}
	if got := p.Data[0]["agent_id"]; got != "agent-a" {
		t.Fatalf("agent_id = %v, want agent-a", got)
	}
	if got := p.Data[0]["op"]; got != "store" {
		t.Fatalf("op = %v, want store", got)
	}
	if got := int64(p.Data[0]["recorded_at"].(float64)); got != fixed.Unix() {
		t.Fatalf("recorded_at = %d, want %d", got, fixed.Unix())
	}
}

func TestRecord_Batches_MultipleEvents(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	for i := 0; i < 3; i++ {
		w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", AgentID: "agent-a", Data: map[string]any{"n": i}})
	}
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	ops := waitForOps(t, client, 1, time.Second)
	p := decodePayload(t, ops[0].Body)
	if len(p.Data) != 3 {
		t.Fatalf("payload data len = %d, want 3", len(p.Data))
	}
}

func TestRecord_GroupsByKey_ProducesMultipleObjects(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "update"}})
	w.Record(Event{Category: "mem9-llm", TenantID: "tenant-b", ClusterID: "10006637", Data: map[string]any{"op": "llm"}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	ops := waitForOps(t, client, 2, time.Second)
	seen := map[string]struct{}{}
	for _, op := range ops {
		seen[op.Key] = struct{}{}
	}
	want := []string{
		"metering/mem9/1710000000/mem9-api/tenant-a/10006636-0.json.gz",
		"metering/mem9/1710000000/mem9-llm/tenant-b/10006637-0.json.gz",
	}
	for _, key := range want {
		if _, ok := seen[key]; !ok {
			t.Fatalf("missing key %q in %#v", key, seen)
		}
	}
}

func TestFlush_IncrementsPart_WithinSameMinute(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newManualWriter(Config{Enabled: true, Bucket: "bucket"}, client, logger, fixed)
	key := batchKey{TsMinute: 1710000000, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}

	w.enqueue(Event{Category: key.Category, TenantID: key.TenantID, ClusterID: key.ClusterID, Data: map[string]any{"op": "store"}})
	w.flushAll(context.Background())
	w.enqueue(Event{Category: key.Category, TenantID: key.TenantID, ClusterID: key.ClusterID, Data: map[string]any{"op": "update"}})
	w.flushAll(context.Background())

	ops := client.snapshot()
	if len(ops) != 2 {
		t.Fatalf("ops len = %d, want 2", len(ops))
	}
	seen := map[string]struct{}{}
	for _, op := range ops {
		seen[op.Key] = struct{}{}
	}
	for _, key := range []string{
		"metering/mem9/1710000000/mem9-api/tenant-a/10006636-0.json.gz",
		"metering/mem9/1710000000/mem9-api/tenant-a/10006636-1.json.gz",
	} {
		if _, ok := seen[key]; !ok {
			t.Fatalf("missing key %q in %#v", key, seen)
		}
	}
	if got := w.parts[key]; got != 2 {
		t.Fatalf("part counter = %d, want 2", got)
	}
}

func TestFlush_LossyOnError_LogsAndContinues(t *testing.T) {
	client := &fakeS3{err: errors.New("boom")}
	logger, buf := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newManualWriter(Config{Enabled: true, Bucket: "bucket"}, client, logger, fixed)
	key := batchKey{TsMinute: 1710000000, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}

	w.enqueue(Event{Category: key.Category, TenantID: key.TenantID, ClusterID: key.ClusterID, Data: map[string]any{"op": "store"}})
	w.flushAll(context.Background())

	if !strings.Contains(buf.String(), "metering: flush failed, dropping batch") {
		t.Fatalf("expected flush failure log, got %q", buf.String())
	}
	if got := w.parts[key]; got != 1 {
		t.Fatalf("part counter = %d, want 1", got)
	}
	if len(w.batches) != 0 {
		t.Fatalf("batches not cleared: %+v", w.batches)
	}
}

func TestRecord_ChannelFull_DoesNotBlock(t *testing.T) {
	logger, buf := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := &s3Writer{
		logger: logger,
		ch:     make(chan Event, 1),
		now: func() time.Time {
			return fixed
		},
	}
	w.ch <- Event{Category: "mem9-api", TenantID: "tenant-a"}

	start := time.Now()
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a"})
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a"})
	if time.Since(start) > 50*time.Millisecond {
		t.Fatalf("Record blocked too long: %v", time.Since(start))
	}
	if count := strings.Count(buf.String(), "metering: event channel full, dropping event"); count != 1 {
		t.Fatalf("warning count = %d, want 1; logs=%q", count, buf.String())
	}
}

func TestClose_FlushesPending(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "update"}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	ops := waitForOps(t, client, 1, time.Second)
	p := decodePayload(t, ops[0].Body)
	if len(p.Data) != 2 {
		t.Fatalf("payload data len = %d, want 2", len(p.Data))
	}
}

func TestClose_Idempotent(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	ops := waitForOps(t, client, 1, time.Second)
	if len(ops) != 1 {
		t.Fatalf("ops len = %d, want 1", len(ops))
	}
}

func TestRecord_MalformedEvent_DroppedSilently(t *testing.T) {
	client := &fakeS3{}
	logger, buf := newTestLogger()
	fixed := time.Unix(1710000037, 0).UTC()
	w := newS3Writer(Config{Enabled: true, Bucket: "bucket", FlushInterval: time.Hour, ChannelSize: 8}.withDefaults(), client, logger)
	w.now = func() time.Time { return fixed }

	w.Record(Event{Category: "", TenantID: "tenant-a", Data: map[string]any{"op": "bad1"}})
	w.Record(Event{Category: "mem9-api", TenantID: "", Data: map[string]any{"op": "bad2"}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if got := len(client.snapshot()); got != 0 {
		t.Fatalf("ops len = %d, want 0", got)
	}
	if strings.Contains(buf.String(), "channel full") || strings.Contains(buf.String(), "flush failed") {
		t.Fatalf("unexpected logs for malformed events: %q", buf.String())
	}
}

func TestGzipRoundTrip(t *testing.T) {
	p := newGzipPool()
	input := []byte(`{"category":"mem9-api","tenant_id":"tenant-a","cluster_id":"10006636"}`)
	compressed, err := p.compress(input)
	if err != nil {
		t.Fatalf("compress: %v", err)
	}

	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer r.Close()
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("io.ReadAll: %v", err)
	}
	if !bytes.Equal(got, input) {
		t.Fatalf("round-trip mismatch: got %q want %q", got, input)
	}
}
