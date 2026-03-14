# Proposal: Time-Aware Memory Recall

**Date:** 2026-03-14  
**Author:** Cleo 🐾  
**Status:** Draft  
**Based on:** 申君's suggestion

---

## Problem Statement

当前 `before_prompt_build` 的 recall 逻辑只按**向量相似度**排序：

```ts
const result = await backend.search({ q: prompt, limit: MAX_INJECT });
```

这有几个问题：

1. **时序盲** — 两条内容相似的记忆（"住在北京" vs "住在上海"），模型无法判断哪个更新
2. **绝对时间戳无语义** — 返回 `created_at: "2024-03-01T00:00:00Z"` 对模型几乎没有意义
3. **旧记忆权重 = 新记忆权重** — 没有任何机制让模型偏向更近的信息

---

## Proposed Changes

### 核心思路

**不改 API 接口**，把 hybrid sort 作为默认行为内置到 server：

1. 向量搜索 top-(N×2)，保证相关性基数
2. 按 `updated_at` 倒序重排，让新记忆优先
3. 截断到 `limit`
4. 每条记忆附带 `relative_age`（server 侧计算，如 `"3 days ago"`）

模型拿到这样的 context：

```
[Knowledge]
1. (3 days ago) 我住在上海
2. (1 year ago) 我住在北京
```

自然会判断上海是最新的，北京是旧信息。冲突解决完全交给大模型。

---

## Changes

### Plugin 侧

**`types.ts`** — 增加 `relative_age` 字段（~4 LOC）

```ts
export interface Memory {
  // ... existing fields ...
  relative_age?: string;  // e.g. "3 days ago", computed server-side at query time
}
```

**`hooks.ts`** — `formatMemoriesBlock` 加入时间展示（~15 LOC）

```ts
function formatMemoriesBlock(memories: Memory[]): string {
  const lines = memories.map((m, i) => {
    const age = m.relative_age ? `(${m.relative_age}) ` : "";
    return `${i + 1}. ${age}${m.content}`;
  });
  return `<relevant-memories>\n[Knowledge]\n${lines.join("\n")}\n</relevant-memories>`;
}
```

### Server 侧（Go，~80 LOC）

**搜索逻辑改造：**

```
1. 向量搜索 top-(limit * 2)
2. 按 updated_at 倒序排序
3. 截断到 limit
4. 每条记忆计算 relative_age
5. 返回
```

**`relative_age` 格式化：**

```go
func relativeAge(t time.Time) string {
    d := time.Since(t)
    switch {
    case d < time.Hour:
        return fmt.Sprintf("%d minutes ago", int(d.Minutes()))
    case d < 24*time.Hour:
        return fmt.Sprintf("%d hours ago", int(d.Hours()))
    case d < 7*24*time.Hour:
        return fmt.Sprintf("%d days ago", int(d.Hours()/24))
    case d < 30*24*time.Hour:
        return fmt.Sprintf("%d weeks ago", int(d.Hours()/(24*7)))
    case d < 365*24*time.Hour:
        return fmt.Sprintf("%d months ago", int(d.Hours()/(24*30)))
    default:
        return fmt.Sprintf("%d years ago", int(d.Hours()/(24*365)))
    }
}
```

---

## LOC Summary

| 改动位置 | 文件 | Est. LOC |
|---|---|---|
| `Memory.relative_age` 字段 | `types.ts` | ~4 |
| `formatMemoriesBlock` 时间展示 | `hooks.ts` | ~15 |
| hybrid sort + `relative_age` 计算 | server (Go) | ~80 |
| **Total** | | **~99 LOC** |

> 不含测试，加单测约 +60 LOC。

---

## Design Decisions

- **不加 `sort` 参数** — hybrid 是默认且唯一行为，不需要开关
- **`relative_age` server 侧计算** — 保证时钟一致性，未来支持多语言格式化
- **召回 2x 再截断** — 保留足够的相关性基数，避免纯时间排序丢失高相关旧记忆

---

## Why This Works

大模型对 `"3 days ago"` vs `"1 year ago"` 的理解远比 ISO 时间戳直观。  
系统层不需要做显式的冲突解决逻辑，把时序信息透明传递，让模型用自然语言理解能力判断。  
改动量小（<100 LOC），但对频繁更新的用户信息（住址、偏好、状态）召回质量提升显著。

