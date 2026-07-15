package handler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const (
	runtimeAccessBlockedRef   = "#/components/responses/RuntimeAccessBlocked"
	memoryRouteRateLimitedRef = "#/components/responses/MemoryRouteRateLimited"
	genericRateLimitedRef     = "#/components/responses/RateLimited"
)

func TestOpenAPIRuntimeQuotaResponses(t *testing.T) {
	openapi := loadOpenAPI(t)

	for _, route := range []struct {
		path    string
		methods []string
	}{
		{"/v1alpha1/mem9s/{tenantID}/memories", []string{"post", "get"}},
		{"/v1alpha1/mem9s/{tenantID}/memories/{id}", []string{"put", "delete"}},
		{"/v1alpha2/mem9s/memories", []string{"post", "get"}},
		{"/v1alpha2/mem9s/memories/{id}", []string{"put", "delete"}},
		{"/v1alpha2/mem9s/memories/batch-delete", []string{"post"}},
	} {
		for _, method := range route.methods {
			responses := operationResponses(t, openapi, route.path, method)
			assertResponseRef(t, responses, "402", runtimeAccessBlockedRef)
			assertResponseRef(t, responses, "429", memoryRouteRateLimitedRef)
		}
	}

	getByIDResponses := operationResponses(t, openapi, "/v1alpha2/mem9s/memories/{id}", "get")
	assertResponseRef(t, getByIDResponses, "429", genericRateLimitedRef)
	assertNoResponseRef(t, operationResponses(t, openapi, "/v1alpha1/mem9s/{tenantID}/memories/{id}", "get"), "402", runtimeAccessBlockedRef)
	assertNoResponseRef(t, operationResponses(t, openapi, "/v1alpha1/mem9s/{tenantID}/memories/{id}", "get"), "429", memoryRouteRateLimitedRef)
}

