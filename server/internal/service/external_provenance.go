package service

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/qiffang/mnemos/server/internal/domain"
)

const (
	ExternalProvenanceSchema   = "agent9/message-source@1"
	MaxExternalSourceMessageID = 64
	externalProvenanceKey      = "external_provenance"
)

// ExternalProvenance is the validated reserved metadata carried into fact creation.
type ExternalProvenance struct {
	Schema          string `json:"schema"`
	SourceMessageID string `json:"source_message_id"`
}

// SetExternalProvenanceMetadata replaces stale reserved provenance on a newly created fact revision.
func SetExternalProvenanceMetadata(existing json.RawMessage, provenance *ExternalProvenance) json.RawMessage {
	var payload map[string]json.RawMessage
	hadExternalProvenance := false
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &payload); err != nil || payload == nil {
			if provenance == nil {
				return append(json.RawMessage(nil), existing...)
			}
			payload = map[string]json.RawMessage{}
		}
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}
	_, hadExternalProvenance = payload[externalProvenanceKey]
	delete(payload, "external_provenance")
	if provenance != nil {
		raw, err := json.Marshal(provenance)
		if err == nil {
			payload["external_provenance"] = raw
		}
	}
	if len(payload) == 0 {
		if provenance == nil && !hadExternalProvenance && len(existing) > 0 {
			return append(json.RawMessage(nil), existing...)
		}
		return nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return existing
	}
	return raw
}

// preserveExternalProvenanceMetadata keeps the reserved creation provenance immutable under the
// generic memory update API. Generic object metadata may still be replaced as before, but its
// external_provenance member is ignored: an existing member is copied exactly and a new member is
// removed. A provenance-bearing object cannot be replaced by a non-object while retaining the
// reserved member, so that conditional shape is rejected explicitly rather than silently ignored.
func preserveExternalProvenanceMetadata(current, update json.RawMessage) (json.RawMessage, error) {
	if update == nil {
		return nil, nil
	}

	var currentObject map[string]json.RawMessage
	_ = json.Unmarshal(current, &currentObject)
	currentProvenance, hasCurrentProvenance := currentObject[externalProvenanceKey]

	var updateObject map[string]json.RawMessage
	if err := json.Unmarshal(update, &updateObject); err != nil || updateObject == nil {
		if hasCurrentProvenance {
			return nil, &domain.ValidationError{
				Field:   "metadata",
				Message: "must be an object when the memory has external_provenance",
			}
		}
		return update, nil
	}

	delete(updateObject, externalProvenanceKey)
	if hasCurrentProvenance {
		updateObject[externalProvenanceKey] = currentProvenance
	}
	encoded, err := json.Marshal(updateObject)
	if err != nil {
		return update, nil
	}
	return encoded, nil
}

// ParseExternalProvenance validates and removes the reserved key from generic request metadata.
func ParseExternalProvenance(metadata json.RawMessage, messages []IngestMessage) (json.RawMessage, *ExternalProvenance, error) {
	trimmed := strings.TrimSpace(string(metadata))
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return append(json.RawMessage(nil), metadata...), nil, nil
	}

	var metadataObject map[string]json.RawMessage
	if err := json.Unmarshal(metadata, &metadataObject); err != nil {
		return append(json.RawMessage(nil), metadata...), nil, nil
	}
	rawEnvelope, present := metadataObject["external_provenance"]
	if !present {
		return append(json.RawMessage(nil), metadata...), nil, nil
	}

	invalid := func(message string) (json.RawMessage, *ExternalProvenance, error) {
		return nil, nil, &domain.ValidationError{Field: "metadata.external_provenance", Message: message}
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(rawEnvelope, &envelope); err != nil || len(envelope) != 2 {
		return invalid("must contain exactly schema and source_message_id")
	}
	rawSchema, hasSchema := envelope["schema"]
	rawSourceMessageID, hasSourceMessageID := envelope["source_message_id"]
	if !hasSchema || !hasSourceMessageID {
		return invalid("must contain exactly schema and source_message_id")
	}
	var schema string
	var sourceMessageID string
	if err := json.Unmarshal(rawSchema, &schema); err != nil || schema != ExternalProvenanceSchema {
		return invalid("schema must be agent9/message-source@1")
	}
	if err := json.Unmarshal(rawSourceMessageID, &sourceMessageID); err != nil || sourceMessageID == "" || utf8.RuneCountInString(sourceMessageID) > MaxExternalSourceMessageID {
		return invalid("source_message_id must be a non-empty string of at most 64 characters")
	}

	factEligibleUsers := 0
	for _, message := range messages {
		if strings.EqualFold(strings.TrimSpace(message.Role), "user") && strings.TrimSpace(stripMemoryTags(message.Content)) != "" {
			factEligibleUsers++
		}
	}
	if factEligibleUsers != 1 {
		return invalid("requires exactly one fact-eligible user message")
	}

	delete(metadataObject, "external_provenance")
	var genericMetadata json.RawMessage
	if len(metadataObject) > 0 {
		genericMetadata, _ = json.Marshal(metadataObject)
	}
	return genericMetadata, &ExternalProvenance{
		Schema:          schema,
		SourceMessageID: sourceMessageID,
	}, nil
}
