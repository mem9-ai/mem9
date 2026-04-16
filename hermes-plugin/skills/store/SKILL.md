---
name: mem9-store
description: |
  Store a memory using mem9. Use this to save important facts,
  insights, or context for future sessions.
version: 0.1.0
---

# mem9 Store Memory

**Store information to persistent cloud memory.**

## Usage

Use this skill when you want to save important information that should persist across sessions.

### Basic Store

```
Store this memory: "The project uses TiDB with vector search"
```

### With Tags

```
Store this memory: "API rate limit is 100 requests per minute"
Tags: api, rate-limit, infrastructure
```

### With Source

```
Store this memory: "Deployment uses Kubernetes on AWS EKS"
Tags: deployment, infrastructure
Source: hermes
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| content | **Yes** | Memory content (max 50000 chars) |
| tags | No | Comma-separated tags for categorization (max 20) |
| source | No | Which agent/system wrote this |
| metadata | No | Arbitrary structured data (JSON object) |

## Examples

### Store Project Context

```
Store this memory: "Project name: mem9-hermes-plugin. Purpose: Enable persistent memory for Hermes Agent using mem9 REST API."
Tags: project, context, mem9
```

### Store API Information

```
Store this memory: "mem9 API endpoint: https://api.mem9.ai. Uses v1alpha2 endpoints with X-API-Key authentication."
Tags: api, mem9, documentation
```

### Store Configuration

```
Store this memory: "Database: TiDB. Connection: mysql://user:***@host:4000/mem9"
Tags: database, configuration, postgres
```

## Response Format

Success:
```json
{
  "ok": true,
  "data": {
    "id": "uuid-here",
    "content": "...",
    "tags": ["..."],
    "created_at": "2026-04-15T..."
  }
}
```

Error:
```json
{
  "ok": false,
  "error": "Error message"
}
```

## Tips

- Use descriptive tags for easier retrieval
- Keep memories focused on single topics
- Include context that future sessions might need
- Store decisions and rationale, not just facts

## Related

- `mem9-search` - Search stored memories
- `mem9-recall` - Recall relevant memories
- `mem9-setup` - Initial setup
