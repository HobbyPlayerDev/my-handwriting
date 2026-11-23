/* my-handwriting - typesetter in the browser (same ideas and rules as
 * skill/my-handwriting/scripts/my_handwriting.py: random sample per character, kerning by profiles,
 * natural variation, fallbacks, standard-handwriting font for missing characters, fractions,
 * simple Markdown: # headings, - lists, 1. lists, --- rules, [[pagebreak]]).
 * Output: page objects in millimetres (y down) -> canvas, SVG string, PDF bytes.
 * No DOM access except in drawPage(); usable in node for tests. */
(function () {
  'use strict';

  var PAGE_SIZES = { a4: [210, 297], a5: [148, 210], a3: [297, 420], letter: [215.9, 279.4] };
  var INK = { blue: '#1d2f8f', black: '#1b1b1f', royal: '#2340b8', red: '#b3261e', green: '#1e6b3a', pencil: '#5a5a5a' };
  var BAND = 0.08, RESAMPLE_STEP = 0.01;
  var FRACTION_RE = /\[\[([^\[\]\/\n]+)\/([^\[\]\n]+)\]\]/g;
  var PAGEBREAK_RE = /^\s*\[\[pagebreak\]\]\s*$/i;
  // Replacements that only approximate the character (€ -> EUR). If the standard-handwriting font
  // has the real character, it is used instead (same list as APPROX in my_handwriting.py).
  var APPROX = '€ß×÷≤≥≈→←«»–—';

  // Replacement rules for characters without samples (same as FALLBACKS in my_handwriting.py).
  var FB = {
    ' ': ' ', ' ': ' ', ' ': ' ', '\t': '    ',
    '’': "'", '‘': "'", '‛': "'", '´': "'", '`': "'", '′': "'", 'ʼ': "'", '‚': ',',
    '”': '“', '“': '"', '„': ',,', '‟': '"', '″': '"', '«': '"', '»': '"', '‹': "'", '›': "'",
    '—': '–', '–': '-', '‐': '-', '‑': '-', '‒': '-', '−': '-', '―': '–',
    '…': '...', '⋅': '·', '•': '·', '·': ['t', '.', 1.0, 0.28],
    'ẞ': 'ß', 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe', '⁄': '/', '∕': '/', '✕': '×', '×': 'x', '÷': ':',
    '¹': ['t', '1', 0.6, 0.55], '²': ['t', '2', 0.6, 0.55], '³': ['t', '3', 0.6, 0.55],
    '⁰': ['t', '0', 0.6, 0.55], '⁴': ['t', '4', 0.6, 0.55], '⁵': ['t', '5', 0.6, 0.55],
    '⁶': ['t', '6', 0.6, 0.55], '⁷': ['t', '7', 0.6, 0.55], '⁸': ['t', '8', 0.6, 0.55],
    '⁹': ['t', '9', 0.6, 0.55], '⁺': ['t', '+', 0.6, 0.55], '⁻': ['t', '-', 0.6, 0.55],
    '₀': ['t', '0', 0.6, -0.2], '₁': ['t', '1', 0.6, -0.2], '₂': ['t', '2', 0.6, -0.2],
    '₃': ['t', '3', 0.6, -0.2], '₄': ['t', '4', 0.6, -0.2],
    '°': ['t', 'o', 0.5, 0.62], 'º': ['t', 'o', 0.5, 0.62], 'ª': ['t', 'a', 0.5, 0.6],
    '½': ['frac', '1', '2'], '¼': ['frac', '1', '4'], '¾': ['frac', '3', '4'],
    '⅓': ['frac', '1', '3'], '⅔': ['frac', '2', '3'], '⅕': ['frac', '1', '5'],
    '⅛': ['frac', '1', '8'], '⅜': ['frac', '3', '8'], '⅝': ['frac', '5', '8'], '⅞': ['frac', '7', '8'],
    '≠': ['over', '=', '/'], 'ł': ['slash', 'l', 0], 'Ł': ['slash', 'L', 1], 'ı': ['t', 'l', 0.62, 0.0],
    '≤': '<=', '≥': '>=', '≈': '~', '→': '->', '⇒': '=>', '←': '<-',
    '€': 'EUR', '™': 'TM', '©': '(c)', '¿': ['flip', '?', 0.72], '¡': ['flip', '!', 0.72]
  };

  /* ---------------- random numbers (seeded) ---------------- */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1, spare = null;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      random: next,
      uniform: function (lo, hi) { return lo + (hi - lo) * next(); },
      choice: function (arr) { return arr[Math.floor(next() * arr.length) % arr.length]; },
      gauss: function () {
        if (spare !== null) { var s = spare; spare = null; return s; }
        var u = 0, v = 0; while (u === 0) u = next(); v = next();
        var r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v);
        return r * Math.cos(2 * Math.PI * v);
      }
    };
  }
  function gauss(rng, sigma, clip) { clip = clip || 2.5; return Math.max(-clip, Math.min(clip, rng.gauss())) * sigma; }

  /* ---------------- geometry ---------------- */
  function resample(pts, step) {
    if (pts.length < 2) return pts.slice();
    var out = [pts[0]], carry = 0;
    for (var i = 1; i < pts.length; i++) {
      var x0 = pts[i - 1][0], y0 = pts[i - 1][1], x1 = pts[i][0], y1 = pts[i][1];
      var seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg <= 1e-12) continue;
      var d = step - carry;
      while (d <= seg) { var t = d / seg; out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); d += step; }
      carry = seg - (d - step);
    }
    var last = pts[pts.length - 1], o = out[out.length - 1];
    if (Math.hypot(o[0] - last[0], o[1] - last[1]) > step * 0.25) out.push(last); else out[out.length - 1] = last;
    return out;
  }
  function smooth(pts, passes) {
    if (pts.length < 3) return pts;
    for (var k = 0; k < passes; k++) {
      var n = [pts[0]];
      for (var i = 1; i < pts.length - 1; i++)
        n.push([0.25 * pts[i - 1][0] + 0.5 * pts[i][0] + 0.25 * pts[i + 1][0], 0.25 * pts[i - 1][1] + 0.5 * pts[i][1] + 0.25 * pts[i + 1][1]]);
      n.push(pts[pts.length - 1]); pts = n;
    }
    return pts;
  }
  // Ramer-Douglas-Peucker: drops points closer than eps to the line (keeps files small, invisible at 0.002).
  function simplify(pts, eps) {
    var n = pts.length; if (n < 3) return pts;
    var keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var ab = stack.pop(), a = ab[0], b = ab[1], ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay;
      var Ln = Math.hypot(dx, dy), best = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var d = Ln < 1e-12 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + pts[b][0] * ay - pts[b][1] * ax) / Ln;
        if (d > best) { best = d; idx = i; }
      }
      if (best > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter(function (p, i) { return keep[i]; });
  }
  function bboxOf(strokes) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    strokes.forEach(function (st) { st.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }); });
    if (x0 === Infinity) return [0, 0, 0, 0];
    return [x0, x1, y0, y1];
  }
  function median(v) {
    if (!v.length) return 0; var b = v.slice().sort(function (p, q) { return p - q; }), m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function chars(s) { return Array.from(s || ''); }

  /* ---------------- samples ---------------- */
  function suspectReasons(list) {
    var res = new Map();
    if (list.length < 3) return res;
    var mh = median(list.map(function (s) { return s.h; })), mw = median(list.map(function (s) { return s.w; })),
        mcy = median(list.map(function (s) { return s.cy; }));
    list.forEach(function (s) {
      var r = [];
      if (mh > 0.08 && (s.h > mh * 1.8 || s.h < mh * 0.55)) r.push('h');
      if (mw > 0.08 && (s.w > mw * 2.0 || s.w < mw * 0.45)) r.push('w');
      if (Math.abs(s.cy - mcy) > 0.3) r.push('p');
      if (r.length) res.set(s, r);
    });
    return res;
  }

  /** glyphs: {char: [{id, strokes: [[x,y,x,y…] ints]}]}, scale: 1000 */
  function GlyphSet(glyphs, scale, opts) {
    opts = opts || {};
    scale = scale || 1000;
    var passes = opts.smooth === undefined ? 2 : opts.smooth, c = opts.consistency === undefined ? 0.6 : opts.consistency;
    var self = this; this.samples = {};
    Object.keys(glyphs || {}).forEach(function (key) {
      var lst = [];
      (glyphs[key] || []).forEach(function (s) {
        if (!s || !Array.isArray(s.strokes)) return;
        var strokes = [];
        s.strokes.forEach(function (st) {
          var pts = [];
          for (var i = 0; i + 1 < st.length; i += 2) {
            var x = st[i] / scale, y = st[i + 1] / scale;
            if (!isFinite(x) || !isFinite(y)) continue;
            var l = pts[pts.length - 1];
            if (!l || Math.abs(l[0] - x) > 1e-6 || Math.abs(l[1] - y) > 1e-6) pts.push([x, y]);
          }
          if (!pts.length) return;
          if (pts.length >= 2) pts = simplify(smooth(resample(pts, RESAMPLE_STEP), passes), 0.002);
          strokes.push(pts);
        });
        if (!strokes.length) return;
        var bb = bboxOf(strokes);
        lst.push({ id: s.id, strokes: strokes, bbox: bb, w: bb[1] - bb[0], h: bb[3] - bb[2], cy: (bb[2] + bb[3]) / 2,
                   suspect: [], adjScale: 1, adjDy: 0 });
      });
      if (lst.length) self.samples[key.normalize ? key.normalize('NFC') : key] = lst;
    });
    // consistency: pull outliers in size/position towards the median of this character
    Object.keys(this.samples).forEach(function (key) {
      var lst = self.samples[key], sus = suspectReasons(lst);
      lst.forEach(function (s) { s.suspect = sus.get(s) || []; });
      var good = lst.filter(function (s) { return !s.suspect.length; }); if (!good.length) good = lst;
      if (good.length < 3 || c <= 0) return;
      var mh = median(good.map(function (s) { return s.h; })), mcy = median(good.map(function (s) { return s.cy; }));
      lst.forEach(function (s) {
        if (mh > 0.08 && s.h > 1e-6) s.adjScale = Math.max(0.8, Math.min(1.25, 1 + c * (mh / s.h - 1)));
        s.adjDy = Math.max(-0.15, Math.min(0.15, c * (mcy - s.cy)));
      });
    });
    this.multiKeys = Object.keys(this.samples).filter(function (k) { return chars(k).length > 1; })
      .sort(function (a, b) { return b.length - a.length; });
    var lows = [], caps = [];
    chars('xoacenmuvwzrs').forEach(function (ch) { (self.samples[ch] || []).forEach(function (s) { lows.push(s.bbox[3]); }); });
    chars('HEIXONMTLKZ').forEach(function (ch) { (self.samples[ch] || []).forEach(function (s) { caps.push(s.bbox[3]); }); });
    this.xh = (lows.length && caps.length && median(caps) > 0.2) ? Math.max(0.45, Math.min(0.8, median(lows) / median(caps))) : 0.62;
    this.cap = caps.length ? Math.max(0.6, Math.min(1.5, median(caps))) : 1;
    // slant of the handwriting, from long, nearly vertical strokes (used for the standard font)
    var sl = [];
    chars('lIi1tdhkbLHN|').forEach(function (ch) { (self.samples[ch] || []).forEach(function (s) {
      var st = s.strokes.reduce(function (m, x) { return x.length > m.length ? x : m; }, []);
      if (st.length < 2) return;
      var a = st[0], b = st[st.length - 1], dy = b[1] - a[1];
      if (Math.abs(dy) > 0.4) { var r = (b[0] - a[0]) / dy; if (Math.abs(r) < 0.6) sl.push(r); }
    }); });
    this.slant = sl.length >= 3 ? Math.max(-0.35, Math.min(0.35, median(sl))) : 0;
  }
  GlyphSet.prototype.has = function (k) { return !!this.samples[k]; };
  GlyphSet.prototype.usable = function (k) {
    var lst = this.samples[k]; if (!lst) return null;
    var good = lst.filter(function (s) { return !s.suspect.length; });
    return good.length >= 2 ? good : lst;
  };
  GlyphSet.prototype.total = function () { var n = 0, s = this.samples; Object.keys(s).forEach(function (k) { n += s[k].length; }); return n; };

  /** Standard-handwriting font (js/fallback-font.js): {scale, xheight, glyphs: {ch: {w, s: [[x,y…]]}}} */
  function FontSet(data) {
    var self = this, sc = (data && data.scale) || 1000;
    this.glyphs = {}; this.xh = (data && data.xheight) || 0.667;
    Object.keys((data && data.glyphs) || {}).forEach(function (k) {
      var strokes = [];
      (data.glyphs[k].s || []).forEach(function (st) {
        var pts = [];
        for (var i = 0; i + 1 < st.length; i += 2) pts.push([st[i] / sc, st[i + 1] / sc]);
        if (pts.length >= 2) pts = smooth(resample(pts, RESAMPLE_STEP), 1);
        if (pts.length) strokes.push(pts);
      });
      if (strokes.length) self.glyphs[k] = { strokes: strokes };
    });
  }
  FontSet.prototype.has = function (k) { return !!this.glyphs[k]; };
  var fontCache = [];
  function fontSetFor(data) {
    if (!data) return null;
    if (data instanceof FontSet) return data;
    for (var i = 0; i < fontCache.length; i++) if (fontCache[i][0] === data) return fontCache[i][1];
    var f = new FontSet(data); fontCache.push([data, f]); return f;
  }

  /* ---------------- boxes ---------------- */
  function Box(ink, marks) {
    marks = marks || [];
    var bb = bboxOf(ink.concat(marks)), x0 = bb[0];
    this.ink = ink.map(function (st) { return st.map(function (p) { return [p[0] - x0, p[1]]; }); });
    this.marks = marks.map(function (st) { return st.map(function (p) { return [p[0] - x0, p[1]]; }); });
    this.w = Math.max(0, bb[1] - bb[0]); this.ymin = bb[2]; this.ymax = bb[3]; this._prof = null;
  }
  Box.spacer = function (w) { var b = new Box([], []); b.w = Math.max(0, w); return b; };
  Box.prototype.profiles = function () {
    if (!this._prof) {
      var left = {}, right = {};
      var put = function (x, y) {
        var b = Math.floor(y / BAND);
        if (left[b] === undefined || x < left[b]) left[b] = x;
        if (right[b] === undefined || x > right[b]) right[b] = x;
      };
      // straight lines keep only their end points (simplify): fill in the bands in between,
      // otherwise the next letter slides into a straight stem (BB, DD, AA)
      this.ink.concat(this.marks).forEach(function (st) { st.forEach(function (p, i) {
        if (i) {
          var q = st[i - 1], n = Math.ceil(Math.abs(p[1] - q[1]) / (BAND / 2));
          for (var j = 1; j < n; j++) put(q[0] + (p[0] - q[0]) * j / n, q[1] + (p[1] - q[1]) * j / n);
        }
        put(p[0], p[1]);
      }); });
      this._prof = [left, right];
    }
    return this._prof;
  };
  Box.prototype.transformed = function (sx, sy, dy) {
    var f = function (st) { return st.map(function (p) { return [p[0] * sx, p[1] * sy + dy]; }); };
    return new Box(this.ink.map(f), this.marks.map(f));
  };
  function kernOffset(a, b, gap, k) {
    var base = a.w + gap;
    if (k <= 0 || !a.ink.length || !b.ink.length) return base;
    var ra = a.profiles()[1], lb = b.profiles()[0], req = -Infinity;
    Object.keys(ra).forEach(function (key) {
      var band = +key, rx = ra[key];
      [[band, gap], [band - 1, gap * 0.7], [band + 1, gap * 0.7]].forEach(function (pair) {
        var lx = lb[pair[0]]; if (lx !== undefined) { var v = rx - lx + pair[1]; if (v > req) req = v; }
      });
    });
    var limit = base - 0.22 * k;
    return req > -Infinity ? Math.max(req, limit) : limit;
  }

  /* ---------------- typesetter ---------------- */
  function Typesetter(gs, rng, o) {
    this.gs = gs; this.rng = rng;
    this.v = Math.max(0, o.variation === undefined ? 1 : o.variation);
    this.tracking = o.tracking === undefined ? 0.15 : o.tracking;
    this.wordSpace = o.wordSpace === undefined ? 0.55 : o.wordSpace;
    this.kerning = o.kerning === undefined ? 1 : o.kerning;
    this.labels = o.labels || { small: 'small', accent: '+ accent', 'case': 'case swapped', frac: 'fraction', font: 'standard' };
    this.font = o.fallbackFont === false ? null : fontSetFor(o.font);
    this.real = !!o.realism;
    this.recent = {}; this.fallbacks = {}; this.missing = {}; this.cache = {}; this.fontChars = {};
  }
  var TS = Typesetter.prototype;
  /* How is a character written? Pass 1 uses only the writer's own samples (directly or composed:
     accents, fractions, ł …). If that leaves anything missing and the standard-handwriting font is
     available, pass 2 takes the font's own character, or composes from own + font parts. */
  TS.plan = function (ch, depth, own) {
    depth = depth || 0;
    if (!depth && own === undefined) {
      var top = '\u0001' + ch;
      if (!(top in this.cache)) {
        var keep = Object.assign({}, this.fallbacks);
        var p = this.plan(ch, 0, true);
        if (this.font && hasMissing(p)) {
          this.fallbacks = keep;
          p = this.font.has(ch) ? ['f', ch] : this.plan(ch, 0, false);
          if (p[0] === 'f') this.fallbacks[ch] = this.labels.font;
        }
        if (usesFont(p)) this.fontChars[ch] = 1;
        this.cache[top] = p;
      }
      return this.cache[top];
    }
    var key = ch + '\u0000' + depth + (own ? 'o' : 'f');
    if (!(key in this.cache)) this.cache[key] = this._plan(ch, depth, !!own);
    return this.cache[key];
  };
  function usesFont(p) {
    if (!Array.isArray(p)) return false;
    if (p[0] === 'f') return true;
    for (var i = 1; i < p.length; i++) if (Array.isArray(p[i]) && usesFont(p[i])) return true;
    return false;
  }
  function hasMissing(p) {
    if (!Array.isArray(p)) return false;
    if (p[0] === 'missing') return true;
    for (var i = 1; i < p.length; i++) if (Array.isArray(p[i]) && hasMissing(p[i])) return true;
    return false;
  }
  TS._plan = function (ch, depth, own) {
    var gs = this.gs, self = this, L = this.labels;
    if (gs.has(ch)) return ['g', ch];
    if (depth > 5) return ['missing', ch];
    var F = this.font;
    if (!own && F && depth > 0 && F.has(ch)) return ['f', ch];
    var sub = function (c) { return self.plan(c, depth + 1, own); };
    var fb = FB[ch];
    // with the font available, an approximation (€ -> EUR) is worse than the real character
    if (fb !== undefined && !(F && APPROX.indexOf(ch) >= 0 && F.has(ch))) {
      if (typeof fb === 'string') {
        var parts = chars(fb).map(sub);
        var blank = fb.trim() === '';
        if (blank || parts.every(function (p) { return p[0] !== 'missing'; })) {
          this.fallbacks[ch] = blank ? '␣' : fb;
          return blank ? ['space', chars(fb).length] : (parts.length === 1 ? parts[0] : ['seq', parts]);
        }
      } else if (fb[0] === 't') {
        var sp = sub(fb[1]);
        if (sp[0] !== 'missing') { this.fallbacks[ch] = fb[1] + ' (' + L.small + ')'; return ['t', sp, fb[2], fb[3]]; }
      } else if (fb[0] === 'flip') {
        var fl = sub(fb[1]);
        if (fl[0] !== 'missing') { this.fallbacks[ch] = fb[1] + ' ↻'; return ['flip', fl, fb[2]]; }
      } else if (fb[0] === 'frac') {
        if (chars(fb[1] + fb[2]).every(function (c) { return sub(c)[0] !== 'missing'; })) {
          this.fallbacks[ch] = fb[1] + '/' + fb[2] + ' (' + L.frac + ')'; return ['frac', fb[1], fb[2], 0.5];
        }
      } else if (fb[0] === 'over') {
        var a = sub(fb[1]), b = sub(fb[2]);
        if (a[0] !== 'missing' && b[0] !== 'missing') { this.fallbacks[ch] = fb[1] + ' + ' + fb[2]; return ['over', a, b]; }
      } else if (fb[0] === 'slash') {
        var sl = sub(fb[1]);
        if (sl[0] !== 'missing') { this.fallbacks[ch] = fb[1] + ' + /'; return ['slash', sl, fb[2]]; }
      }
    }
    var d = ch.normalize ? ch.normalize('NFD') : ch;
    if (chars(d).length > 1 && chars(d)[0] !== ch) {
      var base = sub(chars(d)[0]);
      if (base[0] !== 'missing') {
        this.fallbacks[ch] = chars(d)[0] + ' ' + L.accent;
        return ['accent', base, chars(d).slice(1).filter(function (m) { return /[̀-ͯ]/.test(m); })];
      }
    }
    if (!own && F && F.has(ch)) return ['f', ch];
    // a scaled capital for a small letter (or the other way round) - only without the font,
    // whose letter has the right shape
    if (!F && /^\p{L}$/u.test(ch)) {
      var up = ch.toUpperCase(), lo = ch.toLowerCase();
      if (ch !== up && chars(up).length === 1 && gs.has(up)) { this.fallbacks[ch] = up + ' (' + L['case'] + ')'; return ['t', ['g', up], gs.xh, 0]; }
      if (ch !== lo && chars(lo).length === 1 && gs.has(lo)) { this.fallbacks[ch] = lo + ' (' + L['case'] + ')'; return ['t', ['g', lo], Math.min(1.6, 1 / gs.xh), 0]; }
    }
    return ['missing', ch];
  };
  TS.pick = function (key) {
    var lst = this.gs.usable(key), recent = this.recent[key] || (this.recent[key] = []);
    var avoid = Math.min(lst.length - 1, 2);
    var choices = avoid > 0 ? lst.filter(function (s) { return recent.slice(-avoid).indexOf(s) < 0; }) : lst;
    var s = this.rng.choice(choices.length ? choices : lst);
    recent.push(s); if (recent.length > 4) recent.shift();
    return s;
  };
  TS.glyphBox = function (key) {
    var s = this.pick(key), bb = s.bbox, cx = (bb[0] + bb[1]) / 2, cy = (bb[2] + bb[3]) / 2;
    var a = s.adjScale, dya = s.adjDy, v = this.v, rng = this.rng;
    var sc = 1 + gauss(rng, 0.03 * v), rot = gauss(rng, 1.3 * v) * Math.PI / 180, dy = gauss(rng, 0.014 * v);
    var cr = Math.cos(rot), sr = Math.sin(rot), rcy = 0.45, re = this.realShape();
    return new Box(this.tremor(s.strokes.map(function (st) { return st.map(function (p) {
      var x = cx + (p[0] - cx) * a, y = cy + (p[1] - cy) * a + dya;
      x = cx + (x - cx) * sc * re.sx + re.sh * (y - rcy); y = y * sc;
      var xr = x - cx, yr = y - rcy;
      return [cx + xr * cr - yr * sr, rcy + xr * sr + yr * cr + dy];
    }); })));
  };
  /* Realism (option): every letter a little wider or narrower and a little more or less slanted ... */
  TS.realShape = function () {
    if (!this.real) return { sx: 1, sh: 0 };
    return { sx: 1 + gauss(this.rng, 0.045 * this.v), sh: gauss(this.rng, 0.035 * this.v) };
  };
  /* ... and a gentle, smooth hand tremor along each stroke (two slow waves, not noise). */
  TS.tremor = function (strokes) {
    if (!this.real || !this.v) return strokes;
    var rng = this.rng, A = 0.0055 * this.v;
    return strokes.map(function (st) {
      var p1 = rng.uniform(0, 6.28), p2 = rng.uniform(0, 6.28), p3 = rng.uniform(0, 6.28), s = 0;
      return st.map(function (p, i) {
        if (i) s += Math.hypot(p[0] - st[i - 1][0], p[1] - st[i - 1][1]);
        return [p[0] + A * (Math.sin(p1 + s * 12.6) + 0.25 * Math.sin(p3 + s * 37)),
                p[1] + A * (Math.sin(p2 + s * 11.3) + 0.25 * Math.sin(p1 + s * 41))];
      });
    });
  };
  // A character from the standard-handwriting font, fitted to this handwriting (size, x-height,
  // slant) and varied like a real sample so it does not look printed.
  TS.fontBox = function (ch) {
    var gs = this.gs, v = this.v, rng = this.rng, g = this.font.glyphs[ch];
    var k = gs.cap;
    if (/^\p{Ll}$/u.test(ch)) k *= Math.max(0.8, Math.min(1.08, gs.xh / this.font.xh));
    var sc = 1 + gauss(rng, 0.03 * v), rot = gauss(rng, 1.2 * v) * Math.PI / 180, dy = gauss(rng, 0.012 * v);
    var cr = Math.cos(rot), sr = Math.sin(rot), sl = gs.slant, amp = 0.007 * v, ph = rng.uniform(0, 6.28), rcy = 0.45, re = this.realShape();
    return new Box(this.tremor(g.strokes.map(function (st) { return st.map(function (p) {
      var y = p[1] * k * sc, x = p[0] * k * sc * re.sx + (sl + re.sh) * y;
      x += amp * Math.sin(ph + y * 9); y += amp * Math.sin(ph * 1.3 + x * 9);
      var yr = y - rcy;
      return [x * cr - yr * sr, rcy + x * sr + yr * cr + dy];
    }); })));
  };
  TS.missingBox = function (ch) {
    this.missing[ch] = (this.missing[ch] || 0) + 1;
    var c = [[0, 0], [0.45, 0], [0.45, 0.7], [0, 0.7], [0, 0]], r = [];
    for (var i = 0; i < 4; i++) for (var t = 0; t < 8; t++)
      r.push([c[i][0] + (c[i + 1][0] - c[i][0]) * t / 8, c[i][1] + (c[i + 1][1] - c[i][1]) * t / 8]);
    r.push([0, 0]);
    return new Box([], [r]);
  };
  TS.boxFor = function (p) {
    var self = this;
    switch (p[0]) {
      case 'g': return this.glyphBox(p[1]);
      case 'f': return this.fontBox(p[1]);
      case 'missing': return this.missingBox(p[1]);
      case 'seq': return this.join(p[1].map(function (q) { return self.boxFor(q); }));
      case 't': return this.boxFor(p[1]).transformed(p[2], p[2], p[3]);
      case 'flip': return this.boxFor(p[1]).transformed(-1, -1, p[2]);
      case 'frac': return this.fractionBox(p[1], p[2], p[3] || 0.62);
      case 'accent': return this.accentBox(this.boxFor(p[1]), p[2]);
      case 'over':
        var a = this.boxFor(p[1]), b = this.boxFor(p[2]), W = Math.max(a.w, b.w);
        var sh = function (box) { return box.ink.map(function (st) { return st.map(function (q) { return [q[0] + (W - box.w) / 2, q[1]]; }); }); };
        return new Box(sh(a).concat(sh(b)), a.marks.concat(b.marks));
      case 'slash': return this.slashBox(this.boxFor(p[1]), p[2]);
      case 'space': return Box.spacer(this.wordSpace * p[1]);
    }
    throw new Error('plan ' + p[0]);
  };
  TS.join = function (boxes, gap) {
    if (!boxes.length) return new Box([], []);
    gap = gap === undefined ? this.tracking : gap;
    var ink = [], marks = [], x = 0, prev = null, k = this.kerning;
    boxes.forEach(function (b) {
      if (prev) x += kernOffset(prev, b, gap, k);
      b.ink.forEach(function (st) { ink.push(st.map(function (q) { return [q[0] + x, q[1]]; })); });
      b.marks.forEach(function (st) { marks.push(st.map(function (q) { return [q[0] + x, q[1]]; })); });
      prev = b;
    });
    return new Box(ink, marks);
  };
  TS.textBoxes = function (text, scale) {
    var self = this;
    return chars(text).map(function (ch) {
      if (ch === ' ') return Box.spacer(self.wordSpace * 0.6 * scale);
      var b = self.boxFor(self.plan(ch));
      return scale !== 1 ? b.transformed(scale, scale, 0) : b;
    });
  };
  TS.fractionBox = function (num, den, scale) {
    var nb = this.join(this.textBoxes(num.trim(), scale), this.tracking * scale);
    var db = this.join(this.textBoxes(den.trim(), scale), this.tracking * scale);
    var barY = 0.46 + gauss(this.rng, 0.01 * this.v), pad = 0.07, W = Math.max(nb.w, db.w) + 2 * pad, ink = [], marks = [];
    [[nb, barY + 0.09 - nb.ymin], [db, barY - 0.09 - db.ymax]].forEach(function (pair) {
      var b = pair[0], dy = pair[1], ox = (W - b.w) / 2;
      b.ink.forEach(function (st) { ink.push(st.map(function (q) { return [q[0] + ox, q[1] + dy]; })); });
      b.marks.forEach(function (st) { marks.push(st.map(function (q) { return [q[0] + ox, q[1] + dy]; })); });
    });
    ink.push(this.barStroke(W, barY));
    return new Box(ink, marks);
  };
  TS.barStroke = function (width, y) {
    var lst = this.gs.usable('-') || this.gs.usable('–');
    if (lst) {
      var s = this.rng.choice(lst), pts = s.strokes.reduce(function (m, st) { return st.length > m.length ? st : m; }, []);
      var bb = bboxOf([pts]);
      if (bb[1] - bb[0] > 0.05) {
        var cy = (bb[2] + bb[3]) / 2;
        return pts.map(function (p) { return [(p[0] - bb[0]) / (bb[1] - bb[0]) * width, y + (p[1] - cy) * 0.5]; });
      }
    }
    var n = Math.max(4, Math.floor(width / 0.05)), ph = this.rng.random() * 6.28, out = [];
    for (var i = 0; i <= n; i++) out.push([width * i / n, y + 0.008 * Math.sin(ph + i * 0.9)]);
    return out;
  };
  TS.accentBox = function (base, marks) {
    var ink = base.ink.map(function (st) { return st.slice(); }), cx = base.w / 2, top = base.ymax + 0.12, r = this.rng, v = this.v;
    var j = function (s) { return gauss(r, s * v); }, i;
    marks.forEach(function (m) {
      var code = m.charCodeAt(0), pts = [];
      if (code === 0x308) { var dx = Math.max(0.09, Math.min(0.15, base.w * 0.22)); [-1, 1].forEach(function (sx) { ink.push([[cx + sx * dx + j(0.01), top + 0.02 + j(0.01)]]); }); return; }
      if (code === 0x301 || code === 0x300) { var d = code === 0x301 ? 1 : -1; pts = [[cx - 0.05 * d + j(0.01), top], [cx + 0.06 * d + j(0.01), top + 0.13]]; }
      else if (code === 0x302) pts = [[cx - 0.09, top], [cx, top + 0.12 + j(0.01)], [cx + 0.09, top]];
      else if (code === 0x303) for (i = 0; i < 11; i++) pts.push([cx - 0.11 + i * 0.022, top + 0.04 + 0.035 * Math.sin(i * 0.63)]);
      else if (code === 0x30A) for (i = 0; i < 14; i++) pts.push([cx + 0.055 * Math.cos(i * 0.5), top + 0.06 + 0.055 * Math.sin(i * 0.5)]);
      else if (code === 0x327) pts = [[cx, 0], [cx + 0.03, -0.07], [cx - 0.04, -0.12]];
      else if (code === 0x328) pts = [[base.w * 0.8, 0], [base.w * 0.72, -0.08], [base.w * 0.85, -0.13]];   // ogonek
      else if (code === 0x30C) pts = [[cx - 0.08, top + 0.12], [cx, top], [cx + 0.08, top + 0.12]];
      else if (code === 0x306) for (i = 0; i < 9; i++) pts.push([cx - 0.08 + i * 0.02, top + 0.09 - 0.07 * Math.sin(i / 8 * Math.PI)]);
      else if (code === 0x304) pts = [[cx - 0.09, top + 0.04], [cx + 0.09, top + 0.04]];
      else if (code === 0x307) pts = [[cx, top + 0.03]];
      else pts = [[cx, top + 0.03]];
      ink.push(pts);
    });
    return new Box(ink, base.marks.map(function (st) { return st.slice(); }));
  };
  // ł Ł: short slanted stroke through the stem (left stem for Ł, middle for ł)
  TS.slashBox = function (base, left) {
    var x0 = Infinity; base.ink.forEach(function (st) { st.forEach(function (q) { if (q[1] > 0.2 && q[1] < 0.6 && q[0] < x0) x0 = q[0]; }); });
    var cx = left ? (x0 === Infinity ? 0.1 : x0) : base.w / 2, j = gauss(this.rng, 0.01 * this.v);
    var ink = base.ink.map(function (st) { return st.slice(); });
    ink.push([[cx - 0.13, 0.3 + j], [cx + 0.14, 0.56 + j]]);
    return new Box(ink, base.marks.map(function (st) { return st.slice(); }));
  };
  TS.charsToItems = function (s) {
    var out = [], cs = chars(s), i = 0, mk = this.gs.multiKeys;
    // only look ahead as far as the longest multi-character key (joining the whole rest made long paragraphs quadratic)
    var maxK = 0; mk.forEach(function (key) { maxK = Math.max(maxK, chars(key).length); });
    while (i < cs.length) {
      var hit = null, rest = maxK ? cs.slice(i, i + maxK).join('') : '';
      for (var k = 0; k < mk.length; k++) if (rest.indexOf(mk[k]) === 0) { hit = mk[k]; break; }
      if (hit) { out.push(['g', hit]); i += chars(hit).length; continue; }
      var ch = cs[i++];
      if (ch === ' ') { out.push(['space', 1]); continue; }
      if (/[\p{Cc}\p{Cf}]/u.test(ch) && ch !== '\t') continue;
      var p = this.plan(ch);
      out.push(p[0] === 'space' ? ['space', p[1]] : p);
    }
    return out;
  };
  TS.tokenizeLine = function (line) {
    var items = [], pos = 0, m, self = this;
    FRACTION_RE.lastIndex = 0;
    while ((m = FRACTION_RE.exec(line))) {
      items = items.concat(this.charsToItems(line.slice(pos, m.index)));
      items.push(['frac', m[1], m[2], 0.62]); pos = m.index + m[0].length;
    }
    items = items.concat(this.charsToItems(line.slice(pos)));
    var tokens = [], word = [];
    items.forEach(function (it) {
      if (it[0] === 'space') {
        if (word.length) { tokens.push(['word', word]); word = []; }
        var last = tokens[tokens.length - 1];
        if (last && last[0] === 'space') last[1] += it[1]; else tokens.push(['space', it[1]]);
      } else word.push(it);
    });
    if (word.length) tokens.push(['word', word]);
    void self; return tokens;
  };
  TS.spaceWidth = function (n) { return n * this.wordSpace * (1 + gauss(this.rng, 0.06 * this.v, 2)); };
  // never narrower than the pen (about 0.075), else neighbours touch at a high irregularity
  TS.gap = function () { return Math.max(Math.min(0.1, this.tracking), this.tracking * (1 + gauss(this.rng, 0.22 * this.v))); };

  /* One source line -> block description. md = simple Markdown on/off. */
  function parseBlock(raw, md) {
    if (PAGEBREAK_RE.test(raw) || raw === '\f') return { pagebreak: true };
    var b = { text: raw, scale: 1, indent: 0, bullet: null, underline: false, rule: false }, m;
    if (!md) return b;
    var lead = function (sp) { return Math.min(3, Math.floor(sp.replace(/\t/g, '  ').length / 2)); };
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { b.rule = true; b.text = ''; return b; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(raw))) { var lv = m[1].length; b.text = m[2].replace(/\s+#+\s*$/, ''); b.scale = [1.55, 1.3, 1.12][lv - 1]; b.underline = lv === 1; }
    else if ((m = /^(\s*)[-*+•]\s+(.*)$/.exec(raw))) { b.text = m[2]; b.indent = 1.3 + 1.3 * lead(m[1]); b.bullet = '-'; }
    else if ((m = /^(\s*)(\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/.exec(raw))) { b.text = m[3]; b.indent = 1.7 + 1.3 * lead(m[1]); b.bullet = m[2]; }
    else if ((m = /^>\s?(.*)$/.exec(raw))) { b.text = m[1]; b.indent = 1.3; }
    // emphasis markers and code ticks are not drawn (handwriting has no bold face)
    b.text = b.text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`([^`\n]+)`/g, '$1');
    return b;
  }

  /** Returns lines: {items: [[box, x]], pagebreak, underline, rule} (x in units of the text size). */
  function layout(text, ts, maxW, md) {
    var lines = [];
    text.split('\n').forEach(function (raw) {
      var blk = parseBlock(raw, md);
      if (blk.pagebreak) { lines.push({ items: [], pagebreak: true }); return; }
      if (blk.rule) { lines.push({ items: [], rule: true }); return; }
      var sc = blk.scale, ind = blk.indent;
      var line = { items: [], underline: blk.underline }, x = ind;
      if (blk.bullet) {
        var bb = ts.join(ts.textBoxes(blk.bullet, 1));
        line.items.push([bb, Math.max(0, ind - bb.w - 0.45)]);
      }
      var placed = false;
      var fresh = function () { lines.push(line); line = { items: [], underline: blk.underline }; x = ind; placed = false; };
      ts.tokenizeLine(blk.text).forEach(function (tok) {
        if (tok[0] === 'space') { x += ts.spaceWidth(tok[1]) * sc; return; }
        var boxes = tok[1].map(function (p) { var b = ts.boxFor(p); return sc !== 1 ? b.transformed(sc, sc, 0) : b; });
        var rel = [], cx = 0, prev = null;
        boxes.forEach(function (b) { if (prev) cx += kernOffset(prev, b, ts.gap() * sc, ts.kerning); rel.push(cx); prev = b; });
        var wlen = boxes.length ? rel[rel.length - 1] + boxes[boxes.length - 1].w : 0;
        if (placed && x + wlen > maxW) fresh();
        if (wlen > maxW - ind) {   // word longer than the line: hard break
          var start = rel[0] || 0;
          boxes.forEach(function (b, i) {
            if (placed && x + (rel[i] - start) + b.w > maxW) { fresh(); start = rel[i]; }
            line.items.push([b, x + (rel[i] - start)]); placed = true;
          });
          x = x + (rel[rel.length - 1] - start) + boxes[boxes.length - 1].w;
          return;
        }
        boxes.forEach(function (b, i) { line.items.push([b, x + rel[i]]); });
        x += wlen; placed = true;
      });
      lines.push(line);
    });
    while (lines.length > 1 && !lines[lines.length - 1].items.length && !lines[lines.length - 1].rule && !lines[lines.length - 1].pagebreak) lines.pop();
    return lines;
  }

  /** opt: {page:'a4'|'a5'|'a3'|'letter'|'auto', landscape, width, margin, size, lineHeight, lineSpacing,
   *        paper:'blank'|'lined'|'grid', align, variation, tracking, wordSpace, kerning, seed, labels,
   *        markdown, font (standard-handwriting data), fallbackFont (false = red boxes),
   *        realism (tremor, stretch, pen pressure, word hops)} */
  function buildPages(text, gs, opt) {
    var o = Object.assign({ page: 'a4', width: 180, size: 5, lineHeight: 2.0, paper: 'blank', align: 'left', variation: 1, seed: 1, markdown: false }, opt || {});
    if (o.margin === undefined || o.margin === null) o.margin = o.page === 'auto' ? 8 : 20;
    // broken numbers (old or edited files) must not turn into NaN coordinates in PNG/SVG/PDF
    var finite = function (v, d) { v = Number(v); return isFinite(v) ? v : d; };
    o.size = finite(o.size, 5) > 0 ? finite(o.size, 5) : 5; o.variation = Math.max(0, finite(o.variation, 1));
    o.margin = Math.max(0, finite(o.margin, 20)); o.width = finite(o.width, 180) > 0 ? finite(o.width, 180) : 180;
    var rng = makeRng(o.seed), ts = new Typesetter(gs, rng, o), size = o.size, pw, ph;
    text = String(text || '').replace(/\r\n?/g, '\n'); if (text.normalize) text = text.normalize('NFC');
    if (o.page === 'auto') { pw = o.width; ph = null; }
    else { var ps = PAGE_SIZES[o.page] || PAGE_SIZES.a4; pw = ps[0]; ph = ps[1]; if (o.landscape) { var tmp = pw; pw = ph; ph = tmp; } }
    var ml = o.margin, mr = o.margin, mt = o.margin, mb = o.margin;
    var contentW = Math.max(size * 3, pw - ml - mr), maxW = contentW / size - 0.15;
    var lineH = o.lineSpacing || o.lineHeight * size, first = mt + size * 1.3, grid = 5;
    if (o.paper === 'grid') { lineH = Math.max(grid, Math.round(lineH / grid) * grid); first = Math.ceil(first / grid) * grid; }
    var lines = layout(text, ts, maxW, !!o.markdown);
    var perPage = ph === null ? Infinity : Math.max(1, Math.floor((ph - mb - size * 0.55 - first) / lineH) + 1);
    var chunks = [[]];
    lines.forEach(function (l) {
      var cur = chunks[chunks.length - 1];
      if (l.pagebreak) { chunks.push([]); return; }
      if (cur.length >= perPage) chunks.push(cur = []);
      cur.push(l);
    });
    // "fit to text": every page as high as its own lines (a short last page after [[pagebreak]] stays short)
    var fit = ph === null;
    var heightOf = function (chunk) { return fit ? first + (Math.max(1, chunk.length) - 1) * lineH + size * 0.7 + mb : ph; };
    var pages = [], real = !!o.realism;
    // realism: pen pressure - each stroke a little thicker or thinner, starting and ending lighter
    // (pg.inkW holds a width factor per stroke)
    var addInk = function (pg, st) {
      if (!real) { pg.ink.push(st); return; }
      var f = Math.max(0.75, Math.min(1.25, 1 + gauss(rng, 0.09 * o.variation))), n = st.length;
      var put = function (a, b, k) { pg.ink.push(st.slice(a, b)); pg.inkW.push(Math.round(f * k * 20) / 20); };
      if (n < 12) { put(0, n, 1); return; }
      var k = Math.max(1, Math.round(n * 0.07));
      put(0, k + 1, 0.7); put(k, 2 * k + 1, 0.86); put(2 * k, n - 2 * k, 1);
      put(n - 2 * k - 1, n - k, 0.88); put(n - k - 1, n, 0.76);
    };
    chunks.forEach(function (chunk) {
      var h = heightOf(chunk), pg = { w: pw, h: h, ink: [], marks: [], rules: [] };
      if (real) pg.inkW = [];
      pages.push(pg);
      if (o.paper === 'lined') { for (var y = first; y < h - 4; y += lineH) pg.rules.push([ml - 2, y, pw - mr + 2, y]); }
      else if (o.paper === 'grid') {
        for (var gx = 0; gx <= pw + 1e-6; gx += grid) pg.rules.push([gx, 0, gx, h]);
        for (var gy = 0; gy <= h + 1e-6; gy += grid) pg.rules.push([0, gy, pw, gy]);
      }
      chunk.forEach(function (line, li) {
        if (!line.items.length && !line.rule) return;
        var base = first + li * lineH, v = o.variation;
        var slope = Math.tan(gauss(rng, 0.3 * v) * Math.PI / 180), amp = 0.02 * v, period = rng.uniform(7, 13), phase = rng.uniform(0, 2 * Math.PI);
        var xStart = gauss(rng, 0.04 * v), lineW = 0;
        // realism: the size breathes slowly along the line, and each word sits a little higher or lower
        var sAmp = 0, sPer = 1, sPh = 0, hop = 0, prevEnd = -Infinity;
        if (real) { sAmp = 0.022 * v; sPer = rng.uniform(8, 15); sPh = rng.uniform(0, 2 * Math.PI); }
        var hops = line.items.map(function (e) {
          if (real && e[1] - prevEnd > 0.3) hop = gauss(rng, 0.012 * v);
          prevEnd = e[1] + e[0].w; return hop;
        });
        var items = line.items.slice();
        if (line.rule) items.push([new Box([ts.barStroke(maxW * 0.98, 0.3)], []), 0]);
        items.forEach(function (e) { lineW = Math.max(lineW, e[1] + e[0].w); });
        if (line.underline && lineW > 0) items.push([new Box([ts.barStroke(lineW, -0.16)], []), 0]);
        var shift = line.rule ? 0 : o.align === 'center' ? (maxW - lineW) / 2 : o.align === 'right' ? maxW - lineW : 0;
        var ox = ml + (shift + xStart) * size;
        var tf = function (st, x, h) { return st.map(function (p) {
          var u = x + p[0], yy = p[1] * (1 + sAmp * Math.sin(sPh + u * 2 * Math.PI / sPer)) + h + u * slope + amp * Math.sin(phase + u * 2 * Math.PI / period);
          return [ox + u * size, base - yy * size];
        }); };
        items.forEach(function (e, i) {
          var h = hops[i] || 0;
          e[0].ink.forEach(function (st) { addInk(pg, tf(st, e[1], h)); });
          e[0].marks.forEach(function (st) { pg.marks.push(tf(st, e[1], h)); });
        });
      });
    });
    pages.forEach(function (pg) { keepInside(pg, penWidth(o), fit, o.paper, grid); });
    return { pages: pages, missing: Object.keys(ts.missing), fallbacks: ts.fallbacks, font: Object.keys(ts.fontChars),
             lines: lines.filter(function (l) { return !l.pagebreak; }).length, seed: o.seed };
  }

  // Nothing may stick out of the page (same rule as keep_inside in the Python skill): slant, tremor, pen
  // pressure and the pen width can carry a stroke past a margin of 0 - it was cut off ("0" looked open).
  // Move the writing in by the overhang and, for "fit to text", let the page grow. pg.inkBox = visible ink.
  var EDGE_AIR = 0.5;
  function keepInside(pg, pen, fit, paper, grid) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pg.ink.concat(pg.marks).forEach(function (st) { st.forEach(function (p) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }); });
    if (x0 === Infinity) return;
    var half = pen * Math.max(1, pg.inkW && pg.inkW.length ? Math.max.apply(null, pg.inkW) : 1) / 2;
    x0 -= half; y0 -= half; x1 += half; y1 += half;
    var shift = function (lo, hi, size) {
      if (lo < EDGE_AIR) return EDGE_AIR - lo;
      if (!fit && hi > size - EDGE_AIR) return -Math.min(hi - (size - EDGE_AIR), lo - EDGE_AIR);
      return 0;
    };
    var dx = shift(x0, x1, pg.w), dy = shift(y0, y1, pg.h);
    if (dx || dy) {
      var mv = function (st) { return st.map(function (p) { return [p[0] + dx, p[1] + dy]; }); };
      pg.ink = pg.ink.map(mv); pg.marks = pg.marks.map(mv);
      pg.rules = pg.rules.map(function (r) { return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]; });
      x0 += dx; x1 += dx; y0 += dy; y1 += dy;
    }
    if (fit) { pg.w = Math.max(pg.w + dx, x1 + EDGE_AIR); pg.h = Math.max(pg.h + dy, y1 + EDGE_AIR); }
    if (paper === 'grid' && (dx || dy || fit)) {
      // rebuild the grid over the (new) page, still aligned with the shifted baselines
      pg.rules = [];
      for (var gx = ((dx % grid) + grid) % grid; gx <= pg.w + 1e-6; gx += grid) pg.rules.push([gx, 0, gx, pg.h]);
      for (var gy = ((dy % grid) + grid) % grid; gy <= pg.h + 1e-6; gy += grid) pg.rules.push([0, gy, pg.w, gy]);
    }
    pg.inkBox = [x0, y0, x1, y1].map(function (v) { return Math.round(v * 100) / 100; });
  }

  /* ---------------- output ---------------- */
  function color(c) { return INK[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? c : INK.blue); }
  function penWidth(o) { return o.pen || Math.max(0.25, (o.size || 5) * 0.075); }
  /* Ink strokes grouped by width factor (pen pressure, realism option): [[factor, strokes], ...]. */
  function inkGroups(pg) {
    if (!pg.inkW) return [[1, pg.ink]];
    var g = {};
    pg.ink.forEach(function (st, i) { var f = pg.inkW[i] || 1; (g[f] || (g[f] = [])).push(st); });
    return Object.keys(g).map(Number).sort().map(function (f) { return [f, g[f]]; });
  }

  /** Draws a page on a 2D context; k = pixels per millimetre. */
  function drawPage(ctx, pg, k, o) {
    o = o || {};
    ctx.save();
    if (!o.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pg.w * k, pg.h * k); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pg.rules.length) {
      ctx.strokeStyle = o.paper === 'grid' ? '#d6dded' : '#bcc6e0'; ctx.lineWidth = Math.max(0.6, 0.22 * k);
      ctx.beginPath(); pg.rules.forEach(function (r) { ctx.moveTo(r[0] * k, r[1] * k); ctx.lineTo(r[2] * k, r[3] * k); }); ctx.stroke();
    }
    var poly = function (list) {
      ctx.beginPath();
      list.forEach(function (st) {
        if (!st.length) return;
        ctx.moveTo(st[0][0] * k, st[0][1] * k);
        if (st.length === 1) ctx.lineTo(st[0][0] * k + 0.01, st[0][1] * k);
        for (var i = 1; i < st.length; i++) ctx.lineTo(st[i][0] * k, st[i][1] * k);
      });
      ctx.stroke();
    };
    ctx.strokeStyle = color(o.color);
    inkGroups(pg).forEach(function (gr) { ctx.lineWidth = Math.max(0.8 * gr[0], penWidth(o) * gr[0] * k); poly(gr[1]); });
    if (pg.marks.length && !o.hideMissing) { ctx.strokeStyle = '#d92626'; ctx.lineWidth = Math.max(0.8, 0.3 * k); poly(pg.marks); }
    ctx.restore();
  }
  function f2(v) { var s = v.toFixed(2); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function pathData(list, H, pt) {
    return list.filter(function (st) { return st.length; }).map(function (st) {
      var P = st.map(function (p) { return pt ? [p[0] * pt, (H - p[1]) * pt] : p; });
      var s = (pt ? '' : 'M') + f2(P[0][0]) + ' ' + f2(P[0][1]) + (pt ? ' m' : '');
      if (P.length === 1) return s + (pt ? '\n' + f2(P[0][0] + 0.01) + ' ' + f2(P[0][1]) + ' l' : 'l0.01 0');
      return s + (pt ? '\n' : 'L') + P.slice(1).map(function (p) { return f2(p[0]) + ' ' + f2(p[1]) + (pt ? ' l' : ''); }).join(pt ? '\n' : ' ');
    }).join(pt ? '\n' : ' ');
  }
  function toSVG(pg, o) {
    o = o || {};
    var el = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + f2(pg.w) + 'mm" height="' + f2(pg.h) + 'mm" viewBox="0 0 ' + f2(pg.w) + ' ' + f2(pg.h) + '">'];
    if (!o.transparent) el.push('<rect width="100%" height="100%" fill="#ffffff"/>');
    if (pg.rules.length) el.push('<path d="' + pg.rules.map(function (r) { return 'M' + f2(r[0]) + ' ' + f2(r[1]) + 'L' + f2(r[2]) + ' ' + f2(r[3]); }).join(' ') +
      '" stroke="' + (o.paper === 'grid' ? '#d6dded' : '#bcc6e0') + '" stroke-width="0.22" fill="none"/>');
    if (pg.ink.length) inkGroups(pg).forEach(function (gr) {
      el.push('<path d="' + pathData(gr[1]) + '" fill="none" stroke="' + color(o.color) + '" stroke-width="' + f2(penWidth(o) * gr[0]) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    });
    if (pg.marks.length && !o.hideMissing) el.push('<path d="' + pathData(pg.marks) + '" fill="none" stroke="#d92626" stroke-width="0.3"/>');
    el.push('</svg>');
    return el.join('\n') + '\n';
  }
  /** Same PDF, but content streams compressed (FlateDecode) when the browser has CompressionStream.
   *  Resolves to a Blob. Falls back to the uncompressed version. */
  function toPDFBlob(pages, o) {
    if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') {
      return Promise.resolve(new Blob([toPDF(pages, o)], { type: 'application/pdf' }));
    }
    var enc = new TextEncoder();
    function deflate(str) {
      var cs = new CompressionStream('deflate');
      return new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    // Build the uncompressed file once, then swap every stream for its compressed bytes.
    var plain = toPDF(pages, o);
    plain = plain.slice(0, plain.lastIndexOf('\nxref\n') + 1);   // the xref table is rebuilt below
    var re =/(\d+) 0 obj\n<< \/Length (\d+) >>\nstream\n/g, m, jobs = [], last = 0, parts = [];
    while ((m = re.exec(plain))) {
      var start = m.index + m[0].length, len = +m[2];
      parts.push(plain.slice(last, m.index), { id: m[1], body: plain.slice(start, start + len) });
      last = start + len;
    }
    parts.push(plain.slice(last));
    parts.forEach(function (p) { if (typeof p === 'object') jobs.push(deflate(p.body).then(function (z) { p.z = z; })); });
    return Promise.all(jobs).then(function () {
      // re-assemble with correct byte offsets
      var chunks = [], size = 0, offs = {};
      function add(x) { var b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); size += b.length; }
      var text = '';
      parts.forEach(function (p) {
        if (typeof p === 'string') { text += p; return; }
        text += p.id + ' 0 obj\n<< /Length ' + p.z.length + ' /Filter /FlateDecode >>\nstream\n';
        add(text); text = ''; add(p.z); text = '';
      });
      add(text);
      var all = new Uint8Array(size), pos = 0;
      chunks.forEach(function (c) { all.set(c, pos); pos += c.length; });
      // new xref table: byte offset of each "n 0 obj" at a line start (first match wins; compressed
      // stream bytes come after their own object header, so they cannot shadow it)
      var xi = all.length, head = all, objRe = /\n(\d+) 0 obj\n/g, mm;
      var headStr = new TextDecoder('latin1').decode(head);
      while ((mm = objRe.exec(headStr))) if (offs[+mm[1]] === undefined) offs[+mm[1]] = mm.index + 1;
      var n = Object.keys(offs).length, x = 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n';
      for (var i = 1; i <= n; i++) x += ('0000000000' + offs[i]).slice(-10) + ' 00000 n \n';
      x += 'trailer\n<< /Size ' + (n + 1) + ' /Root 1 0 R /Info ' + n + ' 0 R >>\nstartxref\n' + xi + '\n%%EOF\n';
      return new Blob([head, enc.encode(x)], { type: 'application/pdf' });
    });
  }
  /** Minimal vector PDF (one page per page object, uncompressed, ASCII only). Returns a string. */
  function toPDF(pages, o) {
    o = o || {}; var PT = 72 / 25.4, hex = color(o.color).slice(1);
    var rgb = [0, 2, 4].map(function (i) { return (parseInt(hex.substr(i, 2), 16) / 255).toFixed(3); }).join(' ');
    var objs = [], kids = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var id = 3;
    pages.forEach(function (pg) {
      var parts = [];
      if (pg.rules.length) {
        parts.push('q ' + (o.paper === 'grid' ? '0.84 0.87 0.93' : '0.74 0.78 0.88') + ' RG ' + f2(0.22 * PT) + ' w');
        pg.rules.forEach(function (r) { parts.push(f2(r[0] * PT) + ' ' + f2((pg.h - r[1]) * PT) + ' m ' + f2(r[2] * PT) + ' ' + f2((pg.h - r[3]) * PT) + ' l'); });
        parts.push('S Q');
      }
      if (pg.ink.length) inkGroups(pg).forEach(function (gr) {
        parts.push('q ' + rgb + ' RG ' + f2(penWidth(o) * gr[0] * PT) + ' w 1 J 1 j'); parts.push(pathData(gr[1], pg.h, PT)); parts.push('S Q');
      });
      if (pg.marks.length && !o.hideMissing) { parts.push('q 0.85 0.15 0.15 RG ' + f2(0.3 * PT) + ' w 1 J 1 j'); parts.push(pathData(pg.marks, pg.h, PT)); parts.push('S Q'); }
      var content = parts.join('\n'), pid = id++, cid = id++;
      kids.push(pid);
      objs[cid] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
      objs[pid] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f2(pg.w * PT) + ' ' + f2(pg.h * PT) + '] /Resources << >> /Contents ' + cid + ' 0 R >>';
    });
    objs[2] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
    var info = id; objs[info] = '<< /Producer (my-handwriting web) >>';
    var out = '%PDF-1.4\n', offs = [];
    for (var i = 1; i <= info; i++) { offs[i] = out.length; out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
    var xref = out.length;
    out += 'xref\n0 ' + (info + 1) + '\n0000000000 65535 f \n';
    for (i = 1; i <= info; i++) out += ('0000000000' + offs[i]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return out;
  }

  var api = { GlyphSet: GlyphSet, FontSet: FontSet, Typesetter: Typesetter, buildPages: buildPages, parseBlock: parseBlock, APPROX: APPROX, drawPage: drawPage, toSVG: toSVG, toPDF: toPDF, toPDFBlob: toPDFBlob,
              makeRng: makeRng, suspectReasons: suspectReasons, INK: INK, PAGE_SIZES: PAGE_SIZES, FALLBACKS: FB };
  if (typeof window !== 'undefined') window.Render = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
