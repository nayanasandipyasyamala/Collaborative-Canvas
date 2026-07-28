# 🏛️ Collaborative Canvas — Architecture & Technical Design

> **Overview:** Real-time multi-user drawing application using vanilla JavaScript + HTML5 Canvas on the frontend, and Node.js + native WebSockets on the backend. This document describes the system architecture, data flow, network protocol, rendering algorithms, state management strategies, and key engineering trade-offs.

---

## 🗂️ System Components & Architecture

The application is structured into decoupled client and server modules:

```
                              ┌───────────────────────────────────────────────┐
                              │                 Browser Client                │
                              │ ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │
                              │ │   main.js    │ │  canvas.js   │ │websocket│ │
                              │ │(UI / Events) │ │(Canvas Engine│ │  client │ │
                              │ └──────┬───────┘ └──────┬───────┘ └────┬────┘ │
                              └────────┼────────────────┼──────────────┼──────┘
                                       │                │              │
                                       └────────────────┼──────────────┘
                                                        │ JSON / WS
                                                        ▼
                              ┌───────────────────────────────────────────────┐
                              │                 Node.js Server                │
                              │ ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │
                              │ │  server.js   │ │   rooms.js   │ │drawing- │ │
                              │ │ (HTTP / WS)  │ │(User Manager)│ │ state.js│ │
                              │ └──────────────┘ └──────────────┘ └─────────┘ │
                              └───────────────────────────────────────────────┘
```

