package credentials

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *Store) tableExists(ctx context.Context, table string) (bool, error) {
	var n int
	q := "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?"
	if s.Backend == "postgres" || s.Backend == "db9" {
		q = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?"
	}
	err := s.DB.QueryRowContext(ctx, s.SQL(q), table).Scan(&n)
	return n > 0, err
}

// Backfill is bounded and repeatable. No credential status overrides tenant
// lifecycle; requests still check the original tenant's status/deleted_at.
func (s *Store) Backfill(ctx context.Context, limit int, dry bool) (int, error) {
	rows, err := s.DB.QueryContext(ctx, s.SQL("SELECT t.id FROM tenants t LEFT JOIN api_keys k ON k.tenant_id=t.id WHERE t.legacy_key_auth = ? AND k.id IS NULL ORDER BY t.id LIMIT ?"), true, limit)
	if err != nil {
		return 0, errors.New("list legacy tenants failed")
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if !dry {
			if _, err := s.Ensure(ctx, id, "space", id); err != nil {
				return 0, err
			}
		}
	}
	if exists, err := s.tableExists(ctx, "space_chain_bindings"); err != nil {
		return 0, err
	} else if exists {
		rows, err := s.DB.QueryContext(ctx, s.SQL("SELECT b.id,b.chain_api_key FROM space_chain_bindings b LEFT JOIN api_keys k ON k.binding_id=b.id WHERE k.id IS NULL ORDER BY b.id LIMIT ?"), limit)
		if err != nil {
			return 0, errors.New("list chain credentials failed")
		}
		type binding struct{ id, key string }
		var bindings []binding
		for rows.Next() {
			var b binding
			if err := rows.Scan(&b.id, &b.key); err != nil {
				rows.Close()
				return 0, err
			}
			bindings = append(bindings, b)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return 0, err
		}
		for _, b := range bindings {
			if !dry {
				if _, err := s.Ensure(ctx, b.key, "chain", b.id); err != nil {
					return 0, err
				}
			}
		}
		return len(ids) + len(bindings), nil
	}
	return len(ids), nil
}

func (s *Store) jsonText(column string) string {
	if s.Backend == "postgres" || s.Backend == "db9" {
		return column + "::text"
	}
	return "CAST(" + column + " AS CHAR)"
}

func (s *Store) ConvertOutbox(ctx context.Context, limit int, dry bool) (int, error) {
	if exists, err := s.tableExists(ctx, "runtime_usage_outbox"); err != nil {
		return 0, err
	} else if !exists {
		return 0, nil
	}
	rows, err := s.DB.QueryContext(ctx, s.SQL("SELECT operation_id,tenant_id,COALESCE(cluster_id,''),subject_version,step,payload_json,payload_hash FROM runtime_usage_outbox WHERE subject_version <> 'credential_id_v1' ORDER BY operation_id LIMIT ?"), limit)
	if err != nil {
		return 0, errors.New("list legacy outbox failed")
	}
	type item struct {
		id, tenant, cluster, version, step, hash string
		payload                                  []byte
	}
	var items []item
	for rows.Next() {
		var i item
		if err := rows.Scan(&i.id, &i.tenant, &i.cluster, &i.version, &i.step, &i.payload, &i.hash); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, i)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, i := range items {
		if i.version != "tenant_id_v1" {
			return count, errors.New("unsupported historical outbox version")
		}
		var p map[string]any
		if decodeObject(i.payload, &p) != nil {
			return count, errors.New("invalid historical outbox payload")
		}
		key, _ := p["apiKeySubject"].(string)
		if event, ok := p["event"].(map[string]any); ok {
			if k, ok := event["apiKeySubject"].(string); ok && k != "" {
				key = k
			}
		}
		if key == "" {
			var legacy bool
			if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT legacy_key_auth FROM tenants WHERE id=?"), i.tenant).Scan(&legacy); err != nil || !legacy {
				return count, errors.New("cannot recover legacy outbox credential")
			}
			key = i.tenant
		}
		r, err := s.ByKey(ctx, key)
		if err != nil {
			return count, errors.New("backfill exact outbox credential before conversion")
		}
		if dry {
			count++
			continue
		}
		delete(p, "apiKeySubject")
		p["api_key_id"] = r.ID
		if event, ok := p["event"].(map[string]any); ok {
			delete(event, "apiKeySubject")
		}
		data, err := json.Marshal(p)
		if err != nil {
			return count, err
		}
		hash := i.hash
		if i.step != "submit_metering_event" {
			sum := sha256.Sum256(data)
			hash = hex.EncodeToString(sum[:])
		}
		cluster, err := s.ClusterReference(ctx, i.cluster)
		if err != nil {
			return count, err
		}
		result, err := s.DB.ExecContext(ctx, s.SQL("UPDATE runtime_usage_outbox SET subject_version='credential_id_v1',payload_json=?,payload_hash=?,cluster_id=? WHERE operation_id=? AND subject_version=? AND "+s.jsonText("payload_json")+"=?"), string(data), hash, cluster, i.id, i.version, string(i.payload))
		if err != nil {
			return count, errors.New("convert outbox compare-and-swap failed")
		}
		n, _ := result.RowsAffected()
		count += int(n)
	}
	return count, nil
}

