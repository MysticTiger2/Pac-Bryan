(function (root) {
  'use strict';
  const PB = root.PacBryan = root.PacBryan || {};
  class ScoreStore {
    constructor(storage, key = 'pacBryan.classic.v1') {
      this.storage = storage; this.key = key; this.available = !!storage; this.best = 0; this.scores = [];
      try {
        const value = JSON.parse(storage?.getItem(key) || '{}');
        const valid = n => Number.isSafeInteger(n) && n >= 0;
        this.scores = (Array.isArray(value.scores) ? value.scores : []).filter(s => s && valid(s.score) && valid(s.level) && typeof s.id === 'string')
          .map(s => ({ id: s.id, name: String(s.name || 'Anonymous').slice(0, 20), score: s.score, level: s.level, date: String(s.date || '') })).sort((a, b) => b.score - a.score).slice(0, 10);
        this.best = Math.max(valid(value.best) ? value.best : 0, ...this.scores.map(s => s.score));
      } catch { /* Malformed saves start fresh; writes will detect storage restrictions. */ }
      this.save();
    }
    save() { try { if (!this.storage) throw new Error('Storage unavailable'); this.storage.setItem(this.key, JSON.stringify({ best: this.best, scores: this.scores })); } catch { this.available = false; } }
    track(score) { if (score > this.best) { this.best = score; this.save(); } }
    record(score, level, name = 'Anonymous') {
      this.track(score); if (score <= 0 || (this.scores.length === 10 && score <= this.scores[9].score)) return null;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.scores.push({ id, name: name.trim().slice(0, 20) || 'Anonymous', score, level, date: new Date().toISOString().slice(0, 10) });
      this.scores.sort((a, b) => b.score - a.score); this.scores = this.scores.slice(0, 10); this.save(); return id;
    }
    rename(id, name) { const s = this.scores.find(s => s.id === id); if (s) { s.name = name.trim().slice(0, 20) || 'Anonymous'; this.save(); } }
  }
  PB.ScoreStore = ScoreStore;
  if (typeof module !== 'undefined') module.exports = PB;
})(globalThis);
