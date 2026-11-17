#!/usr/bin/env python3
"""Builds the "standard handwriting" fallback font used for characters the user has not written.

Source: Hershey Roman Simplex (tools/hershey/futural.jhf, see tools/hershey/LICENSE-hershey.txt),
a single-stroke vector font from 1967. Characters it does not contain (€ § ß « » „ … ≤ √ …) are
defined below by hand.

Output (both generated, do not edit by hand):
  js/fallback-font.js                                 for the web app
  skill/my-handwriting/scripts/fallback_font.json     for the Python renderer / Claude skill

Units: cap height = 1, baseline = 0, y up; stored as integers x1000 (same as the glyph format).
Run:  python tools/build_fallback_font.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "hershey", "futural.jhf")
OUT_JS = os.path.join(ROOT, "js", "fallback-font.js")
OUT_JSON = os.path.join(ROOT, "skill", "my-handwriting", "scripts", "fallback_font.json")

CAP_TOP, BASE = -12, 9          # Hershey Roman Simplex: capitals from y=-12 to the baseline y=9
UNIT = float(BASE - CAP_TOP)    # 21 font units = cap height 1

NOTICE = ("Hershey Roman Simplex, converted. The Hershey Fonts were originally created by "
          "Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of "
          "the Font data in this distribution was originally created by James Hurt, Cognition, Inc., "
          "900 Technology Park Drive, Billerica, MA 01821. Extra characters by the my-handwriting project.")


def parse_jhf(path):
    data = open(path, encoding="ascii").read().replace("\r", "").replace("\n", "")
    glyphs, i, code = {}, 0, 32
    while i + 8 <= len(data):
        n = int(data[i + 5:i + 8])
        body = data[i + 8:i + 8 + 2 * n]
        i += 8 + 2 * n
        left, right = ord(body[0]) - 82, ord(body[1]) - 82
        strokes, cur = [], []
        for k in range(1, n):
            a, b = body[2 * k], body[2 * k + 1]
            if a == " " and b == "R":
                if cur:
                    strokes.append(cur)
                cur = []
                continue
            x, y = ord(a) - 82, ord(b) - 82
            cur.append(((x - left) / UNIT, (BASE - y) / UNIT))
        if cur:
            strokes.append(cur)
        glyphs[chr(code)] = {"w": (right - left) / UNIT, "s": strokes}
        code += 1
    return glyphs


def arc(cx, cy, rx, ry, a0, a1, n=14):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * t / n)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * t / n))) for t in range(n + 1)]


def wave(x0, x1, y, amp, n=12):
    return [(x0 + (x1 - x0) * t / n, y + amp * math.sin(t / n * 2 * math.pi)) for t in range(n + 1)]


def moved(strokes, dx=0.0, dy=0.0, sx=1.0, sy=1.0):
    return [[(x * sx + dx, y * sy + dy) for x, y in st] for st in strokes]


def extras(g):
    """Hand-made characters (the same visual language: thin single strokes)."""
    e = {}
    def add(ch, w, strokes):
        e[ch] = {"w": w, "s": [list(st) for st in strokes]}
    add("€", 0.75, [arc(0.45, 0.5, 0.42, 0.5, 45, 315, 18), [(0.0, 0.58), (0.52, 0.58)], [(0.0, 0.42), (0.48, 0.42)]])
    s_top = moved(g["S"]["s"], 0.0, 0.42, 0.85, 0.55)
    s_low = moved(g["S"]["s"], 0.0, -0.12, 0.85, 0.55)
    add("§", 0.75, s_top + s_low)
    add("ß", 0.7, [[(0.1, -0.0), (0.1, 0.72), (0.13, 0.87), (0.21, 0.96), (0.33, 1.0), (0.45, 0.97), (0.52, 0.88),
                    (0.52, 0.76), (0.45, 0.66), (0.33, 0.6), (0.46, 0.55), (0.56, 0.45), (0.59, 0.31), (0.56, 0.16),
                    (0.47, 0.05), (0.35, 0.0), (0.24, 0.02)]])
    add("ẞ", 0.85, [[(0.12, 0.0), (0.12, 0.7), (0.17, 0.88), (0.3, 0.98), (0.45, 1.0), (0.62, 0.95), (0.72, 0.85),
                     (0.45, 0.58), (0.62, 0.52), (0.72, 0.4), (0.74, 0.25), (0.68, 0.1), (0.56, 0.02), (0.42, 0.0),
                     (0.3, 0.03)]])
    add("×", 0.6, [[(0.08, 0.1), (0.52, 0.54)], [(0.52, 0.1), (0.08, 0.54)]])
    add("÷", 0.66, [[(0.05, 0.32), (0.61, 0.32)], [(0.33, 0.56)], [(0.33, 0.08)]])
    add("±", 0.66, [[(0.05, 0.52), (0.61, 0.52)], [(0.33, 0.25), (0.33, 0.8)], [(0.05, 0.04), (0.61, 0.04)]])
    add("√", 0.9, [[(0.0, 0.42), (0.1, 0.47), (0.26, 0.0), (0.46, 1.05), (0.88, 1.05)]])
    add("≈", 0.66, [wave(0.05, 0.61, 0.42, 0.05), wave(0.05, 0.61, 0.2, 0.05)])
    add("≠", 0.66, [[(0.05, 0.42), (0.61, 0.42)], [(0.05, 0.2), (0.61, 0.2)], [(0.16, -0.02), (0.5, 0.64)]])
    add("≤", 0.66, [[(0.6, 0.66), (0.06, 0.43), (0.6, 0.2)], [(0.06, 0.02), (0.6, 0.02)]])
    add("≥", 0.66, [[(0.06, 0.66), (0.6, 0.43), (0.06, 0.2)], [(0.06, 0.02), (0.6, 0.02)]])
    add("→", 0.85, [[(0.0, 0.32), (0.8, 0.32)], [(0.6, 0.48), (0.8, 0.32), (0.6, 0.16)]])
    add("←", 0.85, [[(0.8, 0.32), (0.0, 0.32)], [(0.2, 0.48), (0.0, 0.32), (0.2, 0.16)]])
    add("«", 0.55, [[(0.24, 0.56), (0.04, 0.33), (0.24, 0.1)], [(0.46, 0.56), (0.26, 0.33), (0.46, 0.1)]])
    add("»", 0.55, [[(0.04, 0.56), (0.24, 0.33), (0.04, 0.1)], [(0.26, 0.56), (0.46, 0.33), (0.26, 0.1)]])
    def comma(x, y, flip=False):
        pts = [(x + 0.03, y + 0.06), (x + 0.04, y + 0.01), (x + 0.02, y - 0.06), (x - 0.03, y - 0.12)]
        return [(2 * x + 0.02 - px, 2 * y - py) for px, py in pts] if flip else pts
    add("„", 0.35, [comma(0.08, 0.02), comma(0.24, 0.02)])
    add("‚", 0.2, [comma(0.08, 0.02)])
    add("“", 0.35, [comma(0.08, 0.9, True), comma(0.24, 0.9, True)])
    add("”", 0.35, [comma(0.1, 0.98), comma(0.26, 0.98)])
    add("‘", 0.2, [comma(0.08, 0.9, True)])
    add("’", 0.2, [comma(0.1, 0.98)])
    add("–", 0.62, [[(0.02, 0.32), (0.6, 0.32)]])
    add("—", 1.05, [[(0.02, 0.32), (1.03, 0.32)]])
    add("…", 0.8, [[(0.08, 0.02)], [(0.38, 0.02)], [(0.68, 0.02)]])
    add("·", 0.2, [[(0.1, 0.36)]])
    add("°", 0.36, [arc(0.17, 0.86, 0.12, 0.12, 0, 360, 16)])
    add("£", 0.7, [[(0.58, 0.84), (0.5, 0.96), (0.38, 1.0), (0.27, 0.96), (0.21, 0.84), (0.21, 0.12), (0.12, 0.0),
                    (0.64, 0.0)], [(0.05, 0.5), (0.45, 0.5)]])
    # dotless i: the small letter i without its dot (the shortest stroke)
    i_strokes = sorted(g["i"]["s"], key=len)
    add("ı", g["i"]["w"], i_strokes[1:])
    return e


def encode(glyphs):
    out = {}
    for ch in sorted(glyphs):
        gl = glyphs[ch]
        out[ch] = {"w": round(gl["w"] * 1000),
                   "s": [[v for x, y in st for v in (round(x * 1000), round(y * 1000))] for st in gl["s"] if st]}
    return out


def main():
    g = parse_jhf(SRC)
    g.pop(chr(127), None)            # the last record is a filled block (DEL), not a character
    assert len(g) == 95, len(g)
    # In this data set the full stop / comma family sits 3 units above the baseline; move it down
    # so that "." rests on the baseline and the comma tail goes below it (like in handwriting).
    for ch in ",.;:":
        g[ch]["s"] = moved(g[ch]["s"], 0.0, -3 / UNIT)
    g.update(extras(g))
    xh = max(y for st in g["x"]["s"] for _, y in st)
    data = {"name": "Hershey Roman Simplex + extras", "notice": NOTICE, "scale": 1000,
            "xheight": round(xh, 3), "glyphs": encode(g)}
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")
    with open(OUT_JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* Generated by tools/build_fallback_font.py - do not edit.\n * " + NOTICE + " */\n")
        f.write("(function () { var F = " + text + ";\n"
                "if (typeof window !== 'undefined') window.FallbackFont = F;\n"
                "if (typeof module !== 'undefined' && module.exports) module.exports = F; })();\n")
    print("%d glyphs, x-height %.3f -> %s, %s" % (len(g), xh, os.path.relpath(OUT_JS, ROOT), os.path.relpath(OUT_JSON, ROOT)))


if __name__ == "__main__":
    main()
