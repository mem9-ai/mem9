package metering

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
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

type s3Payload struct {
	Timestamp int64            `json:"timestamp"`
	Category  string           `json:"category"`
	TenantID  string           `json:"tenant_id"`
	ClusterID string           `json:"cluster_id"`
	Part      int              `json:"part"`
	Data      []map[string]any `json:"data"`
}

type webhookPayload struct {
	ID        string                 `json:"id"`
	EventType string                 `json:"event_type"`
	CreatedAt string                 `json:"created_at"`
	Payload   map[string]any         `json:"payload"`
	Metadata  map[string]interface{} `json:"metadata"`
}

func newTestLogger() (*slog.Logger, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return logger, buf
}

func decodePayload(t *testing.T, body []byte) s3Payload {
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

	var p s3Payload
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

func newManualTransportWriter(cfg Config, transport batchTransport, logger *slog.Logger, now time.Time) *transportWriter {
	cfg = cfg.withDefaults()
	return &transportWriter{
		cfg:       cfg,
		transport: transport,
		logger:    logger,
		batches:   make(map[batchKey][]map[string]any),
		parts:     make(map[batchKey]int),
		now: func() time.Time {
			return now
		},
	}
}

func newManualWriter(cfg Config, client s3PutObjecter, logger *slog.Logger, now time.Time) *transportWriter {
	return newManualTransportWriter(cfg, newS3Transport(cfg.Bucket, cfg.Prefix, client), logger, now)
}

type blockingTransport struct {
	entered   chan struct{}
	exited    chan struct{}
	enterOnce sync.Once
	exitOnce  sync.Once
}

type noopTransport struct{}

type retryAfterCancelTransport struct {
	mu       sync.Mutex
	attempts int
	started  chan struct{}
}

func (t *blockingTransport) Write(ctx context.Context, payload batchPayload) error {
	t.enterOnce.Do(func() { close(t.entered) })
	<-ctx.Done()
	t.exitOnce.Do(func() { close(t.exited) })
	return ctx.Err()
}

func (noopTransport) Write(ctx context.Context, payload batchPayload) error {
	return nil
}

func (t *retryAfterCancelTransport) Write(ctx context.Context, payload batchPayload) error {
	t.mu.Lock()
	t.attempts++
	attempt := t.attempts
	t.mu.Unlock()

	if attempt == 1 {
		close(t.started)
		<-ctx.Done()
		return ctx.Err()
	}
	return nil
}

func (t *retryAfterCancelTransport) Attempts() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.attempts
}