func TestOpenAPIRuntimeQuotaSchemas(t *testing.T) {
	openapi := loadOpenAPI(t)
	components := objectValue(t, openapi, "components")
	responses := objectValue(t, components, "responses")
	schemas := objectValue(t, components, "schemas")

	postQuotaRateLimited := objectValue(t, responses, "PostQuotaRateLimited")
	headers := objectValue(t, postQuotaRateLimited, "headers")
	if _, ok := headers["Retry-After"]; !ok {
		t.Fatalf("PostQuotaRateLimited response missing Retry-After header")
	}

	memoryRouteRateLimited := objectValue(t, responses, "MemoryRouteRateLimited")
	memoryRouteHeaders := objectValue(t, memoryRouteRateLimited, "headers")
	if _, ok := memoryRouteHeaders["Retry-After"]; !ok {
		t.Fatalf("MemoryRouteRateLimited response missing Retry-After header")
	}
	memoryRouteContent := objectValue(t, memoryRouteRateLimited, "content")
	memoryRouteJSON := objectValue(t, memoryRouteContent, "application/json")
	memoryRouteSchema := objectValue(t, memoryRouteJSON, "schema")
	anyOf := objectSlice(t, memoryRouteSchema["anyOf"])
	if !containsRef(anyOf, "#/components/schemas/RuntimeQuotaError") {
		t.Fatalf("MemoryRouteRateLimited should include RuntimeQuotaError in anyOf: %#v", anyOf)
	}
	if !containsRef(anyOf, "#/components/schemas/ErrorResponse") {
		t.Fatalf("MemoryRouteRateLimited should include generic ErrorResponse in anyOf: %#v", anyOf)
	}

	runtimeQuotaError := objectValue(t, schemas, "RuntimeQuotaError")
	runtimeQuotaErrorAllOf := objectSlice(t, runtimeQuotaError["allOf"])
	if !containsRef(runtimeQuotaErrorAllOf, "#/components/schemas/ErrorResponse") {
		t.Fatalf("RuntimeQuotaError should extend ErrorResponse: %#v", runtimeQuotaErrorAllOf)
	}
	if !allOfRequiresProperty(runtimeQuotaErrorAllOf, "details") {
		t.Fatalf("RuntimeQuotaError.details should be required for the error category: %#v", runtimeQuotaErrorAllOf)
	}
	if !allOfHasDetailsRef(runtimeQuotaErrorAllOf, "#/components/schemas/RuntimeQuotaErrorEnvelopeDetails") {
		t.Fatalf("RuntimeQuotaError should add quota details via allOf: %#v", runtimeQuotaErrorAllOf)
	}

	recommendedAction := objectValue(t, schemas, "RuntimeRecommendedAction")
	actionProperties := objectValue(t, recommendedAction, "properties")
	actionType := objectValue(t, actionProperties, "type")
	if got, want := stringSlice(t, actionType["enum"]), []string{"openUrl"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RuntimeRecommendedAction.type enum = %#v, want %#v", got, want)
	}
	if _, ok := actionProperties["bindingState"]; ok {
		t.Fatalf("RuntimeRecommendedAction should not expose legacy bindingState")
	}

	providerAction := objectValue(t, actionProperties, "providerActionCode")
	if _, ok := providerAction["enum"]; ok {
		t.Fatalf("providerActionCode should remain provider-defined")
	}
	if _, ok := providerAction["pattern"]; ok {
		t.Fatalf("providerActionCode should remain an opaque provider hint")
	}
	providerActionDescription, _ := providerAction["description"].(string)
	for _, knownAction := range []string{"claimApiKey", "upgradePlan", "enableOnDemand", "increaseSpendingLimit", "resolveAccountState"} {
		if !strings.Contains(providerActionDescription, knownAction) {
			t.Fatalf("providerActionCode description should mention official/reference provider action %q: %q", knownAction, providerActionDescription)
		}
	}
	for _, legacyAction := range []string{"claimApiKey", "upgradePlan", "enableOnDemand", "increaseSpendingLimit"} {
		if containsString(stringSlice(t, actionType["enum"]), legacyAction) {
			t.Fatalf("RuntimeRecommendedAction.type still exposes legacy action %q", legacyAction)
		}
	}
	actionSeverity := objectValue(t, actionProperties, "severity")
	if _, ok := actionSeverity["enum"]; ok {
		t.Fatalf("RuntimeRecommendedAction.severity should remain provider-defined")
	}

	envelopeDetails := objectValue(t, schemas, "RuntimeQuotaErrorEnvelopeDetails")
	if !containsString(stringSlice(t, envelopeDetails["required"]), "errorCategory") {
		t.Fatalf("RuntimeQuotaErrorEnvelopeDetails.errorCategory should be required")
	}
	envelopeProperties := objectValue(t, envelopeDetails, "properties")
	envelopeErrorCategory := objectValue(t, envelopeProperties, "errorCategory")
	if got, want := stringSlice(t, envelopeErrorCategory["enum"]), []string{"runtime_quota_denied"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RuntimeQuotaErrorEnvelopeDetails.errorCategory enum = %#v, want %#v", got, want)
	}
	if _, ok := envelopeProperties["runtimeQuota"]; !ok {
		t.Fatalf("RuntimeQuotaErrorEnvelopeDetails should expose public runtimeQuota details")
	}
	if got, ok := envelopeDetails["additionalProperties"].(bool); !ok || got {
		t.Fatalf("RuntimeQuotaErrorEnvelopeDetails.additionalProperties = %#v, want false", envelopeDetails["additionalProperties"])
	}

	runtimeQuotaDetails := objectValue(t, schemas, "RuntimeQuotaErrorDetails")
	if got, ok := runtimeQuotaDetails["additionalProperties"].(bool); !ok || got {
		t.Fatalf("RuntimeQuotaErrorDetails.additionalProperties = %#v, want false", runtimeQuotaDetails["additionalProperties"])
	}
	runtimeQuotaDetailProperties := objectValue(t, runtimeQuotaDetails, "properties")
	if required, ok := runtimeQuotaDetails["required"]; ok {
		if containsString(stringSlice(t, required), "errorCategory") {
			t.Fatalf("RuntimeQuotaErrorDetails should not require errorCategory inside runtime quota details")
		}
	}
	if _, ok := runtimeQuotaDetailProperties["errorCategory"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should keep errorCategory at the details envelope level")
	}
	if _, ok := runtimeQuotaDetailProperties["mem9Code"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should not define a mem9-specific routing code")
	}
	if _, ok := runtimeQuotaDetailProperties["providerReason"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should use quotaGateResult.reason for provider quota reasons")
	}
	if _, ok := runtimeQuotaDetailProperties["category"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should use errorCategory instead of a broad category field")
	}
	if _, ok := runtimeQuotaDetailProperties["code"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should use errorCategory instead of a broad code field")
	}
	if _, ok := runtimeQuotaDetailProperties["retryable"]; ok {
		t.Fatalf("RuntimeQuotaErrorDetails should not define retryability separately from HTTP status and Retry-After")
	}
	for _, property := range []string{"meter", "recommendedAction", "quotaGateResult"} {
		if _, ok := runtimeQuotaDetailProperties[property]; !ok {
			t.Fatalf("RuntimeQuotaErrorDetails missing public field %q", property)
		}
	}

	meter := objectValue(t, schemas, "RuntimeMeter")
	if meter["type"] != "string" {
		t.Fatalf("RuntimeMeter.type = %#v, want string", meter["type"])
	}
	if _, ok := meter["enum"]; ok {
		t.Fatalf("RuntimeMeter should be an opaque string without enum")
	}
	if meter["pattern"] == "" {
		t.Fatalf("RuntimeMeter should define a constraining pattern")
	}

	gateResult := objectValue(t, schemas, "RuntimeQuotaGateResult")
	if got, ok := gateResult["additionalProperties"].(bool); !ok || !got {
		t.Fatalf("RuntimeQuotaGateResult.additionalProperties = %#v, want true", gateResult["additionalProperties"])
	}
	gateProperties := objectValue(t, gateResult, "properties")
	mode := objectValue(t, gateProperties, "mode")
	if mode["type"] != "string" {
		t.Fatalf("RuntimeQuotaGateResult.mode type = %#v, want string", mode["type"])
	}
	if _, ok := mode["enum"]; ok {
		t.Fatalf("RuntimeQuotaGateResult.mode should remain provider-defined")
	}
	if _, ok := mode["pattern"]; ok {
		t.Fatalf("RuntimeQuotaGateResult.mode should not constrain provider-defined values")
	}
	reason := objectValue(t, gateProperties, "reason")
	if reason["type"] != "string" {
		t.Fatalf("RuntimeQuotaGateResult.reason type = %#v, want string", reason["type"])
	}
	if _, ok := reason["enum"]; ok {
		t.Fatalf("RuntimeQuotaGateResult.reason should remain provider-defined")
	}
	if _, ok := reason["pattern"]; ok {
		t.Fatalf("RuntimeQuotaGateResult.reason should not constrain provider-defined values")
	}

	postQuotaRateLimit := objectValue(t, schemas, "PostQuotaRateLimit")
	limitProperties := objectValue(t, postQuotaRateLimit, "properties")
	windowDurationSeconds := objectValue(t, limitProperties, "windowDurationSeconds")
	if windowDurationSeconds["minimum"] != float64(1) {
		t.Fatalf("windowDurationSeconds.minimum = %#v, want 1", windowDurationSeconds["minimum"])
	}
	if _, ok := windowDurationSeconds["enum"]; ok {
		t.Fatalf("windowDurationSeconds should not hard-code a provider window")
	}
	scope := objectValue(t, limitProperties, "scope")
	if _, ok := scope["enum"]; ok {
		t.Fatalf("post-quota rate-limit scope should be provider-defined")
	}
	if scope["pattern"] == "" {
		t.Fatalf("post-quota rate-limit scope should define a constraining pattern")
	}
}