| Layer | Component | File | Responsibilities |
| :--- | :--- | :--- | :--- |
| **Client** | UI Controller | [main.js](file:///c:/Drawing_canvas/client/main.js) | Wires toolbar UI (tools, colors, width sliders, swatches), keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`), status indicators, remote cursor DOM elements, and 40ms cursor broadcast throttling. |
| | Rendering Engine | [canvas.js](file:///c:/Drawing_canvas/client/canvas.js) | Manages HTML5 Canvas context, stroke vector point storage, pre-stroke canvas snapshotting (`getImageData`), procedural paintbrush bristles, continuous single-path rendering, hit-testing segment distance math, and per-user undo/redo stacks. |
| | Network Client | [websocket.js](file:///c:/Drawing_canvas/client/websocket.js) | `SyncClient` wrapper managing WebSocket lifecycle, protocol auto-detection (`ws://` vs `wss://`), exponential backoff reconnection (`Math.min(5000, 1000 * 2^attempt)`), and packet dispatching. |
| **Server** | Unified Server | [server.js](file:///c:/Drawing_canvas/server/server.js) | Dual HTTP static file server and WebSocket server listening on a single port. Handles client handshakes, display name sanitization, message routing, and client disconnect cleanups. |
| | Room & User State | [rooms.js](file:///c:/Drawing_canvas/server/rooms.js) | `RoomManager` & `Room` tracking active sockets, assigning unique user IDs and random pastel cursor colors from a curated palette, and serializing online user lists. |
| | State Persistence | [drawing-state.js](file:///c:/Drawing_canvas/server/drawing-state.js) | `DrawingState` in-memory vector stroke array store. Mirrored synchronously to disk (`data/<roomId>.json`) on every modification to guarantee data persistence across restarts. |

---

## 🔄 Data Flow: How a Stroke Reaches Another User

Strokes are represented as **vector objects** (arrays of 2D point coordinates with metadata) rather than pixel bitmaps. This enables infinite resolution independent of canvas scaling, smooth replay, per-stroke eraser hit testing, and deterministic network sync.

```
Tab A (Drawing User)               Node.js Server              Tab B (Remote Viewer)
────────────────────               ──────────────              ─────────────────────
mousedown / touchstart
  ├── Take getImageData snapshot
  └── Instantiate activeStroke
mousemove / touchmove
  ├── Point distance check (>= 1.5px)
  ├── Append {x, y} to points array
  └── Restore snapshot + draw stroke
mouseup / touchend
  ├── Finalize activeStroke
  ├── Push to board.strokes[]
  └── Fire onStrokeComplete hook
           │
           ▼
     sync.sendStroke()
     (JSON.stringify)
           │
           ├────────────────────────► ws.on('message')
                                           ├── Validate & attach server userId
                                           ├── room.state.addStroke(stroke)
                                           │     └── writeFileSync to data/main.json
                                           └── room.broadcast(stroke) to peers
                                                     │
                                                     └──────────────────────► sync.onStroke()
                                                                                └── board.addRemoteStroke()
                                                                                      ├── Push to strokes[]
                                                                                      └── Draw stroke onto Tab B
```

> ⚡ **Zero Drawing Lag:** Local strokes are rendered instantly on the drawing user's canvas. Network round trips occur in the background and only affect when *other* connected clients see the stroke.

---

## 📡 WebSocket Protocol Specification

All WebSocket packets are formatted as JSON objects containing a `type` field. Client $\rightarrow$ Server and Server $\rightarrow$ Client share symmetrical payload structures:

| Packet Type | Direction | Payload Schema | Functional Purpose |
| :--- | :--- | :--- | :--- |
| `join` | C $\rightarrow$ S | `{ name: string }` | Sent immediately after connection to register the user's chosen display name. |
| `welcome` | S $\rightarrow$ C | `{ user: { id, name, color } }` | Confirms registration and delivers assigned client ID and cursor color. |
| `init-state` | S $\rightarrow$ C | `{ strokes: Stroke[] }` | Sent once upon joining; provides the complete stroke history so late joiners see existing drawings. |
| `stroke` | C $\leftrightarrow$ S | `{ stroke: { id, userId, tool, color, width, points, bristles? } }` | Broadcasts a completed stroke to all other connected clients. |
| `undo` | C $\leftrightarrow$ S | `{ strokeId: string }` | Requests removal of a specific stroke ID owned by the user. |
| `redo` | C $\leftrightarrow$ S | `{ stroke: Stroke }` | Restores a previously undone stroke owned by the user. |
| `clear` | C $\leftrightarrow$ S | `{}` | Requests clearing the full canvas history across all clients. |
| `erase-stroke` | C $\leftrightarrow$ S | `{ strokeId: string }` | Whole-stroke eraser packet requesting deletion of a targeted stroke ID. |
| `cursor` | C $\leftrightarrow$ S | C $\rightarrow$ S: `{ x, y }`<br>S $\rightarrow$ C: `{ userId, name, color, x, y }` | High-frequency live cursor coordinates. Ephemeral (never stored). |
| `users` | S $\rightarrow$ C | `{ users: User[] }` | Delivers the current list of online users whenever someone joins or leaves. |
| `user-left` | S $\rightarrow$ C | `{ userId: string }` | Signals client to remove the corresponding remote cursor element from the DOM. |

> 🛡️ **Server Authority:** The server overwrites/attaches the authoritative `userId` onto incoming strokes based on the socket session, preventing clients from spoofing another user's identity.

---

## 🎨 Tool & Rendering Architecture

### 1. Continuous Single-Path Compositing
To draw semi-transparent strokes (e.g. Marker or Paintbrush) without visual artifacts, strokes are rendered as a single continuous `ctx.beginPath()` path per frame. Rendering segment-by-segment causes overlapping joint caps that double-composite alpha, producing unsightly "beaded" seams.

```
❌ Segment-by-Segment (Alpha Double-Compositing / Beading):
( O )=======( O )=======( O )  <-- Overlapping round line caps cause dark spots

✅ Continuous Path (Smooth Alpha):
( ========================= )  <-- Single continuous path with uniform alpha
```

### 2. Procedural Paintbrush Bristle Engine
Paintbrush strokes create a realistic textured look by rendering multiple parallel bristle paths:
- When a stroke starts, `_generateBristles()` creates 7 bristle offsets (`frac`), opacities (`alpha`), and line width factors (`widthFactor`).
- During drawing, `_computeNormals()` calculates perpendicular unit normal vectors $(\hat{n}_x, \hat{n}_y)$ at each vertex along the curve path:
  $$\hat{n} = \left(-\frac{\Delta y}{L}, \frac{\Delta x}{L}\right) \quad \text{where } L = \sqrt{\Delta x^2 + \Delta y^2}$$
- Each bristle path follows vertex positions shifted along the normal: $(p_x + \hat{n}_x \cdot \text{offset}, p_y + \hat{n}_y \cdot \text{offset})$.
- Bristle data is saved directly inside the `activeStroke` vector object so it replays **identically** on every remote client, after undo/redo, and across reloads.

### 3. Stroke Eraser & Distance Math
The stroke eraser detects strokes passing within range of the pointer using point-to-segment Euclidean projection math:
$$\text{Distance}(P, A, B) = \| P - (A + t^* (B - A)) \|, \quad t^* = \text{clamp}\left(\frac{(P - A) \cdot (B - A)}{\| B - A \|^2}, 0, 1\right)$$
If the distance is $\le \frac{\text{stroke.width}}{2} + 6\text{px}$, the stroke is hit-tested for deletion.

---

## 🛡️ Whole-Stroke Eraser — Ownership Enforcement

The stroke eraser deletes an entire stroke upon contact. On a collaborative canvas, allowing users to erase each other's work outright is destructive.

Security & Safety are enforced at **two independent levels**:
1. **Client Level ([canvas.js](file:///c:/Drawing_canvas/client/canvas.js), `_eraseStrokeAt`):** Filters strokes so hit-testing only evaluates strokes where `stroke.userId === localUserId`.
2. **Server Level ([server.js](file:///c:/Drawing_canvas/server/server.js), `erase-stroke`):** Validates incoming requests against state (`target.userId === user.id`). If a malicious client attempts to send forged `erase-stroke` packets for someone else's stroke ID, the server silently drops the packet.

---

## ↺ Per-User Undo/Redo Strategy

### Decision: Scoped Per-User History (Non-Global Undo)
Undo only removes the **acting user's own most recent stroke**. It does *not* pop the global top of the shared stroke stack.

### Rationale
In a multi-user environment, if User A draws a stroke and User B draws a stroke a split-second later, a global `pop()` would cause User A's `Ctrl+Z` to delete User B's work. This causes accidental cross-user deletion.

### Implementation
- `undo()` scans `board.strokes` **backwards** from the tail and removes the first stroke where `stroke.userId === localUserId`.
- The removed stroke is pushed onto a local `redoStack`.
- `redo()` pops from `redoStack` and re-appends the stroke to the active history.

### Alternative Approaches Considered & Rejected
- ❌ **Global `array.pop()`:** Simple to implement, but causes accidental deletion of other users' work during concurrent drawing.
- ❌ **Operational Transformation (OT) / CRDT Replay:** Heavyweight solution requiring total ordering, vector clocks, and complex conflict resolution. Per-user scoped undo provides an intuitive, robust middle-ground for drawing applications.

---

## ⚡ Performance Optimizations

1. **Pre-Stroke Canvas Snapshotting:** When a stroke begins, `_preStrokeSnapshot = ctx.getImageData(...)` saves the canvas state. During `mousemove`, the canvas restores this single image and draws only the active stroke, avoiding $O(N)$ redraws of thousands of existing strokes during active dragging.
2. **Point Distance Throttling:** Incoming mouse points are ignored if Euclidean distance from the last point is $< 1.5\text{px}$. This reduces memory overhead and payload size without sacrificing smoothness.
3. **Cursor Broadcast Throttling:** Mouse coordinates are emitted at most once every $40\text{ms}$ ($\approx 25\text{ FPS}$), preventing WebSocket buffer congestion.
4. **Replay-Based Redraws (`redrawAll()`):** The canvas clears and replays the vector array on undo/redo/resize. Simple, clean, and reliable for standard drawing session volumes.

---

## 💾 State Persistence & Conflict Resolution

- **No Spatial Conflicts:** Strokes drawn concurrently in the same area layer in the order they arrive at the server.
- **Synchronous Persistence:** [drawing-state.js](file:///c:/Drawing_canvas/server/drawing-state.js) persists the stroke array to `data/<roomId>.json` using `fs.writeFileSync`. Atomic full-file updates ensure data integrity across server restarts.
