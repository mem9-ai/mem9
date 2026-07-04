package handler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const (
	runtimeAccessBlockedRef = "#/components/responses/RuntimeAccessBlocked"
	postQuotaRateLimitedRef = "#/components/responses/PostQuotaRateLimited"
	genericRateLimitedRef   = "#/components/responses/RateLimited"
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
			assertResponseRef(t, responses, "429", postQuotaRateLimitedRef)
		}
	}

	getByIDResponses := operationResponses(t, openapi, "/v1alpha2/mem9s/memories/{id}", "get")
	assertResponseRef(t, getByIDResponses, "429", genericRateLimitedRef)
	assertNoResponseRef(t, operationResponses(t, openapi, "/v1alpha1/mem9s/{tenantID}/memories/{id}", "get"), "402", runtimeAccessBlockedRef)
	assertNoResponseRef(t, operationResponses(t, openapi, "/v1alpha1/mem9s/{tenantID}/memories/{id}", "get"), "429", postQuotaRateLimitedRef)
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
	for _, legacyAction := range []string{"claimApiKey", "upgradePlan", "enableOnDemand", "increaseSpendingLimit"} {
		if containsString(stringSlice(t, actionType["enum"]), legacyAction) {
			t.Fatalf("RuntimeRecommendedAction.type still exposes legacy action %q", legacyAction)
		}
	}

	details := objectValue(t, schemas, "RuntimeQuotaErrorDetails")
	if got, ok := details["additionalProperties"].(bool); !ok || !got {
		t.Fatalf("RuntimeQuotaErrorDetails.additionalProperties = %#v, want true", details["additionalProperties"])
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
	gateProperties := objectValue(t, gateResult, "properties")
	reason := objectValue(t, gateProperties, "reason")
	wantReasons := []string{
		"includedQuotaAvailable",
		"includedQuotaExhausted",
		"onDemandAvailable",
		"onDemandDisabled",
		"onDemandUnavailable",
		"onDemandBudgetExhausted",
		"postQuotaRateLimitExceeded",
		"accountStateBlocked",
	}
	if got := stringSlice(t, reason["enum"]); !reflect.DeepEqual(got, wantReasons) {
		t.Fatalf("RuntimeQuotaGateResult.reason enum = %#v, want %#v", got, wantReasons)
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
