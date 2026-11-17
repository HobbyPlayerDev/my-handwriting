/* my-handwriting - capture app: write samples, keep them in the browser, export/import,
 * write texts with them (js/render.js). Everything stays on this device. */
(function () {
  'use strict';
  var t = I18N.t;

  /* ------------------------------------------------------------------ *
   *  Constants – must match the Python renderer (data format version 1) *
   * ------------------------------------------------------------------ */
  var APP_VERSION = '1.0.0';
  var FORMAT = 'my-handwriting-glyphs';
  var LEGACY_FORMATS = ['handschrift-glyphs'];   // files from before the project was renamed
  var FORMAT_VERSION = 1;
  var SCALE = 1000;                         // coordinates are stored as integers ×1000
  var M = { cap: 1.0, xheight: 0.6, baseline: 0, descender: -0.4, boxTop: 1.45, boxBottom: -0.6, boxWidth: 2.2 };
  var BOX_H = M.boxTop - M.boxBottom;
  var PEN = 0.05;                           // pen width in units (cap height = 1)
  var MIN_DIST = 0.004;                     // points closer than this are dropped
  var ERASE_R = 0.06;                       // eraser radius in units
  var TEMPLATE_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
  var BASE_GROUPS = ['upper', 'lower', 'digits', 'punct', 'math', 'special'];
  var PAPERS = ['blank', 'lined', 'grid'], SIZES = [3.5, 4, 5, 6, 8, 10, 14, 20], COLORS = ['blue', 'royal', 'black', 'pencil', 'red', 'green'];
  var PAGES = ['a4', 'a5', 'letter'];
  var PEN_KEY = 'my-handwriting-pen';         // device setting: a pen was used here before (palm rejection from the start)

  /* ------------------------------ state ------------------------------ */
  var state = defaultState();
  var current = null;          // current character
  var drawing = [];            // strokes: [[ [x,y], … ], …] in units
  var history = [];            // undo snapshots of `drawing`
  var activePointer = null, activeRect = null, lastPointerType = 'unknown', erasing = false, erasedAny = false;
  var penSeen = (function () { try { return localStorage.getItem(PEN_KEY) === '1'; } catch (e) { return false; } })();
  var storageMode = 'none';    // 'idb' | 'local' | 'none'
  var saveTimer = null, saveOk = true;

  function defaultState() {
    return {
      glyphs: {},
      settings: { target: 10, mode: 'char', penOnly: 'auto', custom: '', groups: {}, scripts: null,
                  template: true, templateAlpha: 0.15, lang: null, fallbackFont: true,
                  claude: { lang: null, paper: 'lined', size: 6, color: 'blue', page: 'a4' },
                  write: { size: 6, paper: 'lined', page: 'a4', color: 'blue', align: 'left', variation: 1, transparent: false, text: null, markdown: false } },
      meta: { created: Date.now(), lastExport: null, samplesAtExport: 0, introSeen: false, wizardDone: false, current: null, persistAsked: false }
    };
  }

  /* ------------------------------ helpers ------------------------------ */
  function $(id) { return document.getElementById(id); }
  function chars(s) { return Array.from(s || ''); }
  function nfc(s) { try { return s.normalize('NFC'); } catch (e) { return s; } }
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function count(ch) { var a = state.glyphs[ch]; return a ? a.length : 0; }
  function target() { return clamp(parseInt(state.settings.target, 10) || 10, 1, 50); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function scripts() { return Array.isArray(state.settings.scripts) ? state.settings.scripts : []; }

  /* ------------------------------ groups ------------------------------ */
  // Order on screen: capitals, small letters, language letters, digits, punctuation, maths, symbols, own.
  function groups() {
    var out = [], seen = {}, seenOn = {};
    function add(id, raw, kind, extra) {
      var on = state.settings.groups[id] !== false;
      var list = [];
      chars(raw).forEach(function (c) { if (!seen[c] && list.indexOf(c) < 0) list.push(c); });
      list.forEach(function (c) { seen[c] = 1; if (on) seenOn[c] = 1; });
      out.push(Object.assign({ id: id, kind: kind, chars: list, on: on }, extra || {}));
    }
    var base = {}; Charsets.BASE.forEach(function (g) { base[g.id] = g.chars; });
    add('upper', base.upper, 'base'); add('lower', base.lower, 'base');
    Charsets.LANG_ORDER.forEach(function (code) { if (scripts().indexOf(code) >= 0) add('lang-' + code, Charsets.LANG[code], 'lang', { lang: code }); });
    ['digits', 'punct', 'math', 'special'].forEach(function (id) { add(id, base[id], 'base'); });
    // own characters: everything added by the user that no switched-on group shows already
    var own = customChars().filter(function (c) { return !seenOn[c]; });
    out.push({ id: 'custom', kind: 'custom', chars: own, on: state.settings.groups.custom !== false });
    return out;
  }
  function customChars() {
    var out = [];
    chars(nfc(state.settings.custom || '')).forEach(function (c) { if (!/\s/.test(c) && out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function groupName(g) { return g.kind === 'lang' ? t('group.lang', { lang: I18N.LANGS[g.lang] }) : t('group.' + g.id); }
  function groupHint(g) { return t(g.kind === 'lang' ? 'hint.lang' : 'hint.' + g.id); }
  function groupOf(ch) {
    var gs = groups(), off = null;
    for (var i = 0; i < gs.length; i++) if (gs[i].chars.indexOf(ch) >= 0) { if (gs[i].on) return gs[i]; off = off || gs[i]; }
    return off || gs[gs.length - 1];
  }
  function order() {
    var out = [];
    groups().forEach(function (g) { if (g.on) out = out.concat(g.chars); });
    return out;
  }
  function totals() {
    var list = order(), tg = target(), have = 0, done = 0;
    list.forEach(function (c) { var n = count(c); have += Math.min(n, tg); if (n >= tg) done++; });
    var all = 0; Object.keys(state.glyphs).forEach(function (k) { all += state.glyphs[k].length; });
    return { need: list.length * tg, have: have, chars: list.length, done: done, allSamples: all };
  }
  function charName(ch) {
    if (I18N.has('names.' + ch)) return t('names.' + ch);
    if (/^\p{Lu}$/u.test(ch)) return t('prompt.upper', { c: ch });
    if (/^\p{Ll}$/u.test(ch)) return t('prompt.lower', { c: ch });
    if (/^\p{Nd}$/u.test(ch)) return t('prompt.digit', { c: ch });
    return t('prompt.char', { c: ch });
  }

  /* --------------------------- bounding box & outliers --------------------------- */
  function sampleBBox(s) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    s.strokes.forEach(function (st) {
      for (var i = 0; i + 1 < st.length; i += 2) {
        var x = st[i] / SCALE, y = st[i + 1] / SCALE;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    });
    return { x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 };
  }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (p, q) { return p - q; }); var m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  // Same heuristic as the Python renderer (suspect_reasons)
  function suspects(ch) {
    var arr = state.glyphs[ch] || [], res = {};
    if (arr.length < 3) return res;
    var bbs = arr.map(sampleBBox);
    var mh = median(bbs.map(function (b) { return b.h; })), mw = median(bbs.map(function (b) { return b.w; })), mcy = median(bbs.map(function (b) { return b.cy; }));
    bbs.forEach(function (b, i) {
      var r = [];
      if (mh > 0.08 && (b.h > mh * 1.8 || b.h < mh * 0.55)) r.push(t('reason.h'));
      if (mw > 0.08 && (b.w > mw * 2.0 || b.w < mw * 0.45)) r.push(t('reason.w'));
      if (Math.abs(b.cy - mcy) > 0.3) r.push(t('reason.p'));
      if (r.length) res[arr[i].id] = r;
    });
    return res;
  }

  /* ------------------------------ storage ------------------------------ */
  var DB_NAME = 'my-handwriting', DB_STORE = 'kv', LS_KEY = 'my-handwriting-state';
  var OLD_DB = 'handschrift-erfassung', OLD_LS = 'handschrift-erfassung-state';   // before the rename
  var dbPromise = null;
  function idbOpen(name) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(name || DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
      setTimeout(function () { reject(new Error('timeout')); }, 4000);
    });
  }
  function idbGet(db, key) {
    return new Promise(function (resolve, reject) {
      try {
        var q = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        q.onsuccess = function () { resolve(q.result); }; q.onerror = function () { reject(q.error); };
      } catch (e) { reject(e); }
    });
  }
  function idbSet(db, key, val) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('abort')); };
        tx.objectStore(DB_STORE).put(val, key);
      } catch (e) { reject(e); }
    });
  }
  function lsGet(key) { try { return localStorage.getItem(key || LS_KEY); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(LS_KEY, v); return true; } catch (e) { return false; } }

  var statusKey = 'save.loading';
  function setStatus(key) { statusKey = key; var el = $('saveStatus'); el.textContent = t(key); el.className = 'status' + (key === 'save.fail' ? ' err' : ''); }

  function scheduleSave() { clearTimeout(saveTimer); setStatus('save.saving'); saveTimer = setTimeout(saveNow, 350); }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    state.meta.current = current;
    var payload = JSON.stringify({ savedAt: Date.now(), state: state });
    var p;
    if (dbPromise) {
      p = dbPromise.then(function (db) { if (!db) throw new Error('no db'); return idbSet(db, 'state', payload); })
        .then(function () { storageMode = 'idb'; lsSet(payload); return true; })   // localStorage as second copy (if there is room)
        .catch(function () { return lsSet(payload) ? (storageMode = 'local', true) : false; });
    } else {
      p = Promise.resolve(lsSet(payload) ? (storageMode = 'local', true) : false);
    }
    return p.then(function (ok) {
      saveOk = ok;
      setStatus(ok ? 'save.ok' : 'save.fail');
      if (ok) askPersist();
      return ok;
    });
  }
  // Ask once (after a few samples) that the browser keeps the data even when space gets low.
  function askPersist() {
    if (state.meta.persistAsked || totals().allSamples < 10) return;
    state.meta.persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }
  function loadState() {
    dbPromise = (typeof indexedDB !== 'undefined') ? idbOpen().catch(function () { return null; }) : Promise.resolve(null);
    return dbPromise.then(function (db) { return db ? idbGet(db, 'state').catch(function () { return null; }) : null; })
      .then(function (fromDb) {
        var candidates = [fromDb, lsGet()].map(function (raw) {
          if (!raw || typeof raw !== 'string') return null;
          try { var o = JSON.parse(raw); return (o && o.state && o.state.glyphs) ? o : null; } catch (e) { return null; }
        }).filter(Boolean);
        candidates.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        if (candidates.length) { state = mergeDefaults(candidates[0].state); return; }
        return loadOld();
      });
  }
  // Data saved under the old project name (same browser, same address): copy it over once.
  // The old copy is left untouched.
  function loadOld() {
    var fromLs = lsGet(OLD_LS);
    var fromDb = (typeof indexedDB !== 'undefined' && indexedDB.databases)
      ? indexedDB.databases().then(function (list) {
          if (!list.some(function (d) { return d.name === OLD_DB; })) return null;
          return idbOpen(OLD_DB).then(function (db) { var p = idbGet(db, 'state'); p.then(function () { db.close(); }, function () { db.close(); }); return p; });
        }).catch(function () { return null; })
      : Promise.resolve(null);
    return fromDb.then(function (raw) {
      var c = [raw, fromLs].map(function (r) { try { var o = r && JSON.parse(r); return o && o.state && o.state.glyphs ? o : null; } catch (e) { return null; } })
        .filter(Boolean).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      if (c.length) { state = mergeDefaults(c[0].state); state.meta.migrated = true; }
    });
  }
  function mergeDefaults(s) {
    var d = defaultState();
    var out = { glyphs: {}, settings: Object.assign({}, d.settings, s.settings || {}), meta: Object.assign({}, d.meta, s.meta || {}) };
    out.settings.groups = Object.assign({}, (s.settings && s.settings.groups) || {});
    out.settings.write = Object.assign({}, d.settings.write, (s.settings && s.settings.write) || {});
    out.settings.claude = Object.assign({}, d.settings.claude, (s.settings && s.settings.claude) || {});
    // languages that no longer exist (Turkish was removed)
    if (Array.isArray(out.settings.scripts)) out.settings.scripts = out.settings.scripts.filter(function (c) { return !!Charsets.LANG[c]; });
    if (out.settings.lang && !I18N.LANGS[out.settings.lang]) out.settings.lang = null;
    // Version 1.0 had a fixed German group "umlaut" and no language choice.
    if (!Array.isArray(out.settings.scripts) && s.meta && s.meta.introSeen) {
      out.settings.scripts = out.settings.groups.umlaut === false ? [] : ['de'];
      out.meta.wizardDone = true;
    }
    delete out.settings.groups.umlaut;
    out.glyphs = sanitizeGlyphs(s.glyphs || {}, 1).glyphs;
    return out;
  }

  /* ---------------------------- validation ---------------------------- */
  // Accepts format v1 (flat integer lists) and, if needed, [[x,y],…] lists.
  function sanitizeGlyphs(g, factor) {
    var out = {}, dropped = 0, kept = 0;
    if (!g || typeof g !== 'object') return { glyphs: out, kept: 0, dropped: 0 };
    Object.keys(g).forEach(function (rawKey) {
      var key = nfc(rawKey);
      if (!key) return;
      var arr = Array.isArray(g[rawKey]) ? g[rawKey] : [];
      arr.forEach(function (s) {
        if (!s || !Array.isArray(s.strokes)) { dropped++; return; }
        var strokes = [];
        s.strokes.forEach(function (st) {
          if (!Array.isArray(st)) return;
          var flat = [];
          if (st.length && Array.isArray(st[0])) st.forEach(function (p) { if (Array.isArray(p) && p.length >= 2) flat.push(p[0], p[1]); });
          else flat = st.slice();
          var ok = flat.length >= 2, res = [];
          for (var i = 0; ok && i + 1 < flat.length; i += 2) {
            var x = Number(flat[i]), y = Number(flat[i + 1]);
            if (!isFinite(x) || !isFinite(y)) { ok = false; break; }
            res.push(Math.round(x * factor), Math.round(y * factor));
          }
          if (ok && res.length >= 2) strokes.push(res);
        });
        if (!strokes.length) { dropped++; return; }
        (out[key] = out[key] || []).push({ id: String(s.id || uid()), created: Number(s.created) || Date.now(), strokes: strokes, dev: String(s.dev || 'unknown') });
        kept++;
      });
    });
    return { glyphs: out, kept: kept, dropped: dropped };
  }

  /* ------------------------------ writing area ------------------------------ */
  var pad = $('pad'), ctx = pad.getContext('2d');
  var padCssW = 0, padU = 0, padDpr = 0;

  function resizePad(force) {
    // As big as possible, but the buttons should stay visible without scrolling
    var main = document.querySelector('main');
    var availW = Math.max(240, (main.clientWidth || 640) - 28);
    var headerH = document.querySelector('header').offsetHeight || 56;
    var availH = Math.max(230, window.innerHeight - headerH - 270);
    var w = Math.floor(Math.min(820, availW, availH * M.boxWidth / BOX_H));
    w = Math.max(220, Math.min(w, availW));
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (!force && w === padCssW && dpr === padDpr) return;
    if (activePointer !== null) return;            // never rebuild the area in the middle of a stroke
    document.documentElement.style.setProperty('--padw', w + 'px');
    padDpr = dpr;
    var h = Math.round(w * BOX_H / M.boxWidth);
    pad.style.height = h + 'px';
    pad.width = Math.round(w * dpr); pad.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    padCssW = w; padU = w / M.boxWidth;
    redrawPad();
  }
  function toPx(x, y, u) { return [x * u, (M.boxTop - y) * u]; }

  function drawGuides(c, u, w, small) {
    c.save();
    var a = toPx(0, M.xheight, u)[1], b = toPx(0, M.baseline, u)[1];
    c.fillStyle = '#f6f7fc'; c.fillRect(0, a, w, b - a);
    function line(v, color, width, dash) {
      var y = Math.round(toPx(0, v, u)[1]) + 0.5;
      c.beginPath(); c.setLineDash(dash || []); c.strokeStyle = color; c.lineWidth = width;
      c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    line(M.cap, '#c3c9e0', 1);
    line(M.xheight, '#c3c9e0', 1, small ? [3, 3] : [7, 6]);
    line(M.baseline, '#7d89b8', small ? 1 : 1.6);
    line(M.descender, '#dfe2ee', 1, [2, 4]);
    c.setLineDash([]);
    if (!small) {
      c.fillStyle = '#a3a9bb'; c.font = '11px system-ui, sans-serif'; c.textAlign = 'right';
      c.fillText(t('guide.cap'), w - 8, toPx(0, M.cap, u)[1] - 4);
      c.fillText(t('guide.x'), w - 8, toPx(0, M.xheight, u)[1] - 4);
      c.fillText(t('guide.base'), w - 8, toPx(0, M.baseline, u)[1] - 4);
      c.fillText(t('guide.desc'), w - 8, toPx(0, M.descender, u)[1] - 4);
    }
    c.restore();
  }

  /* Guide letter: the current character in a normal font, faint, sitting on the baseline.
     Capitals/digits/symbols: cap height = top line; small letters: x-height = dashed line. */
  var fontMetrics = null;
  function measureFont(c) {
    if (fontMetrics) return fontMetrics;
    c.save(); c.font = '200px ' + TEMPLATE_FONT;
    var H = c.measureText('H'), X = c.measureText('x');
    var cap = H.actualBoundingBoxAscent, xh = X.actualBoundingBoxAscent;
    c.restore();
    fontMetrics = (cap > 20 && xh > 10) ? { cap: cap / 200, x: xh / 200 } : { cap: 0.716, x: 0.519 };
    return fontMetrics;
  }
  function templateOn() { return state.settings.template !== false; }
  function drawTemplate(c, u, w) {
    if (!templateOn() || !current) return;
    var fm = measureFont(c), ch = current;
    var small = chars(ch).length === 1 && /^\p{Ll}$/u.test(ch);
    var px = small ? (M.xheight * u) / fm.x : (M.cap * u) / fm.cap;
    c.save();
    c.font = Math.round(px) + 'px ' + TEMPLATE_FONT;
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    var m = c.measureText(ch), left = m.actualBoundingBoxLeft || 0, right = m.actualBoundingBoxRight || m.width;
    var gw = (left + right) || m.width;
    var x = (w - gw) / 2 + left;
    c.globalAlpha = clamp(Number(state.settings.templateAlpha) || 0.15, 0.03, 0.6);
    c.fillStyle = '#1f2f86';
    c.fillText(ch, x, toPx(0, M.baseline, u)[1]);
    c.restore();
  }
  function strokePath(c, pts, u, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    if (!pts.length) return;
    var p0 = toPx(pts[0][0], pts[0][1], u);
    c.beginPath();
    if (pts.length === 1) { c.arc(p0[0] + ox, p0[1] + oy, c.lineWidth / 2, 0, Math.PI * 2); c.fillStyle = c.strokeStyle; c.fill(); return; }
    c.moveTo(p0[0] + ox, p0[1] + oy);
    for (var i = 1; i < pts.length - 1; i++) {
      var p = toPx(pts[i][0], pts[i][1], u), q = toPx(pts[i + 1][0], pts[i + 1][1], u);
      c.quadraticCurveTo(p[0] + ox, p[1] + oy, (p[0] + q[0]) / 2 + ox, (p[1] + q[1]) / 2 + oy);
    }
    var l = toPx(pts[pts.length - 1][0], pts[pts.length - 1][1], u);
    c.lineTo(l[0] + ox, l[1] + oy);
    c.stroke();
  }
  function inkStyle(c, u) { c.strokeStyle = '#1f2f86'; c.lineWidth = Math.max(1.2, PEN * u); c.lineCap = 'round'; c.lineJoin = 'round'; }
  function redrawPad() {
    var h = padCssW * BOX_H / M.boxWidth;
    ctx.clearRect(0, 0, padCssW, h);
    drawGuides(ctx, padU, padCssW, false);
    drawTemplate(ctx, padU, padCssW);
    inkStyle(ctx, padU);
    drawing.forEach(function (st) { strokePath(ctx, st, padU); });
    updateButtons();
  }
  function eventToUnits(e) {
    var r = activeRect || pad.getBoundingClientRect();
    var u = r.width / M.boxWidth;
    return [(e.clientX - r.left) / u, M.boxTop - (e.clientY - r.top) / u];
  }
  function penOnlyActive() {
    var m = state.settings.penOnly;
    return m === 'on' || (m === 'auto' && penSeen);
  }
  function addPoint(p, force) {
    var st = drawing[drawing.length - 1]; if (!st) return;
    var last = st[st.length - 1];
    var d = Math.hypot(p[0] - last[0], p[1] - last[1]);
    if (d < (force ? 0.0008 : MIN_DIST)) return;
    st.push(p);
    inkStyle(ctx, padU);
    var a = toPx(last[0], last[1], padU), b = toPx(p[0], p[1], padU);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // Eraser: removes every stroke that passes within ERASE_R of the pointer.
  function eraseAt(p) {
    var before = drawing.length;
    drawing = drawing.filter(function (st) {
      for (var i = 0; i < st.length; i++) if (Math.hypot(st[i][0] - p[0], st[i][1] - p[1]) < ERASE_R) return false;
      for (var j = 1; j < st.length; j++) if (segDist(p, st[j - 1], st[j]) < ERASE_R) return false;
      return true;
    });
    if (drawing.length !== before) { erasedAny = true; redrawPad(); }
  }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    var tt = L ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - tt * dx, p[1] - a[1] - tt * dy);
  }
  function isEraser(e) {
    // Pen eraser end: button 5 / buttons bit 32. Barrel (side) button: button 2 / buttons bit 2.
    return e.pointerType === 'pen' && (e.button === 5 || e.button === 2 || (e.buttons & 32) || (e.buttons & 2));
  }
  function markInput(type) {
    var touch = type === 'touch' || type === 'pen';
    document.documentElement.classList.toggle('touch-ui', touch);
  }
  function notePen() {
    if (penSeen) return;
    penSeen = true; updateBadge();
    try { localStorage.setItem(PEN_KEY, '1'); } catch (e) {}
  }
  document.addEventListener('pointerdown', function (e) { markInput(e.pointerType); }, true);
  // A hovering pen (S Pen, Surface Pen …) is noticed before it touches the screen, so the resting
  // hand is ignored right from the first stroke.
  document.addEventListener('pointermove', function (e) { if (e.pointerType === 'pen') notePen(); }, true);

  pad.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') notePen();
    if (e.pointerType === 'touch' && penOnlyActive()) return;
    // pen comes down while a touch (palm) is drawing: drop the touch stroke, the pen wins
    if (activePointer !== null && e.pointerType === 'pen' && lastPointerType === 'touch') {
      if (!erasing && drawing.length) drawing.pop();
      if (history.length) history.pop();
      try { pad.releasePointerCapture(activePointer); } catch (_) {}
      activePointer = null; erasing = false; redrawPad();
    }
    if (activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId; lastPointerType = e.pointerType || 'unknown';
    activeRect = pad.getBoundingClientRect();
    try { pad.setPointerCapture(e.pointerId); } catch (_) {}
    history.push(drawing.slice()); if (history.length > 60) history.shift();
    var p = eventToUnits(e);
    erasing = isEraser(e); erasedAny = false;
    pad.classList.toggle('erasing', erasing);
    if (erasing) { eraseAt(p); return; }
    drawing.push([p]);
    inkStyle(ctx, padU);
    var px = toPx(p[0], p[1], padU);
    ctx.beginPath(); ctx.arc(px[0], px[1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    updateButtons();
  });
  pad.addEventListener('pointermove', function (e) {
    if (e.pointerId !== activePointer) return;
    e.preventDefault();
    var evs = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    for (var i = 0; i < evs.length; i++) {
      if (erasing) eraseAt(eventToUnits(evs[i])); else addPoint(eventToUnits(evs[i]), false);
    }
  });
  function endStroke(e) {
    if (e.pointerId !== activePointer) return;
    if (e.type === 'pointerup' && !erasing) addPoint(eventToUnits(e), true);
    if (erasing && !erasedAny) history.pop();      // nothing erased = no undo step
    if (erasing && erasedAny) toast(t('toast.erased'));
    activePointer = null; activeRect = null; erasing = false; pad.classList.remove('erasing');
    try { pad.releasePointerCapture(e.pointerId); } catch (_) {}
    redrawPad();
    resizePad();   // in case the window changed size meanwhile
  }
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('lostpointercapture', endStroke);
  pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // Older iOS versions: prevent scrolling/zooming on the area
  ['touchstart', 'touchmove', 'touchend'].forEach(function (tp) { pad.addEventListener(tp, function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false }); });

  function undoStep() { if (activePointer !== null || !history.length) return; drawing = history.pop(); redrawPad(); }
  function clearPad() { if (activePointer !== null || !drawing.length) return; history.push(drawing.slice()); drawing = []; redrawPad(); }
  function updateButtons() {
    var has = drawing.length > 0;
    $('btnUndo').disabled = !history.length; $('btnClear').disabled = !has; $('btnSave').disabled = !has;
    var tb = $('btnTemplate'); tb.classList.toggle('on', templateOn()); tb.setAttribute('aria-pressed', templateOn() ? 'true' : 'false');
  }
  function toggleTemplate() { state.settings.template = !templateOn(); scheduleSave(); redrawPad(); }
  function updateBadge() {
    var b = $('penBadge');
    b.classList.toggle('show', penSeen);
    b.classList.toggle('off', state.settings.penOnly === 'off');
  }
  $('penBadge').addEventListener('click', function () {
    state.settings.penOnly = state.settings.penOnly === 'off' ? 'auto' : 'off';
    toast(t(state.settings.penOnly === 'off' ? 'pen.fingerOn' : 'pen.fingerOff'));
    updateBadge(); scheduleSave();
  });

  /* ------------------------------ flow ------------------------------ */
  function nextIncomplete(from) {
    var list = order(), tg = target(); if (!list.length) return null;
    var i = list.indexOf(from);
    for (var k = 1; k <= list.length; k++) { var c = list[(i + k + list.length) % list.length]; if (count(c) < tg) return c; }
    return null;
  }
  function nextInRound(from) {
    var list = order(), tg = target(); if (!list.length) return null;
    var min = Infinity; list.forEach(function (c) { min = Math.min(min, count(c)); });
    if (min >= tg) return null;
    var i = list.indexOf(from);
    for (var k = 1; k <= list.length; k++) { var c = list[(i + k + list.length) % list.length]; if (count(c) <= min) return c; }
    return null;
  }
  function saveSample() {
    if (activePointer !== null) return;
    if (!current) { toast(t('toast.noGroup')); return; }
    var strokes = drawing.filter(function (s) { return s.length > 0; });
    if (!strokes.length) { toast(t('toast.empty')); return; }
    var edge = false;
    var enc = strokes.map(function (s) {
      var a = [];
      s.forEach(function (p) {
        if (p[0] < 0.02 || p[0] > M.boxWidth - 0.02 || p[1] > M.boxTop - 0.02 || p[1] < M.boxBottom + 0.02) edge = true;
        a.push(Math.round(p[0] * SCALE), Math.round(p[1] * SCALE));
      });
      return a;
    });
    var ch = current;
    (state.glyphs[ch] = state.glyphs[ch] || []).push({ id: uid(), created: Date.now(), strokes: enc, dev: lastPointerType });
    drawing = []; history = [];
    var tg = target();
    if (state.settings.mode === 'round') { var n = nextInRound(ch); if (n) current = n; }
    else if (count(ch) >= tg) { var n2 = nextIncomplete(ch); if (n2) current = n2; }
    scheduleSave();
    renderAll();
    if (edge) toast(t('toast.edge'));
  }
  function setCurrent(ch) { if (activePointer !== null) return; current = ch; drawing = []; history = []; renderAll(); scheduleSave(); }
  function skip() { var list = order(); if (!list.length) return; var i = list.indexOf(current); setCurrent(list[(i + 1) % list.length]); }
  function back() { var list = order(); if (!list.length) return; var i = list.indexOf(current); setCurrent(list[(i - 1 + list.length) % list.length]); }

  function deleteSample(ch, id) {
    var arr = state.glyphs[ch]; if (!arr) return;
    var i = arr.findIndex(function (s) { return s.id === id; }); if (i < 0) return;
    var removed = arr.splice(i, 1)[0];
    if (!arr.length) delete state.glyphs[ch];
    scheduleSave(); renderAll();
    toast(t('toast.deleted'), t('toast.undo'), function () {
      (state.glyphs[ch] = state.glyphs[ch] || []).splice(i, 0, removed);
      scheduleSave(); renderAll();
    });
  }

  /* ------------------------------ rendering ------------------------------ */
  function renderAll() {
    var list = order();
    if (!list.length) current = null;
    else if (!current || list.indexOf(current) < 0) current = nextIncomplete(list[list.length - 1]) || list[0];
    renderPrompt(); renderSamples(); renderOverview(); renderProgress(); redrawPad(); updateBadge();
    setStatus(statusKey);
  }
  function renderPrompt() {
    if (!current) {
      $('targetChar').textContent = '–'; $('charName').textContent = t('prompt.noGroup');
      $('charMeta').textContent = t('prompt.noGroupHint'); $('charHint').textContent = ''; $('dots').innerHTML = '';
      return;
    }
    var g = groupOf(current), n = count(current), tg = target();
    $('targetChar').textContent = current;
    $('charName').textContent = charName(current);
    $('charMeta').textContent = n < tg ? t('prompt.meta', { group: groupName(g), n: n + 1, t: tg }) : t('prompt.metaExtra', { group: groupName(g), n: n + 1 });
    $('charHint').textContent = groupHint(g);
    var html = '';
    for (var i = 0; i < Math.max(tg, n); i++) html += '<i class="' + (i < n ? (i < tg ? 'on' : 'extra') : '') + '"></i>';
    $('dots').innerHTML = html;
  }
  function renderSamples() {
    var box = $('samples'); box.innerHTML = '';
    if (!current) return;
    var arr = state.glyphs[current] || [];
    if (!arr.length) { box.innerHTML = '<div class="empty">' + esc(t('samples.none')) + '</div>'; return; }
    var sus = suspects(current);
    arr.forEach(function (s, i) {
      var d = document.createElement('div'); d.className = 'thumb' + (sus[s.id] ? ' suspect' : '');
      if (sus[s.id]) d.title = t('sample.suspect', { r: sus[s.id].join(', ') });
      var c = document.createElement('canvas'); var W = 92, H = Math.round(W * BOX_H / M.boxWidth);
      var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
      var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var u = W / M.boxWidth;
      drawGuides(cx, u, W, true); inkStyle(cx, u);
      decodeStrokes(s).forEach(function (st) { strokePath(cx, st, u); });
      var no = document.createElement('span'); no.className = 'no'; no.textContent = (i + 1) + (sus[s.id] ? ' !' : '');
      var del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.textContent = '×'; del.title = t('sample.del');
      del.setAttribute('aria-label', t('sample.del'));
      del.addEventListener('click', function () { deleteSample(current, s.id); });
      d.appendChild(c); d.appendChild(no); d.appendChild(del); box.appendChild(d);
    });
  }
  function decodeStrokes(s) {
    return s.strokes.map(function (st) { var pts = []; for (var i = 0; i + 1 < st.length; i += 2) pts.push([st[i] / SCALE, st[i + 1] / SCALE]); return pts; });
  }
  function renderOverview() {
    var el = $('overview'), tg = target(), html = '<h2>' + esc(t('ov.title')) + '</h2>';
    groups().forEach(function (g) {
      var name = groupName(g);
      if (g.kind === 'custom') {
        html += '<div class="group custom' + (g.on ? '' : ' off') + '"><h3><label title="' + esc(t('ov.toggle')) + '"><input type="checkbox" data-group="custom"' + (g.on ? ' checked' : '') + '> ' + esc(name) +
          '</label><small>' + (customChars().length ? '<a href="#" data-open-settings>' + esc(t('ov.edit')) + '</a>' : '') + '</small></h3>';
        if (g.chars.length) {
          html += '<div class="cells">';
          g.chars.forEach(function (c) { html += cellHtml(c, tg); });
          html += '</div>';
        }
        html += '<form class="addchars" data-add-form><input type="text" id="addChars" maxlength="40" autocomplete="off" spellcheck="false" placeholder="' + esc(t('ov.addPh')) +
          '" aria-label="' + esc(t('ov.addPh')) + '"><button type="submit">' + esc(t('ov.addBtn')) + '</button></form></div>';
        return;
      }
      var done = g.chars.filter(function (c) { return count(c) >= tg; }).length;
      html += '<div class="group' + (g.on ? '' : ' off') + '"><h3><label title="' + esc(t('ov.toggle')) + '"><input type="checkbox" data-group="' + g.id + '"' + (g.on ? ' checked' : '') + '> ' + esc(name) + '</label><small>' + done + ' / ' + g.chars.length + '</small></h3><div class="cells">';
      g.chars.forEach(function (c) { html += cellHtml(c, tg); });
      html += '</div></div>';
    });
    var keep = $('addChars') ? $('addChars').value : '', focused = document.activeElement && document.activeElement.id === 'addChars';
    el.innerHTML = html;
    if ($('addChars')) { $('addChars').value = keep; if (focused) $('addChars').focus(); }
  }
  function cellHtml(c, tg) {
    var n = count(c), pct = Math.min(100, Math.round(n / tg * 100));
    var warn = Object.keys(suspects(c)).length > 0;
    return '<button type="button" class="cell' + (n >= tg ? ' done' : '') + (c === current ? ' cur' : '') + (warn ? ' warn' : '') + '" data-ch="' + esc(c) + '" title="' +
      esc(t('ov.cellTitle', { name: charName(c), n: n, t: tg }) + (warn ? t('ov.cellWarn') : '')) + '"><i class="fill" style="height:' + pct + '%"></i><span>' + esc(c) + '</span></button>';
  }
  /* Adds own characters. Characters that a switched-on group already shows are not added twice;
     the app jumps to them instead. Returns the characters that were added. */
  function addCustom(text) {
    var list = chars(nfc(String(text || ''))).filter(function (c) { return !/\s/.test(c) && !/[\p{Cc}\p{Cf}]/u.test(c); });
    var have = customChars(), added = [], already = [];
    var shown = {}; groups().forEach(function (g) { if (g.on && g.kind !== 'custom') g.chars.forEach(function (c) { shown[c] = g; }); });
    list.forEach(function (c) {
      if (shown[c]) { if (already.indexOf(c) < 0) already.push(c); return; }
      if (have.indexOf(c) < 0 && added.indexOf(c) < 0) added.push(c);
    });
    if (added.length) {
      state.settings.custom = have.concat(added).join('');
      state.settings.groups.custom = true;
      scheduleSave();
      setCurrent(added[0]);
      toast(t('toast.added', { c: added.join(' ') }));
    } else if (already.length) {
      setCurrent(already[0]);
      var names = [];
      already.forEach(function (c) { var n = groupName(shown[c]); if (names.indexOf(n) < 0) names.push(n); });
      toast(t('toast.already', { c: already.join(' '), group: names.join(' / ') }));
    } else toast(t('toast.addNone'));
    return added;
  }
  $('overview').addEventListener('click', function (e) {
    var cell = e.target.closest('[data-ch]');
    if (cell) { var ch = cell.getAttribute('data-ch'); if (!groupOf(ch).on) return; setCurrent(ch); return; }
    if (e.target.closest('[data-open-settings]')) { e.preventDefault(); openSettings(); }
  });
  $('overview').addEventListener('submit', function (e) {
    if (!e.target.closest('[data-add-form]')) return;
    e.preventDefault();
    var v = $('addChars').value;
    addCustom(v);
    if ($('addChars')) $('addChars').value = '';   // the overview was redrawn: take the new field
  });
  $('overview').addEventListener('change', function (e) {
    var g = e.target.getAttribute && e.target.getAttribute('data-group');
    if (!g) return;
    state.settings.groups[g] = e.target.checked;
    scheduleSave(); renderAll();
  });
  function renderProgress() {
    var tt = totals();
    var pct = tt.need ? Math.floor(tt.have / tt.need * 100) : 0;
    $('barFill').style.width = pct + '%';
    $('progressText').textContent = t('progress', { pct: pct, done: tt.done, chars: tt.chars, n: tt.allSamples });
    var allDone = tt.chars > 0 && tt.done === tt.chars;
    $('doneBanner').classList.toggle('show', allDone);
    var since = tt.allSamples - (state.meta.samplesAtExport || 0);
    var showReminder = since >= 150 || (!saveOk && tt.allSamples > 0);
    $('exportBanner').classList.toggle('show', showReminder && !allDone);
    $('exportBannerText').textContent = !saveOk ? t('banner.noStore') : t('banner.reminder', { n: since });
  }

  /* ------------------------------ toast & modals ------------------------------ */
  var toastTimer = null;
  function toast(text, btnText, btnFn) {
    var el = $('toast'); $('toastText').textContent = text;
    var b = $('toastBtn'); b.style.display = btnText ? '' : 'none'; b.textContent = btnText || '';
    b.onclick = function () { el.classList.remove('show'); if (btnFn) btnFn(); };
    el.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, btnText ? 6000 : 3200);
  }
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) {
    $(id).classList.remove('show');
    if (id === 'mWizard') finishWizard(false);
  }
  function modalOpen() { return !!document.querySelector('.modal-bg.show'); }
  document.querySelectorAll('.modal-bg').forEach(function (bg) {
    bg.addEventListener('click', function (e) {
      if ((e.target === bg && bg.id !== 'mWizard') || e.target.closest('[data-close]')) closeModal(bg.id);
    });
  });

  /* ------------------------------ wizard ------------------------------ */
  var wiz = { step: 0, scripts: [], target: 10, template: true, claude: null, fallback: true };
  var WIZ_STEPS = 6;   // language, how it works, writing languages, Claude, practice, tips
  function openWizard(fromStep) {
    wiz.step = fromStep || 0;
    wiz.scripts = Array.isArray(state.settings.scripts) ? state.settings.scripts.slice() : [I18N.lang()];
    wiz.target = target(); wiz.template = templateOn();
    wiz.claude = Object.assign({}, state.settings.claude); wiz.fallback = state.settings.fallbackFont !== false;
    renderWizard(); openModal('mWizard');
  }
  function options(values, labelFn, sel) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(labelFn(v)) + '</option>'; }).join('');
  }
  function claudeLangOptions(sel) {
    return '<option value="">' + esc(t('claude.same')) + '</option>' + options(Object.keys(I18N.LANGS), function (c) { return I18N.LANGS[c]; }, sel || '');
  }
  function sizeLabel(v) { return String(v).replace('.', I18N.lang() === 'en' ? '.' : ',') + ' mm'; }
  function renderWizard() {
    var b = $('wizBody'), s = wiz.step, html = '';
    $('wizStep').textContent = t('wiz.step', { n: s + 1, m: WIZ_STEPS });
    if (s === 0) {
      var sug = I18N.browserLang();
      html += '<h2>👋 ' + esc(t('wiz.welcomeTitle')) + '</h2><p>' + esc(t('wiz.welcomeText')) + '</p><p><b>' + esc(t('wiz.chooseLang')) + '</b></p><div class="langs">';
      Object.keys(I18N.LANGS).forEach(function (code) {
        html += '<button type="button" data-lang="' + code + '" class="' + (code === I18N.lang() ? 'sel' : '') + '">' + esc(I18N.LANGS[code]) +
          (sug && sug === code && code !== 'en' ? ' <small>· ' + esc(t('wiz.suggested')) + '</small>' : '') + '</button>';
      });
      html += '</div>';
    } else if (s === 1) {
      html += '<h2>' + esc(t('wiz.howTitle')) + '</h2><div class="how">';
      [1, 2, 3].forEach(function (i) {
        html += '<div><span class="n">' + i + '</span><span><b>' + esc(t('wiz.how' + i + 'Title')) + '</b>' + esc(t('wiz.how' + i)) + '</span></div>';
      });
      html += '</div><div class="privacy">' + esc(t('wiz.privacy')) + '</div>';
    } else if (s === 2) {
      html += '<h2>' + esc(t('wiz.scriptsTitle')) + '</h2><p>' + esc(t('wiz.scriptsText')) + '</p><div class="scripts">';
      Charsets.LANG_ORDER.forEach(function (code) {
        html += '<label><input type="checkbox" data-script="' + code + '"' + (wiz.scripts.indexOf(code) >= 0 ? ' checked' : '') + '> ' + esc(I18N.LANGS[code]) +
          ' <small>' + esc(chars(Charsets.LANG[code]).slice(0, 8).join(' ')) + (chars(Charsets.LANG[code]).length > 8 ? ' …' : '') + '</small></label>';
      });
      html += '</div>';
    } else if (s === 3) {
      var c = wiz.claude;
      html += '<h2>🤖 ' + esc(t('wiz.claudeTitle')) + '</h2><p>' + esc(t('wiz.claudeText')) + '</p><div class="fields">' +
        '<label><span>' + esc(t('wiz.claudeLang')) + '</span><select data-claude="lang">' + claudeLangOptions(c.lang) + '</select></label>' +
        '<label><span>' + esc(t('write.paper')) + '</span><select data-claude="paper">' + options(PAPERS, function (v) { return t('paper.' + v); }, c.paper) + '</select></label>' +
        '<label><span>' + esc(t('write.size')) + '</span><select data-claude="size">' + options(SIZES, sizeLabel, c.size) + '</select></label>' +
        '<label><span>' + esc(t('write.color')) + '</span><select data-claude="color">' + options(COLORS, function (v) { return t('color.' + v); }, c.color) + '</select></label>' +
        '<label><span>' + esc(t('write.page')) + '</span><select data-claude="page">' + options(PAGES, function (v) { return t('page.' + v); }, c.page) + '</select></label>' +
        '</div><label class="check" style="margin-top:10px"><input type="checkbox" id="wizFallback"' + (wiz.fallback ? ' checked' : '') + '> ' + esc(t('set.fallbackOn')) + '</label>' +
        '<p class="small">' + esc(t('wiz.claudeHow')) + '</p>';
    } else if (s === 4) {
      html += '<h2>' + esc(t('wiz.practiceTitle')) + '</h2><p><b>' + esc(t('wiz.setupCount')) + '</b></p><div class="counts">';
      [[3, 'wiz.countQuick'], [5, 'wiz.countGood'], [10, 'wiz.countBest']].forEach(function (cc) {
        html += '<label><input type="radio" name="wizCount" value="' + cc[0] + '"' + (wiz.target === cc[0] ? ' checked' : '') + '> ' + esc(t(cc[1])) + '</label>';
      });
      html += '</div><label class="check" style="margin-top:12px"><input type="checkbox" id="wizTemplate"' + (wiz.template ? ' checked' : '') + '> ' + esc(t('wiz.setupTemplate')) + '</label>';
    } else {
      html += '<h2>' + esc(t('wiz.tipsTitle')) + '</h2><ul class="tips">';
      [1, 2, 3, 4].forEach(function (i) { html += '<li>' + esc(t('wiz.tip' + i)) + '</li>'; });
      html += '</ul>';
    }
    b.innerHTML = html;
    $('wizPrev').style.visibility = s > 0 ? 'visible' : 'hidden';
    $('wizNext').textContent = s < WIZ_STEPS - 1 ? t('wiz.next') : t('wiz.start');
    $('wizSkip').style.visibility = s < WIZ_STEPS - 1 ? 'visible' : 'hidden';
  }
  $('wizBody').addEventListener('click', function (e) {
    var lb = e.target.closest('[data-lang]');
    if (lb) { setLanguage(lb.getAttribute('data-lang')); if (!Array.isArray(state.settings.scripts)) wiz.scripts = [I18N.lang()]; renderWizard(); }
  });
  $('wizBody').addEventListener('change', function (e) {
    var sc = e.target.getAttribute('data-script');
    if (sc) { wiz.scripts = wiz.scripts.filter(function (x) { return x !== sc; }); if (e.target.checked) wiz.scripts.push(sc); }
    var cl = e.target.getAttribute('data-claude');
    if (cl) wiz.claude[cl] = cl === 'size' ? parseFloat(e.target.value) : (e.target.value || null);
    if (e.target.name === 'wizCount') wiz.target = parseInt(e.target.value, 10) || 10;
    if (e.target.id === 'wizTemplate') wiz.template = e.target.checked;
    if (e.target.id === 'wizFallback') wiz.fallback = e.target.checked;
  });
  $('wizPrev').addEventListener('click', function () { if (wiz.step > 0) { wiz.step--; renderWizard(); } });
  $('wizNext').addEventListener('click', function () {
    if (wiz.step < WIZ_STEPS - 1) { wiz.step++; renderWizard(); return; }
    finishWizard(true); $('mWizard').classList.remove('show');
  });
  $('wizSkip').addEventListener('click', function () { finishWizard(true); $('mWizard').classList.remove('show'); });
  function finishWizard(apply) {
    if (state.meta.wizardDone && !apply) return;
    if (apply || !state.meta.wizardDone) {
      state.settings.scripts = Charsets.LANG_ORDER.filter(function (c) { return wiz.scripts.indexOf(c) >= 0; });
      state.settings.target = wiz.target; state.settings.template = wiz.template;
      if (wiz.claude) state.settings.claude = Object.assign({}, state.settings.claude, wiz.claude);
      state.settings.fallbackFont = wiz.fallback;
      if (!state.settings.lang) state.settings.lang = I18N.lang();
    }
    state.meta.wizardDone = true; state.meta.introSeen = true;
    saveNow(); renderAll();
  }

  /* ------------------------------ language ------------------------------ */
  function fillLangSelect(sel) {
    sel.innerHTML = Object.keys(I18N.LANGS).map(function (c) { return '<option value="' + c + '">' + esc(I18N.LANGS[c]) + '</option>'; }).join('');
    sel.value = I18N.lang();
  }
  function setLanguage(code) {
    I18N.setLang(code); state.settings.lang = I18N.lang();
    document.title = t('app.title');
    I18N.apply(); fillLangSelect($('langSel'));
    fontMetrics = null;
    renderAll(); scheduleSave();
    if ($('mWrite').classList.contains('show')) renderWrite();
  }
  $('langSel').addEventListener('change', function () { setLanguage(this.value); });

  /* ------------------------------ export / import ------------------------------ */
  function buildExport() {
    return {
      format: FORMAT, version: FORMAT_VERSION, app: 'my-handwriting ' + APP_VERSION,
      exported: new Date().toISOString(),
      metrics: { scale: SCALE, unit: 'cap-height', cap: M.cap, xheight: M.xheight, baseline: M.baseline,
                 descender: M.descender, boxTop: M.boxTop, boxBottom: M.boxBottom, boxWidth: M.boxWidth, penWidth: PEN },
      settings: { target: target(), custom: state.settings.custom || '', scripts: scripts(), lang: I18N.lang(),
                  claude: Object.assign({}, state.settings.claude, { fallback: state.settings.fallbackFont === false ? 'box' : 'font' }) },
      glyphs: state.glyphs
    };
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function download(name, data, type) {
    try {
      var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 8000);
      return true;
    } catch (e) { return false; }
  }
  var lastExportText = '';
  function doExport() {
    var tt = totals();
    if (!tt.allSamples) { toast(t('toast.nothingExport')); return; }
    lastExportText = JSON.stringify(buildExport());
    var name = 'my-handwriting-glyphs-' + stamp() + '.json';
    var started = download(name, lastExportText, 'application/json');
    state.meta.lastExport = Date.now(); state.meta.samplesAtExport = tt.allSamples;
    scheduleSave(); renderProgress();
    $('exportInfo').innerHTML = (started ? t('export.started', { name: esc(name) }) : esc(t('export.failed'))) +
      '<br>' + esc(t('export.stats', { n: tt.allSamples, c: Object.keys(state.glyphs).length, kb: Math.round(lastExportText.length / 1024) }));
    $('exportClaude').innerHTML = t('export.claudeHtml', { name: esc(name) });
    $('exportText').style.display = 'none'; $('exportText').value = '';
    openModal('mExport');
  }
  $('btnShowJson').addEventListener('click', function () { var ta = $('exportText'); ta.value = lastExportText; ta.style.display = 'block'; ta.focus(); ta.select(); });
  $('btnCopy').addEventListener('click', function () {
    var done = function () { toast(t('toast.copied')); };
    var fallback = function () {
      var ta = $('exportText'); ta.value = lastExportText; ta.style.display = 'block'; ta.focus(); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      if (ok) done(); else toast(t('toast.copyBlocked'));
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lastExportText).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  });

  var pendingImport = null;
  $('fileInput').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { prepareImport(String(r.result || '')); };
    r.onerror = function () { toast(t('toast.readFail')); };
    r.readAsText(f, 'utf-8');
  });
  function prepareImport(text) {
    var obj;
    try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { toast(t('toast.badJson')); return; }
    if (!obj || typeof obj !== 'object' || !obj.glyphs) { toast(t('toast.noData')); return; }
    if (obj.format && obj.format !== FORMAT && LEGACY_FORMATS.indexOf(obj.format) < 0) { toast(t('toast.badFormat', { f: obj.format })); return; }
    if (obj.version && obj.version > FORMAT_VERSION) { toast(t('toast.newer', { v: obj.version })); return; }
    var sc = (obj.metrics && Number(obj.metrics.scale)) || SCALE;
    var clean = sanitizeGlyphs(obj.glyphs, SCALE / sc);
    if (!clean.kept) { toast(t('toast.noUsable')); return; }
    pendingImport = { glyphs: clean.glyphs, settings: (obj.settings && typeof obj.settings === 'object') ? obj.settings : {} };
    $('importInfo').innerHTML = t('import.found', { n: clean.kept, c: Object.keys(clean.glyphs).length }) +
      (clean.dropped ? esc(t('import.dropped', { n: clean.dropped })) : '') + '.<br><br>' +
      t('import.explainHtml', { n: totals().allSamples });
    openModal('mImport');
  }
  function applyImport(replace) {
    if (!pendingImport) return;
    var src = pendingImport.glyphs, added = 0;
    if (replace) state.glyphs = {};
    Object.keys(src).forEach(function (k) {
      var have = {}; (state.glyphs[k] || []).forEach(function (s) { have[s.id] = 1; });
      src[k].forEach(function (s) { if (!have[s.id]) { (state.glyphs[k] = state.glyphs[k] || []).push(s); have[s.id] = 1; added++; } });
    });
    var ps = pendingImport.settings || {};
    if (typeof ps.custom === 'string' && ps.custom) {
      state.settings.custom = chars(nfc((state.settings.custom || '') + ps.custom)).filter(function (c, i, a) { return a.indexOf(c) === i; }).join('');
    }
    if (ps.claude && typeof ps.claude === 'object' && (replace || !state.meta.claudeSet)) {
      var cl = ps.claude, cur = state.settings.claude;
      if (cl.lang === null || I18N.LANGS[cl.lang]) cur.lang = cl.lang;
      if (PAPERS.indexOf(cl.paper) >= 0) cur.paper = cl.paper;
      if (SIZES.indexOf(Number(cl.size)) >= 0) cur.size = Number(cl.size);
      if (COLORS.indexOf(cl.color) >= 0) cur.color = cl.color;
      if (PAGES.indexOf(cl.page) >= 0) cur.page = cl.page;
      if (cl.fallback === 'box' || cl.fallback === 'font') state.settings.fallbackFont = cl.fallback === 'font';
    }
    if (Array.isArray(ps.scripts)) {
      var sc = scripts().slice(); ps.scripts.forEach(function (c) { if (Charsets.LANG[c] && sc.indexOf(c) < 0) sc.push(c); });
      state.settings.scripts = Charsets.LANG_ORDER.filter(function (c) { return sc.indexOf(c) >= 0; });
    }
    // characters from the file that are in no group become own characters
    var known = {}; groups().forEach(function (g) { g.chars.forEach(function (c) { known[c] = 1; }); });
    Charsets.LANG_ORDER.forEach(function (code) { chars(Charsets.LANG[code]).forEach(function (c) { known[c] = 1; }); });
    Object.keys(state.glyphs).forEach(function (k) { if (!known[k] && chars(k).length === 1 && chars(state.settings.custom).indexOf(k) < 0) state.settings.custom += k; });
    pendingImport = null; $('mImport').classList.remove('show');
    saveNow(); renderAll();
    toast(t('toast.imported', { n: added }));
  }
  $('btnImportMerge').addEventListener('click', function () { applyImport(false); });
  $('btnImportReplace').addEventListener('click', function () { applyImport(true); });

  /* ------------------------------ write text ------------------------------ */
  var writeSeed = 1, writeTimer = null, glyphSet = null, lastBuild = null;
  function ws() { return state.settings.write; }
  function openWrite() {
    glyphSet = new Render.GlyphSet(state.glyphs, SCALE);
    var w = ws();
    $('wText').value = typeof w.text === 'string' ? w.text : t('write.sample');
    $('wSize').value = String(w.size); if (!$('wSize').value) $('wSize').value = '6';
    $('wPaper').value = w.paper; $('wPage').value = w.page; $('wColor').value = w.color; $('wAlign').value = w.align;
    $('wVar').value = String(w.variation); $('wTransparent').checked = !!w.transparent;
    $('wMarkdown').checked = !!w.markdown; $('wFallback').checked = state.settings.fallbackFont !== false;
    writeSeed = Math.floor(Math.random() * 1e6) + 1;
    openModal('mWrite');
    setTimeout(renderWrite, 30);
  }
  function readWriteForm() {
    var w = ws();
    var txt = $('wText').value;
    w.text = txt === t('write.sample') ? null : txt;        // keep following the language until edited
    w.size = parseFloat($('wSize').value) || 6; w.paper = $('wPaper').value; w.page = $('wPage').value;
    w.color = $('wColor').value; w.align = $('wAlign').value; w.variation = parseFloat($('wVar').value);
    w.transparent = $('wTransparent').checked; w.markdown = $('wMarkdown').checked;
    state.settings.fallbackFont = $('wFallback').checked;
    return w;
  }
  function buildWrite() {
    var w = readWriteForm();
    var text = $('wText').value || ' ';
    lastBuild = Render.buildPages(text, glyphSet, {
      page: w.page, size: w.size, paper: w.paper, align: w.align, variation: w.variation, seed: writeSeed,
      lineSpacing: w.paper === 'lined' ? Math.max(6, w.size * 1.9) : null, markdown: !!w.markdown,
      font: window.FallbackFont || null, fallbackFont: state.settings.fallbackFont !== false,
      labels: { small: t('fb.small'), accent: t('fb.accent'), 'case': t('fb.case'), frac: t('fb.frac'), font: t('fb.font') }
    });
    return lastBuild;
  }
  function renderWrite() {
    var info = $('wInfo'), c = $('wCanvas');
    if (!glyphSet || !glyphSet.total()) { info.textContent = t('write.noSamples'); c.width = 1; c.height = 1; return; }
    var res = buildWrite(), w = ws(), pg = res.pages[0];
    var cssW = Math.max(200, (c.parentNode.clientWidth || 600) - 2), k = cssW / pg.w;
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    c.width = Math.round(cssW * dpr); c.height = Math.round(pg.h * k * dpr); c.style.height = Math.round(pg.h * k) + 'px';
    var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, cssW, pg.h * k);
    Render.drawPage(cx, pg, k, { color: w.color, size: w.size, paper: w.paper, transparent: w.transparent });
    var parts = [];
    if (res.missing.length) parts.push('<span>' + esc(t('write.missing', { c: res.missing.join(' ') })) + '</span>');
    if (res.font.length) parts.push('<span class="fb">' + esc(t('write.fontUsed', { c: res.font.slice(0, 40).join(' ') + (res.font.length > 40 ? ' …' : '') })) + '</span>');
    var fb = Object.keys(res.fallbacks).filter(function (k2) { return res.font.indexOf(k2) < 0; }).map(function (k2) { return k2 + '→' + res.fallbacks[k2]; });
    if (fb.length) parts.push('<span class="fb">' + esc(t('write.fallbacks', { list: fb.slice(0, 12).join(', ') + (fb.length > 12 ? ' …' : '') })) + '</span>');
    if (res.pages.length > 1) parts.push('<span class="fb">' + esc(t('write.pages', { n: res.pages.length })) + '</span>');
    info.innerHTML = parts.join(' · ');
    scheduleSave();
  }
  function scheduleWrite() { clearTimeout(writeTimer); writeTimer = setTimeout(renderWrite, 220); }
  ['wText', 'wSize', 'wPaper', 'wPage', 'wColor', 'wAlign', 'wVar', 'wTransparent', 'wMarkdown', 'wFallback'].forEach(function (id) {
    $(id).addEventListener(id === 'wText' || id === 'wVar' ? 'input' : 'change', scheduleWrite);
  });
  $('wReroll').addEventListener('click', function () { writeSeed = (writeSeed * 7919 + 13) % 1000003 + 1; renderWrite(); });
  function outName(ext, i) { return 'my-handwriting-' + stamp() + (i ? '-' + (i + 1) : '') + '.' + ext; }
  $('wPng').addEventListener('click', function () {
    if (!glyphSet || !glyphSet.total()) return;
    var res = buildWrite(), w = ws(), k = 200 / 25.4;
    res.pages.forEach(function (pg, i) {
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(pg.w * k)); cv.height = Math.max(1, Math.round(pg.h * k));
      Render.drawPage(cv.getContext('2d'), pg, k, { color: w.color, size: w.size, paper: w.paper, transparent: w.transparent });
      setTimeout(function () { cv.toBlob(function (b) { if (b) download(outName('png', i), b); }, 'image/png'); }, i * 400);
    });
  });
  $('wSvg').addEventListener('click', function () {
    if (!glyphSet || !glyphSet.total()) return;
    var res = buildWrite(), w = ws();
    res.pages.forEach(function (pg, i) {
      setTimeout(function () { download(outName('svg', i), Render.toSVG(pg, { color: w.color, size: w.size, paper: w.paper, transparent: w.transparent }), 'image/svg+xml'); }, i * 400);
    });
  });
  $('wPdf').addEventListener('click', function () {
    if (!glyphSet || !glyphSet.total()) return;
    var res = buildWrite(), w = ws();
    Render.toPDFBlob(res.pages, { color: w.color, size: w.size, paper: w.paper }).then(function (blob) { download(outName('pdf', 0), blob); });
  });

  /* ------------------------------ settings ------------------------------ */
  function openSettings() {
    fillLangSelect($('setLang'));
    $('setTarget').value = target(); $('setMode').value = state.settings.mode; $('setPen').value = state.settings.penOnly;
    $('setCustom').value = state.settings.custom || '';
    $('setTemplate').checked = templateOn(); $('setAlpha').value = String(state.settings.templateAlpha); showAlpha();
    var c = state.settings.claude;
    $('setClaudeLang').innerHTML = claudeLangOptions(c.lang);
    $('setClaudePaper').innerHTML = options(PAPERS, function (v) { return t('paper.' + v); }, c.paper);
    $('setClaudeSize').innerHTML = options(SIZES, sizeLabel, c.size);
    $('setClaudeColor').innerHTML = options(COLORS, function (v) { return t('color.' + v); }, c.color);
    $('setClaudePage').innerHTML = options(PAGES, function (v) { return t('page.' + v); }, c.page);
    $('setFallback').checked = state.settings.fallbackFont !== false;
    $('setScripts').innerHTML = Charsets.LANG_ORDER.map(function (code) {
      return '<label><input type="checkbox" data-script="' + code + '"' + (scripts().indexOf(code) >= 0 ? ' checked' : '') + '> ' + esc(I18N.LANGS[code]) +
        ' <small>' + esc(chars(Charsets.LANG[code]).slice(0, 5).join(' ')) + '</small></label>';
    }).join('');
    var size = 0; try { size = JSON.stringify(state).length; } catch (e) {}
    var where = storageMode === 'idb' ? t('set.storeIdb') : storageMode === 'local' ? t('set.storeLocal') : t('set.storeNone');
    $('storageInfo').textContent = where + ' · ' + t('set.size', { kb: Math.round(size / 1024) }) + ' · ' +
      (state.meta.lastExport ? t('set.lastExport', { d: new Date(state.meta.lastExport).toLocaleString(I18N.lang()) }) : t('set.never'));
    wipeArmed = false; $('btnWipe').textContent = t('set.wipe');
    openModal('mSettings');
  }
  function showAlpha() { $('setAlphaVal').textContent = Math.round(parseFloat($('setAlpha').value) * 100) + ' %'; }
  $('setAlpha').addEventListener('input', function () {
    showAlpha();
    // live preview on the writing area behind the dialog
    var keep = state.settings.templateAlpha; state.settings.templateAlpha = parseFloat(this.value); redrawPad(); state.settings.templateAlpha = keep;
  });
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSettingsSave').addEventListener('click', function () {
    state.settings.target = clamp(parseInt($('setTarget').value, 10) || 10, 1, 50);
    state.settings.mode = $('setMode').value === 'round' ? 'round' : 'char';
    state.settings.penOnly = ['auto', 'on', 'off'].indexOf($('setPen').value) >= 0 ? $('setPen').value : 'auto';
    state.settings.custom = nfc($('setCustom').value || '');
    state.settings.template = $('setTemplate').checked;
    state.settings.templateAlpha = clamp(parseFloat($('setAlpha').value) || 0.15, 0.03, 0.6);
    var sc = [];
    $('setScripts').querySelectorAll('[data-script]').forEach(function (cb) { if (cb.checked) sc.push(cb.getAttribute('data-script')); });
    state.settings.scripts = sc;
    state.settings.fallbackFont = $('setFallback').checked;
    state.settings.claude = { lang: $('setClaudeLang').value || null, paper: $('setClaudePaper').value, size: parseFloat($('setClaudeSize').value) || 6,
                              color: $('setClaudeColor').value, page: $('setClaudePage').value };
    state.meta.claudeSet = true;
    var lang = $('setLang').value;
    $('mSettings').classList.remove('show');
    if (lang !== I18N.lang()) setLanguage(lang); else { scheduleSave(); renderAll(); }
  });
  var wipeArmed = false, wipeTimer = null;
  $('btnWipe').addEventListener('click', function () {
    if (!wipeArmed) {
      wipeArmed = true; this.textContent = t('set.wipeConfirm', { n: totals().allSamples });
      clearTimeout(wipeTimer); var self = this;
      wipeTimer = setTimeout(function () { wipeArmed = false; self.textContent = t('set.wipe'); }, 5000);
      return;
    }
    // Keep a last copy for "undo" until the page is closed.
    var backup = JSON.stringify(state.glyphs), backupCustom = state.settings.custom;
    var keep = state.settings, keepMeta = state.meta; state = defaultState(); state.settings = keep;
    state.meta.introSeen = true; state.meta.wizardDone = keepMeta.wizardDone;
    current = null; drawing = []; history = []; $('mSettings').classList.remove('show'); saveNow(); renderAll();
    toast(t('toast.wiped'), t('toast.undo'), function () { state.glyphs = JSON.parse(backup); state.settings.custom = backupCustom; saveNow(); renderAll(); });
  });

  /* ------------------------------ keys & buttons ------------------------------ */
  $('btnSave').addEventListener('click', saveSample);
  $('btnUndo').addEventListener('click', undoStep);
  $('btnClear').addEventListener('click', clearPad);
  $('btnSkip').addEventListener('click', skip);
  $('btnBack').addEventListener('click', back);
  $('btnTemplate').addEventListener('click', toggleTemplate);
  $('btnExport').addEventListener('click', doExport);
  $('bannerExport').addEventListener('click', doExport);
  $('doneWrite').addEventListener('click', openWrite);
  $('btnWrite').addEventListener('click', openWrite);
  $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
  $('btnHelp').addEventListener('click', function () { openModal('mHelp'); });
  $('helpRestart').addEventListener('click', function () { $('mHelp').classList.remove('show'); openWizard(0); });
  document.addEventListener('keydown', function (e) {
    if (modalOpen()) {
      if (e.key === 'Escape') { var m = document.querySelector('.modal-bg.show'); if (m) closeModal(m.id); }
      return;
    }
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (e.key === 'Enter') { e.preventDefault(); saveSample(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undoStep(); }
    else if (e.key === 'Escape') { clearPad(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skip(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleTemplate(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
  window.addEventListener('pagehide', function () { if (saveTimer) saveNow(); });

  window.addEventListener('resize', function () { resizePad(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { resizePad(); }).observe(document.querySelector('main'));

  /* ------------------------------ offline app (only via http/https) ------------------------------ */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* ------------------------------ start ------------------------------ */
  // Read-only access for automated tests / Claude
  window.MyHandwriting = {
    exportData: buildExport, state: function () { return state; }, current: function () { return current; }, version: APP_VERSION,
    groups: groups, setCurrent: setCurrent, openWrite: openWrite, lastBuild: function () { return lastBuild; },
    addCustom: addCustom, penSeen: function () { return penSeen; }, strokes: function () { return drawing.length; }
  };

  I18N.setLang('en');                 // English is the default; the wizard asks first
  loadState().catch(function () {}).then(function () {
    I18N.setLang(state.settings.lang || 'en');
    document.title = t('app.title');
    I18N.apply(); fillLangSelect($('langSel'));
    current = state.meta.current && order().indexOf(state.meta.current) >= 0 ? state.meta.current : null;
    resizePad(true); renderAll();
    document.documentElement.setAttribute('data-started', '1');
    if (!state.meta.wizardDone) openWizard(0);
    return saveNow();
  });
})();
