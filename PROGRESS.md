# Keystone 3D — Progress

Running log so a future session can pick this up without re-reading the PRD.

**Project root:** `~/keystone-3d` (deliberately outside the Unity project — Unity
imports everything under its own root, and `node_modules` in there is a mess).

---

## Build order status

| # | Phase | Status |
|---|-------|--------|
| 1 | Server scaffold — Express + Socket.io, rooms by code, live player list | **Built + verified locally, awaiting two-device playtest** |
| 2 | 3D core (`engine.js`) — fixed camera, mouse-look, lighting, render loop | **Built + verified locally** |
| 3 | First room modelled (`scenes.js`) | **Built + verified locally** |
| 3.5 | Shared `roomkit` + engine environment hook (step 0 of the room build) | **Built + verified** |
| 4 | Raycasting + panel UI (`hud.js`) | **Built + verified locally** |
| 5 | Game logic + penalty engine (`puzzles.js`) | **Built + verified locally** |
| 6 | Playtest checkpoint — two devices, two networks | Not started |
| 7 | Remaining rooms, puzzle types, transitions, polish | Not started |

---

## Phase 1 — what exists

```
keystone-3d/
  package.json          express + socket.io, ESM ("type": "module")
  server/
    config.js           all tuning constants in one place
    rooms.js            authoritative room state. No sockets, no broadcasting.
    index.js            HTTP + socket handlers + broadcasting + sweeper
  public/
    index.html          entry screen + room screen, one document
    css/hud.css         the whole visual identity
    js/net.js           socket wrapper, promise-based acks, session identity
    js/lobby.js         renders server state, sends actions
```

### Decisions worth knowing

- **Two identifiers per player.** `token` is secret and per-tab; `id` is public.
  Broadcasting only `id` means one player cannot impersonate another by
  replaying an identifier they saw in the crew list.
- **`sessionStorage`, not `localStorage`**, for the token. sessionStorage is
  per-tab, so two windows on one laptop are two real players — which is how you
  test locally. localStorage would make the second tab steal the first's seat.
- **Disconnect ≠ leave.** A dropped socket marks the player offline and *holds
  their seat* for 45s (`DISCONNECT_GRACE_MS`). Pressing "Leave room" frees it
  immediately. This is the groundwork for the phase-5 requirement that a lockout
  survives a refresh.
- **Rooms outlive their last player** by 120s (`EMPTY_ROOM_TTL_MS`) so a refresh
  or a wifi blip doesn't destroy the room.
- **Full state on every change.** The server re-broadcasts the whole room rather
  than diffs. At ≤6 players the payload is tiny and it removes a whole class of
  desync bug.
- **Room code alphabet excludes I/1, O/0, S/5.** Codes get read aloud over a
  voice call, so ambiguous characters are a real failure mode.
- **Join attempts are throttled** to 20/min per socket. 4-character codes are
  short enough to walk otherwise.

### Judgment calls made (flag if you disagree)

- Host = whoever opened the room. If they leave, it passes to the
  longest-present remaining player.
- `room:start` currently only flips `room.phase` to `'briefing'` and says so
  plainly in the UI. Phase 5 hangs puzzle generation off this same event.
- Added a shareable `?room=CODE` link alongside the spoken code. Not in the PRD,
  but the PRD assumes an outside voice call, and a link is faster than spelling.

---

## What was actually verified (not just written)

Two browser tabs against the local server:

- Opening a room seats the host, shows the code, disables Start at 1/6.
- A second tab joining the code appears in the first tab's manifest **live, with
  no refresh** — count 2/6, Start enables itself, log line arrives.
- Non-host sees no Start button, just "AARAV starts the run."
- Reloading a tab rejoins the same seat with host status intact (token path).
- Closing a tab marks that player amber "reconnecting", **holds their seat**,
  and disables Start because the server counts only live sockets.
- Error paths return specific messages: no callsign, short code, unknown code.

Room lifecycle also covered by a simulated-clock test (10/10 passing) at
`scratchpad/sweep-test.mjs` — capacity limits, grace expiry, room TTL, host
succession, code uniqueness over 500 rooms, and two security properties:
tokens never appear in broadcast payloads, and a wrong token cannot claim
someone else's seat. Worth re-running if `rooms.js` changes.

### Bugs found and fixed during verification

- Autofocus on load scrolled the status bar (and the connection lamp) off the
  top of the page. Fixed with `focus({ preventScroll: true })`.
- Room screen stacked vertically pushed the manifest and the Start button below
  the fold at 1280x720 — the exact resolution this is meant to run at. Rebuilt
  as a two-column grid above 900px.
- The code field accepted `I`/`O`/`S`, which are not in the code alphabet, so
  typing one failed with a confusing length error. The server now sends its
  alphabet via a `server:hello` event on connect and the field filters against
  it, so those characters simply never land.

---

## Visual identity (established phase 1, carried through the rest)

- **Palette.** Void `#070b14`, hull `#0e1524`, holo aqua `#5ef2d0`,
  amber `#ffb35c`, rose `#ff6b9d`.
- **Colour means something.** Aqua = shared/nominal. Amber = warning, penalty,
  lockout. Rose = private, belongs to one player alone. Phase 4 should render
  the Fragment panel in rose for exactly this reason.
- **Type.** Chakra Petch (display), IBM Plex Sans (body), IBM Plex Mono (data
  and codes). Google Fonts with system fallbacks, so a locked-down school
  network that blocks the CDN degrades rather than breaks.
- **All HUD effects are CSS** — box-shadow glow, gradient scan sweep,
  `backdrop-filter`, keyframes. Nothing here should migrate into WebGL; the
  point is to leave the entire GPU budget for the Three.js scene.
- **Signature element: the crew manifest.** Empty seats render as "awaiting
  crew" with a breathing pulse rather than being omitted. The absence of a
  player is the thing the design is about.

---

## 3D UI pass (added after phase 1 on request — no mechanics touched)

Two layers, deliberately independent so either can fail alone.

**CSS 3D (`public/js/depth.js` + `hud.css`).** Panels tilt toward the pointer,
bracket corners and buttons sit forward in Z, code cells flip down into place,
manifest rows swing in from behind the panel. `depth.js` imports nothing, so a
blocked Three.js CDN still leaves the UI dimensional.

Perspective is set on each direct parent of a tilting element rather than once
at the top and inherited through `preserve-3d`. Long `preserve-3d` chains
flatten unpredictably once `backdrop-filter` is involved, and every panel uses
it.

**WebGL (`public/js/backdrop.js` + `backdrop-boot.js`).** A rotating **keystone
arch** — six voussoirs, one per crew slot. A keystone is the wedge that locks an
arch together, so a segment lights only when a real player holds that seat, and
the arch stays visibly incomplete until the crew is full. The manifest's empty
slots, restated in 3D. `renderControls()` calls
`window.keystoneBackdrop?.setCrew(count)` — one optional-chained line is the
entire coupling between game state and the 3D layer.

Cost: 6 stone meshes + 6 edge overlays + 1 `THREE.Points` cloud. No shadows, no
post-processing, no per-particle CPU work (dust drifts by rotating one cloud,
not by moving 600 points). Rendering stops entirely when the tab is hidden.

**Graphics tiers are live.** `GFX LOW | HIGH` in the status bar. Starts at Low
always; a one-time FPS probe promotes to High only if the machine sustains
≥52fps on WebGL2, and never overrides a manual choice. The choice persists in
`localStorage`. High adds ACES tone mapping, denser motes, a higher pixel-ratio
cap and brighter emissive. The label listens for the backdrop's own tier event,
so it cannot lie about what is actually rendering.

The full High rig from PRD §4 — soft shadow maps, bloom, SSAO, cubemap
reflections — is **not** here, because the lobby has nothing to shadow or
reflect. That belongs with the playable room in phase 2/3.

UI copy says "GFX / HIGH", never "ray tracing". It is rasterised WebGL and
labelling it otherwise would be a lie told in the interface.

### Tuning notes (learned the hard way)

The arch was first built near full opacity and it washed out the Start button
and the manifest rows in front of it. Fixed on two axes at once: the stone
brightness range dropped, and panel backgrounds went from 72% to ~94% opaque.
Panels protecting their own text is what allows the arch to be bright enough to
see at all. Locked-vs-idle *contrast* carries the meaning, not absolute
brightness. Hero copy is the only text with no panel behind it, so it carries a
dark text-shadow halo instead.

---

---

## Phase 2 — the 3D core

`public/js/engine.js`. Camera fixed at room centre, mouse-look only, lighting,
render loop, an empty room. Entered automatically when the server reports
`room.phase !== 'lobby'`, so every client lands in the room off one broadcast —
including a player who was mid-reconnect when the host pressed start.

**Room:** 8.4 × 8.4 × 3.4 m, eye height 1.62 m. Six flat surfaces plus four
emissive ceiling strips. Small on purpose — three panels on one wall have to be
readable from the centre without zooming. The north wall has its own material so
it can darken behind the glowing panels in phase 4 without touching the others.

