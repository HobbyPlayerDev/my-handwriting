#!/usr/bin/env python3
"""Builds a synthetic sample file (format my-handwriting-glyphs v1) for tests - no real handwriting.

Every character is drawn with a normal font and turned into horizontal "hatch" strokes, with a little
random variation per sample. Good enough to test layout, fallbacks and export in the browser and in
skill/my-handwriting/scripts/my_handwriting.py.

    python tests/make_fixture.py out.json [--samples 3] [--chars "ABC…"] [--seed 1]

Needs Pillow (pip install pillow). Without --chars: all groups of all languages.
"""
import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skill", "my-handwriting", "scripts"))
import my_handwriting as hs  # noqa: E402

FONTS = [r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"]


def load_font(px):
    from PIL import ImageFont
    for f in FONTS:
        if os.path.isfile(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default(size=px)


def hatch(ch, font, unit, rng, step=5):
    from PIL import Image, ImageDraw
    W, H = int(2.2 * unit), int(2.05 * unit)
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    base = int(1.45 * unit)
    d.text((int(0.3 * unit), base), ch, font=font, fill=255, anchor="ls")
    px = img.load()
    sc = rng.uniform(0.94, 1.06)
    dx, dy = rng.uniform(-0.04, 0.04), rng.uniform(-0.02, 0.02)
    strokes = []
    for y in range(0, H, step):
        x = 0
        while x < W:
            if px[x, y] > 128:
                x0 = x
                while x < W and px[x, y] > 128:
                    x += 1
                ux0, ux1 = x0 / unit, (x - 1) / unit
                uy = 1.45 - y / unit
                pts = [ux0 * sc + dx, uy * sc + dy, max(ux1, ux0 + 0.01) * sc + dx, uy * sc + dy]
                strokes.append([int(round(v * 1000)) for v in pts])
            x += 1
    return strokes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--chars")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    unit = 100
    font = load_font(10)
    cap = font.getbbox("H", anchor="ls")
    font = load_font(int(round(10 * unit / max(1, -cap[1]))))
    if a.chars:
        cs = list(a.chars)
    else:
        cs = []
        for _gid, _n, chars in hs.GROUPS:
            cs += [c for c in chars if c not in cs]
        for code in hs.LANG_ORDER:
            cs += [c for c in hs.LANG_GROUPS[code] if c not in cs]
    rng = random.Random(a.seed)
    glyphs = {}
    for ch in cs:
        lst = []
        for i in range(a.samples):
            st = hatch(ch, font, unit, rng)
            if st:
                lst.append({"id": "fx-%04x-%d" % (ord(ch[0]), i), "created": 0, "strokes": st, "dev": "fixture"})
        if lst:
            glyphs[ch] = lst
    data = {"format": hs.FORMAT, "version": 1, "app": "fixture", "metrics": dict(hs.DEFAULT_METRICS),
            "settings": {"target": a.samples, "scripts": list(hs.LANG_ORDER)}, "glyphs": glyphs}
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    print("fixture: %d characters, %d samples -> %s" % (len(glyphs), sum(len(v) for v in glyphs.values()), a.out))


if __name__ == "__main__":
    main()
