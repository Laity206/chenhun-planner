# -*- coding: utf-8 -*-
"""生成应用图标：沿用原 favicon 的墨绿渐变 + 米白拱门"""
import os
from PIL import Image, ImageDraw

OUT = r"D:\develop\projects\chenhun_planner_2026\desktop\build"
os.makedirs(OUT, exist_ok=True)

S = 1024
TOP = (58, 125, 110)     # #3A7D6E
BOT = (36, 90, 79)       # #245A4F
CREAM = (246, 243, 236)  # #F6F3EC
SUN = (233, 185, 138)    # #E9B98A


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def make(size=S):
    # 垂直渐变
    grad = Image.new("RGB", (1, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        gd.point((0, y), tuple(int(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3)))
    grad = grad.resize((size, size))

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(grad, (0, 0))
    img.putalpha(rounded_mask(size, int(size * 0.23)))

    d = ImageDraw.Draw(img)
    u = size / 192.0           # 按 192 设计稿缩放

    # 太阳
    cx, cy, r = 144 * u, 48 * u, 12 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SUN)

    lw = int(9 * u)

    # 主拱门：52,132 -> 52,76 -> 72,58 -> 92,76 -> 92,132（折线一次画，接缝才圆滑）
    d.line([(52 * u, 132 * u), (52 * u, 76 * u), (72 * u, 58 * u),
            (92 * u, 76 * u), (92 * u, 132 * u)],
           fill=CREAM, width=lw, joint="curve")

    # 地平线
    d.line([(36 * u, 140 * u), (156 * u, 140 * u)], fill=CREAM, width=lw)

    # 右侧小门（半透明）
    lw2 = int(7 * u)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.line([(108 * u, 132 * u), (108 * u, 98 * u), (124 * u, 84 * u),
             (140 * u, 98 * u), (140 * u, 132 * u)],
            fill=CREAM + (190,), width=lw2, joint="curve")
    img = Image.alpha_composite(img, overlay)

    return img


base = make(S)
base.save(os.path.join(OUT, "icon.png"))

# Windows ICO
sizes = [16, 24, 32, 48, 64, 128, 256]
base.resize((256, 256), Image.LANCZOS).save(
    os.path.join(OUT, "icon.ico"),
    format="ICO",
    sizes=[(s, s) for s in sizes]
)

# 安卓用
for s in (48, 72, 96, 144, 192, 512):
    base.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, "icon_%d.png" % s))

print("图标已生成:")
for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    print("  %-14s %6.1f KB" % (f, os.path.getsize(p) / 1024.0))
