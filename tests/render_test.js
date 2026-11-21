// Tests the browser typesetter (js/render.js) in node with a synthetic sample file.
//   python tests/make_fixture.py out/fx.json && node tests/render_test.js out/fx.json
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const root = path.join(__dirname, '..');
const R = require(path.join(root, 'js', 'render.js'));
const FONT = require(path.join(root, 'js', 'fallback-font.js'));
const C = require(path.join(root, 'js', 'charsets.js'));
const I18N = require(path.join(root, 'js', 'i18n.js'));
for (const f of fs.readdirSync(path.join(root, 'js', 'lang'))) require(path.join(root, 'js', 'lang', f));
const file = process.argv[2] || path.join(root, 'out', 'fx.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } }
const plan = (gs, ch, o) => new R.Typesetter(gs, R.makeRng(1), Object.assign({ font: FONT }, o || {})).plan(ch);
const has = (p, kind) => Array.isArray(p) && (p[0] === kind || p.slice(1).some(x => Array.isArray(x) && (has(x, kind) || x.some(y => has(y, kind)))));

const gs = new R.GlyphSet(data.glyphs, data.metrics.scale);
ok(gs.total() > 100, 'samples loaded');

// 0a. "fit to text": a short page after [[pagebreak]] stays short
{
  const r = R.buildPages('one\ntwo\nthree\nfour\n[[pagebreak]]\nfive', gs, { page: 'auto', markdown: true, seed: 1, font: FONT });
  ok(r.pages.length === 2 && r.pages[1].h < r.pages[0].h * 0.6, 'fit to text: every page as high as its own lines (' + r.pages.map(p => p.h.toFixed(1)).join(' / ') + ')');
}
// 0. kerning: a straight stem keeps only its end points (simplify) - the next letter must not slide into it
{
  const bowl = (y0, y1, w) => { const p = []; for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + Math.PI * i / 24; p.push(Math.round(100 + w * Math.cos(a)), Math.round((y0 + y1) / 2 + (y1 - y0) / 2 * Math.sin(a))); } return p; };
  const B = { strokes: [[100, 0, 100, 1000], bowl(1000, 520, 380), bowl(520, 0, 450)] };
  const pg = R.buildPages('BB', new R.GlyphSet({ B: [B, B, B] }, 1000), { variation: 0, seed: 1, page: 'auto', size: 5 }).pages[0];
  const right = Math.max(...pg.ink.slice(0, 3).flat().map(p => p[0])), stem = Math.min(...pg.ink[3].map(p => p[0]));
  ok(stem - right > 0.6, 'kerning: no overlap with a straight stem (BB): gap ' + (stem - right).toFixed(2) + ' mm');
}
const ALL = C.BASE.map(b => b.chars).join('') + C.LANG_ORDER.map(c => C.LANG[c]).join('');

// 1. every character of every group is in the fixture and is written from the own samples
for (const ch of new Set(ALL)) ok(gs.has(ch), 'fixture has ' + ch);
const own = R.buildPages(ALL, gs, { font: FONT, seed: 1 });
ok(own.missing.length === 0 && own.font.length === 0, 'all characters from own samples: missing ' + own.missing.join('') + ' font ' + own.font.join(''));

// 2. every language's special letters work with the standard handwriting only (no samples at all)
const empty = new R.GlyphSet({}, 1000);
for (const code of C.LANG_ORDER) {
  const r = R.buildPages(C.LANG[code], empty, { font: FONT, seed: 1 });
  ok(r.missing.length === 0 && r.pages[0].ink.length >= [...C.LANG[code]].length, code + ': letters without samples: ' + r.missing.join(''));
}
const allEmpty = R.buildPages(ALL, empty, { font: FONT, seed: 1 });
ok(allEmpty.missing.length === 0, 'no samples + standard handwriting: nothing missing (' + allEmpty.missing.join('') + ')');
const noFont = R.buildPages('Hallo', empty, { font: FONT, fallbackFont: false, seed: 1 });
ok(noFont.missing.length === 4 && noFont.pages[0].marks.length === 5, 'font switched off: red boxes');

// 3. every language's sample text and help example
for (const code of Object.keys(I18N.LANGS)) {
  const text = I18N.TABLES[code]['write.sample'];
  const res = R.buildPages(text, gs, { page: 'a4', size: 5, paper: 'lined', seed: 1, font: FONT });
  ok(res.missing.length === 0 && res.font.length === 0, code + ': sample text missing ' + res.missing.join(' '));
  ok(res.pages.length === 1 && res.pages[0].ink.length > 20, code + ': ink on page');
}

