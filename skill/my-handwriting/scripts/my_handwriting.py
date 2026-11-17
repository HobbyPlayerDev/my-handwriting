#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
my_handwriting.py - writes any text in your own handwriting (PDF, SVG, PNG).

The samples come from the capture page (index.html) as a JSON file ("Export").
Messages are English or German (automatic; force with --lang en|de or MY_HANDWRITING_LANG).

Commands
  render    text -> PDF / SVG / PNG in your handwriting
  info      what Claude needs to know first (file, languages, defaults, missing characters) as JSON
  check     check a sample file: coverage, missing characters, unusual samples
  sheet     overview sheet (PDF) with all samples
  install   install this skill for Claude Code (~/.claude/skills/my-handwriting) with your file
  package   ZIP of the skill (with your file) to upload in the Claude app

Examples
  python my_handwriting.py install --glyphs ~/Downloads/my-handwriting-glyphs-2026-11-17.json
  python my_handwriting.py info
  python my_handwriting.py render --text "Hello world" --out hello.pdf
  python my_handwriting.py render --input letter.md --markdown --paper lined --out letter.pdf
  python my_handwriting.py sheet --out overview.pdf

Special text
  [[3/4]]          a real fraction (numerator over denominator)
  [[pagebreak]]    a new page
  with --markdown: "# " heading, "## " smaller heading, "- " list, "1. " numbered list, "---" line
  Characters without samples are written in a neat standard handwriting (Hershey font, adapted
  to your size and slant); --no-font shows red boxes instead.

Only the Python standard library. PNG additionally needs Pillow (pip install pillow).
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import random
import re
import sys
import unicodedata
import zlib

VERSION = "1.0.0"
FORMAT = "my-handwriting-glyphs"
LEGACY_FORMATS = ("handschrift-glyphs",)       # name of the format before the project was renamed
SUPPORTED_FORMAT_VERSIONS = (1,)
HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(HERE)
SKILL_NAME = "my-handwriting"

