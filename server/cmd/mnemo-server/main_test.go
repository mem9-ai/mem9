package main

import "testing"

func TestRedactMeteringURLForLog(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"s3", "s3://bucket-a/prefix-a/?token=secret", "s3://bucket-a"},
		{"https with query and userinfo", "https://user:pass@example.com/hook?token=secret", "https://example.com"},
		{"http", "http://hooks.example.com/path/to/hook", "http://hooks.example.com"},
		{"invalid", "://bad url", "<invalid>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := redactMeteringURLForLog(tc.in); got != tc.want {
				t.Fatalf("redactMeteringURLForLog(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
