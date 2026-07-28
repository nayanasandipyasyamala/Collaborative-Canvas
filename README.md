# 🎨 Collaborative Canvas

> **A real-time multi-user drawing app.** Multiple people can draw on the same canvas at once, from separate browser tabs or machines, and see each other's strokes and cursors live.

Built with **vanilla JavaScript + HTML5 Canvas** on the client, and **Node.js + native WebSockets** on the server — no frontend framework, no drawing library.

---

## 🚀 Quick Setup & Installation

> ⚡ **Prerequisite:** Requires **Node.js (v16+)**

```bash
# 1. Install dependencies
npm install

# 2. Start the server — this serves BOTH the client files and the
#    WebSocket connection from one process
npm start
# → "Server (HTTP + WebSocket) listening on port 8080"

# 3. Open http://localhost:8080 in your browser
```

💡 **Pro Tip for Testing:** To test collaboration, open the URL in **two separate tabs** (or one normal + one incognito window), enter a different name in each, and draw!

---

## ✨ Features

- 🖌️ **Brush & Eraser Tools** — Adjustable color palettes and stroke width controls
- ⚡ **Live Real-time Sync** — Strokes appear on other clients as they're drawn, not after
- 🖱️ **Live Cursor Tracking** — See a colored dot + name label for every other connected user
- ↺ **Per-user Undo / Redo** (`Ctrl+Z` / `Ctrl+Shift+Z` or toolbar buttons) — Undo only ever removes *your own* last stroke, never someone else's
- 🧹 **Global Clear** — Wipe the canvas clean (with user confirmation)
- 💾 **State Persistence** — Canvas state persists across server restarts (saved to `data/main.json`, auto-created)
- 👥 **Seamless Joining** — New users joining mid-session immediately see everything already drawn
- 📱 **Touch Support** — Full support for mobile and tablet drawing inputs

---

## 🏗️ Architecture Overview

Two independent modules communicate seamlessly over a bi-directional WebSocket connection:

| Layer | Path | Description & Responsibilities |
| :--- | :--- | :--- |
| **Client** | `client/` | Runs in the browser. `canvas.js` is the drawing engine (stores strokes as data, not pixels). `websocket.js` wraps the native WebSocket API. `main.js` wires the two together and drives the UI. |
| **Server** | `server/` | One Node process. `server.js` is the connection/message relay. `rooms.js` tracks connected users. `drawing-state.js` is the server's source-of-truth stroke history, persisted to a JSON file. |

> 📖 **Deep Dive:** See `Architecture.md` (or `ARCHITECTURE.md`) for the full data flow diagram, WebSocket message protocol table, and the specific design decisions (and rejected alternatives) behind per-user undo/redo and worker/user signaling.

---

## 🧪 Testing with Multiple Users

Follow these step-by-step verification instructions:

1. 🟢 **Start the server** using `npm start`.
2. 🌐 **Open 2+ browser tabs** pointed at `http://localhost:8080`.
3. 🏷️ **Enter different names** on the join screen in each tab.
4. 🎨 **Draw in one tab** — confirm it appears live in the others.
5. 🖱️ **Move your mouse without drawing** — confirm the other tab shows your colored cursor + name label.
6. ↩️ **Draw a stroke in Tab A**, then a stroke in Tab B. Press **Undo** in Tab A — confirm only Tab A's stroke disappears (not Tab B's).
7. 🔄 **Restart the server** (`Ctrl+C`, `npm start` again) — confirm existing strokes are still preserved when you reload the client.

---

## ☁️ Deployment

This app needs a host that runs a **long-lived Node process** (not a serverless/edge platform like Vercel or Netlify) because it holds an open WebSocket connection and in-memory room state. 

[Render](https://render.com) and [Railway](https://railway.app) both support this on a free tier.

### 📋 Steps (Render Deployment)
1. 📤 Push this repo to a public GitHub repository.
2. ➕ On Render: **New → Web Service**, connect the repo.
3. ⚙️ Build command: `npm install`
4. 🚀 Start command: `npm start`
5. 🔌 Render assigns a `PORT` automatically — `server.js` already reads it from `process.env.PORT`, so no config needed there.
6. 🌐 Once deployed, your app is live at the URL Render gives you (e.g., `https://your-app.onrender.com`) — this single URL serves both the client and the WebSocket connection, since they're the same process.

> ⚠️ **Persistence Caveat (Worth Knowing):** Most free hosting tiers use an *ephemeral* filesystem — anything written to disk (our `data/main.json`) can be wiped on redeploy or after the service spins down from inactivity. For this assignment's scope that's an acceptable trade-off to state honestly rather than hide; a production version would use a real database or the platform's persistent disk add-on instead of a local JSON file.

---

## ⚠️ Known Limitations

- 🏠 **Single Global Room** — No multi-room/session support yet (structured to support it later, not implemented).
- 📄 **JSON File Persistence** — Rewritten in full on every change — fine at this scale, would need a proper database at higher stroke volume.
- 🔓 **No Authentication** — Names are self-reported and not unique/enforced.
- 🎨 **Stroke Re-insertion Layering** — Redo re-inserts a stroke at the end of the draw order rather than its original position, which can slightly change stroke layering (z-order) in rare cases.