# Must match js/charsets.js (checked by tests/py_test.py). (id, id, characters)
GROUPS = [
    ("upper", "upper", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ("lower", "lower", "abcdefghijklmnopqrstuvwxyz"),
    ("digits", "digits", "0123456789"),
    ("punct", "punct", ".,;:!?-–_'\"()[]"),
    ("math", "math", "+=<>%/\\|*×÷±°²³½¼¾√≈≠≤≥→"),
    ("special", "special", "&@#§$€~^{}"),
]
# Extra letters / quotation marks per writing language (complete per language).
LANG_GROUPS = {
    "en": "£“”‘’",
    "de": "ÄÖÜẞäöüß„“‚‘»«",
    "fr": "ÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸàâæçéèêëîïôœùûüÿ«»",
    "es": "ÁÉÍÑÓÚÜáéíñóúüªº¿¡«»",
    "it": "ÀÈÉÌÍÎÒÓÙÚàèéìíîòóùú«»",
    "pl": "ĄĆĘŁŃÓŚŹŻąćęłńóśźż„”«»",
}
LANG_ORDER = ("en", "de", "fr", "es", "it", "pl")
LANG_NAMES = {"en": "English", "de": "Deutsch", "fr": "Français", "es": "Español", "it": "Italiano", "pl": "Polski"}
CORE_GROUPS = ("upper", "lower", "digits", "punct")
GROUP_NAMES = {"upper": ("Großbuchstaben", "Capital letters"), "lower": ("Kleinbuchstaben", "Small letters"),
               "digits": ("Ziffern", "Digits"), "punct": ("Satzzeichen", "Punctuation"),
               "math": ("Mathe & Brüche", "Maths & fractions"), "special": ("Sonderzeichen", "Symbols")}


def _detect_lang():
    v = (os.environ.get("MY_HANDWRITING_LANG") or "").strip().lower()[:2]
    if v in ("de", "en"):
        return v
    for k in ("LC_ALL", "LC_MESSAGES", "LANG"):
        v = os.environ.get(k, "")
        if v and v not in ("C", "POSIX", "C.UTF-8"):
            return "de" if v.lower().startswith("de") else "en"
    if os.name == "nt":
        try:
            import ctypes
            return "de" if (ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF) == 0x07 else "en"
        except Exception:
            pass
    try:
        import locale
        loc = (locale.getlocale()[0] or "").lower()
        return "de" if loc.startswith(("de", "german")) else "en"
    except Exception:
        return "en"


LANG = _detect_lang()


def L(de, en):
    """Pick the message in the current language (German or English; English is the default)."""
    return de if LANG == "de" else en


def group_name(gid):
    if gid.startswith("lang-"):
        return L("Sonderbuchstaben ", "Special letters ") + LANG_NAMES.get(gid[5:], gid[5:])
    n = GROUP_NAMES.get(gid)
    return L(n[0], n[1]) if n else gid

DEFAULT_METRICS = {"scale": 1000, "cap": 1.0, "xheight": 0.6, "baseline": 0.0, "descender": -0.4,
                   "boxTop": 1.45, "boxBottom": -0.6, "boxWidth": 2.2, "penWidth": 0.05}

# Replacement rules for characters without samples (same as FB in js/render.js).
#   str              -> write these characters instead
#   ("t", s, f, dy)  -> character s, scaled by f, moved up by dy (units)
#   ("frac", a, b)   -> small stacked fraction
#   ("flip", s, dy)  -> character s turned upside down;  ("over", a, b) -> a and b on top of each other
FALLBACKS = {
    " ": " ", " ": " ", " ": " ", "\t": "    ",
    "’": "'", "‘": "'", "‛": "'", "´": "'", "`": "'", "′": "'", "ʼ": "'",
    "‚": ",",
    "”": "“", "“": "\"", "„": ",,", "‟": "\"", "″": "\"", "«": "\"", "»": "\"", "‹": "'", "›": "'",
    "—": "–", "–": "-", "‐": "-", "‑": "-", "‒": "-", "−": "-", "―": "–",
    "…": "...", "⋅": "·", "•": "·", "·": ("t", ".", 1.0, 0.28),
    "ẞ": "ß", "ß": "ss", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe",
    "⁄": "/", "∕": "/", "✕": "×", "×": "x", "÷": ":",
    "¹": ("t", "1", 0.6, 0.55), "²": ("t", "2", 0.6, 0.55), "³": ("t", "3", 0.6, 0.55),
    "⁰": ("t", "0", 0.6, 0.55), "⁴": ("t", "4", 0.6, 0.55), "⁵": ("t", "5", 0.6, 0.55),
    "⁶": ("t", "6", 0.6, 0.55), "⁷": ("t", "7", 0.6, 0.55), "⁸": ("t", "8", 0.6, 0.55),
    "⁹": ("t", "9", 0.6, 0.55), "⁺": ("t", "+", 0.6, 0.55), "⁻": ("t", "-", 0.6, 0.55),
    "₀": ("t", "0", 0.6, -0.2), "₁": ("t", "1", 0.6, -0.2), "₂": ("t", "2", 0.6, -0.2),
    "₃": ("t", "3", 0.6, -0.2), "₄": ("t", "4", 0.6, -0.2),
    "°": ("t", "o", 0.5, 0.62), "º": ("t", "o", 0.5, 0.62), "ª": ("t", "a", 0.5, 0.6),
    "½": ("frac", "1", "2"), "¼": ("frac", "1", "4"), "¾": ("frac", "3", "4"),
    "⅓": ("frac", "1", "3"), "⅔": ("frac", "2", "3"), "⅕": ("frac", "1", "5"),
    "⅛": ("frac", "1", "8"), "⅜": ("frac", "3", "8"), "⅝": ("frac", "5", "8"), "⅞": ("frac", "7", "8"),
    "≠": ("over", "=", "/"), "ł": ("slash", "l", 0), "Ł": ("slash", "L", 1), "ı": ("t", "l", 0.62, 0.0),
    "¿": ("flip", "?", 0.72), "¡": ("flip", "!", 0.72),
    "≤": "<=", "≥": ">=", "≈": "~", "→": "->", "⇒": "=>", "←": "<-",
    "€": "EUR", "™": "TM", "©": "(c)",
}
# Replacements that only approximate the character. If the standard-handwriting font has the real
# character, it is used instead (same list as APPROX in js/render.js).
APPROX = "€ß×÷≤≥≈→←«»–—"
INK_COLORS = {
    "blau": "#1d2f8f", "blue": "#1d2f8f", "königsblau": "#2340b8", "koenigsblau": "#2340b8",
    "schwarz": "#1b1b1f", "black": "#1b1b1f", "rot": "#b3261e", "red": "#b3261e",
    "grün": "#1e6b3a", "gruen": "#1e6b3a", "green": "#1e6b3a", "bleistift": "#5a5a5a", "pencil": "#5a5a5a",
    "royal": "#2340b8",
}
PAGE_SIZES = {"a4": (210.0, 297.0), "a5": (148.0, 210.0), "a3": (297.0, 420.0), "letter": (215.9, 279.4)}
FRACTION_RE = re.compile(r"\[\[([^\[\]/\n]+)/([^\[\]\n]+)\]\]")
PAGEBREAK_RE = re.compile(r"^\s*\[\[pagebreak\]\]\s*$", re.I)

BAND = 0.08           # band height for kerning (units)
RESAMPLE_STEP = 0.01
SIMPLIFY_EPS = 0.002  # units; at 5 mm writing = 0.01 mm - invisible


class HandwritingError(Exception):
    """Error with an understandable message for the user."""


def warn(msg):
    print(L("Hinweis: ", "Note: ") + msg, file=sys.stderr)


# --------------------------------------------------------------------------- #
#  Geometry helpers
# --------------------------------------------------------------------------- #
def resample(pts, step):
    if len(pts) < 2:
        return list(pts)
    out = [pts[0]]
    carry = 0.0
    for i in range(1, len(pts)):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg <= 1e-12:
            continue
        d = step - carry
        while d <= seg:
            t = d / seg
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
            d += step
        carry = seg - (d - step)
    if math.hypot(out[-1][0] - pts[-1][0], out[-1][1] - pts[-1][1]) > step * 0.25:
        out.append(pts[-1])
    else:
        out[-1] = pts[-1]
    return out


def smooth(pts, passes):
    if len(pts) < 3 or passes <= 0:
        return pts
    for _ in range(passes):
        nxt = [pts[0]]
        for i in range(1, len(pts) - 1):
            nxt.append((0.25 * pts[i - 1][0] + 0.5 * pts[i][0] + 0.25 * pts[i + 1][0],
                        0.25 * pts[i - 1][1] + 0.5 * pts[i][1] + 0.25 * pts[i + 1][1]))
        nxt.append(pts[-1])
        pts = nxt
    return pts


def simplify(pts, eps):
    """Ramer-Douglas-Peucker: drops points closer than eps to the line."""
    n = len(pts)
    if n < 3 or eps <= 0:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L < 1e-12:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, idx = d, i
        if best > eps and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def bbox_of(strokes):
    x0 = y0 = math.inf
    x1 = y1 = -math.inf
    for st in strokes:
        for x, y in st:
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
    if x0 == math.inf:
        return (0.0, 0.0, 0.0, 0.0)
    return (x0, x1, y0, y1)


def median(vals):
    v = sorted(vals)
    n = len(v)
    if not n:
        return 0.0
    return v[n // 2] if n % 2 else 0.5 * (v[n // 2 - 1] + v[n // 2])


# --------------------------------------------------------------------------- #
#  Loading data
# --------------------------------------------------------------------------- #
class Sample:
    __slots__ = ("char", "index", "sid", "strokes", "bbox", "suspect", "adj_scale", "adj_dy")

    def __init__(self, char, index, sid, strokes):
        self.char = char
        self.index = index
        self.sid = sid
        self.strokes = strokes
        self.bbox = bbox_of(strokes)
        self.suspect = []
        self.adj_scale = 1.0
        self.adj_dy = 0.0

    @property
    def w(self): return self.bbox[1] - self.bbox[0]

    @property
    def h(self): return self.bbox[3] - self.bbox[2]

    @property
    def cy(self): return 0.5 * (self.bbox[2] + self.bbox[3])


def suspect_reasons(samples):
    """Same heuristic as the capture page."""
    res = {}
    if len(samples) < 3:
        return res
    mh = median([s.h for s in samples])
    mw = median([s.w for s in samples])
    mcy = median([s.cy for s in samples])
    for s in samples:
        r = []
        if mh > 0.08 and (s.h > mh * 1.8 or s.h < mh * 0.55): r.append("height")
        if mw > 0.08 and (s.w > mw * 2.0 or s.w < mw * 0.45): r.append("width")
        if abs(s.cy - mcy) > 0.3: r.append("position")
        if r: res[id(s)] = r
    return res


class GlyphSet:
    def __init__(self, path, smooth_passes=2, consistency=0.6):
        self.path = path
        self.warnings = []
        self.samples = {}
        self.meta = {}
        self._load(path, smooth_passes)
        self._analyse(consistency)
        self.multi_keys = sorted([k for k in self.samples if len(k) > 1], key=len, reverse=True)
        self.xh_ratio = self._xheight_ratio()
        self.cap = self._cap_height()
        self.slant = self._slant()

    # ---- load & validate ----
    def _load(self, path, smooth_passes):
        if not path:
            raise HandwritingError(no_glyphs_message())
        if not os.path.isfile(path):
            raise HandwritingError(L("Proben-Datei nicht gefunden: %s", "Sample file not found: %s") % path
                                   + "\n" + no_glyphs_message())
        try:
            with open(path, "r", encoding="utf-8-sig") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as e:
            raise HandwritingError(L("Proben-Datei ist kein gültiges JSON (%s). Bitte neu exportieren.",
                                     "The sample file is not valid JSON (%s). Please export it again.") % e)
        except OSError as e:
            raise HandwritingError(L("Proben-Datei kann nicht gelesen werden: %s", "Cannot read the sample file: %s") % e)
        if not isinstance(data, dict) or not isinstance(data.get("glyphs"), dict):
            raise HandwritingError(L("Die Datei enthält keine Handschrift-Proben (Feld 'glyphs' fehlt).",
                                     "The file contains no handwriting samples (field 'glyphs' is missing)."))
        fmt = data.get("format", FORMAT)
        if fmt != FORMAT and fmt not in LEGACY_FORMATS:
            raise HandwritingError(L("Unbekanntes Dateiformat '%s' (erwartet '%s').",
                                     "Unknown file format '%s' (expected '%s').") % (fmt, FORMAT))
        ver = data.get("version", 1)
        if ver not in SUPPORTED_FORMAT_VERSIONS:
            raise HandwritingError(L("Format-Version %s wird nicht unterstützt (bekannt: %s). Bitte Programm aktualisieren.",
                                     "Format version %s is not supported (known: %s). Please update the program.")
                                   % (ver, ", ".join(map(str, SUPPORTED_FORMAT_VERSIONS))))
        metrics = dict(DEFAULT_METRICS)
        if isinstance(data.get("metrics"), dict):
            for k, v in data["metrics"].items():
                if isinstance(v, (int, float)) and math.isfinite(v):
                    metrics[k] = float(v)
        scale = metrics.get("scale") or 1000.0
        if scale <= 0:
            raise HandwritingError(L("Ungültiger Maßstab in der Datei (metrics.scale).", "Invalid scale in the file (metrics.scale)."))
        self.metrics = metrics
        self.meta = {"exported": data.get("exported"), "app": data.get("app"), "version": ver,
                     "settings": data.get("settings") if isinstance(data.get("settings"), dict) else {}}
        dropped = 0
        for raw_key, arr in data["glyphs"].items():
            if not isinstance(raw_key, str) or not raw_key:
                continue
            key = unicodedata.normalize("NFC", raw_key)
            if not isinstance(arr, list):
                dropped += 1
                continue
            for s in arr:
                strokes = self._parse_strokes(s, scale, smooth_passes)
                if not strokes:
                    dropped += 1
                    continue
                lst = self.samples.setdefault(key, [])
                sid = str(s.get("id", "")) if isinstance(s, dict) else ""
                lst.append(Sample(key, len(lst) + 1, sid, strokes))
        if dropped:
            self.warnings.append(L("%d beschädigte/leere Proben wurden übersprungen.", "%d damaged/empty samples were skipped.") % dropped)
        if not self.samples:
            raise HandwritingError(L("Die Datei enthält keine verwertbaren Proben.", "The file contains no usable samples."))

    @staticmethod
    def _parse_strokes(s, scale, smooth_passes):
        if not isinstance(s, dict) or not isinstance(s.get("strokes"), list):
            return None
        result = []
        for st in s["strokes"]:
            if not isinstance(st, list) or not st:
                continue
            pts = []
            try:
                if isinstance(st[0], (list, tuple)):
                    for p in st:
                        x, y = float(p[0]), float(p[1])
                        pts.append((x, y))
                else:
                    if len(st) % 2:
                        st = st[:-1]
                    for i in range(0, len(st), 2):
                        pts.append((float(st[i]), float(st[i + 1])))
            except (TypeError, ValueError, IndexError):
                continue
            if not pts or not all(math.isfinite(x) and math.isfinite(y) for x, y in pts):
                continue
            pts = [(x / scale, y / scale) for x, y in pts]
            # drop duplicate points
            clean = [pts[0]]
            for p in pts[1:]:
                if abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
                    clean.append(p)
            if len(clean) >= 2:
                clean = simplify(smooth(resample(clean, RESAMPLE_STEP), smooth_passes), SIMPLIFY_EPS)
            result.append(clean)
        return result or None

    # ---- analysis ----
    def _analyse(self, consistency):
        c = max(0.0, min(1.0, consistency))
        for key, lst in self.samples.items():
            sus = suspect_reasons(lst)
            for s in lst:
                s.suspect = sus.get(id(s), [])
            good = [s for s in lst if not s.suspect] or lst
            if len(good) < 3 or c <= 0:
                continue
            mh = median([s.h for s in good])
            mcy = median([s.cy for s in good])
            for s in lst:
                if mh > 0.08 and s.h > 1e-6:
                    s.adj_scale = max(0.8, min(1.25, 1.0 + c * (mh / s.h - 1.0)))
                s.adj_dy = max(-0.15, min(0.15, c * (mcy - s.cy)))

    def _xheight_ratio(self):
        lows = [s.bbox[3] for ch in "xoacenmuvwzrs" for s in self.samples.get(ch, [])]
        caps = [s.bbox[3] for ch in "HEIXONMTLKZ" for s in self.samples.get(ch, [])]
        if lows and caps and median(caps) > 0.2:
            return max(0.45, min(0.8, median(lows) / median(caps)))
        return 0.62

    def _cap_height(self):
        caps = [s.bbox[3] for ch in "HEIXONMTLKZ" for s in self.samples.get(ch, [])]
        return max(0.6, min(1.5, median(caps))) if caps else 1.0

    def _slant(self):
        """Slant of the handwriting from long, nearly vertical strokes (used for the standard font)."""
        sl = []
        for ch in "lIi1tdhkbLHN|":
            for smp in self.samples.get(ch, []):
                st = max(smp.strokes, key=len)
                if len(st) < 2:
                    continue
                dy = st[-1][1] - st[0][1]
                if abs(dy) > 0.4:
                    r = (st[-1][0] - st[0][0]) / dy
                    if abs(r) < 0.6:
                        sl.append(r)
        return max(-0.35, min(0.35, median(sl))) if len(sl) >= 3 else 0.0

    def usable(self, key):
        lst = self.samples.get(key)
        if not lst:
            return None
        good = [s for s in lst if not s.suspect]
        return good if len(good) >= 2 else lst

    def has(self, key):
        return key in self.samples

    def total(self):
        return sum(len(v) for v in self.samples.values())


class FontSet:
    """Standard-handwriting font for characters without samples (fallback_font.json, built by
    tools/build_fallback_font.py from the Hershey Roman Simplex font)."""

    def __init__(self, path=None):
        path = path or os.path.join(HERE, "fallback_font.json")
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        sc = float(data.get("scale") or 1000)
        self.xh = float(data.get("xheight") or 0.667)
        self.glyphs = {}
        for ch, g in data.get("glyphs", {}).items():
            strokes = []
            for st in g.get("s", []):
                pts = [(st[i] / sc, st[i + 1] / sc) for i in range(0, len(st) - 1, 2)]
                if len(pts) >= 2:
                    pts = smooth(resample(pts, RESAMPLE_STEP), 1)
                if pts:
                    strokes.append(pts)
            if strokes:
                self.glyphs[ch] = strokes

    def has(self, ch):
        return ch in self.glyphs


_FONT = None


def load_font():
    global _FONT
    if _FONT is None:
        try:
            _FONT = FontSet()
        except (OSError, ValueError) as e:
            warn(L("Standard-Handschrift nicht ladbar (%s) – fehlende Zeichen werden markiert.",
                   "Standard handwriting could not be loaded (%s) - missing characters are marked.") % e)
            _FONT = False
    return _FONT or None


# --------------------------------------------------------------------------- #
#  Boxes (placed characters)
# --------------------------------------------------------------------------- #
class Box:
    """A placed character/element. x runs from 0 to w, y relative to the baseline."""
    __slots__ = ("ink", "marks", "w", "ymin", "ymax", "_prof")

    def __init__(self, ink, marks=None):
        marks = marks or []
        x0, x1, y0, y1 = bbox_of(ink + marks)
        self.ink = [[(x - x0, y) for x, y in st] for st in ink]
        self.marks = [[(x - x0, y) for x, y in st] for st in marks]
        self.w = max(0.0, x1 - x0)
        self.ymin, self.ymax = y0, y1
        self._prof = None

    def profiles(self):
        if self._prof is None:
            left, right = {}, {}
            for st in self.ink + self.marks:
                for x, y in st:
                    b = int(math.floor(y / BAND))
                    if x < left.get(b, math.inf): left[b] = x
                    if x > right.get(b, -math.inf): right[b] = x
            self._prof = (left, right)
        return self._prof

    @classmethod
    def spacer(cls, w):
        b = cls([], [])
        b.w = max(0.0, w)
        return b

    def transformed(self, sx, sy, dy):
        f = lambda st: [(x * sx, y * sy + dy) for x, y in st]
        return Box([f(s) for s in self.ink], [f(s) for s in self.marks])


def kern_offset(a, b, gap, kern_strength):
    """Distance from the origin of a to the origin of b (optical kerning)."""
    base = a.w + gap
    if kern_strength <= 0 or not a.ink or not b.ink:
        return base
    la, ra = a.profiles()
    lb, rb = b.profiles()
    req = -math.inf
    for band, rx in ra.items():
        for nb, g in ((band, gap), (band - 1, gap * 0.7), (band + 1, gap * 0.7)):
            lx = lb.get(nb)
            if lx is not None:
                v = rx - lx + g
                if v > req:
                    req = v
    limit = base - 0.22 * kern_strength
    return max(req, limit) if req > -math.inf else limit


def gauss(rng, sigma, clip=2.5):
    return max(-clip, min(clip, rng.gauss(0.0, 1.0))) * sigma


# --------------------------------------------------------------------------- #
#  Typesetter
# --------------------------------------------------------------------------- #
class Typesetter:
    def __init__(self, gs, rng, variation=1.0, tracking=0.15, word_space=0.55, kerning=1.0, font=None):
        self.gs = gs
        self.font = font
        self.font_chars = {}
        self.rng = rng
        self.var = max(0.0, variation)
        self.tracking = tracking
        self.word_space = word_space
        self.kerning = kerning
        self.recent = {}
        self.used_fallbacks = {}
        self.missing = {}
        self._plan_cache = {}

    # ---- planning: how is each character written? ----
    # Pass 1 uses only the writer's own samples (directly or composed: accents, fractions, ł ...).
    # If that leaves anything missing and the standard-handwriting font is available, pass 2 takes
    # the font's own character, or composes from own + font parts (same as TS.plan in js/render.js).
    def plan(self, ch, depth=0, own=None):
        if depth == 0 and own is None:
            top = ("top", ch)
            if top not in self._plan_cache:
                keep = dict(self.used_fallbacks)
                p = self.plan(ch, 0, True)
                if self.font and _has_missing(p):
                    self.used_fallbacks = keep
                    p = ("f", ch) if self.font.has(ch) else self.plan(ch, 0, False)
                    if p[0] == "f":
                        self.used_fallbacks[ch] = L("Standard-Handschrift", "standard handwriting")
                if _uses_font(p):
                    self.font_chars[ch] = 1
                self._plan_cache[top] = p
            return self._plan_cache[top]
        key = (ch, depth, bool(own))
        if key not in self._plan_cache:
            self._plan_cache[key] = self._plan(ch, depth, bool(own))
        return self._plan_cache[key]

    def _plan(self, ch, depth, own):
        gs = self.gs
        if gs.has(ch):
            return ("g", ch)
        if depth > 5:
            return ("missing", ch)
        font = self.font
        if not own and font and depth > 0 and font.has(ch):
            return ("f", ch)
        sub = lambda c: self.plan(c, depth + 1, own)
        fb = FALLBACKS.get(ch)
        # with the font available, an approximation (EUR for the euro sign) is worse than the real character
        if fb is not None and not (font and ch in APPROX and font.has(ch)):
            if isinstance(fb, str):
                parts = [sub(c) for c in fb]
                if fb.strip() == "" or all(p[0] != "missing" for p in parts):
                    self.used_fallbacks[ch] = fb if fb.strip() else L("Leerzeichen", "space")
                    return ("space", len(fb)) if fb.strip() == "" else (parts[0] if len(parts) == 1 else ("seq", parts))
            elif fb[0] == "t":
                sp = sub(fb[1])
                if sp[0] != "missing":
                    self.used_fallbacks[ch] = L("%s (klein/versetzt)", "%s (small/shifted)") % fb[1]
                    return ("t", sp, fb[2], fb[3])
            elif fb[0] == "flip":
                fl = sub(fb[1])
                if fl[0] != "missing":
                    self.used_fallbacks[ch] = L("%s (gedreht)", "%s (rotated)") % fb[1]
                    return ("flip", fl, fb[2])
            elif fb[0] == "frac":
                if all(sub(c)[0] != "missing" for c in fb[1] + fb[2]):
                    self.used_fallbacks[ch] = L("Bruch %s/%s", "fraction %s/%s") % (fb[1], fb[2])
                    return ("frac", fb[1], fb[2], 0.5)
            elif fb[0] == "over":
                a, b = sub(fb[1]), sub(fb[2])
                if a[0] != "missing" and b[0] != "missing":
                    self.used_fallbacks[ch] = L("%s mit %s überlagert", "%s overlaid with %s") % (fb[1], fb[2])
                    return ("over", a, b)
            elif fb[0] == "slash":
                sl = sub(fb[1])
                if sl[0] != "missing":
                    self.used_fallbacks[ch] = fb[1] + " + /"
                    return ("slash", sl, fb[2])
        # letters with accents: base letter + mark
        d = unicodedata.normalize("NFD", ch)
        if len(d) > 1 and d[0] != ch:
            base = sub(d[0])
            if base[0] != "missing":
                marks = [m for m in d[1:] if unicodedata.combining(m)]
                self.used_fallbacks[ch] = d[0] + L(" + Akzent", " + accent")
                return ("accent", base, marks)
        if not own and font and font.has(ch):
            return ("f", ch)
        # a scaled capital for a small letter (or the other way round) - only without the font
        if not font and ch.isalpha() and len(ch) == 1:
            if ch.islower() and len(ch.upper()) == 1 and gs.has(ch.upper()):
                self.used_fallbacks[ch] = ch.upper() + L(" (verkleinert)", " (scaled down)")
                return ("t", ("g", ch.upper()), gs.xh_ratio, 0.0)
            if ch.isupper() and len(ch.lower()) == 1 and gs.has(ch.lower()):
                self.used_fallbacks[ch] = ch.lower() + L(" (vergrößert)", " (scaled up)")
                return ("t", ("g", ch.lower()), min(1.6, 1.0 / gs.xh_ratio), 0.0)
        return ("missing", ch)

    # ---- building boxes ----
    def pick(self, key):
        lst = self.gs.usable(key)
        recent = self.recent.setdefault(key, [])
        avoid = min(len(lst) - 1, 2)
        choices = [s for s in lst if s not in recent[-avoid:]] if avoid > 0 else lst
        s = self.rng.choice(choices or lst)
        recent.append(s)
        if len(recent) > 4:
            del recent[0]
        return s

    def glyph_box(self, key):
        s = self.pick(key)
        x0, x1, y0, y1 = s.bbox
        cx, cy = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
        a, dya = s.adj_scale, s.adj_dy
        v = self.var
        sc = 1.0 + gauss(self.rng, 0.03 * v)
        rot = math.radians(gauss(self.rng, 1.3 * v))
        dy = gauss(self.rng, 0.014 * v)
        cr, sr = math.cos(rot), math.sin(rot)
        rcy = 0.45
        out = []
        for st in s.strokes:
            nst = []
            for x, y in st:
                x = cx + (x - cx) * a
                y = cy + (y - cy) * a + dya
                x = cx + (x - cx) * sc
                y = y * sc
                xr, yr = x - cx, y - rcy
                x = cx + xr * cr - yr * sr
                y = rcy + xr * sr + yr * cr + dy
                nst.append((x, y))
            out.append(nst)
        return Box(out)

    def font_box(self, ch):
        """A character from the standard-handwriting font, fitted to this handwriting (size,
        x-height, slant) and varied like a real sample so that it does not look printed."""
        gs, v, rng = self.gs, self.var, self.rng
        k = gs.cap
        if ch.islower():
            k *= max(0.8, min(1.08, gs.xh_ratio / self.font.xh))
        sc = 1.0 + gauss(rng, 0.03 * v)
        rot = math.radians(gauss(rng, 1.2 * v))
        dy = gauss(rng, 0.012 * v)
        cr, sr = math.cos(rot), math.sin(rot)
        sl, amp, ph, rcy = gs.slant, 0.007 * v, rng.uniform(0, 6.28), 0.45
        out = []
        for st in self.font.glyphs[ch]:
            nst = []
            for px, py in st:
                y = py * k * sc
                x = px * k * sc + sl * y
                x += amp * math.sin(ph + y * 9)
                y += amp * math.sin(ph * 1.3 + x * 9)
                yr = y - rcy
                nst.append((x * cr - yr * sr, rcy + x * sr + yr * cr + dy))
            out.append(nst)
        return Box(out)

    def missing_box(self, ch):
        self.missing[ch] = self.missing.get(ch, 0) + 1
        corners = [(0, 0), (0.45, 0), (0.45, 0.7), (0, 0.7), (0, 0)]
        r = []
        for (x0, y0), (x1, y1) in zip(corners, corners[1:]):   # sample densely so the corners stay sharp
            r += [(x0 + (x1 - x0) * t / 8, y0 + (y1 - y0) * t / 8) for t in range(8)]
        r.append(corners[-1])
        return Box([], [r])

    def box_for(self, plan):
        kind = plan[0]
        if kind == "g":
            return self.glyph_box(plan[1])
        if kind == "f":
            return self.font_box(plan[1])
        if kind == "missing":
            return self.missing_box(plan[1])
        if kind == "seq":
            return self.join([self.box_for(p) for p in plan[1]])
        if kind == "t":
            return self.box_for(plan[1]).transformed(plan[2], plan[2], plan[3])
        if kind == "flip":
            return self.box_for(plan[1]).transformed(-1.0, -1.0, plan[2])
        if kind == "frac":
            return self.fraction_box(plan[1], plan[2], plan[3] if len(plan) > 3 else 0.62)
        if kind == "accent":
            return self.accent_box(self.box_for(plan[1]), plan[2])
        if kind == "over":
            a, b = self.box_for(plan[1]), self.box_for(plan[2])
            W = max(a.w, b.w)
            ink = [[(x + (W - a.w) / 2, y) for x, y in st] for st in a.ink]
            ink += [[(x + (W - b.w) / 2, y) for x, y in st] for st in b.ink]
            return Box(ink, a.marks + b.marks)
        if kind == "slash":
            return self.slash_box(self.box_for(plan[1]), plan[2])
        if kind == "space":
            return Box.spacer(self.word_space * plan[1])
        raise ValueError(kind)

    def join(self, boxes, gap=None):
        """Join several boxes into one (with kerning)."""
        if not boxes:
            return Box([], [])
        gap = self.tracking if gap is None else gap
        ink, marks, x = [], [], 0.0
        prev = None
        for b in boxes:
            if prev is not None:
                x += kern_offset(prev, b, gap, self.kerning)
            ink += [[(px + x, py) for px, py in st] for st in b.ink]
            marks += [[(px + x, py) for px, py in st] for st in b.marks]
            prev = b
        return Box(ink, marks)

    def text_boxes(self, text, scale=1.0):
        boxes = []
        for ch in text:
            if ch == " ":
                boxes.append(Box.spacer(self.word_space * 0.6 * scale))
                continue
            b = self.box_for(self.plan(ch))
            boxes.append(b.transformed(scale, scale, 0.0) if scale != 1.0 else b)
        return boxes

    def fraction_box(self, num, den, scale=0.62):
        nb = self.join(self.text_boxes(num.strip(), scale), self.tracking * scale)
        db = self.join(self.text_boxes(den.strip(), scale), self.tracking * scale)
        bar_y = 0.46 + gauss(self.rng, 0.01 * self.var)
        pad = 0.07
        W = max(nb.w, db.w) + 2 * pad
        ink, marks = [], []
        for b, dy in ((nb, bar_y + 0.09 - nb.ymin), (db, bar_y - 0.09 - db.ymax)):
            ox = (W - b.w) / 2
            ink += [[(x + ox, y + dy) for x, y in st] for st in b.ink]
            marks += [[(x + ox, y + dy) for x, y in st] for st in b.marks]
        ink.append(self.bar_stroke(W, bar_y))
        return Box(ink, marks)

    def bar_stroke(self, width, y):
        """Fraction bar / rule - stretched from the writer's own hyphen if possible."""
        lst = self.gs.usable("-") or self.gs.usable("–")
        if lst:
            s = self.rng.choice(lst)
            pts = max(s.strokes, key=len)
            x0, x1, y0, y1 = bbox_of([pts])
            if x1 - x0 > 0.05:
                cy = 0.5 * (y0 + y1)
                return [((x - x0) / (x1 - x0) * width, y + (yy - cy) * 0.5) for x, yy in pts]
        n = max(4, int(width / 0.05))
        ph = self.rng.random() * 6.28
        return [(width * i / n, y + 0.008 * math.sin(ph + i * 0.9)) for i in range(n + 1)]

    def accent_box(self, base, marks):
        ink = [list(st) for st in base.ink]
        cx = base.w / 2
        top = base.ymax + 0.12
        r = self.rng
        j = lambda s: gauss(r, s * self.var)
        for m in marks:
            code = ord(m)
            if code == 0x308:   # diaeresis dots
                dx = max(0.09, min(0.15, base.w * 0.22))
                for sx in (-1, 1):
                    ink.append([(cx + sx * dx + j(0.01), top + 0.02 + j(0.01))])
            elif code in (0x301, 0x300):   # acute / grave
                d = 1 if code == 0x301 else -1
                ink.append([(cx - 0.05 * d + j(0.01), top), (cx + 0.06 * d + j(0.01), top + 0.13)])
            elif code == 0x302:   # circumflex
                ink.append([(cx - 0.09, top), (cx, top + 0.12 + j(0.01)), (cx + 0.09, top)])
            elif code == 0x303:   # tilde
                ink.append([(cx - 0.11 + i * 0.022, top + 0.04 + 0.035 * math.sin(i * 0.63)) for i in range(11)])
            elif code == 0x30A:   # ring
                ink.append([(cx + 0.055 * math.cos(t * 0.5), top + 0.06 + 0.055 * math.sin(t * 0.5)) for t in range(14)])
            elif code == 0x327:   # cedilla
                ink.append([(cx, 0.0), (cx + 0.03, -0.07), (cx - 0.04, -0.12)])
            elif code == 0x30C:   # caron
                ink.append([(cx - 0.08, top + 0.12), (cx, top), (cx + 0.08, top + 0.12)])
            elif code == 0x304:   # macron
                ink.append([(cx - 0.09, top + 0.04), (cx + 0.09, top + 0.04)])
            elif code == 0x306:   # breve
                ink.append([(cx - 0.08 + i * 0.02, top + 0.09 - 0.07 * math.sin(i / 8 * math.pi)) for i in range(9)])
            elif code == 0x328:   # Ogonek (ą ę)
                ink.append([(base.w * 0.8, 0.0), (base.w * 0.72, -0.08), (base.w * 0.85, -0.13)])
            elif code == 0x307:   # dot above (ż, İ)
                ink.append([(cx + j(0.01), top + 0.03)])
            else:
                ink.append([(cx, top + 0.03)])
        return Box(ink, [list(st) for st in base.marks])

    def slash_box(self, base, left):
        """ł Ł: short slanted stroke through the stem (left stem for Ł, middle for ł)."""
        xs = [x for st in base.ink for x, y in st if 0.2 < y < 0.6]
        cx = (min(xs) if xs else 0.1) if left else base.w / 2
        j = gauss(self.rng, 0.01 * self.var)
        ink = [list(st) for st in base.ink] + [[(cx - 0.13, 0.3 + j), (cx + 0.14, 0.56 + j)]]
        return Box(ink, [list(st) for st in base.marks])

    # ---- split text into words ----
    def tokenize_line(self, line):
        """-> list of ('space', n) or ('word', [plan, ...])"""
        items = []
        pos = 0
        for m in FRACTION_RE.finditer(line):
            items += self._chars_to_items(line[pos:m.start()])
            items.append(("frac", m.group(1), m.group(2), 0.62))
            pos = m.end()
        items += self._chars_to_items(line[pos:])
        tokens, word = [], []
        for it in items:
            if it[0] == "space":
                if word:
                    tokens.append(("word", word))
                    word = []
                if tokens and tokens[-1][0] == "space":
                    tokens[-1] = ("space", tokens[-1][1] + it[1])
                else:
                    tokens.append(it)
            else:
                word.append(it)
        if word:
            tokens.append(("word", word))
        return tokens

    def _chars_to_items(self, s):
        out = []
        i = 0
        while i < len(s):
            hit = None
            for k in self.gs.multi_keys:
                if s.startswith(k, i):
                    hit = k
                    break
            if hit:
                out.append(("g", hit))
                i += len(hit)
                continue
            ch = s[i]
            i += 1
            if ch == " ":
                out.append(("space", 1))
                continue
            if unicodedata.category(ch) in ("Cc", "Cf") and ch != "\t":
                continue
            p = self.plan(ch)
            if p[0] == "space":
                out.append(("space", p[1]))
            else:
                out.append(p)
        return out

    def word_box(self, plans):
        return [self.box_for(p) for p in plans]

    def space_width(self, n):
        return n * self.word_space * (1.0 + gauss(self.rng, 0.06 * self.var, 2.0))

    def gap(self):
        return max(0.03, self.tracking * (1.0 + gauss(self.rng, 0.22 * self.var)))


def _has_missing(p):
    if not isinstance(p, tuple) or not p:
        return False
    if p[0] == "missing":
        return True
    return any(isinstance(x, tuple) and _has_missing(x) for x in p[1:]) or \
        any(isinstance(x, list) and any(_has_missing(y) for y in x) for x in p[1:])


def _uses_font(p):
    if not isinstance(p, tuple) or not p:
        return False
    if p[0] == "f":
        return True
    return any(isinstance(x, tuple) and _uses_font(x) for x in p[1:]) or \
        any(isinstance(x, list) and any(_uses_font(y) for y in x) for x in p[1:])


def parse_block(raw, md):
    """One source line -> block description (same as parseBlock in js/render.js)."""
    if PAGEBREAK_RE.match(raw) or raw == "\f":
        return {"pagebreak": True}
    b = {"text": raw, "scale": 1.0, "indent": 0.0, "bullet": None, "underline": False, "rule": False}
    if not md:
        return b

    def lead(sp):
        return min(3, len(sp.replace("\t", "  ")) // 2)
    if re.match(r"^\s*([-*_])(\s*\1){2,}\s*$", raw):
        b["rule"], b["text"] = True, ""
        return b
    m = re.match(r"^(#{1,3})\s+(.*)$", raw)
    if m:
        lv = len(m.group(1))
        b["text"] = re.sub(r"\s+#+\s*$", "", m.group(2))
        b["scale"] = (1.55, 1.3, 1.12)[lv - 1]
        b["underline"] = lv == 1
    else:
        m = re.match(r"^(\s*)[-*+•]\s+(.*)$", raw)
        if m:
            b["text"], b["indent"], b["bullet"] = m.group(2), 1.3 + 1.3 * lead(m.group(1)), "-"
        else:
            m = re.match(r"^(\s*)(\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$", raw)
            if m:
                b["text"], b["indent"], b["bullet"] = m.group(3), 1.7 + 1.3 * lead(m.group(1)), m.group(2)
            else:
                m = re.match(r"^>\s?(.*)$", raw)
                if m:
                    b["text"], b["indent"] = m.group(1), 1.3
    # emphasis markers and code ticks are not drawn (handwriting has no bold face)
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", b["text"])
    t = re.sub(r"__(.+?)__", r"\1", t)
    b["text"] = re.sub(r"`([^`\n]+)`", r"\1", t)
    return b


class Line:
    __slots__ = ("items", "pagebreak", "underline", "rule")

    def __init__(self, items=None, pagebreak=False, underline=False, rule=False):
        self.items, self.pagebreak, self.underline, self.rule = items or [], pagebreak, underline, rule


def layout(text, ts, max_w, md=False):
    """Set the text in lines. Result: list of Line objects; items are (box, x)."""
    lines = []
    for raw in text.split("\n"):
        blk = parse_block(raw, md)
        if blk.get("pagebreak"):
            lines.append(Line(pagebreak=True))
            continue
        if blk["rule"]:
            lines.append(Line(rule=True))
            continue
        sc, ind = blk["scale"], blk["indent"]
        line = Line(underline=blk["underline"])
        x, placed = ind, False
        if blk["bullet"]:
            bb = ts.join(ts.text_boxes(blk["bullet"]))
            line.items.append((bb, max(0.0, ind - bb.w - 0.45)))
        for tok in ts.tokenize_line(blk["text"]):
            if tok[0] == "space":
                x += ts.space_width(tok[1]) * sc   # indentation at the start of a line is kept
                continue
            boxes = [ts.box_for(p) for p in tok[1]]
            if sc != 1.0:
                boxes = [b.transformed(sc, sc, 0.0) for b in boxes]
            rel, cx, prev = [], 0.0, None
            for b in boxes:
                if prev is not None:
                    cx += kern_offset(prev, b, ts.gap() * sc, ts.kerning)
                rel.append(cx)
                prev = b
            wlen = (rel[-1] + boxes[-1].w) if boxes else 0.0
            if placed and x + wlen > max_w:
                lines.append(line)
                line, x, placed = Line(underline=blk["underline"]), ind, False
            if wlen > max_w - ind:
                # word longer than the line: hard break
                start = rel[0] if rel else 0.0
                for b, r in zip(boxes, rel):
                    if placed and x + (r - start) + b.w > max_w:
                        lines.append(line)
                        line, x, start, placed = Line(underline=blk["underline"]), ind, r, False
                    line.items.append((b, x + (r - start)))
                    placed = True
                x = x + (rel[-1] - start) + boxes[-1].w
                continue
            for b, r in zip(boxes, rel):
                line.items.append((b, x + r))
            x += wlen
            placed = True
        lines.append(line)
    # drop empty lines at the end
    while len(lines) > 1 and not lines[-1].items and not lines[-1].rule and not lines[-1].pagebreak:
        lines.pop()
    return lines


# --------------------------------------------------------------------------- #
#  Building pages
# --------------------------------------------------------------------------- #
class Page:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.ink = []       # strokes in mm, y down
        self.marks = []     # red marks (missing characters)
        self.rules = []     # paper lines: (x0, y0, x1, y1, kind)


def parse_color(c):
    c = (c or "blue").strip().lower()
    c = INK_COLORS.get(c, c)
    m = re.fullmatch(r"#?([0-9a-f]{6}|[0-9a-f]{3})", c)
    if not m:
        raise HandwritingError(L("Unbekannte Farbe '%s'. Erlaubt: %s oder #RRGGBB.", "Unknown colour '%s'. Allowed: %s or #RRGGBB.")
                               % (c, ", ".join(sorted(set(INK_COLORS)))))
    h = m.group(1)
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return "#" + h


def build_pages(text, gs, opt):
    rng = random.Random(opt.seed)
    font = load_font() if getattr(opt, "font", True) else None
    ts = Typesetter(gs, rng, opt.variation, opt.tracking, opt.word_space, opt.kerning, font)
    size = opt.size
    if opt.page == "auto":
        pw, ph = opt.width, None
    else:
        pw, ph = PAGE_SIZES[opt.page]
        if opt.landscape:
            pw, ph = ph, pw
    ml = opt.margin_left if opt.margin_left is not None else opt.margin
    mr = opt.margin
    mt = mb = opt.margin
    content_w = pw - ml - mr
    if content_w < size * 3:
        raise HandwritingError(L("Seite zu schmal für diese Schriftgröße (Ränder/Breite prüfen).",
                                 "Page too narrow for this size (check margins/width)."))
    max_w = content_w / size - 0.15
    line_h = opt.line_spacing if opt.line_spacing else opt.line_height * size
    first = mt + size * 1.3
    grid = 5.0
    if opt.paper == "grid":
        line_h = max(grid, round(line_h / grid) * grid)
        first = math.ceil(first / grid) * grid
    if line_h < size * 1.2:
        warn(L("Zeilenabstand ist sehr klein – Zeilen könnten sich überlappen.", "Line spacing is very small - lines may overlap."))

    lines = layout(text, ts, max_w, getattr(opt, "markdown", False))
    per_page = math.inf if ph is None else max(1, int((ph - mb - size * 0.55 - first) // line_h) + 1)
    chunks = [[]]
    for ln in lines:
        if ln.pagebreak:
            chunks.append([])
            continue
        if len(chunks[-1]) >= per_page:
            chunks.append([])
        chunks[-1].append(ln)
    if ph is None:
        most = max(1, max(len(c) for c in chunks))
        ph = first + (most - 1) * line_h + size * 0.7 + mb

    pages = []
    for chunk in chunks:
        pg = Page(pw, ph)
        pages.append(pg)
        add_paper(pg, opt, first, line_h, ml, mr, grid)
        for li, line in enumerate(chunk):
            base = first + li * line_h
            if not line.items and not line.rule:
                continue
            v = opt.variation
            slope = math.tan(math.radians(gauss(rng, 0.3 * v)))
            amp = 0.02 * v
            period = rng.uniform(7.0, 13.0)
            phase = rng.uniform(0, 2 * math.pi)
            x_start = gauss(rng, 0.04 * v)
            items = list(line.items)
            if line.rule:
                items.append((Box([ts.bar_stroke(max_w * 0.98, 0.3)]), 0.0))
            line_w = max(x + b.w for b, x in items) if items else 0.0
            if line.underline and line_w > 0:
                items.append((Box([ts.bar_stroke(line_w, -0.16)]), 0.0))
            shift = 0.0
            if not line.rule and opt.align == "center":
                shift = (max_w - line_w) / 2
            elif not line.rule and opt.align == "right":
                shift = max_w - line_w
            ox = ml + (shift + x_start) * size

            def tf(st, x):
                out = []
                for px, py in st:
                    u = x + px
                    yy = py + u * slope + amp * math.sin(phase + u * 2 * math.pi / period)
                    out.append((ox + u * size, base - yy * size))
                return out
            for b, x in items:
                pg.ink += [tf(st, x) for st in b.ink]
                pg.marks += [tf(st, x) for st in b.marks]
    return pages, ts, sum(1 for ln in lines if not ln.pagebreak)


def add_paper(pg, opt, first, line_h, ml, mr, grid):
    if opt.paper == "lined":
        y = first
        while y < pg.h - 4:
            pg.rules.append((ml - 2, y, pg.w - mr + 2, y, "line"))
            y += line_h
    elif opt.paper == "grid":
        x = 0.0
        while x <= pg.w + 1e-6:
            pg.rules.append((x, 0, x, pg.h, "grid"))
            x += grid
        y = 0.0
        while y <= pg.h + 1e-6:
            pg.rules.append((0, y, pg.w, y, "grid"))
            y += grid


# --------------------------------------------------------------------------- #
#  Output: PDF (vector, no extra packages)
# --------------------------------------------------------------------------- #
PT = 72.0 / 25.4


def _f(v):
    s = "%.2f" % v
    return s.rstrip("0").rstrip(".") if "." in s else s


def pdf_path(strokes, H):
    """Strokes as a PDF path (polylines; the points are already smooth and dense enough)."""
    out = []
    for st in strokes:
        if not st:
            continue
        P = [(x * PT, (H - y) * PT) for x, y in st]
        x, y = P[0]
        out.append("%s %s m" % (_f(x), _f(y)))
        if len(P) == 1:
            out.append("%s %s l" % (_f(x + 0.01), _f(y)))
            continue
        out.append(" ".join("%s %s l" % (_f(px), _f(py)) for px, py in P[1:]))
    return "\n".join(out)


def _rgb(hexcol):
    h = hexcol.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def pdf_text(x, y, size, text):
    """Text in Helvetica (WinAnsi). Characters it cannot show become U+XXXX."""
    try:
        data = text.encode("cp1252")
    except UnicodeEncodeError:
        data = "".join(c if c.encode("cp1252", "ignore") else "U+%04X" % ord(c) for c in text).encode("cp1252", "replace")
    return "BT /F1 %s Tf %s %s Td <%s> Tj ET" % (_f(size), _f(x * PT), _f(y * PT), data.hex())


class PdfWriter:
    def __init__(self):
        self.pages = []   # (w_mm, h_mm, content_str, uses_font)

    def add_page(self, w, h, content, uses_font=False):
        self.pages.append((w, h, content, uses_font))

    def save(self, path):
        objs = {}
        n_pages = len(self.pages)
        font_id = 3
        next_id = 4
        page_ids = []
        for (w, h, content, uses_font) in self.pages:
            pid, cid = next_id, next_id + 1
            next_id += 2
            page_ids.append(pid)
            stream = zlib.compress(content.encode("latin-1"), 6)
            objs[cid] = b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream) + stream + b"\nendstream"
            res = "<< /Font << /F1 %d 0 R >> >>" % font_id if uses_font else "<< >>"
            objs[pid] = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources %s /Contents %d 0 R >>"
                         % (_f(w * PT), _f(h * PT), res, cid)).encode("ascii")
        objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
        objs[2] = ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % p for p in page_ids), n_pages)).encode("ascii")
        objs[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
        info_id = next_id
        now = _dt.datetime.now().strftime("%Y%m%d%H%M%S")
        objs[info_id] = ("<< /Producer (my_handwriting.py %s) /CreationDate (D:%s) >>" % (VERSION, now)).encode("ascii")
        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = {}
        for i in range(1, info_id + 1):
            offsets[i] = len(buf)
            buf += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
        xref = len(buf)
        buf += b"xref\n0 %d\n0000000000 65535 f \n" % (info_id + 1)
        for i in range(1, info_id + 1):
            buf += b"%010d 00000 n \n" % offsets[i]
        buf += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (info_id + 1, info_id, xref)
        _atomic_write(path, bytes(buf))


def _atomic_write(path, data):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)


