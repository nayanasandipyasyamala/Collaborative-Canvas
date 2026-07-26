/**
 * drawing-state.js — the server's copy of "what's on the canvas".
 *
 * WHY THE SERVER KEEPS ITS OWN COPY (not just relaying blindly):
 * When a NEW user joins mid-session, they need to see everything drawn
 * so far. If the server just forwarded messages without remembering them,
 * a late joiner would see a blank canvas while everyone else sees a full
 * drawing. So the server keeps the authoritative stroke list and sends
 * it to anyone who connects.
 *
 * PERSISTENCE: the in-memory array alone doesn't survive a server
 * restart/crash. We also mirror it to a JSON file on disk, and reload
 * that file on startup. Trade-off, documented in ARCHITECTURE.md:
 * this is a simple "write the whole file on every change" strategy —
 * fine at this scale (a handful of strokes/sec, small JSON), but would
 * need a real database or append-only log at much higher volume.
 */

const fs = require('fs');
const path = require('path');

class DrawingState {
  constructor(roomId) {
    this.filePath = path.join(__dirname, '..', 'data', `${roomId}.json`);
    this.strokes = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return []; // no file yet, or it's corrupt — start fresh rather than crash
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.strokes));
    } catch (err) {
      console.error('Failed to persist canvas state:', err.message);
    }
  }

  addStroke(stroke) {
    this.strokes.push(stroke);
    this._save();
  }

  removeStroke(strokeId) {
    this.strokes = this.strokes.filter((s) => s.id !== strokeId);
    this._save();
  }

  restoreStroke(stroke) {
    // used for redo — re-insert a previously removed stroke
    this.strokes.push(stroke);
    this._save();
  }

  clear() {
    this.strokes = [];
    this._save();
  }

  getAll() {
    return this.strokes;
  }

  getStroke(strokeId) {
    return this.strokes.find((s) => s.id === strokeId);
  }
}

module.exports = DrawingState;