func (s *Store) CheckStage(ctx context.Context) error {
	if !s.Config.LegacyOutbox || s.Config.IndependentTenants {
		if exists, err := s.tableExists(ctx, "runtime_usage_outbox"); err != nil {
			return err
		} else if exists {
			var n int
			if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM runtime_usage_outbox WHERE subject_version <> 'credential_id_v1'").Scan(&n); err != nil {
				return errors.New("outbox preflight failed")
			}
			if n != 0 {
				return errors.New("convert all retained outbox rows before disabling legacy format or enabling independent tenants")
			}
		}
	}
	if !s.Config.LegacyAuth {
		var n int
		if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT COUNT(*) FROM tenants WHERE legacy_key_auth=?"), true).Scan(&n); err != nil {
			return errors.New("legacy tenant preflight failed")
		}
		if n != 0 {
			return errors.New("migrate all legacy tenants before disabling legacy authentication")
		}
	}
	return nil
}

func (s *Store) MigrateTenant(ctx context.Context, id string, dry bool) error {
	if !s.Config.IndependentTenants || s.Config.LegacyOutbox {
		return errors.New("tenant migration requires independent tenants and legacy outbox disabled")
	}
	r, err := s.ByID(ctx, id)
	if err != nil {
		return err
	}
	if r.Kind != "space" {
		return errors.New("only Space tenant IDs are migrated")
	}
	if r.Phase == "done" {
		return nil
	}
	if err := s.CheckStage(ctx); err != nil {
		return err
	}
	var legacy bool
	if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT legacy_key_auth FROM tenants WHERE id=?"), r.TenantID).Scan(&legacy); err != nil {
		return errors.New("read migration source failed")
	}
	if !legacy {
		return errors.New("tenant is already independent")
	}
	if dry {
		return nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("begin migration coordinator failed")
	}
	defer tx.Rollback()
	r, err = scanRecord(tx.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id=? FOR UPDATE"), r.ID))
	if err != nil {
		return err
	}
	if r.Phase == "done" {
		return nil
	}
	newID := r.NewTenantID
	if newID == "" {
		newID = uuid.NewString()
	}
	if _, err := tx.ExecContext(ctx, s.SQL("UPDATE api_keys SET migrating=?,new_tenant_id=?,migration_phase='files' WHERE id=?"), true, newID, r.ID); err != nil {
		return errors.New("begin tenant migration failed")
	}
	if err := tx.Commit(); err != nil {
		return errors.New("commit migration coordinator failed")
	}
	// Readers and new arrivals serialize on the credential row. Never expire
	// reader tokens automatically: a disconnected process may still be writing.
	for {
		var readers int
		if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT COUNT(*) FROM api_key_readers WHERE api_key_id=?"), r.ID).Scan(&readers); err != nil {
			return errors.New("reader barrier check failed")
		}
		var missing, instances int
		if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM api_key_instances").Scan(&instances); err != nil {
			return errors.New("participant check failed")
		}
		if err := s.DB.QueryRowContext(ctx, s.SQL("SELECT COUNT(*) FROM api_key_instances i WHERE NOT EXISTS (SELECT 1 FROM api_key_file_moves f WHERE f.instance_id=i.id AND f.api_key_id=?)"), r.ID).Scan(&missing); err != nil {
			return errors.New("file acknowledgement check failed")
		}
		if readers == 0 && missing == 0 && instances > 0 {
			break
		}
		select {
		case <-ctx.Done():
			return errors.New("tenant migration paused; resume the same credential ID after recovery")
		case <-time.After(200 * time.Millisecond):
		}
	}
	return s.moveTenantRows(ctx, r, newID)
}

