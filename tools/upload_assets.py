# -*- coding: utf-8 -*-
"""用 urllib 上传 Release 附件（curl 在本机代理环境下会 502）

用法: GITHUB_TOKEN=xxx python tools/upload_assets.py [文件名 ...]
不带参数则传 ASSETS 里的全部。
"""
import json
import os
import sys
import urllib.parse
import urllib.request

OWNER, REPO, TAG = "Laity206", "chenhun-planner", "v1.0.0"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL_DIR = os.path.join(ROOT, "dist", "release")
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
if not TOKEN:
    print("缺少 GITHUB_TOKEN")
    sys.exit(1)

API = "https://api.github.com"
TIMEOUT = 1800


def api_json(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "chenhun-upload")
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def upload(upload_url, path, name):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        body = f.read()
    url = "%s?name=%s" % (upload_url, urllib.parse.quote(name))
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("Content-Length", str(size))
    req.add_header("User-Agent", "chenhun-upload")
    print("    上传 %.1f MB ..." % (size / 1048576.0), flush=True)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def main():
    rel = api_json("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
    rid = rel["id"]
    # 上传必须打 uploads.github.com，不是 api.github.com
    upload_url = rel["upload_url"].split("{")[0]
    existing = {a["name"] for a in rel.get("assets", [])}
    print("Release id=%s，上传端点 %s" % (rid, upload_url))
    print("已有附件: %s" % (", ".join(sorted(existing)) or "无"))

    want = sys.argv[1:] or [
        "ChenhunPlanner-1.0.apk",
        "ChenhunPlanner-1.0.0-portable.exe",
        "ChenhunPlanner-1.0.0-win-x64.zip",
    ]

    for name in want:
        if name in existing:
            print("  已存在，跳过:", name)
            continue
        path = os.path.join(REL_DIR, name)
        if not os.path.exists(path):
            print("  找不到文件:", path)
            continue
        try:
            res = upload(upload_url, path, name)
            print("    OK -> %s" % res.get("browser_download_url"))
        except Exception as e:
            print("    失败: %s %s" % (type(e).__name__, str(e)[:200]))

    rel = api_json("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
    print("\n当前附件 %d 个:" % len(rel.get("assets", [])))
    for a in rel.get("assets", []):
        print("  %-42s %7.1f MB" % (a["name"], a["size"] / 1048576.0))
    print("发布页: %s" % rel.get("html_url"))


if __name__ == "__main__":
    main()
