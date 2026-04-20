package metering

import (
	"context"
	"fmt"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// s3PutObjecter is the narrow interface that s3Writer actually needs.
// Defined as an interface so tests can substitute a fake. Matches the
// real *s3.Client method signature.
type s3PutObjecter interface {
	PutObject(ctx context.Context, in *s3.PutObjectInput, opts ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

// newS3Client constructs a real *s3.Client from the default AWS SDK chain
// (env vars, IRSA, pod identity, ~/.aws/credentials), matching
// server/internal/encrypt/kms.go's approach.
func newS3Client(ctx context.Context) (*s3.Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("metering: load aws config: %w", err)
	}
	return s3.NewFromConfig(awsCfg), nil
}
