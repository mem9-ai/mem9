# mem9-hermes 安装指南

## 🚀 快速安装（3 步）

### 方式一：pip 安装（推荐）

```bash
# 1. 安装包
pip install mem9-hermes

# 2. 运行安装程序
mem9-install

# 3. 配置
hermes config set memory.provider mem9
hermes tools enable mem9
```

### 方式二：本地安装

```bash
# 1. 下载/克隆仓库
cd hermes-plugin

# 2. 本地安装
pip install -e .

# 3. 运行安装脚本
python install_mem9.py
```

### 方式三：离线安装

```bash
# 1. 下载 whl 文件
pip download mem9-hermes

# 2. 离线安装
pip install mem9_hermes-0.2.0-py3-none-any.whl

# 3. 运行安装
mem9-install
```

## 📦 包内容

```
mem9-hermes/
├── mem9_hermes/          # 后端包
│   ├── __init__.py       # 包入口
│   ├── hooks.py          # Session hooks
│   ├── tools.py          # 工具定义
│   ├── server_backend.py # API 客户端
│   ├── types.py          # 类型定义
│   ├── install.py        # pip 入口点
│   └── install_script.py # 安装脚本
├── plugins/memory/mem9/  # Hermes 插件
│   ├── __init__.py       # Provider 实现
│   └── plugin.yaml       # 插件元数据
├── agent/providers/      # Provider 模块
│   └── mem9_provider.py  # MemoryProvider 实现
├── tools/                # 工具模块
│   └── mem9_tools.py     # 工具定义
├── install_mem9.py       # 独立安装脚本
└── pyproject.toml        # 包配置
```

## ✅ 验证安装

```bash
# 检查包是否安装
pip show mem9-hermes

# 检查 Hermes 插件
cd ~/.hermes/hermes-agent
source venv/bin/activate
python3 -c "
from plugins.memory import discover_memory_providers
for name, desc, available in discover_memory_providers():
    if name == 'mem9':
        print(f'✅ mem9: {\"可用\" if available else \"不可用\"}')
"

# 检查工具
hermes tools list | grep mem9
```

## 🔧 故障排除

### 问题：mem9-install 命令不存在

```bash
# 重新安装
pip install --upgrade mem9-hermes

# 或手动运行
python -m mem9_hermes.install
```

### 问题：找不到 Hermes Agent

```bash
# 指定 Hermes 目录
mem9-install --hermes-dir /path/to/hermes-agent
```

### 问题：API Key 未找到

首次使用时会自动申请，或手动配置：

```bash
echo "your-api-key" > ~/.hermes/mem9_api_key
```

## 📖 使用

安装完成后，mem9 会自动：

1. **会话开始** - 召回相关记忆
2. **对话过程** - 跟踪并注入上下文
3. **会话结束** - 存储对话到云端

手动工具：

```
帮我记住：项目使用 PostgreSQL 15
搜索记忆中关于数据库的内容
```

## 📞 支持

- 文档：https://mem9.ai/docs
- GitHub: https://github.com/mem9-ai/mem9
- Email: support@mem9.ai