func TestOpenAPIExternalProvenanceContract(t *testing.T) {
	openapi := loadOpenAPI(t)
	components := objectValue(t, openapi, "components")
	schemas := objectValue(t, components, "schemas")

	create := objectValue(t, schemas, "CreateMemoryRequest")
	createProperties := objectValue(t, create, "properties")
	metadata := objectValue(t, createProperties, "metadata")
	if got, want := metadata["$ref"], "#/components/schemas/CreateMemoryMetadata"; got != want {
		t.Fatalf("CreateMemoryRequest.metadata ref = %#v, want %s", got, want)
	}

	createMetadata := objectValue(t, schemas, "CreateMemoryMetadata")
	objectAlternatives := objectSlice(t, createMetadata["oneOf"])
	if len(objectAlternatives) == 0 {
		t.Fatal("CreateMemoryMetadata.oneOf should contain an object alternative")
	}
	metadataObject := objectAlternatives[0]
	metadataProperties := objectValue(t, metadataObject, "properties")
	reserved := objectValue(t, metadataProperties, "external_provenance")
	if got, want := reserved["$ref"], "#/components/schemas/ExternalProvenance"; got != want {
		t.Fatalf("external_provenance ref = %#v, want %s", got, want)
	}

	provenance := objectValue(t, schemas, "ExternalProvenance")
	if got, ok := provenance["additionalProperties"].(bool); !ok || got {
		t.Fatalf("ExternalProvenance.additionalProperties = %#v, want false", provenance["additionalProperties"])
	}
	for _, field := range []string{"schema", "source_message_id"} {
		if !containsString(stringSlice(t, provenance["required"]), field) {
			t.Fatalf("ExternalProvenance.required missing %q", field)
		}
	}
	provenanceProperties := objectValue(t, provenance, "properties")
	schema := objectValue(t, provenanceProperties, "schema")
	if got, want := stringSlice(t, schema["enum"]), []string{"agent9/message-source@1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ExternalProvenance.schema enum = %#v, want %#v", got, want)
	}
	sourceMessageID := objectValue(t, provenanceProperties, "source_message_id")
	if sourceMessageID["minLength"] != float64(1) || sourceMessageID["maxLength"] != float64(64) {
		t.Fatalf("source_message_id bounds = %#v/%#v, want 1/64", sourceMessageID["minLength"], sourceMessageID["maxLength"])
	}
	memory := objectValue(t, schemas, "Memory")
	memoryProperties := objectValue(t, memory, "properties")
	returnedMetadata := objectValue(t, memoryProperties, "metadata")
	if got, want := returnedMetadata["$ref"], "#/components/schemas/Metadata"; got != want {
		t.Fatalf("Memory.metadata ref = %#v, want permissive %s", got, want)
	}
	genericMetadata := objectValue(t, schemas, "Metadata")
	genericAlternatives := objectSlice(t, genericMetadata["oneOf"])
	if len(genericAlternatives) == 0 || genericAlternatives[0]["additionalProperties"] != true {
		t.Fatalf("Metadata object response must remain permissive: %#v", genericAlternatives)
	}
	description, _ := genericMetadata["description"].(string)
	if !strings.Contains(description, "metadata updates to a provenance-bearing memory must therefore be objects") {
		t.Fatalf("Metadata.description does not document the conditional object requirement: %q", description)
	}
	if !strings.Contains(description, "historical values are returned as stored") || !strings.Contains(description, "unrecognized provenance shapes as opaque") {
		t.Fatalf("Metadata.description does not document permissive historical responses: %q", description)
	}
	requestBodies := objectValue(t, components, "requestBodies")
	createImport := objectValue(t, requestBodies, "CreateImport")
	importDescription, _ := createImport["description"].(string)
	createImportRequest := objectValue(t, schemas, "CreateImportRequest")
	importSchemaDescription, _ := createImportRequest["description"].(string)
	for location, text := range map[string]string{
		"CreateImport":        importDescription,
		"CreateImportRequest": importSchemaDescription,
	} {
		if !strings.Contains(text, "external_provenance") || !strings.Contains(text, "202") || !strings.Contains(text, "task") {
			t.Fatalf("%s does not document asynchronous reserved-key rejection: %q", location, text)
		}
	}
}

