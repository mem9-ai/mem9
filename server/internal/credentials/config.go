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
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Config switches are deliberately independent of deployment. All writers must
// support references before ReferenceOutbox or IndependentTenants is enabled.
type Config struct {
	Enabled, ReadCredentials, ReferenceOutbox, IndependentTenants bool
	LegacyAuth, LegacyOutbox                                      bool
	SecretsFile                                                   string
}

func LoadConfig() (Config, error) {
	c := Config{LegacyAuth: true, LegacyOutbox: true, SecretsFile: os.Getenv("MNEMO_API_KEYS_SECRET_FILE")}
	for name, dst := range map[string]*bool{
		"ENABLED": &c.Enabled, "READ": &c.ReadCredentials,
		"OUTBOX_REFERENCES": &c.ReferenceOutbox, "INDEPENDENT_TENANTS": &c.IndependentTenants,
		"LEGACY_AUTH": &c.LegacyAuth, "LEGACY_OUTBOX": &c.LegacyOutbox,
	} {
		if value, ok := os.LookupEnv("MNEMO_API_KEYS_" + name); ok {
			v, err := strconv.ParseBool(value)
			if err != nil {
				return c, fmt.Errorf("invalid MNEMO_API_KEYS_%s", name)
			}
			*dst = v
		}
	}
	if !c.Enabled && (c.ReadCredentials || c.ReferenceOutbox || c.IndependentTenants || !c.LegacyAuth || !c.LegacyOutbox) {
		return c, errors.New("API key switches require MNEMO_API_KEYS_ENABLED")
	}
	if c.IndependentTenants && (!c.ReadCredentials || !c.ReferenceOutbox || c.LegacyOutbox) {
		return c, errors.New("independent tenants require credential reads, outbox references and legacy outbox disabled")
	}
	if c.Enabled && !c.LegacyAuth && !c.ReadCredentials {
		return c, errors.New("disabling legacy auth requires credential reads")
	}
	return c, nil
}

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
		if err != nil || len(key) != 32 || kid == "" {
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

func (k *Keyring) open(id, encoded string) (string, error) {
	var e envelope
	if json.Unmarshal([]byte(encoded), &e) != nil || e.Version != 1 {
		return "", errors.New("unsupported credential envelope")
	}
	aead := k.ciphers[e.KID]
	if aead == nil {
		return "", errors.New("credential encryption key unavailable")
	}
	nonce, err := base64.StdEncoding.DecodeString(e.Nonce)
	if err != nil || len(nonce) != aead.NonceSize() {
		return "", errors.New("invalid credential nonce")
	}
	data, err := base64.StdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return "", errors.New("invalid credential ciphertext")
	}
	plain, err := aead.Open(nil, nonce, data, []byte("mem9-api-key:v1:"+id))
	if err != nil {
		return "", errors.New("credential decryption failed")
	}
	return string(plain), nil
}

func RandomKey() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", errors.New("credential generation failed")
	}
	key := base64.RawURLEncoding.EncodeToString(data)
	if strings.HasPrefix(key, "chain_") {
		return RandomKey()
	}
	return key, nil
}
