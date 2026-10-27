package credentials

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/qiffang/mnemos/server/internal/domain"
)

// Lease is a durable reader barrier. It intentionally has no TTL: process loss
// must never allow a still-running write to be overtaken by migration. Operators
// explicitly remove crashed participants after fencing their process/storage.
type Lease struct {
	CredentialID string
	mu           sync.Mutex
	refs         int
	release      func()
}

func (l *Lease) Retain() func() {
	l.mu.Lock()
	l.refs++
	l.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { l.Close() }) }
}

func (l *Lease) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.refs--
	if l.refs == 0 {
		l.release()
	}
}

func (s *Store) HoldRecord(ctx context.Context, id string) (*Record, *Lease, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, errors.New("begin tenant reader failed")
	}
	defer tx.Rollback()
	r, err := scanRecord(tx.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id = ? FOR UPDATE"), id))
	if err != nil {
		return nil, nil, err
	}
	if r.Migrating {
		return nil, nil, ErrMigrating
	}
	token := uuid.NewString()
	if _, err := tx.ExecContext(ctx, s.SQL("INSERT INTO api_key_readers (id,api_key_id,instance_id) VALUES (?,?,?)"), token, id, s.InstanceID); err != nil {
		return nil, nil, errors.New("register tenant reader failed")
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, errors.New("commit tenant reader failed")
	}
	l := &Lease{CredentialID: id, refs: 1, release: func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := s.DB.ExecContext(ctx, s.SQL("DELETE FROM api_key_readers WHERE id = ?"), token); err != nil {
			slog.ErrorContext(ctx, "tenant reader cleanup failed; migration remains blocked", "reader_id", token)
		}
	}}
	return r, l, nil
}

func (s *Store) HoldTenant(ctx context.Context, id string) (string, func(), error) {
	r, err := s.ForTenant(ctx, id)
	if errors.Is(err, domain.ErrNotFound) {
		r, err = s.LookupTenant(ctx, id)
	}
	if err != nil {
		return "", nil, err
	}
	r, l, err := s.HoldRecord(ctx, r.ID)
	if err != nil {
		return "", nil, err
	}
	return r.TenantID, l.Close, nil
}

func safeDir(root, id string) (string, error) {
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\") {
		return "", errors.New("invalid tenant directory component")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", errors.New("invalid upload root")
	}
	return filepath.Join(root, id), nil
}

func (s *Store) SyncFiles(ctx context.Context) error {
	q := "INSERT INTO api_key_instances (id,updated_at) VALUES (?,CURRENT_TIMESTAMP)"
	if s.Backend == "postgres" || s.Backend == "db9" {
		q += " ON CONFLICT (id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP"
	} else {
		q += " ON DUPLICATE KEY UPDATE updated_at=CURRENT_TIMESTAMP"
	}
	if _, err := s.DB.ExecContext(ctx, s.SQL(q), s.InstanceID); err != nil {
		return errors.New("register migration participant failed")
	}
	rows, err := s.DB.QueryContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys k WHERE migration_phase IN ('files','done') AND NOT EXISTS (SELECT 1 FROM api_key_file_moves f WHERE f.api_key_id=k.id AND f.instance_id=?)"), s.InstanceID)
	if err != nil {
		return errors.New("read file migrations failed")
	}
	var records []*Record
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return errors.New("read file migrations failed")
	}
	for _, r := range records {
		var readers int
		if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT COUNT(*) FROM api_key_readers WHERE api_key_id = ?"), r.ID).Scan(&readers); err != nil {
			return errors.New("count tenant readers failed")
		}
		if readers != 0 && r.Phase != "done" {
			continue
		}
		oldID, err := s.Keys.open(r.ID, r.Ciphertext)
		if err != nil {
			return err
		}
		oldDir, err := safeDir(s.UploadDir, oldID)
		if err != nil {
			return err
		}
		newID := r.NewTenantID
		if newID == "" {
			newID = r.TenantID
		}
		newDir, err := safeDir(s.UploadDir, newID)
		if err != nil {
			return err
		}
		if oldDir != newDir {
			if st, err := os.Lstat(oldDir); err == nil {
				if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
					return errors.New("unsafe source upload directory")
				}
				if _, err := os.Lstat(newDir); !os.IsNotExist(err) {
					return errors.New("upload migration destination already exists")
				}
				if err := os.Rename(oldDir, newDir); err != nil {
					return errors.New("upload directory move failed")
				}
			} else if !os.IsNotExist(err) {
				return errors.New("inspect upload directory failed")
			}
		}
		if s.Invalidate != nil {
			s.Invalidate(oldID)
		}
		q := "INSERT INTO api_key_file_moves (api_key_id,instance_id) VALUES (?,?)"
		if s.Backend == "postgres" || s.Backend == "db9" {
			q += " ON CONFLICT DO NOTHING"
		} else {
			q += " ON DUPLICATE KEY UPDATE instance_id=instance_id"
		}
		if _, err := s.DB.ExecContext(ctx, s.SQL(q), r.ID, s.InstanceID); err != nil {
			return errors.New("acknowledge upload move failed")
		}
	}
	return nil
}

func (s *Store) RunFileAgent(ctx context.Context) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := s.SyncFiles(ctx); err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "credential file migration participant failed", "instance_id", s.InstanceID, "err", err)
			}
		}
	}
}

func (s *Store) Leave(ctx context.Context) error {
	// A clean shutdown only unregisters after every retained background scope
	// has finished. Otherwise keep the participant for explicit crash recovery.
	var count int
	if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT COUNT(*) FROM api_key_readers WHERE instance_id = ?"), s.InstanceID).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return errors.New("participant still has active tenant readers")
	}
	_, err := s.DB.ExecContext(ctx, s.SQL("DELETE FROM api_key_instances WHERE id = ?"), s.InstanceID)
	return err
}
