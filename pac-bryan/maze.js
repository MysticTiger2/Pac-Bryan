(function (root) {
  'use strict';
  const PB = typeof module !== 'undefined' ? require('./rules.js') : root.PacBryan;
  const key = (x, y) => y * 27 + x;
  class Maze {
    constructor(seed, { targetLoops = 81, loopMultiplier = null } = {}) {
      this.seed = seed >>> 0; this.width = 27; this.height = 31;
      this.targetLoops = targetLoops; this.loopMultiplier = loopMultiplier;
      this.cells = new Uint8Array(this.width * this.height);
      this.start = { x: 13, y: 23 }; this.exit = { x: 13, y: 11 }; this.home = { x: 13, y: 14 };
      this.tunnels = []; this.generate(PB.random(this.seed));
    }
    index(x, y) { return y * this.width + x; }
    get(x, y) { return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.cells[this.index(x, y)]; }
    set(x, y, value = 1) { this.cells[this.index(x, y)] = value; }
    walkable(x, y, house = false) { const v = this.get(x, y); return v === 1 || (house && v >= 2); }
    neighbor(x, y, dir, house = false) {
      const d = PB.DIRS[dir]; let nx = x + d.x, ny = y + d.y;
      if ((nx < 0 || nx >= this.width) && this.tunnels.includes(y)) nx = (nx + this.width) % this.width;
      return this.walkable(nx, ny, house) ? { x: nx, y: ny, dir } : null;
    }
    neighbors(x, y, house = false) { return Object.keys(PB.DIRS).map(d => this.neighbor(x, y, d, house)).filter(Boolean); }
    ghostSpawn(index) { return index ? { x: this.home.x - 2 + ((index - 1) % 3) * 2, y: this.home.y } : { ...this.exit }; }
    isTunnel(x, y) { return this.tunnels.includes(y) && (x < 4 || x > this.width - 5); }
    fruitRoute(random) {
      const row = this.tunnels[Math.floor(random() * this.tunnels.length)], side = random() < .5 ? 0 : this.width - 1;
      const entry = { x: side, y: row }, exit = { x: this.width - 1 - side, y: this.tunnels[Math.floor(random() * this.tunnels.length)] };
      const waypoints = [this.exit, { x: 17, y: 11 }, { x: 17, y: 17 }, { x: 9, y: 17 }, { x: 9, y: 11 }, this.exit, exit];
      let p = entry; const route = [];
      for (const end of waypoints) { route.push(...this.path(p, end)); p = end; }
      return { entry, route };
    }
    generate(random) {
      const reserved = (x, y) => x >= 10 && x <= 16 && y >= 12 && y <= 16;
      const stack = [{ x: 1, y: 1 }], seen = new Set([key(1, 1)]);
      this.set(1, 1);
      while (stack.length) {
        const p = stack[stack.length - 1];
        const choices = Object.values(PB.DIRS).map(d => ({ x: p.x + d.x * 2, y: p.y + d.y * 2 }))
          .filter(n => n.x > 0 && n.x < 26 && n.y > 0 && n.y < 30 && !reserved(n.x, n.y) && !reserved((p.x + n.x) / 2, (p.y + n.y) / 2) && !seen.has(key(n.x, n.y)));
        if (!choices.length) { stack.pop(); continue; }
        const n = choices[Math.floor(random() * choices.length)];
        this.set((p.x + n.x) / 2, (p.y + n.y) / 2); this.set(n.x, n.y); seen.add(key(n.x, n.y)); stack.push(n);
      }
      // Braid every dead end into a loop: classic maze chase needs escape routes.
      for (let y = 1; y < 30; y += 2) for (let x = 1; x < 26; x += 2) {
        if (!this.walkable(x, y)) continue;
        if (this.neighbors(x, y).length > 1 && random() > .11) continue;
        const choices = Object.values(PB.DIRS).map(d => ({ x: x + d.x * 2, y: y + d.y * 2 }))
          .filter(n => this.walkable(n.x, n.y) && !reserved((x + n.x) / 2, (y + n.y) / 2) && !this.get((x + n.x) / 2, (y + n.y) / 2));
        if (choices.length) { const n = choices[Math.floor(random() * choices.length)]; this.set((x + n.x) / 2, (y + n.y) / 2); }
      }
      // A fixed house is a topology contract, not a fixed maze layout.
      for (let x = 9; x <= 17; x++) { this.set(x, 11); this.set(x, 17); }
      for (let y = 11; y <= 17; y++) { this.set(9, y); this.set(17, y); }
      for (let y = 13; y <= 15; y++) for (let x = 11; x <= 15; x++) this.set(x, y, 2);
      this.set(13, 12, 3);
      for (let x = 11; x <= 15; x++) this.set(x, 23);
      this.tunnels = [random() < .5 ? 7 : 9, random() < .5 ? 21 : 23];
      for (const y of this.tunnels) for (let x = 0; x <= 3; x++) { this.set(x, y); this.set(26 - x, y); }
      // Count independent routes so difficulty does not depend on the maze seed.
      let floors = 0, edges = 0;
      const shortcuts = [];
      for (let y = 1; y < 30; y++) for (let x = 0; x < 27; x++) {
        if (this.walkable(x, y)) { floors++; edges += this.neighbors(x, y).length; continue; }
        if (x < 1 || x > 25 || reserved(x, y) || (x + y) % 2 !== 1) continue;
        const horizontal = this.get(x - 1, y) === 1 && this.get(x + 1, y) === 1 && !this.get(x, y - 1) && !this.get(x, y + 1);
        const vertical = this.get(x, y - 1) === 1 && this.get(x, y + 1) === 1 && !this.get(x - 1, y) && !this.get(x + 1, y);
        if (horizontal || vertical) shortcuts.push({ x, y });
      }
      const loops = edges / 2 - floors + 1;
      const target = Math.max(1, Math.round(this.loopMultiplier === null ? this.targetLoops : loops * this.loopMultiplier));
      const extra = Math.max(0, target - loops);
      for (let i = shortcuts.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shortcuts[i], shortcuts[j]] = [shortcuts[j], shortcuts[i]]; }
      const added = shortcuts.slice(0, extra);
      for (const p of added) this.set(p.x, p.y);
      this.loopCount = loops + added.length;
      if (this.loopCount > target) {
        const closures = [];
        for (let y = 1; y < 30; y++) for (let x = 1; x < 26; x++) {
          if ((x + y) % 2 !== 1 || this.get(x, y) !== 1) continue;
          if (y === this.start.y && x >= this.start.x - 2 && x <= this.start.x + 2) continue;
          if (this.tunnels.includes(y) && (x <= 3 || x >= 23)) continue;
          closures.push({ x, y });
        }
        for (let i = closures.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [closures[i], closures[j]] = [closures[j], closures[i]]; }
        // Prefer closing routes without creating dead ends. At low targets, allow
        // dead ends but never disconnect corridors, energizers, or the house exit.
        for (const preserveEscapes of [true, false]) for (const p of closures) {
          if (this.loopCount <= target) break;
          const neighbors = this.neighbors(p.x, p.y);
          if (this.get(p.x, p.y) !== 1 || neighbors.length !== 2) continue;
          if (preserveEscapes && neighbors.some(n => this.neighbors(n.x, n.y).length < 3)) continue;
          this.set(p.x, p.y, 0);
          if (!this.path(neighbors[0], neighbors[1]).length) { this.set(p.x, p.y); continue; }
          this.loopCount--;
        }
      }
      this.pellets = new Uint8Array(this.cells.length);
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === 1) this.pellets[i] = 1;
      for (const [x, y] of [[1, 3], [25, 3], [1, 27], [25, 27]]) this.pellets[this.index(x, y)] = 2;
      for (let x = 11; x <= 15; x++) this.pellets[this.index(x, 23)] = 0;
      this.pellets[this.index(13, 11)] = 0;
      this.total = this.pellets.reduce((n, v) => n + !!v, 0);
    }
    path(from, to, house = false) {
      const start = this.index(from.x, from.y), goal = this.index(to.x, to.y), queue = [from], previous = new Map([[start, null]]);
      for (let i = 0; i < queue.length && !previous.has(goal); i++) {
        const p = queue[i];
        for (const n of this.neighbors(p.x, p.y, house)) { const k = this.index(n.x, n.y); if (!previous.has(k)) { previous.set(k, p); queue.push(n); } }
      }
      if (!previous.has(goal)) return [];
      const result = []; let p = { ...to };
      while (this.index(p.x, p.y) !== start) { const prev = previous.get(this.index(p.x, p.y)); const step = this.neighbors(prev.x, prev.y, house).find(n => n.x === p.x && n.y === p.y); result.push(step); p = prev; }
      return result.reverse();
    }
  }
  PB.Maze = Maze;
  if (typeof module !== 'undefined') module.exports = PB;
})(globalThis);
