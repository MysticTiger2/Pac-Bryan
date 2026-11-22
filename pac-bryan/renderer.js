(function (root) {
  'use strict';
  const PB = root.PacBryan;
  class Renderer {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.tile = 24; this.labels = []; this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; }
    cache(game) {
      this.maze = game.maze; const maze = this.maze, t = this.tile;
      this.background = document.createElement('canvas'); this.background.width = this.canvas.width; this.background.height = this.canvas.height;
      const c = this.background.getContext('2d'); c.fillStyle = '#080d18'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const colors = ['#657ee0', '#ce799f', '#65b9bd', '#cc9264'], line = colors[(game.level - 1) % colors.length];
      c.lineWidth = 1.7; c.strokeStyle = line; c.fillStyle = '#141e38';
      for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
        if (maze.get(x, y)) continue;
        c.fillRect(x * t, y * t, t, t);
        c.beginPath();
        if (maze.get(x, y - 1)) { c.moveTo(x * t, y * t + 3); c.lineTo((x + 1) * t, y * t + 3); }
        if (maze.get(x, y + 1)) { c.moveTo(x * t, (y + 1) * t - 3); c.lineTo((x + 1) * t, (y + 1) * t - 3); }
        if (maze.get(x - 1, y)) { c.moveTo(x * t + 3, y * t); c.lineTo(x * t + 3, (y + 1) * t); }
        if (maze.get(x + 1, y)) { c.moveTo((x + 1) * t - 3, y * t); c.lineTo((x + 1) * t - 3, (y + 1) * t); }
        c.stroke();
      }
      c.strokeStyle = '#ffa8d6'; c.lineWidth = 3; c.beginPath(); c.moveTo(13 * t, 12.5 * t); c.lineTo(14 * t, 12.5 * t); c.stroke();
    }
    copies(a, draw) {
      const p = PB.position(a), t = this.tile;
      draw((p.x + .5) * t, (p.y + .5) * t);
      if (p.x < .5) draw((p.x + this.maze.width + .5) * t, (p.y + .5) * t);
      if (p.x > this.maze.width - 1.5) draw((p.x - this.maze.width + .5) * t, (p.y + .5) * t);
    }
    ghost(g, game, now) {
      const c = this.ctx;
      this.copies(g, (x, y) => {
        c.save(); c.translate(x, y); const eyes = g.state === 'eyes';
        const blue = g.frightened && !eyes, flash = blue && game.frightened < 2 && Math.floor(now * 7) % 2;
        if (!eyes) {
          c.fillStyle = blue ? flash ? '#f1f2e4' : '#485ce1' : g.color;
          c.beginPath(); c.arc(0, -1, 10, Math.PI, 0); c.lineTo(10, 10);
          const foot = this.reduced ? 0 : Math.floor(now * 9) % 2 * 2;
          for (let i = 0; i < 4; i++) { c.lineTo(7 - i * 5, 7 + (i % 2 ? foot : 2 - foot)); c.lineTo(5 - i * 5, 10); }
          c.lineTo(-10, -1); c.fill();
        }
        if (blue) {
          c.fillStyle = flash ? '#d4445a' : '#fff2c5'; c.fillRect(-5, -3, 3, 3); c.fillRect(3, -3, 3, 3);
          c.strokeStyle = c.fillStyle; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-6, 5); for (let i = 0; i < 5; i++) c.lineTo(-6 + i * 3, 5 + (i % 2 ? 2 : 0)); c.stroke();
        } else {
          const d = PB.DIRS[g.dir];
          for (const ex of [-4.5, 4.5]) { c.fillStyle = '#faf8ed'; c.beginPath(); c.ellipse(ex, -2, 4, 5, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#264ca4'; c.beginPath(); c.arc(ex + d.x * 1.7, -2 + d.y * 2, 2.1, 0, Math.PI * 2); c.fill(); }
        }
        c.restore();
      });
    }
    draw(game, now) {
      if (game.maze !== this.maze) this.cache(game);
      const c = this.ctx, t = this.tile, maze = game.maze; c.drawImage(this.background, 0, 0);
      if (game.phase === 'clearing' && !this.reduced && Math.floor(now * 6) % 2) { c.fillStyle = '#ddd3f030'; c.fillRect(0, 0, this.canvas.width, this.canvas.height); }
      for (let y = 0; y < maze.height; y++) for (let x = 0; x < maze.width; x++) {
        const v = maze.pellets[maze.index(x, y)]; if (!v) continue;
        c.fillStyle = v === 2 ? '#f5dfa4' : '#dfc8b5'; c.beginPath(); c.arc((x + .5) * t, (y + .5) * t, v === 2 ? (this.reduced ? 6 : 5.5 + Math.sin(now * 6) * .8) : 2, 0, Math.PI * 2); c.fill();
      }
      if (game.fruit) this.copies(game.fruit, (x, y) => { c.font = '23px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(game.fruit.icon, x, y + (this.reduced ? 0 : Math.abs(Math.sin(now * 8)) * -4)); });
      for (const g of game.ghosts) this.ghost(g, game, now);
      this.copies(game.player, (x, y) => {
        c.save(); c.translate(x, y); c.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[game.player.dir]);
        if (game.phase === 'dying') { c.rotate((1 - game.timer / game.rules.deathSeconds) * Math.PI * 5); c.globalAlpha = Math.max(.05, game.timer / game.rules.deathSeconds); }
        const mouth = .13 + (this.reduced ? .2 : (Math.sin(now * 23) + 1) * .23);
        c.fillStyle = '#ffe070'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 10.5, mouth, Math.PI * 2 - mouth); c.closePath(); c.fill();
        c.fillStyle = '#16212b'; c.beginPath(); c.arc(1, -5, 1.7, 0, Math.PI * 2); c.fill();
        // A little pink bow nods to the game that inspired this one.
        c.fillStyle = '#f18bb5'; c.beginPath(); c.moveTo(-5, -9); c.lineTo(-10, -14); c.lineTo(-11, -6); c.closePath(); c.fill(); c.beginPath(); c.moveTo(-5, -9); c.lineTo(0, -14); c.lineTo(2, -7); c.closePath(); c.fill(); c.restore();
      });
      if (game.phase === 'ready') {
        c.fillStyle = '#080d18e8'; c.fillRect(10 * t, 17.7 * t, 7 * t, 1.6 * t);
        c.fillStyle = '#ffe070'; c.font = 'bold 20px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('READY!', 13.5 * t, 18.5 * t);
      }
      this.labels = this.labels.filter(a => now - a.time < 1.3);
      for (const a of this.labels) { c.fillStyle = '#e5f7b5'; c.font = 'bold 16px Consolas, monospace'; c.textAlign = 'center'; c.fillText(a.text, (a.at.x + .5) * t, (a.at.y + .5) * t - 10 - (this.reduced ? 0 : (now - a.time) * 12)); }
    }
  }
  PB.Renderer = Renderer;
})(globalThis);
