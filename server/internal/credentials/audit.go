package credentials

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

func (s *Store) auditReferences(ctx context.Context, counts map[string]int, records []*Record) error {
	oldIDs := map[string]bool{}
	for _, r := range records {
		if r.Kind == "space" && r.Phase == "done" {
			old, err := s.Keys.open(r.ID, r.Ciphertext)
			if err != nil {
				return err
			}
			oldIDs[old] = true
		}
	}
	scan := func(query string, visit func(string)) error {
		rows, err := s.DB.QueryContext(ctx, query)
		if err != nil {
			return errors.New("identity residual scan failed")
		}
		defer rows.Close()
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				return err
			}
			visit(value)
		}
		return rows.Err()
	}
	identity := func(value string) {
		if oldIDs[value] {
			counts["plaintext_identity_residuals"]++
		}
	}
	for _, col := range []string{"id", "name", "cluster_id"} {
		if err := scan("SELECT COALESCE("+col+",'') FROM tenants", identity); err != nil {
			return err
		}
	}
	uuidPattern := regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	if err := scan("SELECT COALESCE(claim_url,'') FROM tenants", func(value string) {
		candidates := uuidPattern.FindAllString(value, -1)
		candidates = append(candidates, strings.FieldsFunc(value, func(r rune) bool { return strings.ContainsRune("/?&=#:", r) })...)
		for _, candidate := range candidates {
			if oldIDs[candidate] {
				counts["plaintext_claim_url_identities"]++
				return
			}
		}
	}); err != nil {
		return err
	}
	for _, table := range []string{"tenant_activity", "tenant_utm", "space_chain_nodes", "upload_tasks", "runtime_usage_outbox", "webhook_endpoints", "webhook_events"} {
		exists, err := s.tableExists(ctx, table)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if strings.HasPrefix(table, "webhook_") {
			if err := scan("SELECT scope_id FROM "+table+" WHERE scope_type='tenant'", identity); err != nil {
				return err
			}
		} else {
			if err := scan("SELECT tenant_id FROM "+table, identity); err != nil {
				return err
			}
		}
		if table == "upload_tasks" {
			if err := scan("SELECT file_path FROM upload_tasks", func(value string) {
				for _, part := range strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' }) {
					identity(part)
				}
			}); err != nil {
				return err
			}
		}
		if table == "webhook_events" {
			if err := scan("SELECT payload_json FROM webhook_events", func(value string) {
				for _, id := range EventTenantIDs([]byte(value)) {
					if oldIDs[id] {
						counts["plaintext_webhook_identities"]++
					}
				}
			}); err != nil {
				return err
			}
		}
		if table == "runtime_usage_outbox" {
			if err := scan("SELECT COALESCE(cluster_id,'') FROM runtime_usage_outbox", identity); err != nil {
				return err
			}
			// Collect only record IDs while the result set is open, then query their
			// existence after closing it; audit also works with MaxOpenConns=1.
			ids := map[string]bool{}
			invalid := false
			err := scan("SELECT payload_json FROM runtime_usage_outbox", func(value string) {
				var p map[string]any
				if decodeObject([]byte(value), &p) != nil {
					invalid = true
					return
				}
				if k, ok := p["apiKeySubject"].(string); ok && k != "" {
					counts["plaintext_outbox_subjects"]++
				}
				if e, ok := p["event"].(map[string]any); ok {
					if k, ok := e["apiKeySubject"].(string); ok && k != "" {
						counts["plaintext_outbox_subjects"]++
					}
				}
				id, _ := p["api_key_id"].(string)
				if id != "" {
					ids[id] = true
				} else {
					counts["missing_outbox_credentials"]++
				}
			})
			if err != nil {
				return err
			}
			if invalid {
				return errors.New("outbox payload audit failed")
			}
			known := map[string]bool{}
			for _, r := range records {
				known[r.ID] = true
			}
			for id := range ids {
				if !known[id] {
					counts["missing_outbox_credentials"]++
				}
			}
		}
	}
	var missing int
	if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM api_keys k CROSS JOIN api_key_instances i WHERE k.migration_phase='done' AND NOT EXISTS(SELECT 1 FROM api_key_file_moves f WHERE f.api_key_id=k.id AND f.instance_id=i.id)").Scan(&missing); err != nil {
		return errors.New("file participant audit failed")
	}
	counts["missing_file_acknowledgements"] = missing
	return nil
}
