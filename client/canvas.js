/**
 * canvas.js — raw Canvas API drawing logic.
 *
 * KEY DESIGN DECISION: strokes are stored as DATA (arrays of points),
 * not as pixels. This is what makes undo/redo AND future multi-user sync
 * possible — we can replay/remove/re-send individual strokes instead of
 * manipulating raw pixel buffers.
 */

class CanvasBoard {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');

    // The full history of completed strokes on this board.
    this.strokes = [];       // committed strokes, in order
    this.redoStack = [];     // strokes removed by undo, restorable by redo

    // The stroke currently being drawn (not yet committed).
    this.activeStroke = null;
    this.isDrawing = false;
    this.isErasing = false; // true while dragging with the stroke-eraser tool

    // Tool state
    this.tool = 'brush';
    this.color = '#1a1a2e';
    this.width = 4;

    // Which user we are, once the server tells us (see main.js onWelcome).
    // Needed so undo only ever touches OUR OWN strokes, not everyone's.
    this.localUserId = null;

    // Hooks other modules (websocket.js) can subscribe to.
    this.onStrokeComplete = null; // (stroke) => void
    this.onLocalUndo = null;      // (strokeId) => void
    this.onLocalRedo = null;      // (stroke) => void
    this.onStrokeErased = null;   // (strokeId) => void — whole-stroke eraser

