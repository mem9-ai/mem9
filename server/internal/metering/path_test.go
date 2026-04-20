package metering

import "testing"

func TestMinuteAlign(t *testing.T) {
	cases := []struct {
		name string
		in   int64
		want int64
	}{
		{"zero", 0, 0},
		{"already aligned", 1710000000, 1710000000},
		{"mid minute", 1710000037, 1710000000},
		{"one second past minute", 1710000001, 1710000000},
		{"negative becomes zero", -5, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := minuteAlign(tc.in); got != tc.want {
				t.Errorf("minuteAlign(%d) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestBuildKey(t *testing.T) {
	cases := []struct {
		name     string
		prefix   string
		category string
		tenant   string
		cluster  string
		ts       int64
		part     int
		want     string
	}{
		{
			name:     "no prefix",
			prefix:   "",
			category: "mem9-api",
			tenant:   "tenant-a",
			cluster:  "10006636",
			ts:       1710000000,
			part:     0,
			want:     "metering/mem9/1710000000/mem9-api/tenant-a/10006636-0.json.gz",
		},
		{
			name:     "with prefix",
			prefix:   "mem9-prod",
			category: "mem9-api",
			tenant:   "tenant-a",
			cluster:  "10006636",
			ts:       1710000000,
			part:     0,
			want:     "mem9-prod/metering/mem9/1710000000/mem9-api/tenant-a/10006636-0.json.gz",
		},
		{
			name:     "empty cluster becomes underscore",
			prefix:   "",
			category: "mem9-api",
			tenant:   "tenant-a",
			cluster:  "",
			ts:       1710000000,
			part:     3,
			want:     "metering/mem9/1710000000/mem9-api/tenant-a/_-3.json.gz",
		},
		{
			name:     "prefix with leading and trailing slashes",
			prefix:   "/mem9-prod/",
			category: "mem9-llm",
			tenant:   "t1",
			cluster:  "c1",
			ts:       1710000060,
			part:     2,
			want:     "mem9-prod/metering/mem9/1710000060/mem9-llm/t1/c1-2.json.gz",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildKey(tc.prefix, tc.category, tc.tenant, tc.cluster, tc.ts, tc.part)
			if got != tc.want {
				t.Errorf("buildKey:\n  got  %s\n  want %s", got, tc.want)
			}
		})
	}
}
