(function (root) {
  'use strict';
  const PB = typeof module !== 'undefined' ? require('./ai.js') : root.PacBryan;
  const actor = (x, y, extra = {}) => ({ x, y, dir: 'left', target: null, progress: 0, ...extra });
  PB.position = function (a) { const d = PB.DIRS[a.dir]; return { x: a.x + (a.target ? d.x * a.progress : 0), y: a.y + (a.target ? d.y * a.progress : 0) }; };
  class Engine {
    constructor(options = {}) {
      this.rules = { ...PB.CLASSIC, ...options.rules };
      this.strategies = { ...PB.strategies, ...options.strategies };
      this.mazeFactory = options.mazeFactory || ((seed, mazeOptions) => new PB.Maze(seed, mazeOptions));
      this.progression = options.progression || (game => { game.level++; game.loadLevel(); });
      this.random = options.random || PB.random(options.seed ?? (Date.now() ^ Math.random() * 0xffffffff));
      this.score = 0; this.lives = this.rules.lives; this.level = 1; this.nextLife = this.rules.bonusLife || null;
      this.events = []; this.phase = 'ready'; this.pausedPhase = null; this.loadLevel();
    }
    emit(type, details = {}) { this.events.push({ type, ...details }); }
    loadLevel() {
      let seed = Math.floor(this.random() * 0x100000000) >>> 0;
      if (this.maze && seed === this.maze.seed) seed = (seed + 1) >>> 0;
      this.maze = this.mazeFactory(seed, this.rules.mazeOptions(this.level)); this.difficulty = this.rules.difficulty(this.level);
      this.remaining = this.maze.total; this.eaten = 0; this.fruit = null; this.fruitTriggered = new Set(); this.fruitQueue = [];
      this.resetActors(); this.emit('level', { level: this.level });
    }
    resetActors() {
      this.player = actor(this.maze.start.x, this.maze.start.y); this.wanted = 'left';
      this.ghosts = this.rules.roster.map((spec, i) => {
        const spawn = this.maze.ghostSpawn(i);
        return actor(spawn.x, spawn.y, { ...spec, state: i ? 'house' : 'active', releaseAt: spec.release ?? i * 3, frightened: false, reverse: false });
      });
      this.mode = 'scatter'; this.modeTime = 0; this.reverseIndex = 0; this.frightened = 0; this.combo = 0;
      this.phase = 'ready'; this.timer = this.rules.readySeconds; this.fruit = null; this.fruitQueue = [];
    }
    steer(dir) {
      if (!PB.DIRS[dir] || this.phase === 'paused') return;
      this.wanted = dir;
      // Reversals are immediate, including between centers. Other turns stay buffered.
      const p = this.player;
      if (p.target && dir === PB.OPPOSITE[p.dir]) {
        const old = { x: p.x, y: p.y, dir }; p.x = p.target.x; p.y = p.target.y;
        p.target = old; p.dir = dir; p.progress = 1 - p.progress;
      }
    }
    pause() {
      if (this.phase === 'paused') { this.phase = this.pausedPhase; this.pausedPhase = null; return; }
      if (this.phase === 'gameover') return;
      this.pausedPhase = this.phase; this.phase = 'paused';
    }
    addScore(points, at) {
      this.score += points; this.emit('score', { points, at });
      while (this.nextLife !== null && this.score >= this.nextLife) {
        this.lives++; this.emit('life'); this.nextLife = this.rules.repeatBonusLife ? this.nextLife + this.rules.repeatBonusLife : null;
      }
    }
    power() {
      this.frightened = this.difficulty.frightened; this.combo = 0;
      for (const g of this.ghosts) if (g.state !== 'eyes') { g.frightened = this.frightened > 0; if (g.state === 'active') g.reverse = true; }
      this.emit('power');
    }
    eatPellet() {
      const p = this.player, k = this.maze.index(p.x, p.y), pellet = this.maze.pellets[k];
      if (!pellet) return;
      this.maze.pellets[k] = 0; this.remaining--; this.eaten++;
      this.addScore(pellet === 2 ? this.rules.powerPoints : this.rules.dotPoints);
      this.emit(pellet === 2 ? 'energizer' : 'dot'); if (pellet === 2) this.power();
      for (const threshold of this.rules.fruitThresholds) if (this.eaten >= threshold && !this.fruitTriggered.has(threshold)) {
        this.fruitTriggered.add(threshold); this.fruitQueue.push(this.rules.fruit(this.level, this.random));
      }
      if (!this.remaining) { this.phase = 'clearing'; this.timer = this.rules.clearSeconds; this.emit('clear'); }
    }
    spawnFruit() {
      if (this.fruit || !this.fruitQueue.length) return;
      const { entry, route } = this.maze.fruitRoute(this.random);
      this.fruit = actor(entry.x, entry.y, { ...this.fruitQueue.shift(), route }); this.emit('fruit', { name: this.fruit.name, points: this.fruit.points });
    }
    move(a, speed, dt, choose, onArrival = () => {}) {
      let travel = speed * dt;
      while (travel > 0 && this.phase === 'playing') {
        if (!a.target) { a.target = choose(a); if (!a.target) break; a.dir = a.target.dir; a.progress = 0; }
        const step = Math.min(1 - a.progress, travel); a.progress += step; travel -= step;
        if (a.progress >= 1 - 1e-9) { a.x = a.target.x; a.y = a.target.y; a.target = null; a.progress = 0; onArrival(a); }
      }
    }
    collide(a, b) {
      const p = PB.position(a), q = PB.position(b); let dx = Math.abs(p.x - q.x);
      if (this.maze.tunnels.includes(a.y) && a.y === b.y) dx = Math.min(dx, this.maze.width - dx);
      return Math.hypot(dx, p.y - q.y) < this.rules.collisionRadius;
    }
    collisions() {
      if (this.phase !== 'playing') return;
      if (this.fruit && this.collide(this.player, this.fruit)) { this.addScore(this.fruit.points, PB.position(this.fruit)); this.emit('fruitEaten'); this.fruit = null; }
      for (const g of this.ghosts) {
        if (g.state !== 'active' || !this.collide(this.player, g)) continue;
        if (g.frightened) {
          const points = this.rules.ghostPoints[Math.min(this.combo++, this.rules.ghostPoints.length - 1)];
          this.addScore(points, PB.position(g)); g.state = 'eyes'; g.frightened = false; g.reverse = false;
          this.phase = 'ghostPause'; this.timer = .7; this.emit('ghostEaten', { name: g.name, points });
          break;
        }
        this.lives--; this.phase = 'dying'; this.timer = this.rules.deathSeconds; this.emit('death'); break;
      }
    }
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || !['ready', 'playing', 'ghostPause', 'dying', 'clearing'].includes(this.phase)) return;
      // Bound integration even when driven by a different host or game mode.
      if (dt > 1 / 120 + 1e-9) { let left = dt; while (left > 1e-9) { const step = Math.min(left, 1 / 120); this.update(step); left -= step; } return; }
      if (this.phase !== 'playing') {
        this.timer -= dt; if (this.timer > 0) return;
        if (this.phase === 'dying') {
          if (this.lives <= 0) { this.phase = 'gameover'; this.emit('gameover', { score: this.score, level: this.level }); }
          else { this.resetActors(); this.emit('respawn'); }
        } else if (this.phase === 'clearing') this.progression(this);
        else this.phase = 'playing';
        return;
      }
      if (this.frightened > 0) {
        this.frightened = Math.max(0, this.frightened - dt);
        if (!this.frightened) for (const g of this.ghosts) g.frightened = false;
      } else {
        this.modeTime += dt;
        if (this.mode === 'scatter' && this.modeTime >= this.difficulty.scatter) {
          this.mode = 'chase'; for (const g of this.ghosts) if (g.state === 'active') g.reverse = true;
        }
        if (this.modeTime >= this.difficulty.reversals[this.reverseIndex]) {
          this.reverseIndex++; for (const g of this.ghosts) if (g.state === 'active') g.reverse = true;
        }
      }
      this.eatPellet(); if (this.phase !== 'playing') return;
      const speed = this.rules.playerSpeed * this.difficulty.speed * (this.frightened ? 1.08 : 1);
      this.move(this.player, speed, dt, p => this.maze.neighbor(p.x, p.y, this.wanted) || this.maze.neighbor(p.x, p.y, p.dir), () => this.eatPellet());
      if (this.phase !== 'playing') return;
      this.spawnFruit();
      for (const g of this.ghosts) {
        if (g.state === 'house') { g.releaseAt -= dt; if (g.releaseAt <= 0) g.state = 'exiting'; else continue; }
        if (g.state === 'eyes' && !g.target && g.x === this.maze.home.x && g.y === this.maze.home.y) { g.state = 'house'; g.releaseAt = 1; continue; }
        if (g.state === 'exiting' && !g.target && g.x === this.maze.exit.x && g.y === this.maze.exit.y) g.state = 'active';
        const tunnel = this.maze.isTunnel(g.x, g.y) && this.level <= 3;
        const elroy = g.id === 'blinky' && this.remaining < 20 ? 1.12 : g.id === 'blinky' && this.remaining < 40 ? 1.06 : 1;
        const gs = g.state === 'eyes' ? this.rules.eyesSpeed : g.frightened ? this.rules.frightenedSpeed : this.rules.ghostSpeed * this.difficulty.speed * elroy * (tunnel ? .6 : 1);
        this.move(g, gs, dt, () => PB.chooseGhost(g, this));
      }
      if (this.fruit) {
        this.move(this.fruit, this.rules.fruitSpeed, dt, f => f.route.shift() || null);
        if (!this.fruit.target && !this.fruit.route.length) this.fruit = null;
      }
      this.collisions();
    }
  }
  PB.Engine = Engine;
  if (typeof module !== 'undefined') module.exports = PB;
})(globalThis);
