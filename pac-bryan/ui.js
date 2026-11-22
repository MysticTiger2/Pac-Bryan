(() => {
  'use strict';
  const PB = window.PacBryan, $ = id => document.getElementById(id), canvas = $('canvas');
  let local; try { local = window.localStorage; } catch {}
  const store = new PB.ScoreStore(local), renderer = new PB.Renderer(canvas);
  let game = new PB.Engine(), started = false, last = performance.now(), accumulator = 0, lastHUD = 0;
  let sound = false, audio, recordId = null, overlayPhase = '', resumeAfterScores = false, pointer = null;
  let padButtons = [], padDirection = '', padNeedsRelease = true, focused = document.hasFocus();
  const format = n => n.toLocaleString('en-US'), padded = n => String(n).padStart(6, '0');
  const dirs = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  for (const g of PB.GHOSTS) {
    const row = document.createElement('div'); row.className = 'ghost-row'; row.style.setProperty('--ghost', g.color);
    const icon = document.createElement('span'); icon.className = 'ghost-icon'; icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div'), title = document.createElement('strong'), desc = document.createElement('p');
    title.textContent = g.name; desc.textContent = g.description; text.append(title, desc); row.append(icon, text); $('ghostGuide').append(row);
  }
  PB.FRUITS.forEach((f, i) => { const box = document.createElement('div'); box.className = 'fruit'; box.dataset.fruit = i; box.title = `${f.name}: ${format(f.points)} points`; box.setAttribute('aria-label', box.title); const icon = document.createElement('span'), points = document.createElement('b'); icon.textContent = f.icon; icon.setAttribute('aria-hidden', 'true'); points.textContent = format(f.points); box.append(icon, points); $('fruitGuide').append(box); });
  function storageNotice() { $('storageNote').hidden = store.available; $('leaderboardStorage').textContent = store.available ? 'Saved on this browser.' : 'Storage unavailable. Scores last for this page session.'; }
  function tone(frequency, duration = .08, type = 'square') {
    if (!sound) return;
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); const o = audio.createOscillator(), gain = audio.createGain(); o.type = type; o.frequency.setValueAtTime(frequency, audio.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(40, frequency / 2), audio.currentTime + duration); gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration); o.connect(gain); gain.connect(audio.destination); o.start(); o.stop(audio.currentTime + duration); } catch {}
  }
  function status(text) { $('status').textContent = text; }
  function clearControls() { pointer = null; padNeedsRelease = true; padDirection = ''; for (const b of document.querySelectorAll('[data-dir]')) b.classList.remove('active'); }
  function panel(eyebrow, title, text, play, restart = false) {
    $('panelEyebrow').textContent = eyebrow; $('panelTitle').textContent = title; $('panelText').textContent = text; $('play').textContent = play; $('restart').hidden = !restart;
    $('overlay').hidden = false; $('play').focus({ preventScroll: true });
  }
  function start() {
    return Arcade.play(() => {
      game = new PB.Engine(); started = true; recordId = null; overlayPhase = ''; renderer.labels = []; clearControls();
      $('nameForm').hidden = true; $('result').hidden = true; $('overlay').hidden = true; $('scoreName').value = ''; $('nameNotice').textContent = 'Score saved as Anonymous.';
      status('Level 1 · Clear every dot. A new maze is waiting on the other side.'); canvas.focus({ preventScroll: true }); tone(620, .18, 'triangle'); sync();
    });
  }
  function pause() {
    if (!started || game.phase === 'gameover' || $('scoresDialog').open || Arcade.dialogOpen) return;
    game.pause(); clearControls(); sync();
    if (game.phase !== 'paused') { $('overlay').hidden = true; canvas.focus({ preventScroll: true }); }
  }
  function scores() {
    if ($('scoresDialog').open) return;
    resumeAfterScores = started && !['paused', 'gameover'].includes(game.phase);
    if (resumeAfterScores) game.pause();
    clearControls(); $('scoreRows').replaceChildren(); $('emptyScores').hidden = !!store.scores.length;
    store.scores.forEach((s, i) => { const row = document.createElement('tr'); for (const value of [i + 1, s.name, format(s.score), s.level]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } $('scoreRows').append(row); });
    storageNotice(); $('scoresDialog').showModal(); $('closeScores').focus();
  }
  function events(now) {
    for (const e of game.events.splice(0)) {
      if (e.type === 'score') { store.track(game.score); if (e.at) renderer.labels.push({ at: e.at, text: format(e.points), time: now }); }
      if (e.type === 'dot' && game.eaten % 2 === 0) tone(game.eaten % 4 ? 220 : 280, .035, 'triangle');
      if (e.type === 'power') { status(game.frightened ? 'Power on · Blue ghosts are edible. Chain them for 200, 400, 800, then 1,600.' : 'Power pellet collected · Ghosts reverse, but no blue time at this level.'); tone(400, .2); }
      if (e.type === 'ghostEaten') { status(`${e.name} · ${format(e.points)} points. Eyes return to the house to recover.`); tone(900, .16, 'triangle'); }
      if (e.type === 'fruit') status(`${e.name} on the move · ${format(e.points)} points. Catch it before it leaves.`);
      if (e.type === 'fruitEaten') tone(780, .2, 'triangle');
      if (e.type === 'life') { status('10,000 points · Bonus life earned!'); tone(1100, .3, 'triangle'); }
      if (e.type === 'death') { clearControls(); status(game.lives ? 'Caught! The dots stay cleared. Get ready to try again.' : 'Last life · The chase is over.'); tone(180, .45, 'sawtooth'); }
      if (e.type === 'clear') { status('Maze cleared · Generating your next course…'); tone(700, .25, 'triangle'); }
      if (e.type === 'level') status(`Level ${game.level} · Fresh maze. Same appetite.`);
      if (e.type === 'gameover') { recordId = store.record(game.score, game.level); storageNotice(); clearControls(); }
    }
  }
  function sync() {
    $('score').textContent = padded(game.score); $('best').textContent = padded(store.best); $('level').textContent = String(game.level).padStart(2, '0'); $('lives').textContent = game.lives;
    $('dots').textContent = `DOTS ${game.remaining}`;
    $('lifeText').textContent = game.nextLife === null ? 'Bonus life earned · 10,000 points' : `${format(game.nextLife - game.score)} to your bonus life`;
    $('lifeProgress').max = game.rules.bonusLife; $('lifeProgress').value = Math.min(game.score, game.rules.bonusLife);
    $('pause').disabled = !started || game.phase === 'gameover'; $('pause').textContent = game.phase === 'paused' ? 'Resume' : 'Pause';
    $('ghostMode').textContent = !started ? 'FOUR GHOSTS. ZERO FIXED MAZES.' : game.phase === 'paused' ? 'CHASE ON HOLD' : game.frightened > 0 ? 'POWER ON / GHOSTS ARE EDIBLE' : game.mode === 'scatter' ? 'OPENING SCATTER / FIND YOUR ROUTE' : 'CHASE / KEEP MOVING';
    $('powerTime').textContent = game.frightened > 0 ? `${game.frightened.toFixed(1)}s` : '';
    $('fruitNext').textContent = game.level <= 7 ? `LEVEL ${game.level} / ${PB.FRUITS[game.level - 1].name.toUpperCase()}` : `LEVEL ${game.level} / RANDOM FRUIT`;
    for (const el of document.querySelectorAll('[data-fruit]')) el.classList.toggle('current', game.level <= 7 && Number(el.dataset.fruit) === game.level - 1);
    if (game.fruit) $('fruitStatus').textContent = `${game.fruit.name} in the maze · ${format(game.fruit.points)} points. Follow the bounce.`;
    else { const next = game.rules.fruitThresholds.find(n => !game.fruitTriggered.has(n)); $('fruitStatus').textContent = next ? `Next moving fruit in ${Math.max(0, next - game.eaten)} dots. From level 8, each fruit is random.` : 'Both bonuses have appeared this maze. Clear the remaining dots.'; }
    if (game.phase !== overlayPhase) {
      overlayPhase = game.phase;
      if (started && game.phase === 'paused' && !$('scoresDialog').open) { $('nameForm').hidden = true; $('result').hidden = true; panel('TAKE A BREATHER', 'Saving your appetite?', 'Your maze will be right here. Resume this run or start a fresh one.', 'Keep munching', true); }
      else if (started && game.phase === 'gameover') {
        panel('THE LAST BITE', 'That’s a wrap.', `Level ${game.level}. A different maze is just a quarter away.`, 'Play again · 1 quarter');
        $('result').hidden = false; $('result').textContent = `${format(game.score)} points`; $('nameForm').hidden = !recordId;
      }
    }
    storageNotice();
  }
  $('play').onclick = () => game.phase === 'paused' && started ? pause() : start();
  $('restart').onclick = start; $('pause').onclick = pause;
  $('sound').onclick = () => { sound = !sound; $('sound').setAttribute('aria-pressed', String(sound)); $('sound').textContent = sound ? 'Sound on' : 'Sound off'; if (sound) tone(540, .1, 'triangle'); };
  $('showScores').onclick = scores; $('closeScores').onclick = () => $('scoresDialog').close();
  $('scoresDialog').addEventListener('close', () => { if (resumeAfterScores && game.phase === 'paused') game.pause(); resumeAfterScores = false; clearControls(); if (game.phase === 'paused') overlayPhase = ''; sync(); if (started && game.phase !== 'paused' && game.phase !== 'gameover') canvas.focus({ preventScroll: true }); });
  $('nameForm').addEventListener('submit', e => { e.preventDefault(); if (recordId) { store.rename(recordId, $('scoreName').value); $('nameNotice').textContent = 'Name saved. See you on the leaderboard.'; storageNotice(); } });
  document.addEventListener('keydown', e => {
    if ($('scoresDialog').open || Arcade.dialogOpen || e.target.closest('input, textarea, select')) return;
    if (dirs[e.code]) { e.preventDefault(); if (started && $('overlay').hidden) game.steer(dirs[e.code]); }
    else if (['KeyP', 'Escape'].includes(e.code) && !e.repeat) { e.preventDefault(); pause(); }
    else if (['Enter', 'Space'].includes(e.code) && !e.repeat && !$('overlay').hidden && !e.target.closest('button, a')) { e.preventDefault(); $('play').click(); }
  });
  for (const b of document.querySelectorAll('[data-dir]')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); if (!started || game.phase === 'paused' || Arcade.dialogOpen) return; b.setPointerCapture(e.pointerId); b.classList.add('active'); game.steer(b.dataset.dir); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, () => b.classList.remove('active'));
  }
  canvas.addEventListener('pointerdown', e => { if (!started || game.phase === 'paused') return; pointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!pointer || pointer.id !== e.pointerId) return; const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y; if (Math.hypot(dx, dy) < 13) return; game.steer(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up'); pointer.x = e.clientX; pointer.y = e.clientY; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => pointer = null);
  function autoPause() { focused = false; clearControls(); if ($('scoresDialog').open) { resumeAfterScores = false; overlayPhase = ''; } else if (started && !['paused', 'gameover'].includes(game.phase)) pause(); }
  window.addEventListener('blur', autoPause); window.addEventListener('focus', () => { focused = true; clearControls(); last = performance.now(); accumulator = 0; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  function pollGamepad() {
    if (!focused || document.hidden) return;
    if (Arcade.dialogOpen) { Arcade.pollDialogGamepad(); padNeedsRelease = true; return; }
    let p; try { p = Array.from(navigator.getGamepads?.() || []).find(p => p?.connected && p.mapping === 'standard'); } catch {}
    if (!p) { padButtons = []; padNeedsRelease = true; return; }
    const b = p.buttons.map(b => b.pressed), ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const dir = b[12] ? 'up' : b[13] ? 'down' : b[14] ? 'left' : b[15] ? 'right' : Math.max(Math.abs(ax), Math.abs(ay)) > .35 ? Math.abs(ax) > Math.abs(ay) ? ax > 0 ? 'right' : 'left' : ay > 0 ? 'down' : 'up' : '';
    if (padNeedsRelease) { padNeedsRelease = b.some(Boolean) || !!dir; padButtons = b; return; }
    const pressed = i => b[i] && !padButtons[i];
    if ($('scoresDialog').open) { if (pressed(0) || pressed(1)) $('scoresDialog').close(); }
    else if (pressed(9)) pause();
    else if (!$('overlay').hidden) {
      const choices = [...$('overlay').querySelectorAll('button:not([hidden])')];
      if (dir && dir !== padDirection) { const i = choices.indexOf(document.activeElement); choices[(i + 1) % choices.length].focus(); }
      if (pressed(0)) (choices.includes(document.activeElement) ? document.activeElement : $('play')).click();
    } else if (dir) game.steer(dir);
    padDirection = dir; padButtons = b;
  }
  function frame(now) {
    pollGamepad(); const dt = Math.min((now - last) / 1000, .1); last = now;
    if (started && focused && !document.hidden) { accumulator += dt; while (accumulator >= 1 / 120) { game.update(1 / 120); accumulator -= 1 / 120; } events(now / 1000); }
    renderer.draw(game, now / 1000);
    if (now - lastHUD > 80) { sync(); lastHUD = now; }
    requestAnimationFrame(frame);
  }
  $('play').disabled = false;
  sync(); requestAnimationFrame(frame);
})();
