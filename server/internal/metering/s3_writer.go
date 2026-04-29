package metering

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type s3Transport struct {
	bucket string
	prefix string
	s3     s3PutObjecter
	gz     *gzipPool
}

func newS3Transport(bucket, prefix string, client s3PutObjecter) *s3Transport {
	return &s3Transport{
		bucket: bucket,
		prefix: prefix,
		s3:     client,
		gz:     newGzipPool(),
	}
}

func newS3Writer(cfg Config, client s3PutObjecter, logger *slog.Logger) *transportWriter {
	return newTransportWriter(cfg, newS3Transport(cfg.Bucket, cfg.Prefix, client), logger)
}

func (w *s3Transport) Write(ctx context.Context, payload batchPayload) error {
	raw, err := json.Marshal(&payload)
	if err != nil {
		return err
	}
	compressed, err := w.gz.compress(raw)
	if err != nil {
		return err
	}

	objectKey := buildKey(w.prefix, payload.Category, payload.TenantID, payload.ClusterID, payload.Timestamp, payload.Part)
	_, err = w.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(w.bucket),
		Key:    aws.String(objectKey),
		Body:   bytes.NewReader(compressed),
	})
	return err
}
