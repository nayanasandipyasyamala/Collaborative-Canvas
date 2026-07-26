/**
 * websocket.js — thin wrapper around the native WebSocket API.
 *
 * Day 1: no server exists yet, so this will simply fail to connect and
 * the app falls back to solo mode automatically. That's intentional —
 * canvas.js should work perfectly with zero network dependency.
 *
 * Day 2 will fill in real message handling (see server/server.js).
 */

class SyncClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.socket = null;
    this.connected = false;

    // Hooks the app (main.js) subscribes to.
    this.onOpen = null;
    this.onClose = null;
    this.onStroke = null;   // (stroke) => void
    this.onUndo = null;     // (strokeId) => void
    this.onCursor = null;   // ({userId, x, y, color}) => void
    this.onInitState = null;// (strokes[]) => void
    this.onUserList = null; // (users[]) => void
    this.onWelcome = null;  // (user) => void — tells us our own id/color
    this.onClear = null;    // () => void
    this.onUserLeft = null; // (userId) => void
    this.onEraseStroke = null; // (strokeId) => void — whole-stroke erase from another user
  }

  connect() {
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      console.warn('WebSocket unavailable, staying in solo mode.', err);
      return;
    }

    this.socket.addEventListener('open', () => {
      this.connected = true;
      this._send({ type: 'join', name: this.name });
      if (this.onOpen) this.onOpen();
    });

    this.socket.addEventListener('close', () => {
      this.connected = false;
      if (this.onClose) this.onClose();
    });

    this.socket.addEventListener('error', () => {
      // Swallow — 'close' will also fire, that's where we react.
    });

    this.socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(msg);
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'init-state':
        if (this.onInitState) this.onInitState(msg.strokes);
        break;
      case 'stroke':
        if (this.onStroke) this.onStroke(msg.stroke);
        break;
      case 'undo':
        if (this.onUndo) this.onUndo(msg.strokeId);
        break;
      case 'cursor':
        if (this.onCursor) this.onCursor(msg);
        break;
      case 'users':
        if (this.onUserList) this.onUserList(msg.users);
        break;
      case 'welcome':
        if (this.onWelcome) this.onWelcome(msg.user);
        break;
      case 'clear':
        if (this.onClear) this.onClear();
        break;
      case 'user-left':
        if (this.onUserLeft) this.onUserLeft(msg.userId);
        break;
      case 'erase-stroke':
        if (this.onEraseStroke) this.onEraseStroke(msg.strokeId);
        break;
      default:
        break;
    }
  }

  _send(payload) {
    if (this.connected && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  sendStroke(stroke) {
    this._send({ type: 'stroke', stroke });
  }

  sendUndo(strokeId) {
    this._send({ type: 'undo', strokeId });
  }

  sendCursor(x, y) {
    this._send({ type: 'cursor', x, y });
  }

  sendRedo(stroke) {
    this._send({ type: 'redo', stroke });
  }

  sendClear() {
    this._send({ type: 'clear' });
  }

  sendEraseStroke(strokeId) {
    this._send({ type: 'erase-stroke', strokeId });
  }
}