def write_pdf(path, pages, color, pen, transparent=False):
    pw = PdfWriter()
    r, g, b = _rgb(color)
    for pg in pages:
        parts = []
        lines = [x for x in pg.rules if x[4] == "line"]
        grid = [x for x in pg.rules if x[4] == "grid"]
        for group, rgb, wd in ((grid, (0.84, 0.87, 0.93), 0.2), (lines, (0.74, 0.78, 0.88), 0.25)):
            if group:
                parts.append("q %s %s %s RG %s w" % (_f(rgb[0]), _f(rgb[1]), _f(rgb[2]), _f(wd * PT)))
                parts += ["%s %s m %s %s l" % (_f(x0 * PT), _f((pg.h - y0) * PT), _f(x1 * PT), _f((pg.h - y1) * PT))
                          for x0, y0, x1, y1, _k in group]
                parts.append("S Q")
        if pg.ink:
            parts.append("q %.3f %.3f %.3f RG %s w 1 J 1 j" % (r, g, b, _f(pen * PT)))
            parts.append(pdf_path(pg.ink, pg.h))
            parts.append("S Q")
        if pg.marks:
            parts.append("q 0.85 0.15 0.15 RG %s w 1 J 1 j" % _f(0.3 * PT))
            parts.append(pdf_path(pg.marks, pg.h))
            parts.append("S Q")
        pw.add_page(pg.w, pg.h, "\n".join(parts))
    pw.save(path)
    return [path]


