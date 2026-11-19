# -*- coding: utf-8 -*-
"""解压 JDK / build-tools / platform，并规整成固定目录结构"""
import os, shutil, sys, zipfile

ROOT = r"D:\develop\projects\chenhun_planner_2026"
DL = os.path.join(ROOT, "dl")
TOOLS = os.path.join(ROOT, "tools")
SDK = os.path.join(TOOLS, "android-sdk")


def extract(zip_path, dest_parent, marker, final_name):
    """解到临时目录，找到含 marker 的目录，移动到 dest_parent/final_name"""
    if not os.path.exists(zip_path):
        print("  跳过（不存在）:", os.path.basename(zip_path))
        return False
    tmp = os.path.join(TOOLS, "_tmp_" + final_name)
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
    except (zipfile.BadZipFile, OSError) as e:
        print("  !! 压缩包不完整或损坏（可能还在下载）:", os.path.basename(zip_path))
        shutil.rmtree(tmp, ignore_errors=True)
        return False

    found = None
    for base, dirs, files in os.walk(tmp):
        if marker in files:
            found = base
            break
    if not found:
        print("  !! 没找到", marker, "in", os.path.basename(zip_path))
        return False

    target = os.path.join(dest_parent, final_name)
    if os.path.exists(target):
        shutil.rmtree(target)
    os.makedirs(dest_parent, exist_ok=True)
    shutil.move(found, target)
    shutil.rmtree(tmp, ignore_errors=True)
    print("  ->", target)
    return True


print("[1/3] JDK")
extract(os.path.join(DL, "jdk17.zip"), TOOLS, "javac.exe", "jdk")

print("[2/3] build-tools")
bt_root = os.path.join(SDK, "build-tools")
extract(os.path.join(DL, "build-tools.zip"), bt_root, "aapt2.exe", "34.0.0")

print("[3/3] platform")
plat_root = os.path.join(SDK, "platforms")
extract(os.path.join(DL, "platform34.zip"), plat_root, "android.jar", "android-34")

# 校验
checks = [
    os.path.join(TOOLS, "jdk", "bin", "javac.exe"),
    os.path.join(TOOLS, "jdk", "bin", "keytool.exe"),
    os.path.join(bt_root, "34.0.0", "aapt2.exe"),
    os.path.join(bt_root, "34.0.0", "d8.bat"),
    os.path.join(bt_root, "34.0.0", "zipalign.exe"),
    os.path.join(bt_root, "34.0.0", "apksigner.bat"),
    os.path.join(plat_root, "android-34", "android.jar"),
]
print("\n校验:")
ok = True
for c in checks:
    e = os.path.exists(c)
    ok = ok and e
    print(("  OK  " if e else "  缺失 ") + os.path.relpath(c, ROOT))
print("\n全部就绪" if ok else "\n有缺失，需要检查")
sys.exit(0 if ok else 1)
