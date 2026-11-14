#!/usr/bin/env python3
"""Draw the Wordstreak icons: a cream card with "Aa" and five streak dots.

Usage:  python3 tools/make_icons.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
BG = (74, 39, 131)
CARD = (255, 255, 255)
INK = (28, 26, 22)
ON = (92, 178, 109)
OFF = (221, 215, 204)

FONTS = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia Bold.ttf",
]


def font(px):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def draw(size, art=1.0):
    S = size * 4  # supersample, then shrink for smooth edges
    im = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(im)
    cw, ch = S * 0.62 * art, S * 0.62 * art
    x0, y0 = (S - cw) / 2, (S - ch) / 2
    d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=cw * 0.12, fill=CARD)
    f = font(int(ch * 0.42))
    text = "Aa"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text((S / 2 - (r - l) / 2 - l, y0 + ch * 0.40 - (b - t) / 2 - t), text, font=f, fill=INK)
    dot = cw * 0.075
    gap = cw * 0.045
    total = 5 * dot + 4 * gap
    dx = S / 2 - total / 2
    dy = y0 + ch * 0.76
    for i in range(5):
        cx = dx + i * (dot + gap)
        d.ellipse([cx, dy, cx + dot, dy + dot], fill=ON if i < 3 else OFF)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw(192).save(os.path.join(OUT, "icon-192.png"))
draw(512).save(os.path.join(OUT, "icon-512.png"))
draw(512, art=0.82).save(os.path.join(OUT, "icon-maskable-512.png"))
draw(180).save(os.path.join(OUT, "apple-touch-icon.png"))
print("icons written to", OUT)
