// Checks the translations: every language has every English key, the same {placeholders}, no markup
// outside *Html keys, every key used in index.html / js/app.js exists, and the language list matches
// the writing languages in js/charsets.js.      Run: node tests/i18n_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const I18N = require(path.join(root, 'js', 'i18n.js'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
// load the language files in the order index.html loads them
const langFiles = [...html.matchAll(/<script src="js\/lang\/(\w+)\.js"><\/script>/g)].map(m => m[1]);
for (const code of langFiles) require(path.join(root, 'js', 'lang', code + '.js'));
const Charsets = require(path.join(root, 'js', 'charsets.js'));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } }

const en = I18N.TABLES.en;
const keys = Object.keys(en);
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
ok(langFiles[0] === 'en', 'English is loaded first (default language)');
ok(JSON.stringify(langFiles.slice().sort()) === JSON.stringify(Charsets.LANG_ORDER.slice().sort()), 'UI languages = writing languages: ' + langFiles);
ok(fs.readdirSync(path.join(root, 'js', 'lang')).length === langFiles.length, 'every file in js/lang is loaded by index.html');
ok(!I18N.TABLES.tr && !Charsets.LANG.tr, 'Turkish removed');
for (const code of Object.keys(I18N.LANGS)) {
  const tb = I18N.TABLES[code];
  for (const k of keys) {
    ok(typeof tb[k] === 'string' && tb[k].trim() !== '', code + ': missing ' + k);
    if (typeof tb[k] === 'string') ok(ph(tb[k]) === ph(en[k]), code + ': placeholders differ in ' + k + ' (' + ph(tb[k]) + ' vs ' + ph(en[k]) + ')');
  }
  for (const k of Object.keys(tb)) ok(k in en, code + ': unknown key ' + k);
  for (const k of Object.keys(tb)) if (!/Html$/.test(k) && !/^export\.started$|^import\.found$/.test(k)) ok(!/<[a-z]/i.test(tb[k]), code + ': markup in ' + k);
  ok(tb['app.title'] === 'My Handwriting', code + ': brand name is not translated');
}

const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-html|-title|-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
for (const m of app.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
for (const k of used) if (!/\.$/.test(k) && !/^wiz\.(how|tip)$/.test(k)) ok(k in en, 'used but not defined: ' + k);
// dynamic keys built in app.js
for (const g of ['upper', 'lower', 'digits', 'punct', 'math', 'special', 'custom']) { ok(('group.' + g) in en, 'group.' + g); ok(('hint.' + g) in en, 'hint.' + g); }
for (const i of [1, 2, 3]) { ok(('wiz.how' + i) in en, 'wiz.how' + i); ok(('wiz.how' + i + 'Title') in en, 'wiz.how' + i + 'Title'); }
for (const i of [1, 2, 3, 4]) ok(('wiz.tip' + i) in en, 'wiz.tip' + i);
for (const v of ['blank', 'lined', 'grid']) ok(('paper.' + v) in en, 'paper.' + v);
for (const v of ['blue', 'royal', 'black', 'pencil', 'red', 'green']) ok(('color.' + v) in en, 'color.' + v);
for (const v of ['a4', 'a5', 'letter', 'auto']) ok(('page.' + v) in en, 'page.' + v);

// t() with placeholders, English default and fallback
I18N.setLang('de'); ok(I18N.t('progress', { pct: 5, done: 1, chars: 2, n: 3 }).indexOf('5 %') === 0, 'de placeholder');
I18N.setLang('xx'); ok(I18N.lang() === 'en', 'unknown language falls back to English');
I18N.setLang('pl'); ok(I18N.t('no.such.key') === 'no.such.key', 'unknown key shows the key');

console.log((fails ? 'FAILED ' + fails : 'OK') + ' - ' + checks + ' checks, ' + Object.keys(I18N.LANGS).length + ' languages, ' + keys.length + ' keys, ' + used.size + ' used keys');
process.exit(fails ? 1 : 0);
