const { test } = require('node:test');
const assert = require('node:assert/strict');
const PB = require('../pac-bryan/engine.js');
require('../pac-bryan/storage.js');
function playing(rules = {}) { const g = new PB.Engine({ seed: 42, rules }); g.phase = 'playing'; return g; }
function quiet(g) { g.ghosts = []; return g; }
const put = (a, x, y, dir = 'left') => Object.assign(a, { x, y, dir, target: null, progress: 0 });
const loopCount = m => {
  let floors = 0, edges = 0;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.walkable(x, y)) { floors++; edges += m.neighbors(x, y).length; }
  return edges / 2 - floors + 1;
};

test('1,000 seeded mazes: every pellet reachable, no dead ends, protected house, four energizers, reciprocal tunnels', () => {
  const unique = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const m = new PB.Maze(seed), queue = [m.start], seen = new Set([m.index(m.start.x, m.start.y)]);
    for (let i = 0; i < queue.length; i++) for (const n of m.neighbors(queue[i].x, queue[i].y)) { const k = m.index(n.x, n.y); if (!seen.has(k)) { seen.add(k); queue.push(n); } }
    assert.equal(seen.size, [...m.cells].filter(v => v === 1).length, `seed ${seed}`);
    for (let k = 0; k < m.pellets.length; k++) if (m.pellets[k]) assert(seen.has(k));
    assert(queue.every(p => m.neighbors(p.x, p.y).length >= 2));
    assert.equal([...m.pellets].filter(v => v === 2).length, 4);
    assert.equal(loopCount(m), 81); assert.equal(m.loopCount, 81);
    assert.equal(m.neighbor(13, 11, 'down'), null); assert(m.neighbor(13, 11, 'down', true));
    for (const y of m.tunnels) { assert.equal(m.neighbor(0, y, 'left').x, 26); assert.equal(m.neighbor(26, y, 'right').x, 0); }
    assert(m.path(m.exit, m.home, true).length); unique.add(m.cells.join(''));
  }
  assert.equal(unique.size, 1000);
});
test('seeds reproduce topology and engine simulation', () => {
  const a = playing(), b = playing(); for (let i = 0; i < 1200; i++) { a.update(1 / 120); b.update(1 / 120); }
  assert.deepEqual(a.maze.cells, b.maze.cells); assert.deepEqual(a.player, b.player); assert.deepEqual(a.ghosts, b.ghosts); assert.equal(a.score, b.score);
});
test('every cleared level removes exactly one loop, with a safe floor of one', () => {
  const g = playing();
  for (let level = 1; level <= 85; level++) {
    assert.equal(g.level, level); assert.equal(loopCount(g.maze), Math.max(1, 82 - level));
    const seed = g.maze.seed; g.phase = 'clearing'; g.timer = .001; g.update(.01); assert.notEqual(g.maze.seed, seed);
  }
});
test('exact loop targets retain reachable pellets, house access and tunnels across varied seeds', () => {
  for (let seed = 0; seed < 100; seed++) for (const targetLoops of [81, 80, 79, 60, 40, 20, 10, 1]) {
    const m = new PB.Maze(seed, { targetLoops }), seen = new Set([m.index(m.start.x, m.start.y)]), queue = [m.start];
    for (let i = 0; i < queue.length; i++) for (const n of m.neighbors(queue[i].x, queue[i].y)) { const k = m.index(n.x, n.y); if (!seen.has(k)) { seen.add(k); queue.push(n); } }
    assert.equal(loopCount(m), targetLoops, `seed ${seed}, target ${targetLoops}`);
    assert.equal(seen.size, [...m.cells].filter(v => v === 1).length);
    for (let k = 0; k < m.pellets.length; k++) if (m.pellets[k]) assert(seen.has(k));
    assert.equal([...m.pellets].filter(v => v === 2).length, 4); assert(m.path(m.exit, m.home, true).length);
    for (const y of m.tunnels) assert.equal(m.neighbor(0, y, 'left').x, 26);
    assert(m.fruitRoute(PB.random(seed)).route.length > 0);
  }
});
test('buffered turns wait for a legal junction; immediate reverse preserves physical position', () => {
  const g = quiet(playing()); put(g.player, 13, 23, 'right'); g.wanted = 'right'; g.update(.05);
  const before = PB.position(g.player); assert(g.player.target); g.steer('left');
  assert.deepEqual(PB.position(g.player), before); assert.equal(g.player.dir, 'left');
  g.steer('up'); g.update(.05); assert.equal(g.wanted, 'up'); assert(g.maze.walkable(g.player.x, g.player.y));
});
test('wall collisions stop at cell centers and tunnels wrap continuously', () => {
  const g = quiet(playing()); put(g.player, 1, 1, 'up'); g.wanted = 'up'; g.update(.5); assert.equal(g.player.y, 1); assert.equal(g.player.target, null);
  const y = g.maze.tunnels[0]; put(g.player, 0, y, 'left'); g.wanted = 'left'; g.update(.16); assert.equal(g.player.x, 26); assert.equal(g.player.y, y);
});
test('dots, power pellets, scoring, and one 10,000-point bonus life', () => {
  const g = playing(), k = g.maze.index(1, 3); put(g.player, 1, 3); const dots = g.remaining;
  g.eatPellet(); assert.equal(g.score, 50); assert.equal(g.remaining, dots - 1); assert.equal(g.frightened, 6); assert(g.ghosts.every(a => a.frightened));
  g.eatPellet(); assert.equal(g.score, 50); g.addScore(9950); assert.equal(g.lives, 4); assert.equal(g.nextLife, null);
  g.addScore(30000); assert.equal(g.lives, 4); assert.equal(g.maze.pellets[k], 0);
});
test('four frightened ghost combo awards 200/400/800/1600 and returns eyes to the house', () => {
  const g = playing(); g.power(); let total = 0;
  for (const [i, ghost] of g.ghosts.entries()) { g.phase = 'playing'; for (const other of g.ghosts) other.state = 'house'; ghost.state = 'active'; ghost.frightened = true; put(ghost, g.player.x, g.player.y); g.collisions(); total += [200, 400, 800, 1600][i]; assert.equal(g.score, total); assert.equal(ghost.state, 'eyes'); }
  const ghost = g.ghosts[0]; put(ghost, 13, 11); g.phase = 'playing'; g.player.x = 1; g.player.y = 1; g.wanted = 'up';
  for (let i = 0; i < 1000 && ghost.state === 'eyes'; i++) g.update(1 / 120);
  assert.equal(ghost.state, 'house'); assert.equal(ghost.frightened, false);
});
test('fright expiry restores danger; zero-duration energizers still reverse ghosts', () => {
  const g = playing(); g.power(); g.frightened = .001; g.update(1 / 120); assert(g.ghosts.every(a => !a.frightened));
  g.difficulty.frightened = 0; g.power(); assert.equal(g.frightened, 0); assert.equal(g.ghosts[0].reverse, true); assert.equal(g.ghosts[0].frightened, false);
});
test('death retains dots, respawns actors, and emits gameover once at the last life', () => {
  const g = playing(); const ghost = g.ghosts[0]; put(ghost, g.player.x, g.player.y); g.eatPellet(); const pellets = g.maze.pellets.slice(), seed = g.maze.seed;
  g.collisions(); assert.equal(g.lives, 2); g.update(1.6); assert.equal(g.phase, 'ready'); assert.equal(g.maze.seed, seed); assert.deepEqual(g.maze.pellets, pellets);
  g.phase = 'playing'; g.lives = 1; put(g.ghosts[0], g.player.x, g.player.y); g.collisions(); g.update(2); assert.equal(g.phase, 'gameover'); g.update(20);
  assert.equal(g.events.filter(e => e.type === 'gameover').length, 1);
});
test('clearing a screen creates a fresh maze and preserves score and lives', () => {
  const g = quiet(playing()); const seed = g.maze.seed; g.maze.pellets.fill(0); g.maze.pellets[g.maze.index(g.player.x, g.player.y)] = 1; g.remaining = 1;
  g.eatPellet(); assert.equal(g.phase, 'clearing'); g.update(2.1); assert.equal(g.level, 2); assert.notEqual(g.maze.seed, seed); assert.equal(g.score, 10); assert.equal(g.lives, 3); assert.equal(g.ghosts.length, 4);
});
test('a whole generated maze can be eaten through real movement without stranding a pellet', () => {
  const g = quiet(playing()); let points = 0;
  for (const v of g.maze.pellets) points += v === 2 ? 50 : v ? 10 : 0;
  for (let k = 0; k < g.maze.pellets.length && g.phase === 'playing'; k++) {
    if (!g.maze.pellets[k]) continue;
    const target = { x: k % g.maze.width, y: Math.floor(k / g.maze.width) };
    for (const step of g.maze.path(g.player, target)) g.move(g.player, 1, 1, p => g.maze.neighbor(p.x, p.y, step.dir), () => g.eatPellet());
  }
  assert.equal(g.phase, 'clearing'); assert.equal(g.remaining, 0); assert.equal(g.score, points);
});
test('alternate progression can insert a mode-specific upgrade step without changing movement', () => {
  const g = new PB.Engine({ seed: 5, progression: game => { game.phase = 'upgrade'; game.emit('upgrade'); } });
  g.phase = 'clearing'; g.timer = .01; g.update(.02); assert.equal(g.phase, 'upgrade'); assert.equal(g.level, 1); assert(g.events.some(e => e.type === 'upgrade'));
});
test('pause freezes transitions, fruit, ghost timers and motion', () => {
  const g = playing(); g.update(.25); g.pause(); const snapshot = JSON.stringify(g); g.update(5); assert.equal(JSON.stringify(g), snapshot); g.pause(); assert.equal(g.phase, 'playing');
});
test('target strategies implement direct, four-ahead, vector and distance retreat', () => {
  const g = playing(); put(g.player, 10, 10, 'right'); put(g.ghosts[0], 3, 4);
  assert.equal(PB.strategies.direct({}, g), g.player); assert.deepEqual(PB.strategies.ambush({}, g), { x: 14, y: 10 });
  assert.deepEqual(PB.strategies.vector({}, g), { x: 21, y: 16 });
  const sue = g.ghosts[3]; put(sue, 10, 11); assert.deepEqual(PB.strategies.shy(sue, g), { x: 1, y: 29 }); put(sue, 25, 29); assert.equal(PB.strategies.shy(sue, g), g.player);
});
test('opening scatter ends in sustained chase and frightened time suspends mode timer', () => {
  const g = playing({ ghostSpeed: 0, playerSpeed: 0 }); g.update(7.1); assert.equal(g.mode, 'chase'); g.power(); const clock = g.modeTime; g.update(2); assert.equal(g.modeTime, clock); g.frightened = 0; g.update(60); assert.equal(g.mode, 'chase'); assert.equal(g.reverseIndex, 2);
});
test('two fruit thresholds fire once, fruit moves on valid corridors and eventually exits', () => {
  const g = quiet(playing({ playerSpeed: 0 })); g.eaten = 69; put(g.player, 1, 1); g.eatPellet(); g.spawnFruit();
  assert.equal(g.fruit.name, 'Cherry'); assert.equal(g.fruit.points, 100); const first = PB.position(g.fruit); put(g.player, 13, 23); g.update(.2); assert.notDeepEqual(PB.position(g.fruit), first);
  for (const p of g.fruit.route) assert(g.maze.walkable(p.x, p.y)); g.fruit = null; g.eaten = 169; put(g.player, 3, 1); g.eatPellet(); g.spawnFruit(); assert(g.fruit); assert.equal(g.fruitTriggered.size, 2);
  put(g.player, 13, 23); g.update(200); assert.equal(g.fruit, null); assert.equal(g.fruitQueue.length, 0);
});
test('fruit awards its advertised value and disappears on collision', () => {
  const g = quiet(playing()); g.fruit = { ...g.player, points: 5000 }; g.collisions(); assert.equal(g.score, 5000); assert.equal(g.fruit, null);
  assert.deepEqual(PB.FRUITS.map(f => f.points), [100, 200, 500, 700, 1000, 2000, 5000]);
  const random = PB.random(8), choices = new Set(Array.from({ length: 100 }, () => PB.CLASSIC.fruit(8, random).name)); assert.equal(choices.size, 7);
});
test('custom roster, targeting registry, life policy and maze factory are independent extension points', () => {
  let called = 0; const g = new PB.Engine({ seed: 1, mazeFactory: s => { called++; return new PB.Maze(s); }, rules: { bonusLife: 100, repeatBonusLife: 100, roster: [...PB.GHOSTS, { ...PB.GHOSTS[0], id: 'extra', ai: 'custom' }] }, strategies: { custom: () => ({ x: 1, y: 1 }) } });
  assert.equal(g.ghosts.length, 5); assert.equal(called, 1); assert.deepEqual(g.strategies.custom(), { x: 1, y: 1 }); g.addScore(300); assert.equal(g.lives, 6); assert.equal(g.nextLife, 400);
});
test('leaderboard ranks only completed scores, limits to ten, renames and survives reload', () => {
  const map = new Map(), storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) }, s = new PB.ScoreStore(storage);
  s.track(9999); assert.equal(s.scores.length, 0); for (let i = 1; i <= 12; i++) s.record(i * 100, 1);
  assert.equal(s.scores.length, 10); assert.equal(s.scores[0].score, 1200); assert.equal(s.scores[9].score, 300); assert.equal(s.record(200, 1), null);
  const id = s.scores[0].id; s.rename(id, '  Bryan  '); const loaded = new PB.ScoreStore(storage); assert.equal(loaded.scores[0].name, 'Bryan'); assert.equal(loaded.best, 9999);
});
test('malformed and blocked storage stay playable with session scores', () => {
  const s = new PB.ScoreStore({ getItem: () => '{broken', setItem: () => { throw Error('blocked'); } }); s.track(500); s.record(500, 2, '<script>');
  assert.equal(s.available, false); assert.equal(s.best, 500); assert.equal(s.scores[0].name, '<script>');
  const invalid = new PB.ScoreStore({ getItem: () => JSON.stringify({ best: -1, scores: [{ score: Infinity }, null, { id: 'a', score: 300, level: 1, name: 'x' }] }), setItem() {} }); assert.equal(invalid.best, 300); assert.equal(invalid.scores.length, 1);
});
