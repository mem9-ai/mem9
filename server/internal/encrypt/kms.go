package encrypt

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kms"
)

// KMSEncryptor uses AWS KMS for encryption and decryption.
// It requires a KMS key ID or ARN for encryption operations.
type KMSEncryptor struct {
	client *kms.Client
	keyID  string
}

// NewKMSEncryptor creates a new KMSEncryptor with the specified KMS key ID.
// The keyID can be a KMS key ID, key ARN, alias name, or alias ARN.
// AWS credentials are loaded from the environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).
func NewKMSEncryptor(keyID string) (*KMSEncryptor, error) {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		return nil, fmt.Errorf("kms encryptor: load aws config: %w", err)
	}

	client := kms.NewFromConfig(cfg)
	return &KMSEncryptor{
		client: client,
		keyID:  keyID,
	}, nil
}

// NewKMSEncryptorWithClient creates a new KMSEncryptor with a pre-configured KMS client.
// This is useful for testing or when you need custom AWS configuration.
func NewKMSEncryptorWithClient(client *kms.Client, keyID string) *KMSEncryptor {
	return &KMSEncryptor{
		client: client,
		keyID:  keyID,
	}
}

// Encrypt encrypts the plaintext using AWS KMS and returns base64-encoded ciphertext.
func (e *KMSEncryptor) Encrypt(ctx context.Context, plaintext string) (string, error) {
	input := &kms.EncryptInput{
		KeyId:     &e.keyID,
		Plaintext: []byte(plaintext),
	}

	result, err := e.client.Encrypt(ctx, input)
	if err != nil {
		return "", fmt.Errorf("kms encrypt: %w", err)
	}

	return base64.StdEncoding.EncodeToString(result.CiphertextBlob), nil
}

// Decrypt decrypts the base64-encoded ciphertext using AWS KMS.
// Note: KMS decrypt does not require the key ID as it's embedded in the ciphertext blob.
func (e *KMSEncryptor) Decrypt(ctx context.Context, ciphertext string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("kms decrypt: decode base64: %w", err)
	}

	input := &kms.DecryptInput{
		CiphertextBlob: data,
	}

	result, err := e.client.Decrypt(ctx, input)
	if err != nil {
		return "", fmt.Errorf("kms decrypt: %w", err)
	}

	return string(result.Plaintext), nil
}