// 4. order: own samples first (also composed), then the standard handwriting, then approximations
const sub = {};
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-\'"') sub[ch] = data.glyphs[ch];
const gs2 = new R.GlyphSet(sub, 1000);
ok(plan(gs2, 'é')[0] === 'accent' && !has(plan(gs2, 'é'), 'f'), 'é = own e + accent');
ok(plan(gs2, 'ł')[0] === 'slash' && !has(plan(gs2, 'ł'), 'f'), 'ł = own l + slanted stroke');
ok(plan(gs2, '½')[0] === 'frac', '½ = own digits as fraction');
ok(plan(gs2, '¿')[0] === 'flip', '¿ = own ? turned');
ok(plan(gs2, '€')[0] === 'f', '€ from the standard handwriting, not "EUR"');
ok(JSON.stringify(plan(gs2, '€', { fallbackFont: false })) === JSON.stringify(['seq', [['g', 'E'], ['g', 'U'], ['g', 'R']]]), 'without font € = EUR');
ok(plan(gs2, 'ß')[0] === 'f', 'ß from the standard handwriting, not "ss"');
ok(plan(gs2, '„')[0] === 'seq', '„ = two own commas');
ok(plan(gs2, '£')[0] === 'f', '£ from the standard handwriting');
ok(plan(new R.GlyphSet({ l: data.glyphs.l }, 1000), 'é')[0] === 'f' || has(plan(new R.GlyphSet({ l: data.glyphs.l }, 1000), 'é'), 'f'), 'é without own e uses the font');
const onlyCaps = {}; for (const ch of 'ABCQ') onlyCaps[ch] = data.glyphs[ch];
ok(plan(new R.GlyphSet(onlyCaps, 1000), 'q')[0] === 'f', 'q: font letter beats a scaled capital');
ok(plan(new R.GlyphSet(onlyCaps, 1000), 'q', { fallbackFont: false })[0] === 't', 'q without font: scaled capital');
const fb = R.buildPages('¿Qué? Łódź ½ [[3/7]] „x“ ß Ω', gs2, { seed: 2, font: FONT });
ok(fb.missing.join('') === 'Ω', 'only Ω missing (no font has it), got: ' + fb.missing.join(' '));
ok(fb.pages[0].marks.length === 1, 'one red box');
ok(fb.font.join('') === 'ß', 'font characters reported: ' + fb.font.join(''));
ok(plan(gs2, '“')[0] === 'g', '“ = own straight quote (composed from own samples first)');

// 5. standard handwriting is fitted to the writer: size and slant
// (the fixture is made of horizontal hatch lines, so the slant test uses single straight strokes)
const slanted = {};
for (const ch of 'lIi1t') slanted[ch] = [0, 1, 2].map(i => ({ id: ch + i, strokes: [[100, 0, 100 + 200 + i * 10, 1000 + i * 50]] }));
const gs3 = new R.GlyphSet(slanted, 1000);
ok(Math.abs(gs3.slant - 0.2) < 0.05, 'slant measured: ' + gs3.slant.toFixed(3));
const big = {}; for (const ch of 'HEIXO') big[ch] = data.glyphs[ch].map(s => ({ id: s.id, strokes: s.strokes.map(st => st.map(v => Math.round(v * 1.3))) }));
ok(Math.abs(new R.GlyphSet(big, 1000).cap - 1.3) < 0.08, 'cap height measured');

// 6. Markdown blocks and page breaks
const md = '# Title\n\n- one\n  - nested\n1. first\n> quote\n---\nText **bold** and `code`\n[[pagebreak]]\nPage two';
const mres = R.buildPages(md, gs, { markdown: true, seed: 3, font: FONT });
ok(mres.pages.length === 2, 'page break makes 2 pages: ' + mres.pages.length);
ok(R.parseBlock('# Title', true).scale > 1.4 && R.parseBlock('# Title', true).underline, 'heading 1: bigger + underlined');
ok(R.parseBlock('## Sub', true).scale > 1.2 && !R.parseBlock('## Sub', true).underline, 'heading 2');
ok(R.parseBlock('- x', true).bullet === '-' && R.parseBlock('  - x', true).indent > R.parseBlock('- x', true).indent, 'lists + nesting');
ok(R.parseBlock('12. x', true).bullet === '12.', 'numbered list');
ok(R.parseBlock('---', true).rule && R.parseBlock('[[pagebreak]]', false).pagebreak, 'rule + page break');
ok(R.parseBlock('a **b** `c`', true).text === 'a b c', 'emphasis markers removed');
ok(R.parseBlock('# not a heading', false).text === '# not a heading', 'without Markdown nothing changes');
const plain = R.buildPages('# x', gs, { seed: 3 }), mdx = R.buildPages('# x', gs, { seed: 3, markdown: true });
ok(plain.pages[0].ink.length > mdx.pages[0].ink.length - 1, 'without Markdown "#" is written');

