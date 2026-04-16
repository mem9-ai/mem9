"""
mem9 Hermes Agent 安装入口点

Usage:
    pip install mem9-hermes
    mem9-install                      # 自动安装到 Hermes Agent
    mem9-install --dry-run            # 预览安装内容
    mem9-install --hermes-dir /path   # 指定 Hermes 目录
"""

import sys
from pathlib import Path

# 导入安装脚本
from mem9_hermes.install_script import main as install_main


def main():
    """pip 脚本入口点"""
    print("mem9-hermes 安装程序")
    print("=" * 50)
    
    # 检查 Hermes Agent 是否已安装
    hermes_dirs = [
        Path.home() / ".hermes" / "hermes-agent",
        Path.home() / "hermes-agent",
        Path.cwd(),
    ]
    
    hermes_dir = None
    for d in hermes_dirs:
        if d.exists() and (d / "run_agent.py").exists():
            hermes_dir = d
            break
    
    if not hermes_dir:
        print("\n❌ 未找到 Hermes Agent 安装目录")
        print("\n请先安装 Hermes Agent 或指定目录:")
        print("  mem9-install --hermes-dir /path/to/hermes-agent")
        sys.exit(1)
    
    print(f"\n✅ 找到 Hermes Agent: {hermes_dir}")
    
    # 运行安装
    sys.argv = [sys.argv[0]]  # 重置 argv
    install_main()


if __name__ == "__main__":
    main()