func TestOpenAPIRuntimeStateContract(t *testing.T) {
	openapi := loadOpenAPI(t)
	responses := operationResponses(t, openapi, "/v1alpha2/mem9s/runtime-state", "get")
	assertResponseRef(t, responses, "200", "#/components/responses/RuntimeState")
	assertResponseRef(t, responses, "400", "#/components/responses/BadRequest")
	assertResponseRef(t, responses, "429", "#/components/responses/RateLimited")
	assertResponseRef(t, responses, "503", "#/components/responses/ServiceUnavailable")

	components := objectValue(t, openapi, "components")
	schemas := objectValue(t, components, "schemas")

	state := objectValue(t, schemas, "RuntimeStateResponse")
	if got, want := stringSlice(t, state["required"]), []string{"mem9ApiKey", "meters"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RuntimeStateResponse.required = %#v, want %#v", got, want)
	}
	stateProperties := objectValue(t, state, "properties")
	if _, ok := stateProperties["recommendedAction"]; !ok {
		t.Fatalf("RuntimeStateResponse should expose recommendedAction")
	}
	if _, ok := stateProperties["providerId"]; !ok {
		t.Fatalf("RuntimeStateResponse should expose optional providerId")
	}
	if _, ok := stateProperties["providerData"]; !ok {
		t.Fatalf("RuntimeStateResponse should expose optional providerData")
	}
	providerData := objectValue(t, stateProperties, "providerData")
	providerDataDescription, _ := providerData["description"].(string)
	for _, want := range []string{"independently of providerId", "recognize providerId"} {
		if !strings.Contains(providerDataDescription, want) {
			t.Fatalf("RuntimeStateResponse.providerData description missing %q: %q", want, providerDataDescription)
		}
	}
	meters := objectValue(t, stateProperties, "meters")
	if meters["minItems"] != float64(2) {
		t.Fatalf("RuntimeStateResponse.meters.minItems = %#v, want 2", meters["minItems"])
	}

	meter := objectValue(t, schemas, "RuntimeStateMeter")
	meterRequired := stringSlice(t, meter["required"])
	for _, field := range []string{"meter", "budgets"} {
		if !containsString(meterRequired, field) {
			t.Fatalf("RuntimeStateMeter.required missing %q: %#v", field, meterRequired)
		}
	}
	if containsString(meterRequired, "quotaGateResult") {
		t.Fatalf("RuntimeStateMeter.quotaGateResult should stay optional")
	}

	budget := objectValue(t, schemas, "RuntimeStatusBudget")
	budgetProperties := objectValue(t, budget, "properties")
	budgetType := objectValue(t, budgetProperties, "type")
	for _, value := range []string{"includedQuota", "spendingLimit", "credits", "notMetered", "unknown", "providerManaged"} {
		if !containsString(stringSlice(t, budgetType["enum"]), value) {
			t.Fatalf("RuntimeStatusBudget.type enum missing %q", value)
		}
	}
	budgetState := objectValue(t, budgetProperties, "state")
	for _, value := range []string{"ok", "warning", "exhausted", "unlimited", "unknown", "providerManaged"} {
		if !containsString(stringSlice(t, budgetState["enum"]), value) {
			t.Fatalf("RuntimeStatusBudget.state enum missing %q", value)
		}
	}
}