// 7. layout details: wrapping with hanging indent, reproducible seeds, pagination, sizes, alignment
const wrap = R.buildPages('- ' + 'word '.repeat(60), gs, { markdown: true, seed: 1 });
const lefts = []; wrap.pages[0].ink.forEach(st => lefts.push(st[0][0]));
ok(wrap.lines >= 3, 'long list item wraps: ' + wrap.lines + ' lines');
const a = R.buildPages('Hallo Welt', gs, { seed: 5 }), b = R.buildPages('Hallo Welt', gs, { seed: 5 }), c = R.buildPages('Hallo Welt', gs, { seed: 6 });
ok(JSON.stringify(a.pages) === JSON.stringify(b.pages), 'reproducible with seed');
ok(JSON.stringify(a.pages) !== JSON.stringify(c.pages), 'other seed differs');
const long = R.buildPages('Zeile\n'.repeat(80), gs, { page: 'a5', size: 6, seed: 1 });
ok(long.pages.length >= 3 && long.pages[0].w === 148, 'A5 pages: ' + long.pages.length);
ok(R.buildPages('x', gs, { page: 'letter' }).pages[0].w === 215.9, 'US Letter');
const auto = R.buildPages('Kurz', gs, { page: 'auto', width: 100, seed: 1 });
ok(auto.pages[0].w === 100 && auto.pages[0].h < 40, 'auto page small: ' + auto.pages[0].h.toFixed(1));
const autoBreak = R.buildPages('a\n[[pagebreak]]\nb', gs, { page: 'auto', width: 100, seed: 1 });
ok(autoBreak.pages.length === 2, 'page break with auto size');
const right = R.buildPages('Rechts', gs, { page: 'a4', align: 'right', seed: 1 });
const maxX = Math.max(...right.pages[0].ink.flat().map(p => p[0]));
ok(maxX > 180 && maxX < 191, 'right aligned ends near the margin: ' + maxX.toFixed(1));
ok(R.buildPages('Kariert', gs, { paper: 'grid', seed: 1 }).pages[0].rules.length > 90, 'grid lines');
ok(R.buildPages('', gs, {}).pages.length === 1, 'empty text = one empty page');

// 8. SVG
const svg = R.toSVG(a.pages[0], { color: 'red', size: 5 });
ok(svg.startsWith('<?xml') && svg.includes('#b3261e') && svg.trim().endsWith('</svg>'), 'svg');
ok(!R.toSVG(a.pages[0], { transparent: true }).includes('<rect'), 'transparent svg has no background');

// 9. PDF (plain + compressed): offsets, streams
function checkPdf(buf, label) {
  const s = buf.toString('latin1');
  const sx = +s.match(/startxref\n(\d+)\n%%EOF\n$/)[1];
  ok(s.slice(sx, sx + 5) === 'xref\n', label + ' startxref');
  const lines = s.slice(sx).split('\n'), n = +lines[1].split(' ')[1];
  for (let i = 1; i < n; i++) { const off = +lines[2 + i].slice(0, 10); ok(s.slice(off).startsWith(i + ' 0 obj'), label + ' offset ' + i); }
  for (const m of s.matchAll(/<< \/Length (\d+)( \/Filter \/FlateDecode)? >>\nstream\n/g)) {
    const st = m.index + m[0].length, len = +m[1];
    ok(s.slice(st + len, st + len + 10) === '\nendstream', label + ' stream length');
    const body = m[2] ? zlib.inflateSync(buf.subarray(st, st + len)).toString('latin1') : s.slice(st, st + len);
    ok(/ RG /.test(body), label + ' stream content');
  }
}
checkPdf(Buffer.from(R.toPDF(long.pages, {}), 'latin1'), 'pdf');
// broken numbers from an edited file must not become NaN coordinates
for (const bad of [{ size: 'abc' }, { variation: 'x' }, { margin: 'q', page: 'auto', width: NaN }]) {
  const pg = R.buildPages('Hi', gs, Object.assign({ seed: 1, font: FONT }, bad)).pages[0];
  ok(pg.ink.length && pg.ink.every(s => s.every(p => isFinite(p[0]) && isFinite(p[1]))), 'no NaN with ' + JSON.stringify(bad));
}
// one long paragraph must stay linear (charsToItems once joined the whole rest for every character)
{
  const t0 = Date.now(), para = 'Lorem ipsum dolor sit amet. '.repeat(800);
  const r = R.buildPages(para, gs, { seed: 1, font: FONT });
  ok(r.pages.length > 10 && Date.now() - t0 < 15000, 'long paragraph: ' + r.pages.length + ' pages in ' + (Date.now() - t0) + ' ms');
  const multi = new R.GlyphSet(Object.assign({}, data.glyphs, { 'ab': data.glyphs.a }), data.metrics.scale);
  const items = new R.Typesetter(multi, R.makeRng(1), { font: FONT }).charsToItems('xaby');
  ok(items.some(it => it[0] === 'g' && it[1] === 'ab'), 'multi-character key still found');
}
R.toPDFBlob(long.pages, { color: 'black' }).then(blob => blob.arrayBuffer()).then(ab => {
  const buf = Buffer.from(ab);
  checkPdf(buf, 'pdf-z');
  ok(buf.length < R.toPDF(long.pages, {}).length, 'compressed is smaller');
  console.log((fails ? 'FAILED ' + fails : 'OK') + ' - ' + checks + ' checks');
  process.exit(fails ? 1 : 0);
});
