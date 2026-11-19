# -*- coding: utf-8 -*-
"""创建 GitHub Release 并上传附件
用法: GITHUB_TOKEN=ghp_xxx python tools/gh_release.py
不把 token 写进任何文件，只从环境变量读。
"""
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

OWNER = "Laity206"
REPO = "chenhun-planner"
TAG = "v1.0.0"
NAME = "v1.0.0 · 首个正式版本"

ROOT = r"D:\develop\projects\chenhun_planner_2026"
RELEASE_DIR = os.path.join(ROOT, "dist", "release")
NOTES = os.path.join(RELEASE_DIR, "RELEASE_NOTES.md")

ASSETS = [
    "ChenhunPlanner-1.0.apk",              # 小文件先传，网络一恢复就能落地
    "ChenhunPlanner-1.0.0-portable.exe",
    "ChenhunPlanner-1.0.0-win-x64.zip",
]

TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
if not TOKEN:
    print("缺少 GITHUB_TOKEN 环境变量")
    sys.exit(1)

API = "https://api.github.com"


def call(method, url, data=None, content_type="application/json", raw=False):
    body = None
    if data is not None:
        body = data if raw else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "chenhun-release-script")
    if body is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "ignore")
        return e.code, {"error": text[:600]}


# 1. 确认仓库可访问
st, info = call("GET", "%s/repos/%s/%s" % (API, OWNER, REPO))
if st != 200:
    print("读取仓库失败 [%s]: %s" % (st, info.get("error")))
    sys.exit(2)
print("仓库 OK: %s (private=%s)" % (info.get("full_name"), info.get("private")))

# 2. 已存在就复用，避免重复创建
st, rel = call("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
if st == 200:
    print("Release 已存在，复用 id=%s" % rel.get("id"))
    upload_url = rel["upload_url"].split("{")[0]
    existing = {a["name"] for a in rel.get("assets", [])}
else:
    body = ""
    if os.path.exists(NOTES):
        with open(NOTES, "r", encoding="utf-8") as f:
            body = f.read()
    st, rel = call("POST", "%s/repos/%s/%s/releases" % (API, OWNER, REPO), {
        "tag_name": TAG,
        "name": NAME,
        "body": body,
        "draft": False,
        "prerelease": False,
    })
    if st not in (200, 201):
        print("创建 Release 失败 [%s]: %s" % (st, rel.get("error")))
        sys.exit(3)
    print("Release 已创建: %s" % rel.get("html_url"))
    upload_url = rel["upload_url"].split("{")[0]
    existing = set()

# 3. 上传附件（用 curl：urllib 传大文件容易写超时）
import subprocess


def upload_with_curl(upload_url, path, name, mime):
    url = "%s?name=%s" % (upload_url, urllib.parse.quote(name))
    cmd = [
        "curl", "-sS", "-X", "POST",
        "-H", "Authorization: Bearer " + TOKEN,
        "-H", "Content-Type: " + mime,
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28",
        "--data-binary", "@" + path.replace("\\", "/"),
        "--max-time", "2400",
        "--retry", "3", "--retry-delay", "5",
        "-w", "\n__HTTP__%{http_code}",
        url,
    ]
    r = subprocess.run(cmd, capture_output=True)
    out = r.stdout.decode("utf-8", "ignore")
    code = ""
    if "__HTTP__" in out:
        out, code = out.rsplit("__HTTP__", 1)
        code = code.strip()
    return code, out.strip()


for name in ASSETS:
    path = os.path.join(RELEASE_DIR, name)
    if not os.path.exists(path):
        print("  跳过（文件不存在）:", name)
        continue
    if name in existing:
        print("  已存在，跳过:", name)
        continue
    size = os.path.getsize(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    print("  上传 %s (%.1f MB) ..." % (name, size / 1048576.0), flush=True)
    code, out = upload_with_curl(upload_url, path, name, mime)
    if code in ("200", "201"):
        try:
            print("    OK -> %s" % json.loads(out).get("browser_download_url"))
        except Exception:
            print("    OK")
    else:
        print("    失败 [%s] %s" % (code, out[:200]))

# 4. 收尾
st, rel = call("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
print("\n完成。附件 %d 个" % len(rel.get("assets", [])))
print("发布页: %s" % rel.get("html_url"))
