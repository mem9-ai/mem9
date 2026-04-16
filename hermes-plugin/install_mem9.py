#!/usr/bin/env python3
"""
mem9 Hermes Agent 一键安装脚本

Usage:
    python install_mem9.py              # 自动检测 Hermes 目录
    python install_mem9.py --dry-run    # 预览安装内容
    python install_mem9.py --help       # 显示帮助
"""

import argparse
import os
import shutil
import sys
from pathlib import Path


def find_hermes_dir():
    """自动查找 Hermes Agent 安装目录"""
    candidates = [
        Path.home() / ".hermes" / "hermes-agent",
        Path.home() / "hermes-agent",
        Path.cwd() / "hermes-agent",
    ]
    
    for candidate in candidates:
        if candidate.exists() and (candidate / "run_agent.py").exists():
            return candidate.resolve()
    
    return None


def check_prerequisites():
    """检查安装前提条件"""
    print("🔍 检查安装环境...")
    
    # 检查 Python 版本
    if sys.version_info < (3, 10):
        print("❌ Python 3.10+  required")
        return False
    print(f"✅ Python {sys.version_info.major}.{sys.version_info.minor}")
    
    # 检查 Hermes 目录
    hermes_dir = find_hermes_dir()
    if not hermes_dir:
        print("❌ 未找到 Hermes Agent 目录")
        print("\n请手动指定 Hermes Agent 目录：")
        print("  python install_mem9.py --hermes-dir /path/to/hermes-agent")
        return False
    print(f"✅ Hermes Agent: {hermes_dir}")
    
    # 检查必要文件
    required_files = [
        hermes_dir / "model_tools.py",
        hermes_dir / "toolsets.py",
        hermes_dir / "plugins" / "memory",
    ]
    
    for f in required_files:
        if not f.exists():
            print(f"❌ 缺少必要文件/目录：{f}")
            return False
    
    print("✅ 所有必要文件存在")
    return True


def copy_file(src, dst, dry_run=False):
    """复制单个文件"""
    if dry_run:
        print(f"  📄 COPY {src} -> {dst}")
        return True
    
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        return True
    except Exception as e:
        print(f"  ❌ 复制失败：{e}")
        return False


def patch_file(filepath, old_text, new_text, dry_run=False):
    """修改文件内容"""
    if dry_run:
        print(f"  ✏️  PATCH {filepath}")
        print(f"     添加：{new_text.strip()[:60]}...")
        return True
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if old_text in content:
            content = content.replace(old_text, new_text)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        else:
            print(f"  ⚠️  未找到匹配文本，可能已修改过")
            # 检查是否已经包含
            if new_text in content:
                print(f"     内容已存在，跳过")
                return True
            return False
    except Exception as e:
        print(f"  ❌ 修改失败：{e}")
        return False


def install_plugin(hemes_dir, dry_run=False):
    """安装 mem9 插件"""
    print("\n📦 开始安装 mem9 插件...\n")
    
    # 获取脚本所在目录
    script_dir = Path(__file__).parent.resolve()
    
    success = True
    
    # 1. 复制 mem9 provider 插件
    print("1. 复制 mem9 provider 插件...")
    src = script_dir / "plugins" / "memory" / "mem9"
    dst = hermes_dir / "plugins" / "memory" / "mem9"
    if src.exists():
        if dry_run:
            print(f"  📁 COPY {src} -> {dst}")
        else:
            try:
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
                print(f"  ✅ 完成")
            except Exception as e:
                print(f"  ❌ 失败：{e}")
                success = False
    else:
        print(f"  ⚠️  源目录不存在：{src}")
    
    # 2. 复制 mem9 provider 实现
    print("2. 复制 mem9 provider 实现...")
    src = script_dir / "agent" / "providers" / "mem9_provider.py"
    dst = hermes_dir / "agent" / "providers" / "mem9_provider.py"
    if src.exists():
        copy_file(src, dst, dry_run)
        print(f"  ✅ 完成")
    else:
        print(f"  ⚠️  源文件不存在：{src}")
    
    # 3. 复制 mem9 工具定义
    print("3. 复制 mem9 工具定义...")
    src = script_dir / "tools" / "mem9_tools.py"
    dst = hermes_dir / "tools" / "mem9_tools.py"
    if src.exists():
        copy_file(src, dst, dry_run)
        print(f"  ✅ 完成")
    else:
        print(f"  ⚠️  源文件不存在：{src}")
    
    # 4. 修改 model_tools.py
    print("4. 注册 mem9_tools 模块...")
    model_tools_path = hermes_dir / "model_tools.py"
    if model_tools_path.exists():
        old_text = '        "tools.homeassistant_tool",'
        new_text = '''        "tools.homeassistant_tool",
        # mem9 persistent memory
        "tools.mem9_tools",'''
        patch_file(model_tools_path, old_text, new_text, dry_run)
        print(f"  ✅ 完成")
    else:
        print(f"  ❌ 文件不存在：{model_tools_path}")
        success = False
    
    # 5. 修改 toolsets.py
    print("5. 注册 mem9 toolset...")
    toolsets_path = hermes_dir / "toolsets.py"
    if toolsets_path.exists():
        old_text = '''    "homeassistant": {
        "description": "Home Assistant smart home control",
        "tools": ["ha_list_entities", "ha_get_state", "ha_list_services", "ha_call_service"],
        "includes": []
    },'''
        new_text = '''    "homeassistant": {
        "description": "Home Assistant smart home control",
        "tools": ["ha_list_entities", "ha_get_state", "ha_list_services", "ha_call_service"],
        "includes": []
    },

    "mem9": {
        "description": "mem9 persistent cloud memory - store and recall memories across sessions",
        "tools": ["memory_store", "memory_search", "memory_get", "memory_update", "memory_delete"],
        "includes": []
    },'''
        patch_file(toolsets_path, old_text, new_text, dry_run)
        print(f"  ✅ 完成")
    else:
        print(f"  ❌ 文件不存在：{toolsets_path}")
        success = False
    
    return success


