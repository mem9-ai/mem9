# mem9 Hermes 插件 - 用户使用手册

## 📖 快速开始

**mem9** 是 Hermes Agent 的持久化云记忆插件，让你的 AI 助手记住重要信息，跨会话保持一致性。

### ✨ 核心特性

- **零配置** - 首次使用自动获取 API key，无需手动设置
- **持久化** - 记忆存储在云端，跨设备、跨会话访问
- **智能搜索** - 向量 + 关键词混合搜索，找到相关记忆
- **完整 CRUD** - 存储、搜索、获取、更新、删除记忆
- **标签管理** - 用标签分类记忆，快速过滤
- **🎉 自动记忆** - MemoryProvider 集成，自动召回和存储

---

## 🚀 首次使用指南

### 方式 1: MemoryProvider 自动模式（推荐）

**完全自动化的记忆体验！**

```bash
# 1. 激活 mem9 MemoryProvider
hermes config set memory.provider mem9

# 2. 启动 Hermes
hermes chat

# 完成！记忆功能完全自动化
```

**自动功能**:
- ✅ 会话开始自动召回相关记忆
- ✅ 每轮对话自动 prefetch 上下文
- ✅ 对话自动跟踪用于存储
- ✅ 会话结束自动提取并存储记忆
- ✅ API key 自动配置

### 方式 2: 手动工具模式

**使用工具手动控制记忆**

```bash
# 启动 Hermes (无需配置 memory.provider)
hermes chat

# 使用工具调用
/memory_store content="项目使用 PostgreSQL 15" tags=["数据库", "配置"]
/memory_search q="数据库配置"
```

### 步骤 3: 自动配置 API key

首次使用时，系统会自动：

1. 调用 mem9 服务器配置新租户
2. 获取 API key
3. 保存到 `~/.hermes/mem9_api_key`
4. 显示确认信息：

```
✅ Auto-provisioned mem9 API key: fab8e3e9...d6d3
✅ Saved mem9 API key to /Users/hice/.hermes/mem9_api_key
```

### 步骤 4: 开始使用

现在可以正常使用所有记忆功能了！

---

## 📚 工具使用

### 1. 🧠 memory_store - 存储记忆

**用途**: 保存重要信息到云端记忆

**参数**:
- `content` (必需): 记忆内容，最长 50000 字符
- `tags` (可选): 标签列表，最多 20 个
- `source` (可选): 来源标识
- `metadata` (可选): 附加元数据

**示例**:

```
# 简单存储
记住这个项目的数据库是 PostgreSQL 15

# 带标签
/memory_store content="API 使用 rate limiting，限制 100 请求/分钟" tags=["API", "配置", "限流"]

# 带来源
/memory_store content="部署使用 Kubernetes on AWS EKS" tags=["部署", "基础设施"] source="运维文档"
```

**响应**:

```json
{
  "ok": true,
  "data": {
    "status": "accepted",
    "message": "记忆已提交到智能处理管道"
  }
}
```

### 2. 🔍 memory_search - 搜索记忆

**用途**: 使用混合搜索（向量 + 关键词）查找记忆

**参数**:
- `q` (必需): 搜索查询
- `tags` (可选): 逗号分隔的标签过滤（AND 逻辑）
- `source` (可选): 来源过滤
- `limit` (可选): 最大结果数，默认 20，最大 200
- `offset` (可选): 分页偏移
- `memory_type` (可选): 记忆类型过滤

**示例**:

```
# 基本搜索
搜索关于数据库的记忆

# 带标签过滤
/memory_search q="API 配置" tags="API,限流"

# 限制结果数
/memory_search q="部署" limit=5

# 分页
/memory_search q="项目" limit=10 offset=20
```

**响应**:

```json
{
  "ok": true,
  "memories": [
    {
      "content": "项目使用 PostgreSQL 15",
      "tags": ["数据库", "配置"],
      "score": 0.85,
      "created_at": "2026-04-15T10:30:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### 3. 📄 memory_get - 获取记忆

**用途**: 通过 ID 获取单条记忆

**参数**:
- `id` (必需): 记忆 UUID

**示例**:

```
/memory_get id="fab8e3e9-1234-5678-9abc-def012345678"
```

**响应**:

```json
{
  "ok": true,
  "data": {
    "id": "fab8e3e9-...",
    "content": "项目使用 PostgreSQL 15",
    "tags": ["数据库", "配置"],
    "created_at": "2026-04-15T10:30:00Z",
    "updated_at": "2026-04-15T10:30:00Z"
  }
}
```

### 4. ✏️ memory_update - 更新记忆

**用途**: 更新已有记忆的内容或标签

**参数**:
- `id` (必需): 记忆 UUID
- `content` (可选): 新内容
- `tags` (可选): 新标签列表
- `source` (可选): 新来源
- `metadata` (可选): 新元数据

**示例**:

```
# 更新内容
/memory_update id="fab8e3e9-..." content="项目使用 PostgreSQL 15 和 Redis"

