(() => {
  'use strict';
  const key = 'tigerArcade.quartersPlease.v1';
  const repairSeconds = [60, 45, 30, 15, 10, 5], repairCosts = [10, 25, 50, 75, 100];
  const $ = id => document.getElementById(id);
  const caps = { alloy: 10, ac: 20, ear: Infinity, repair: 5 };
  let memory, storage, lastWind = -1, busy = false;
  const initial = () => ({ temperature: 0, updatedAt: Date.now(), brokenAt: null, alloy: 0, ac: 0, ear: 0, repair: 0 });
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const candidate = window[name], saved = candidate.getItem(key);
      candidate.setItem(key, saved ?? JSON.stringify(initial()));
      storage = candidate;
      if (name !== 'localStorage') showStorageNotice('Progress can only be saved for this browser session.');
      break;
    } catch { /* Keep the clicker playable when browser storage is blocked. */ }
  }
  if (!storage) showStorageNotice('Browser storage is unavailable. Progress and repair time last only while this page stays open.');
  function showStorageNotice(message) { $('save-notice').hidden = false; $('save-notice').textContent = message; }
  function read() {
    let saved = memory;
    try { if (storage) saved = JSON.parse(storage.getItem(key)); } catch {}
    const state = initial();
    if (!saved || typeof saved !== 'object') return state;
    for (const name of Object.keys(caps)) {
      if (Number.isSafeInteger(saved[name]) && saved[name] >= 0) state[name] = Math.min(caps[name], saved[name]);
    }
    if (Number.isFinite(saved.temperature) && saved.temperature >= 0) state.temperature = Math.min(saved.temperature, 320);
    if (Number.isFinite(saved.updatedAt) && saved.updatedAt >= 0) state.updatedAt = Math.min(Date.now(), saved.updatedAt);
    if (Number.isFinite(saved.brokenAt) && saved.brokenAt >= 0) state.brokenAt = saved.brokenAt;
    return state;
  }
  function save(state) {
    memory = { ...state };
    try { storage?.setItem(key, JSON.stringify(state)); } catch {
      storage = undefined;
      showStorageNotice('Progress cannot be saved. Keep this page open to finish repairs.');
    }
  }
  const maxTemperature = state => 50 + 25 * state.alloy;
  const coolingRate = state => 1 + 2 * state.ac;
  const repairDuration = state => repairSeconds[state.repair] * 1000;
  function advance(state, now = Date.now()) {
    state.temperature = Math.max(0, state.temperature - Math.max(0, now - state.updatedAt) / 1000 * coolingRate(state));
    if (state.brokenAt !== null) {
      if (now - state.brokenAt >= repairDuration(state)) { state.brokenAt = null; state.temperature = 0; }
    }
    state.updatedAt = now;
    return state;
  }
  function price(name, level) {
    if (name === 'repair') return repairCosts[level] ?? Infinity;
    if (name !== 'ear') return 10 * 2 ** level;
    let cost = 25;
    // Round each successive purchase price, rather than the final exponential.
    for (let i = 0; i < level; i++) {
      cost = Math.round(cost * 1.1);
      if (!Number.isSafeInteger(cost)) return Infinity;
    }
    return cost;
  }
  const format = value => value.toLocaleString('en-US');
  function mix(a, b, amount) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amount)).join(' ')})`; }
  function render() {
    const state = advance(read()), max = maxTemperature(state), heat = Math.min(1, state.temperature / max), broken = state.brokenAt !== null;
    const repairTime = repairDuration(state);
    const stage = $('coin-stage'), tint = state.alloy / 10;
    stage.style.setProperty('--coin-face', mix([174 - 55 * tint, 189 - 58 * tint, 189 + 38 * tint], [255, 65, 32], heat));
    stage.style.setProperty('--coin-edge', mix([118 + 25 * tint, 139 - 45 * tint, 144 + 58 * tint], [155, 24, 13], heat));
    stage.style.setProperty('--coin-light', mix([229, 239 - 35 * tint, 222 + 30 * tint], [255, 185, 96], heat));
    stage.style.setProperty('--coin-ink', mix([51, 70, 74], [93, 23, 14], heat));
    stage.style.setProperty('--heat', String(heat * .6));
    stage.classList.toggle('broken', broken);
    const remaining = broken ? Math.max(0, repairTime - (Date.now() - state.brokenAt)) : 0;
    stage.style.setProperty('--scatter', String((Math.min(1, remaining / repairTime)) ** .65));
    $('quarter').disabled = broken;
    $('quarter').setAttribute('aria-label', broken ? 'Quarter repairing' : `Click quarter to earn ${state.ear + 1} quarters`);
    $('temperature').textContent = `${Math.ceil(state.temperature)}° / ${max}°`;
    $('temperature-fill').style.width = `${heat * 100}%`;
    $('temperature-meter').setAttribute('aria-valuemax', max);
    $('temperature-meter').setAttribute('aria-valuenow', Math.min(max, Math.ceil(state.temperature)));
    $('heat-label').textContent = broken ? 'SHATTERED' : heat > .8 ? 'RED HOT' : heat > .4 ? 'HEATING UP' : 'NICE & COOL';
    const status = broken ? 'Too hot! Give it a moment to pull itself together.' : 'Click the quarter. Keep the change.';
    if ($('coin-status').textContent !== status) $('coin-status').textContent = status;
    $('repair-note').hidden = !broken;
    $('repair-countdown').textContent = `${Math.ceil(remaining / 1000)}s`;
    $('repair-progress').max = repairTime / 1000;
    $('repair-progress').value = (repairTime - remaining) / 1000;
    $('per-click').textContent = `+${format(state.ear + 1)}`;
    $('cooling').textContent = `−${coolingRate(state)}°`;
    $('limit-note').textContent = `Above ${max}°? It shatters. Repairs take ${repairTime / 1000} seconds.`;
    $('repair-effect').textContent = state.repair === caps.repair
      ? 'Repairs take just 5 seconds.'
      : `Repair time: ${repairSeconds[state.repair]} → ${repairSeconds[state.repair + 1]} seconds.`;
    for (const name of Object.keys(caps)) {
      const cost = price(name, state[name]), atCap = state[name] >= caps[name], affordable = cost <= Arcade.balance();
      $(`${name}-level`).textContent = `LEVEL ${format(state[name])}${name === 'ear' ? ' · NO LIMIT' : ` / ${caps[name]}`}`;
      const button = $(`buy-${name}`);
      button.disabled = atCap || !affordable || busy;
      button.textContent = atCap ? 'Fully upgraded' : Number.isFinite(cost) ? `Buy · ${format(cost)} quarters` : 'Cost exceeds wallet capacity';
      button.title = atCap ? 'Maximum level reached' : affordable ? 'Buy one upgrade' : 'Earn more quarters to buy this upgrade';
    }
    document.documentElement.style.setProperty('--ac', String(state.ac / 20 * .65));
    if (lastWind !== state.ac) {
      lastWind = state.ac;
      $('wind').replaceChildren();
      for (let i = 0; i < state.ac * 3; i++) {
        const streak = document.createElement('i');
        streak.className = 'wind-streak';
        streak.style.cssText = `top:${(i * 37 + 11) % 100}%;--length:${70 + state.ac * 7 + i % 5 * 18}px;--speed:${4.5 - state.ac * .16 + i % 3 * .15}s;--delay:-${i * .43}s`;
        $('wind').append(streak);
      }
    }
  }
  // Each triangle contains the corresponding part of the actual coin artwork.
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) for (let half = 0; half < 2; half++) {
    const shard = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    shard.setAttribute('viewBox', '0 0 240 240');
    shard.classList.add('shard');
    shard.innerHTML = '<use href="#quarter-art"/>';
    const x0 = x * 25, y0 = y * 25;
    shard.style.clipPath = half ? `polygon(${x0}% ${y0}%,${x0 + 25}% ${y0 + 25}%,${x0}% ${y0 + 25}%)` : `polygon(${x0}% ${y0}%,${x0 + 25}% ${y0}%,${x0 + 25}% ${y0 + 25}%)`;
    shard.style.setProperty('--dx', `${(x - 1.5) * 39 + (half ? -9 : 9)}px`);
    shard.style.setProperty('--dy', `${(y - 1.5) * 39 + (half ? 9 : -9)}px`);
    shard.style.setProperty('--spin', `${((x * 7 + y * 3 + half * 5) % 11 - 5) * 7}deg`);
    $('shards').append(shard);
  }
  function flyQuarters(count) {
    const from = $('quarter').getBoundingClientRect(), to = $('quarters-wallet').getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < Math.min(10, count); i++) {
      const coin = document.createElement('span');
      coin.className = 'flying-quarter'; coin.textContent = '25¢'; coin.setAttribute('aria-hidden', 'true');
      coin.style.left = `${from.x + from.width / 2 - 12}px`; coin.style.top = `${from.y + from.height / 2 - 12}px`;
      document.body.append(coin);
      const dx = to.x + to.width / 2 - (from.x + from.width / 2), dy = to.y + to.height / 2 - (from.y + from.height / 2);
      const animation = coin.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${(i - (Math.min(10, count) - 1) / 2) * 18}px,-65px) scale(1.05)`, opacity: 1, offset: .3 },
        { transform: `translate(${dx}px,${dy}px) scale(.5)`, opacity: 0 }
      ], { duration: reduced ? 120 : 820, delay: reduced ? 0 : i * 45, easing: 'ease-in-out', fill: 'both' });
      animation.finished.then(() => coin.remove());
    }
  }
  $('quarter').addEventListener('click', async () => {
    let earned = 0;
    try {
      await Arcade.updateQuarters(quarters => {
        const state = advance(read());
        if (state.brokenAt !== null || !Number.isSafeInteger(quarters + state.ear + 1)) return null;
        earned = state.ear + 1;
        state.temperature += 20;
        if (state.temperature > maxTemperature(state)) state.brokenAt = Date.now();
        save(state);
        return quarters + earned;
      });
      if (earned) flyQuarters(earned);
    } finally { render(); }
  });
  for (const button of document.querySelectorAll('[data-upgrade]')) button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const name = button.dataset.upgrade;
      const bought = await Arcade.updateQuarters(quarters => {
        const state = advance(read()), cost = price(name, state[name]);
        if (state[name] >= caps[name] || cost > quarters) return null;
        state[name]++;
        save(state);
        return quarters - cost;
      });
      $('shop-message').textContent = bought ? 'Upgrade installed. Keep the change coming.' : 'You need more quarters for that upgrade.';
    } finally { busy = false; render(); }
  });
  window.addEventListener('storage', render);
  window.addEventListener('pageshow', render);
  document.addEventListener('visibilitychange', render);
  setInterval(render, 100);
  render();
})();
