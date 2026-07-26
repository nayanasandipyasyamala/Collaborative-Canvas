# Collaborative Canvas

A real-time multi-user drawing app. Multiple people can draw on the same canvas
at once, from separate browser tabs or machines, and see each other's strokes
and cursors live.

Built with vanilla JavaScript + HTML5 Canvas on the client, and Node.js +
native WebSockets on the server — no frontend framework, no drawing library.

## Setup

Requires Node.js (v16+).

```bash
# 1. Install dependencies
npm install

# 2. Start the server — this serves BOTH the client files and the
#    WebSocket connection from one process
npm start
# → "Server (HTTP + WebSocket) listening on port 8080"

# 3. Open http://localhost:8080 in your browser
```

To test collaboration, open the URL in **two separate tabs** (or one normal +
one incognito window), enter a different name in each, and draw.

## Features

- Brush and eraser tools, adjustable color and stroke width
- Live real-time sync — strokes appear on other clients as they're drawn,
  not after
- Live cursor tracking — see a colored dot + name for every other connected
  user
- Per-user undo/redo (Ctrl+Z / Ctrl+Shift+Z or the toolbar buttons) — undo
  only ever removes *your own* last stroke, never someone else's
- Global clear (with confirmation)
- Canvas state persists across server restarts (see `data/main.json`,
  auto-created)
- New users joining mid-session immediately see everything already drawn
- Touch support for mobile/tablet drawing

## Architecture overview

Two independent programs communicate over a WebSocket connection:

- **`client/`** — runs in the browser. `canvas.js` is the drawing engine
  (stores strokes as data, not pixels). `websocket.js` wraps the native
  WebSocket API. `main.js` wires the two together and drives the UI.
- **`server/`** — one Node process. `server.js` is the connection/message
  relay. `rooms.js` tracks connected users. `drawing-state.js` is the
  server's source-of-truth stroke history, persisted to a JSON file.

See `ARCHITECTURE.md` for the full data flow, the WebSocket protocol, and the
specific design decisions (and rejected alternatives) behind undo/redo and
worker/user signaling.

## Testing with multiple users

1. Start the server as above.
2. Open 2+ browser tabs pointed at `http://localhost:8080`.
3. Enter different names on the join screen in each tab.
4. Draw in one tab — confirm it appears live in the others.
5. Move your mouse without drawing — confirm the other tab shows your
   colored cursor + name.
6. Draw a stroke in Tab A, then a stroke in Tab B. Press Undo in Tab A —
   confirm only Tab A's stroke disappears (not Tab B's).
7. Restart the server (Ctrl+C, `npm start` again) — confirm existing
   strokes are still there when you reload the client.

## Deployment

This app needs a host that runs a **long-lived Node process** (not a
serverless/edge platform like Vercel or Netlify) because it holds an open
WebSocket connection and in-memory room state. [Render](https://render.com)
and [Railway](https://railway.app) both support this on a free tier.

**Steps (Render):**
1. Push this repo to a public GitHub repository.
2. On Render: **New → Web Service**, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Render assigns a `PORT` automatically — `server.js` already reads it
   from `process.env.PORT`, so no config needed there.
6. Once deployed, your app is live at the URL Render gives you (something
   like `https://your-app.onrender.com`) — this single URL serves both the
   client and the WebSocket connection, since they're the same process.

**Persistence caveat, worth knowing:** most free hosting tiers use an
*ephemeral* filesystem — anything written to disk (our `data/main.json`)
can be wiped on redeploy or after the service spins down from inactivity.
For this assignment's scope that's an acceptable trade-off to state
honestly rather than hide; a production version would use a real database
or the platform's persistent disk add-on instead of a local JSON file.

## Known limitations

- Single global room — no multi-room/session support yet (structured to
  support it later, not implemented).
- Persistence uses a JSON file, rewritten in full on every change — fine at
  this scale, would need a proper database at higher stroke volume.
- No authentication — names are self-reported and not unique/enforced.
- Redo re-inserts a stroke at the end of the draw order rather than its
  original position, which can slightly change stroke layering (z-order) in
  rare cases.

## Time spent

Day 1: canvas drawing engine (brush/eraser/undo/redo, solo mode).
Day 2: WebSocket server, live multi-user sync, cursors, join screen.
Day 3: per-user undo/redo fix, persistence, docs.
