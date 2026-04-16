# 🚀 其他用户如何安装使用 mem9

## 最简单的方式（3 步）

### Step 1: 安装包

```bash
pip install mem9-hermes
```

或从本地文件安装：

```bash
pip install /path/to/mem9_hermes-0.2.0-py3-none-any.whl
```

### Step 2: 运行安装程序

```bash
mem9-install
```

安装程序会自动：
- ✅ 找到你的 Hermes Agent 目录
- ✅ 复制所有必要文件
- ✅ 修改配置文件
- ✅ 启用 mem9 功能

### Step 3: 开始使用

```bash
hermes
```

然后就可以直接使用记忆功能了！

---

## 📦 获取安装包的方式

### 方式 1: 从 PyPI（发布后）

```bash
pip install mem9-hermes
```

### 方式 2: 从 whl 文件

下载 `mem9_hermes-0.2.0-py3-none-any.whl` 文件后：

```bash
pip install mem9_hermes-0.2.0-py3-none-any.whl
```

### 方式 3: 从源码

```bash
git clone https://github.com/mem9-ai/mem9.git
cd mem9/hermes-plugin
pip install -e .
python install_mem9.py
```

### 方式 4: 直接从朋友那里复制

如果朋友已经安装了，可以直接复制：

```bash
# 从朋友的电脑复制
scp -r friend@host:~/.hermes/hermes-agent/plugins/memory/mem9/ ./
scp friend@host:~/.hermes/hermes-agent/tools/mem9_tools.py ./
scp friend@host:~/.hermes/hermes-agent/agent/providers/mem9_provider.py ./

# 然后运行安装脚本
python install_mem9.py
```

---

## 💬 使用示例

### 自动功能

启用后，mem9 会自动工作，无需手动操作：

```
# 第一次会话
用户：帮我记住，我在开发一个电商项目，使用 Python 和 PostgreSQL

# 第二次会话（自动召回记忆）
用户：我的项目用什么数据库？
AI: 你的项目使用 PostgreSQL 数据库。
```

### 手动工具

```
# 存储记忆
帮我记住：我喜欢用 VS Code 写代码

# 搜索记忆
搜索记忆中关于编程的内容

# 更新记忆
更新刚才的记忆：我喜欢用 Cursor 写代码

# 删除记忆
删除那条关于 VS Code 的记忆
```

---

## 🔧 常见问题

### Q: 安装时提示找不到 Hermes Agent

A: 使用 `--hermes-dir` 指定目录：

```bash
mem9-install --hermes-dir /path/to/your/hermes-agent
```

### Q: 安装后工具不可用

A: 手动启用：

```bash
hermes tools enable mem9
hermes config set memory.provider mem9
```

### Q: API Key 错误

A: 首次使用会自动申请，或手动配置：

```bash
echo "your-api-key" > ~/.hermes/mem9_api_key
```

### Q: 想卸载

A: 删除相关文件：

```bash
rm -rf ~/.hermes/hermes-agent/plugins/memory/mem9/
rm ~/.hermes/hermes-agent/tools/mem9_tools.py
rm ~/.hermes/hermes-agent/agent/providers/mem9_provider.py
pip uninstall mem9-hermes
```

---

## 📖 更多文档

- `INSTALL.md` - 详细安装指南
- `README.md` - 项目说明
- `DISTRIBUTION_SUMMARY.md` - 分发方案总结

---

## 📞 获取帮助

1. 查看文档
2. 提交 Issue: https://github.com/mem9-ai/mem9/issues
3. 邮件联系：support@mem9.ai
