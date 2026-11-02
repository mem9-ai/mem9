package credentials

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strings"
)

// Keyring is loaded from a mounted Secrets Manager secret, never from the
// existing plain/MD5 password encryptor. Keys are base64 encoded 32-byte values.
type Keyring struct {
	HashVersion    string            `json:"hash_version"`
	HMACKeys       map[string]string `json:"hmac_keys"`
	EncryptionKID  string            `json:"encryption_kid"`
	EncryptionKeys map[string]string `json:"encryption_keys"`
	hashes         map[string][]byte
	ciphers        map[string]cipher.AEAD
}

func LoadKeyring(path string) (*Keyring, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("cannot read API key secret file")
	}
	var k Keyring
	if json.Unmarshal(data, &k) != nil {
		return nil, errors.New("invalid API key secret JSON")
	}
	k.hashes, k.ciphers = map[string][]byte{}, map[string]cipher.AEAD{}
	for version, encoded := range k.HMACKeys {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(key) != 32 || version == "" {
			return nil, errors.New("HMAC keys must be versioned 32-byte base64 values")
		}
		k.hashes[version] = key
	}
	for kid, encoded := range k.EncryptionKeys {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(key) != 32 || kid == "" || strings.Contains(kid, ":") {
			return nil, errors.New("AES keys must be named 32-byte base64 values")
		}
		for _, hashKey := range k.hashes {
			if hmac.Equal(key, hashKey) {
				return nil, errors.New("HMAC and encryption keys must differ")
			}
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, errors.New("invalid AES key")
		}
		k.ciphers[kid], err = cipher.NewGCM(block)
		if err != nil {
			return nil, errors.New("invalid AES-GCM configuration")
		}
	}
	if k.hashes[k.HashVersion] == nil || k.ciphers[k.EncryptionKID] == nil {
		return nil, errors.New("active HMAC version or encryption kid is missing")
	}
	return &k, nil
}

// SealWithAAD encrypts plaintext with the active encryption key and binds the
// result to aad. The returned bytes contain nonce || ciphertext.
func (k *Keyring) SealWithAAD(aad, plaintext []byte) (kid string, sealed []byte, err error) {
	if k == nil {
		return "", nil, errors.New("keyring is unavailable")
	}
	aead := k.ciphers[k.EncryptionKID]
	if aead == nil {
		return "", nil, errors.New("active encryption key is unavailable")
	}
	nonce := make([]byte, aead.NonceSize())
	if len(nonce) != 12 {
		return "", nil, errors.New("invalid AES-GCM nonce size")
	}
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, errors.New("secret nonce generation failed")
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, aad)
	sealed = make([]byte, 0, len(nonce)+len(ciphertext))
	sealed = append(sealed, nonce...)
	sealed = append(sealed, ciphertext...)
	return k.EncryptionKID, sealed, nil
}

// OpenWithAAD decrypts nonce || ciphertext with the named encryption key and
// verifies that it is bound to aad.
func (k *Keyring) OpenWithAAD(kid string, aad, sealed []byte) ([]byte, error) {
	if k == nil {
		return nil, errors.New("keyring is unavailable")
	}
	aead := k.ciphers[kid]
	if aead == nil {
		return nil, errors.New("unknown encryption kid")
	}
	nonceSize := aead.NonceSize()
	if len(sealed) < nonceSize+aead.Overhead() {
		return nil, errors.New("sealed secret is too short")
	}
	plaintext, err := aead.Open(nil, sealed[:nonceSize], sealed[nonceSize:], aad)
	if err != nil {
		return nil, errors.New("secret authentication failed")
	}
	return plaintext, nil
}

func (k *Keyring) digest(version, key string) []byte {
	h := hmac.New(sha256.New, k.hashes[version])
	h.Write([]byte(strings.TrimSpace(key)))
	return h.Sum(nil)
}

func (k *Keyring) versions() []string {
	v := []string{k.HashVersion}
	for version := range k.hashes {
		if version != k.HashVersion {
			v = append(v, version)
		}
	}
	sort.Strings(v[1:])
	return v
}

type envelope struct {
	Version    int    `json:"v"`
	KID        string `json:"kid"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func (k *Keyring) seal(id, key string) (string, error) {
	aead := k.ciphers[k.EncryptionKID]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", errors.New("credential nonce generation failed")
	}
	data := aead.Seal(nil, nonce, []byte(strings.TrimSpace(key)), []byte("mem9-api-key:v1:"+id))
	encoded, err := json.Marshal(envelope{1, k.EncryptionKID, base64.StdEncoding.EncodeToString(nonce), base64.StdEncoding.EncodeToString(data)})
	return string(encoded), err
}