# 更新标签
/memory_update id="fab8e3e9-..." tags=["数据库", "配置", "已更新"]

# 同时更新
/memory_update id="fab8e3e9-..." content="更新内容" tags=["新标签"]
```

### 5. 🗑️ memory_delete - 删除记忆

**用途**: 删除指定记忆

**参数**:
- `id` (必需): 记忆 UUID

**示例**:

```
/memory_delete id="fab8e3e9-..."
```

**响应**:

```json
{
  "ok": true
}
```

---

## 💡 使用技巧

### 1. 自然语言交互

可以直接用自然语言与 Hermes 交流：

```
# 存储
记住我们使用 Docker 部署

# 搜索
我之前说过关于数据库的事情是什么？

# 更新
把刚才那条记忆改成使用 Kubernetes 部署

# 删除
删除那条过时的部署记忆
```

### 2. 标签最佳实践

```
# 使用一致的标签命名
tags=["项目", "配置", "数据库"]  # ✓ 好
tags=["project", "项目", "proj"]  # ✗ 避免混用

# 使用层级标签
tags=["基础设施/数据库", "基础设施/缓存"]

# 限制标签数量（最多 20 个）
tags=["重要", "核心配置"]  # ✓ 精简
```

### 3. 搜索技巧

```
# 使用关键词搜索
/memory_search q="PostgreSQL 数据库配置"

# 组合标签过滤
/memory_search q="API" tags="配置，限流"

# 搜索所有记忆
/memory_search q="" limit=50

# 查找特定来源的记忆
/memory_search q="" source="运维文档"
```

### 4. 批量操作

```
# 存储多条相关记忆
记住以下几点：
1. 数据库：PostgreSQL 15
2. 缓存：Redis 7
3. 消息队列：RabbitMQ

# 搜索后批量处理
搜索所有"配置"标签的记忆，然后...
```

---

## 🔧 高级配置

### 手动配置 API key

如需使用特定的 API key：

```bash
# 方法 1: 环境变量
export MEM9_API_KEY="your-tenant-uuid"
export MEM9_API_URL="https://api.mem9.ai"  # 可选

# 方法 2: 添加到 ~/.hermes/.env
MEM9_API_KEY=your-tenant-uuid
MEM9_API_URL=https://api.mem9.ai
```

### 重新配置 API key

```bash
# 删除已保存的 key
rm ~/.hermes/mem9_api_key

# 下次使用时自动配置新的
```

### 查看当前配置

```bash
# 查看保存的 API key
cat ~/.hermes/mem9_api_key

# 查看工具状态
hermes tools list | grep mem9
```

---

## 📊 观测和总结记忆

### 1. 查看记忆列表

```bash
# 使用搜索工具查看所有记忆
venv/bin/python << 'EOF'
import tools.mem9_tools as mem9_tools
from model_tools import _run_async

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=100))

if result.get("ok"):
    memories = result.get("memories", [])
    print(f"当前记忆总数：{len(memories)}")
    
    for i, mem in enumerate(memories, 1):
        content = mem.get('content', 'N/A')[:50]
        tags = mem.get('tags', [])
        print(f"{i}. [{', '.join(tags)}] {content}...")
EOF
```

### 2. 记忆统计

```bash
venv/bin/python << 'EOF'
import tools.mem9_tools as mem9_tools
from model_tools import _run_async
from collections import Counter

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=500))

if result.get("ok"):
    memories = result.get("memories", [])
    
    # 统计标签
    all_tags = []
    for mem in memories:
        tags = mem.get('tags', [])
        all_tags.extend(tags)
    
    tag_counts = Counter(all_tags)
    
    print(f"记忆总数：{len(memories)}")
    print(f"\n热门标签:")
    for tag, count in tag_counts.most_common(10):
        print(f"  {tag}: {count}")
EOF
```

### 3. 记忆质量分析

```bash
venv/bin/python << 'EOF'
import tools.mem9_tools as mem9_tools
from model_tools import _run_async

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=500))

if result.get("ok"):
    memories = result.get("memories", [])
    
    # 分析记忆长度
    lengths = [len(m.get('content', '')) for m in memories]
    avg_length = sum(lengths) / len(lengths) if lengths else 0
    
    # 分析标签数量
    tag_counts = [len(m.get('tags', [])) for m in memories]
    avg_tags = sum(tag_counts) / len(tag_counts) if tag_counts else 0
    
    print(f"记忆分析:")
    print(f"  总数：{len(memories)}")
    print(f"  平均长度：{avg_length:.0f} 字符")
    print(f"  平均标签数：{avg_tags:.1f} 个")
    print(f"  最长记忆：{max(lengths)} 字符")
    print(f"  最短记忆：{min(lengths)} 字符")
