/* Plain scripts keep the game playable from file://. Core systems also export to Node. */
(function (root) {
  'use strict';
  const PB = root.PacBryan = root.PacBryan || {};
  PB.DIRS = Object.freeze({ up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, right: { x: 1, y: 0 } });
  PB.OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });
  PB.FRUITS = Object.freeze([
    { name: 'Cherry', icon: '🍒', points: 100 }, { name: 'Strawberry', icon: '🍓', points: 200 },
    { name: 'Orange', icon: '🍊', points: 500 }, { name: 'Pretzel', icon: '🥨', points: 700 },
    { name: 'Apple', icon: '🍎', points: 1000 }, { name: 'Pear', icon: '🍐', points: 2000 },
    { name: 'Banana', icon: '🍌', points: 5000 }
  ].map(Object.freeze));
  PB.GHOSTS = Object.freeze([
    { id: 'blinky', name: 'Blinky', color: '#ff686d', ai: 'direct', corner: [25, 1], release: 0,
      description: 'The pursuer. Targets your current tile; speeds up as dots run out.' },
    { id: 'pinky', name: 'Pinky', color: '#ffa3da', ai: 'ambush', corner: [1, 1], release: 1,
      description: 'The ambusher. Aims four tiles ahead of your direction of travel.' },
    { id: 'inky', name: 'Inky', color: '#66e0ed', ai: 'vector', corner: [25, 29], release: 5,
      description: 'The wildcard. Doubles the vector from Blinky to two tiles ahead of you.' },
    { id: 'sue', name: 'Sue', color: '#ffb46b', ai: 'shy', corner: [1, 29], release: 9,
      description: 'The shy one. Chases from a distance; retreats to her corner within eight tiles.' }
  ].map(Object.freeze));
  PB.CLASSIC = Object.freeze({
    id: 'classic', name: 'Classic', lives: 3, dotPoints: 10, powerPoints: 50,
    bonusLife: 10000, repeatBonusLife: 0, ghostPoints: [200, 400, 800, 1600],
    fruitThresholds: [70, 170], fruitSpeed: 3.2, playerSpeed: 6.8, ghostSpeed: 6.35,
    frightenedSpeed: 3.9, eyesSpeed: 12, readySeconds: 2, deathSeconds: 1.5, clearSeconds: 2,
    collisionRadius: 0.68, roster: PB.GHOSTS,
    // Level tables live here, independently of movement, AI and presentation.
    mazeOptions(level) { return { targetLoops: Math.max(1, 82 - level) }; },
    difficulty(level) {
      return { speed: 1 + Math.min(level - 1, 20) * .018,
        frightened: [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1][Math.min(level - 1, 17)],
        scatter: level < 5 ? 7 : 5, reversals: level < 5 ? [27, 54] : [25, 50] };
    },
    fruit(level, random) { return PB.FRUITS[level <= 7 ? level - 1 : Math.floor(random() * PB.FRUITS.length)]; }
  });
  PB.random = function (seed) {
    let state = seed >>> 0;
    return function () { let t = state = (state + 0x6D2B79F5) >>> 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  if (typeof module !== 'undefined') module.exports = PB;
})(globalThis);