    // Snapshot of the canvas right before the current stroke began — lets
    // live drawing redraw just this one stroke each frame (fast) instead
    // of replaying the entire stroke history on every mousemove.
    this._preStrokeSnapshot = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindPointerEvents();
  }

  _resize() {
    const wrap = this.canvas.parentElement;
    // Preserve drawing on resize by redrawing from stroke history.
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
    this.redrawAll();
  }

  setTool(tool) { this.tool = tool; }
  setColor(color) { this.color = color; }
  setWidth(width) { this.width = width; }
  setLocalUserId(id) { this.localUserId = id; }

  _bindPointerEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const touch = e.touches && e.touches[0];
      const clientX = touch ? touch.clientX : e.clientX;
      const clientY = touch ? touch.clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const start = (e) => {
      e.preventDefault();

      // Stroke-eraser is a different interaction entirely: it doesn't draw
      // anything, it hit-tests and deletes whole strokes as you drag.
      if (this.tool === 'stroke-eraser') {
        this.isErasing = true;
        this._eraseStrokeAt(getPos(e));
        return;
      }

      this.isDrawing = true;
      const pos = getPos(e);
      // Snapshot everything drawn so far, so each move-frame can restore
      // it instantly and redraw just this one in-progress stroke on top —
      // without needing to replay every prior stroke every frame.
      this._preStrokeSnapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.activeStroke = {
        id: this._genId(),
        userId: this.localUserId,
        tool: this.tool,
        color: this.color,
        width: this.width,
        points: [pos],
        // Paintbrush only: a fixed set of bristle offsets, generated once
        // per stroke and stored as data (so it replays identically on
        // every client, including after undo/redo/reload). This is what
        // creates a textured, multi-bristle look instead of one smooth
        // vector line.
        bristles: this.tool === 'paintbrush' ? this._generateBristles() : null,
      };
      this.redoStack = []; // new action invalidates redo history
    };

    const move = (e) => {
      if (this.tool === 'stroke-eraser') {
        if (!this.isErasing) return;
        e.preventDefault();
        this._eraseStrokeAt(getPos(e));
        return;
      }

      if (!this.isDrawing || !this.activeStroke) return;
      e.preventDefault();
      const pos = getPos(e);
      const pts = this.activeStroke.points;
      const last = pts[pts.length - 1];

      // Sample throttling: skip points that are too close together.
      // Reduces point count without visibly affecting smoothness.
      const dist = Math.hypot(pos.x - last.x, pos.y - last.y);
      if (dist < 1.5) return;

      pts.push(pos);
      // Restore the pre-stroke snapshot, then redraw this ENTIRE stroke as
      // one continuous path. Drawing segment-by-segment (the old approach)
      // caused semi-transparent tools (Highlighter, Paintbrush) to show a
      // "beaded" look — every joint between two short strokes double-
      // composited their alpha. A single continuous path has no such
      // internal seams.
      this.ctx.putImageData(this._preStrokeSnapshot, 0, 0);
      this._drawFullStroke(this.activeStroke);
    };

    const end = () => {
      if (this.tool === 'stroke-eraser') {
        this.isErasing = false;
        return;
      }
      if (!this.isDrawing || !this.activeStroke) return;
      this.isDrawing = false;
      if (this.activeStroke.points.length > 1) {
        this.strokes.push(this.activeStroke);
        if (this.onStrokeComplete) this.onStrokeComplete(this.activeStroke);
      }
      this.activeStroke = null;
      this._preStrokeSnapshot = null;
    };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);

    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    this.canvas.addEventListener('touchend', end);
  }

  _genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Generate a fixed bristle pattern (offsets + individual opacities)
   *  once per stroke. Reused for every segment of that stroke so the
   *  texture stays consistent along its length, and replays identically
   *  on every client since it's stored as part of the stroke data. */
  _generateBristles() {
    const COUNT = 7;
    const bristles = [];
    for (let i = 0; i < COUNT; i++) {
      bristles.push({
        // spread across the brush width, with a little randomness so
        // bristles don't look mechanically evenly spaced
        frac: (i / (COUNT - 1) - 0.5) + (Math.random() - 0.5) * 0.08,
        alpha: 0.25 + Math.random() * 0.35,
        widthFactor: 0.35 + Math.random() * 0.25,
      });
    }
    return bristles;
  }

  /** Direction-aware perpendicular offset for each point along a polyline —
   *  used so paintbrush bristles follow the stroke's actual curve, not
   *  just the direction of its first segment. */
  _computeNormals(points) {
    const normals = [];
    for (let i = 0; i < points.length; i++) {
      let dx, dy;
      if (i === 0) {
        dx = points[1].x - points[0].x;
        dy = points[1].y - points[0].y;
      } else if (i === points.length - 1) {
        dx = points[i].x - points[i - 1].x;
        dy = points[i].y - points[i - 1].y;
      } else {
        // average of the incoming and outgoing segment directions —
        // smoother than using either segment alone
        dx = points[i + 1].x - points[i - 1].x;
        dy = points[i + 1].y - points[i - 1].y;
      }
      const len = Math.hypot(dx, dy) || 1;
      normals.push({ nx: -dy / len, ny: dx / len });
    }
    return normals;
  }

  /** Draws an ENTIRE stroke as one continuous path (one stroke() call per
   *  "layer" — one for pen/marker, one per bristle for paintbrush).
   *  This is deliberately NOT segment-by-segment: stroking many short,
   *  separate paths end-to-end causes semi-transparent strokes to show
   *  visible "beading" where round caps overlap at each joint and double-
   *  composite their alpha. A single path has no internal seams. */
  _drawFullStroke(stroke) {
    const ctx = this.ctx;
    if (stroke.points.length < 2) return;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = stroke.width;
      ctx.globalAlpha = 1;
      this._strokePath(stroke.points);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    if (stroke.tool === 'paintbrush' && stroke.bristles) {
      const normals = this._computeNormals(stroke.points);
      ctx.strokeStyle = stroke.color;
      for (const bristle of stroke.bristles) {
        const offset = bristle.frac * stroke.width;
        const offsetPoints = stroke.points.map((p, i) => ({
          x: p.x + normals[i].nx * offset,
          y: p.y + normals[i].ny * offset,
        }));
        ctx.globalAlpha = bristle.alpha;
        ctx.lineWidth = Math.max(1, stroke.width * bristle.widthFactor);
        this._strokePath(offsetPoints);
      }
      ctx.globalAlpha = 1;
      return;
    }

    ctx.strokeStyle = stroke.color;
    if (stroke.tool === 'marker') {
      ctx.lineWidth = stroke.width * 2.2;
      ctx.globalAlpha = 0.45;
    } else {
      ctx.lineWidth = stroke.width;
      ctx.globalAlpha = 1;
    }
    this._strokePath(stroke.points);
    ctx.globalAlpha = 1;
  }

  /** Stroke a single continuous path through a list of points. */
  _strokePath(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  /** Shortest distance from point p to line segment a-b.
   *  Used by the stroke-eraser to hit-test "is my pointer close enough
   *  to this stroke to count as clicking on it". */
  _distToSegment(p, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * (b.x - a.x);
    const projY = a.y + t * (b.y - a.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  /** Find the topmost (most recently drawn) stroke under `pos`, belonging
   *  to the LOCAL user, and delete it entirely. Deliberately scoped to
   *  your own strokes only — an eraser that could delete anyone's work
   *  on a shared canvas would be too destructive for a collaborative
   *  session; nobody expects their drawing to vanish because someone
   *  else's eraser passed over it. */
  _eraseStrokeAt(pos) {
    const HIT_PADDING = 6; // px of forgiveness beyond the stroke's own width

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      if (stroke.userId !== this.localUserId) continue; // not yours — skip

      const threshold = stroke.width / 2 + HIT_PADDING;
      for (let j = 1; j < stroke.points.length; j++) {
        if (this._distToSegment(pos, stroke.points[j - 1], stroke.points[j]) <= threshold) {
          this.strokes.splice(i, 1);
          this.redrawAll();
          if (this.onStrokeErased) this.onStrokeErased(stroke.id);
          return stroke.id;
        }
      }
    }
    return null; // nothing of yours under the pointer
  }

  /** Redraw the entire canvas from the committed stroke history.
   *  This is the "replay the log" approach — simple, correct, and what
   *  makes undo/redo (and later, remote sync) tractable. */
  redrawAll() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.strokes) {
      this._drawFullStroke(stroke);
    }
  }

  undo() {
    // Find the LAST stroke that belongs to ME, scanning backwards.
    // This is deliberately NOT "remove the last item in the array" —
    // that would undo whoever drew most recently, even if it wasn't you.
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].userId === this.localUserId) {
        const [stroke] = this.strokes.splice(i, 1);
        this.redoStack.push(stroke);
        this.redrawAll();
        if (this.onLocalUndo) this.onLocalUndo(stroke.id);
        return stroke;
      }
    }
    return null; // you have nothing left of your own to undo
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const stroke = this.redoStack.pop();
    this.strokes.push(stroke);
    this.redrawAll();
    if (this.onLocalRedo) this.onLocalRedo(stroke);
    return stroke;
  }

  clear() {
    this.strokes = [];
    this.redoStack = [];
    this.redrawAll();
  }

  /** Add a stroke that came from elsewhere (another user, or a reload)
   *  without triggering onStrokeComplete again. */
  addRemoteStroke(stroke) {
    this.strokes.push(stroke);
    this._drawFullStroke(stroke);
  }

  removeStrokeById(strokeId) {
    this.strokes = this.strokes.filter((s) => s.id !== strokeId);
    this.redrawAll();
  }

  loadState(strokes) {
    this.strokes = strokes;
    this.redoStack = [];
    this.redrawAll();
  }
}