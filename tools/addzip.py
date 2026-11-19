# -*- coding: utf-8 -*-
"""把若干文件追加进已有 zip(apk)，不重写原有条目
用法: python addzip.py in.apk out.apk file1 [file2 ...]
条目名用文件名；如需子目录，用 name:path 形式。"""
import os, shutil, sys, zipfile

if len(sys.argv) < 4:
    print("用法: addzip.py in.apk out.apk file1 [file2...]")
    sys.exit(1)

src, dst = sys.argv[1], sys.argv[2]
items = sys.argv[3:]

shutil.copyfile(src, dst)

with zipfile.ZipFile(dst, "a", zipfile.ZIP_DEFLATED) as z:
    for it in items:
        if ":" in it and not os.path.exists(it):
            arc, path = it.split(":", 1)
        else:
            path = it
            arc = os.path.basename(it)
        if not os.path.exists(path):
            print("  缺失:", path)
            sys.exit(2)
        z.write(path, arc)
        print("  + %-24s %7.1f KB" % (arc, os.path.getsize(path) / 1024.0))

with zipfile.ZipFile(dst) as z:
    names = z.namelist()
    print("  条目总数:", len(names))
    for must in ("AndroidManifest.xml", "classes.dex", "resources.arsc"):
        print(("  OK  " if must in names else "  缺 ") + must)
    if "classes.dex" not in names:
        sys.exit(3)
