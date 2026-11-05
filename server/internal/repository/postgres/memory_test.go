package postgres

import (
	"database/sql"
	"testing"
)

func TestParseVec(t *testing.T) {
	tests := []struct {
		name string
		in   sql.NullString
		want []float32
	}{
		{name: "null", in: sql.NullString{}, want: nil},
		{name: "empty", in: sql.NullString{String: "", Valid: true}, want: nil},
		{name: "vector", in: sql.NullString{String: "[0.25,-0.5,1]", Valid: true}, want: []float32{0.25, -0.5, 1}},
		{name: "malformed", in: sql.NullString{String: "[0.25,x]", Valid: true}, want: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseVec(tt.in)
			if len(got) != len(tt.want) {
				t.Fatalf("parseVec(%q) = %v, want %v", tt.in.String, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("parseVec(%q)[%d] = %v, want %v", tt.in.String, i, got[i], tt.want[i])
				}
			}
		})
	}
}