def post_install(hemes_dir, dry_run=False):
    """安装后配置"""
    print("\n⚙️  配置 mem9...\n")
    
    if dry_run:
        print("  运行以下命令配置 mem9:")
        print("    hermes config set memory.provider mem9")
        print("    hermes tools enable mem9")
        return True
    
    # 尝试自动配置
    try:
        import subprocess
        
        # 设置 memory provider
        print("设置 memory.provider = mem9")
        result = subprocess.run(
            ["hermes", "config", "set", "memory.provider", "mem9"],
            cwd=hermes_dir,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print("  ✅ memory.provider 已设置")
        else:
            print(f"  ⚠️  设置失败，请手动运行：hermes config set memory.provider mem9")
        
        # 启用 mem9 toolset
        print("启用 mem9 toolset")
        result = subprocess.run(
            ["hermes", "tools", "enable", "mem9"],
            cwd=hermes_dir,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print("  ✅ mem9 toolset 已启用")
        else:
            print(f"  ⚠️  启用失败，请手动运行：hermes tools enable mem9")
        
        return True
    except Exception as e:
        print(f"  ⚠️  自动配置失败，请手动运行:")
        print("    hermes config set memory.provider mem9")
        print("    hermes tools enable mem9")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="mem9 Hermes Agent 一键安装脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python install_mem9.py              # 自动检测并安装
  python install_mem9.py --dry-run    # 预览安装内容
  python install_mem9.py --hermes-dir /path/to/hermes-agent
        """
    )
    
    parser.add_argument(
        "--hermes-dir",
        type=str,
        help="Hermes Agent 目录路径（默认自动检测）"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="预览安装内容，不实际修改文件"
    )
    parser.add_argument(
        "--skip-config",
        action="store_true",
        help="跳过安装后配置步骤"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("  mem9 Hermes Agent 安装脚本")
    print("=" * 60)
    
    # 检查前提条件
    if not check_prerequisites():
        sys.exit(1)
    
    # 确定 Hermes 目录
    hermes_dir = Path(args.hermes_dir) if args.hermes_dir else find_hermes_dir()
    
    if args.dry_run:
        print("\n🔍 预览模式 - 不会修改任何文件\n")
    
    # 安装插件
    if not install_plugin(hermes_dir, args.dry_run):
        print("\n❌ 安装失败")
        sys.exit(1)
    
    # 安装后配置
    if not args.skip_config:
        post_install(hermes_dir, args.dry_run)
    
    print("\n" + "=" * 60)
    if args.dry_run:
        print("✅ 预览完成！运行不带 --dry-run 的参数进行实际安装")
    else:
        print("✅ 安装完成！")
        print("\n下一步:")
        print("  1. 重启 Hermes Agent: hermes")
        print("  2. 测试记忆功能：帮我记住...")
        print("\n文档：plugins/memory/mem9/INSTALL.md")
    print("=" * 60)


if __name__ == "__main__":
    main()
