/* my-handwriting - own drop-down lists. Every <select> gets a button and a popover list in the app's
 * style (the native list looks different on every system, e.g. plain white on Windows). The real
 * <select> stays in the page (hidden): app code keeps reading/setting .value and listening to
 * "change". New selects (e.g. in the setup helper) are picked up automatically. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.HTMLSelectElement) return;
  var P = HTMLSelectElement.prototype;
  var dValue = Object.getOwnPropertyDescriptor(P, 'value'), dIndex = Object.getOwnPropertyDescriptor(P, 'selectedIndex');
  if (!dValue || !dIndex) return;                       // very old browser: keep the native lists
  var menu = null, openSel = null, openedAt = 0;

  function labelText(sel) {
    var l = sel.id && document.querySelector('label[for="' + sel.id + '"]');
    if (!l) { l = sel.closest('label'); if (l) { var sp = l.querySelector('span'); if (sp) return sp.textContent; } }
    return l ? l.textContent.trim() : '';
  }
  function current(sel) { var o = sel.options[dIndex.get.call(sel)]; return o ? o.textContent : ''; }
  function sync(sel) {
    var b = sel._uiBtn; if (!b) return;
    var txt = current(sel), lab = labelText(sel);
    b.firstChild.textContent = txt;
    b.disabled = sel.disabled;
    b.setAttribute('aria-label', lab ? lab + ': ' + txt : txt);
  }
  function enhance(sel) {
    if (sel._uiBtn || sel.multiple || sel.hasAttribute('data-native')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sel-btn';
    b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span></span><svg class="ic sm" aria-hidden="true"><use href="#i-chev"/></svg>';
    sel.parentNode.insertBefore(b, sel.nextSibling);
    sel.classList.add('sel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    sel._uiBtn = b; b._uiSel = sel;
    // setting .value / .selectedIndex from code updates the button too
    Object.defineProperty(sel, 'value', { configurable: true, get: function () { return dValue.get.call(this); },
      set: function (v) { dValue.set.call(this, v); sync(this); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: function () { return dIndex.get.call(this); },
      set: function (v) { dIndex.set.call(this, v); sync(this); } });
    if (window.MutationObserver) new MutationObserver(function () { sync(sel); }).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
    sel.addEventListener('change', function () { sync(sel); });
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (openSel === sel) close(true); else open(sel); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(sel); }
    });
    sync(sel);
  }
  function enhanceAll(root) {
    if (root.tagName === 'SELECT') { enhance(root); return; }
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('select'), enhance);
  }

  function items() { return menu ? Array.prototype.slice.call(menu.querySelectorAll('button:not(:disabled)')) : []; }
  function open(sel) {
    close(false);
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'menu sel-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
      document.body.appendChild(menu);
      menu.addEventListener('click', function (e) {
        var it = e.target.closest('[data-i]'); if (!it || !openSel) return;
        choose(openSel, parseInt(it.getAttribute('data-i'), 10));
      });
      menu.addEventListener('keydown', onMenuKey);
    }
    var cur = dIndex.get.call(sel), btn = sel._uiBtn;
    menu.innerHTML = '';
    Array.prototype.forEach.call(sel.options, function (o, i) {
      if (o.hidden) return;
      var it = document.createElement('button');
      it.type = 'button'; it.setAttribute('role', 'option'); it.setAttribute('data-i', i); it.setAttribute('aria-selected', i === cur ? 'true' : 'false');
      if (o.disabled) it.disabled = true;
      if (i === cur) it.className = 'on';
      it.innerHTML = '<svg class="ic sm' + (i === cur ? '' : ' blank') + '" aria-hidden="true"><use href="#i-check"/></svg><span></span>';
      it.lastChild.textContent = o.textContent;
      menu.appendChild(it);
    });
    openSel = sel; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    // a button partly outside the window (scrolled dialog) is brought into view first
    openedAt = Date.now();
    var rb = btn.getBoundingClientRect();
    if (rb.top < 0 || rb.bottom > window.innerHeight) btn.scrollIntoView({ block: 'center' });
    menu.hidden = false;
    // place below the button (or above if there is no room), never outside the window
    var r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    menu.style.minWidth = Math.round(r.width) + 'px'; menu.style.maxHeight = ''; menu.style.top = '0px'; menu.style.left = '0px';
    var h = menu.offsetHeight, w = menu.offsetWidth, below = vh - r.bottom - 12, above = r.top - 12;
    var up = h > below && above > below;
    var room = up ? above : below;
    if (h > room) { menu.style.maxHeight = Math.max(120, room) + 'px'; h = menu.offsetHeight; }
    menu.style.top = Math.round(up ? r.top - h - 6 : r.bottom + 6) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(vw - w - 8, r.left))) + 'px';
    menu.style.transformOrigin = up ? 'bottom left' : 'top left';
    var on = menu.querySelector('.on') || items()[0];
    if (on) { on.focus({ preventScroll: true }); if (on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); }
  }
  function close(focusBtn) {
    if (!menu || !openSel) return;
    var b = openSel._uiBtn;
    menu.hidden = true; b.setAttribute('aria-expanded', 'false'); b.classList.remove('open');
    openSel = null;
    if (focusBtn) b.focus({ preventScroll: true });
  }
  function choose(sel, i) {
    var changed = dIndex.get.call(sel) !== i;
    sel.selectedIndex = i;
    close(true);
    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function onMenuKey(e) {
    var list = items(), i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (list[Math.min(list.length - 1, i + 1)] || list[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (list[Math.max(0, i - 1)] || list[0]).focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { close(true); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {           // jump to the first entry starting with that letter
      var k = e.key.toLowerCase(), hit = list.filter(function (b) { return b.textContent.trim().toLowerCase().indexOf(k) === 0; })[0];
      if (hit) hit.focus();
    }
  }
  document.addEventListener('pointerdown', function (e) {
    if (openSel && !e.target.closest('.sel-menu') && e.target.closest('.sel-btn') !== openSel._uiBtn) close(false);
  }, true);
  document.addEventListener('scroll', function (e) { if (openSel && Date.now() - openedAt > 300 && !(menu && menu.contains(e.target))) close(false); }, true);
  var lastW = window.innerWidth;     // phones fire resize when the address bar moves: only a width change closes
  window.addEventListener('resize', function () { if (Math.abs(window.innerWidth - lastW) > 30) { lastW = window.innerWidth; close(false); } });
  // a <label for="…"> of a hidden select: open our list instead
  document.addEventListener('click', function (e) {
    var l = e.target.closest && e.target.closest('label[for]'); if (!l) return;
    var sel = document.getElementById(l.getAttribute('for'));
    if (sel && sel._uiBtn) { e.preventDefault(); sel._uiBtn.focus(); }
  });

  function start() {
    enhanceAll(document.body);
    if (window.MutationObserver) new MutationObserver(function (list) {
      list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) enhanceAll(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.UISelect = { enhance: enhance, close: close, isOpen: function () { return !!openSel; } };
})();