func setConfigStringField(t *testing.T, cfg *Config, field, value string) {
	t.Helper()
	v := reflect.ValueOf(cfg).Elem().FieldByName(field)
	if !v.IsValid() {
		t.Fatalf("Config missing %s field", field)
	}
	v.SetString(value)
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

func TestNew_EmptyURL_ReturnsNoop(t *testing.T) {
	logger, buf := newTestLogger()
	w, err := New(context.Background(), Config{Enabled: true, URL: ""}, logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, ok := w.(noopWriter); !ok {
		t.Fatalf("New returned %T, want noopWriter", w)
	}
	if !strings.Contains(buf.String(), "url_set=false") {
		t.Fatalf("expected url_set=false log, got %q", buf.String())
	}
}

func TestNew_HTTPURL_PostsWebhookJSON(t *testing.T) {
	type requestRecord struct {
		contentType string
		payload     webhookPayload
	}
	reqCh := make(chan requestRecord, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("io.ReadAll: %v", err)
		}
		var p webhookPayload
		if err := json.Unmarshal(body, &p); err != nil {
			t.Fatalf("json.Unmarshal: %v", err)
		}
		reqCh <- requestRecord{contentType: r.Header.Get("Content-Type"), payload: p}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	logger, _ := newTestLogger()
	cfg := Config{Enabled: true, FlushInterval: time.Hour}
	setConfigStringField(t, &cfg, "URL", server.URL)
	w, err := New(context.Background(), cfg, logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ww, ok := w.(*webhookWriter)
	if !ok {
		t.Fatalf("New returned %T, want *webhookWriter", w)
	}
	fixed := time.Unix(1710000003, 0).UTC()
	var idCounter int
	ww.now = func() time.Time { return fixed }
	ww.idFn = func() string {
		idCounter++
		return "evt-test-" + string(rune('0'+idCounter))
	}

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"event_type": "recall", "recall_call_count": 1}})
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"event_type": "ingest", "active_memory_count": 126}})
	if err := w.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}

	gotRequests := make([]requestRecord, 0, 2)
	for i := 0; i < 2; i++ {
		select {
		case got := <-reqCh:
			gotRequests = append(gotRequests, got)
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for webhook request")
		}
	}

	for i, got := range gotRequests {
		if got.contentType != "application/json" {
			t.Fatalf("request[%d] Content-Type = %q, want application/json", i, got.contentType)
		}
		if got.payload.ID == "" {
			t.Fatalf("request[%d] missing event id", i)
		}
		if got.payload.CreatedAt != "2024-03-09T16:00:03Z" {
			t.Fatalf("request[%d] created_at = %q, want 2024-03-09T16:00:03Z", i, got.payload.CreatedAt)
		}
		if got.payload.Metadata["tenant_id"] != "tenant-a" || got.payload.Metadata["cluster_id"] != "10006636" {
			t.Fatalf("request[%d] unexpected metadata: %+v", i, got.payload.Metadata)
		}
	}

	if gotRequests[0].payload.EventType != "recall" {
		t.Fatalf("first event_type = %q, want recall", gotRequests[0].payload.EventType)
	}
	if gotRequests[0].payload.Payload["recall_call_count"] != float64(1) {
		t.Fatalf("first payload = %+v, want recall_call_count=1", gotRequests[0].payload.Payload)
	}
	if _, ok := gotRequests[0].payload.Payload["event_type"]; ok {
		t.Fatalf("first payload unexpectedly retained event_type: %+v", gotRequests[0].payload.Payload)
	}
	if gotRequests[1].payload.EventType != "ingest" {
		t.Fatalf("second event_type = %q, want ingest", gotRequests[1].payload.EventType)
	}
	if gotRequests[1].payload.Payload["active_memory_count"] != float64(126) {
		t.Fatalf("second payload = %+v, want active_memory_count=126", gotRequests[1].payload.Payload)
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

func TestFlush_PrunesStalePartCounters(t *testing.T) {
	client := &fakeS3{}
	logger, _ := newTestLogger()
	oldTime := time.Unix(1710000037, 0).UTC()
	newTime := time.Unix(1710000097, 0).UTC()
	w := newManualWriter(Config{Enabled: true, Bucket: "bucket"}, client, logger, oldTime)
	oldKey := batchKey{TsMinute: 1710000000, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}
	newKey := batchKey{TsMinute: 1710000060, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}

	w.enqueue(Event{Category: oldKey.Category, TenantID: oldKey.TenantID, ClusterID: oldKey.ClusterID, Data: map[string]any{"op": "store"}})
	w.flushAll(context.Background())
	if got := w.parts[oldKey]; got != 1 {
		t.Fatalf("old part counter = %d, want 1", got)
	}

	w.now = func() time.Time { return newTime }
	w.enqueue(Event{Category: newKey.Category, TenantID: newKey.TenantID, ClusterID: newKey.ClusterID, Data: map[string]any{"op": "update"}})
	w.flushAll(context.Background())

	if _, ok := w.parts[oldKey]; ok {
		t.Fatalf("stale part counter for %+v was not pruned: %+v", oldKey, w.parts)
	}
	if got := w.parts[newKey]; got != 1 {
		t.Fatalf("new part counter = %d, want 1", got)
	}
}

func TestPruneStaleParts_PreservesPendingOldMinuteBacklog(t *testing.T) {
	oldTime := time.Unix(1710000037, 0).UTC()
	newTime := time.Unix(1710000097, 0).UTC()
	oldKey := batchKey{TsMinute: 1710000000, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}

	w := &transportWriter{
		transport: noopTransport{},
		ch:        make(chan queuedEvent, 1),
		batches:   make(map[batchKey][]map[string]any),
		parts:     map[batchKey]int{oldKey: 1},
		pending:   make(map[batchKey]int),
		now: func() time.Time {
			return oldTime
		},
	}

	w.Record(Event{Category: oldKey.Category, TenantID: oldKey.TenantID, ClusterID: oldKey.ClusterID, Data: map[string]any{"op": "store"}})
	if got := w.pending[oldKey]; got != 1 {
		t.Fatalf("pending[%+v] = %d, want 1", oldKey, got)
	}

	w.now = func() time.Time { return newTime }
	w.pruneStaleParts(minuteAlign(newTime.Unix()))
	if _, ok := w.parts[oldKey]; !ok {
		t.Fatal("old part counter pruned while old-minute event was still pending in the channel")
	}

	item := <-w.ch
	w.enqueueQueued(item)
	w.flushAll(context.Background())
	if _, ok := w.parts[oldKey]; ok {
		t.Fatal("old part counter was not pruned after pending old-minute backlog was drained")
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
	w := &transportWriter{
		logger: logger,
		ch:     make(chan queuedEvent, 1),
		parts:  make(map[batchKey]int),
		now: func() time.Time {
			return fixed
		},
	}
	w.ch <- w.makeQueuedEvent(Event{Category: "mem9-api", TenantID: "tenant-a"})

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

func TestClose_CancelsPeriodicTransportWrite(t *testing.T) {
	transport := &blockingTransport{
		entered: make(chan struct{}),
		exited:  make(chan struct{}),
	}
	logger, _ := newTestLogger()
	w := newTransportWriter(Config{Enabled: true, FlushInterval: 10 * time.Millisecond}.withDefaults(), transport, logger)

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})

	select {
	case <-transport.entered:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for periodic transport write to start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := w.Close(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Close error = %v, want context deadline exceeded", err)
	}

	select {
	case <-transport.exited:
	case <-time.After(time.Second):
		t.Fatal("periodic transport write did not observe close cancellation")
	}
}

func TestClose_RetriesCanceledPeriodicBatchWithShutdownContext(t *testing.T) {
	transport := &retryAfterCancelTransport{started: make(chan struct{})}
	logger, _ := newTestLogger()
	w := newTransportWriter(Config{Enabled: true, FlushInterval: 10 * time.Millisecond}.withDefaults(), transport, logger)

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})

	select {
	case <-transport.started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for periodic transport write to start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := w.Close(ctx); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if got := transport.Attempts(); got != 2 {
		t.Fatalf("transport attempts = %d, want 2", got)
	}
	if len(w.batches) != 0 {
		t.Fatalf("batches not drained after shutdown retry: %+v", w.batches)
	}
}

func TestRecord_CapturesTimestampBeforeDequeue(t *testing.T) {
	oldTime := time.Unix(1710000037, 0).UTC()
	newTime := time.Unix(1710000097, 0).UTC()
	w := &transportWriter{
		ch:      make(chan queuedEvent, 1),
		batches: make(map[batchKey][]map[string]any),
		parts:   make(map[batchKey]int),
		now: func() time.Time {
			return oldTime
		},
	}

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", AgentID: "agent-a", Data: map[string]any{"op": "store"}})
	w.now = func() time.Time { return newTime }
	item := <-w.ch
	w.enqueueQueued(item)

	oldKey := batchKey{TsMinute: minuteAlign(oldTime.Unix()), Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}
	records := w.batches[oldKey]
	if len(records) != 1 {
		t.Fatalf("records len = %d, want 1", len(records))
	}
	if got := int64(records[0]["recorded_at"].(int64)); got != oldTime.Unix() {
		t.Fatalf("recorded_at = %d, want %d", got, oldTime.Unix())
	}
	if _, ok := w.batches[batchKey{TsMinute: minuteAlign(newTime.Unix()), Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}]; ok {
		t.Fatal("event was bucketed using dequeue time instead of record time")
	}
}

func TestRecord_CopiesPayloadBeforeQueueingAsyncWrite(t *testing.T) {
	fixed := time.Unix(1710000037, 0).UTC()
	w := &transportWriter{
		ch:      make(chan queuedEvent, 1),
		batches: make(map[batchKey][]map[string]any),
		parts:   make(map[batchKey]int),
		now: func() time.Time {
			return fixed
		},
	}

	data := map[string]any{"op": "store", "count": 1}
	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: data})
	data["op"] = "mutated"
	data["extra"] = "new-value"

	item := <-w.ch
	w.enqueueQueued(item)

	key := batchKey{TsMinute: minuteAlign(fixed.Unix()), Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}
	records := w.batches[key]
	if len(records) != 1 {
		t.Fatalf("records len = %d, want 1", len(records))
	}
	if got := records[0]["op"]; got != "store" {
		t.Fatalf("op = %v, want store", got)
	}
	if got := records[0]["count"]; got != 1 {
		t.Fatalf("count = %v, want 1", got)
	}
	if _, ok := records[0]["extra"]; ok {
		t.Fatal("queued payload observed post-Record mutation")
	}
}