# --------------------------------------------------------------------------- #
#  Output: SVG
# --------------------------------------------------------------------------- #
def svg_path(strokes):
    out = []
    for st in strokes:
        if not st:
            continue
        if len(st) == 1:
            x, y = st[0]
            out.append("M%s %sl0.01 0" % (_f(x), _f(y)))
            continue
        out.append("M%s %sL" % (_f(st[0][0]), _f(st[0][1])) + " ".join("%s %s" % (_f(x), _f(y)) for x, y in st[1:]))
    return " ".join(out)


def page_files(path, n):
    root, ext = os.path.splitext(path)
    return [path if i == 0 else "%s-%d%s" % (root, i + 1, ext) for i in range(n)]


def write_svg(path, pages, color, pen, transparent=False):
    files = page_files(path, len(pages))
    for pg, fn in zip(pages, files):
        el = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<svg xmlns="http://www.w3.org/2000/svg" width="%smm" height="%smm" viewBox="0 0 %s %s">'
              % (_f(pg.w), _f(pg.h), _f(pg.w), _f(pg.h))]
        if not transparent:
            el.append('<rect width="100%" height="100%" fill="#ffffff"/>')
        for kind, col, wd in (("grid", "#d6dded", 0.2), ("line", "#bcc6e0", 0.25)):
            segs = [r for r in pg.rules if r[4] == kind]
            if segs:
                d = " ".join("M%s %sL%s %s" % (_f(a), _f(b), _f(c), _f(e)) for a, b, c, e, _k in segs)
                el.append('<path d="%s" stroke="%s" stroke-width="%s" fill="none"/>' % (d, col, wd))
        if pg.ink:
            el.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"/>'
                      % (svg_path(pg.ink), color, _f(pen)))
        if pg.marks:
            el.append('<path d="%s" fill="none" stroke="#d92626" stroke-width="0.3"/>' % svg_path(pg.marks))
        el.append("</svg>")
        _atomic_write(fn, ("\n".join(el) + "\n").encode("utf-8"))
    return files


