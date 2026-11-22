(function (root) {
  'use strict';
  const PB = typeof module !== 'undefined' ? require('./maze.js') : root.PacBryan;
  const ahead = (p, n) => ({ x: p.x + PB.DIRS[p.dir].x * n, y: p.y + PB.DIRS[p.dir].y * n });
  const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  // Strategies return target tiles. New personalities need no movement/render changes.
  PB.strategies = {
    direct: (g, game) => game.player,
    ambush: (g, game) => ahead(game.player, 4),
    vector(g, game) { const p = ahead(game.player, 2), red = game.ghosts.find(a => a.id === 'blinky') || g; return { x: p.x * 2 - red.x, y: p.y * 2 - red.y }; },
    shy: (g, game) => distance(g, game.player) >= 64 ? game.player : { x: g.corner[0], y: g.corner[1] }
  };
  PB.chooseGhost = function (g, game) {
    const maze = game.maze;
    if (g.state === 'eyes' || g.state === 'exiting') {
      return maze.path(g, g.state === 'eyes' ? maze.home : maze.exit, true)[0] || null;
    }
    let choices = maze.neighbors(g.x, g.y);
    if (g.reverse) { g.reverse = false; const n = choices.find(n => n.dir === PB.OPPOSITE[g.dir]); if (n) return n; }
    const forward = choices.filter(n => n.dir !== PB.OPPOSITE[g.dir]); if (forward.length) choices = forward;
    const scatter = game.mode === 'scatter';
    if (g.frightened || (scatter && (g.id === 'blinky' || g.id === 'pinky'))) return choices[Math.floor(game.random() * choices.length)] || null;
    const target = scatter ? { x: g.corner[0], y: g.corner[1] } : (game.strategies[g.ai] || PB.strategies.direct)(g, game);
    return choices.sort((a, b) => distance(a, target) - distance(b, target))[0] || null;
  };
  if (typeof module !== 'undefined') module.exports = PB;
})(globalThis);
