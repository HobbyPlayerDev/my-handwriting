/* my-handwriting - translation core.
 * Each language lives in js/lang/<code>.js and registers itself with I18N.add(code, name, table).
 * English (js/lang/en.js) is the reference: every other language must have every English key
 * (checked by tests/i18n_test.js). {name} placeholders are filled by I18N.t(key, {name: value}).
 * Keys ending in "Html" contain trusted markup written by the project (never user input).
 */
(function () {
  'use strict';

  var LANGS = {};          // code -> native name, in the order the files are loaded (en first)
  var T = {};              // code -> table
  var current = 'en';

  function add(code, name, table) { LANGS[code] = name; T[code] = table; }

  /** Browser language if we have it, else null (English is the default). */
  function browserLang() {
    var list = [];
    try { list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en']; } catch (e) { list = ['en']; }
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || '').toLowerCase().slice(0, 2);
      if (T[code]) return code;
    }
    return null;
  }

  function t(key, vars) {
    var s = (T[current] && T[current][key]);
    if (s === undefined && T.en) s = T.en[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
    return s;
  }
  function has(key) { return !!(T[current] && T[current][key] !== undefined) || !!(T.en && T.en[key] !== undefined); }

  function setLang(code) {
    current = T[code] ? code : 'en';
    try { document.documentElement.lang = current; } catch (e) {}
    return current;
  }

  /* Static texts in the HTML: data-i18n (text), data-i18n-html (trusted markup),
     data-i18n-title, data-i18n-ph (placeholder), data-i18n-aria (aria-label). */
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  }

  var api = { LANGS: LANGS, TABLES: T, add: add, t: t, has: has, setLang: setLang, browserLang: browserLang, apply: apply,
              lang: function () { return current; } };
  if (typeof window !== 'undefined') window.I18N = api;
  if (typeof globalThis !== 'undefined') globalThis.I18N = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