# --------------------------------------------------------------------------- #
#  Output: PNG (Pillow)
# --------------------------------------------------------------------------- #
def write_png(path, pages, color, pen, transparent=False, dpi=200):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        raise HandwritingError(L("Für PNG wird Pillow benötigt: pip install pillow  (oder PDF/SVG verwenden).",
                                 "PNG needs Pillow: pip install pillow  (or use PDF/SVG)."))
    files = page_files(path, len(pages))
    rgb = tuple(int(color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    for pg, fn in zip(pages, files):
        W, H = max(1, int(round(pg.w / 25.4 * dpi))), max(1, int(round(pg.h / 25.4 * dpi)))
        ss = 3 if W * H <= 6_000_000 else 2
        k = dpi / 25.4 * ss
        SW, SH = W * ss, H * ss

        def draw_layer(strokes, width_mm):
            mask = Image.new("L", (SW, SH), 0)
            d = ImageDraw.Draw(mask)
            wpx = max(1, int(round(width_mm * k)))
            r = wpx / 2.0
            for st in strokes:
                pts = [(x * k, y * k) for x, y in st]
                if len(pts) == 1:
                    x, y = pts[0]
                    d.ellipse((x - r, y - r, x + r, y + r), fill=255)
                    continue
                d.line(pts, fill=255, width=wpx, joint="curve")
                for x, y in (pts[0], pts[-1]):
                    d.ellipse((x - r, y - r, x + r, y + r), fill=255)
            return mask.resize((W, H), Image.LANCZOS)

        if transparent:
            img = Image.new("RGBA", (W, H), (255, 255, 255, 0))
        else:
            img = Image.new("RGBA", (W, H), (255, 255, 255, 255))
        for kind, col, wd in (("grid", (214, 221, 237), 0.2), ("line", (188, 198, 224), 0.25)):
            segs = [[(a, b), (c, e)] for a, b, c, e, kk in pg.rules if kk == kind]
            if segs:
                m = draw_layer(segs, wd)
                img.paste(Image.new("RGBA", (W, H), col + (255,)), (0, 0), m)
        if pg.ink:
            m = draw_layer(pg.ink, pen)
            img.paste(Image.new("RGBA", (W, H), rgb + (255,)), (0, 0), m)
        if pg.marks:
            m = draw_layer(pg.marks, 0.3)
            img.paste(Image.new("RGBA", (W, H), (217, 38, 38, 255)), (0, 0), m)
        out = img if transparent else img.convert("RGB")
        tmp = fn + ".tmp"
        out.save(tmp, format="PNG", dpi=(dpi, dpi), optimize=True)
        os.replace(tmp, fn)
    return files


# --------------------------------------------------------------------------- #
#  Commands
# --------------------------------------------------------------------------- #
CLAUDE_DEFAULTS = {"lang": None, "paper": "lined", "size": 6.0, "color": "blue", "page": "a4", "fallback": "font"}
EXPORT_PATTERNS = ("my-handwriting-glyphs*.json", "handschrift-glyphs*.json")


def glyph_candidates():
    """Places where the sample file is looked for, in this order."""
    out = []
    env = os.environ.get("MY_HANDWRITING_GLYPHS")
    if env:
        out.append(("env", env))
    out.append(("skill", os.path.join(SKILL_DIR, "data", "glyphs.json")))
    home = os.path.join(os.path.expanduser("~"), ".claude", "skills", SKILL_NAME, "data", "glyphs.json")
    if os.path.normcase(os.path.abspath(home)) != os.path.normcase(os.path.abspath(out[-1][1])):
        out.append(("home", home))
    return out


def newest_download():
    """Newest exported file in ~/Downloads (the app downloads it there)."""
    import glob
    dl = os.path.join(os.path.expanduser("~"), "Downloads")
    files = []
    for pat in EXPORT_PATTERNS:
        files += glob.glob(os.path.join(dl, pat))
    files = [f for f in files if os.path.isfile(f)]
    return max(files, key=os.path.getmtime) if files else None


def find_glyphs():
    for _where, p in glyph_candidates():
        if os.path.isfile(p):
            return p
    return newest_download()


def no_glyphs_message():
    return L("Keine Handschrift-Datei gefunden.\n"
             "  1. Proben in der App (index.html) schreiben und mit „Export“ speichern.\n"
             "  2. python my_handwriting.py install --glyphs <exportierte-datei.json>\n"
             "  (oder --glyphs <datei> angeben bzw. MY_HANDWRITING_GLYPHS setzen)",
             "No handwriting file found.\n"
             "  1. Write samples in the app (index.html) and save them with \"Export\".\n"
             "  2. python my_handwriting.py install --glyphs <exported-file.json>\n"
             "  (or pass --glyphs <file> or set MY_HANDWRITING_GLYPHS)")


def resolve_glyphs(opt):
    if not getattr(opt, "glyphs", None):
        opt.glyphs = find_glyphs()
    if not opt.glyphs:
        raise HandwritingError(no_glyphs_message())
    return opt.glyphs


def claude_settings(gs):
    """Defaults chosen in the app for Claude (settings.claude in the exported file)."""
    out = dict(CLAUDE_DEFAULTS)
    cs = gs.meta.get("settings", {}).get("claude")
    if isinstance(cs, dict):
        if cs.get("lang") in LANG_ORDER:
            out["lang"] = cs["lang"]
        if cs.get("paper") in ("blank", "lined", "grid"):
            out["paper"] = cs["paper"]
        if isinstance(cs.get("size"), (int, float)) and 2 <= cs["size"] <= 30:
            out["size"] = float(cs["size"])
        if isinstance(cs.get("color"), str) and cs["color"]:
            out["color"] = cs["color"]
        if cs.get("page") in PAGE_SIZES or cs.get("page") == "auto":
            out["page"] = cs["page"]
        if cs.get("fallback") in ("font", "box"):
            out["fallback"] = cs["fallback"]
    if out["lang"] is None:
        ui = gs.meta.get("settings", {}).get("lang")
        out["lang"] = ui if ui in LANG_ORDER else None
    return out


def read_text(opt):
    if opt.text is not None and opt.input:
        raise HandwritingError(L("Bitte entweder --text oder --input angeben, nicht beides.", "Please give either --text or --input, not both."))
    if opt.text is not None:
        t = opt.text
    elif opt.input == "-":
        t = sys.stdin.read()
    elif opt.input:
        try:
            with open(opt.input, "r", encoding="utf-8-sig") as fh:
                t = fh.read()
        except OSError as e:
            raise HandwritingError(L("Textdatei kann nicht gelesen werden: %s", "Cannot read the text file: %s") % e)
        except UnicodeDecodeError:
            raise HandwritingError(L("Textdatei ist nicht UTF-8-kodiert.", "The text file is not UTF-8 encoded."))
    else:
        raise HandwritingError(L("Kein Text angegeben (--text \"…\" oder --input datei.txt).", "No text given (--text \"…\" or --input file.txt)."))
    t = unicodedata.normalize("NFC", t.replace("\r\n", "\n").replace("\r", "\n"))
    if opt.text is not None:
        t = t.replace("\\n", "\n")
    if not t.strip():
        raise HandwritingError(L("Der Text ist leer.", "The text is empty."))
    return t


def cmd_render(opt):
    resolve_glyphs(opt)
    gs = GlyphSet(opt.glyphs, opt.smooth, opt.consistency)
    for w in gs.warnings:
        warn(w)
    text = read_text(opt)
    fmt = (opt.format or os.path.splitext(opt.out)[1].lstrip(".")).lower()
    if fmt not in ("pdf", "svg", "png"):
        raise HandwritingError(L("Unbekanntes Ausgabeformat '%s' – erlaubt: pdf, svg, png.", "Unknown output format '%s' - allowed: pdf, svg, png.") % fmt)
    cs = claude_settings(gs)
    # command line > settings from the app > built-in defaults
    if opt.paper is None:
        opt.paper = cs["paper"]
    if opt.size is None:
        opt.size = cs["size"]
    if opt.color is None:
        opt.color = cs["color"]
    if opt.page is None:
        opt.page = (cs["page"] if cs["page"] != "auto" else "a4") if fmt == "pdf" else "auto"
    if opt.font is None:
        opt.font = cs["fallback"] == "font"
    if opt.line_spacing is None and opt.paper == "lined" and opt.line_height is None:
        opt.line_spacing = max(6.0, opt.size * 1.9)
    if opt.line_height is None:
        opt.line_height = 2.0
    if opt.margin is None:
        opt.margin = 20.0 if opt.page != "auto" else 8.0
    if opt.seed is None:
        opt.seed = random.SystemRandom().randrange(1, 10 ** 6)
    validate_opts(opt)
    color = parse_color(opt.color)
    pen = opt.pen if opt.pen else max(0.25, opt.size * 0.075)

    pages, ts, n_lines = build_pages(text, gs, opt)
    if ts.missing and opt.missing == "error":
        raise HandwritingError(L("Für diese Zeichen gibt es keine Proben: %s", "There are no samples for these characters: %s")
                               % " ".join(sorted(ts.missing)))
    if opt.missing == "skip":
        for pg in pages:
            pg.marks = []

    writer = {"pdf": write_pdf, "svg": write_svg, "png": write_png}[fmt]
    if fmt == "png":
        files = writer(opt.out, pages, color, pen, opt.transparent, opt.dpi)
    else:
        files = writer(opt.out, pages, color, pen, opt.transparent)

    report = {
        "ok": True, "files": [os.path.abspath(f) for f in files], "pages": len(pages), "lines": n_lines, "seed": opt.seed,
        "characters": len(text), "missing": sorted(ts.missing), "standard_handwriting": sorted(ts.font_chars),
        "fallbacks": ts.used_fallbacks, "glyphs": os.path.abspath(opt.glyphs),
        "settings": {"paper": opt.paper, "size": opt.size, "color": opt.color, "page": opt.page,
                     "markdown": bool(opt.markdown), "font": bool(opt.font)},
    }
    if opt.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(L("✓ Geschrieben: %s  (%d Seite(n), %d Zeilen, Seed %d)", "✓ Written: %s  (%d page(s), %d lines, seed %d)")
              % (", ".join(files), len(pages), n_lines, opt.seed))
        if ts.font_chars:
            print(L("  In Standard-Handschrift (keine eigenen Proben): ", "  In standard handwriting (no own samples): ")
                  + " ".join(sorted(ts.font_chars)))
        other = {k: v for k, v in ts.used_fallbacks.items() if k not in ts.font_chars}
        if other:
            print(L("  Ersatz verwendet: ", "  Replacements used: ") + ", ".join("'%s'→%s" % (k, v) for k, v in sorted(other.items())))
        if ts.missing:
            what = L("als rote Kästchen markiert", "marked as red boxes") if opt.missing == "box" else L("ausgelassen", "left out")
            print(L("  ⚠ Keine Proben für: %s  (%s)", "  ⚠ No samples for: %s  (%s)") % (" ".join(sorted(ts.missing)), what))
    return 0


def cmd_info(opt):
    """Everything Claude should know before writing, as JSON."""
    path = getattr(opt, "glyphs", None) or find_glyphs()
    info = {"skill_version": VERSION, "skill_dir": SKILL_DIR, "glyphs": None, "ready": False,
            "searched": [p for _w, p in glyph_candidates()] + [os.path.join("~", "Downloads", EXPORT_PATTERNS[0])]}
    if not path:
        info["problem"] = no_glyphs_message()
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 1
    gs = GlyphSet(path, 2, 0.6)
    scripts = file_scripts(gs)
    cs = claude_settings(gs)
    font = load_font()
    cov = analyse_coverage(gs, int(gs.meta.get("settings", {}).get("target", 10) or 10), scripts)
    per_lang = {}
    for code in LANG_ORDER:
        miss = [c for c in LANG_GROUPS[code] if not gs.has(c)]
        per_lang[code] = {"selected": code in scripts, "missing": "".join(miss)}
    base_missing = [c for g in cov["groups"] if not g["id"].startswith("lang-") for c in g["missing"]]
    info.update({
        "glyphs": os.path.abspath(path), "ready": True, "exported": gs.meta.get("exported"),
        "samples": gs.total(), "characters": len(gs.samples), "languages": scripts, "claude": cs,
        "verdict": cov["verdict_code"], "missing_basic": "".join(base_missing), "languages_missing": per_lang,
        "own_characters": cov["extra"], "standard_handwriting_available": bool(font),
        "note": "Characters without samples are written in the standard handwriting (unless claude.fallback is 'box').",
    })
    print(json.dumps(info, ensure_ascii=False, indent=2))
    return 0


def _check_glyph_file(path):
    gs = GlyphSet(path, 0, 0.0)      # raises a clear error if the file is not usable
    return gs


def _copy_skill(dest):
    import shutil
    src = os.path.abspath(SKILL_DIR)
    dest = os.path.abspath(dest)
    if os.path.normcase(src) == os.path.normcase(dest):
        return dest
    os.makedirs(os.path.join(dest, "scripts"), exist_ok=True)
    for rel in ("SKILL.md", os.path.join("scripts", "my_handwriting.py"), os.path.join("scripts", "fallback_font.json")):
        shutil.copyfile(os.path.join(src, rel), os.path.join(dest, rel))
    for rel in ("LICENSE", "NOTICE.md"):
        if os.path.isfile(os.path.join(src, rel)):
            shutil.copyfile(os.path.join(src, rel), os.path.join(dest, rel))
    return dest


def cmd_install(opt):
    import shutil
    dest = opt.dest or os.path.join(os.path.expanduser("~"), ".claude", "skills", SKILL_NAME)
    if opt.glyphs:
        _check_glyph_file(opt.glyphs)
    dest = _copy_skill(dest)
    data_dir = os.path.join(dest, "data")
    os.makedirs(data_dir, exist_ok=True)
    target = os.path.join(data_dir, "glyphs.json")
    if opt.glyphs:
        if os.path.isfile(target) and os.path.normcase(os.path.abspath(target)) != os.path.normcase(os.path.abspath(opt.glyphs)):
            shutil.copyfile(target, target + ".bak")       # keep the previous file
        if os.path.normcase(os.path.abspath(target)) != os.path.normcase(os.path.abspath(opt.glyphs)):
            shutil.copyfile(opt.glyphs, target)
    print(L("✓ Skill installiert: %s", "✓ Skill installed: %s") % dest)
    if os.path.isfile(target):
        print(L("  Handschrift-Datei: %s", "  Handwriting file: %s") % target)
    else:
        print(L("  ⚠ Noch keine Handschrift-Datei – später: install --glyphs <datei.json>",
                "  ⚠ No handwriting file yet - later: install --glyphs <file.json>"))
    print(L("  In Claude Code: /my-handwriting schreib … als PDF", "  In Claude Code: /my-handwriting write … as a PDF"))
    return 0


def cmd_package(opt):
    import zipfile
    out = opt.out or os.path.abspath("my-handwriting-skill.zip")
    glyphs = opt.glyphs or find_glyphs()
    if glyphs:
        _check_glyph_file(glyphs)
    files = [("SKILL.md", os.path.join(SKILL_DIR, "SKILL.md")),
             ("scripts/my_handwriting.py", os.path.join(HERE, "my_handwriting.py")),
             ("scripts/fallback_font.json", os.path.join(HERE, "fallback_font.json"))]
    if os.path.isfile(os.path.join(SKILL_DIR, "NOTICE.md")):
        files.append(("NOTICE.md", os.path.join(SKILL_DIR, "NOTICE.md")))
    if glyphs:
        files.append(("data/glyphs.json", glyphs))
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for arc, path in files:
            z.write(path, SKILL_NAME + "/" + arc)
    os.replace(tmp, out)
    print(L("✓ Paket erstellt: %s", "✓ Package written: %s") % out)
    if glyphs:
        print(L("  Enthält deine Handschrift – nur privat hochladen, nicht weitergeben.",
                "  Contains your handwriting - upload it privately, do not share it."))
    else:
        print(L("  ⚠ Ohne Handschrift-Datei (--glyphs fehlt).", "  ⚠ Without a handwriting file (--glyphs missing)."))
    return 0


def file_scripts(gs, override=None):
    """Writing languages: --scripts, else from the file, else German (files of the old version 1.0)."""
    if override:
        return [c for c in LANG_ORDER if c in override]
    sc = gs.meta.get("settings", {}).get("scripts")
    if isinstance(sc, list):
        return [c for c in LANG_ORDER if c in sc]
    return ["de"]


def coverage_groups(scripts):
    """(id, characters) in the same order and with the same de-duplication as the capture page."""
    base = {g: chars for g, _n, chars in GROUPS}
    out, seen = [], set()

    def add(gid, raw):
        lst = []
        for c in raw:
            if c not in seen and c not in lst:
                lst.append(c)
        seen.update(lst)
        out.append((gid, lst))
    add("upper", base["upper"])
    add("lower", base["lower"])
    for code in scripts:
        add("lang-" + code, LANG_GROUPS[code])
    for gid in ("digits", "punct", "math", "special"):
        add(gid, base[gid])
    return out


def analyse_coverage(gs, target, scripts):
    groups = []
    known = set()
    core_chars = set()
    for gid, cs in coverage_groups(scripts):
        known.update(cs)
        if gid in CORE_GROUPS or gid.startswith("lang-"):
            core_chars.update(cs)
        have = [c for c in cs if gs.has(c)]
        full = [c for c in cs if len(gs.samples.get(c, [])) >= target]
        core = gid in CORE_GROUPS or gid.startswith("lang-")
        groups.append({"id": gid, "name": group_name(gid), "total": len(cs), "present": len(have), "complete": len(full),
                       "missing": [c for c in cs if not gs.has(c)], "core": core})
    extra = sorted(k for k in gs.samples if k not in known)
    few = sorted((k, len(v)) for k, v in gs.samples.items() if len(v) < 3)
    sus = [(k, s.index, s.suspect) for k, v in sorted(gs.samples.items()) for s in v if s.suspect]
    core_missing = [c for g in groups if g["core"] for c in g["missing"]]
    core_few = [k for k, n in few if k in core_chars]
    if not core_missing and not core_few:
        code, verdict = "ready", L("bereit", "ready")
    elif len(core_missing) <= 10:
        code, verdict = "usable", L("nutzbar (fehlende Zeichen werden ersetzt oder markiert)", "usable (missing characters are replaced or marked)")
    else:
        code, verdict = "incomplete", L("unvollständig", "incomplete")
    return {"groups": groups, "extra": extra, "few": few, "suspect": sus,
            "core_missing": core_missing, "verdict": verdict, "verdict_code": code}


REASONS = {"height": ("Höhe", "height"), "width": ("Breite", "width"), "position": ("Position", "position")}


def cmd_check(opt):
    resolve_glyphs(opt)
    gs = GlyphSet(opt.glyphs, 2, 0.6)
    target = opt.target or int(gs.meta.get("settings", {}).get("target", 10) or 10)
    scripts = file_scripts(gs, opt.scripts.split(",") if opt.scripts else None)
    cov = analyse_coverage(gs, target, scripts)
    if opt.json:
        print(json.dumps({"file": os.path.abspath(opt.glyphs), "exported": gs.meta.get("exported"),
                          "samples": gs.total(), "characters": len(gs.samples), "target": target, "scripts": scripts,
                          "xheight_ratio": round(gs.xh_ratio, 3), "warnings": gs.warnings,
                          "verdict": cov["verdict"], "verdict_code": cov["verdict_code"], "core_missing": cov["core_missing"],
                          "groups": cov["groups"], "extra_characters": cov["extra"],
                          "few_samples": [{"char": k, "count": n} for k, n in cov["few"]],
                          "suspect_samples": [{"char": k, "sample": i, "reasons": [L(*REASONS.get(x, (x, x))) for x in r]}
                                              for k, i, r in cov["suspect"]]},
                         ensure_ascii=False, indent=2))
        return 0
    print(L("Datei:      %s", "File:       %s") % opt.glyphs)
    if gs.meta.get("exported"):
        print(L("Exportiert: %s", "Exported:   %s") % gs.meta["exported"])
    print(L("Proben:     %d für %d Zeichen (Ziel: %d pro Zeichen)", "Samples:    %d for %d characters (goal: %d per character)")
          % (gs.total(), len(gs.samples), target))
    print(L("Sprachen:   %s", "Languages:  %s") % (", ".join(LANG_NAMES[c] for c in scripts) or "–"))
    print(L("x-Höhe:     %.0f %% der Großbuchstabenhöhe", "x-height:   %.0f %% of the capital height") % (gs.xh_ratio * 100))
    for w in gs.warnings:
        print(L("Hinweis:    ", "Note:       ") + w)
    print()
    for g in cov["groups"]:
        line = L("  %-26s %3d/%-3d vorhanden, %3d vollständig", "  %-26s %3d/%-3d present, %3d complete") % (
            g["name"], g["present"], g["total"], g["complete"])
        if g["missing"]:
            line += L("   fehlt: ", "   missing: ") + " ".join(g["missing"])
        print(line)
    if cov["extra"]:
        print("  %-26s %s" % (L("Eigene Zeichen", "Own characters"), " ".join(cov["extra"])))
    if cov["few"]:
        print(L("\nWenige Proben (<3): ", "\nFew samples (<3): ") + ", ".join("%s(%d)" % (k, n) for k, n in cov["few"]))
    if cov["suspect"]:
        print(L("\nAuffällige Proben (werden beim Schreiben automatisch gemieden):",
                "\nUnusual samples (avoided automatically when writing):"))
        for k, i, r in cov["suspect"]:
            print(L("  '%s' Probe %d: %s", "  '%s' sample %d: %s") % (k, i, ", ".join(L(*REASONS.get(x, (x, x))) for x in r)))
    print(L("\nErgebnis: %s", "\nResult: %s") % cov["verdict"])
    return 0


def cmd_sheet(opt):
    resolve_glyphs(opt)
    gs = GlyphSet(opt.glyphs, opt.smooth, 0.0)
    order = []
    for _g, cs in coverage_groups(list(LANG_ORDER)):
        order += [c for c in cs if gs.has(c)]
    order += sorted(k for k in gs.samples if k not in order)
    W, H = PAGE_SIZES["a4"]
    margin = 12.0
    cell_h = 13.0
    u = cell_h / (gs.metrics["boxTop"] - gs.metrics["boxBottom"])
    cell_w = u * gs.metrics["boxWidth"]
    label_w = 16.0
    per_row = max(1, int((W - 2 * margin - label_w) // cell_w))
    row_h = cell_h + 2.5
    rows = []
    for ch in order:
        lst = gs.samples[ch]
        for i in range(0, len(lst), per_row):
            rows.append((ch, lst[i:i + per_row], i == 0))
    pw = PdfWriter()
    y = margin + 10
    parts, ink, sus_boxes, base_lines = [], [], [], []
    page_no = 1

    def flush():
        content = list(parts)
        if base_lines:
            content.append("q 0.78 0.81 0.9 RG %s w" % _f(0.2 * PT))
            content += ["%s %s m %s %s l" % (_f(a * PT), _f((H - b) * PT), _f(c * PT), _f((H - b) * PT)) for a, b, c in base_lines]
            content.append("S Q")
        if sus_boxes:
            content.append("q 0.85 0.45 0.1 RG %s w" % _f(0.4 * PT))
            content += ["%s %s %s %s re" % (_f(a * PT), _f((H - b - cell_h) * PT), _f(cell_w * PT), _f(cell_h * PT)) for a, b in sus_boxes]
            content.append("S Q")
        if ink:
            content.append("q 0.11 0.18 0.56 RG %s w 1 J 1 j" % _f(0.35 * PT))
            content.append(pdf_path(ink, H))
            content.append("S Q")
        pw.add_page(W, H, "\n".join(content), uses_font=True)

    title = L("My Handwriting – Übersicht: %d Zeichen, %d Proben  (orange = auffällig)",
              "My Handwriting - overview: %d characters, %d samples  (orange = unusual)") % (len(gs.samples), gs.total())
    parts.append("0 g " + pdf_text(margin, H - margin - 3, 11, title))
    for ch, lst, first in rows:
        if y + row_h > H - margin:
            flush()
            parts, ink, sus_boxes, base_lines = [], [], [], []
            page_no += 1
            y = margin
            parts.append("0.5 g " + pdf_text(W - margin - 12, H - margin + 4, 8, L("Seite %d", "Page %d") % page_no))
        if first:
            parts.append("0 g " + pdf_text(margin, H - (y + cell_h * 0.62), 13, ch))
            parts.append("0.45 g " + pdf_text(margin, H - (y + cell_h * 0.62 + 4), 7, L("%d Proben", "%d samples") % len(gs.samples[ch])))
        for j, s in enumerate(lst):
            x0 = margin + label_w + j * cell_w
            top = y
            base_y = top + gs.metrics["boxTop"] * u
            base_lines.append((x0 + 0.5, base_y, x0 + cell_w - 0.5))
            for st in s.strokes:
                ink.append([(x0 + px * u, base_y - py * u) for px, py in st])
            if s.suspect:
                sus_boxes.append((x0, top))
        y += row_h
    flush()
    pw.save(opt.out)
    print(L("✓ Übersicht geschrieben: %s (%d Seite(n))", "✓ Overview written: %s (%d page(s))") % (opt.out, len(pw.pages)))
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="my_handwriting.py",
                                description=L("Text in deiner eigenen Handschrift schreiben.", "Write text in your own handwriting."),
                                formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split("Special text")[0])
    p.add_argument("--version", action="version", version="my_handwriting.py " + VERSION)
    p.add_argument("--lang", choices=["en", "de"], help=L("Sprache der Meldungen", "Language of the messages"))
    sub = p.add_subparsers(dest="cmd")

    def common(sp):
        sp.add_argument("--glyphs", default=None,
                        help=L("Proben-Datei aus der App (Standard: data/glyphs.json im Skill, $MY_HANDWRITING_GLYPHS "
                               "oder der neueste Export in Downloads)",
                               "Sample file from the app (default: data/glyphs.json in the skill, $MY_HANDWRITING_GLYPHS "
                               "or the newest export in Downloads)"))

    r = sub.add_parser("render", help=L("Text in Handschrift ausgeben (PDF/SVG/PNG)", "Write text in handwriting (PDF/SVG/PNG)"))
    common(r)
    r.add_argument("--text", help=L("Der Text (\\n = Zeilenumbruch). [[3/4]] = Bruch.", "The text (\\n = line break). [[3/4]] = fraction."))
    r.add_argument("--input", help=L("Textdatei (UTF-8) oder - für stdin", "Text file (UTF-8) or - for stdin"))
    r.add_argument("--out", required=True, help=L("Ausgabedatei: .pdf, .svg oder .png", "Output file: .pdf, .svg or .png"))
    r.add_argument("--format", choices=["pdf", "svg", "png"], help=L("Format erzwingen (sonst aus Dateiendung)", "Force the format (default: from the file extension)"))
    r.add_argument("--markdown", action="store_true",
                   help=L("Einfaches Markdown: # Überschrift, - Liste, 1. Liste, --- Linie", "Simple Markdown: # heading, - list, 1. list, --- rule"))
    r.add_argument("--page", choices=["a4", "a5", "a3", "letter", "auto"],
                   help=L("Seitengröße; auto = Bild genau so groß wie der Text (Standard: aus der App bzw. a4 für PDF, sonst auto)",
                          "Page size; auto = image exactly as big as the text (default: from the app or a4 for PDF, else auto)"))
    r.add_argument("--landscape", action="store_true", help=L("Querformat", "Landscape"))
    r.add_argument("--width", type=float, default=180.0, help=L("Breite in mm bei --page auto (Standard 180)", "Width in mm with --page auto (default 180)"))
    r.add_argument("--margin", type=float, help=L("Rand in mm (Standard 20, bei auto 8)", "Margin in mm (default 20, auto: 8)"))
    r.add_argument("--margin-left", type=float, help=L("linker Rand in mm (sonst wie --margin)", "Left margin in mm (default: like --margin)"))
    r.add_argument("--size", type=float, help=L("Höhe der Großbuchstaben in mm (Standard aus der App, sonst 6)", "Capital height in mm (default: from the app, else 6)"))
    r.add_argument("--line-height", type=float, help=L("Zeilenabstand als Vielfaches der Größe (Standard 2.0)", "Line spacing as a multiple of the size (default 2.0)"))
    r.add_argument("--line-spacing", type=float, help=L("Zeilenabstand direkt in mm (z. B. 8 für liniertes Papier)", "Line spacing in mm (e.g. 8 for lined paper)"))
    r.add_argument("--pen", type=float, help=L("Stiftbreite in mm (Standard: 7,5 %% der Größe, mind. 0,25)", "Pen width in mm (default: 7.5 %% of the size, at least 0.25)"))
    r.add_argument("--color", help=L("Tintenfarbe: blue, black, royal, red, green, pencil oder #RRGGBB (Standard aus der App)",
                                     "Ink colour: blue, black, royal, red, green, pencil or #RRGGBB (default: from the app)"))
    r.add_argument("--paper", choices=["blank", "lined", "grid"], help=L("Papier: blank, lined (liniert), grid (kariert); Standard aus der App",
                                                                         "Paper: blank, lined, grid (squared); default: from the app"))
    r.add_argument("--align", choices=["left", "center", "right"], default="left")
    r.add_argument("--variation", type=float, default=1.0, help=L("Natürliche Unregelmäßigkeit 0–2 (Standard 1)", "Natural irregularity 0-2 (default 1)"))
    r.add_argument("--tracking", type=float, default=0.15, help=L("Buchstabenabstand (Einheiten, Standard 0.15)", "Letter spacing (units, default 0.15)"))
    r.add_argument("--word-space", type=float, default=0.55, help=L("Wortabstand (Einheiten, Standard 0.55)", "Word spacing (units, default 0.55)"))
    r.add_argument("--kerning", type=float, default=1.0, help=L("Optische Unterschneidung 0–1 (Standard 1)", "Optical kerning 0-1 (default 1)"))
    r.add_argument("--consistency", type=float, default=0.6, help=L("Proben in Größe/Lage angleichen 0–1 (Standard 0.6)", "Even out size/position of samples 0-1 (default 0.6)"))
    r.add_argument("--smooth", type=int, default=2, help=L("Glättung der Striche 0–4 (Standard 2)", "Stroke smoothing 0-4 (default 2)"))
    r.add_argument("--seed", type=int, help=L("Zufallswert für reproduzierbares Ergebnis", "Random seed for a reproducible result"))
    r.add_argument("--dpi", type=int, default=200, help=L("Auflösung für PNG (Standard 200)", "PNG resolution (default 200)"))
    r.add_argument("--transparent", action="store_true", help=L("Transparenter Hintergrund (PNG/SVG)", "Transparent background (PNG/SVG)"))
    g = r.add_mutually_exclusive_group()
    g.add_argument("--font", dest="font", action="store_true", default=None,
                   help=L("Fehlende Zeichen in Standard-Handschrift (Standard)", "Missing characters in standard handwriting (default)"))
    g.add_argument("--no-font", dest="font", action="store_false",
                   help=L("Keine Standard-Handschrift: fehlende Zeichen als rote Kästchen", "No standard handwriting: missing characters as red boxes"))
    r.add_argument("--missing", choices=["box", "skip", "error"], default="box",
                   help=L("Zeichen ohne Proben (nur mit --no-font oder ganz unbekannten Zeichen): box = rotes Kästchen, skip = auslassen, error = abbrechen",
                          "Characters without samples (only with --no-font or completely unknown characters): box = red box, skip = leave out, error = stop"))
    r.add_argument("--json", action="store_true", help=L("Ergebnisbericht als JSON", "Report as JSON"))
    r.set_defaults(func=cmd_render)

    i = sub.add_parser("info", help=L("Datei, Sprachen, Standardwerte und fehlende Zeichen als JSON (für Claude)",
                                      "File, languages, defaults and missing characters as JSON (for Claude)"))
    common(i)
    i.set_defaults(func=cmd_info)

    c = sub.add_parser("check", help=L("Proben-Datei prüfen", "Check a sample file"))
    common(c)
    c.add_argument("--target", type=int, help=L("Ziel-Proben pro Zeichen (Standard aus der Datei)", "Goal samples per character (default: from the file)"))
    c.add_argument("--scripts", help=L("Sprachen prüfen, z. B. de,fr (Standard aus der Datei)", "Languages to check, e.g. de,fr (default: from the file)"))
    c.add_argument("--json", action="store_true")
    c.set_defaults(func=cmd_check)

    s = sub.add_parser("sheet", help=L("Übersichtsblatt aller Proben als PDF", "Overview sheet of all samples as PDF"))
    common(s)
    s.add_argument("--out", required=True)
    s.add_argument("--smooth", type=int, default=2)
    s.set_defaults(func=cmd_sheet)

    ins = sub.add_parser("install", help=L("Skill für Claude Code einrichten (mit deiner Handschrift-Datei)",
                                           "Install the skill for Claude Code (with your handwriting file)"))
    ins.add_argument("--glyphs", help=L("Exportierte Datei aus der App", "Exported file from the app"))
    ins.add_argument("--dest", help=L("Zielordner (Standard: ~/.claude/skills/my-handwriting)", "Target folder (default: ~/.claude/skills/my-handwriting)"))
    ins.set_defaults(func=cmd_install)

    pk = sub.add_parser("package", help=L("ZIP für die Claude-App (claude.ai) erstellen", "Create a ZIP for the Claude app (claude.ai)"))
    pk.add_argument("--glyphs", help=L("Exportierte Datei aus der App (Standard: wie bei render)", "Exported file from the app (default: like render)"))
    pk.add_argument("--out", help=L("ZIP-Datei (Standard: my-handwriting-skill.zip)", "ZIP file (default: my-handwriting-skill.zip)"))
    pk.set_defaults(func=cmd_package)
    return p


def validate_opts(opt):
    if opt.cmd != "render" or opt.size is None:
        return
    checks = [
        (0.5 <= opt.size <= 100, L("--size muss zwischen 0,5 und 100 mm liegen.", "--size must be between 0.5 and 100 mm.")),
        (opt.line_height is None or 0.8 <= opt.line_height <= 10, L("--line-height muss zwischen 0,8 und 10 liegen.", "--line-height must be between 0.8 and 10.")),
        (opt.line_spacing is None or 1 <= opt.line_spacing <= 200, L("--line-spacing muss zwischen 1 und 200 mm liegen.", "--line-spacing must be between 1 and 200 mm.")),
        (opt.pen is None or 0.05 <= opt.pen <= 10, L("--pen muss zwischen 0,05 und 10 mm liegen.", "--pen must be between 0.05 and 10 mm.")),
        (0 <= opt.variation <= 3, L("--variation muss zwischen 0 und 3 liegen.", "--variation must be between 0 and 3.")),
        (-0.2 <= opt.tracking <= 2, L("--tracking muss zwischen -0,2 und 2 liegen.", "--tracking must be between -0.2 and 2.")),
        (0 <= opt.word_space <= 5, L("--word-space muss zwischen 0 und 5 liegen.", "--word-space must be between 0 and 5.")),
        (0 <= opt.kerning <= 1, L("--kerning muss zwischen 0 und 1 liegen.", "--kerning must be between 0 and 1.")),
        (0 <= opt.consistency <= 1, L("--consistency muss zwischen 0 und 1 liegen.", "--consistency must be between 0 and 1.")),
        (0 <= opt.smooth <= 6, L("--smooth muss zwischen 0 und 6 liegen.", "--smooth must be between 0 and 6.")),
        (30 <= opt.dpi <= 1200, L("--dpi muss zwischen 30 und 1200 liegen.", "--dpi must be between 30 and 1200.")),
        (20 <= opt.width <= 5000, L("--width muss zwischen 20 und 5000 mm liegen.", "--width must be between 20 and 5000 mm.")),
        (opt.margin is None or 0 <= opt.margin <= 100, L("--margin muss zwischen 0 und 100 mm liegen.", "--margin must be between 0 and 100 mm.")),
        (opt.margin_left is None or 0 <= opt.margin_left <= 150, L("--margin-left muss zwischen 0 und 150 mm liegen.", "--margin-left must be between 0 and 150 mm.")),
    ]
    for ok, msg in checks:
        if not ok:
            raise HandwritingError(msg)


def _fix_console():
    """Windows: piped output uses the ANSI code page and would crash on ✓/⚠ – use UTF-8 there,
    and never let a printing error stop the program."""
    for s in (sys.stdout, sys.stderr):
        try:
            if not s.isatty():
                s.reconfigure(encoding="utf-8", errors="replace")
            else:
                s.reconfigure(errors="replace")
        except Exception:
            pass


def main(argv=None):
    global LANG
    _fix_console()
    args = list(sys.argv[1:] if argv is None else argv)
    for i, a in enumerate(args):   # --lang must work before the help texts are built
        if a == "--lang" and i + 1 < len(args) and args[i + 1] in ("de", "en"):
            LANG = args[i + 1]
        elif a.startswith("--lang=") and a[7:] in ("de", "en"):
            LANG = a[7:]
    parser = build_parser()
    opt = parser.parse_args(args)
    if not getattr(opt, "func", None):
        parser.print_help()
        return 2
    try:
        return opt.func(opt)
    except HandwritingError as e:
        print(L("Fehler: %s", "Error: %s") % e, file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
