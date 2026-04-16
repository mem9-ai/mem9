---
name: mem9-recall
description: |
  Search and recall memories from mem9. Use this to retrieve
  stored information from previous sessions.
version: 0.1.0
---

# mem9 Recall Memory

**Search and retrieve stored memories from cloud storage.**

## Usage

Use this skill when you need to find previously stored information.

### Basic Search

```
Search for memories about "database configuration"
```

### With Tag Filter

```
Search for memories about "api" with tags "documentation"
```

### With Limit

```
Search for memories about "project" limit 5
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| q | **Yes** | Search query (uses hybrid vector + keyword) |
| tags | No | Comma-separated tags to filter by (AND logic) |
| source | No | Filter by source agent |
| limit | No | Max results (default 20, max 200) |
| offset | No | Pagination offset |
| memory_type | No | Filter by memory type (e.g., insight, pinned) |

## Examples

### Find Project Context

```
Search for memories about "project architecture"
```

### Find Specific Configuration

```
Search for memories about "rate limit" tags "api,configuration"
```

### Get Recent Memories

```
Search for memories about "" limit 10
```

### Search by Source

```
Search for memories about "deployment" source "hermes"
```

## Response Format

Success:
```json
{
  "ok": true,
  "memories": [
    {
      "id": "uuid",
      "content": "...",
      "tags": ["..."],
      "score": 0.85,
      "created_at": "..."
    }
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

Error:
```json
{
  "ok": false,
  "error": "Error message"
}
```

## Search Tips

- Use natural language queries - vector search understands semantics
- Combine with tags for precise filtering
- Empty query `""` returns most recent memories
- Higher score = more relevant (typically >0.5 is good)

## Advanced Usage

### Get Specific Memory by ID

```
Get memory with ID "uuid-here"
```

### Update a Memory

```
Update memory "uuid-here" with content "New content here"
```

### Delete a Memory

```
Delete memory "uuid-here"
```

## Auto-Recall

mem9 can automatically recall relevant memories at session start. Configure in hooks:

```python
from mem9_hermes import hermes_session_start

context = await hermes_session_start(session_id)
# Returns formatted memories for injection into system prompt
```

## Related

- `mem9-store` - Store new memories
- `mem9-setup` - Initial setup
- `memory_search` - Direct tool access