func TestRecord_DeepCopiesNestedPayloadBeforeQueueing(t *testing.T) {
	fixed := time.Unix(1710000037, 0).UTC()
	w := &transportWriter{
		ch:      make(chan queuedEvent, 1),
		batches: make(map[batchKey][]map[string]any),
		parts:   make(map[batchKey]int),
		now: func() time.Time {
			return fixed
		},
	}

	nestedMap := map[string]any{"phase": "store"}
	nestedSliceMap := map[string]any{"n": 1}
	nestedSlice := []any{nestedSliceMap, "tail"}
	data := map[string]any{
		"meta":  nestedMap,
		"items": nestedSlice,
	}

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: data})
	nestedMap["phase"] = "mutated"
	nestedSliceMap["n"] = 2
	nestedSlice[1] = "changed"

	item := <-w.ch
	w.enqueueQueued(item)

	key := batchKey{TsMinute: minuteAlign(fixed.Unix()), Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}
	records := w.batches[key]
	if len(records) != 1 {
		t.Fatalf("records len = %d, want 1", len(records))
	}
	meta, ok := records[0]["meta"].(map[string]any)
	if !ok {
		t.Fatalf("meta type = %T, want map[string]any", records[0]["meta"])
	}
	if got := meta["phase"]; got != "store" {
		t.Fatalf("meta.phase = %v, want store", got)
	}
	items, ok := records[0]["items"].([]any)
	if !ok {
		t.Fatalf("items type = %T, want []any", records[0]["items"])
	}
	if got := items[1]; got != "tail" {
		t.Fatalf("items[1] = %v, want tail", got)
	}
	itemMap, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("items[0] type = %T, want map[string]any", items[0])
	}
	if got := itemMap["n"]; got != 1 {
		t.Fatalf("items[0].n = %v, want 1", got)
	}
}

