package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	dataHubProviderName       = "datahub"
	defaultDataHubMCPTimeout  = 5 * time.Second
	defaultDataHubMCPMaxItems = 5
	mcpProtocolVersion        = "2025-03-26"
)

// ExternalContextItem is a read-only context item retrieved from an external
// provider and returned alongside mem9 recall results.
type ExternalContextItem struct {
	Provider string          `json:"provider"`
	Type     string          `json:"type,omitempty"`
	ID       string          `json:"id,omitempty"`
	Title    string          `json:"title,omitempty"`
	Snippet  string          `json:"snippet,omitempty"`
	URL      string          `json:"url,omitempty"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

// ExternalContextProvider retrieves context from systems outside mem9.
type ExternalContextProvider interface {
	Retrieve(ctx context.Context, query string, limit int) ([]ExternalContextItem, error)
}

// DataHubMCPConfig configures the DataHub MCP read-only context provider.
type DataHubMCPConfig struct {
	Endpoint   string
	Token      string
	Timeout    time.Duration
	MaxResults int
}

// DataHubMCPContextProvider retrieves enterprise data context through DataHub's
// MCP server. It intentionally starts read-only: mem9 keeps memory ownership and
// DataHub remains the source of truth for data assets.
type DataHubMCPContextProvider struct {
	client     *mcpHTTPClient
	maxResults int
}

func NewDataHubMCPContextProvider(cfg DataHubMCPConfig) *DataHubMCPContextProvider {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultDataHubMCPTimeout
	}
	maxResults := cfg.MaxResults
	if maxResults <= 0 {
		maxResults = defaultDataHubMCPMaxItems
	}
	return &DataHubMCPContextProvider{
		client: &mcpHTTPClient{
			endpoint: strings.TrimSpace(cfg.Endpoint),
			token:    strings.TrimSpace(cfg.Token),
			httpClient: &http.Client{
				Timeout: timeout,
			},
		},
		maxResults: maxResults,
	}
}

func (p *DataHubMCPContextProvider) Retrieve(ctx context.Context, query string, limit int) ([]ExternalContextItem, error) {
	if p == nil || p.client == nil {
		return nil, nil
	}
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	if limit <= 0 || limit > p.maxResults {
		limit = p.maxResults
	}

	result, err := p.client.CallTool(ctx, "search", map[string]any{
		"query":       FormatDataHubSearchQuery(query),
		"num_results": limit,
		"offset":      0,
	})
	if err != nil {
		return nil, err
	}
	items := normalizeDataHubToolResult(result)
	if len(items) == 0 {
		return items, nil
	}
	urns := collectDataHubURNs(items, minInt(limit, 3))
	if len(urns) == 0 {
		return trimExternalContextItems(items, limit), nil
	}

	entityResult, err := p.client.CallTool(ctx, "get_entities", map[string]any{
		"urns": urns,
	})
	if err != nil {
		return trimExternalContextItems(items, limit), nil
	}
	entityItems := normalizeDataHubToolResult(entityResult)
	if len(entityItems) == 0 {
		return trimExternalContextItems(items, limit), nil
	}
	items = mergeExternalContextItems(items, entityItems)

	lineageURN := preferredDataHubLineageURN(items)
	if lineageURN == "" {
		return trimExternalContextItems(items, limit), nil
	}
	lineageLimit := minInt(limit, p.maxResults)
	for _, direction := range []struct {
		name     string
		upstream bool
	}{
		{name: "upstream", upstream: true},
		{name: "downstream", upstream: false},
	} {
		lineageResult, err := p.client.CallTool(ctx, "get_lineage", map[string]any{
			"urn":         lineageURN,
			"query":       "*",
			"upstream":    direction.upstream,
			"max_hops":    1,
			"max_results": lineageLimit,
			"offset":      0,
		})
		if err != nil {
			continue
		}
		items = append(items, normalizeDataHubLineageToolResult(lineageURN, direction.name, lineageResult)...)
	}
	return trimExternalContextItems(items, limit), nil
}

func ShouldQueryDataHubContext(query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return false
	}
	for _, phrase := range []string{"power bi"} {
		if strings.Contains(q, phrase) {
			return true
		}
	}
	for _, token := range dataHubQueryTokens(q) {
		if dataHubContextTerms[token] {
			return true
		}
	}
	for _, term := range []string{"数据集", "数据资产", "数据表", "看板", "仪表盘", "指标", "血缘", "字段", "数据仓库", "负责人", "质量", "新鲜度"} {
		if strings.Contains(query, term) {
			return true
		}
	}
	return false
}

var dataHubContextTerms = map[string]bool{
	"bigquery":   true,
	"column":     true,
	"dashboard":  true,
	"databricks": true,
	"datahub":    true,
	"dataset":    true,
	"dbt":        true,
	"field":      true,
	"freshness":  true,
	"lineage":    true,
	"looker":     true,
	"metric":     true,
	"owner":      true,
	"pii":        true,
	"powerbi":    true,
	"quality":    true,
	"schema":     true,
	"snowflake":  true,
	"sql":        true,
	"table":      true,
	"tableau":    true,
	"warehouse":  true,
}

func dataHubQueryTokens(query string) []string {
	return strings.FieldsFunc(query, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
}

func FormatDataHubSearchQuery(query string) string {
	q := strings.TrimSpace(query)
	if q == "" {
		return "*"
	}
	lower := strings.ToLower(q)
	if strings.HasPrefix(lower, "/q") || q == "*" {
		return q
	}

	terms := make([]string, 0, 6)
	for _, field := range strings.Fields(q) {
		term := normalizeDataHubSearchTerm(field)
		if term == "" || dataHubSearchStopWords[strings.ToLower(term)] {
			continue
		}
		terms = append(terms, term)
		if len(terms) == 6 {
			break
		}
	}
	if len(terms) == 0 {
		return "/q " + q
	}
	return "/q " + strings.Join(terms, "+")
}

var dataHubSearchStopWords = map[string]bool{
	"a": true, "an": true, "and": true, "are": true, "be": true, "did": true, "does": true,
	"for": true, "from": true, "how": true, "i": true, "is": true, "it": true, "me": true,
	"of": true, "on": true, "or": true, "our": true, "the": true, "this": true, "to": true,
	"today": true, "what": true, "when": true, "where": true, "who": true, "why": true,
	"wrong": true, "broken": true, "bad": true, "issue": true, "problem": true,
}

func normalizeDataHubSearchTerm(term string) string {
	term = strings.TrimFunc(term, func(r rune) bool {
		return unicode.IsPunct(r) && r != '_' && r != '.' && r != ':' && r != '-' && r != '*'
	})
	if term == "" {
		return ""
	}
	for _, r := range term {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_' || r == '.' || r == ':' || r == '-' || r == '*' {
			continue
		}
		return ""
	}
	return term
}

type mcpHTTPClient struct {
	endpoint string
	token    string

	httpClient *http.Client

	initMu      sync.Mutex
	mu          sync.Mutex
	initialized bool
	sessionID   string
	nextID      int64
}

func (c *mcpHTTPClient) CallTool(ctx context.Context, name string, arguments map[string]any) (*mcpToolResult, error) {
	if c == nil || strings.TrimSpace(c.endpoint) == "" {
		return nil, fmt.Errorf("datahub MCP endpoint is required")
	}
	if err := c.ensureInitialized(ctx); err != nil {
		return nil, err
	}
	result, err := c.post(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	}, true)
	if err != nil {
		return nil, err
	}
	var toolResult mcpToolResult
	if len(result) > 0 {
		if err := json.Unmarshal(result, &toolResult); err != nil {
			return nil, fmt.Errorf("decode MCP tool result: %w", err)
		}
	}
	if toolResult.IsError {
		return nil, fmt.Errorf("datahub MCP tool %s returned an error", name)
	}
	return &toolResult, nil
}

func (c *mcpHTTPClient) ensureInitialized(ctx context.Context) error {
	c.initMu.Lock()
	defer c.initMu.Unlock()

	c.mu.Lock()
	if c.initialized {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	result, err := c.post(ctx, "initialize", map[string]any{
		"protocolVersion": mcpProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "mem9-datahub-context",
			"version": "dev",
		},
	}, true)
	if err != nil {
		return err
	}
	if len(result) == 0 {
		return fmt.Errorf("datahub MCP initialize returned empty result")
	}
	if _, err := c.post(ctx, "notifications/initialized", map[string]any{}, false); err != nil {
		return err
	}

	c.mu.Lock()
	c.initialized = true
	c.mu.Unlock()
	return nil
}

func (c *mcpHTTPClient) post(ctx context.Context, method string, params any, expectResult bool) (json.RawMessage, error) {
	body, err := json.Marshal(c.jsonRPCRequest(method, params, expectResult))
	if err != nil {
		return nil, fmt.Errorf("encode MCP request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create MCP request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", mcpProtocolVersion)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()
	if sessionID != "" {
		req.Header.Set("Mcp-Session-Id", sessionID)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call MCP %s: %w", method, err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read MCP response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP %s returned HTTP %d: %s", method, resp.StatusCode, compactSnippet(string(responseBody), 300))
	}
	if sid := resp.Header.Get("Mcp-Session-Id"); sid != "" {
		c.mu.Lock()
		c.sessionID = sid
		c.mu.Unlock()
	}
	if len(strings.TrimSpace(string(responseBody))) == 0 {
		return nil, nil
	}

	responseBody = extractSSEData(responseBody)
	var rpcResp mcpRPCResponse
	if err := json.Unmarshal(responseBody, &rpcResp); err != nil {
		return nil, fmt.Errorf("decode MCP %s response: %w", method, err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("MCP %s error %d: %s", method, rpcResp.Error.Code, rpcResp.Error.Message)
	}
	if expectResult && len(rpcResp.Result) == 0 {
		return nil, fmt.Errorf("MCP %s returned empty result", method)
	}
	return rpcResp.Result, nil
}

func (c *mcpHTTPClient) jsonRPCRequest(method string, params any, withID bool) map[string]any {
	req := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}
	if withID {
		c.mu.Lock()
		c.nextID++
		id := c.nextID
		c.mu.Unlock()
		req["id"] = id
	}
	return req
}

type mcpRPCResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *mcpRPCError    `json:"error,omitempty"`
}

type mcpRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpToolResult struct {
	Content           []mcpContentItem `json:"content"`
	StructuredContent json.RawMessage  `json:"structuredContent,omitempty"`
	IsError           bool             `json:"isError,omitempty"`
}

type mcpContentItem struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

func extractSSEData(body []byte) []byte {
	trimmed := bytes.TrimSpace(body)
	if !bytes.HasPrefix(trimmed, []byte("data:")) && !bytes.Contains(trimmed, []byte("\ndata:")) {
		return body
	}
	var eventData bytes.Buffer
	var fallback bytes.Buffer
	var firstJSON []byte
	for _, rawLine := range bytes.Split(body, []byte{'\n'}) {
		line := bytes.TrimSpace(rawLine)
		if len(line) == 0 {
			if data, ok := finishSSEDataEvent(&eventData, &fallback, &firstJSON); ok {
				return data
			}
			continue
		}
		if bytes.HasPrefix(line, []byte("data:")) {
			chunk := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
			if eventData.Len() > 0 {
				eventData.WriteByte('\n')
			}
			eventData.Write(chunk)
		}
	}
	if data, ok := finishSSEDataEvent(&eventData, &fallback, &firstJSON); ok {
		return data
	}
	if len(firstJSON) > 0 {
		return firstJSON
	}
	if fallback.Len() == 0 {
		return body
	}
	return fallback.Bytes()
}

func finishSSEDataEvent(eventData *bytes.Buffer, fallback *bytes.Buffer, firstJSON *[]byte) ([]byte, bool) {
	if eventData.Len() == 0 {
		return nil, false
	}
	data := append([]byte(nil), bytes.TrimSpace(eventData.Bytes())...)
	eventData.Reset()
	if len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
		return nil, false
	}
	if fallback.Len() > 0 {
		fallback.WriteByte('\n')
	}
	fallback.Write(data)
	if !json.Valid(data) {
		return nil, false
	}
	if len(*firstJSON) == 0 {
		*firstJSON = append([]byte(nil), data...)
	}
	if isJSONRPCResponseData(data) {
		return data, true
	}
	return nil, false
}

func isJSONRPCResponseData(data []byte) bool {
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return false
	}
	_, hasResult := decoded["result"]
	_, hasError := decoded["error"]
	return hasResult || hasError
}

func normalizeDataHubToolResult(result *mcpToolResult) []ExternalContextItem {
	if result == nil {
		return nil
	}
	if len(result.StructuredContent) > 0 {
		var decoded any
		if err := json.Unmarshal(result.StructuredContent, &decoded); err == nil {
			if items := normalizeDataHubJSON(decoded); len(items) > 0 {
				return items
			}
		}
	}
	items := make([]ExternalContextItem, 0, len(result.Content))
	for _, content := range result.Content {
		if content.Type != "text" || strings.TrimSpace(content.Text) == "" {
			continue
		}
		items = append(items, normalizeDataHubTextContent(content.Text)...)
	}
	return items
}

func normalizeDataHubLineageToolResult(urn, direction string, result *mcpToolResult) []ExternalContextItem {
	if result == nil {
		return nil
	}
	if len(result.StructuredContent) > 0 {
		var decoded map[string]any
		if err := json.Unmarshal(result.StructuredContent, &decoded); err == nil {
			item := dataHubLineageItem(urn, direction, decoded)
			if item.ID != "" {
				return []ExternalContextItem{item}
			}
		}
	}
	for _, content := range result.Content {
		if content.Type != "text" || strings.TrimSpace(content.Text) == "" {
			continue
		}
		var decoded map[string]any
		if err := json.Unmarshal([]byte(content.Text), &decoded); err != nil {
			continue
		}
		item := dataHubLineageItem(urn, direction, decoded)
		if item.ID != "" {
			return []ExternalContextItem{item}
		}
	}
	return nil
}

func normalizeDataHubTextContent(text string) []ExternalContextItem {
	var decoded any
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		return []ExternalContextItem{{
			Provider: dataHubProviderName,
			Type:     "text",
			Title:    "DataHub context",
			Snippet:  compactSnippet(text, 800),
		}}
	}
	return normalizeDataHubJSON(decoded)
}

func normalizeDataHubJSON(decoded any) []ExternalContextItem {
	switch v := decoded.(type) {
	case map[string]any:
		if isDataHubErrorObject(v) {
			return nil
		}
		if items, ok := normalizeDataHubSearchResultCollection(v["searchResults"]); ok {
			return items
		}
		if items, ok := normalizeDataHubSearchResultCollection(v["results"]); ok {
			return items
		}
		if entities, ok := normalizeDataHubEntityCollection(v["entities"]); ok {
			return entities
		}
		if entity, ok := v["entity"].(map[string]any); ok {
			return []ExternalContextItem{dataHubEntityItem(entity)}
		}
		if _, ok := v["urn"].(string); ok {
			return []ExternalContextItem{dataHubEntityItem(v)}
		}
		raw, _ := json.Marshal(v)
		return []ExternalContextItem{{
			Provider: dataHubProviderName,
			Type:     "search_result",
			Title:    "DataHub result",
			Snippet:  compactSnippet(string(raw), 800),
			Metadata: raw,
		}}
	case []any:
		items := make([]ExternalContextItem, 0, len(v))
		for _, raw := range v {
			if entity, ok := raw.(map[string]any); ok {
				if item, ok := dataHubSearchResultItem(entity); ok {
					items = append(items, item)
				}
			}
		}
		return items
	default:
		return nil
	}
}

func normalizeDataHubSearchResultCollection(raw any) ([]ExternalContextItem, bool) {
	rawResults, ok := raw.([]any)
	if !ok {
		return nil, false
	}
	items := make([]ExternalContextItem, 0, len(rawResults))
	for _, raw := range rawResults {
		if result, ok := raw.(map[string]any); ok {
			if item, ok := dataHubSearchResultItem(result); ok {
				items = append(items, item)
			}
		}
	}
	return items, true
}

func dataHubSearchResultItem(result map[string]any) (ExternalContextItem, bool) {
	if isDataHubErrorObject(result) {
		return ExternalContextItem{}, false
	}
	switch entity := result["entity"].(type) {
	case map[string]any:
		if isDataHubErrorObject(entity) {
			return ExternalContextItem{}, false
		}
		return dataHubEntityItem(entity), true
	case string:
		if strings.HasPrefix(entity, "urn:li:") {
			entityMap := map[string]any{"urn": entity}
			copyDataHubEntityField(entityMap, result, "type", "type", "entityType")
			copyDataHubEntityField(entityMap, result, "name", "name", "displayName", "qualifiedName")
			copyDataHubEntityField(entityMap, result, "description", "description")
			copyDataHubEntityField(entityMap, result, "url", "url")
			return dataHubEntityItem(entityMap), true
		}
	}
	return dataHubEntityItem(result), true
}

func copyDataHubEntityField(dst, src map[string]any, dstKey string, paths ...string) {
	if value := firstString(src, paths...); value != "" {
		dst[dstKey] = value
	}
}

func normalizeDataHubEntityCollection(raw any) ([]ExternalContextItem, bool) {
	switch v := raw.(type) {
	case map[string]any:
		items := make([]ExternalContextItem, 0, len(v))
		for urn, rawEntity := range v {
			entity, ok := rawEntity.(map[string]any)
			if !ok || isDataHubErrorObject(entity) {
				continue
			}
			if unwrapped, ok := entity["entity"].(map[string]any); ok && !isDataHubErrorObject(unwrapped) {
				entity = unwrapped
			}
			if _, ok := entity["urn"].(string); !ok && strings.HasPrefix(urn, "urn:li:") {
				entity = cloneStringAnyMap(entity)
				entity["urn"] = urn
			}
			items = append(items, dataHubEntityItem(entity))
		}
		return items, true
	case []any:
		items := make([]ExternalContextItem, 0, len(v))
		for _, rawEntity := range v {
			entity, ok := rawEntity.(map[string]any)
			if !ok || isDataHubErrorObject(entity) {
				continue
			}
			if item, ok := dataHubSearchResultItem(entity); ok {
				items = append(items, item)
			}
		}
		return items, true
	default:
		return nil, false
	}
}

func isDataHubErrorObject(value map[string]any) bool {
	_, ok := value["error"]
	return ok
}

func cloneStringAnyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in)+1)
	for k, v := range in {
		out[k] = v
	}
	return out
}

func dataHubEntityItem(entity map[string]any) ExternalContextItem {
	raw, _ := json.Marshal(entity)
	title := dataHubEntityTitle(entity)
	snippet := firstString(entity, "description", "properties.description", "editableProperties.description")
	if snippet == "" {
		snippet = compactSnippet(string(raw), 500)
	}
	return ExternalContextItem{
		Provider: dataHubProviderName,
		Type:     firstString(entity, "type"),
		ID:       firstString(entity, "urn"),
		Title:    title,
		Snippet:  compactSnippet(snippet, 800),
		URL:      firstString(entity, "url", "properties.externalUrl"),
		Metadata: raw,
	}
}

func dataHubEntityTitle(entity map[string]any) string {
	return firstString(entity, "name", "displayName", "qualifiedName", "properties.name", "properties.displayName", "properties.qualifiedName", "urn")
}

func dataHubLineageItem(urn, direction string, decoded map[string]any) ExternalContextItem {
	key := direction + "s"
	rawResults, ok := dataHubLineageResults(decoded[key])
	if !ok {
		return ExternalContextItem{}
	}
	if len(rawResults) == 0 {
		return ExternalContextItem{}
	}

	names := make([]string, 0, minInt(len(rawResults), 5))
	for _, raw := range rawResults {
		result, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		entity := lineageResultEntity(result)
		if entity == nil {
			continue
		}
		name := dataHubEntityTitle(entity)
		if typ := firstString(entity, "type"); typ != "" && name != "" {
			name += " (" + typ + ")"
		}
		if name != "" {
			names = append(names, name)
		}
		if len(names) == 5 {
			break
		}
	}
	if len(names) == 0 {
		return ExternalContextItem{}
	}
	raw, _ := json.Marshal(decoded)
	typeName := "LINEAGE_" + strings.ToUpper(direction)
	titleDirection := strings.ToUpper(direction[:1]) + direction[1:]
	return ExternalContextItem{
		Provider: dataHubProviderName,
		Type:     typeName,
		ID:       urn + "#lineage:" + direction,
		Title:    "DataHub " + titleDirection + " lineage",
		Snippet:  titleDirection + " lineage for " + urn + ": " + strings.Join(names, ", "),
		Metadata: raw,
	}
}

func dataHubLineageResults(raw any) ([]any, bool) {
	switch v := raw.(type) {
	case map[string]any:
		if rawResults, ok := v["searchResults"].([]any); ok {
			return rawResults, true
		}
		if rawResults, ok := v["results"].([]any); ok {
			return rawResults, true
		}
		return nil, false
	case []any:
		return v, true
	default:
		return nil, false
	}
}

func lineageResultEntity(result map[string]any) map[string]any {
	if entity, ok := result["entity"].(map[string]any); ok {
		return entity
	}
	if _, ok := result["urn"].(string); ok {
		return result
	}
	return nil
}

func collectDataHubURNs(items []ExternalContextItem, limit int) []string {
	if limit <= 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	urns := make([]string, 0, limit)
	for _, item := range items {
		if !strings.HasPrefix(item.ID, "urn:li:") {
			continue
		}
		if _, ok := seen[item.ID]; ok {
			continue
		}
		seen[item.ID] = struct{}{}
		urns = append(urns, item.ID)
		if len(urns) == limit {
			break
		}
	}
	return urns
}

func preferredDataHubLineageURN(groups ...[]ExternalContextItem) string {
	var fallback string
	for _, items := range groups {
		for _, item := range items {
			if item.ID == "" || !strings.HasPrefix(item.ID, "urn:li:") {
				continue
			}
			if strings.EqualFold(item.Type, "DATASET") || strings.HasPrefix(item.ID, "urn:li:dataset:") {
				return item.ID
			}
			if fallback == "" {
				fallback = item.ID
			}
		}
	}
	return fallback
}

func mergeExternalContextItems(base, updates []ExternalContextItem) []ExternalContextItem {
	if len(updates) == 0 {
		return base
	}
	out := append([]ExternalContextItem(nil), base...)
	indexByID := make(map[string]int, len(out))
	for i, item := range out {
		if item.ID != "" {
			indexByID[item.ID] = i
		}
	}
	for _, update := range updates {
		if update.ID != "" {
			if i, ok := indexByID[update.ID]; ok {
				out[i] = update
				continue
			}
			indexByID[update.ID] = len(out)
		}
		out = append(out, update)
	}
	return out
}

func trimExternalContextItems(items []ExternalContextItem, limit int) []ExternalContextItem {
	if limit <= 0 || len(items) <= limit {
		return items
	}
	lineage := make([]ExternalContextItem, 0, 2)
	nonLineage := make([]ExternalContextItem, 0, len(items))
	for _, item := range items {
		if strings.HasPrefix(item.Type, "LINEAGE_") {
			lineage = append(lineage, item)
			continue
		}
		nonLineage = append(nonLineage, item)
	}
	if len(lineage) == 0 || limit == 1 {
		return items[:limit]
	}

	out := make([]ExternalContextItem, 0, limit)
	if len(nonLineage) > 0 {
		out = append(out, nonLineage[0])
	}
	for _, item := range lineage {
		if len(out) == limit {
			return out
		}
		out = append(out, item)
	}
	for i, item := range nonLineage {
		if len(out) == limit {
			return out
		}
		if i == 0 {
			continue
		}
		out = append(out, item)
	}
	return out
}

func firstString(root map[string]any, paths ...string) string {
	for _, path := range paths {
		if v := stringAtPath(root, path); v != "" {
			return v
		}
	}
	return ""
}

func stringAtPath(root map[string]any, path string) string {
	var cur any = root
	for _, part := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = m[part]
	}
	if s, ok := cur.(string); ok {
		return s
	}
	return ""
}

func compactSnippet(text string, maxLen int) string {
	text = strings.Join(strings.Fields(text), " ")
	if maxLen <= 0 || len(text) <= maxLen {
		return text
	}
	runes := []rune(text)
	if len(runes) <= maxLen {
		return text
	}
	return string(runes[:maxLen]) + "..."
}