func TestOpenAPISuccessRuntimeNoticeFields(t *testing.T) {
	openapi := loadOpenAPI(t)
	components := objectValue(t, openapi, "components")
	schemas := objectValue(t, components, "schemas")

	status := objectValue(t, schemas, "StatusResponse")
	assertRuntimeNoticeProperties(t, objectValue(t, status, "properties"))

	list := objectValue(t, schemas, "MemoryListResponse")
	assertRuntimeNoticeProperties(t, objectValue(t, list, "properties"))

	created := objectValue(t, schemas, "MemoryCreateResponse")
	allOf := objectSlice(t, created["allOf"])
	if !containsRef(allOf, "#/components/schemas/Memory") {
		t.Fatalf("MemoryCreateResponse should extend Memory: %#v", allOf)
	}
	if len(allOf) < 2 {
		t.Fatalf("MemoryCreateResponse allOf = %#v, want notice extension", allOf)
	}
	assertRuntimeNoticeProperties(t, objectValue(t, allOf[1], "properties"))

	for _, path := range []string{"/v1alpha1/mem9s/{tenantID}/memories", "/v1alpha2/mem9s/memories"} {
		postResponses := operationResponses(t, openapi, path, "post")
		createdResponse := objectValue(t, postResponses, "201")
		content := objectValue(t, createdResponse, "content")
		jsonContent := objectValue(t, content, "application/json")
		schema := objectValue(t, jsonContent, "schema")
		if schema["$ref"] != "#/components/schemas/MemoryCreateResponse" {
			t.Fatalf("%s 201 schema ref = %#v, want MemoryCreateResponse", path, schema["$ref"])
		}
	}
}

