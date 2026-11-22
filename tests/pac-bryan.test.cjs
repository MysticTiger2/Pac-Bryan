const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
let browser, server, base;
const hook = `globalThis.pacTest={get game(){return game},store,start,pause,sync,pollGamepad,
  advance:n=>{game.update(n);events(performance.now()/1000);sync()},
  over:score=>{game.addScore(score-game.score);game.lives=0;game.phase='dying';game.timer=.01;game.update(.02);events(performance.now()/1000);sync()},
  clear:()=>{game.phase='playing';game.maze.pellets.fill(0);game.maze.pellets[game.maze.index(game.player.x,game.player.y)]=1;game.remaining=1;game.eatPellet();},
  focus:v=>{focused=v;padNeedsRelease=true},
  render:()=>renderer.draw(game,performance.now()/1000)};`;
before(async () => {
  server = http.createServer((req, res) => {
    let route = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (route === 'fixture') route = 'pac-bryan.html';
    if (!path.extname(route)) route += '.html';
    const filename = path.resolve(root, route);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(filename, (err, bytes) => {
      if (err) { res.writeHead(404); return res.end(); }
      if (route === 'pac-bryan/ui.js') bytes = bytes.toString().replace('sync(); requestAnimationFrame(frame);', hook + 'sync(); renderer.draw(game,0); if(!location.pathname.endsWith("/fixture")) requestAnimationFrame(frame);');
      res.setHeader('Content-Type', route.endsWith('.js') ? 'text/javascript' : route.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  fs.mkdirSync(path.join(root, '.test-artifacts'), { recursive: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
async function withPage(fn, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, ...options }), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try { await page.goto(base + 'fixture'); await fn(page, context); assert.deepEqual(errors, []); } finally { await context.close(); }
}
const start = async p => { await p.waitForLoadState('load'); await p.locator('#play').click(); await p.waitForFunction(() => !Arcade.busy); };
const advance = (p, n) => p.evaluate(n => pacTest.advance(n), n);
test('homepage promotes Pac-Bryan, filters five ready games, and opens the live game', () => withPage(async p => {
  await p.goto(base); assert.equal(await p.locator('#game-count').textContent(), '6 games · 5 ready'); await p.getByRole('button', { name: 'Ready to play' }).click();
  assert.equal(await p.locator('.card:visible').count(), 5); await p.getByRole('link', { name: 'Play Pac-Bryan' }).click(); assert.equal(await p.title(), 'Pac-Bryan · Tiger’s Arcade');
  await start(p); assert.equal(await p.evaluate(() => Arcade.balance()), 4); await p.waitForFunction(() => pacTest.game.phase === 'playing');
  for (let i = 0; i < 15 && !await p.evaluate(() => pacTest.game.score); i++) {
    const dir = await p.evaluate(() => pacTest.game.maze.path(pacTest.game.player, { x: 1, y: 1 })[0]?.dir);
    await p.keyboard.press({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]); await p.waitForTimeout(170);
  }
  assert(await p.evaluate(() => pacTest.game.score > 0));
  await p.screenshot({ path: path.join(root, '.test-artifacts/pac-bryan-desktop.png'), fullPage: true }); await p.locator('#pause').click();
}));
test('paid start, buffered keyboard movement, pause/resume and focus loss', () => withPage(async p => {
  await start(p); await advance(p, 2.1); await p.keyboard.press('ArrowRight'); await advance(p, .1);
  assert.equal(await p.evaluate(() => pacTest.game.wanted), 'right'); assert.equal(await p.evaluate(() => pacTest.game.player.dir), 'right');
  await p.keyboard.press('KeyP'); const before = await p.evaluate(() => JSON.stringify(pacTest.game.player)); await advance(p, 10);
  assert.equal(await p.evaluate(() => JSON.stringify(pacTest.game.player)), before); assert.equal(await p.locator('#panelTitle').textContent(), 'Saving your appetite?');
  await p.locator('#play').click(); assert.equal(await p.evaluate(() => Arcade.balance()), 4); assert.equal(await p.locator('#overlay').isHidden(), true);
  await p.evaluate(() => dispatchEvent(new Event('blur'))); assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused');
  await p.evaluate(() => dispatchEvent(new Event('focus'))); assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused');
}));
test('bonus life and fruit values are explained; level advance is free and generates new topology', () => withPage(async p => {
  await start(p); const seed = await p.evaluate(() => pacTest.game.maze.seed);
  assert.equal(await p.evaluate(() => pacTest.game.maze.loopCount), 81);
  assert.equal(await p.locator('.difficulty-note').textContent(), 'each maze is slightly harder than the previous');
  assert(await p.locator('.difficulty-note').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
  assert.equal(await p.locator('.ghost-row').count(), 4); assert.equal(await p.locator('.fruit').count(), 7); assert.match(await p.locator('#lifeText').textContent(), /10,000/);
  await p.evaluate(() => { pacTest.game.addScore(10000); pacTest.advance(.01); }); assert.equal(await p.locator('#lives').textContent(), '4'); assert.match(await p.locator('#lifeText').textContent(), /earned/);
  await p.evaluate(() => pacTest.clear()); await advance(p, 2.1); assert.equal(await p.locator('#level').textContent(), '02'); assert.notEqual(await p.evaluate(() => pacTest.game.maze.seed), seed); assert.equal(await p.evaluate(() => Arcade.balance()), 4);
  assert.equal(await p.evaluate(() => pacTest.game.maze.loopCount), 80);
}));
test('gameover saves once, name is text, leaderboard persists and high score stays visible', () => withPage(async p => {
  await start(p); await p.evaluate(() => pacTest.over(12340)); assert.equal(await p.locator('#nameForm').isVisible(), true); assert.equal(await p.locator('#best').textContent(), '012340');
  await p.locator('#scoreName').fill('<img onerror=1>'); await p.getByRole('button', { name: 'Save name' }).click(); await p.locator('#showScores').click();
  assert.equal(await p.locator('#scoreRows tr').count(), 1); assert.match(await p.locator('#scoreRows').textContent(), /<img onerror=1>/); assert.equal(await p.locator('#scoreRows img').count(), 0);
  await p.locator('#closeScores').click(); await advance(p, 10); assert.equal(await p.evaluate(() => pacTest.store.scores.length), 1);
  await p.reload(); assert.equal(await p.locator('#best').textContent(), '012340'); await p.locator('#showScores').click(); assert.equal(await p.locator('#scoreRows tr').count(), 1);
}));
test('leaderboard pauses a live game and respects an already paused game', () => withPage(async p => {
  await start(p); await advance(p, 2.1); await p.locator('#showScores').click(); assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused');
  await p.keyboard.press('Escape'); await p.waitForFunction(() => pacTest.game.phase === 'playing'); assert.equal(await p.evaluate(() => Arcade.balance()), 4);
  await p.locator('#pause').click(); await p.locator('#showScores').click(); await p.locator('#closeScores').click(); assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused');
}));
test('out of quarters blocks restart and links the free clicker', () => withPage(async p => {
  await p.evaluate(() => localStorage.setItem('tigerArcade.quarters.v1', '1')); await start(p); await p.evaluate(() => pacTest.over(100)); await p.locator('#play').click();
  await p.locator('.arcade-dialog').waitFor({ state: 'visible' }); assert.equal(await p.evaluate(() => Arcade.balance()), 0); assert.equal(await p.evaluate(() => pacTest.game.phase), 'gameover');
  assert.match(await p.locator('.arcade-get-quarters').getAttribute('href'), /quarters-please.html$/);
}));
test('losing focus with leaderboard open keeps the game paused after closing it', () => withPage(async p => {
  await start(p); await advance(p, 2.1); await p.locator('#showScores').click(); await p.evaluate(() => dispatchEvent(new Event('blur')));
  await p.locator('#closeScores').click(); await p.waitForFunction(() => document.getElementById('overlay').hidden === false);
  assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused'); await p.locator('#play').click(); assert.equal(await p.evaluate(() => Arcade.balance()), 4);
}));
test('touch direction and swiping feed the same steering system', () => withPage(async p => {
  await start(p); await advance(p, 2.1); await p.locator('[data-dir=up]').tap(); assert.equal(await p.evaluate(() => pacTest.game.wanted), 'up');
  const r = await p.locator('#canvas').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.mouse.move(r.x + r.width / 2 + 35, r.y + r.height / 2); await p.mouse.up();
  assert.equal(await p.evaluate(() => pacTest.game.wanted), 'right');
}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }));
test('standard gamepad steers, pauses and requires release after screen changes', () => withPage(async p => {
  await start(p); await advance(p, 2.1); await p.evaluate(() => { globalThis.pad = { connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }; Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true }); pacTest.focus(true); pacTest.pollGamepad(); pad.axes[0] = 1; pacTest.pollGamepad(); });
  assert.equal(await p.evaluate(() => pacTest.game.wanted), 'right'); await p.evaluate(() => { pad.axes[0] = 0; pad.buttons[9].pressed = true; pacTest.pollGamepad(); });
  assert.equal(await p.evaluate(() => pacTest.game.phase), 'paused'); await p.evaluate(() => { pad.buttons[9].pressed = false; pacTest.pollGamepad(); pad.buttons[0].pressed = true; pacTest.pollGamepad(); }); assert.equal(await p.evaluate(() => pacTest.game.phase), 'playing');
}));
test('blocked storage and malformed saves do not prevent games or session leaderboards', () => withPage(async p => {
  await p.context().addInitScript(() => { Storage.prototype.getItem = function () { throw Error('blocked'); }; Storage.prototype.setItem = function () { throw Error('blocked'); }; }); await p.reload();
  assert.equal(await p.locator('#storageNote').isVisible(), true); await start(p); await p.evaluate(() => pacTest.over(500)); await p.locator('#showScores').click(); assert.equal(await p.locator('#scoreRows tr').count(), 1);
}));
test('desktop, mobile, small phone and landscape layouts stay within viewport', () => withPage(async p => {
  await p.emulateMedia({ reducedMotion: 'reduce' });
  for (const [name, width, height] of [['desktop', 1365, 1000], ['mobile', 390, 844], ['small', 320, 640], ['landscape', 844, 390]]) {
    await p.setViewportSize({ width, height }); const r = await p.locator('#canvas').boundingBox(); assert(r.width > 150 && r.height > 150, name); assert(r.x >= 0 && r.x + r.width <= width, name);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name); await p.screenshot({ path: path.join(root, `.test-artifacts/pac-bryan-${name}-menu.png`), fullPage: true });
  }
}));
test('direct-file gameplay and homepage link resolve with all local assets', () => withPage(async p => {
  await p.goto(pathToFileURL(path.join(root, 'index.html')).href); const link = p.getByRole('link', { name: 'Play Pac-Bryan' }); assert.equal(await link.evaluate(a => a.href), pathToFileURL(path.join(root, 'pac-bryan.html')).href);
  await link.click(); await start(p); assert.equal(await p.locator('#overlay').isHidden(), true); await p.keyboard.press('KeyP'); assert.equal(await p.locator('#overlay').isVisible(), true);
  await p.getByRole('link', { name: 'Other Games', exact: true }).click(); assert.equal(p.url(), pathToFileURL(path.join(root, 'index.html')).href);
}));
