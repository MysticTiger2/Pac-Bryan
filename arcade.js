/* Shared browser-local credits. Quarters Please and Power Struggle do not charge to enter. */
(() => {
  'use strict';
  const key = 'tigerArcade.quarters.v1';
  const root = new URL('./', document.currentScript.src);
  // A file URL opens a directory listing for "./" and cannot resolve extensionless pages.
  // Keep all HTTP(S) destinations untouched, including GitHub Pages' project root.
  if (location.protocol === 'file:') {
    const gameFiles = new Set(['ghost-pop', 'dad-dug', 'eviction']);
    for (const link of document.querySelectorAll('a[href]')) {
      const target = new URL(link.getAttribute('href'), location.href);
      if (target.protocol !== 'file:' || !target.pathname.startsWith(root.pathname)) continue;
      const page = target.pathname.slice(root.pathname.length);
      if (page === '') target.pathname += 'index.html';
      else if (gameFiles.has(page)) target.pathname += '.html';
      else continue;
      link.href = target.href;
    }
  }
  const lockName = `arcade-quarters:${root.pathname}`;
  let storage, fallback = 5, busy = false;
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const candidate = window[name];
      const saved = candidate.getItem(key);
      candidate.setItem(key, saved ?? '5');
      storage = candidate;
      break;
    } catch { /* Try session storage before falling back to this page's memory. */ }
  }
  function balance() {
    let value = fallback;
    try { if (storage) value = Number(storage.getItem(key) ?? fallback); } catch {}
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  function render() {
    const quarters = balance();
    for (const el of document.querySelectorAll('[data-arcade-wallet]')) {
      el.classList.add('arcade-wallet');
      el.classList.toggle('arcade-empty', quarters === 0);
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.textContent = `${quarters} ${quarters === 1 ? 'quarter' : 'quarters'}`;
      el.title = storage ? 'One quarter per new arcade game' : 'Quarters are saved for this page only';
    }
  }
  function saveBalance(quarters) {
    fallback = quarters;
    try { storage?.setItem(key, String(quarters)); } catch { storage = undefined; }
    render();
  }
  function withBalanceLock(update) {
    if (!navigator.locks?.request) return Promise.resolve().then(update);
    let entered = false;
    return navigator.locks.request(lockName, () => { entered = true; return update(); }).catch(error => {
      if (entered) throw error;
      return update();
    });
  }
  // Clicker earnings and purchases use the same lock and fresh balance as paid games.
  // Returning null declines a transaction without changing the wallet.
  function updateQuarters(update) {
    return withBalanceLock(() => {
      const quarters = update(balance());
      if (quarters === null) return false;
      if (!Number.isSafeInteger(quarters) || quarters < 0) throw new RangeError('Invalid quarter balance');
      saveBalance(quarters);
      return true;
    });
  }
  function resetQuarters() {
    return withBalanceLock(() => {
      const quarters = Math.min(5, balance());
      saveBalance(quarters);
      return quarters;
    });
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'arcade-dialog';
  dialog.setAttribute('aria-labelledby', 'arcade-empty-title');
  dialog.innerHTML = '<h2 id="arcade-empty-title">Out of quarters</h2><p>You need one quarter to start a new arcade game.</p><a class="arcade-get-quarters">get more quarters</a><button type="button">Back to the game</button>';
  dialog.querySelector('a').href = new URL('quarters-please.html', root).href;
  dialog.querySelector('button').onclick = () => dialog.close();
  document.body.append(dialog);
  const insert = document.createElement('div');
  insert.className = 'arcade-insert';
  insert.hidden = true;
  insert.setAttribute('role', 'status');
  insert.innerHTML = '<span class="arcade-insert-art" aria-hidden="true"><span class="arcade-coin">25¢</span><span class="arcade-slot"></span></span><span>1 quarter · Let’s play</span>';
  document.body.append(insert);
  let previousButtons = [];
  function pollDialogGamepad() {
    if (document.hidden || !document.hasFocus()) return;
    let pad;
    try { pad = Array.from(navigator.getGamepads?.() || []).find(p => p?.connected && p.mapping === 'standard'); } catch {}
    if (!pad) return;
    const buttons = pad.buttons.map(b => b.pressed);
    if ([12,13,14,15].some(i => buttons[i] && !previousButtons[i])) {
      (document.activeElement === dialog.querySelector('a') ? dialog.querySelector('button') : dialog.querySelector('a')).focus();
    }
    if (buttons[1] && !previousButtons[1]) dialog.close();
    else if (buttons[0] && !previousButtons[0] && dialog.contains(document.activeElement)) document.activeElement.click();
    previousButtons = buttons;
  }
  function outOfQuarters() {
    if (!dialog.open) {
      try { previousButtons = Array.from(navigator.getGamepads?.() || []).find(p => p?.connected)?.buttons.map(b => b.pressed) || []; } catch { previousButtons = []; }
      dialog.showModal();
      dialog.querySelector('a').focus();
    }
  }
  async function play(begin) {
    if (busy || dialog.open) return false;
    busy = true;
    try {
      const spend = () => {
        const credits = balance();
        if (credits < 1) return false;
        saveBalance(credits - 1);
        return true;
      };
      // Serialize balance updates between tabs when the browser supports Web Locks.
      const paid = await withBalanceLock(spend);
      if (!paid) { render(); outOfQuarters(); busy = false; return false; }
      insert.hidden = false;
      begin();
      await new Promise(resolve => setTimeout(resolve, 700));
      return true;
    } finally {
      insert.hidden = true;
      busy = false;
    }
  }
  window.Arcade = Object.freeze({ play, balance, resetQuarters, updateQuarters, get busy() { return busy; }, get dialogOpen() { return dialog.open; }, pollDialogGamepad });
  window.addEventListener('storage', e => { if (e.key === key || e.key === null) render(); });
  window.addEventListener('pageshow', render);
  render();
})();
