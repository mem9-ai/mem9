# mem9 Hermes 集成 - 自动配置 API Key

## 概述

mem9 插件现在支持**首次使用自动配置 API Key**。用户无需手动获取和配置 API key，插件会在首次使用时自动从 mem9 服务器获取并保存。

## 自动配置流程

```
┌─────────────────────────────────────────────────────────┐
│  用户首次使用 mem9 工具                                    │
│  (例如：memory_store, memory_search)                      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  检查 MEM9_API_KEY 环境变量                               │
│  检查 ~/.hermes/mem9_api_key 文件                        │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
    ┌─────────┐           ┌─────────┐
    │ 有 API  │           │ 无 API  │
    │  key    │           │  key    │
    └────┬────┘           └────┬────┘
         │                     │
         │                     ▼
         │           ┌─────────────────────┐
         │           │ POST /v1alpha1/mem9s│
         │           │ 自动配置新租户       │
         │           └──────────┬──────────┘
         │                      │
         │                      ▼
         │           ┌─────────────────────┐
         │           │ 保存 API key 到      │
         │           │ ~/.hermes/mem9_api_key│
         │           └──────────┬──────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│  使用 API key 调用 mem9 API                                │
│  (v1alpha2 端点)                                          │
└─────────────────────────────────────────────────────────┘
```

## 文件修改

### 1. `tools/mem9_tools.py` (新建)

主要功能：
- 注册 5 个 mem9 工具到 Hermes registry
- 自动加载/保存 API key
- 首次使用时自动配置新租户

关键函数：
- `_load_api_key()`: 从环境变量或文件加载 API key
- `_save_api_key()`: 保存 API key 到 `~/.hermes/mem9_api_key`
- `_get_backend()`: 创建后端，自动配置 API key
- `_check_mem9_available()`: 检查工具可用性

### 2. `toolsets.py` (修改)

添加了：
- `mem9` 工具集定义
- 5 个 mem9 工具到 `_HERMES_CORE_TOOLS`

### 3. `model_tools.py` (修改)

添加了：
- `tools.mem9_tools` 到工具发现列表

## 使用方法

### 方法 1: 自动配置 (推荐)

无需任何配置，直接使用：

```bash
# 启动 Hermes
hermes chat

# 直接使用 mem9 工具
Store this memory: "The project uses PostgreSQL 15"
Tags: database, infrastructure
```

首次使用时会自动：
1. 调用 `POST /v1alpha1/mem9s` 配置新租户
2. 保存返回的 API key 到 `~/.hermes/mem9_api_key`
3. 使用该 API key 进行后续操作

### 方法 2: 手动配置

如需使用特定的 API key：

```bash
# 设置环境变量
export MEM9_API_KEY="your-tenant-uuid"
export MEM9_API_URL="https://api.mem9.ai"  # 可选

# 或在 ~/.hermes/.env 中添加
MEM9_API_KEY=your-tenant-uuid
```

### 重新配置

如需重新配置 API key：

```bash
# 删除已保存的 API key
rm ~/.hermes/mem9_api_key

# 下次使用时会自动配置新的
```

## API Key 存储

- **位置**: `~/.hermes/mem9_api_key`
- **格式**: UUID 字符串 (36 字符)
- **权限**: 644 (可考虑改为 600 更安全)
- **优先级**: 环境变量 > 文件 > 自动配置

## 工具列表

| 工具 | Emoji | 功能 | 必需参数 |
|------|-------|------|----------|
| `memory_store` | 🧠 | 存储记忆 | content |
| `memory_search` | 🔍 | 搜索记忆 | q |
| `memory_get` | 📄 | 获取记忆 | id |
| `memory_update` | ✏️ | 更新记忆 | id |
| `memory_delete` | 🗑️ | 删除记忆 | id |

## 日志输出

首次使用时会看到：

```
INFO:mem9_tools:No mem9 API key found, auto-provisioning new tenant...
INFO:mem9_tools:✅ Auto-provisioned mem9 API key: fab8e3e9...d6d3
INFO:mem9_tools:Saved mem9 API key to /Users/hice/.hermes/mem9_api_key
```

后续使用：

```
INFO:mem9_tools:Loaded mem9 API key from /Users/hice/.hermes/mem9_api_key
```

## 错误处理

### 自动配置失败

如果自动配置失败，会显示：

```
ERROR:mem9_tools:Failed to auto-provision mem9 API key: <error message>
RuntimeError: mem9 auto-provision failed: <error message>
```

可能原因：
- mem9 服务器不可达
- 网络连接问题
- 服务器返回错误

解决方法：
1. 检查网络连接
2. 确认 `MEM9_API_URL` 正确
3. 联系 mem9 支持

### API key 无效

如果 API key 无效，工具调用会返回错误：

```json
{
  "ok": false,
  "error": "Invalid API key"
}
```

解决方法：
```bash
rm ~/.hermes/mem9_api_key
# 重新使用工具会自动配置
```

## 安全考虑

- API key 以明文存储在本地文件中
- 建议设置文件权限为 600：`chmod 600 ~/.hermes/mem9_api_key`
- 不要分享或提交 API key 到版本控制
- 如需撤销，删除文件并重新配置

## 测试

运行测试脚本验证集成：

```bash
cd ~/.hermes/hermes-agent
venv/bin/python -c "
import tools.mem9_tools as mem9_tools
print('API key:', mem9_tools._load_api_key()[:8] + '...')
print('Available:', mem9_tools._check_mem9_available())
"
```

## 故障排除

### 工具不可用

```bash
# 检查 mem9_hermes 是否安装
venv/bin/python -c "import mem9_hermes; print(mem9_hermes.__version__)"

# 检查工具注册
venv/bin/python -c "
from tools.registry import registry
entry = registry.get_entry('memory_store')
print('Registered:', entry is not None)
"
```

### API key 未保存

检查文件权限：
```bash
ls -la ~/.hermes/mem9_api_key
chmod 644 ~/.hermes/mem9_api_key  # 确保可写
```

### 工具调用失败

启用详细日志：
```bash
export HERMES_DEBUG=1
hermes chat
```

## 版本信息

- mem9-hermes: 0.1.0
- Hermes Agent: v0.9.0+
- Python: 3.11+
- mem9 API: v1alpha2

## 相关链接

- [mem9 主仓库](https://github.com/mem9-ai/mem9)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [mem9 文档](https://mem9.ai)
