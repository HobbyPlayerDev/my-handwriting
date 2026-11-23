/* my-handwriting - click-through test of every function in the running app (browser, not node).
 * Use: open the app with the synthetic samples imported (out/fx.json), then in the console / javascript tool:
 *   await eval(await (await fetch('tests/ui_audit.js', {cache: 'reload'})).text())
 * Downloads are intercepted; it changes and restores data of the open browser profile (test profile only!).
 * Expects the German interface for two text checks (switch with the menu first). */
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const H = MyHandwriting, res = [];
  const ok = (name, cond, info) => res.push((cond ? 'OK   ' : 'FAIL ') + name + (info !== undefined ? ' (' + info + ')' : ''));
  const open = id => $(id).classList.contains('show');
  const closeAll = async () => { document.querySelectorAll('.modal-bg.show .x').forEach(x => x.click()); await sleep(300); };
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); else origClick.call(this); };
  const pad = $('pad');
  const draw = () => { const r = pad.getBoundingClientRect(); const ev = (t, x, y, b) => pad.dispatchEvent(new PointerEvent(t, { pointerId: 9, pointerType: 'mouse', clientX: r.left + x, clientY: r.top + y, button: 0, buttons: b, bubbles: true, cancelable: true }));
    ev('pointerdown', 100, 120, 1); for (let i = 1; i < 12; i++) ev('pointermove', 100 + i * 6, 120 + i * 7, 1); ev('pointerup', 170, 200, 0); };
  const key = (k, o) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})));
  const total = () => Object.values(H.state().glyphs).reduce((n, a) => n + a.length, 0);
  await closeAll();

  // ---- writing area
  H.setCurrent('B'); await sleep(50);
  $('btnSkip').click(); ok('Next goes to the next character', H.current() === 'C', H.current());
  $('btnBack').click(); ok('Back goes to the previous character', H.current() === 'B');
  key('ArrowRight'); ok('→ key', H.current() === 'C'); key('ArrowLeft'); ok('← key', H.current() === 'B');
  const t0 = H.state().settings.template; $('btnTemplate').click(); ok('Guide button toggles', H.state().settings.template === !t0);
  key('v'); ok('V key toggles guide', H.state().settings.template === t0);
  draw(); ok('drawing makes a stroke', H.strokes() === 1);
  $('btnUndo').click(); ok('Undo removes the stroke', H.strokes() === 0);
  draw(); key('z', { ctrlKey: true }); ok('Ctrl+Z', H.strokes() === 0);
  draw(); $('btnClear').click(); ok('Clear', H.strokes() === 0);
  draw(); key('Escape'); ok('Esc clears', H.strokes() === 0);
  let n0 = total(); draw(); $('btnSave').click(); await sleep(50); ok('Save adds a sample', total() === n0 + 1);
  n0 = total(); draw(); key('Enter'); await sleep(50); ok('Enter saves', total() === n0 + 1);
  H.setCurrent('B'); await sleep(50);
  const thumbs = document.querySelectorAll('#samples .thumb').length; n0 = total();
  document.querySelector('#samples .thumb .del').click(); await sleep(50);
  ok('× deletes a sample', total() === n0 - 1 && document.querySelectorAll('#samples .thumb').length === thumbs - 1);
  $('toastBtn').click(); await sleep(50); ok('Undo in the toast brings it back', total() === n0);

  // ---- overview
  const ov = $('overview');
  ov.querySelector('[data-ch="Q"]').click(); ok('click on a cell selects it', H.current() === 'Q');
  const tg = ov.querySelector('[data-gtoggle="digits"]'); const wasOpen = tg.getAttribute('aria-expanded') === 'true';
  tg.click(); ok('group opens/closes', ov.querySelector('[data-gtoggle="digits"]').getAttribute('aria-expanded') === String(!wasOpen));
  const cb = ov.querySelector('[data-group="math"]'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); await sleep(50);
  ok('group can be switched off', H.state().settings.groups.math === false);
  const cb2 = ov.querySelector('[data-group="math"]'); cb2.checked = true; cb2.dispatchEvent(new Event('change', { bubbles: true })); await sleep(50);
  ok('…and on again', H.state().settings.groups.math === true);
  H.state().settings.custom = (H.state().settings.custom || '').replace(/♥/g, '');   // left over from an earlier run
  const added = H.addCustom('♥'); await sleep(50); ok('own character added', added.join('') === '♥' && H.current() === '♥');

  // ---- export / import
  downloads.length = 0; $('btnExport').click(); await sleep(200);
  ok('Export downloads the file', downloads.some(d => /^my-handwriting-glyphs-.*\.json$/.test(d)), downloads.join(','));
  ok('Export dialog opens', open('mExport'));
  $('btnShowJson').click(); ok('Show text shows the JSON', $('exportText').style.display === 'block' && $('exportText').value.indexOf('my-handwriting-glyphs') > 0);
  await closeAll();
  const json = JSON.stringify(H.exportData());
  const dt = new DataTransfer(); dt.items.add(new File([json], 'x.json', { type: 'application/json' }));
  $('fileInput').files = dt.files; $('fileInput').dispatchEvent(new Event('change')); await sleep(300);
  ok('Import dialog opens', open('mImport'));
  n0 = total(); $('btnImportMerge').click(); await sleep(300); ok('Merge adds no duplicates', total() === n0, total() + ' vs ' + n0);

  // ---- write text
  $('btnWrite').click(); await sleep(500);
  ok('Write dialog opens with a preview', open('mWrite') && $('wCanvas').height > 50);
  $('wText').value = 'Hallo Welt'; $('wText').dispatchEvent(new Event('input', { bubbles: true }));
  const wc = $('wColor'); wc.value = 'red'; wc.dispatchEvent(new Event('change', { bubbles: true })); await sleep(400);
  ok('colour change is kept', H.state().settings.write.color === 'red' && wc._uiBtn.textContent.trim().length > 0, wc._uiBtn.textContent);
  const seedBefore = H.lastBuild(); $('wReroll').click(); await sleep(100); ok('Shuffle renders again', H.lastBuild() !== seedBefore);
  const rw = $('wRealism'), inkW = () => H.lastBuild().pages[0].inkW;
  ok('realism is on by default and varies the pen pressure', rw.checked && H.state().settings.realism !== false && !!(inkW() && inkW().length));
  rw.checked = false; rw.dispatchEvent(new Event('change', { bubbles: true })); await sleep(450);
  ok('realism off: even strokes', H.state().settings.realism === false && !inkW());
  rw.checked = true; rw.dispatchEvent(new Event('change', { bubbles: true })); await sleep(450);
  const wv = $('wVar'), v0 = wv.value; wv.value = '1.6'; wv.dispatchEvent(new Event('input', { bubbles: true })); await sleep(450);
  ok('irregularity slider shows percent like Claude', wv.parentNode.querySelector('.rv').textContent === '80 %' && H.state().settings.write.variation === 1.6, wv.parentNode.querySelector('.rv').textContent);
  wv.value = v0; wv.dispatchEvent(new Event('input', { bubbles: true })); await sleep(450);
  downloads.length = 0; $('wSvg').click(); await sleep(500); ok('SVG download', downloads.some(d => /\.svg$/.test(d)), downloads.join(','));
  downloads.length = 0; $('wPdf').click(); await sleep(1200); ok('PDF download', downloads.some(d => /\.pdf$/.test(d)), downloads.join(','));
  // a PNG page needs about 1 s to encode in a slow (background) preview: wait for it instead of a fixed time
  downloads.length = 0; $('wPng').click(); for (let i = 0; i < 40 && !downloads.some(d => /\.png$/.test(d)); i++) await sleep(200);
  ok('PNG download', downloads.some(d => /\.png$/.test(d)), downloads.join(','));
  await closeAll();

  // ---- settings
  document.querySelector('[data-act="settings"]').click(); await sleep(300);
  ok('Settings open', open('mSettings'));
  $('setTarget').value = '7'; $('setMode').value = 'round'; $('setCustom').value = '♥★';
  $('setClaudePaper').value = 'grid'; $('setClaudeColor').value = 'green';
  $('setFallback').checked = false;
  $('setClaudeAlign').value = 'center'; const sv = $('setClaudeVar'); sv.value = '0.4'; sv.dispatchEvent(new Event('input', { bubbles: true }));
  ok('document irregularity shows percent', sv.parentNode.querySelector('.rv').textContent === '20 %', sv.parentNode.querySelector('.rv').textContent);
  ok('selects show the chosen value', $('setMode')._uiBtn.textContent.length > 5 && $('setClaudePaper')._uiBtn.textContent.length > 2);
  $('btnSettingsSave').click(); await sleep(300);
  const st = H.state().settings;
  ok('settings applied', st.target === 7 && st.mode === 'round' && st.custom === '♥★' && st.fallbackFont === false);
  ok('document defaults go to Claude and Write text', st.claude.paper === 'grid' && st.write.paper === 'grid' && st.claude.color === 'green');
  ok('export carries the language for Claude', H.exportData().settings.claude.lang === document.documentElement.lang);
  const ec = H.exportData().settings.claude;
  ok('alignment + irregularity go to Claude and Write text', ec.align === 'center' && ec.variation === 0.4 && st.write.align === 'center' && st.write.variation === 0.4, JSON.stringify(ec));
  document.querySelector('[data-act="settings"]').click(); await sleep(300);
  ok('settings show the saved irregularity', $('setClaudeVar').value === '0.4' && $('setClaudeAlign').value === 'center');
  $('setTarget').value = '10'; $('setMode').value = 'char'; $('setFallback').checked = true;
  $('setClaudeAlign').value = 'left'; $('setClaudeVar').value = '1'; $('btnSettingsSave').click(); await sleep(300);
  // writing area size (device setting): live while sliding, back on cancel, kept on save, samples unchanged
  {
    const w0 = pad.getBoundingClientRect().width, keep = localStorage.getItem('my-handwriting-padsize');
    const sz = v => { $('setPadSize').value = String(v); $('setPadSize').dispatchEvent(new Event('input', { bubbles: true })); };
    document.querySelector('[data-act="settings"]').click(); await sleep(300);
    sz(60); await sleep(50); const w60 = pad.getBoundingClientRect().width;
    ok('writing area size: smaller while sliding', w60 < w0 * 0.8 && $('setPadSizeVal').textContent === '60 %', w0 + ' → ' + w60);
    await closeAll(); ok('…back after closing without saving', Math.abs(pad.getBoundingClientRect().width - w0) < 2);
    document.querySelector('[data-act="settings"]').click(); await sleep(300); sz(70); $('btnSettingsSave').click(); await sleep(300);
    const w70 = pad.getBoundingClientRect().width;
    ok('…kept after saving (this device only)', w70 < w0 && localStorage.getItem('my-handwriting-padsize') === '70' && !('padSize' in H.state().settings));
    document.querySelector('[data-act="settings"]').click(); await sleep(300); sz(100); $('btnSettingsSave').click(); await sleep(300);
    ok('…100 % = fits the screen again, nothing stored', localStorage.getItem('my-handwriting-padsize') === null &&
       (keep !== null || Math.abs(pad.getBoundingClientRect().width - w0) < 2));
    // Ctrl + mouse wheel over the writing area: 10 % steps, 10 % at the least, plain wheel untouched
    const wh = (dy, ctrl) => { const e = new WheelEvent('wheel', { deltaY: dy, ctrlKey: ctrl, bubbles: true, cancelable: true }); $('padwrap').dispatchEvent(e); return e.defaultPrevented; };
    const before = pad.getBoundingClientRect().width;
    ok('plain mouse wheel is left alone', !wh(100, false) && pad.getBoundingClientRect().width === before);
    ok('Ctrl + wheel down: 10 % smaller', wh(100, true) && localStorage.getItem('my-handwriting-padsize') === '90' && pad.getBoundingClientRect().width < before);
    for (let i = 0; i < 20; i++) wh(100, true);
    ok('…not below 10 %', localStorage.getItem('my-handwriting-padsize') === '10' && pad.getBoundingClientRect().width >= 40, pad.getBoundingClientRect().width);
    // the line names (grey, right side) must not run across the letter on a small writing area
    const names = () => { const c = pad.getContext('2d'), x0 = Math.floor(pad.width * 0.7), d = c.getImageData(x0, 0, pad.width - x0, pad.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 163) < 12 && Math.abs(d[i + 1] - 169) < 12 && Math.abs(d[i + 2] - 187) < 12 && d[i + 3] > 200) n++; return n; };
    ok('…no line names on a tiny writing area', names() === 0);
    const tick = $('padOk').getBoundingClientRect();
    ok('…the save tick fits inside it', tick.width <= pad.getBoundingClientRect().width * 0.45, Math.round(tick.width) + 'px');
    // the area shrank away from the mouse: Ctrl + wheel on the empty writing side must still work
    // (it once went to the browser, and Chrome zoomed the whole page)
    const onMain = (dy) => { const e = new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }); document.querySelector('main').dispatchEvent(e); return e.defaultPrevented; };
    ok('Ctrl + wheel beside the small area still sizes it', onMain(-100) && localStorage.getItem('my-handwriting-padsize') === '20');
    const ov = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }); $('overview').dispatchEvent(ov);
    ok('…but over the overview the browser keeps its zoom', !ov.defaultPrevented && localStorage.getItem('my-handwriting-padsize') === '20');
    for (let i = 0; i < 8; i++) wh(-100, true);
    ok('Ctrl + wheel up: back to 100 %', localStorage.getItem('my-handwriting-padsize') === null && (keep !== null || Math.abs(pad.getBoundingClientRect().width - w0) < 2));
    if (keep !== null) localStorage.setItem('my-handwriting-padsize', keep);   // the tester's own size, used after a reload
  }
  // line width on the writing area (device setting): thicker/thinner lines, the saved sample is the same
  {
    const keepL = localStorage.getItem('my-handwriting-padline'), c = pad.getContext('2d');
    const inkPx = () => { const d = c.getImageData(0, 0, pad.width, pad.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 80 && d[i + 2] > 100 && d[i + 1] < 90) n++; return n; };   // opaque ink only (the guide letter is faint)
    const lw = v => { $('setPadLine').value = String(v); $('setPadLine').dispatchEvent(new Event('input', { bubbles: true })); };
    H.setCurrent('Q'); await sleep(50); draw(); const thin = inkPx();
    document.querySelector('[data-act="settings"]').click(); await sleep(300);
    lw(300); await sleep(50); const thick = inkPx();
    ok('line width 300 %: the strokes get thicker at once', thick > thin * 1.8 && $('setPadLineVal').textContent === '300 %', thin + ' → ' + thick);
    await closeAll(); ok('…back after closing without saving', Math.abs(inkPx() - thin) < thin * 0.1);
    document.querySelector('[data-act="settings"]').click(); await sleep(300); lw(50); $('btnSettingsSave').click(); await sleep(300);
    ok('…50 % is kept for this device, thinner strokes', localStorage.getItem('my-handwriting-padline') === '50' && inkPx() < thin * 0.8 && !('padLine' in H.state().settings));
    $('btnClear').click(); await sleep(50);
    $('btnClear').click(); H.setCurrent('Q'); await sleep(50); draw(); await sleep(30);
    ok('…an empty area shows nothing extra after saving', H.strokes() === 1);
    $('btnClear').click();
    document.querySelector('[data-act="settings"]').click(); await sleep(300); lw(100); $('btnSettingsSave').click(); await sleep(300);
    ok('…100 % = normal again, nothing stored', localStorage.getItem('my-handwriting-padline') === null);
    if (keepL !== null) localStorage.setItem('my-handwriting-padline', keepL);
  }

  // ---- language
  $('btnMore').click(); await sleep(100);
  document.querySelector('[data-mlang="en"]').click(); await sleep(200);
  ok('language switch (menu)', document.documentElement.lang === 'en' && $('btnSave').textContent.trim() === 'Save');
  document.querySelector('[data-mlang="de"]').click(); await sleep(200); document.body.click();
  ok('…back to German', $('btnSave').textContent.trim() === 'Speichern');

  // ---- install as app
  $('btnMore').click(); await sleep(100); document.querySelector('[data-act="install"]').click(); await sleep(300);
  ok('Install dialog opens and marks this device', open('mInstall') && document.querySelectorAll('#mInstall dt.mine').length === 1);
  const shown = id => getComputedStyle($(id)).display !== 'none';
  ok('Install: notes only where they apply', shown('instFile') === (location.protocol === 'file:') && shown('instDone') === matchMedia('(display-mode: standalone)').matches);
  await closeAll();

  // ---- help + setup helper
  $('btnMore').click(); await sleep(100); document.querySelector('[data-act="help"]').click(); await sleep(300);
  ok('Help opens', open('mHelp') && /Version \d+\.\d+\.\d+/.test($('helpVersion').textContent), $('helpVersion').textContent);
  $('helpRestart').click(); await sleep(400); ok('"Show the introduction again" opens the setup', open('mWizard') && !open('mHelp'));
  ok('setup can be closed when opened again (×)', !document.querySelector('#mWizard .x').hidden);
  for (let i = 0; i < 3; i++) { $('wizNext').click(); await sleep(250); }
  const wzv = document.querySelector('#wizBody [data-doc="variation"]');
  ok('setup step Documents has alignment + irregularity', !!wzv && !!document.querySelector('#wizBody [data-doc="align"]') && wzv.parentNode.querySelector('.rv').textContent === '50 %');
  await closeAll();

  // ---- pen badge
  pad.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'pen', bubbles: true }));
  ok('hovering pen shows the badge', $('penBadge').classList.contains('show'));
  $('penBadge').click(); ok('badge allows fingers again', H.state().settings.penOnly === 'off');
  $('penBadge').click(); ok('…and ignores them again', H.state().settings.penOnly === 'auto');

  // ---- handwritings
  const before = H.profiles().list.length;
  await H.createProfile('Test X'); await sleep(500); await closeAll();
  ok('new handwriting', H.profiles().list.length === before + 1 && $('profName').textContent === 'Test X');
  const id = H.profiles().active; H.renameProfile(id, 'Test Y'); ok('rename', $('profName').textContent === 'Test Y');
  $('profBtn').click(); await sleep(100);
  ok('switcher menu lists all', document.querySelectorAll('#profMenu [data-prof]').length === H.profiles().list.length);
  document.body.click();
  await H.deleteProfile(id); await sleep(400);
  ok('delete handwriting', H.profiles().list.length === before);
  $('toastBtn').click(); await sleep(500); ok('undo delete', H.profiles().list.length === before + 1);
  await H.deleteProfile(id); await sleep(400);

  // ---- Claude
  $('btnClaude').click(); await sleep(300);
  downloads.length = 0; $('clZip').click(); await sleep(800);
  ok('Claude ZIP download', downloads.indexOf('my-handwriting-skill.zip') >= 0 && $('clStatus').textContent.length > 0, $('clStatus').textContent);
  ok('Claude: shows which handwriting', $('clWhich').textContent.indexOf(H.profiles().list.filter(p => p.id === H.profiles().active)[0].name) >= 0);
  ok('Open Claude skills link', $('clOpen').href === 'https://claude.ai/customize/skills' && $('clOpen').target === '_blank');
  await closeAll();

  // ---- wipe + undo, reset + undo
  n0 = total();
  document.querySelector('[data-act="settings"]').click(); await sleep(300);
  $('btnWipe').click(); $('btnWipe').click(); await sleep(400);
  ok('delete samples (two clicks)', total() === 0);
  $('toastBtn').click(); await sleep(400); ok('undo brings them back', total() === n0);
  document.querySelector('[data-act="settings"]').click(); await sleep(300);
  $('btnReset').click(); $('btnReset').click(); await sleep(800);
  ok('reset everything opens the first setup', open('mWizard') && total() === 0 && document.querySelector('#mWizard .x').hidden);
  $('toastBtn').click(); await sleep(900);
  ok('undo reset', total() === n0 && !open('mWizard'), total());

  HTMLAnchorElement.prototype.click = origClick;
  return res.join('\n');
})()
