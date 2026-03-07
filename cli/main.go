package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// --- Configuration ---

var (
	apiURL   string
	tenantID string
	agentID  string
	timeout  time.Duration
	verbose  bool
)

// --- Response Types ---

type ProvisionResponse struct {
	ID       string `json:"id"`
	ClaimURL string `json:"claim_url,omitempty"`
}

type Memory struct {
	ID         string                 `json:"id"`
	Content    string                 `json:"content"`
	Source     string                 `json:"source,omitempty"`
	Tags       []string               `json:"tags,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	Version    int                    `json:"version"`
	UpdatedBy  string                 `json:"updated_by,omitempty"`
	CreatedAt  string                 `json:"created_at"`
	UpdatedAt  string                 `json:"updated_at"`
	Score      float64                `json:"score,omitempty"`
	MemoryType string                 `json:"memory_type,omitempty"`
	State      string                 `json:"state,omitempty"`
	AgentID    string                 `json:"agent_id,omitempty"`
	SessionID  string                 `json:"session_id,omitempty"`
}

type ListResponse struct {
	Memories []Memory `json:"memories"`
	Total    int      `json:"total"`
	Limit    int      `json:"limit"`
	Offset   int      `json:"offset"`
}

type BootstrapResponse struct {
	Memories []Memory `json:"memories"`
	Total    int      `json:"total"`
}

type BulkResponse struct {
	OK       bool     `json:"ok"`
	Memories []Memory `json:"memories"`
}

type IngestResponse struct {
	Status          string   `json:"status"`
	MemoriesChanged int      `json:"memories_changed"`
	InsightIDs      []string `json:"insight_ids,omitempty"`
	Warnings        int      `json:"warnings,omitempty"`
	Error           string   `json:"error,omitempty"`
}

type TaskResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type TaskDetail struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	Status string `json:"status"`
	Total  int    `json:"total"`
	Done   int    `json:"done"`
	Error  string `json:"error,omitempty"`
}

type TaskListResponse struct {
	Status string       `json:"status"`
	Tasks  []TaskDetail `json:"tasks"`
}

type TenantInfo struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

// --- HTTP Client ---

type Client struct {
	baseURL  string
	tenantID string
	agentID  string
	http     *http.Client
	verbose  bool
}

func NewClient(baseURL, tenantID, agentID string, timeout time.Duration, verbose bool) *Client {
	return &Client{
		baseURL:  strings.TrimSuffix(baseURL, "/"),
		tenantID: tenantID,
		agentID:  agentID,
		http:     &http.Client{Timeout: timeout},
		verbose:  verbose,
	}
}

func (c *Client) tenantPath(path string) string {
	return fmt.Sprintf("/v1alpha1/mem9s/%s%s", c.tenantID, path)
}

func buildCurlCommand(method, url string, headers http.Header, body interface{}) string {
	var parts []string
	parts = append(parts, "curl")

	// Add method if not GET
	if method != "GET" {
		parts = append(parts, "-X", method)
	}

	// Add headers
	for k, v := range headers {
		// Skip Content-Length as curl handles it automatically
		if k == "Content-Length" {
			continue
		}
		parts = append(parts, "-H", fmt.Sprintf("'%s: %s'", k, strings.Join(v, ", ")))
	}

	// Add body if present
	if body != nil {
		data, err := json.Marshal(body)
		if err == nil {
			// Escape single quotes in JSON
			jsonStr := strings.ReplaceAll(string(data), "'", "'\\''")
			parts = append(parts, "-d", fmt.Sprintf("'%s'", jsonStr))
		}
	}

	// Add URL (quoted to handle special chars)
	parts = append(parts, fmt.Sprintf("'%s'", url))

	return strings.Join(parts, " ")
}

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, int, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.agentID != "" {
		req.Header.Set("X-Mnemo-Agent-Id", c.agentID)
	}

	// Always print curl command
	curlCmd := buildCurlCommand(method, c.baseURL+path, req.Header, body)
	fmt.Fprintf(os.Stderr, "%s\n", curlCmd)

	if c.verbose {
		fmt.Fprintf(os.Stderr, "\n--> %s %s\n", method, c.baseURL+path)
		for k, v := range req.Header {
			fmt.Fprintf(os.Stderr, "%s: %s\n", k, strings.Join(v, ", "))
		}
		if body != nil {
			prettyBody, _ := json.MarshalIndent(body, "", "  ")
			fmt.Fprintf(os.Stderr, "\n%s\n", string(prettyBody))
		}
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}

	if c.verbose {
		fmt.Fprintf(os.Stderr, "\n<-- %d %s\n", resp.StatusCode, http.StatusText(resp.StatusCode))
		if len(respBody) > 0 {
			var prettyResp interface{}
			if json.Unmarshal(respBody, &prettyResp) == nil {
				formatted, _ := json.MarshalIndent(prettyResp, "", "  ")
				fmt.Fprintf(os.Stderr, "%s\n", string(formatted))
			} else {
				fmt.Fprintf(os.Stderr, "%s\n", string(respBody))
			}
		}
	}

	return respBody, resp.StatusCode, nil
}

func (c *Client) doMultipart(path string, fields map[string]string, filePath string) ([]byte, int, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Add form fields
	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			return nil, 0, fmt.Errorf("write field %s: %w", k, err)
		}
	}

	// Add file
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return nil, 0, fmt.Errorf("create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return nil, 0, fmt.Errorf("copy file: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, 0, fmt.Errorf("close writer: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+path, &buf)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.agentID != "" {
		req.Header.Set("X-Mnemo-Agent-Id", c.agentID)
	}

	if c.verbose {
		fmt.Fprintf(os.Stderr, "\n--> POST %s (multipart)\n", c.baseURL+path)
		for k, v := range req.Header {
			fmt.Fprintf(os.Stderr, "%s: %s\n", k, strings.Join(v, ", "))
		}
		fmt.Fprintf(os.Stderr, "\nForm fields: %v\n", fields)
		fmt.Fprintf(os.Stderr, "File: %s\n", filePath)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}

	if c.verbose {
		fmt.Fprintf(os.Stderr, "\n<-- %d %s\n", resp.StatusCode, http.StatusText(resp.StatusCode))
		if len(respBody) > 0 {
			var prettyResp interface{}
			if json.Unmarshal(respBody, &prettyResp) == nil {
				formatted, _ := json.MarshalIndent(prettyResp, "", "  ")
				fmt.Fprintf(os.Stderr, "%s\n", string(formatted))
			} else {
				fmt.Fprintf(os.Stderr, "%s\n", string(respBody))
			}
		}
	}
	return respBody, resp.StatusCode, nil
}

// --- API Methods ---

func (c *Client) Provision() (*ProvisionResponse, error) {
	body, status, err := c.doRequest("POST", "/v1alpha1/mem9s", nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp ProvisionResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) CreateMemory(content string, tags []string, metadata map[string]interface{}) (any, error) {
	reqBody := map[string]interface{}{
		"content": content,
	}
	if len(tags) > 0 {
		reqBody["tags"] = tags
	}
	if len(metadata) > 0 {
		reqBody["metadata"] = metadata
	}

	body, status, err := c.doRequest("POST", c.tenantPath("/memories"), reqBody)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp any
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return resp, nil
}

func (c *Client) SearchMemories(query, tags, source, state, memoryType, agentIDFilter, sessionID string, limit, offset int) (*ListResponse, error) {
	params := url.Values{}
	if query != "" {
		params.Set("q", query)
	}
	if tags != "" {
		params.Set("tags", tags)
	}
	if source != "" {
		params.Set("source", source)
	}
	if state != "" {
		params.Set("state", state)
	}
	if memoryType != "" {
		params.Set("memory_type", memoryType)
	}
	if agentIDFilter != "" {
		params.Set("agent_id", agentIDFilter)
	}
	if sessionID != "" {
		params.Set("session_id", sessionID)
	}
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		params.Set("offset", strconv.Itoa(offset))
	}

	path := c.tenantPath("/memories")
	if qs := params.Encode(); qs != "" {
		path += "?" + qs
	}

	body, status, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp ListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) GetMemory(id string) (*Memory, error) {
	body, status, err := c.doRequest("GET", c.tenantPath("/memories/"+id), nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var mem Memory
	if err := json.Unmarshal(body, &mem); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &mem, nil
}

func (c *Client) UpdateMemory(id, content string, tags []string, metadata map[string]interface{}) (*Memory, error) {
	reqBody := map[string]interface{}{}
	if content != "" {
		reqBody["content"] = content
	}
	if len(tags) > 0 {
		reqBody["tags"] = tags
	}
	if len(metadata) > 0 {
		reqBody["metadata"] = metadata
	}

	body, status, err := c.doRequest("PUT", c.tenantPath("/memories/"+id), reqBody)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var mem Memory
	if err := json.Unmarshal(body, &mem); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &mem, nil
}

func (c *Client) DeleteMemory(id string) error {
	body, status, err := c.doRequest("DELETE", c.tenantPath("/memories/"+id), nil)
	if err != nil {
		return err
	}
	if status >= 400 {
		return parseError(body, status)
	}
	return nil
}

func (c *Client) BulkCreate(memories []map[string]interface{}) (*BulkResponse, error) {
	reqBody := map[string]interface{}{
		"memories": memories,
	}
	body, status, err := c.doRequest("POST", c.tenantPath("/memories/bulk"), reqBody)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp BulkResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) Ingest(messages []map[string]string, sessionID, agentIDOverride, mode string) (*IngestResponse, error) {
	agent := agentIDOverride
	if agent == "" {
		agent = c.agentID
	}
	reqBody := map[string]interface{}{
		"messages":   messages,
		"session_id": sessionID,
		"agent_id":   agent,
	}
	if mode != "" {
		reqBody["mode"] = mode
	}
	body, status, err := c.doRequest("POST", c.tenantPath("/memories"), reqBody)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp IngestResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) Bootstrap(limit int) (*BootstrapResponse, error) {
	path := c.tenantPath("/memories")
	if limit > 0 {
		path += "?limit=" + strconv.Itoa(limit)
	}
	body, status, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var listResp ListResponse
	if err := json.Unmarshal(body, &listResp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &BootstrapResponse{Memories: listResp.Memories, Total: listResp.Total}, nil
}

func (c *Client) GetTenantInfo() (*TenantInfo, error) {
	return nil, fmt.Errorf("tenant info API has been removed")
}

// --- Tasks API ---

func (c *Client) CreateTask(filePath, agentIDOverride, sessionID, fileType string) (*TaskResponse, error) {
	agent := agentIDOverride
	if agent == "" {
		agent = c.agentID
	}
	if agent == "" {
		return nil, fmt.Errorf("agent_id is required")
	}

	fields := map[string]string{
		"agent_id":  agent,
		"file_type": fileType,
	}
	if sessionID != "" {
		fields["session_id"] = sessionID
	}

	body, status, err := c.doMultipart(c.tenantPath("/imports"), fields, filePath)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp TaskResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) ListTasks() (*TaskListResponse, error) {
	body, status, err := c.doRequest("GET", c.tenantPath("/imports"), nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp TaskListResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func (c *Client) GetTask(id string) (*TaskDetail, error) {
	body, status, err := c.doRequest("GET", c.tenantPath("/imports/"+id), nil)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, parseError(body, status)
	}
	var resp TaskDetail
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	return &resp, nil
}

func parseError(body []byte, status int) error {
	var errResp ErrorResponse
	if err := json.Unmarshal(body, &errResp); err == nil && errResp.Error != "" {
		return fmt.Errorf("HTTP %d: %s", status, errResp.Error)
	}
	return fmt.Errorf("HTTP %d: %s", status, string(body))
}

// --- Pretty Print ---

func printJSON(v interface{}) {
	data, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(data))
}

// --- CLI Commands ---

func main() {
	rootCmd := &cobra.Command{
		Use:   "mnemo",
		Short: "CLI for testing mnemo-server",
		Long:  "A command-line tool for testing mnemo-server REST API endpoints.",
	}

	// Global flags
	rootCmd.PersistentFlags().StringVarP(&apiURL, "api-url", "u", getEnvOrDefault("MNEMO_API_URL", "http://localhost:8080"), "mnemo-server API URL")
	rootCmd.PersistentFlags().StringVarP(&tenantID, "tenant-id", "t", os.Getenv("MNEMO_TENANT_ID"), "Tenant ID")
	rootCmd.PersistentFlags().StringVarP(&agentID, "agent-id", "a", getEnvOrDefault("MNEMO_AGENT_ID", "cli-agent"), "Agent ID")
	rootCmd.PersistentFlags().DurationVar(&timeout, "timeout", 30*time.Second, "Request timeout")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "Print HTTP request/response details")

	// Add subcommands
	rootCmd.AddCommand(provisionCmd())
	rootCmd.AddCommand(memoryCmd())
	rootCmd.AddCommand(taskCmd())
	rootCmd.AddCommand(tenantCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func getClient() *Client {
	return NewClient(apiURL, tenantID, agentID, timeout, verbose)
}

func requireTenantID() error {
	if tenantID == "" {
		return fmt.Errorf("tenant-id is required (use -t flag or MNEMO_TENANT_ID env)")
	}
	return nil
}

// --- Provision Command ---

func provisionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "provision",
		Short: "Provision a new tenant",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := getClient()
			resp, err := client.Provision()
			if err != nil {
				return err
			}
			printJSON(resp)
			fmt.Fprintf(os.Stderr, "\n✓ Tenant provisioned. Set MNEMO_TENANT_ID=%s\n", resp.ID)
			return nil
		},
	}
}

// --- Memory Commands ---

func memoryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "memory",
		Short: "Memory operations",
	}

	cmd.AddCommand(memoryCreateCmd())
	cmd.AddCommand(memorySearchCmd())
	cmd.AddCommand(memoryGetCmd())
	cmd.AddCommand(memoryUpdateCmd())
	cmd.AddCommand(memoryDeleteCmd())
	cmd.AddCommand(memoryBulkCmd())
	cmd.AddCommand(memoryIngestCmd())
	cmd.AddCommand(memoryBootstrapCmd())

	return cmd
}

func memoryCreateCmd() *cobra.Command {
	var tags []string
	var metadataStr string

	cmd := &cobra.Command{
		Use:   "create <content>",
		Short: "Create a new memory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			var metadata map[string]interface{}
			if metadataStr != "" {
				if err := json.Unmarshal([]byte(metadataStr), &metadata); err != nil {
					return fmt.Errorf("invalid metadata JSON: %w", err)
				}
			}

			client := getClient()
			mem, err := client.CreateMemory(args[0], tags, metadata)
			if err != nil {
				return err
			}
			printJSON(mem)
			return nil
		},
	}

	cmd.Flags().StringSliceVar(&tags, "tags", nil, "Tags (comma-separated)")
	cmd.Flags().StringVar(&metadataStr, "metadata", "", "Metadata as JSON string")

	return cmd
}

func memorySearchCmd() *cobra.Command {
	var query, tags, source, state, memoryType, agentFilter, sessionID string
	var limit, offset int

	cmd := &cobra.Command{
		Use:   "search",
		Short: "Search memories",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			resp, err := client.SearchMemories(query, tags, source, state, memoryType, agentFilter, sessionID, limit, offset)
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}

	cmd.Flags().StringVarP(&query, "query", "q", "", "Search query")
	cmd.Flags().StringVar(&tags, "tags", "", "Filter by tags (comma-separated)")
	cmd.Flags().StringVar(&source, "source", "", "Filter by source")
	cmd.Flags().StringVar(&state, "state", "", "Filter by state")
	cmd.Flags().StringVar(&memoryType, "type", "", "Filter by memory_type")
	cmd.Flags().StringVar(&agentFilter, "agent-filter", "", "Filter by agent_id")
	cmd.Flags().StringVar(&sessionID, "session-id", "", "Filter by session_id")
	cmd.Flags().IntVarP(&limit, "limit", "l", 50, "Limit results")
	cmd.Flags().IntVarP(&offset, "offset", "o", 0, "Offset for pagination")

	return cmd
}

func memoryGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <id>",
		Short: "Get a memory by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			mem, err := client.GetMemory(args[0])
			if err != nil {
				return err
			}
			printJSON(mem)
			return nil
		},
	}
}

func memoryUpdateCmd() *cobra.Command {
	var content string
	var tags []string
	var metadataStr string

	cmd := &cobra.Command{
		Use:   "update <id>",
		Short: "Update a memory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			var metadata map[string]interface{}
			if metadataStr != "" {
				if err := json.Unmarshal([]byte(metadataStr), &metadata); err != nil {
					return fmt.Errorf("invalid metadata JSON: %w", err)
				}
			}

			client := getClient()
			mem, err := client.UpdateMemory(args[0], content, tags, metadata)
			if err != nil {
				return err
			}
			printJSON(mem)
			return nil
		},
	}

	cmd.Flags().StringVarP(&content, "content", "c", "", "New content")
	cmd.Flags().StringSliceVar(&tags, "tags", nil, "New tags (comma-separated)")
	cmd.Flags().StringVar(&metadataStr, "metadata", "", "New metadata as JSON string")

	return cmd
}

func memoryDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a memory",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			if err := client.DeleteMemory(args[0]); err != nil {
				return err
			}
			fmt.Println("✓ Memory deleted")
			return nil
		},
	}
}

func memoryBulkCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "bulk <json-file>",
		Short: "Bulk create memories from JSON file",
		Long: `Bulk create memories from a JSON file.

The file should contain an array of memory objects:
[
  {"content": "First memory", "tags": ["tag1"]},
  {"content": "Second memory", "tags": ["tag2"]}
]`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			data, err := os.ReadFile(args[0])
			if err != nil {
				return fmt.Errorf("read file: %w", err)
			}

			var memories []map[string]interface{}
			if err := json.Unmarshal(data, &memories); err != nil {
				return fmt.Errorf("parse JSON: %w", err)
			}

			client := getClient()
			resp, err := client.BulkCreate(memories)
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}
}

func memoryIngestCmd() *cobra.Command {
	var sessionID, agentOverride, mode string

	cmd := &cobra.Command{
		Use:   "ingest <json-file>",
		Short: "Ingest messages into memory pipeline",
		Long: `Ingest conversation messages into the smart memory pipeline.

The file should contain an array of message objects:
[
  {"role": "user", "content": "What is React?"},
  {"role": "assistant", "content": "React is a JavaScript library..."}
]`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			data, err := os.ReadFile(args[0])
			if err != nil {
				return fmt.Errorf("read file: %w", err)
			}

			var messages []map[string]string
			if err := json.Unmarshal(data, &messages); err != nil {
				return fmt.Errorf("parse JSON: %w", err)
			}

			if sessionID == "" {
				sessionID = fmt.Sprintf("cli-%d", time.Now().Unix())
			}

			client := getClient()
			resp, err := client.Ingest(messages, sessionID, agentOverride, mode)
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}

	cmd.Flags().StringVar(&sessionID, "session-id", "", "Session ID (auto-generated if empty)")
	cmd.Flags().StringVar(&agentOverride, "agent", "", "Override agent ID for this request")
	cmd.Flags().StringVar(&mode, "mode", "", "Ingest mode (smart or raw)")

	return cmd
}

func memoryBootstrapCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "bootstrap",
		Short: "Get bootstrap memories for agent startup",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			resp, err := client.Bootstrap(limit)
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}

	cmd.Flags().IntVarP(&limit, "limit", "l", 20, "Limit results")

	return cmd
}

// --- Task Commands ---

func taskCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "task",
		Short: "Task operations (file uploads)",
	}

	cmd.AddCommand(taskCreateCmd())
	cmd.AddCommand(taskListCmd())
	cmd.AddCommand(taskGetCmd())

	return cmd
}

func taskCreateCmd() *cobra.Command {
	var agentOverride, sessionID, fileType string

	cmd := &cobra.Command{
		Use:   "create <file-path>",
		Short: "Upload a file for async processing",
		Long: `Upload a file (memory.json or session file) for async ingest processing.

Examples:
  mnemo task create ./memory.json --file-type memory
  mnemo task create ./sessions/session-001.json --file-type session --session-id session-001`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			if fileType != "session" && fileType != "memory" {
				return fmt.Errorf("file-type must be 'session' or 'memory'")
			}

			client := getClient()
			resp, err := client.CreateTask(args[0], agentOverride, sessionID, fileType)
			if err != nil {
				return err
			}
			printJSON(resp)
			fmt.Fprintf(os.Stderr, "\n✓ Task created. Check status with: mnemo task get %s\n", resp.ID)
			return nil
		},
	}

	cmd.Flags().StringVar(&agentOverride, "agent", "", "Override agent ID for this task")
	cmd.Flags().StringVar(&sessionID, "session-id", "", "Session ID (for session files)")
	cmd.Flags().StringVar(&fileType, "file-type", "", "File type: 'session' or 'memory' (required)")
	cmd.MarkFlagRequired("file-type")

	return cmd
}

func taskListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all tasks for the tenant",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			resp, err := client.ListTasks()
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}
}

func taskGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <task-id>",
		Short: "Get task status by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			resp, err := client.GetTask(args[0])
			if err != nil {
				return err
			}
			printJSON(resp)
			return nil
		},
	}
}

// --- Tenant Commands ---

func tenantCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tenant",
		Short: "Tenant operations",
	}

	cmd.AddCommand(tenantInfoCmd())

	return cmd
}

func tenantInfoCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "info",
		Short: "Get tenant information",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := requireTenantID(); err != nil {
				return err
			}

			client := getClient()
			info, err := client.GetTenantInfo()
			if err != nil {
				return err
			}
			printJSON(info)
			return nil
		},
	}
}
