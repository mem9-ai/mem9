package metering

import (
	"strconv"
	"strings"
)

// minuteAlign truncates a Unix second timestamp down to its minute boundary.
//
// Adapted from pingcap/metering_sdk internal/utils/utils.go GetCurrentMinuteTimestamp.
// Takes ts as a parameter instead of reading time.Now() so callers can test
// deterministically.
func minuteAlign(ts int64) int64 {
	if ts < 0 {
		return 0
	}
	return ts - ts%60
}

// buildKey constructs the full S3 object key for a metering batch.
//
// Format:
//
//	{prefix}/metering/mem9/{tsMinute}/{category}/{tenantID}/{clusterOrUnderscore}-{part}.json.gz
//
// Empty prefix skips the first segment entirely. Empty clusterID is rendered
// as "_" to keep the filename parseable. The prefix is normalized: leading
// and trailing slashes are trimmed.
//
// Callers are responsible for passing non-empty category and tenantID —
// writer.Record already enforces that. tsMinute must already be
// minute-aligned (use minuteAlign).
func buildKey(prefix, category, tenantID, clusterID string, tsMinute int64, part int) string {
	cluster := clusterID
	if cluster == "" {
		cluster = "_"
	}

	tail := sprintfKey(tsMinute, category, tenantID, cluster, part)

	p := strings.Trim(prefix, "/")
	if p == "" {
		return "metering/mem9/" + tail
	}
	return p + "/metering/mem9/" + tail
}

// sprintfKey renders the path suffix after "metering/mem9/".
// Factored out so tests can assert the exact format independently.
// Intentionally unexported.
func sprintfKey(tsMinute int64, category, tenantID, cluster string, part int) string {
	var b strings.Builder
	b.Grow(len(category) + len(tenantID) + len(cluster) + 32)
	b.WriteString(strconv.FormatInt(tsMinute, 10))
	b.WriteByte('/')
	b.WriteString(category)
	b.WriteByte('/')
	b.WriteString(tenantID)
	b.WriteByte('/')
	b.WriteString(cluster)
	b.WriteByte('-')
	b.WriteString(strconv.Itoa(part))
	b.WriteString(".json.gz")
	return b.String()
}
