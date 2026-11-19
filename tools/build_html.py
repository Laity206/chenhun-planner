# -*- coding: utf-8 -*-
"""把同步内核注入原 HTML，生成 shell 用的 index.html"""
import io, os, shutil, sys

SRC = r"D:\软件\聊天软件\微信\数据文件\WeChat Files\wxid_zk80fe3ltjfg22\FileStorage\Temp\Copy\晨昏日程-单文件版.html"
ROOT = r"D:\develop\projects\chenhun_planner_2026"
OUT_DIR = os.path.join(ROOT, "common")
DST = os.path.join(OUT_DIR, "index.html")

# 生成后同时分发到两端，避免 common 与副本不一致
TARGETS = [
    os.path.join(ROOT, "desktop", "renderer"),
    os.path.join(ROOT, "android", "assets"),
]

with io.open(SRC, "r", encoding="utf-8") as f:
    html = f.read()

needle = "<script>App.boot();</script>"
n = html.count(needle)
if n != 1:
    print("ERROR: App.boot 出现 %d 次，预期 1 次" % n)
    sys.exit(1)

html = html.replace(
    needle,
    '<script src="longtask.js"></script>\n'
    '<script src="routine.js"></script>\n'
    '<script src="sync-core.js"></script>\n'
    '<script>App.boot();</script>'
)

# 标题带版本号
html = html.replace(
    "<title>单文件版 · 晨昏日程 · 今天要做什么</title>",
    "<title>晨昏日程 v1.0</title>"
)

# 桌面端宽屏：原设计把内容锁在 1120px 居中，宽屏下两侧大片留白。
# 只在 ≥1200px 生效，手机与窄窗口不受影响。
WIDE_CSS = (
    '<style id="chx-wide">\n'
    '@media (min-width:1200px){\n'
    '  .app{max-width:none;padding-left:32px;padding-right:32px}\n'
    '}\n'
    '</style>\n'
    '</head>'
)
if html.count("</head>") == 1:
    html = html.replace("</head>", WIDE_CSS)
else:
    print("WARN: </head> 出现 %d 次，跳过错宽样式注入" % html.count("</head>"))

# 移动端：禁止双击缩放，手感更像原生
html = html.replace(
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\">"
)

with io.open(DST, "w", encoding="utf-8", newline="") as f:
    f.write(html)

# 自检
with io.open(DST, "r", encoding="utf-8") as f:
    out = f.read()
assert "sync-core.js" in out, "注入失败"
assert "longtask.js" in out, "长期任务模块未注入"
assert "routine.js" in out, "每日定时模块未注入"
assert out.count("<script>App.boot();</script>") == 1, "boot 数量异常"

# 分发到两端，保证 common / desktop / android 三处一致
for t in TARGETS:
    os.makedirs(t, exist_ok=True)
    for name in ("index.html", "sync-core.js", "longtask.js", "routine.js"):
        src = os.path.join(OUT_DIR, name)
        if not os.path.exists(src):
            print("  跳过（common 里没有 %s）" % name)
            continue
        shutil.copyfile(src, os.path.join(t, name))
    print("  已分发 -> %s" % t)

print("OK  %s  %.1f KB" % (DST, os.path.getsize(DST) / 1024.0))
print("原文件 %.1f KB -> 新文件 %.1f KB" % (os.path.getsize(SRC) / 1024.0, os.path.getsize(DST) / 1024.0))
