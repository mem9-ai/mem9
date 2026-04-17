package metering

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// s3PutObjecter is the narrow interface that s3Writer actually needs.
// Defined as an interface so tests can substitute a fake. Matches the
// real *s3.Client method signature.
type s3PutObjecter interface {
	PutObject(ctx context.Context, in *s3.PutObjectInput, opts ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

// newS3Client constructs a real *s3.Client from cfg. Credentials come from
// the default AWS SDK chain (env vars, IRSA, pod identity, ~/.aws/credentials);
// static credentials are intentionally NOT supported here — configure them via
// the AWS chain instead. Matches server/internal/encrypt/kms.go's approach.
func newS3Client(ctx context.Context, cfg Config) (*s3.Client, error) {
	var opts []func(*awsconfig.LoadOptions) error
	if cfg.Region != "" {
		opts = append(opts, awsconfig.WithRegion(cfg.Region))
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("metering: load aws config: %w", err)
	}

	if cfg.Endpoint != "" {
		awsCfg.BaseEndpoint = aws.String(cfg.Endpoint)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.ForcePathStyle {
			o.UsePathStyle = true
		}
	})
	return client, nil
}
