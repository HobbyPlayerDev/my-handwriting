/* my-handwriting - capture app: write samples, keep them in the browser, export/import,
 * write texts with them (js/render.js). Everything stays on this device. */
(function () {
  'use strict';
  var t = I18N.t;

  /* ------------------------------------------------------------------ *
   *  Constants – must match the Python renderer (data format version 1) *
   * ------------------------------------------------------------------ */
  var APP_VERSION = '1.6.0';
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
  var PAGES = ['a4', 'a5', 'letter'], ALIGNS = ['left', 'center', 'right'];
  var PAD_KEY = 'my-handwriting-padsize';     // device setting: size of the writing area in % (100 = fits the screen)
  var LINE_KEY = 'my-handwriting-padline';    // device setting: line width while writing in % (100 = normal)
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
                  template: true, templateAlpha: 0.15, lang: null, fallbackFont: true, realism: true,
                  claude: { lang: null, paper: 'lined', size: 6, color: 'blue', page: 'a4', align: 'left', variation: 1 },
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
  /** An icon from the sprite in index.html (own drawings). */
  function icon(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

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
  /* Several handwritings (profiles): IndexedDB 'my-handwriting' / store 'kv':
       'profiles' = JSON {active, list: [{id, name, created, samples}]},  'state:<id>' = JSON {savedAt, state}.
     localStorage keeps a second copy of both (if there is room). The UI language is a device setting. */
  var DB_NAME = 'my-handwriting', DB_STORE = 'kv', LS_KEY = 'my-handwriting-state';
  var PROF_KEY = 'profiles', LS_PROF = 'my-handwriting-profiles', LANG_KEY = 'my-handwriting-lang';
  var OLD_DB = 'handschrift-erfassung', OLD_LS = 'handschrift-erfassung-state';   // before the rename
  var dbPromise = null;
  var profiles = { active: null, list: [] };
  function idbOpen(name) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(name || DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('blocked')); };
      setTimeout(function () { reject(new Error('timeout')); }, 8000);   // slow phones can need a few seconds
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
  function idbWrite(db, key, val) {          // val === undefined -> delete
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('abort')); };
        if (val === undefined) tx.objectStore(DB_STORE).delete(key); else tx.objectStore(DB_STORE).put(val, key);
      } catch (e) { reject(e); }
    });
  }
  function withDb(fn) { return (dbPromise || Promise.resolve(null)).then(function (db) { return db ? fn(db) : null; }).catch(function () { return null; }); }
  function lsGet(key) { try { return localStorage.getItem(key || LS_KEY); } catch (e) { return null; } }
  function lsSet(key, v) { try { if (v === undefined) localStorage.removeItem(key); else localStorage.setItem(key, v); return true; } catch (e) { return false; } }
  function stateKey(id) { return 'state:' + id; }
  function lsStateKey(id) { return LS_KEY + ':' + id; }
  function parseSaved(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { var o = JSON.parse(raw); return (o && o.state && o.state.glyphs) ? o : null; } catch (e) { return null; }
  }
  function newestOf(list) { return list.filter(Boolean).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })[0] || null; }
  function profile(id) { return profiles.list.filter(function (p) { return p.id === (id || profiles.active); })[0] || null; }
  function profileName(id) { var p = profile(id); return p ? p.name : ''; }
  function newProfileId() { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function defaultName() {
    var n = profiles.list.length + 1, name;
    do { name = t('prof.default', { n: n++ }); } while (profiles.list.some(function (p) { return p.name === name; }));
    return name;
  }

  var statusKey = 'save.loading';
  function setStatus(key) { statusKey = key; var el = $('saveStatus'); el.textContent = t(key); el.className = 'status' + (key === 'save.fail' ? ' err' : ''); }

  /* A handwriting whose saved samples could not be read (storage slow or broken at that moment) is
     never written: an empty state would overwrite the real samples. A reload reads them again. */
  var unreadable = {};
  function checkLoaded(id, st) {
    var p = profile(id);
    if (!st && p && p.samples > 0) { unreadable[id] = true; setTimeout(function () { toast(t('toast.loadFail')); }, 0); }
    else delete unreadable[id];
    return st;
  }
  function scheduleSave() { if (paused) return; clearTimeout(saveTimer); setStatus('save.saving'); saveTimer = setTimeout(saveNow, 350); }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (paused) return Promise.resolve(false);     // another tab owns the data now
    if (unreadable[profiles.active]) { saveOk = false; setStatus('save.fail'); return Promise.resolve(false); }
    state.meta.current = current;
    var p0 = profile(); if (p0) p0.samples = totals().allSamples;
    var id = profiles.active;
    var payload = JSON.stringify({ savedAt: Date.now(), state: state }), prof = JSON.stringify(profiles);
    var p = withDb(function (db) {
      return idbWrite(db, stateKey(id), payload).then(function () { return idbWrite(db, PROF_KEY, prof); }).then(function () { return 'idb'; });
    }).then(function (where) {
      var ls = lsSet(lsStateKey(id), payload) && lsSet(LS_PROF, prof);   // second copy (if there is room)
      storageMode = where || (ls ? 'local' : 'none');
      return !!(where || ls);
    });
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
  /** The saved state of a handwriting (newest of IndexedDB and localStorage), or null. */
  function readState(id) {
    return withDb(function (db) { return idbGet(db, stateKey(id)).catch(function () { return null; }); }).then(function (raw) {
      var best = newestOf([parseSaved(raw), parseSaved(lsGet(lsStateKey(id)))]);
      return best ? mergeDefaults(best.state) : null;
    });
  }
  function writeState(id, st) {
    var payload = JSON.stringify({ savedAt: Date.now(), state: st });
    return withDb(function (db) { return idbWrite(db, stateKey(id), payload); }).then(function () { lsSet(lsStateKey(id), payload); });
  }
  function dropState(id) {
    return withDb(function (db) { return idbWrite(db, stateKey(id), undefined); }).then(function () { lsSet(lsStateKey(id), undefined); });
  }
  function loadState() {
    dbPromise = (typeof indexedDB !== 'undefined') ? idbOpen().catch(function () { return null; }) : Promise.resolve(null);
    return withDb(function (db) { return idbGet(db, PROF_KEY).catch(function () { return null; }); }).then(function (raw) {
      var p = null;
      [raw, lsGet(LS_PROF)].some(function (r) {
        try { var o = r && JSON.parse(r); if (o && Array.isArray(o.list) && o.list.length) { p = o; return true; } } catch (e) {}
        return false;
      });
      if (p) {
        profiles = { active: p.active, list: p.list.filter(function (x) { return x && x.id; }).map(function (x) { return { id: String(x.id), name: String(x.name || '').slice(0, 60) || '?', created: x.created || 0, samples: x.samples || 0 }; }) };
        if (!profile(profiles.active)) profiles.active = profiles.list[0].id;
        return readState(profiles.active).then(function (st) { checkLoaded(profiles.active, st); state = st || defaultState(); if (!st) state.meta.wizardDone = true; });
      }
      // first start of this version: data of the single-handwriting version or of the old name
      return readSingle().then(function (st) {
        var id = newProfileId();
        profiles = { active: id, list: [{ id: id, name: t('prof.default', { n: 1 }), created: Date.now(), samples: 0 }] };
        state = st || defaultState();
      });
    });
  }
  function readSingle() {
    return withDb(function (db) { return idbGet(db, 'state').catch(function () { return null; }); }).then(function (raw) {
      var best = newestOf([parseSaved(raw), parseSaved(lsGet(LS_KEY))]);
      return best ? mergeDefaults(best.state) : loadOld();
    });
  }
  // Data saved under the old project name (same browser, same address): copied over once, the old
  // copy is left untouched.
  function loadOld() {
    var fromLs = lsGet(OLD_LS);
    var fromDb = (typeof indexedDB !== 'undefined' && indexedDB.databases)
      ? indexedDB.databases().then(function (list) {
          if (!list.some(function (d) { return d.name === OLD_DB; })) return null;
          return idbOpen(OLD_DB).then(function (db) { var p = idbGet(db, 'state'); p.then(function () { db.close(); }, function () { db.close(); }); return p; });
        }).catch(function () { return null; })
      : Promise.resolve(null);
    return fromDb.then(function (raw) {
      var best = newestOf([parseSaved(raw), parseSaved(fromLs)]);
      if (!best) return null;
      var st = mergeDefaults(best.state); st.meta.migrated = true; return st;
    });
  }

  /* ------------------------------ handwritings (profiles) ------------------------------ */
  function resetWork() { current = null; drawing = []; history = []; glyphSet = null; }
  function switchProfile(id) {
    if (!profile(id) || id === profiles.active || activePointer !== null) return Promise.resolve(false);
    return saveNow().then(function () { return readState(id); }).then(function (st) {
      checkLoaded(id, st);
      profiles.active = id; state = st || defaultState(); if (!st) state.meta.wizardDone = true;
      resetWork(); renderAll(); saveNow();
      toast(t('prof.switched', { name: profileName() }));
      return true;
    });
  }
  function createProfile(name) {
    if (activePointer !== null) return Promise.resolve(null);
    return saveNow().then(function () {
      var keep = state.settings, id = newProfileId();
      profiles.list.push({ id: id, name: (name || '').trim().slice(0, 60) || defaultName(), created: Date.now(), samples: 0 });
      profiles.active = id;
      state = defaultState();
      state.settings.lang = I18N.lang(); state.settings.claude = Object.assign({}, keep.claude); state.settings.fallbackFont = keep.fallbackFont; state.settings.realism = keep.realism;
      resetWork(); renderAll(); saveNow();
      toast(t('prof.created', { name: profileName() }));
      openWizard(2);
      return id;
    });
  }
  function renameProfile(id, name) {
    var p = profile(id); name = String(name || '').trim().slice(0, 60);
    if (!p || !name) return;
    p.name = name; renderProfileName(); scheduleSave();
  }
  function deleteProfile(id) {
    var p = profile(id);
    if (!p) return Promise.resolve(false);
    if (profiles.list.length < 2) { toast(t('prof.lastOne')); return Promise.resolve(false); }
    var wasActive = id === profiles.active;
    return saveNow().then(function () { return readState(id); }).then(function (backup) {
      var idx = profiles.list.indexOf(p);
      profiles.list.splice(idx, 1);
      return dropState(id).then(function () {
        if (wasActive) { profiles.active = profiles.list[0].id; return readState(profiles.active); }
        return null;
      }).then(function (st) {
        if (wasActive) { checkLoaded(profiles.active, st); state = st || defaultState(); resetWork(); }
        renderAll(); saveNow(); if ($('mSettings').classList.contains('show')) renderProfiles();
        toast(t('prof.deleted', { name: p.name }), t('toast.undo'), function () {
          profiles.list.splice(Math.min(idx, profiles.list.length), 0, p);
          writeState(id, backup || defaultState()).then(function () { renderAll(); saveNow(); if ($('mSettings').classList.contains('show')) renderProfiles(); });
        });
        return true;
      });
    });
  }
  /** Everything back to the first start. Kept in memory for "undo" until the page is closed. */
  function resetAll() {
    if (activePointer !== null) return Promise.resolve(false);
    return saveNow().then(function () {
      return Promise.all(profiles.list.map(function (p) { return readState(p.id).then(function (st) { return [p.id, st]; }); }));
    }).then(function (pairs) {
      var keepProfiles = JSON.parse(JSON.stringify(profiles));
      return Promise.all(pairs.map(function (pr) { return dropState(pr[0]); })).then(function () {
        var id = newProfileId();
        profiles = { active: id, list: [{ id: id, name: t('prof.default', { n: 1 }), created: Date.now(), samples: 0 }] };
        state = defaultState(); state.settings.lang = I18N.lang();
        resetWork(); saveNow(); renderAll();
        closeModal('mSettings');
        openWizard(0);
        toast(t('toast.reset'), t('toast.undo'), function () {
          var newId = profiles.active;
          Promise.all(pairs.map(function (pr) { return pr[1] ? writeState(pr[0], pr[1]) : null; })).then(function () { return dropState(newId); }).then(function () {
            profiles = keepProfiles;
            return readState(profiles.active);
          }).then(function (st) {
            checkLoaded(profiles.active, st);
            state = st || defaultState(); state.meta.wizardDone = true;
            closeModal('mWizard'); resetWork(); renderAll(); saveNow();
          });
        });
        return true;
      });
    });
  }
  function renderProfileName() { $('profName').textContent = profileName(); }
  function renderProfMenu() {
    var html = '<div class="menu-title">' + esc(t('prof.title')) + '</div>';
    profiles.list.forEach(function (p) {
      var on = p.id === profiles.active;
      html += '<button type="button" role="menuitemradio" aria-checked="' + on + '" data-prof="' + esc(p.id) + '" class="' + (on ? 'on' : '') + '">' +
        (on ? icon('check') : icon('check', 'blank')) + esc(p.name) + ' <small>' + esc(t('prof.samples', { n: on ? totals().allSamples : (p.samples || 0) })) + '</small></button>';
    });
    html += '<div class="menu-sep"></div><button type="button" role="menuitem" data-prof-new>' + icon('plus') + esc(t('prof.new')) + '</button>' +
      '<button type="button" role="menuitem" data-act="settings">' + icon('sliders') + esc(t('hdr.settings')) + '</button>';
    $('profMenu').innerHTML = html;
  }
  function renderProfiles() {
    var html = '';
    profiles.list.forEach(function (p) {
      var on = p.id === profiles.active, n = on ? totals().allSamples : (p.samples || 0);
      html += '<div class="prow' + (on ? ' on' : '') + '" data-pid="' + esc(p.id) + '"><span class="pname">' + esc(p.name) + '</span><small>' +
        esc(t('prof.samples', { n: n })) + (on ? ' · ' + esc(t('prof.active')) : '') + '</small><span class="spacer"></span>' +
        (on ? '' : '<button type="button" data-p="switch">' + esc(t('prof.switch')) + '</button>') +
        '<button type="button" data-p="rename">' + esc(t('prof.rename')) + '</button>' +
        '<button type="button" data-p="delete" class="danger">' + esc(t('prof.delete')) + '</button></div>';
    });
    html += '<button type="button" data-p="new">' + icon('plus') + esc(t('prof.new')) + '</button>';
    $('setProfiles').innerHTML = html;
  }
  var delArmed = null, delTimer = null;
  $('setProfiles').addEventListener('click', function (e) {
    var b = e.target.closest('[data-p]'); if (!b) return;
    var row = b.closest('[data-pid]'), id = row && row.getAttribute('data-pid'), act = b.getAttribute('data-p');
    if (act === 'new') { closeModal('mSettings'); createProfile(''); return; }
    if (act === 'switch') { closeModal('mSettings'); switchProfile(id); return; }
    if (act === 'rename') {
      var p = profile(id);
      row.innerHTML = '<input type="text" maxlength="60" data-pname value="' + esc(p.name) + '" aria-label="' + esc(t('prof.renamePh')) + '"><button type="button" class="primary" data-p="save">' + esc(t('prof.save')) + '</button>';
      var inp = row.querySelector('input'); inp.focus(); inp.select();
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); renameProfile(id, inp.value); renderProfiles(); } });
      return;
    }
    if (act === 'save') { renameProfile(id, row.querySelector('input').value); renderProfiles(); return; }
    if (act === 'delete') {
      if (profiles.list.length < 2) { toast(t('prof.lastOne')); return; }
      if (delArmed !== id) {
        delArmed = id; var pp = profile(id);
        b.textContent = t('prof.deleteConfirm', { name: pp.name, n: id === profiles.active ? totals().allSamples : (pp.samples || 0) });
        clearTimeout(delTimer); delTimer = setTimeout(function () { delArmed = null; renderProfiles(); }, 5000);
        return;
      }
      delArmed = null; clearTimeout(delTimer);
      deleteProfile(id);
    }
  });

  function mergeDefaults(s) {
    var d = defaultState();
    var out = { glyphs: {}, settings: Object.assign({}, d.settings, s.settings || {}), meta: Object.assign({}, d.meta, s.meta || {}) };
    out.settings.groups = Object.assign({}, (s.settings && s.settings.groups) || {});
    out.settings.write = Object.assign({}, d.settings.write, (s.settings && s.settings.write) || {});
    out.settings.claude = Object.assign({}, d.settings.claude, (s.settings && s.settings.claude) || {});
    if (typeof out.settings.custom !== 'string') out.settings.custom = '';
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
  var PAD_MIN = 10, PAD_MAX = 160;
  var padScale = (function () { try { var v = parseInt(localStorage.getItem(PAD_KEY), 10); return v >= PAD_MIN && v <= PAD_MAX ? v : 100; } catch (e) { return 100; } })();
  var padPreview = null;   // slider in the settings, not saved yet
  // line width on the writing area only (what you see while writing - the samples and the documents
  // are not changed by it): thinner for a big area, thicker for a small one or a thick pen feeling
  var LINE_MIN = 25, LINE_MAX = 300;
  var padLine = (function () { try { var v = parseInt(localStorage.getItem(LINE_KEY), 10); return v >= LINE_MIN && v <= LINE_MAX ? v : 100; } catch (e) { return 100; } })();
  var padLinePreview = null;
  function padLineK() { return (padLinePreview !== null ? padLinePreview : padLine) / 100; }

  function resizePad(force) {
    // As big as possible, but the buttons should stay visible without scrolling
    var main = document.querySelector('main');
    var availW = Math.max(240, (main.clientWidth || 640) - 28);
    var headerH = document.querySelector('header').offsetHeight || 56;
    var availH = Math.max(230, window.innerHeight - headerH - 270);
    // 100 % = as big as fits; smaller for small letters, bigger (up to the full width, then the page
    // scrolls) for big letters on a large screen - a setting of this device (localStorage)
    var pct = padPreview !== null ? padPreview : padScale;
    var w = Math.floor(Math.min(820, availW, availH * M.boxWidth / BOX_H) * pct / 100);
    w = Math.max(Math.min(40, availW), Math.min(w, availW));
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

  // Ctrl + mouse wheel (or a touchpad pinch, which browsers send the same way) on the writing side of
  // the page: size in steps of 10 %, saved for this device like the slider in the settings. Not only over
  // the area itself: it shrinks away from the mouse, and the next turn of the wheel then zoomed the whole
  // page in Chrome instead. The header, the overview and open dialogs keep the browser's own zoom.
  function setPadScale(v) {
    padScale = clamp(Math.round(v / 10) * 10, PAD_MIN, PAD_MAX); padPreview = null;
    try { if (padScale === 100) localStorage.removeItem(PAD_KEY); else localStorage.setItem(PAD_KEY, String(padScale)); } catch (e) {}
    resizePad(true);
  }
  var wheelSum = 0, wheelTimer = null;
  function onWritingSide(el) {
    if (!el || !el.closest || modalOpen()) return false;
    if (el.closest('header, #overview, .modal-bg, #toast')) return false;
    return !!el.closest('main, .layout') || el === document.body || el === document.documentElement;
  }
  window.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey) || activePointer !== null || !onWritingSide(e.target)) return;   // Ctrl, ⌘ (Mac)
    e.preventDefault();                               // instead of zooming the whole page
    wheelSum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    clearTimeout(wheelTimer); wheelTimer = setTimeout(function () { wheelSum = 0; }, 400);
    if (Math.abs(wheelSum) < 50) return;               // one notch of a mouse wheel = 100
    var step = wheelSum < 0 ? 10 : -10; wheelSum = 0;
    var before = padScale; setPadScale(padScale + step);
    if (padScale !== before) toast(t('pad.sizeToast', { n: padScale }));
  }, { passive: false });

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
    // line names on the right - only where they fit between the guide letter in the middle (a wide
    // one like W is about 0.9 units) and the edge; a small writing area (e.g. 10 %) had them right
    // across the letter
    c.font = '11px system-ui, sans-serif';
    var names = [t('guide.cap'), t('guide.x'), t('guide.base'), t('guide.desc')];
    var longest = Math.max.apply(null, names.map(function (s) { return c.measureText(s).width; }));
    if (!small && w / 2 - 0.45 * u >= longest + 20) {
      c.fillStyle = '#a3a9bb'; c.textAlign = 'right';
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
  function inkStyle(c, u, k) { c.strokeStyle = '#1f2f86'; c.lineWidth = Math.max(0.6, Math.max(1.2, PEN * u) * (k || 1)); c.lineCap = 'round'; c.lineJoin = 'round'; }
  function redrawPad() {
    var h = padCssW * BOX_H / M.boxWidth;
    ctx.clearRect(0, 0, padCssW, h);
    drawGuides(ctx, padU, padCssW, false);
    drawTemplate(ctx, padU, padCssW);
    inkStyle(ctx, padU, padLineK());
    drawing.forEach(function (st) { strokePath(ctx, st, padU); });
    // while the line width slider moves and nothing is written yet: a sample line to see the width
    if (padLinePreview !== null && !drawing.length) {
      var demo = []; for (var di = 0; di <= 40; di++) demo.push([0.35 + di * 0.0375, 0.3 + 0.18 * Math.sin(di / 40 * Math.PI * 3)]);
      strokePath(ctx, demo, padU);
    }
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
    inkStyle(ctx, padU, padLineK());
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
    inkStyle(ctx, padU, padLineK());
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
    var ch = current, sid = uid();
    (state.glyphs[ch] = state.glyphs[ch] || []).push({ id: sid, created: Date.now(), strokes: enc, dev: lastPointerType });
    fx.sample = sid; fx.dotFor = ch; fx.dot = count(ch) - 1; fx.done = count(ch) === target() ? ch : null;
    playSaved();
    drawing = []; history = [];
    var tg = target();
    if (state.settings.mode === 'round') { var n = nextInRound(ch); if (n) current = n; }
    else if (count(ch) >= tg) { var n2 = nextIncomplete(ch); if (n2) current = n2; }
    scheduleSave();
    renderAll();
    if (edge) toast(t('toast.edge'));
  }
  /* small one-shot animations (see css "motion"); fx is consumed by the next render */
  var fx = { sample: null, dot: -1, dotFor: null, done: null, opening: null, lastTarget: null };
  function replay(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function playSaved() { replay($('padOk'), 'show'); replay($('padwrap'), 'saved'); }
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
    renderPrompt(); renderSamples(); renderOverview(); renderProgress(); redrawPad(); updateBadge(); renderProfileName();
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
    if (fx.lastTarget !== null && fx.lastTarget !== current) replay($('targetChar'), 'change');
    fx.lastTarget = current;
    $('charName').textContent = charName(current);
    $('charMeta').textContent = n < tg ? t('prompt.meta', { group: groupName(g), n: n + 1, t: tg }) : t('prompt.metaExtra', { group: groupName(g), n: n + 1 });
    $('charHint').textContent = groupHint(g);
    var html = '';
    for (var i = 0; i < Math.max(tg, n); i++) html += '<i class="' + (i < n ? (i < tg ? 'on' : 'extra') : '') + (fx.dotFor === current && i === fx.dot ? ' pop' : '') + '"></i>';
    $('dots').innerHTML = html;
    fx.dotFor = null;
  }
  function renderSamples() {
    var box = $('samples'); box.innerHTML = '';
    if (!current) return;
    var arr = state.glyphs[current] || [];
    if (!arr.length) { box.innerHTML = '<div class="empty">' + esc(t('samples.none')) + '</div>'; return; }
    var sus = suspects(current);
    arr.forEach(function (s, i) {
      var d = document.createElement('div'); d.className = 'thumb' + (sus[s.id] ? ' suspect' : '') + (s.id === fx.sample ? ' new' : '');
      if (sus[s.id]) d.title = t('sample.suspect', { r: sus[s.id].join(', ') });
      var c = document.createElement('canvas'); var W = 92, H = Math.round(W * BOX_H / M.boxWidth);
      var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
      var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var u = W / M.boxWidth;
      drawGuides(cx, u, W, true); inkStyle(cx, u);
      decodeStrokes(s).forEach(function (st) { strokePath(cx, st, u); });
      var no = document.createElement('span'); no.className = 'no'; no.textContent = (i + 1) + (sus[s.id] ? ' !' : '');
      var del = document.createElement('button'); del.type = 'button'; del.className = 'del'; del.innerHTML = icon('x'); del.title = t('sample.del');
      del.setAttribute('aria-label', t('sample.del'));
      del.addEventListener('click', function () { deleteSample(current, s.id); });
      d.appendChild(c); d.appendChild(no); d.appendChild(del); box.appendChild(d);
    });
    fx.sample = null;
  }
  function decodeStrokes(s) {
    return s.strokes.map(function (st) { var pts = []; for (var i = 0; i + 1 < st.length; i += 2) pts.push([st[i] / SCALE, st[i + 1] / SCALE]); return pts; });
  }
  var ovOpen = {};    // group id -> open (true/false); not set = open if it holds the current character
  function groupOpen(g) { return ovOpen[g.id] !== undefined ? ovOpen[g.id] : (g.kind === 'custom' || g.chars.indexOf(current) >= 0); }
  function groupHead(g, name, extra) {
    var tg = target(), done = g.chars.filter(function (c) { return count(c) >= tg; }).length;
    var pct = g.chars.length ? Math.round(done / g.chars.length * 100) : 0, open = groupOpen(g);
    return '<h3><button type="button" class="gtoggle" data-gtoggle="' + g.id + '" aria-expanded="' + open + '" aria-label="' + esc(name) + '">' + icon('chev') + '</button>' +
      '<label title="' + esc(t('ov.toggle')) + '"><input type="checkbox" data-group="' + g.id + '"' + (g.on ? ' checked' : '') + '> ' + esc(name) + '</label>' +
      '<small>' + (extra || '') + done + ' / ' + g.chars.length + '</small></h3><div class="gbar"><i style="width:' + pct + '%"></i></div>';
  }
  function renderOverview() {
    var el = $('overview'), tg = target(), html = '<h2>' + esc(t('ov.title')) + '</h2>';
    groups().forEach(function (g) {
      var name = groupName(g), open = groupOpen(g);
      if (g.kind === 'custom') {
        html += '<div class="group custom' + (g.on ? '' : ' off') + (open ? ' open' : '') + (fx.opening === g.id ? ' opening' : '') + '">' +
          groupHead(g, name, customChars().length ? '<a href="#" data-open-settings>' + esc(t('ov.edit')) + '</a> · ' : '');
        if (!open) { html += '</div>'; return; }
        if (g.chars.length) {
          html += '<div class="cells">';
          g.chars.forEach(function (c) { html += cellHtml(c, tg); });
          html += '</div>';
        }
        html += '<form class="addchars" data-add-form><input type="text" id="addChars" maxlength="40" autocomplete="off" spellcheck="false" placeholder="' + esc(t('ov.addPh')) +
          '" aria-label="' + esc(t('ov.addPh')) + '"><button type="submit">' + esc(t('ov.addBtn')) + '</button></form></div>';
        return;
      }
      html += '<div class="group' + (g.on ? '' : ' off') + (open ? ' open' : '') + (fx.opening === g.id ? ' opening' : '') + '">' + groupHead(g, name);
      if (open) { html += '<div class="cells">'; g.chars.forEach(function (c) { html += cellHtml(c, tg); }); html += '</div>'; }
      html += '</div>';
    });
    fx.done = null; fx.opening = null;
    var keep = $('addChars') ? $('addChars').value : '', focused = document.activeElement && document.activeElement.id === 'addChars';
    el.innerHTML = html;
    if ($('addChars')) { $('addChars').value = keep; if (focused) $('addChars').focus(); }
  }
  function cellHtml(c, tg) {
    var n = count(c), pct = Math.min(100, Math.round(n / tg * 100));
    var warn = Object.keys(suspects(c)).length > 0;
    return '<button type="button" class="cell' + (n >= tg ? ' done' : '') + (c === current ? ' cur' : '') + (warn ? ' warn' : '') + (c === fx.done ? ' bump' : '') + '" data-ch="' + esc(c) + '" title="' +
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
    var tog = e.target.closest('[data-gtoggle]');
    if (tog) {
      var gid = tog.getAttribute('data-gtoggle'), g = groups().filter(function (x) { return x.id === gid; })[0];
      if (g) { ovOpen[gid] = !groupOpen(g); fx.opening = ovOpen[gid] ? gid : null; renderOverview(); }
      return;
    }
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
    b.onclick = function () { hideToast(); if (btnFn) btnFn(); };
    el.classList.remove('hiding'); el.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, btnText ? 6000 : 3200);
  }
  function hideToast() {
    var el = $('toast'); if (!el.classList.contains('show')) return;
    el.classList.remove('show'); el.classList.add('hiding');
    setTimeout(function () { if (!el.classList.contains('show')) el.classList.remove('hiding'); }, 220);
  }
  /* Dialogs. The phone's back button / back gesture closes an open dialog: opening one adds a
     history entry, closing it (any way) removes that entry again. */
  function onDialogEntry() { try { return !!(window.history.state && window.history.state.myHandwritingDialog); } catch (e) { return false; } }
  var selfBack = false;
  function openModal(id) {
    closeMenus(); if (window.UISelect) UISelect.close(false);
    $(id).classList.remove('hiding'); $(id).classList.add('show');
    if (!onDialogEntry()) { try { window.history.pushState({ myHandwritingDialog: 1 }, ''); } catch (e) {} }
    var m = $(id).querySelector('.modal'); if (m) m.scrollTop = 0;
  }
  function closeModal(id, fromHistory) {
    if (!$(id).classList.contains('show')) return;
    if (window.UISelect) UISelect.close(false);
    var bg = $(id); bg.classList.remove('show'); bg.classList.add('hiding');
    setTimeout(function () { if (!bg.classList.contains('show')) bg.classList.remove('hiding'); }, 230);
    if (id === 'mWizard') finishWizard(false);
    if (id === 'mSettings' && padPreview !== null) { padPreview = null; resizePad(true); }   // closed without Save
    if (id === 'mSettings' && padLinePreview !== null) { padLinePreview = null; redrawPad(); }
    if (fromHistory) return;
    // a following dialog may open in the same step (settings -> setup helper): decide afterwards
    setTimeout(function () {
      if (modalOpen() || !onDialogEntry()) return;
      selfBack = true; setTimeout(function () { selfBack = false; }, 600);
      try { window.history.back(); } catch (e) { selfBack = false; }
    }, 0);
  }
  window.addEventListener('popstate', function () {
    if (selfBack) {      // our own step back; a dialog that opened meanwhile needs its entry again
      selfBack = false;
      if (modalOpen() && !onDialogEntry()) { try { window.history.pushState({ myHandwritingDialog: 1 }, ''); } catch (e) {} }
      return;
    }
    if (onDialogEntry()) return;
    if (wizardLocked()) { try { window.history.pushState({ myHandwritingDialog: 1 }, ''); } catch (e) {} return; }   // first setup stays open
    document.querySelectorAll('.modal-bg.show').forEach(function (m) { closeModal(m.id, true); });
  });
  function modalOpen() { return !!document.querySelector('.modal-bg.show'); }
  document.querySelectorAll('.modal-bg').forEach(function (bg) {
    // every dialog gets an × at the top right
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.setAttribute('data-close', ''); x.setAttribute('data-i18n-aria', 'btn.close'); x.setAttribute('data-i18n-title', 'btn.close');
    x.innerHTML = icon('x');
    bg.querySelector('.modal').appendChild(x);
    bg.addEventListener('click', function (e) {
      if ((e.target === bg && bg.id !== 'mWizard') || e.target.closest('[data-close]')) closeModal(bg.id);
    });
  });

  /* ------------------------------ wizard ------------------------------ */
  var wiz = { step: 0, scripts: [], target: 10, template: true, docs: null, fallback: true, dir: 1 };
  var WIZ_STEPS = 6;   // language, how it works, you (name + writing languages), documents, practice, ready
  var WIZ_NAMES = ['wiz.stepLang', 'wiz.stepHow', 'wiz.stepYou', 'wiz.stepDocs', 'wiz.stepPractice', 'wiz.stepDone'];
  function openWizard(fromStep) {
    wiz.step = fromStep || 0; wiz.seen = wiz.step; wiz.name = profileName(); wiz.dir = 1;
    closeMenus();
    wiz.scripts = Array.isArray(state.settings.scripts) ? state.settings.scripts.slice() : [I18N.lang()];
    wiz.target = target(); wiz.template = templateOn();
    wiz.docs = Object.assign({}, state.settings.claude); wiz.fallback = state.settings.fallbackFont !== false; wiz.real = state.settings.realism !== false;
    renderWizard(); openModal('mWizard');
    // first start: the setup is gone through once (no "skip", no ×)
    var x = $('mWizard').querySelector('.x'); if (x) x.hidden = firstSetup();
  }
  /** The very first start (or after "reset everything"): the setup is not skipped. */
  function firstSetup() { return !state.meta.wizardDone && profiles.list.length < 2; }
  function wizardLocked() { return $('mWizard').classList.contains('show') && firstSetup(); }
  function options(values, labelFn, sel) {
    return values.map(function (v) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(labelFn(v)) + '</option>'; }).join('');
  }
  function sizeLabel(v) { return String(v).replace('.', I18N.lang() === 'en' ? '.' : ',') + ' mm'; }
  function docFields(d, attr) {
    return '<div class="fields">' +
      '<label><span>' + esc(t('write.paper')) + '</span><select ' + attr + '="paper">' + options(PAPERS, function (v) { return t('paper.' + v); }, d.paper) + '</select></label>' +
      '<label><span>' + esc(t('write.size')) + '</span><select ' + attr + '="size">' + options(SIZES, sizeLabel, d.size) + '</select></label>' +
      '<label><span>' + esc(t('write.color')) + '</span><select ' + attr + '="color">' + options(COLORS, function (v) { return t('color.' + v); }, d.color) + '</select></label>' +
      '<label><span>' + esc(t('write.page')) + '</span><select ' + attr + '="page">' + options(PAGES, function (v) { return t('page.' + v); }, d.page) + '</select></label>' +
      '<label><span>' + esc(t('write.align')) + '</span><select ' + attr + '="align">' + options(ALIGNS, function (v) { return t('align.' + v); }, d.align || 'left') + '</select></label>' +
      '<label><span>' + esc(t('write.variation')) + ' <b class="rv">' + varLabel(docVar(d)) + '</b></span><input type="range" min="0" max="2" step="0.1" ' + attr + '="variation" value="' + docVar(d) + '"></label></div>';
  }
  /** Irregularity: number 0-2 inside, shown like Claude reports it (50 % = 1 = default). */
  function docVar(d) { var v = Number(d && d.variation); return isFinite(v) && d.variation !== null && d.variation !== '' ? clamp(v, 0, 2) : 1; }
  function varLabel(v) { return Math.round(v * 50) + ' %'; }
  /** Keep the "50 %" next to a slider up to date (the label is the slider's parent label). */
  function showVar(input) { var b = input.parentNode.querySelector('.rv'); if (b) b.textContent = varLabel(parseFloat(input.value) || 0); }
  /* Small live example of the document defaults (standard handwriting, as there may be no samples yet). */
  function drawDocPreview() {
    var c = $('wizPreview'); if (!c || !window.Render) return;
    try {
      var gs = new Render.GlyphSet(state.glyphs, SCALE), d = wiz.docs;
      var res = Render.buildPages(t('wiz.docsSample'), gs, { page: 'auto', size: d.size, paper: d.paper, align: d.align || 'left', variation: docVar(d), seed: 7,
        lineSpacing: d.paper === 'lined' ? Math.max(6, d.size * 1.9) : null, font: window.FallbackFont || null, fallbackFont: wiz.fallback, realism: wiz.real });
      var pg = res.pages[0], cssW = Math.max(200, c.parentNode.clientWidth || 400), k = Math.min(cssW / pg.w, 120 / pg.h);
      var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      c.width = Math.round(pg.w * k * dpr); c.height = Math.round(pg.h * k * dpr); c.style.width = Math.round(pg.w * k) + 'px'; c.style.height = 'auto';
      var cx = c.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Render.drawPage(cx, pg, k, { color: d.color, size: d.size, paper: d.paper, transparent: false });
    } catch (e) { c.style.display = 'none'; }
  }
  function renderWizard() {
    var b = $('wizBody'), s = wiz.step, html = '';
    wiz.seen = Math.max(wiz.seen || 0, s);
    $('wizStep').textContent = t('wiz.helper') + ' · ' + t('wiz.step', { n: s + 1, m: WIZ_STEPS });
    $('wizNav').innerHTML = WIZ_NAMES.map(function (k, i) {
      return '<button type="button" data-wstep="' + i + '" class="' + (i === s ? 'cur' : i < s ? 'done' : '') + '"' + (i > wiz.seen ? ' disabled' : '') + '><span class="n">' + (i < s ? icon('check') : i + 1) + '</span>' + esc(t(k)) + '</button>';
    }).join('');
    if (s === 0) {
      var sug = I18N.browserLang();
      html += '<img class="wiz-hero" src="icon.svg" alt="" width="64" height="64"><h2>' + esc(t('wiz.welcomeTitle')) + '</h2><p>' + esc(t('wiz.welcomeText')) + '</p><p><b>' + esc(t('wiz.chooseLang')) + '</b></p><div class="langs">';
      Object.keys(I18N.LANGS).forEach(function (code) {
        html += '<button type="button" data-lang="' + code + '" class="' + (code === I18N.lang() ? 'sel' : '') + '">' + esc(I18N.LANGS[code]) +
          (sug && sug === code && code !== 'en' ? '<small>' + esc(t('wiz.suggested')) + '</small>' : '') + '</button>';
      });
      html += '</div><p class="small">' + esc(t('wiz.langHint')) + '</p>';
    } else if (s === 1) {
      html += '<h2>' + esc(t('wiz.howTitle')) + '</h2><div class="how">';
      [1, 2, 3].forEach(function (i) {
        html += '<div><span class="n">' + i + '</span><span><b>' + esc(t('wiz.how' + i + 'Title')) + '</b>' + esc(t('wiz.how' + i)) + '</span></div>';
      });
      html += '</div><div class="privacy">' + icon('lock') + '<span>' + esc(t('wiz.privacy')) + '</span></div>';
    } else if (s === 2) {
      html += '<h2>' + esc(t('wiz.stepYou')) + '</h2><label class="f" for="wizName">' + esc(t('wiz.name')) + '</label>' +
        '<input type="text" id="wizName" maxlength="60" value="' + esc(wiz.name || '') + '" placeholder="' + esc(t('wiz.namePh')) + '">' +
        '<p><b>' + esc(t('wiz.scriptsTitle')) + '</b><br>' + esc(t('wiz.scriptsText')) + '</p><div class="scripts">';
      Charsets.LANG_ORDER.forEach(function (code) {
        html += '<label><input type="checkbox" data-script="' + code + '"' + (wiz.scripts.indexOf(code) >= 0 ? ' checked' : '') + '> ' + esc(I18N.LANGS[code]) +
          ' <small>' + esc(chars(Charsets.LANG[code]).slice(0, 8).join(' ')) + (chars(Charsets.LANG[code]).length > 8 ? ' …' : '') + '</small></label>';
      });
      html += '</div>';
    } else if (s === 3) {
      html += '<div class="wiz-ic">' + icon('pen') + '</div><h2>' + esc(t('wiz.docsTitle')) + '</h2><p>' + esc(t('wiz.docsText')) + '</p>' +
        docFields(wiz.docs, 'data-doc') + '<div class="wiz-preview"><canvas id="wizPreview"></canvas></div>' +
        '<label class="check"><input type="checkbox" id="wizReal"' + (wiz.real ? ' checked' : '') + '> ' + esc(t('set.realismOn')) + '</label>' +
        '<p class="small check-hint">' + esc(t('set.realismHint')) + '</p>' +
        '<label class="check"><input type="checkbox" id="wizFallback"' + (wiz.fallback ? ' checked' : '') + '> ' + esc(t('set.fallbackOn')) + '</label>' +
        '<p class="small check-hint">' + esc(t('set.fallbackHint')) + '</p>';
    } else if (s === 4) {
      html += '<h2>' + esc(t('wiz.practiceTitle')) + '</h2><p><b>' + esc(t('wiz.setupCount')) + '</b></p><div class="counts">';
      [[3, 'wiz.countQuick'], [5, 'wiz.countGood'], [10, 'wiz.countBest']].forEach(function (cc) {
        html += '<label><input type="radio" name="wizCount" value="' + cc[0] + '"' + (wiz.target === cc[0] ? ' checked' : '') + '> ' + esc(t(cc[1])) + '</label>';
      });
      html += '</div><label class="check" style="margin-top:14px"><input type="checkbox" id="wizTemplate"' + (wiz.template ? ' checked' : '') + '> ' + esc(t('wiz.setupTemplate')) + '</label>' +
        '<p class="small check-hint">' + esc(t('wiz.setupTemplateHint')) + '</p>';
    } else {
      html += '<h2>' + esc(t('wiz.tipsTitle')) + '</h2><ul class="tips">';
      [1, 2, 3, 4].forEach(function (i) { html += '<li>' + esc(t('wiz.tip' + i)) + '</li>'; });
      html += '</ul><div class="wiz-tip">' + icon('chat') + '<span>' + esc(t('wiz.claudeTip')) + '</span></div>';
    }
    b.innerHTML = html;
    // step change: slide in from the side we are going to
    b.classList.remove('step-next', 'step-prev'); void b.offsetWidth; if (wiz.dir) b.classList.add(wiz.dir < 0 ? 'step-prev' : 'step-next');
    $('wizPrev').style.visibility = s > 0 ? 'visible' : 'hidden';
    $('wizNext').textContent = s < WIZ_STEPS - 1 ? t('wiz.next') : t('wiz.start');
    if (s === 3) setTimeout(drawDocPreview, 0);
  }
  function wizGo(step) { wiz.dir = step < wiz.step ? -1 : 1; wiz.step = step; renderWizard(); }
  $('wizBody').addEventListener('click', function (e) {
    var lb = e.target.closest('[data-lang]');
    if (lb) { setLanguage(lb.getAttribute('data-lang')); if (!Array.isArray(state.settings.scripts)) wiz.scripts = [I18N.lang()]; wiz.dir = 0; renderWizard(); }
  });
  $('wizNav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-wstep]'); if (!b || b.disabled) return;
    wizGo(parseInt(b.getAttribute('data-wstep'), 10) || 0);
  });
  $('wizBody').addEventListener('input', function (e) {
    if (e.target.id === 'wizName') wiz.name = e.target.value;
    if (e.target.getAttribute('data-doc') === 'variation') { wiz.docs.variation = parseFloat(e.target.value) || 0; showVar(e.target); drawDocPreview(); }
  });
  $('wizBody').addEventListener('change', function (e) {
    var sc = e.target.getAttribute('data-script');
    if (sc) { wiz.scripts = wiz.scripts.filter(function (x) { return x !== sc; }); if (e.target.checked) wiz.scripts.push(sc); }
    var dc = e.target.getAttribute('data-doc');
    if (dc) { wiz.docs[dc] = dc === 'size' || dc === 'variation' ? parseFloat(e.target.value) || 0 : e.target.value; drawDocPreview(); }
    if (e.target.name === 'wizCount') wiz.target = parseInt(e.target.value, 10) || 10;
    if (e.target.id === 'wizTemplate') wiz.template = e.target.checked;
    if (e.target.id === 'wizFallback') { wiz.fallback = e.target.checked; drawDocPreview(); }
    if (e.target.id === 'wizReal') { wiz.real = e.target.checked; drawDocPreview(); }
  });
  $('wizPrev').addEventListener('click', function () { if (wiz.step > 0) wizGo(wiz.step - 1); });
  $('wizNext').addEventListener('click', function () {
    if (wiz.step < WIZ_STEPS - 1) { wizGo(wiz.step + 1); return; }
    finishWizard(true); closeModal('mWizard');
  });
  /** Document defaults (paper, size, colour, page, alignment, irregularity): used by "Write text" and by Claude (exported file). */
  function setDocDefaults(d) {
    var c = state.settings.claude, w = state.settings.write;
    ['paper', 'size', 'color', 'page', 'align', 'variation'].forEach(function (k) { if (d[k] !== undefined && d[k] !== null) { c[k] = d[k]; w[k] = d[k]; } });
  }
  function finishWizard(apply) {
    if (state.meta.wizardDone && !apply) return;
    if (apply || !state.meta.wizardDone) {
      state.settings.scripts = Charsets.LANG_ORDER.filter(function (c) { return wiz.scripts.indexOf(c) >= 0; });
      state.settings.target = wiz.target; state.settings.template = wiz.template;
      if (wiz.docs) setDocDefaults(wiz.docs);
      state.settings.fallbackFont = wiz.fallback; state.settings.realism = wiz.real;
      if (!state.settings.lang) state.settings.lang = I18N.lang();
      if (wiz.name && wiz.name.trim()) { var pr = profile(); if (pr) pr.name = wiz.name.trim().slice(0, 60); }
    }
    state.meta.wizardDone = true; state.meta.introSeen = true;
    saveNow(); renderAll();
  }

  /* ------------------------------ language ------------------------------ */
  function fillLangSelect(sel) {
    sel.innerHTML = Object.keys(I18N.LANGS).map(function (c) { return '<option value="' + c + '">' + esc(I18N.LANGS[c]) + '</option>'; }).join('');
    sel.value = I18N.lang();
  }
  function fillMenuLangs() {
    $('menuLangs').innerHTML = Object.keys(I18N.LANGS).map(function (c) {
      return '<button type="button" role="menuitemradio" aria-checked="' + (c === I18N.lang()) + '" data-mlang="' + c + '" class="' + (c === I18N.lang() ? 'on' : '') + '">' + esc(I18N.LANGS[c]) + '</button>';
    }).join('');
  }
  /* "Handwriting 2" in any language -> its number (default names follow the interface language) */
  function defaultNumber(name) {
    var hit = null;
    Object.keys(I18N.TABLES).some(function (c) {
      var pat = String(I18N.TABLES[c]['prof.default'] || '').replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('{n}', '(\\d+)');
      var m = pat && new RegExp('^' + pat + '$').exec(name || '');
      if (m) { hit = m[1]; return true; }
      return false;
    });
    return hit;
  }
  function setLanguage(code) {
    I18N.setLang(code); state.settings.lang = I18N.lang();
    profiles.list.forEach(function (p) { var n = defaultNumber(p.name); if (n) p.name = t('prof.default', { n: n }); });
    if (wiz.name && defaultNumber(wiz.name)) wiz.name = t('prof.default', { n: defaultNumber(wiz.name) });
    lsSet(LANG_KEY, I18N.lang());
    document.title = t('app.title');
    I18N.apply(); fillMenuLangs(); renderProfileName();
    fontMetrics = null;
    renderAll(); scheduleSave();
    if ($('mWrite').classList.contains('show')) renderWrite();
  }
  // ---- header menus (☰ and handwriting switcher)
  function closeMenus() { ['moreMenu', 'profMenu'].forEach(function (id) { $(id).hidden = true; }); $('btnMore').setAttribute('aria-expanded', 'false'); $('profBtn').setAttribute('aria-expanded', 'false'); }
  function toggleMenu(id, btn) {
    var open = $(id).hidden; closeMenus();
    if (!open) return;
    if (id === 'profMenu') renderProfMenu(); else fillMenuLangs();
    var r = btn.getBoundingClientRect(), m = $(id);
    m.hidden = false;
    var w = m.offsetWidth;
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, id === 'profMenu' ? r.left : r.right - w))) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    var first = m.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  $('btnMore').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu('moreMenu', this); });
  $('profBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu('profMenu', this); });
  function menuAction(e) {
    var b = e.target.closest('button'); if (!b) return;
    var act = b.getAttribute('data-act'), lang = b.getAttribute('data-mlang'), prof = b.getAttribute('data-prof');
    if (lang) { setLanguage(lang); fillMenuLangs(); return; }
    closeMenus();
    if (prof) { switchProfile(prof); return; }
    if (b.hasAttribute('data-prof-new')) { createProfile(''); return; }
    if (act === 'import') $('fileInput').click();
    else if (act === 'settings') openSettings();
    else if (act === 'setup') openWizard(0);
    else if (act === 'help') openModal('mHelp');
    else if (act === 'install') openInstall();
  }
  $('moreMenu').addEventListener('click', menuAction);
  $('profMenu').addEventListener('click', menuAction);
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeMenus(); });
  // only a real width change closes menus (phones fire resize when the address bar slides in/out)
  var menuW = window.innerWidth;
  window.addEventListener('resize', function () { if (Math.abs(window.innerWidth - menuW) > 30) { menuW = window.innerWidth; closeMenus(); } });

  /* ------------------------------ export / import ------------------------------ */
  function buildExport() { return exportOf(state, profileName()); }
  function exportOf(st, name) {
    var keep = state; state = st;
    try { return exportData(name); } finally { state = keep; }
  }
  /* ---------------- install as app ---------------- */
  var installPrompt = null;   // Chrome/Edge/Android offer their own install dialog
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; showInstall(); });
  window.addEventListener('appinstalled', function () { installPrompt = null; showInstall(); toast(t('inst.installed')); });
  function deviceKind() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    return /Android/i.test(ua) ? 'android' : 'desktop';
  }
  function isInstalled() {
    try { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  }
  function showInstall() {
    var dev = deviceKind(), inst = isInstalled(), file = location.protocol === 'file:';
    $('instDone').hidden = !inst; $('instFile').hidden = inst || !file;
    $('instNowRow').hidden = !installPrompt || inst;
    $('mInstall').querySelectorAll('[data-dev]').forEach(function (el) { el.classList.toggle('mine', el.getAttribute('data-dev') === dev); });
  }
  function openInstall() { showInstall(); openModal('mInstall'); }
  $('instNow').addEventListener('click', function () {
    if (!installPrompt) return;
    var p = installPrompt; installPrompt = null;
    p.prompt();
    if (p.userChoice) p.userChoice.then(showInstall, showInstall); else showInstall();
  });

  function exportData(name) {
    return {
      format: FORMAT, version: FORMAT_VERSION, app: 'my-handwriting ' + APP_VERSION, name: name,
      exported: new Date().toISOString(),
      metrics: { scale: SCALE, unit: 'cap-height', cap: M.cap, xheight: M.xheight, baseline: M.baseline,
                 descender: M.descender, boxTop: M.boxTop, boxBottom: M.boxBottom, boxWidth: M.boxWidth, penWidth: PEN },
      settings: { target: target(), custom: state.settings.custom || '', scripts: scripts(), lang: I18N.lang(),
                  claude: Object.assign({}, state.settings.claude, { lang: I18N.lang(), fallback: state.settings.fallbackFont === false ? 'box' : 'font', realism: state.settings.realism !== false }) },
      glyphs: state.glyphs
    };
  }
  /** File-name part from a handwriting name ("" for the default names). */
  function slug(name) {
    var s = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    return s ? s + '-' : '';
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
    var name = 'my-handwriting-glyphs-' + (defaultNumber(profileName()) ? '' : slug(profileName())) + stamp() + '.json';
    var started = download(name, lastExportText, 'application/json');
    state.meta.lastExport = Date.now(); state.meta.samplesAtExport = tt.allSamples;
    scheduleSave(); renderProgress();
    $('exportInfo').innerHTML = (started ? t('export.started', { name: esc(name) }) : esc(t('export.failed'))) +
      '<br>' + esc(t('export.stats', { n: tt.allSamples, c: Object.keys(state.glyphs).length, kb: Math.round(lastExportText.length / 1024) }));
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
    // "Replace" can be undone until the page is closed (like deleting all samples)
    var before = replace && totals().allSamples ? JSON.stringify(state.glyphs) : null;
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
      if (PAPERS.indexOf(cl.paper) >= 0) cur.paper = cl.paper;
      if (SIZES.indexOf(Number(cl.size)) >= 0) cur.size = Number(cl.size);
      if (COLORS.indexOf(cl.color) >= 0) cur.color = cl.color;
      if (PAGES.indexOf(cl.page) >= 0) cur.page = cl.page;
      if (ALIGNS.indexOf(cl.align) >= 0) cur.align = cl.align;
      if (typeof cl.variation === 'number' && cl.variation >= 0 && cl.variation <= 2) cur.variation = cl.variation;
      if (cl.fallback === 'box' || cl.fallback === 'font') state.settings.fallbackFont = cl.fallback === 'font';
      if (typeof cl.realism === 'boolean') state.settings.realism = cl.realism;
    }
    if (Array.isArray(ps.scripts)) {
      var sc = scripts().slice(); ps.scripts.forEach(function (c) { if (Charsets.LANG[c] && sc.indexOf(c) < 0) sc.push(c); });
      state.settings.scripts = Charsets.LANG_ORDER.filter(function (c) { return sc.indexOf(c) >= 0; });
    }
    // characters from the file that are in no group become own characters
    var known = {}; groups().forEach(function (g) { g.chars.forEach(function (c) { known[c] = 1; }); });
    Charsets.LANG_ORDER.forEach(function (code) { chars(Charsets.LANG[code]).forEach(function (c) { known[c] = 1; }); });
    Object.keys(state.glyphs).forEach(function (k) { if (!known[k] && chars(k).length === 1 && chars(state.settings.custom).indexOf(k) < 0) state.settings.custom += k; });
    pendingImport = null; closeModal('mImport');
    saveNow(); renderAll();
    if (before) toast(t('toast.replaced'), t('toast.undo'), function () { state.glyphs = JSON.parse(before); saveNow(); renderAll(); });
    else toast(t('toast.imported', { n: added }));
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
    $('wVar').value = String(w.variation); showVar($('wVar')); $('wTransparent').checked = !!w.transparent;
    $('wMarkdown').checked = !!w.markdown; $('wFallback').checked = state.settings.fallbackFont !== false; $('wRealism').checked = state.settings.realism !== false;
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
    state.settings.fallbackFont = $('wFallback').checked; state.settings.realism = $('wRealism').checked;
    return w;
  }
  function buildWrite() {
    var w = readWriteForm();
    var text = $('wText').value || ' ';
    lastBuild = Render.buildPages(text, glyphSet, {
      page: w.page, size: w.size, paper: w.paper, align: w.align, variation: w.variation, seed: writeSeed,
      lineSpacing: w.paper === 'lined' ? Math.max(6, w.size * 1.9) : null, markdown: !!w.markdown,
      font: window.FallbackFont || null, fallbackFont: state.settings.fallbackFont !== false, realism: state.settings.realism !== false,
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
  ['wText', 'wSize', 'wPaper', 'wPage', 'wColor', 'wAlign', 'wVar', 'wTransparent', 'wMarkdown', 'wFallback', 'wRealism'].forEach(function (id) {
    $(id).addEventListener(id === 'wText' || id === 'wVar' ? 'input' : 'change', id === 'wVar' ? function () { showVar(this); scheduleWrite(); } : scheduleWrite);
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
    $('setPadSize').value = String(padScale); showPadSize();
    $('setPadLine').value = String(padLine); showPadLine();
    renderProfiles();
    var c = state.settings.claude;
    $('setClaudePaper').innerHTML = options(PAPERS, function (v) { return t('paper.' + v); }, c.paper);
    $('setClaudeSize').innerHTML = options(SIZES, sizeLabel, c.size);
    $('setClaudeColor').innerHTML = options(COLORS, function (v) { return t('color.' + v); }, c.color);
    $('setClaudePage').innerHTML = options(PAGES, function (v) { return t('page.' + v); }, c.page);
    $('setClaudeAlign').innerHTML = options(ALIGNS, function (v) { return t('align.' + v); }, c.align || 'left');
    $('setClaudeVar').value = String(docVar(c)); showVar($('setClaudeVar'));
    $('setFallback').checked = state.settings.fallbackFont !== false; $('setRealism').checked = state.settings.realism !== false;
    $('setScripts').innerHTML = Charsets.LANG_ORDER.map(function (code) {
      return '<label><input type="checkbox" data-script="' + code + '"' + (scripts().indexOf(code) >= 0 ? ' checked' : '') + '> ' + esc(I18N.LANGS[code]) +
        ' <small>' + esc(chars(Charsets.LANG[code]).slice(0, 5).join(' ')) + '</small></label>';
    }).join('');
    var size = 0; try { size = JSON.stringify(state).length; } catch (e) {}
    var where = storageMode === 'idb' ? t('set.storeIdb') : storageMode === 'local' ? t('set.storeLocal') : t('set.storeNone');
    $('storageInfo').textContent = where + ' · ' + t('set.size', { kb: Math.round(size / 1024) }) + ' · ' +
      (state.meta.lastExport ? t('set.lastExport', { d: new Date(state.meta.lastExport).toLocaleString(I18N.lang()) }) : t('set.never'));
    wipeArmed = false; $('btnWipe').textContent = t('set.wipe'); $('btnWipe').disabled = !totals().allSamples;
    resetArmed = false; $('btnReset').textContent = t('set.reset');
    openModal('mSettings');
  }
  $('setClaudeVar').addEventListener('input', function () { showVar(this); });
  function showPadSize() { $('setPadSizeVal').textContent = $('setPadSize').value + ' %'; }
  $('setPadSize').addEventListener('input', function () {
    showPadSize();
    // live: the writing area behind the dialog changes at once; kept only with Save
    padPreview = clamp(parseInt(this.value, 10) || 100, PAD_MIN, PAD_MAX); resizePad(true);
  });
  function showPadLine() { $('setPadLineVal').textContent = $('setPadLine').value + ' %'; }
  $('setPadLine').addEventListener('input', function () {
    showPadLine();
    padLinePreview = clamp(parseInt(this.value, 10) || 100, LINE_MIN, LINE_MAX); redrawPad();   // live, kept only with Save
  });
  function showAlpha() { $('setAlphaVal').textContent = Math.round(parseFloat($('setAlpha').value) * 100) + ' %'; }
  $('setAlpha').addEventListener('input', function () {
    showAlpha();
    // live preview on the writing area behind the dialog
    var keep = state.settings.templateAlpha; state.settings.templateAlpha = parseFloat(this.value); redrawPad(); state.settings.templateAlpha = keep;
  });
  $('btnSettingsSave').addEventListener('click', function () {
    state.settings.target = clamp(parseInt($('setTarget').value, 10) || 10, 1, 50);
    state.settings.mode = $('setMode').value === 'round' ? 'round' : 'char';
    state.settings.penOnly = ['auto', 'on', 'off'].indexOf($('setPen').value) >= 0 ? $('setPen').value : 'auto';
    state.settings.custom = nfc($('setCustom').value || '');
    state.settings.template = $('setTemplate').checked;
    state.settings.templateAlpha = clamp(parseFloat($('setAlpha').value) || 0.15, 0.03, 0.6);
    setPadScale(parseInt($('setPadSize').value, 10) || 100);
    padLine = clamp(Math.round((parseInt($('setPadLine').value, 10) || 100) / 25) * 25, LINE_MIN, LINE_MAX); padLinePreview = null;
    try { if (padLine === 100) localStorage.removeItem(LINE_KEY); else localStorage.setItem(LINE_KEY, String(padLine)); } catch (e) {}
    redrawPad();
    var sc = [];
    $('setScripts').querySelectorAll('[data-script]').forEach(function (cb) { if (cb.checked) sc.push(cb.getAttribute('data-script')); });
    state.settings.scripts = sc;
    state.settings.fallbackFont = $('setFallback').checked; state.settings.realism = $('setRealism').checked;
    setDocDefaults({ paper: $('setClaudePaper').value, size: parseFloat($('setClaudeSize').value) || 6, color: $('setClaudeColor').value, page: $('setClaudePage').value,
                     align: $('setClaudeAlign').value || 'left', variation: clamp(parseFloat($('setClaudeVar').value) || 0, 0, 2) });
    state.meta.claudeSet = true;
    var lang = $('setLang').value;
    closeModal('mSettings');
    if (lang !== I18N.lang()) setLanguage(lang); else { scheduleSave(); renderAll(); }
  });
  var wipeArmed = false, wipeTimer = null;
  $('btnWipe').addEventListener('click', function () {
    if (!wipeArmed) {
      wipeArmed = true; this.textContent = t('set.wipeConfirm');
      clearTimeout(wipeTimer); var self = this;
      wipeTimer = setTimeout(function () { wipeArmed = false; self.textContent = t('set.wipe'); }, 5000);
      return;
    }
    // Keep a last copy for "undo" until the page is closed.
    var backup = JSON.stringify(state.glyphs), backupCustom = state.settings.custom;
    var keep = state.settings, keepMeta = state.meta; state = defaultState(); state.settings = keep;
    state.settings.custom = '';
    state.meta.introSeen = true; state.meta.wizardDone = keepMeta.wizardDone;
    current = null; drawing = []; history = []; closeModal('mSettings'); saveNow(); renderAll();
    toast(t('toast.wiped'), t('toast.undo'), function () { state.glyphs = JSON.parse(backup); state.settings.custom = backupCustom; saveNow(); renderAll(); });
  });

  var resetArmed = false, resetTimer = null;
  $('btnReset').addEventListener('click', function () {
    if (!resetArmed) {
      resetArmed = true; this.textContent = t('set.resetConfirm');
      clearTimeout(resetTimer); var self = this;
      resetTimer = setTimeout(function () { resetArmed = false; self.textContent = t('set.reset'); }, 5000);
      return;
    }
    resetArmed = false; clearTimeout(resetTimer);
    resetAll();
  });

  /* ------------------------------ Claude: skill ZIP + messages ------------------------------ */
  var bundlePromise = null;
  function loadBundle() {
    if (window.SkillBundle) return Promise.resolve(window.SkillBundle);
    if (!bundlePromise) bundlePromise = new Promise(function (resolve, reject) {
      var sc = document.createElement('script'); sc.src = 'js/skill-bundle.js';
      sc.onload = function () { window.SkillBundle ? resolve(window.SkillBundle) : reject(new Error('bundle')); };
      sc.onerror = function () { bundlePromise = null; reject(new Error('bundle')); };
      document.head.appendChild(sc);
    });
    return bundlePromise;
  }
  function openClaude() {
    var n = totals().allSamples, others = profiles.list.length - 1;
    $('clEmpty').style.display = n ? 'none' : '';
    $('clAllRow').style.display = others > 0 ? '' : 'none';
    $('clAllText').textContent = t('cl.all', { n: profiles.list.length });
    $('clStatus').textContent = ''; $('clText').style.display = 'none';
    $('clZip').disabled = !n;
    renderClWhich();
    openModal('mClaude');
    loadBundle().catch(function () {});
  }
  /** The skill as ZIP: program + standard handwriting + the active handwriting as data/glyphs.json
      (+ the others as data/glyphs-<name>.json if wanted). */
  function buildSkillZip(all) {
    return loadBundle().then(function (B) {
      saveNow();
      var files = Object.keys(B.files).map(function (k) { return { name: 'my-handwriting/' + k, data: B.files[k] }; });
      files.push({ name: 'my-handwriting/data/glyphs.json', data: JSON.stringify(buildExport()) });
      if (!all) return files;
      var used = {};
      return Promise.all(profiles.list.filter(function (p) { return p.id !== profiles.active; }).map(function (p) {
        return readState(p.id).then(function (st) {
          if (!st || !Object.keys(st.glyphs).length) return;
          var base = slug(p.name).replace(/-$/, '') || p.id, nm = base, k = 2;
          while (used[nm]) nm = base + '-' + k++;
          used[nm] = 1;
          files.push({ name: 'my-handwriting/data/glyphs-' + nm + '.json', data: JSON.stringify(exportOf(st, p.name)) });
        });
      })).then(function () { return files; });
    }).then(function (files) { return Zip.build(files); });
  }
  /** Which handwriting goes into the ZIP. */
  function renderClWhich() {
    var all = $('clAll').checked && profiles.list.length > 1;
    $('clWhich').innerHTML = icon('person', 'sm') + '<span>' + esc(all ? t('cl.whichAll', { n: profiles.list.length, name: profileName() }) : t('cl.which', { name: profileName() })) +
      (profiles.list.length > 1 && !all ? ' ' + esc(t('cl.whichHint')) : '') + '</span>';
  }
  $('clAll').addEventListener('change', renderClWhich);
  $('clZip').addEventListener('click', function () {
    if (!totals().allSamples) { toast(t('cl.noSamples')); return; }
    var b = this; b.disabled = true;
    $('clStatus').textContent = t('cl.loading');
    buildSkillZip($('clAll').checked && profiles.list.length > 1).then(function (bytes) {
      var name = 'my-handwriting-skill.zip';
      var ok = download(name, new Blob([bytes], { type: 'application/zip' }));
      $('clStatus').textContent = ok ? t('cl.zipDone', { name: name }) : t('export.failed');
    }).catch(function () { $('clStatus').textContent = t('export.failed'); })
      .then(function () { b.disabled = false; });
  });
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg); };
    var fallback = function () {
      var ta = $('clText'); ta.value = text; ta.style.display = 'block'; ta.focus(); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      if (ok) done(); else toast(t('toast.copyBlocked'));
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  var lastCopied = '';
  $('clCopy').addEventListener('click', function () { lastCopied = t('cl.example'); copyText(lastCopied, t('cl.copied')); });
  $('btnClaude').addEventListener('click', openClaude);

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
  $('helpRestart').addEventListener('click', function () { closeModal('mHelp'); openWizard(0); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (!$('moreMenu').hidden || !$('profMenu').hidden)) { closeMenus(); return; }
    if (modalOpen()) {
      if (e.key === 'Escape') { var m = document.querySelector('.modal-bg.show'); if (m && !(m.id === 'mWizard' && wizardLocked())) closeModal(m.id); }
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

  /* ------------------------------ only one tab at a time ------------------------------ */
  /* Two open tabs would overwrite each other's samples. A new tab announces itself (localStorage
     'storage' event); the older tab saves at once, says "flushed" and pauses until "Use here"
     (= reload). The new tab adds samples that arrived with the flush (merge by id, nothing is lost). */
  var TAB_KEY = 'my-handwriting-tab', tabId = uid(), paused = false, startedAt = Date.now();
  function tabSay(kind) { lsSet(TAB_KEY, JSON.stringify({ id: tabId, k: kind, t: Date.now() })); }
  window.addEventListener('storage', function (e) {
    if (e.key !== TAB_KEY || !e.newValue) return;
    var m; try { m = JSON.parse(e.newValue); } catch (_) { return; }
    if (!m || m.id === tabId || paused) return;
    if (m.k === 'open') {
      var flush = (saveTimer || document.documentElement.hasAttribute('data-started')) ? saveNow() : Promise.resolve();
      flush.then(function () {
        paused = true; closeMenus();
        $('tabLock').hidden = false;
        tabSay('flushed');
      });
    } else if (m.k === 'flushed' && Date.now() - startedAt < 15000) mergeStored();
  });
  function mergeStored() {
    readState(profiles.active).then(function (st) {
      if (!st || paused) return;
      var added = 0;
      Object.keys(st.glyphs).forEach(function (k) {
        var have = {}; (state.glyphs[k] || []).forEach(function (s) { have[s.id] = 1; });
        st.glyphs[k].forEach(function (s) { if (!have[s.id]) { (state.glyphs[k] = state.glyphs[k] || []).push(s); added++; } });
      });
      if (added) { renderAll(); scheduleSave(); }
    });
  }
  $('tabUse').addEventListener('click', function () { location.reload(); });

  /* ------------------------------ start ------------------------------ */
  // Read-only access for automated tests / Claude
  window.MyHandwriting = {
    exportData: buildExport, state: function () { return state; }, current: function () { return current; }, version: APP_VERSION,
    groups: groups, setCurrent: setCurrent, openWrite: openWrite, lastBuild: function () { return lastBuild; },
    addCustom: addCustom, penSeen: function () { return penSeen; }, strokes: function () { return drawing.length; },
    profiles: function () { return profiles; }, switchProfile: switchProfile, createProfile: createProfile,
    deleteProfile: deleteProfile, renameProfile: renameProfile, resetAll: resetAll, buildSkillZip: buildSkillZip,
    saveNow: saveNow, lastCopied: function () { return lastCopied; }
  };

  I18N.setLang('en');                 // English is the default; the wizard asks first
  tabSay('open');
  loadState().catch(function () {}).then(function () {
    I18N.setLang(lsGet(LANG_KEY) || state.settings.lang || 'en');
    profiles.list.forEach(function (p) { var n = defaultNumber(p.name); if (n) p.name = t('prof.default', { n: n }); });
    document.title = t('app.title');
    I18N.apply(); fillMenuLangs(); renderProfileName();
    $('helpVersion').textContent = 'Version ' + APP_VERSION;
    current = state.meta.current && order().indexOf(state.meta.current) >= 0 ? state.meta.current : null;
    resizePad(true); renderAll();
    document.documentElement.setAttribute('data-started', '1');
    if (!state.meta.wizardDone) openWizard(0);
    return saveNow();
  });
})();
