package metering

import (
	"bytes"
	"compress/gzip"
	"sync"
)

// gzipPool holds a single reusable gzip.Writer + bytes.Buffer pair.
// All methods are safe for concurrent callers. In practice only the
// background flusher goroutine calls compress(), so the mutex is
// precautionary rather than a hot path.
//
// Reusing the writer avoids allocating ~64KB of gzip state on every
// flush. Copied verbatim (minus logging and the buggy Close) from
// pingcap/metering_sdk/writer/metering/metering_writer.go#compressDataReuse.
type gzipPool struct {
	mu  sync.Mutex
	buf *bytes.Buffer
	w   *gzip.Writer
}

// newGzipPool returns a ready-to-use gzipPool. Never returns nil.
func newGzipPool() *gzipPool {
	buf := &bytes.Buffer{}
	return &gzipPool{
		buf: buf,
		w:   gzip.NewWriter(buf),
	}
}

// compress gzips data and returns a copy of the compressed bytes. The
// returned slice is owned by the caller; subsequent calls to compress
// reuse the internal buffer.
func (p *gzipPool) compress(data []byte) ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.buf.Reset()
	p.w.Reset(p.buf)

	if _, err := p.w.Write(data); err != nil {
		return nil, err
	}
	if err := p.w.Close(); err != nil {
		return nil, err
	}

	out := make([]byte, p.buf.Len())
	copy(out, p.buf.Bytes())
	return out, nil
}
