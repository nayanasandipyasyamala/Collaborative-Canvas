/**
 * main.js — app entry point. Wires toolbar UI to CanvasBoard,
 * and CanvasBoard to SyncClient (once a server exists).
 */

document.addEventListener('DOMContentLoaded', () => {
  const joinScreen = document.getElementById('joinScreen');
  const appEl = document.getElementById('app');
  const nameInput = document.getElementById('nameInput');
  const joinBtn = document.getElementById('joinBtn');

  const submitJoin = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    joinScreen.style.display = 'none';
    appEl.style.display = 'flex';
    initApp(name);
  };

  joinBtn.addEventListener('click', submitJoin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitJoin();
  });
  nameInput.focus();
});

function initApp(myName) {
  const canvasEl = document.getElementById('board');
  const board = new CanvasBoard(canvasEl);

  // ---- Toolbar: tool selection ----
  const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      board.setTool(btn.dataset.tool);
    });
  });

  // ---- Toolbar: color ----
  const colorPicker = document.getElementById('colorPicker');
  colorPicker.addEventListener('input', (e) => board.setColor(e.target.value));

  const PALETTE = ['#1a1a2e', '#2952e3', '#ff5a36', '#2ecc71', '#f4c542', '#ffffff'];
  const swatchWrap = document.getElementById('swatches');
  PALETTE.forEach((hex) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      board.setColor(hex);
      colorPicker.value = hex;
      document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
    });
    swatchWrap.appendChild(sw);
  });

  // ---- Toolbar: width ----
  const widthSlider = document.getElementById('widthSlider');
  const widthValue = document.getElementById('widthValue');
  widthSlider.addEventListener('input', (e) => {
    board.setWidth(Number(e.target.value));
    widthValue.textContent = e.target.value;
  });

  // ---- Toolbar: undo / redo / clear ----
  document.getElementById('undoBtn').addEventListener('click', () => board.undo());
  document.getElementById('redoBtn').addEventListener('click', () => board.redo());
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Clear the whole canvas? This cannot be undone.')) {
      board.clear();
      sync.sendClear();
    }
  });

  // ---- Keyboard shortcuts ----
  window.addEventListener('keydown', (e) => {
    const cmd = e.ctrlKey || e.metaKey;
    if (cmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); board.undo(); }
    if (cmd && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); board.redo(); }
  });

  // ---- Sync client (Day 2+) ----
  // Auto-detects ws:// vs wss:// based on how the page itself was loaded.
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sync = new SyncClient(`${wsProtocol}//${location.hostname}:8080`, myName);

  const statusDot = document.querySelector('.dot');
  const statusText = document.getElementById('statusText');

  sync.onOpen = () => {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    statusText.textContent = 'Connected';
  };
  sync.onClose = () => {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    statusText.textContent = 'Solo mode — not connected';
  };
  sync.onInitState = (strokes) => board.loadState(strokes);
  sync.onStroke = (stroke) => board.addRemoteStroke(stroke);
  sync.onUndo = (strokeId) => board.removeStrokeById(strokeId);
  sync.onClear = () => board.clear();
  sync.onEraseStroke = (strokeId) => board.removeStrokeById(strokeId);

  // Hook local actions to broadcast outward once connected.
  board.onStrokeComplete = (stroke) => sync.sendStroke(stroke);
  board.onLocalUndo = (strokeId) => sync.sendUndo(strokeId);
  board.onLocalRedo = (stroke) => sync.sendRedo(stroke);
  board.onStrokeErased = (strokeId) => sync.sendEraseStroke(strokeId);

  // ---- Identity: who am I, per the server ----
  let myUserId = null;
  sync.onWelcome = (user) => { myUserId = user.id; board.setLocalUserId(user.id); };

  // ---- User count in the status bar ----
  sync.onUserList = (users) => {
    const count = users.length;
    if (sync.connected) {
      statusText.textContent = count <= 1 ? 'Connected — solo' : `Connected — ${count} online`;
    }
  };

  // ---- Remote cursors: render a colored dot + name tag for every other user ----
  const cursorLayer = document.getElementById('cursorLayer');
  const cursorEls = new Map(); // userId -> DOM element

  sync.onCursor = ({ userId, name, color, x, y }) => {
    let el = cursorEls.get(userId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = `<div class="dot-cursor"></div><div class="label"></div>`;
      el.querySelector('.dot-cursor').style.background = color;
      el.querySelector('.label').textContent = name;
      cursorLayer.appendChild(el);
      cursorEls.set(userId, el);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  sync.onUserLeft = (userId) => {
    const el = cursorEls.get(userId);
    if (el) { el.remove(); cursorEls.delete(userId); }
  };

  // Broadcast our own cursor position, throttled so we don't flood the
  // network with a message on every single pixel of mouse movement.
  let lastCursorSend = 0;
  canvasEl.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastCursorSend < 40) return; // ~25 updates/sec max
    lastCursorSend = now;
    const rect = canvasEl.getBoundingClientRect();
    sync.sendCursor(e.clientX - rect.left, e.clientY - rect.top);
  });

  sync.connect();

  // If no server is running, this fails silently and the app stays
  // fully usable in solo mode — that's the point of building Phase 1
  // this way.
}