**Camera position is a constant, not a variable.** The PRD fixes the player at
room centre. There is no movement system and nothing here should grow one.

### Judgment calls

- **Drag-to-look, not pointer lock.** Pointer lock feels more like an FPS but
  hides the cursor, and phase 4 needs it for clicking panels and typing into the
  Clue Board. Drag keeps the cursor, works the same on a trackpad, and needs no
  permission banner. Arrow keys also look, so it is not drag-only.
- **`graphics.js` is new** — the tier is now shared state. Two renderers and one
  toggle meant each renderer tracking its own tier would let the button describe
  one while the other disagreed.
- **Lobby arch pauses when the room opens** (`backdrop.pause()`), keeping its
  context but not drawing. Two live WebGL renderers would double GPU cost for a
  scene nobody can see.
- **Bloom and SSAO are still not implemented.** High currently means soft shadow
  maps, ACES tone mapping, higher pixel-ratio cap, denser dust, and accent
  lights. The post-processing chain is deferred to phase 3 deliberately — an
  empty room has nothing worth blooming. Shadows are enabled and correct, but
  have little to fall on until phase 3 puts objects in the room.
- **An FPS readout is in the scene HUD.** That number is what decides whether
  the "runs on a school laptop" goal is actually met, so it is measured rather
  than assumed.

### Bugs found and fixed during verification

- `Object.assign(mesh, { position: ... })` threw — `Object3D.position` is a
  read-only accessor and must be mutated with `.set()`, never replaced.
- The engine sized itself once at construction from `window.innerWidth`. If it
  booted while the canvas was `display:none` or the page was hidden, it got a
  0×0 buffer and stayed broken until something fired a resize. Sizing is now
  checked per frame against the canvas's laid-out size, which self-heals.
- The frame loop gated on `document.hidden`, so an embedding context that
  reports hidden while still compositing never drew a single frame. Removed —
  browsers already stop `requestAnimationFrame` for backgrounded tabs, so the
  check bought nothing and broke that case.
- Room materials and lights were far too dark; the room rendered essentially
  black. Surfaces are now much lighter than the HUD palette they sit next to.
- Dust rendered as hard squares (`PointsMaterial` with no map). Now uses a soft
  round sprite generated into a canvas at runtime — no asset, no CDN. Motes are
  also excluded from a 1.4 m sphere around the camera, which was producing
  giant blobs directly in the player's face.
- The engine's failure path claimed a connection problem and swallowed the real
  error, sending debugging in exactly the wrong direction. It now logs the
  actual error and says to check the console.

### Verified

Two tabs: host starts → **both** clients enter the room off the server
broadcast. Drag and arrow keys both rotate the camera, pitch clamps short of
vertical, the look hint dismisses on first look, "Face the wall" recentres,
"Leave run" disposes the engine and hands the screen back to the lobby arch.
Refreshing mid-run rejoins straight back into the room, because the server owns
the phase. The GFX toggle switches both renderers and persists. Server-side room
lifecycle tests still pass 10/10.

---

---

## Phase 3 — the first room

`public/js/scenes.js`. The **first room only**; the other four are not built.

**Architectural change:** the room shell moved out of `engine.js`, which had
always marked it as temporary. The engine is now purely renderer, camera, look
controls, loop and global lighting, and rooms are mountable objects:

```js
engine.mount(createRoomOne({ dimensions: engine.dimensions }))
```

A room is `{ group, panels, update, applyTier, dispose }`. `engine.dimensions`
is the single source of room size, so scenes.js builds against real numbers
rather than restating them and drifting.

### What's in it

- **Three panels on the north wall**, colour-coded by the meaning fixed in
  phase 1: **rose = Fragment** (private, yours alone), **aqua = Clue Board**
  (shared), **amber = Answer Lock** (the thing that penalises you). Each has a
  recessed housing, an emissive screen, corner brackets and a status pip.
- **A sealed door** on the south wall with an amber seal bar. It is the reason
  the room matters, so it is visible from the start rather than appearing on a
  win.
