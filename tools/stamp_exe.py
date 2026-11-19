# -*- coding: utf-8 -*-
"""给 exe 写入图标与版本信息
用法: python stamp_exe.py <exe路径> [--icon-only]
中文参数必须走 Python 的 subprocess（Windows 下是 CreateProcessW，UTF-16），
用 bash 直接传中文会被按 GBK 解释成乱码。"""
import os, shutil, subprocess, sys

ROOT = r"D:\develop\projects\chenhun_planner_2026"
RCEDIT_SRC = r"C:\Users\ASUS\AppData\Local\electron-builder\Cache\winCodeSign\217125615\rcedit-x64.exe"
RCEDIT = os.path.join(ROOT, "tools", "rcedit-x64.exe")
ICON = os.path.join(ROOT, "desktop", "build", "icon.ico")

if not os.path.exists(RCEDIT):
    if not os.path.exists(RCEDIT_SRC):
        print("找不到 rcedit:", RCEDIT_SRC)
        sys.exit(1)
    shutil.copyfile(RCEDIT_SRC, RCEDIT)

if len(sys.argv) < 2:
    print("用法: stamp_exe.py <exe> [--icon-only]")
    sys.exit(1)

exe = sys.argv[1]
icon_only = "--icon-only" in sys.argv

if not os.path.exists(exe):
    print("找不到 exe:", exe)
    sys.exit(1)

before = os.path.getsize(exe)

args = [RCEDIT, exe, "--set-icon", ICON]
if not icon_only:
    args += [
        "--set-file-version", "1.0.0.0",
        "--set-product-version", "1.0.0",
        "--set-version-string", "ProductName", "晨昏日程",
        "--set-version-string", "FileDescription", "晨昏日程 · 每日计划与省钱记录",
        "--set-version-string", "CompanyName", "Laity206",
        "--set-version-string", "LegalCopyright", "Copyright © 2026 Laity206",
        "--set-version-string", "InternalName", "ChenhunPlanner",
        "--set-version-string", "OriginalFilename", os.path.basename(exe),
    ]

print("目标:", exe)
r = subprocess.run(args, capture_output=True)
out = (r.stdout or b"").decode("utf-8", "ignore").strip()
err = (r.stderr or b"").decode("utf-8", "ignore").strip()
if out:
    print("  stdout:", out)
if err:
    print("  stderr:", err)
print("  退出码:", r.returncode)
if r.returncode != 0:
    sys.exit(r.returncode)

after = os.path.getsize(exe)
print("  大小: %.1f MB -> %.1f MB" % (before / 1048576.0, after / 1048576.0))
print("  已写入图标" + ("" if icon_only else "与版本信息"))
