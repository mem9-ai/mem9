package metering

import (
	"bytes"
	"compress/gzip"
	"io"
	"testing"
)

func TestGzipPool_RoundTrip(t *testing.T) {
	p := newGzipPool()
	input := []byte(`{"hello":"world","ts":1710000000,"data":[1,2,3]}`)

	compressed, err := p.compress(input)
	if err != nil {
		t.Fatalf("compress: %v", err)
	}
	if len(compressed) == 0 {
		t.Fatal("compressed output is empty")
	}

	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("io.ReadAll: %v", err)
	}
	if !bytes.Equal(got, input) {
		t.Errorf("round-trip mismatch:\n  got  %s\n  want %s", got, input)
	}
}

func TestGzipPool_Reuse(t *testing.T) {
	p := newGzipPool()
	inputs := [][]byte{
		[]byte(`{"a":1}`),
		[]byte(`{"b":2,"c":3}`),
		[]byte(`{"nested":{"deep":{"thing":"here"}}}`),
	}
	for i, in := range inputs {
		compressed, err := p.compress(in)
		if err != nil {
			t.Fatalf("compress[%d]: %v", i, err)
		}
		r, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			t.Fatalf("reader[%d]: %v", i, err)
		}
		got, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatalf("read[%d]: %v", i, err)
		}
		if !bytes.Equal(got, in) {
			t.Errorf("reuse[%d] mismatch:\n  got  %s\n  want %s", i, got, in)
		}
	}
}