- **Deck plating and wall seams**, a waist-height trim rail for scale, ceiling
  light strips, drifting dust, and a slowly rotating **ceiling core** overhead
  (it goes on the ceiling because the camera stands at room centre — anything
  placed there would be inside the player's head).

**All surface detail is drawn into a canvas at load time, not loaded as image
files.** That keeps the game asset-free and CDN-free, which matters on a
locked-down school network, and a 512px canvas costs less than the HTTP request
an image would need.

### Ready for phase 4

Each panel exposes `screen.userData.panelId` for raycasting, plus `focusYaw` /
`focusPitch` — where the camera should *rotate* to frame it. Framing is a
rotation, never a move, because camera position is fixed at room centre.
Measured: fragment +26°, clues 0°, lock −26°, all pitch 0.

The engine also exposes `isDragging` and `dragDistance`, so phase 4 can tell a
genuine click on a panel from the end of a look-drag.

### Panel screens say STANDBY on purpose

There is no puzzle content until phase 5. Drawing plausible-looking values now
would misrepresent how far along this is, so the idle screens say what is
actually true.

### Bug found and fixed

The room rendered nearly black after texturing. `MeshStandardMaterial`
**multiplies** `color` into `map` rather than replacing it, and both were set to
the same dark slate. Textures now carry the colour and the tint stays at or near
white — the north wall keeps a deliberate sub-white tint (`0xb9c6d8`), which is
what the multiply is genuinely useful for.

The ceiling core was also built far too large: it sits only ~1.5 m above eye
level, so a ring that reads as modest in plan filled half the view when you
actually looked up.

### Verified

Two clients enter the same room. All three panels render with correct colours
and labels, the door and trim read correctly, the ceiling core rotates. High
tier now shows **real shadows** — panel housings and the trim rail cast onto the
walls, which is the first time the shadow rig has had geometry worth casting.
Server tests still 10/10.

---

## Not yet built (deliberately)

No raycasting, no click handling, no camera framing, no overlays, no puzzle
content. Panels are scenery that carry the metadata phase 4 needs.

---

## Room design (all six spaces) — see [ROOMS.md](ROOMS.md)

Designed ahead of schedule at Aarav's request, before phase 4. **Nothing built.**

Six rooms: Archive, Engine Room, Observatory, Vault, Spire, Vestibule. Full
mesh inventories, canvas texture techniques, lighting grids, particle systems,
the cross-room dependency graph, a performance table and a build order all live
in `ROOMS.md`.

The one thing to carry forward if that file is ever lost: **distributing
information is not the same as distributing agency.** Every player holding a
different piece prevents solitaire but does nothing against one dominant player
saying "everyone read me your panel" and doing all the reasoning. Four mechanics
resist it — expiring values, simultaneous two-room actions, shapes that must be
described rather than dictated, and co-signed submissions — and the outcome is
converting the alpha from soloist to conductor, not eliminating them.

Six decisions are still open and blocking, listed in ROOMS.md §9. The two that
gate everything: **minimum player count** (design says 3, PRD says 2) and
**whether `engine.js` may take an additive per-room environment hook**.

---

## Step 0 — shared roomkit (done)

Prerequisite for the six-room build. Written before any new room because the
performance critic was blunt: write these now or they get copy-pasted six times
and one copy drifts.

```
public/js/roomkit/canvas.js     canvas + texture layer, grime kit, singletons
public/js/roomkit/geometry.js   atlas quads, shell, rail, strips, panels, door, dust
public/js/rooms/room-one.js     phase-3 room, rebuilt on the kit
public/js/scenes.js             now just a registry: id -> factory
tests/roomkit.browser-test.js   11 assertions, paste into DevTools console
```

**`makeAtlasQuads` is the important one.** It merges N independently positioned,
independently textured quads into ONE geometry against a shared atlas. It is what
makes 48 legible index cards cost one draw call instead of 48 — without it the
Archive alone would spend 100+ draws on text.

**Engine environment hook** (`room.environment`) is additive: every field
optional, every default identical to the previous hard-coded value, restored on
unmount so one room cannot leak lighting into the next. Four rooms need it —
one is on backup power, one is lit from below, two are open to the sky — and
without it the global 2.1-intensity ambient contradicts their whole concept while
still costing full per-fragment shading. `fitShadowFrustum` also adapts to rooms
that are not the standard box.

### Verified

- Room one renders identically through the kit, both tiers, clean dispose.
- **Draw calls 33 → 24**, free: the trim rail and ceiling strips now merge into
  one mesh each instead of four separate ones.
- 11 browser assertions pass, including the V-flip case — canvas Y runs top-down
  while UV V runs bottom-up, so a missing flip renders every label upside down.
  That bug would have surfaced inside the Archive looking like a texture problem
  rather than a UV one.
- `lcg` determinism confirmed: same seed → identical sequence, zero correlation
  across seeds. Three rooms need this so every client builds an identical room
  from a server seed.

### Decisions made without an answer (flagged, reversible)

- **Engine hook: went ahead.** Purely additive; "don't redesign the engine API"
  is not violated by an optional field. One property to delete if unwanted.
- **Minimum player count: still unanswered and still needed.** It does not block
  Archive/Engine/Observatory, because that trio *is* the 3-player base case
  either way. It blocks step 4 (server puzzle state), where the
  secret-distribution contract cannot be written without knowing the floor.

---

## Random chamber spawning

`server/chambers.js`. "Room" was overloaded — a *session* (a room code) now
contains several *chambers* (Archive, Engine Room, Observatory). Worth the small
naming friction, because `room.rooms` would be unreadable.

**Assignment is server-side and authoritative.** It has to be: a client that
picked its own chamber could pick the one holding the value it needs, which
collapses the cross-chamber dependency the whole game rests on. Uses
`crypto.randomInt`, the same source as room codes and player tokens.

Rules, in priority order:
1. Every chamber that can be occupied **is** occupied — an empty chamber holds
   information nobody can reach, which can make a session unsolvable.
2. Nobody is alone in a chamber while another sits empty.
3. Surplus players double up, spread evenly.

Two players sharing a chamber is a feature, not a fallback: they still have to
talk to the other chambers, and a less confident player having someone beside
them is squarely on-thesis.

- `chamberId` lives **on the player**, so a reconnecting player returns to the
  same chamber. Coming back somewhere else would strand whatever the crew had
  already worked out about theirs.
- It is **public** in room state. Everyone needs to know who is standing where or
  they cannot aim a question at the person who can answer it. It leaks nothing:
  what a chamber *contains* is only visible to whoever is in it.
- Under-crewed sessions are **warned, not blocked** — the server says how many
  chambers were left empty rather than refusing to start, because a pair wanting
  to look around should be allowed to.
- A crew roster is permanently on screen in the scene HUD showing who is where.
  Behind a keypress it would be invisible to the player least likely to go
  looking, who is exactly the player this game exists to stop being sidelined.

Tested: `scratchpad/chambers-test.mjs`, 11 assertions — no chamber empty at 3
players, even spread at 4–6, join order confers nothing, layout genuinely varies
across 300 trials, late joiners get the emptiest chamber, reconnects keep theirs.

---

## Chamber build status

| Chamber | Module | State |
|---|---|---|
| Archive | `rooms/archive.js` | **Built, renders, playtested by Aarav (58fps HIGH)** |
| Observatory | `rooms/observatory.js` | Written, complete, **not yet verified or reviewed** |
| Engine Room | — | **Not written.** Agent died mid-build. |

The build workflow **failed**: two agents lost their connection and one hit the
account session limit. `archive.js` and `observatory.js` were written before the
failures and are complete (valid syntax, proper exports, correct file endings);
`engine-room.js` never got written and no review pass ran on any of them.

`server/chambers.js` `CHAMBERS` deliberately lists **only chambers whose client
module exists**. Listing one early means the server deals players into a room the
client cannot load and they get silently dropped into the fallback — which looks
like a spawn bug and is miserable to diagnose. Add entries as modules land.

### Changes from Aarav's first playtest

- **Particles removed from the rooms.** He did not want them, and they had a real
  bug: the cloud filled the whole floor plan and drift was a Y-rotation of the
  entire cloud, so a mote in a corner (5.5m from centre) swung straight through a
  wall standing 4.2m away. Any rotating cloud in a rectangular room has this
  defect. Fixing it properly would need per-particle bounds work — exactly the
  per-frame CPU cost the particle approach exists to avoid.
- **Ceiling lighting now works.** The Archive was designed with dead overhead
  lighting to make it the dark room. That read as atmospheric in a screenshot and
  as "I cannot see the room" in play. Four pendant fixtures, each with a visible
  body and a real light, keeping the room's rule that nothing is lit by an
  invisible source. Ambient raised 0.5 → 1.35.
  - **Only the diagonal pair casts light on LOW** (keeps the room at 4 lights,
    the budget). The other two keep their lens emissive so all four still *look*
    lit. The lit pair burns 1.5x brighter to compensate, so brightness barely
    changes between tiers — a tier switch must never change what a player can
    read.
- **More books.** Thinner spines, tighter packing: **861 volumes**, still one
  `InstancedMesh`, still one draw call. 38 draw calls total.
- **`me.chamberId` was stale** — captured at join, before chambers are dealt, and
  never refreshed from the broadcast. Every player would have mounted the fallback
  room instead of their assigned chamber. Fixed in the `room:state` handler.
- **Room loading is now lazy** (`await createRoom(id)`), so a missing or broken
  chamber fails alone instead of taking down every room including working ones.

---

## Movement + collision (20 Jul, Aarav's decision — overrides the PRD)

The PRD's "camera fixed at room centre" was a scope rule, not a design rule, and
the owner changed it before more rooms were built — the cheap moment.

In `engine.js`, not per-room:
- **WASD walks** (2.1 m/s, Shift sprints ×1.8). `event.code` is physical, so
  AZERTY gets ZQSD for free. Arrow keys still look — both verbs, opposite hands.
- **Player is a circle** (r 0.32) on the floor plan. Eye height fixed: no jump,
  no crouch, so every readability decision made for the fixed camera stays valid.
- **Walls are automatic** from `room.dimensions`; furniture via `room.colliders`
  ([{x, z, hw, hd}]); circular rooms via `room.keepInsideRadius`.
- **Axis-separated resolution** — rejecting one axis while accepting the other is
  what makes the player slide along a shelf instead of sticking.
- Keys clear on window blur (alt-tab with W held would walk forever).
- WASD ignored while typing (phase 4 overlays put inputs on screen).
- Movement runs under prefers-reduced-motion: that setting is about ambient
  motion, not the player's own deliberate travel.
- `engine.step(dt)` advances one frame by hand — the preview pane suspends rAF
  entirely, so the loop cannot be exercised there. Same code path as the loop.
- Panel `focusYaw/focusPitch` are now only correct at centre. **Phase 4 must
  recompute framing from `engine.getPosition()` at click time.**

Verified by stepped simulation: walk speed exact (2.52m in 1.2s), sprint exact
(3.78m/s), north wall clamps at 3.82, Archive shelf stops at 3.34, cabinet at
3.34, Engine Room piston bank at 2.27, wall-sliding works.

### Pointer lock ("shift lock", Aarav's request)

The drag-look-vs-cursor tension flagged when movement went in: phase 4 needs a
cursor for panels, but free-look feels better. A toggle gives both.

- **Ctrl** toggles pointer lock; **Esc** also releases it (browser-enforced,
  cannot be overridden — so Ctrl coexists with it rather than replacing it).
- `event.repeat` guards the Ctrl auto-repeat, or holding it flickers the lock
  every frame.
- When locked, `onPointerMove` steers from `event.movementX/Y` (the OS cursor is
  frozen, so client coords are useless); when unlocked it's the old drag path.
- `onPointerDown` early-returns while locked — clicks are reserved for phase 4's
  reticle interaction, not dragging.
- Reticle is the mode indicator: dim (0.4 opacity, 22px) in cursor mode, bright
  (1.0, 26px, full aqua ring) when locked, via `.scene.is-locked ~ .scene-hud
  .reticle`. The class is toggled in `onPointerLockChange`, the single source of
  truth — so a browser-driven Esc exit updates the visual too.
- Lock is released in `dispose()`, or leaving a run would trap the cursor on the
  lobby.
- A refused lock (Esc cooldown, no user activation) is caught and logged;
  drag-look keeps working, so it degrades rather than errors.

Verified: Ctrl attempts the lock without throwing, auto-repeat guard holds it at
one request, `pointerlockchange` toggles the `is-locked` class both ways,
`movementX` steers correctly (100px → −0.26 rad), reticle CSS resolves to the
right values in each state. Real pointer lock needs a genuine user gesture the
preview pane can't supply, so **entering true lock is untested — needs one click
on the real machine.**

## All five playable chambers live (21 Jul)

| Chamber | Draws | Lights | Notes |
|---|---|---|---|
| Archive | 38 | 4 | 4.6m ceiling, 861 books, carousel, working pendants |
| Engine Room | 30 | 3 | 7.2×7.2×2.9, flywheel strobe, only see-through floor |
| Observatory | 33 | **0** | 2.4m parapet under glass, sky-lit, `keepInsideRadius 2.2` |
| Vault | 33 | 4 | 6.6×6.6×2.6 — smallest/lowest, backup power, drum stack |
| Spire | 21 | 2 | **The finale.** 8.4×8.4×4.8, open-air dawn, `cameraFar 220` |

`server/chambers.js` now lists all five, so a 5-player crew gets five distinct
chambers (verified end-to-end) and a 6th doubles up.

### The Spire

Written by hand — the build workflow died on a session limit before it started.
Open stone lantern at pre-dawn: three walls stop at a 1.1m parapet, the north
wall runs full height and carries the panels. Sky is one baked gradient (violet →
magenta → orange → gold at the horizon) with the *time of day* applied as a tint
multiplied over it — one colour lerp per frame instead of redrawing a canvas.
`setDawn(progress)` is the phase-5 hook; until then it runs one-way to full light
over 100s and holds, because a player who waited for the sunrise should not watch
it un-happen.

Shares a world with the Observatory: same cloud deck, same moon on the same
compass bearing at a lower altitude (this tower is higher, dawn further along).
Five neighbouring towers at bearings, each with one lit window in its chamber's
hue — the Spire is the only room that can see the others.

### Bugs found and fixed while verifying

- **Camera far plane was 60m**, so the Spire's sky dome (90m), towers (62m), moon
  (72m) and stars (80m) were all silently clipped — the room rendered as bare
  clear colour and looked broken rather than near-sighted. `environment.cameraFar`
  is now part of the contract; interiors keep the tighter 60m default, the Spire
  asks for 220. The Observatory escaped this only because its dome is 6.2m.
- **Two towers were behind the north wall.** It occludes bearings 315°–45° and
  two towers sat at 22° and 297° — geometry no player could ever see. All five
  bearings moved into the open arc.
- **Tower windows were buried inside their own towers.** Scaling the tower's
  centre position toward the origin by 98.5% moves it 0.9m on a ~5m-wide tower;
  it needs the half-width subtracted. Rotation was wrong too — `-bearing`, not
  `bearing + PI`, because RotationY(t) sends +Z to (sin t, 0, cos t).
- **The horizon gold band was ~0.6% of the sky texture** — about one degree of
  sky, technically a sunrise and visually a hairline. Widened substantially.
- **Aqua panel wash was turning the Spire's warm stone green**, fighting the gold
  the whole room is built on. Tightened to pool on the panel faces only.
- Chamber tests hardcoded "3 chambers" and broke when there were 5 — they now
  derive every assertion from `CHAMBERS.length`, so adding a chamber can't
  silently invalidate the suite. 11/11 pass.

### Lighting: a standing rule, learned three times

The Archive, then the Vault, then the Spire all shipped too dark and all three
had to be re-lit after Aarav played them. That is a pattern in the process, not
three separate slips: rooms get tuned to look atmospheric in a still frame and
are then unusable to stand in. **Readability is a correctness requirement — a
value a player cannot read is a bug, and mood is never a reason to lose one.**

Check every new room against this before calling it done:

- **Ambient is the cheap lever.** It is one uniform, so raising it costs nothing
  per-light. Reach for it before adding lamps. All three fixes were mostly this.
- **Fog range must clear the room.** The Vault's real culprit was fog at
  near 4.5 / far 13 in a room whose diagonal is 9.3m — every wall was already
  fading to black before a single lamp reached it. Fog should soften far
  corners, never drain the space.
- **Point-light range must exceed the room diagonal**, or the far corners get
  literally nothing. The Vault's lamps had 6–8m range in a 9.3m-diagonal room.
- **A dark concept does not require a dark room.** "Backup power" is carried by
  dead ceiling strips and emergency-coloured sources, not by starving ambient.
- **Never let a room open at its darkest state.** The Spire began at dawn 0 and
  took 100s to brighten, so an arriving player stood in the dark for a minute.
  It now opens at 42% and still has most of its sunrise left to give.

---

## Phase 4 — raycasting and the panel overlays

`public/js/hud.js`, plus a focus system in `engine.js` and two server events.

**Engine additions:** `pickPanel(ndcX, ndcY)` raycasts against the three panel
screens; `focusPanel(panel)` swings the camera to face it; `releaseFocus()`
hands control back. Framing is **computed from where the player is standing at
click time**, not from the rooms' stored `focusYaw`/`focusPitch` — those were
measured from room centre when the camera could not move and are wrong anywhere
else. Look and movement are held while a panel is open, so closing it never
drops the player somewhere they did not choose to be facing.

**Two pointing modes, one code path.** Cursor mode raycasts from the mouse;
pointer-lock mode raycasts from screen centre (the reticle *is* the pointer).
`aimPoint()` returns a normalised aim point either way, so nothing downstream
knows or cares which mode is active. In locked mode hover is re-evaluated on a
100ms tick, since the pointer never moves — one raycast against three quads.

**A drag that ends on a panel does not open it.** `engine.dragDistance` is
checked against a 6px slop; past that the player was turning to look.

### What is real vs. honest placeholder

- **Clue Board is fully working** — a server-held shared scratchpad every player
  sees live, whatever chamber they are standing in. Verified 10/10 round trips
  in both directions. It is not puzzle content, it is the tool the crew uses to
  pool what they can each see, which makes it the most on-thesis thing to have
  working first. Debounced 220ms; server is authoritative and re-broadcasts to
  the author too, so the echo is what confirms the text actually landed.
- **Fragment** names the chamber and says plainly that no fragment is issued yet.
- **Answer Lock** submits and gets an honest `NO_PUZZLE` reply from the server.

Neither fakes puzzle content. Phase 5 fills both in.

### Deviation from the PRD

The PRD names `CSS2DRenderer` for panel overlays. These are **screen-space DOM**
instead: CSS2D anchors elements to a 3D point, which is right for a label
floating over an object and wrong for a panel you type into — it scales with
distance, fights the camera, and is awkward to focus with a keyboard. The camera
already tweens to frame the panel, so the overlay can sit over it in screen
space and stay crisp, reachable and accessible.

### The `[hidden]` bug — and why the tests missed it

Aarav found the overlay stuck open in every chamber: title reading "PANEL", no
body, Escape doing nothing.

**Cause:** the browser implements `hidden` as `display: none` in its *own*
stylesheet, and author CSS always wins. `.panelui { display: grid }` therefore
defeated it outright, so the overlay was visible from page load in its empty
default state and every `el.ui.hidden = …` was toggling a property with no
effect. `.gfx { display: flex }` had the identical latent fault.

Fixed with a reset — `[hidden] { display: none !important; }` — rather than
patching the two selectors, because this is an invariant no component rule
should be able to override by accident. Auditing the other five
`hidden`-attribute elements found the rest safe (none set `display`).

**Why the tests passed anyway, which is the real lesson:** they asserted on
`element.hidden`, the *property*, which was correctly `true`/`false` the whole
time. The property was never the thing that mattered.

> **Assert on `getComputedStyle(el).display`, not on `el.hidden`.** A visibility
> test that never asks the browser what it actually rendered is not a visibility
> test. The same applies to anything CSS can override — a class being present is
> not proof the style took effect.

The verification now checks computed display for open, correct body, and
hidden-after-Escape across all three panels.

### Bug found and fixed

**The Observatory let the player walk off its pier.** `keepInsideRadius` was 2.2
against a pier of radius 1.6, so a player could step past the rim and stand in
mid-air over the sunken deck 2.2m below. Now 1.25 (pier radius minus the 0.32
player circle). Phase 4's framing work is what surfaced it — the panels sit at
deck-eye-height, 27° below a player standing on the pier, which sent me looking
at the room's vertical layout.

---

## Phase 5 — puzzles and the penalty engine

`server/puzzles.js` plus run state in `rooms.js`. All generation and all
validation are server-side; a client that could see the generator could see
every answer.

**The ring.** Occupied chambers form a cycle: chamber *i*'s puzzle needs a key
printed only in chamber *i+1*, and chamber *i* holds the key chamber *i−1*
needs. Everyone needs someone and everyone is needed — no dead end, no
spectator, no chamber solvable alone. A ring rather than a hub, because a hub is
exactly the shape that lets one dominant player sit in the middle.

**Two puzzle types**, alternating around the ring so every session has both:
- **Cipher** — a shifted word; the shift lives next door.
- **Sequence** — four tokens; the order lives next door.

**The penalty.** Wrong answer → that chamber locks for 30s. The deadline is a
server timestamp, so it survives a refresh, ignores the client clock, and
rejects a correct answer submitted during the lock (otherwise: guess, learn,
retry instantly). Broadcast to the whole crew per the PRD.

**Deviation, deliberate:** the lockout is **per chamber, not per room**. The PRD
was written when there was one room. Freezing five players for one person's
mistake would manufacture exactly the blame dynamic the SOI exists to prevent.
Everyone still *sees* it — transparency without collective punishment.

**Win:** all chambers open → "Nobody escaped alone", with crew size, time and
lockout count.

### The bug that mattered: the dependency was fake

Every chamber was handed the key to **its own** prompt, so any player could
finish alone. The graph looked perfect on paper — pointers all agreed — and the
game's single load-bearing property was absent.

`generatePuzzles` built `{answer, prompt, key}` as one unit, where `key` is what
solves that same prompt, then stored `key: entry.key` on the same chamber.
It now stores the **previous** chamber's key.

**My test passed while this was broken.** It asserted `keyForChamberId` and
`needsKeyFromChamberId` pointed at each other — bookkeeping agreeing with
itself. It never applied a key to a prompt.

> **Test the outcome, not the bookkeeping.** This is the third time the same
> shape of mistake has shipped: `[hidden]` (asserted the property, not the
> computed style), the dark rooms (checked the lights existed, not that the room
> was legible), and now this. A test that never performs the operation the
> feature exists to perform is not a test of that feature.

There are now tests that **solve every puzzle with its neighbour's key** and
assert it **fails** with its own.

A second, subtler flaw surfaced from that: two chambers can independently roll
the same shift or order, and if the collision lands on adjacent chambers the
holder can self-solve. Type alternation hides it on even crews and exposes it at
the wrap point on odd ones — about one session in five at five chambers. A
bounded repair pass regenerates any colliding chamber.

### Verified

- `scratchpad/puzzles-test.mjs` — 21 assertions: ring topology, solvability with
  the neighbour's key, unsolvability with your own, answer never in any client
  payload, lockout arithmetic, per-chamber isolation, win condition.
- `scratchpad/run-e2e.mjs` — a full session against the live server with two
  real socket clients: start → read each other's keys → wrong answer → lockout →
  **disconnect and rejoin mid-penalty** (lockout survives) → solve → win. 22/22.

---

## Real puzzles — designs done, foundation built, rooms not yet wired

Aarav rejected the phase-5 puzzles as **lookups, not puzzles**: one panel printed
a cipher text, the neighbour's printed the shift, and "solving" was reading a
number aloud. No deduction. His correction, verbatim:

> *"in observatory, there is a telescope with a certain set of meteors, the
> player must identify how those meteors pair, convert it into a code, then pair
> it, then get the key, do stuff like that"*

Required shape: **observe → deduce → derive**, with the neighbour's key gating
*how to read* the result rather than being it. Agreed parameters: **15–25s
observation cycles**, **read-the-room-and-type** (no clicking 3D objects — that
interaction system does not exist).

Five designs are in `design/*.json`, one per chamber. Summaries:

| Chamber | Observe | Deduce | Key gates |
|---|---|---|---|
| Observatory | Meteors dying on 6 bright chain stars, two lit at a time | Chain height maps to the parapet's declination-sorted frieze | Which of each pair to log (4 bits) |
| Vault | 6 drums stepping in unison; blue backlights | A bar lights only on a *live* collar; all-six-lit = shear line | Start slot + direction along the shaft |
| Engine Room | A coolant slug crawling past 6 numbered stations | Each gauge vents exactly when the slug hits *its* station | The order to enter the four readings |
| Archive | 4 gaps of different sizes in the 48-card carousel | Gap size identifies a withdrawal; call number → shelf section | What the gap counts *mean*, plus order |
| Spire | 5 tower lanterns blinking and answering | Blink count = how many lanterns clockwise the answerer is | Where to cut the closed loop |

### Foundation built (prerequisites — every puzzle needs these)

Three blockers found by verifying the designs against real code:

1. **`elapsed` was per-client.** It counted from *your* engine mount, so two
   players in one chamber (happens at 6 players) would see different states and
   read different answers. There is now a **run clock**: the server sends the run
   epoch, every client derives its offset once, and rooms animate from that. One
   number, no per-frame sync.
2. **`prefers-reduced-motion` froze `update()` entirely** — an accessibility
   lockout, since the puzzles are read from moving objects. Rooms now always
   update and receive a `reducedMotion` flag to calm their *ambient* motion,
   while anything the puzzle depends on keeps moving.
3. **No seed reached the client.** Puzzles now carry `seed` and `epoch`; rooms
   build their arrangement from the seed. The seed is not secret — it describes
   what is painted on the walls, which that player can see anyway.

`update(dt, elapsed)` → **`update(elapsed, dt, { reducedMotion })`**, migrated
across all six room modules.

### Tests moved into the repo

`test/puzzles.test.mjs` (19 assertions, all green). The previous copies lived in
a temp scratchpad and were **lost when it was cleared**, taking the regression
cover for the fake-dependency bug with them. Tests belong in the repo.

Run with: `node test/puzzles.test.mjs`

### Server side: DONE

`server/puzzle-defs.js` — all five puzzles, each generating a seeded arrangement
and exposing `solve(config, key)` so tests can prove solvability rather than
assume it. The old cipher/sequence lookup builders are **deleted**.

Because each chamber has its own puzzle *kind*, the self-solve collision that
needed a repair pass cannot arise: a "read rule" cannot open a lantern loop.

**Run `npm test`** — 62 assertions across three suites:

| Suite | Covers |
|---|---|
| `test/puzzle-defs.test.mjs` | each puzzle solvable with its key, unsolvable with a wrong one, answers sayable aloud, arrangements vary, config never holds the answer |
| `test/ring.test.mjs` | the five compose — no chamber solvable alone, by its own key, or by *any* key but its neighbour's |
| `test/penalty.test.mjs` | lockouts, per-chamber isolation, win condition |

#### Three real bugs the tests caught

1. **The Observatory's key was too weak.** Four bits = 16 readings, so a *wrong*
   key coincidentally produced the right answer in ~6% of sessions, quietly
   making the neighbour optional. Now five falls **and** the generator rejects
   any arrangement where a different bit pattern yields the same answer — the
   property is guaranteed, not merely likely. (Adding falls alone never fixes
   this: two falls can share a letter pair, so flipping both cancels out.)
2. **Solvers parsed foreign keys.** The Observatory split `"BLUE — VAULT"` on
   its hyphen and could land on its own answer. Every `solve()` now rejects a
   key of the wrong `kind` before parsing.
3. **`build()` passed unkinded keys to `solve()`**, so once guard 2 landed, the
   Archive and Spire generated **empty answers**. Caught immediately because
   `ring.test.mjs` solves rather than inspects.

All three are the same lesson as before: these were only visible because the
tests *perform the operation* instead of checking that the bookkeeping agrees.

### Rooms wired so far: Vault, Observatory

Each gets a test that **simulates its animation and reads it as a player would**,
then checks that against the server's answer. `npm test` — 80 assertions.

**Vault** (`test/vault-room.test.mjs`)
- Drums now step in UNISON. Six free-running rates looked busier but made the
  puzzle impossible: the shear line only exists if they are in lockstep.
- Backlights split from one merged mesh into six independent materials — each
  reports whether *its* drum sits on a live collar, which is the tell the whole
  puzzle is read from. +5 draw calls, worth it.
- Collars redrawn with engraved SHAPES matching the drum faces. They showed
  two-letter room codes before, so matching a drum to a collar was impossible.
- Bank dwells a double beat on the shear line; verified >2s readable, with
  near-miss frames (5 of 6 lit) so a careless glance is punished.

**Observatory** (`test/observatory-room.test.mjs`)
- Six chain beacons on `group`, not `sky`, so they never drift with the star
  field. Meteors are one merged 2-quad mesh, moved by rewriting 8 vertices.
- Verified: the two candidate strings genuinely differ, so the room alone cannot
  choose — and the blackout makes the fall order phase-invariant, so two players
  who mounted at different times log the same sequence.

Two visual bugs, both only findable by looking:
1. **The chain spanned 80° of azimuth** against a 62° FOV — impossible to see as
   one line, which is the entire deduction. Tightened to 30°.
2. **Additive blending saturates.** Struck beacons were set to 3.2 brightness
   against 0.3, a 10× ratio in the data — but everything past 1.0 clips to
   white, so on screen they looked identical. Prominence now comes from SIZE
   (2.6×) via a per-point `beaconSize` attribute patched into PointsMaterial.
   The numbers said it worked; the picture said it didn't.

### Not yet done

**Engine Room, Archive, Spire** still animate the old way and ignore `config`.
Also outstanding: the Fragment panel renders the old prompt shape and needs a
per-puzzle brief.

### Still deferred

The **Vestibule/lobby** is the sixth space and is deliberately last, per Aarav.
It has no Answer Lock (ROOMS.md §1) — it is staging and a relay, not a puzzle
chamber, and is not spawnable.

---

## The earlier three chambers

| Chamber | Draws | Room lights | Notes |
|---|---|---|---|
| Archive | 38 | 4 (LOW) | 4.6m ceiling, 861 books, carousel, working pendants |
| Engine Room | 30 | 3 | 7.2×7.2×2.9. Flywheel strobe, pistons, gauges. Written by hand after the workflow died. |
| Observatory | 33 | **0** | 2.4m parapet, sky-lit, `keepInsideRadius: 2.2` |

- Engine Room: glow-bed light intensity is driven from the flywheel's angle, so
  the light and the geometry causing it can never disagree. Gauges carry
  symbol-only labels (the identity key lives in the Archive — the asymmetry IS
  the dependency). Valve schedule + cipher prefix stencilled in pointer-violet.
  Needle values seeded via shared LCG so both clients read the same gauges.
- Observatory: player confined to the instrument pier — walking through a
  rotating brass ring would break the room harder than any wall clip. The
  **starfield Points cloud stays**: it is the sky beyond the parapet, not indoor
  dust; it cannot wall-phase. Flagged to Aarav as a judgment call.
- 3-player session verified: three players dealt three different chambers, each
  client mounts what it was dealt.

## Next

**Build order in progress** (agreed with Aarav): step 0 roomkit ✅ → **Archive** →
Engine Room → Observatory → **stop and playtest the 3-player core** → server
puzzle state → Spire → Vault → Vestibule. Full design in [ROOMS.md](ROOMS.md).

Then phase 4 — raycasting and panel UI (`hud.js`). Click the three wall panels,
tween the camera to frame each, open a CSS2D overlay for Fragment / Clue Board /
Answer Lock.

Groundwork already in place:

- `panel.screen.userData.panelId` for the raycast hit.
- `panel.focusYaw` / `focusPitch` for the framing tween — rotation only, since
  camera position is fixed.
- `engine.isDragging` / `engine.dragDistance` to reject a click that was really
  the end of a look-drag. Use a small pixel threshold rather than a time one.
- Hover state should light `panel.glowBoost`, which `update()` already adds into
  the screen's emissive intensity each frame.

Note the drag-to-look decision from phase 2 pays off here: the cursor is always
available, so panels can be clicked and the overlay typed into without releasing
and recapturing a pointer lock.

There are now emissive panels worth blooming, so High's bloom/SSAO chain is
finally worth its cost — but do it *after* the interaction works, not before.

---

## Hosting — decided plan, execute at phase 6

Deliberately deferred to phase 6 per the PRD's own build order. Written down
here so the plan survives the conversation it was made in.

### Why a host is needed at all

| Address | Reaches |
|---|---|
| `localhost:3000` | only this Mac |
| `192.168.0.154:3000` | same wifi only |
| hosted URL | anyone, any network |

Home routers refuse inbound connections from the internet, so the LAN IP is
invisible from outside the house. The success criterion ("two people, two
networks") cannot be met without a host.

**Recommended host: Render**, free tier. Railway, Fly.io and Glitch are all
comparable; Render is picked for the simplest GitHub-to-deploy path.

### The deploy contract is already satisfied

Nothing in the code needs to change to deploy. Confirmed:

- `package.json` has `"start": "node server/index.js"`
- `package.json` has `"engines": { "node": ">=18" }`
- `config.js` reads `process.env.PORT` — hosts assign the port at runtime
- No filesystem writes; room state is in memory
- Socket.io is same-origin, so no CORS configuration

Deploying also *fixes* one thing: the copy-link button currently falls back to
manual selection because `navigator.clipboard` needs a secure context. Render
provides HTTPS, so it will simply work.

### Steps

Local prep:

1. `git init`, first commit. The existing `.gitignore` keeps `node_modules` out
   — important, Render installs those itself.
2. Add `render.yaml` so settings live in the repo, not in dashboard state
   nobody remembers later.
3. Write `DEPLOY.md` with the click-by-click.

Requires a human (accounts cannot be created on someone's behalf):

4. GitHub account; create a **new empty repo** — no README, it conflicts with
   the first push.
5. `git remote add` + `git push`.
6. Render account via **"Sign in with GitHub"** — authorises in one step.
7. New → Web Service → pick the repo. Build `npm install`, start `npm start`,
   instance type **Free**.
8. First build runs 2-3 min. Result: `https://<name>.onrender.com`. Every later
   `git push` auto-redeploys.

### Verify after deploying

- Socket.io negotiated a real **WebSocket** and did not silently fall back to
  HTTP long-polling. Both work; polling is laggy and worth catching.
- Two clients on genuinely different networks see each other live.
- `/healthz` responds.

### Two constraints to remember

**Cold start.** Free tier sleeps after ~15 min idle; the first visitor then
waits 30-50s. It stays awake while people play. Load the page a minute before
demoing to anyone.

**In-memory state means exactly one server process, permanently.** This is fine
at this scale and should stay. But it is the reason never to raise Render above
one instance: player A would land on instance 1 and player B on instance 2, in
different rooms sharing a code, with no error explaining why. Scaling out would
require a Redis adapter to share room state. Not a problem to solve now — just
never press "scale up" without doing that first.

---

## Vault repair — the room was unsolvable, not just dark

The Vault's puzzle logic had been correct and tested since Phase 5. The room
rendering it was not. Four separate faults, none of which any existing test
could see, because every test simulated `bankPhase()`/`faceAt()` and none of
them touched the renderer.

**1. All eight collars drew the same mark.** `drawGlyph(ctx, kind)` switched on
numeric indices `0..7`, but the server sends glyph *names* (`'triangle'`,
`'chevrons'`, …). Every collar fell through to `default` and rendered a double
bar. A player could read the drums perfectly and still have nothing to match
them against — the matching step was impossible, not hard.

**2. The drums showed the wrong glyph, on a seam.** Seating at `k *
DETENT_STEP` parks a cell *boundary* in the read window, and the half-glyph
showing was face `(6-k)`, not the face `k` that `faceAt()` reports and lights
the drum from. The lit/dark tell was being computed for a glyph other than the
one on screen. Fixed by solving for `u = (k+0.5)/8`:
`drumAngle(k) = 1.5*PI - (k + 0.5) * DETENT_STEP`.

**3. Lit and unlit drums looked identical.** The glyph was always
`emissive: 0xffffff` at full `emissiveMap`, so all six drums glowed the same
whatever their collar said. The only tell was a 2cm bar under the bezel —
a few pixels at play distance. The drum *face* now carries the signal via
`instanceColor`, with the fragment shader patched so it reaches the emissive:
`totalEmissiveRadiance *= vColor`.

**4. The window did not mask.** The "bezel" was four thin bars outlining the
slot; the glyph band wrapped visibly over the drum's top and bottom curve, so
three or four marks showed per drum. Replaced with a shroud — a slightly larger
cylinder with the window arc removed, which hugs the drum instead of floating
in front of it like the flat plates I tried first.

### Two traps worth remembering

**`vertexColors: true` with no `color` attribute renders BLACK.** The fragment
shader only declares `vColor` under `USE_COLOR`, but enabling that makes the
vertex shader do `vColor *= color` against an attribute the geometry does not
have — which defaults to zero and multiplies the entire drum, glyph included,
down to nothing. `instanceColor` alone will not do: it populates `vColor` in the
vertex stage but the fragment stage never declares it. The geometry needs an
all-1.0 `color` attribute as the identity.

**three.js was loaded from unpkg.** Every room is built from canvas textures
specifically so nothing external is needed, and then `index.html` imported the
engine itself from a CDN. Now vendored at `public/js/vendor/three.module.js`.
This is the dependency that would have failed on the school network.

### The lesson, for the fourth time

*Test the outcome, not the bookkeeping.* `vault-room.test.mjs` proves the
puzzle is solvable and stayed green through all four faults, because it
re-implements the room's logic instead of observing the room. The new
`test/vault-render.test.mjs` checks the **contracts between modules** —
that the renderer's glyph vocabulary matches the server's, that `drumAngle(k)`
centres cell `k` in the window, that the dimming reaches the emissive — and each
assertion was verified by reintroducing the original bug and watching it fail.

`public/preview.html` mounts a single room against a fixed puzzle config, with
`__seek(t)`, `__look(x,y,z,yaw)` and `__readWindows()` (raycasts the slots and
reports the glyph the renderer is actually sampling). It is how all four faults
were found. Use it before declaring any room finished.

---

## Fragment briefs — and the panel that had never opened

Adding the briefs meant first finding that **the Fragment panel threw on every
open, in every room, for the whole of Phase 5.** `renderFragment()` read
`puzzle.prompt.instruction`; the observation puzzles replaced the cipher and
sequence ones and `serializePuzzle` stopped sending `prompt` entirely. The
function set its two `hidden` flags, died at the next line, and the panel
silently never appeared — which is why all three screens sat at "STANDBY" and
why the room looked like it had nothing to tell you.

No test caught it because no test opened a panel. The suite checked that the
payload was correct and never checked that anything could read it.

### What shipped

- A `brief` on each of the five defs in `server/puzzle-defs.js` — title, lines,
  and `submit` (the answer format). Text lifted from `design/*.json` with the
  bracketed design commentary stripped. Static per chamber TYPE, never seeded.
- `needsKeyLabel` on the wire. The panel can now say "You need the READ RULE
  from The Spire" instead of "the key" — the label is a category, never a value,
  so naming it leaks nothing, and without it two people who cannot see each
  other's rooms have no way to name what to read aloud.
- `renderFragment()` rebuilt around the brief. A short ALL-CAPS line renders as
  a section head; blank strings become spacing, so the brief keeps the shape it
  was written in.

The field is `brief.submit`, not `brief.answer`, because `ring.test.mjs` asserts
the literal string `"answer"` never appears on the wire. That guard is right and
the name would have shadowed it.

### Three layout bugs the longer content exposed

1. `.panelui__body` had `overflow-y: auto` but no `min-height: 0`. A flex child
   will not shrink below its content, so overflow never engaged and a long body
   ran off the bottom with no way to scroll to it.
2. `.panelui__frame`'s `max-height: 100%` resolved against an auto-sized grid
   row — indeterminate, so it grew to its content. Fixed with
   `grid-template-rows: minmax(0, 1fr)`.
3. `.panelui` claimed no z-index, so the status bar (z-index 3) painted across
   the top of the modal. Invisible on desktop where the frame is short; on a
   phone the panel fills the screen and the chrome lands straight over the
   brief. Now scoped with `:has(.panelui:not([hidden]))`.

`.frag-value` also had `word-break: break-all`, which split a key mid-word —
"SLOT 2 / TOWARD THE PANE / LS". These strings get read down a voice call.

## OPEN BUG — a joining player can be put in the wrong room

Found while verifying the briefs. **Not caused by the brief work.**

Observed on a clean two-player run: MAYA's fragment panel was the Observatory's
(right brief, right key, right neighbour) while her rendered room and status bar
were the Vault. She was solving the Observatory puzzle standing in a room with
no meteor falls in it — unobservable, therefore unsolvable.

Cause, in `public/js/lobby.js`:

- line 343 mounts from `me?.chamberId` **at that instant**
- the roster arrives later and rewrites `me.chamberId` (line ~660)
- `mountedChamberId` is set once (line 359) and thereafter only *displayed*
  (line 438). Nothing compares it to the updated `me.chamberId`, so the room is
  never remounted.

That split is exactly what was seen: the status bar reads `mountedChamberId`
(the wrong room), the panel reads live `me.chamberId` (the right chamber). The
host is usually fine because the assignment lands before their scene mounts; a
player who joined before the run started is the one at risk.

Not fixed — it is a different subsystem from the briefs and wants its own pass.

---

## The bolt register was buried inside the door

Reported as "the top and bottom shapes and numbers are cut off". They were not
cut off — six of the eight collars were **inside the blast door**.

The ring was at `z = 3.17` with radius `1.62 x 1.05`. The door leaves span
`x +/-1.35, y 0..2.3` with their front face at `z = 3.10`, so any collar landing
on the leaf sat two centimetres behind solid steel. Only the two at `x = +/-1.62`
cleared the door edge — which is exactly the two numbers that were visible.

Fixed by putting the ring on the FACE of the leaves instead of trying to clear
them: `RING_RX 1.15`, `RING_RY 0.85`, `COLLAR_Z = halfD - 0.28` (= 3.02, so the
collar's back face at 3.065 clears both the leaf at 3.10 and the seal bar at
3.07). Bolts around the perimeter of a vault leaf is also simply what the object
is. Added `RING_PHASE = PI/8` — half a step of rotation — so no collar lands
centred on the seal bar that runs across the door at `y = 1.16..1.23`.

`test/vault-collars.test.mjs` derives the door from `makeSealedDoor`'s own
construction and the ring from the room's constants, then asserts the collars
clear the leaf, clear the seal, land fully on the door face, do not overlap each
other, and avoid the bar. Verified by restoring the old constants and watching
three assertions fail.

### The pattern, again

Third time now: `vault-room.test.mjs` proved the register was correct, and
`vault-render.test.mjs` proved the drums showed the right glyph — and both
stayed green while the register the drums are matched against was invisible.
Data correctness and screen correctness are different properties. The only thing
that has ever caught these is `public/preview.html` and a screenshot.

### How the Vault is solved, for the record

1. Six drums on the east wall step in unison, one shape showing per window.
2. A drum lights only when its shape is on a collar that is NOT struck through.
3. Once per 22.5s cycle all six light together and the bank dwells a double
   beat — the shear line. That is the only moment worth reading.
4. Read the six shapes; slot 1 is the panel end (z = -2.5), slot 6 the door end.
5. Match each shape to its collar on the door, take the two-digit number.
6. The neighbour's READ RULE is `SLOT n / TOWARD THE PANELS|DOOR`. Start at
   slot n, take THREE slots in that direction, wrapping round the shaft.
   Three numbers, two digits each = the six-digit answer.

---

## Bug fixes, then puzzle wiring

### 1. A player could be put in the wrong room (FIXED)

`lobby.js` mounted the chamber from `me?.chamberId` at one instant inside
`enterScene()`, which runs once and then bails on its own guards. The chamber is
dealt when the host starts the run - AFTER `me` was captured at join time - so a
late assignment never reached the screen. `mountedChamberId` was set once and
thereafter only displayed, which is why the status bar (reading it) and the
Fragment panel (reading live `me.chamberId`) disagreed.

Extracted `mountAssignedChamber()`: idempotent, re-entrant, guarded against
overlapping rebuilds, and called from the `room:state` handler so the mounted
room follows the assignment. Verified on a clean two-player run and on the
reconnect path (refresh mid-run) - crew list, status bar and rendered room now
agree. **Not** verified against the original failure, which I could not
reproduce afterwards; mid-run joining by a NEW player is rejected by the server,
so reconnect is the only reachable late-assignment path.

### 2. Google Fonts was the last CDN dependency (FIXED)

Nine latin woff2 faces vendored to `public/fonts/` (192KB) with a local
`public/css/fonts.css`. `grep` for `https://` across the whole client now
returns nothing. Verified: all 9 faces load, zero requests to gstatic.

### 3. Engine Room wired (DONE)

Was decorative - gauge needles wobbled on a seeded random and the config was
ignored entirely. Now:

- a coolant channel along the east wall with six numbered station plates,
- a slug that runs it once per `period` off the shared run clock, carrying a
  point light so it lights the station it is passing,
- four needles that SLAM to full deflection only while the slug is at the
  station that gauge is plumbed to.

Needles were one InstancedMesh with a shared material - split into four meshes
so each can brighten alone. Same trade the Vault had to undo: instancing saved
three draw calls and cost the room its only signal.

Verified by measuring each needle's peak across a lap and matching it back to
`gaugeStations`: all four correct, peaks spread 5.1 / 9.0 / 16.9 / 20.9s so each
is separately readable. End-to-end solve reproduces the server's answer.

Needle rest/full both sat in the lower half at first, using the dial's true
270-degree arc. Correct for a real pressure gauge, useless here - the difference
read as a twitch. Rest is now low-left and full swings UP.

### 4. Spire wired (LOGIC DONE, LEGIBILITY NOT)

Bearings and hues now come from the config (they were hardcoded, so the bearing
a player reported off the floor rose was decorative and would have been wrong).
Windows split from one merged mesh into five, one material each, so each lantern
can blink on its own schedule.

The signal watch: five 4s turns plus 1s quiet. In its turn a lantern SPEAKS in
`blinks` pulses and the lantern it calls ANSWERS with one long hold. Verified all
five slots - right speaker, exact blink count, right answerer, ~2.75s hold.

Two things found on the way:

- `applyDawn()` was ASSIGNING window opacity, which would have silently
  overwritten whichever lantern was mid-blink. It now sets a scale the watch
  multiplies by.
- That scale bottomed out at 0.35. The dawn runs one way to full light in the
  room players WAIT in, so the signal was faintest exactly when a late player
  arrived. Floor raised to 0.7.

**STILL BROKEN:** the windows are additively blended over a sky that brightens
past them, so at full dawn they wash out - the lantern reads as a dark aperture,
not a lit one. This is the Observatory's beacon bug in a new place: past 1.0
everything clips and additive over a bright ground adds nothing. Needs an opaque
dark aperture behind the additive glow, or a non-additive core. Do not call the
Spire finished until a screenshot at full dawn shows a countable blink.

### 5. Archive - NOT STARTED

Still ignores its config entirely.

### Harness note

`public/preview.html` now takes `?room=<id>` and carries a real generated config
for every chamber. Two things it hid, both now fixed: `__seek` only moved
forward, so a measurement loop left the clock at the end and every later seek
silently did nothing (produced two readings that looked like room bugs); and
`createRoom()` falls back to `room-one` on a build error, so the harness happily
reported "ready, no errors" while showing a completely different room. Check
`window.__room.id` before trusting anything.

---

## Bug fixes, then Engine Room and Spire wired to their puzzles

### The wrong-room bug — fixed

`lobby.js` mounted the chamber from `me?.chamberId` once, inside `enterScene()`,
which returns early on its own guards forever after. The chamber is not dealt
until the host starts the run, so an assignment landing after the first mount
was never honoured: the player stood in one room holding another room's puzzle.

Extracted `mountAssignedChamber()` — idempotent, re-entrant, guarded against
overlapping remounts — and call it from the `room:state` handler. Verified on
fresh runs and on the reconnect path (refresh mid-run), where the crew list,
status bar and the actual rendered room now agree. Mid-run joining by a NEW
player is rejected server-side, so reconnect is the only late-assignment path.

### Fonts vendored — the last CDN dependency is gone

9 latin woff2 faces, 192KB, in `public/fonts/` with `public/css/fonts.css`.
`grep` for `https://` across the client now returns nothing.

### Engine Room — wired

Config drives it end to end: `stationDigits` on six station plates,
`gaugeStations` plumbing each gauge to a station, `symbols` on the gauge faces,
`period` on the lap. Added the coolant channel, the station plates and a
travelling slug with its own point light, so the slug visibly lights the station
it is passing. Verified by measurement: each gauge's needle peaks at exactly its
plumbed station, peaks spread across the lap (5.1s / 9.0s / 16.9s / 20.9s), and
the four digits ordered by the neighbour's MANIFOLD ORDER reproduce the server's
answer.

Needles became four separate meshes. Instancing four 12-triangle boxes saved
three draw calls and cost the room its only readable signal — the same trade the
Vault had to undo.

### Spire — wired

Bearings, hues, blink counts and the call graph all come from the config.
Verified across a full 21s cycle: in every one of the five slots the speaking
lantern blinks exactly its `blinks` count and exactly the right lantern holds.

**The signal moved onto solid geometry.** It was first built by splitting the
window atlas into five quads and animating their opacity. Geometry, UVs, facing
and texture all checked out individually — and the quads still would not draw,
while the same quad with the atlas swapped for a flat colour drew fine. Rather
than keep bisecting a path that only ever needed to be decorative, each tower
got an emissive bead: a sphere with a basic material is the one thing in this
project that has never failed to appear. It also reads better at 60m.

Lamps are pulled a fixed 2.2m toward the viewer, not a percentage. The tower
boxes are rotated so a CORNER faces the room on most bearings, and a corner
reaches further out than the face the window was offset from — a lamp placed
just proud of its window ended up buried inside its own tower on three of five
bearings, which looks exactly like a signalling bug.

### The preview harness was lying

`__seek` rewound by calling `engine.setRunEpoch(Date.now())`. But `runClock()`
returns the step-driven `manualElapsed` ONLY while `runEpoch` is unset — setting
an epoch switches it to wall time, which freezes every room under manual
stepping. Two "room bugs" were really this. `__seek` is now forward-only and
takes a period to wrap, and never touches the epoch.

Also: `createRoom` falls back to `room-one` when a chamber throws, so the
harness reported "ready, no errors" while showing a completely different room.
Check `__room.id` before trusting any measurement.

### A flaky assertion, fixed properly

`ring.test.mjs` asserted the answer string appears nowhere in the payload. That
fired on ~half of all runs for two unrelated coincidences: a four-digit answer
landing inside the 13-digit epoch (`8653` inside `1786539035608`), and the
Archive's initials-based answer `VERN` inside its own strip word `VERNIER`.

Neither tells a player anything. `config` legitimately contains the raw material
the answer is drawn from — that is the design — and the real property, "you
cannot select the right subset without the neighbour's key", is already asserted
by solving each chamber with its neighbour's key. The scan now covers the brief,
the only free text the server authors. 120 consecutive clean runs.

### Still to do

- **Archive** is the last unwired room. Semantics confirmed from its solver:
  four charge cards on a 48-slot rail, each standing in a gap of `size` entries
  and carrying a `callNumber`; eighteen shelf strips each state a range and a
  word; the answer is the initial of the word whose range contains each call
  number, ordered by the neighbour's REQUEST SLIP.
- **UI pass** — Aarav wants the interface less templated.

### Archive — wired (all five rooms now read their own puzzle)

`withdrawals` place four charge cards on the 48-slot rail, each flagged in
pointer-violet with its call number; `strips` become the shelf-edge labels in
the room's existing `CODE lo-hi WORD` format. The entries a withdrawal took are
REMOVED from the rail, so the empty run after a charge card is its size - that
gap is the only thing the neighbour's request slip (a list of sizes) can be
matched against.

Verified from the rendered geometry, not the config: 30 of 48 card quads present
(48 minus the 18 withdrawn), every charge card on its slot, and all four gaps
measuring exactly their withdrawal size.

### Entry rebuilt — gate, then arrival

The asymmetric layout was wrong: splitting the page into two columns made the
empty space more obvious, not less, and the particle field was left carrying a
job it should never have had. Reverted to a centred hero, wordmark much larger
(clamp up to 8rem), and the space filled with something real.

**The five chambers are now on the front page** — each named, each with one line
of what is inside it, each carrying its own signature hue on the top border.
That is the content the emptiness was standing in for, and it also tells a
player who has never opened the game what the game contains.

**Click to continue.** The page now opens as the wordmark alone over the arch.
One click runs a real dolly on the backdrop's own camera (`backdrop.dolly()`,
5.2m pulled back easing to rest over 1.15s) while the page assembles behind it
on staggered delays - copy, chambers, spec, then the two gates last because they
are what you act on.

The dolly moves the CAMERA, not the canvas. A CSS scale would resample an
already-rendered frame and read as zooming a picture; moving the camera changes
the parallax between the arch and the stars behind it, which is what makes it
feel like moving through something.

Gate is scoped to `html[data-screen='entry'][data-entry='locked']` and released
by `showScreen()` on any change away from entry - a restored session lands
directly in a room and must not be held behind a click-to-continue for a page it
never saw. Enter/Space open it too, and `prefers-reduced-motion` drops the
dolly and the breathing prompt.

### Panel overlays restyled

All three looked like the same bordered box with a different accent hue. Now:

- **The bracket motif reaches the thing players read most.** It was on the lobby
  gates and the room code but not on the panels, which was backwards. Plus a
  3px accent spine down the opening edge of the head, so the colour alone says
  which panel is open before you read the title.
- **Fragment's two halves read as different KINDS.** The top block is a brief on
  a work surface (rose rule, prose measure). The bottom is a READOUT: the key
  sits in a dark inset like an instrument display, and the line below carries a
  "▶" speak cue - it is the one thing in this game a player says out loud to
  another human, and it was previously styled as just a second box.
- **Clue board is a writing surface**, ruled at the line height so text lands on
  the rules. It reads as shared paper rather than a generic textarea.
- **Answer lock carries warning weight.** Amber submit rather than the friendly
  aqua primary, a wide-tracked centred code field, and the lockout as a
  depleting bar. Its focus ring is amber too: aqua means "shared" everywhere
  else, and an aqua ring on the one control that can punish the whole crew
  contradicts the colour law.

### A trap worth remembering

The first verification pass showed my rules losing to older ones at identical
specificity, which is impossible when mine come later in the file. The browser
was running a CACHED stylesheet. Force a cache-busted reload before concluding
anything about CSS - computed styles from a stale sheet look exactly like a
specificity bug and send you hunting the wrong thing.

### Correction: the backdrop opacity was never broken

Last entry claimed the arch "has never rendered" because its canvas computed to
`opacity: 0`. That was wrong, twice over:

1. **The opacity readings came from a cached stylesheet.** Cache-busting the
   link gives `opacity: 1` from the ORIGINAL `.backdrop.is-live` rule. There was
   never a cascade bug and no extra rule was needed. The one added to "state the
   intent at unbeatable specificity" has been removed.

2. **The empty canvas is a harness artifact, not a game fault.** Every tab in
   the automated browser pane reports `document.visibilityState === 'hidden'`
   and fires ZERO requestAnimationFrame callbacks. backdrop.js draws from a rAF
   loop, so it can never produce a frame there. The room screenshots that DID
   show 3D all came from `preview.html`, which renders synchronously through
   `engine.step()` and does not depend on rAF.

So the arch's visibility is currently UNVERIFIED rather than broken - it cannot
be checked from this tooling at all. Anything rAF-driven has to be judged in a
real browser window.

Standing rule, now stated twice in this file for a reason: cache-bust the
stylesheet before drawing any conclusion from computed styles, and check
`visibilityState`/rAF before concluding a WebGL layer is not drawing.

---

## Phase 6 — the completion flow, and hosting

(Numbered 7 in conversation by mistake; there was never a phase 7. The plan ran
1-5 for the build and 6 for hosting plus the playtest.)

Phase 6 was NOT done despite being assumed so. `~/keystone-3d` was not a git
repo, there was no `render.yaml`, and every test to date had been two browser
tabs on localhost - which is explicitly not the success criterion ("two people,
two networks"). Deploy prep is now done; the account steps still need a human.

### Solving a chamber now changes the world

The server tracked progress, the HUD listed it, and the world carried on exactly
as before. Five puzzles could fall and the payoff room would not notice.

`run:progress` is now forwarded to whatever room is mounted, via a new
`engine.getMounted()` and an opt-in `room.setProgress({ solved, total })`. Rooms
that do not implement it are simply unaffected, so it is safe to call for any
chamber. It also fires on mount, so a player arriving mid-run sees the progress
already made rather than a room frozen at zero.

**The Spire answers it twice.** Each chamber opened seats a stone in the ring
overhead (measured: 3 solved lights exactly 3 sockets, 16x the cold intensity)
and pushes the dawn further up, with the last one landing at full light.
Verified by screenshot: cold silhouette at zero solved, warm lit stone and gold
mullions at five.

Dawn is FLOORED - `setDawnFloor` will only ever raise it. A crew that solves a
chamber must never watch the sunrise run backwards, and progress may only add
light.

The six sockets became six meshes. That is the fourth time in this project that
instancing had to be undone the moment the object needed to carry state - drums,
needles, lanterns, now sockets. Worth assuming from the start: if a thing will
ever say something individually, do not instance it.