func (s *Store) moveTenantRows(ctx context.Context, r *Record, newID string) error {
	// Discover optional tables outside the transaction; all table/column names
	// below are fixed application-owned identifiers, never operator SQL input.
	tables := map[string]bool{}
	for _, name := range []string{"tenant_activity", "tenant_utm", "space_chain_nodes", "upload_tasks", "runtime_usage_outbox", "webhook_endpoints", "webhook_events"} {
		exists, err := s.tableExists(ctx, name)
		if err != nil {
			return err
		}
		tables[name] = exists
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("begin tenant cutover failed")
	}
	defer tx.Rollback()
	current, err := scanRecord(tx.QueryRowContext(ctx, s.SQL("SELECT "+recordColumns+" FROM api_keys WHERE id=? FOR UPDATE"), r.ID))
	if err != nil {
		return err
	}
	if current.Phase == "done" {
		return nil
	}
	if current.NewTenantID != newID {
		return errors.New("tenant migration target changed")
	}
	oldID := current.TenantID
	var oldName string
	if err := tx.QueryRowContext(ctx, s.SQL("SELECT name FROM tenants WHERE id=? FOR UPDATE"), oldID).Scan(&oldName); err != nil {
		return errors.New("read source tenant failed")
	}
	name := oldName
	if name == oldID {
		name = newID
	}
	if _, err := tx.ExecContext(ctx, s.SQL("UPDATE tenants SET name=? WHERE id=?"), "migration:"+r.ID, oldID); err != nil {
		return errors.New("reserve tenant name failed")
	}
	_, err = tx.ExecContext(ctx, s.SQL(`INSERT INTO tenants
(id,name,db_host,db_port,db_user,db_password,db_name,db_tls,provider,cluster_id,claim_url,claim_expires_at,status,schema_version,created_at,updated_at,deleted_at,legacy_key_auth)
SELECT ?,?,db_host,db_port,db_user,db_password,db_name,db_tls,provider,CASE WHEN cluster_id=? THEN ? ELSE cluster_id END,REPLACE(claim_url,?,?),claim_expires_at,status,schema_version,created_at,updated_at,deleted_at,?
FROM tenants WHERE id=?`), newID, name, oldID, ReferencePrefix+r.ID, oldID, ReferencePrefix+r.ID, false, oldID)
	if err != nil {
		return errors.New("create independent tenant failed")
	}
	for _, table := range []string{"tenant_activity", "tenant_utm", "space_chain_nodes", "upload_tasks", "runtime_usage_outbox"} {
		if tables[table] {
			if _, err := tx.ExecContext(ctx, s.SQL("UPDATE "+table+" SET tenant_id=? WHERE tenant_id=?"), newID, oldID); err != nil {
				return errors.New("migrate tenant references failed")
			}
		}
	}
	if tables["upload_tasks"] {
		rows, err := tx.QueryContext(ctx, s.SQL("SELECT task_id,file_path FROM upload_tasks WHERE tenant_id=?"), newID)
		if err != nil {
			return errors.New("list upload paths failed")
		}
		type task struct{ id, path string }
		var tasks []task
		for rows.Next() {
			var t task
			if err := rows.Scan(&t.id, &t.path); err != nil {
				rows.Close()
				return err
			}
			tasks = append(tasks, t)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, t := range tasks {
			oldRoot := filepath.Join(filepath.Clean(s.UploadDir), oldID)
			clean := filepath.Clean(t.path)
			if !strings.HasPrefix(clean, oldRoot+string(filepath.Separator)) {
				return errors.New("upload path outside configured tenant root")
			}
			updated := filepath.Join(filepath.Clean(s.UploadDir), newID) + strings.TrimPrefix(clean, oldRoot)
			if _, err := tx.ExecContext(ctx, s.SQL("UPDATE upload_tasks SET file_path=? WHERE task_id=?"), updated, t.id); err != nil {
				return errors.New("update upload path failed")
			}
		}
	}
	if tables["runtime_usage_outbox"] {
		if _, err := tx.ExecContext(ctx, s.SQL("UPDATE runtime_usage_outbox SET cluster_id=? WHERE tenant_id=? AND cluster_id=?"), ReferencePrefix+r.ID, newID, oldID); err != nil {
			return errors.New("update outbox cluster reference failed")
		}
	}
	if tables["webhook_endpoints"] {
		if _, err := tx.ExecContext(ctx, s.SQL("UPDATE webhook_endpoints SET scope_id=? WHERE scope_type='tenant' AND scope_id=?"), newID, oldID); err != nil {
			return errors.New("migrate webhook endpoints failed")
		}
	}
	if tables["webhook_events"] {
		if err := s.moveWebhookEvents(ctx, tx, oldID, newID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, s.SQL("UPDATE api_keys SET tenant_id=?,migration_phase='done',migrating=? WHERE id=?"), newID, false, r.ID); err != nil {
		return errors.New("cut over credential association failed")
	}
	if _, err := tx.ExecContext(ctx, s.SQL("DELETE FROM tenants WHERE id=?"), oldID); err != nil {
		return errors.New("remove legacy tenant failed")
	}
	if err := tx.Commit(); err != nil {
		return errors.New("commit tenant cutover failed")
	}
	return nil
}

var identityPaths = [][]string{
	{"scope", "tenant_id"}, {"data", "source_tenant_id"}, {"data", "target_tenant_id"},
	{"data", "memory", "tenant_id"}, {"data", "memory", "chain_source", "tenant_id"},
	{"data", "target_memory", "tenant_id"}, {"data", "target_memory", "chain_source", "tenant_id"},
}

func identityParent(p map[string]any, path []string) (map[string]any, string) {
	for _, key := range path[:len(path)-1] {
		next, ok := p[key].(map[string]any)
		if !ok {
			return nil, ""
		}
		p = next
	}
	return p, path[len(path)-1]
}

func EventTenantIDs(data []byte) []string {
	var p map[string]any
	if json.Unmarshal(data, &p) != nil {
		return nil
	}
	set := map[string]bool{}
	var ids []string
	for _, path := range identityPaths {
		parent, key := identityParent(p, path)
		if id, ok := parent[key].(string); ok && id != "" && !set[id] {
			set[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *Store) moveWebhookEvents(ctx context.Context, tx *sql.Tx, oldID, newID string) error {
	rows, err := tx.QueryContext(ctx, s.SQL("SELECT id,payload_json FROM webhook_events WHERE "+s.jsonText("payload_json")+" LIKE ? FOR UPDATE"), "%"+oldID+"%")
	if err != nil {
		return errors.New("read webhook identities failed")
	}
	type event struct {
		id      string
		payload []byte
	}
	var events []event
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.payload); err != nil {
			rows.Close()
			return err
		}
		events = append(events, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range events {
		var p map[string]any
		if decodeObject(e.payload, &p) != nil {
			return errors.New("invalid stored webhook event")
		}
		changed := false
		for _, path := range identityPaths {
			parent, key := identityParent(p, path)
			if parent[key] == oldID {
				parent[key] = newID
				changed = true
			}
		}
		if changed {
			data, err := json.Marshal(p)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, s.SQL("UPDATE webhook_events SET payload_json=? WHERE id=?"), string(data), e.id); err != nil {
				return errors.New("rewrite webhook identities failed")
			}
		}
	}
	_, err = tx.ExecContext(ctx, s.SQL("UPDATE webhook_events SET scope_id=? WHERE scope_type='tenant' AND scope_id=?"), newID, oldID)
	return err
}

func (s *Store) MigrationIDs(ctx context.Context, limit int) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, s.SQL("SELECT k.id FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.credential_type='space' AND t.legacy_key_auth=? ORDER BY k.id LIMIT ?"), true, limit)
	if err != nil {
		return nil, errors.New("list migration candidates failed")
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) Audit(ctx context.Context) (map[string]int, error) {
	counts := map[string]int{}
	for name, q := range map[string]string{
		"legacy_tenants":            "SELECT COUNT(*) FROM tenants WHERE legacy_key_auth=TRUE",
		"missing_space_credentials": "SELECT COUNT(*) FROM tenants t LEFT JOIN api_keys k ON k.tenant_id=t.id WHERE k.id IS NULL",
		"migrating_tenants":         "SELECT COUNT(*) FROM api_keys WHERE migrating=TRUE",
		"active_readers":            "SELECT COUNT(*) FROM api_key_readers",
	} {
		var n int
		if err := s.DB.QueryRowContext(ctx, q).Scan(&n); err != nil {
			return nil, errors.New("credential audit failed")
		}
		counts[name] = n
	}
	if exists, err := s.tableExists(ctx, "runtime_usage_outbox"); err != nil {
		return nil, err
	} else if exists {
		var n int
		if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM runtime_usage_outbox WHERE subject_version <> 'credential_id_v1'").Scan(&n); err != nil {
			return nil, err
		}
		counts["legacy_outbox"] = n
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT "+recordColumns+" FROM api_keys")
	if err != nil {
		return nil, err
	}
	var records []*Record
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, r := range records {
		key, err := s.Keys.open(r.ID, r.Ciphertext)
		if err != nil {
			return nil, err
		}
		found, err := s.ByKey(ctx, key)
		if err != nil || found.ID != r.ID {
			return nil, errors.New("credential digest mismatch")
		}
		counts["verified_credentials"]++
	}
	if err := s.auditReferences(ctx, counts, records); err != nil {
		return nil, err
	}
	return counts, nil
}

func decodeObject(data []byte, dst *map[string]any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	return decoder.Decode(dst)
}
