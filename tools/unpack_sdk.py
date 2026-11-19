# -*- coding: utf-8 -*-
"""准备安卓构建工具链：JDK 17 + Android build-tools + platform
缺什么下什么，已经解压过的直接跳过，可反复执行。

用法: python tools/unpack_sdk.py
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL = os.path.join(ROOT, "dl")
TOOLS = os.path.join(ROOT, "tools")
SDK = os.path.join(TOOLS, "android-sdk")

# 名称 -> (下载地址, 压缩包内容里用于定位根目录的标志文件, 解压后的目标目录)
PACKAGES = [
    (
        "jdk17.zip",
        "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse",
        "javac.exe",
        os.path.join(TOOLS, "jdk"),
        "JDK 17",
    ),
    (
        "build-tools.zip",
        "https://dl.google.com/android/repository/build-tools_r34-windows.zip",
        "aapt2.exe",
        os.path.join(SDK, "build-tools", "34.0.0"),
        "Android build-tools 34",
    ),
    (
        "platform34.zip",
        "https://dl.google.com/android/repository/platform-34-ext7_r03.zip",
        "android.jar",
        os.path.join(SDK, "platforms", "android-34"),
        "Android platform 34",
    ),
]


def already_ready(marker, target):
    """JDK 的可执行文件在 bin/ 下，build-tools 直接在根目录，两处都查"""
    for p in (os.path.join(target, marker), os.path.join(target, "bin", marker)):
        if os.path.exists(p):
            return True
    return False


def download(url, dst):
    """用 curl 下载：进度可见，断线能重试"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    print("    下载 %s" % url)
    cmd = ["curl", "-L", "--retry", "3", "--connect-timeout", "20",
           "-o", dst, url]
    r = subprocess.run(cmd)
    if r.returncode != 0 or not os.path.exists(dst):
        print("    下载失败（curl 退出码 %s）" % r.returncode)
        return False
    return True


def extract(zip_path, marker, target):
    """解到临时目录，再整体搬到 target。

    包根怎么判断：这几家的压缩包都是"一个顶层目录 + 里面若干子目录"，
    所以优先取唯一的顶层目录（JDK 的 javac.exe 在 bin/ 下，不能直接拿
    含 marker 的那层当根，否则会把 bin 搬成包根，结构就压平了）。
    """
    tmp = target + "_tmp"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
    except (zipfile.BadZipFile, OSError):
        print("    压缩包不完整或损坏:", os.path.basename(zip_path))
        shutil.rmtree(tmp, ignore_errors=True)
        return False

    root = tmp
    entries = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))]
    if len(entries) == 1:
        cand = os.path.join(tmp, entries[0])
        # 确认这个顶层目录里真的能找到目标文件，避免误判
        hit = False
        for _base, _dirs, files in os.walk(cand):
            if marker in files:
                hit = True
                break
        if hit:
            root = cand

    if root == tmp:
        # 压缩包是"平铺"的，直接整体搬
        if os.path.exists(target):
            shutil.rmtree(target)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(tmp, target)
    else:
        found = False
        for _base, _dirs, files in os.walk(root):
            if marker in files:
                found = True
                break
        if not found:
            print("    包里没找到 %s" % marker)
            shutil.rmtree(tmp, ignore_errors=True)
            return False
        if os.path.exists(target):
            shutil.rmtree(target)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(root, target)
        shutil.rmtree(tmp, ignore_errors=True)
    return True


def check(rel):
    p = os.path.join(ROOT, rel)
    return os.path.exists(p), p


def main():
    print("工具链目录: %s\n" % TOOLS)
    for i, (zip_name, url, marker, target, label) in enumerate(PACKAGES, 1):
        print("[%d/%d] %s" % (i, len(PACKAGES), label))
        if already_ready(marker, target):
            print("    已就绪，跳过")
            continue

        zip_path = os.path.join(DL, zip_name)
        if not os.path.exists(zip_path):
            if not download(url, zip_path):
                print("    跳过（下载失败，可手动放到 dl/%s）" % zip_name)
                continue
            print("    下载完成 %.1f MB" % (os.path.getsize(zip_path) / 1048576.0))

        if extract(zip_path, marker, target):
            print("    -> %s" % target)
        else:
            print("    解压失败，可手动解压到 %s" % target)

    print("\n校验:")
    checks = [
        "tools/jdk/bin/javac.exe",
        "tools/jdk/bin/keytool.exe",
        "tools/android-sdk/build-tools/34.0.0/aapt2.exe",
        "tools/android-sdk/build-tools/34.0.0/d8.bat",
        "tools/android-sdk/build-tools/34.0.0/zipalign.exe",
        "tools/android-sdk/build-tools/34.0.0/apksigner.bat",
        "tools/android-sdk/platforms/android-34/android.jar",
    ]
    ok = True
    for c in checks:
        e, p = check(c)
        ok = ok and e
        print(("  OK   " if e else "  缺失 ") + c)

    print("\n全部就绪，可以运行 tools/build_apk.sh" if ok else "\n有缺失，见上面的提示")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