EOF
```

### 4. 定期总结记忆

```bash
# 创建记忆总结脚本
cat > ~/scripts/mem9_summary.py << 'SCRIPT'
#!/usr/bin/env python3
import sys
sys.path.insert(0, '/Users/hice/.hermes/hermes-agent')

import os
os.environ.pop('MEM9_API_KEY', None)

import tools.mem9_tools as mem9_tools
from model_tools import _run_async

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=500))

if result.get("ok"):
    memories = result.get("memories", [])
    
    print("=" * 60)
    print("mem9 记忆总结报告")
    print("=" * 60)
    print(f"\n统计时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"记忆总数：{len(memories)}")
    
    # 按标签分组
    from collections import defaultdict
    by_tags = defaultdict(list)
    for mem in memories:
        tags = mem.get('tags', [])
        for tag in tags:
            by_tags[tag].append(mem)
    
    print(f"\n按标签分组:")
    for tag, mems in sorted(by_tags.items(), key=lambda x: -len(x[1])):
        print(f"  {tag}: {len(mems)} 条")
    
    # 最近添加的记忆
    print(f"\n最近添加的记忆:")
    for mem in memories[:5]:
        content = mem.get('content', 'N/A')[:40]
        print(f"  - {content}...")

if __name__ == "__main__":
    from datetime import datetime
    # 运行总结
SCRIPT

chmod +x ~/scripts/mem9_summary.py
```

### 5. 导出记忆

```bash
venv/bin/python << 'EOF'
import tools.mem9_tools as mem9_tools
from model_tools import _run_async
import json
from datetime import datetime

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=500))

if result.get("ok"):
    memories = result.get("memories", [])
    
    # 导出为 JSON
    export_data = {
        "exported_at": datetime.now().isoformat(),
        "total_count": len(memories),
        "memories": memories
    }
    
    with open(f"~/mem9_export_{datetime.now().strftime('%Y%m%d')}.json", 'w') as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False)
    
    print(f"✅ 已导出 {len(memories)} 条记忆到 JSON 文件")
    
    # 导出为 Markdown
    md_content = "# mem9 记忆导出\n\n"
    md_content += f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    md_content += f"记忆总数：{len(memories)}\n\n"
    md_content += "---\n\n"
    
    for i, mem in enumerate(memories, 1):
        content = mem.get('content', 'N/A')
        tags = mem.get('tags', [])
        created = mem.get('created_at', 'N/A')
        
        md_content += f"## {i}. {content[:50]}...\n\n"
        md_content += f"**标签**: {', '.join(tags)}\n\n"
        md_content += f"**创建**: {created}\n\n"
        md_content += f"**完整内容**:\n\n{content}\n\n"
        md_content += "---\n\n"
    
    with open(f"~/mem9_export_{datetime.now().strftime('%Y%m%d')}.md", 'w') as f:
        f.write(md_content)
    
    print(f"✅ 已导出 Markdown 文件")
EOF
```

---

## ❓ 故障排除

### 工具不可用

**症状**: `hermes tools list` 中看不到 mem9 工具

**解决**:
```bash
# 检查 mem9_hermes 是否安装
venv/bin/python -c "import mem9_hermes; print('OK')"

# 检查工具注册
venv/bin/python -c "
from tools.registry import registry
print('memory_store' in registry._tools)
"

# 重启 Hermes
/hermes restart
```

### API key 无效

**症状**: 工具调用返回 "Invalid API key"

**解决**:
```bash
# 删除已保存的 key
rm ~/.hermes/mem9_api_key

# 重新使用工具，会自动配置
```

### 记忆搜索不到

**症状**: 存储了记忆但搜索不到

**解决**:
```bash
# 检查记忆是否已提交
venv/bin/python << 'EOF'
import tools.mem9_tools as mem9_tools
from model_tools import _run_async

backend = mem9_tools._get_backend()
result = _run_async(backend.search(q="", limit=100))
print(f"记忆总数：{result.get('total', 0)}")
EOF

# 智能管道可能需要时间处理
# 等待几分钟后重试
```

### 自动配置失败

**症状**: "mem9 auto-provision failed"

**解决**:
```bash
# 检查网络连接
curl -I https://api.mem9.ai

# 检查 MEM9_API_URL 是否正确
echo $MEM9_API_URL

# 手动配置 API key
export MEM9_API_KEY="your-uuid"
```

---

## 📞 获取帮助

- **文档**: `/Users/hice/pingcap/hohice/mem9/hermes-plugin/README.md`
- **开发文档**: `/Users/hice/pingcap/hohice/mem9/hermes-plugin/DEVELOPMENT_SUMMARY.md`
- **集成文档**: `/Users/hice/pingcap/hohice/mem9/hermes-plugin/INTEGRATION.md`
- **mem9 官网**: https://mem9.ai
- **Hermes 文档**: https://hermes-agent.nousresearch.com/docs/

---

**文档版本**: 1.0
**最后更新**: 2026 年 4 月 15 日
