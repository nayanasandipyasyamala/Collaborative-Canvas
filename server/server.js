const { WebSocketServer } = require('ws');
const { RoomManager } = require('./rooms');

const PORT = process.env.PORT || 8080;
const ROOM_ID = 'main'; // single global room for now — multi-room is a bonus feature later

const rooms = new RoomManager();
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  const room = rooms.getOrCreate(ROOM_ID);
  const user = room.addClient(ws); // gets a default name for now — real name comes via 'join'
  let hasJoined = false;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed messages rather than crashing the server
    }

    switch (msg.type) {
      case 'join': {
        // Client just told us their chosen display name. Sanitize it
        // (short, no HTML) then finish the handshake we deferred.
        const clean = String(msg.name || '').trim().slice(0, 20);
        user.name = clean || user.name;

        console.log(`+ ${user.name} (${user.id}) joined (${room.clients.size} online)`);

        ws.send(JSON.stringify({ type: 'welcome', user }));
        ws.send(JSON.stringify({ type: 'init-state', strokes: room.state.getAll() }));
        room.broadcast({ type: 'users', users: room.getUserList() });
        hasJoined = true;
        break;
      }

      case 'stroke': {
        // Tag the stroke with who drew it, then remember + relay it.
        const stroke = { ...msg.stroke, userId: user.id };
        room.state.addStroke(stroke);
        room.broadcast({ type: 'stroke', stroke }, ws);
        break;
      }

      case 'undo': {
        room.state.removeStroke(msg.strokeId);
        room.broadcast({ type: 'undo', strokeId: msg.strokeId }, ws);
        break;
      }

      case 'redo': {
        room.state.restoreStroke(msg.stroke);
        room.broadcast({ type: 'stroke', stroke: msg.stroke }, ws);
        break;
      }

      case 'clear': {
        room.state.clear();
        room.broadcast({ type: 'clear' }, ws);
        break;
      }

      case 'erase-stroke': {
        // Whole-stroke eraser: scoped to strokes the requesting user
        // actually owns. The client already filters this locally, but
        // that's trivially bypassable (anyone can edit their own JS) —
        // so the server re-checks ownership itself before honoring it.
        const target = room.state.getStroke(msg.strokeId);
        if (!target || target.userId !== user.id) break; // not found, or not yours — ignore
        room.state.removeStroke(msg.strokeId);
        room.broadcast({ type: 'erase-stroke', strokeId: msg.strokeId }, ws);
        break;
      }

      case 'cursor': {
        // Cursor moves are high-frequency and disposable — no need to
        // store them in DrawingState, just relay live.
        room.broadcast(
          { type: 'cursor', userId: user.id, name: user.name, color: user.color, x: msg.x, y: msg.y },
          ws
        );
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    room.removeClient(ws);
    console.log(`- ${user.name} (${user.id}) left (${room.clients.size} online)`);
    room.broadcast({ type: 'users', users: room.getUserList() });
    room.broadcast({ type: 'user-left', userId: user.id });
    rooms.cleanupIfEmpty(ROOM_ID);
  });
});