func TestPruneStaleParts_PreservesBufferedOldMinuteBatch(t *testing.T) {
	oldTime := time.Unix(1710000037, 0).UTC()
	newTime := time.Unix(1710000097, 0).UTC()
	oldKey := batchKey{TsMinute: 1710000000, Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636"}

	w := &transportWriter{
		batches: map[batchKey][]map[string]any{
			oldKey: {{"op": "store"}},
		},
		parts:   map[batchKey]int{oldKey: 1},
		pending: make(map[batchKey]int),
		now: func() time.Time {
			return oldTime
		},
	}

	w.now = func() time.Time { return newTime }
	w.pruneStaleParts(minuteAlign(newTime.Unix()))
	if _, ok := w.parts[oldKey]; !ok {
		t.Fatal("old part counter pruned while stale batch was still buffered")
	}

	delete(w.batches, oldKey)
	w.pruneStaleParts(minuteAlign(newTime.Unix()))
	if _, ok := w.parts[oldKey]; ok {
		t.Fatal("old part counter was not pruned after buffered batch was cleared")
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

func TestClose_PropagatesDeadlineToTransportWrites(t *testing.T) {
	transport := &blockingTransport{
		entered: make(chan struct{}),
		exited:  make(chan struct{}),
	}
	logger, _ := newTestLogger()
	w := newTransportWriter(Config{Enabled: true, FlushInterval: time.Hour}.withDefaults(), transport, logger)

	w.Record(Event{Category: "mem9-api", TenantID: "tenant-a", ClusterID: "10006636", Data: map[string]any{"op": "store"}})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- w.Close(ctx)
	}()

	select {
	case <-transport.entered:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for transport write to start")
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("Close error = %v, want context deadline exceeded", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for Close to return")
	}

	select {
	case <-transport.exited:
	case <-time.After(time.Second):
		t.Fatal("transport write did not observe close context cancellation")
	}
	if len(w.batches) == 0 {
		t.Fatal("batches were cleared despite shutdown context cancellation")
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
