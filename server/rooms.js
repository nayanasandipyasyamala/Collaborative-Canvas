const DrawingState = require('./drawing-state');

// A palette to assign to users as they join, cycling if more users than colors.
const USER_COLORS = ['#2952e3', '#ff5a36', '#2ecc71', '#f4c542', '#9b59b6', '#00bcd4'];

class Room {
  constructor(id) {
    this.id = id;
    this.state = new DrawingState(id);
    this.clients = new Map(); // ws -> { id, name, color }
    this._nextColorIndex = 0;
  }

  addClient(ws) {
    const userId = `user-${Math.random().toString(36).slice(2, 8)}`;
    const color = USER_COLORS[this._nextColorIndex % USER_COLORS.length];
    this._nextColorIndex++;
    const user = { id: userId, name: userId, color };
    this.clients.set(ws, user);
    return user;
  }

  removeClient(ws) {
    this.clients.delete(ws);
  }

  getUser(ws) {
    return this.clients.get(ws);
  }

  getUserList() {
    return Array.from(this.clients.values());
  }

  /** Send `data` to every connected client except `exceptWs` (usually the sender). */
  broadcast(data, exceptWs = null) {
    const payload = JSON.stringify(data);
    for (const ws of this.clients.keys()) {
      if (ws !== exceptWs && ws.readyState === 1 /* OPEN */) {
        ws.send(payload);
      }
    }
  }

  isEmpty() {
    return this.clients.size === 0;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
  }

  getOrCreate(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Room(roomId));
    }
    return this.rooms.get(roomId);
  }

  cleanupIfEmpty(roomId) {
    const room = this.rooms.get(roomId);
    if (room && room.isEmpty()) {
      this.rooms.delete(roomId);
    }
  }
}

module.exports = { RoomManager };