func loadOpenAPI(t *testing.T) map[string]any {
	t.Helper()
	path := filepath.Join("..", "..", "..", "docs", "api", "openapi.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read OpenAPI spec: %v", err)
	}
	var openapi map[string]any
	if err := json.Unmarshal(data, &openapi); err != nil {
		t.Fatalf("parse OpenAPI spec: %v", err)
	}
	return openapi
}

func operationResponses(t *testing.T, openapi map[string]any, path string, method string) map[string]any {
	t.Helper()
	paths := objectValue(t, openapi, "paths")
	pathItem := objectValue(t, paths, path)
	operation := objectValue(t, pathItem, method)
	return objectValue(t, operation, "responses")
}

func assertResponseRef(t *testing.T, responses map[string]any, status string, want string) {
	t.Helper()
	response := objectValue(t, responses, status)
	if got := response["$ref"]; got != want {
		t.Fatalf("response %s ref = %#v, want %s", status, got, want)
	}
}

func assertNoResponseRef(t *testing.T, responses map[string]any, status string, unwanted string) {
	t.Helper()
	response, ok := responses[status].(map[string]any)
	if !ok {
		return
	}
	if got := response["$ref"]; got == unwanted {
		t.Fatalf("response %s ref = %#v, want a non-runtime quota response", status, got)
	}
}

func objectValue(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("key %q = %T, want object", key, value)
	}
	return object
}

func stringSlice(t *testing.T, value any) []string {
	t.Helper()
	values, ok := value.([]any)
	if !ok {
		t.Fatalf("value = %T, want array", value)
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		text, ok := value.(string)
		if !ok {
			t.Fatalf("array value = %T, want string", value)
		}
		out = append(out, text)
	}
	return out
}

func objectSlice(t *testing.T, value any) []map[string]any {
	t.Helper()
	values, ok := value.([]any)
	if !ok {
		t.Fatalf("value = %T, want array", value)
	}
	out := make([]map[string]any, 0, len(values))
	for _, value := range values {
		object, ok := value.(map[string]any)
		if !ok {
			t.Fatalf("array value = %T, want object", value)
		}
		out = append(out, object)
	}
	return out
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func containsRef(values []map[string]any, target string) bool {
	for _, value := range values {
		if value["$ref"] == target {
			return true
		}
	}
	return false
}

func assertRuntimeNoticeProperties(t *testing.T, properties map[string]any) {
	t.Helper()
	message := objectValue(t, properties, "message")
	if message["type"] != "string" {
		t.Fatalf("message.type = %#v, want string", message["type"])
	}
	runtimeState := objectValue(t, properties, "runtimeState")
	if runtimeState["$ref"] != "#/components/schemas/RuntimeStateResponse" {
		t.Fatalf("runtimeState ref = %#v, want RuntimeStateResponse", runtimeState["$ref"])
	}
}

func allOfHasDetailsRef(values []map[string]any, target string) bool {
	for _, value := range values {
		properties, ok := value["properties"].(map[string]any)
		if !ok {
			continue
		}
		details, ok := properties["details"].(map[string]any)
		if !ok {
			continue
		}
		if details["$ref"] == target {
			return true
		}
	}
	return false
}

func allOfRequiresProperty(values []map[string]any, target string) bool {
	for _, value := range values {
		required, ok := value["required"].([]any)
		if !ok {
			continue
		}
		for _, item := range required {
			if item == target {
				return true
			}
		}
	}
	return false
}
