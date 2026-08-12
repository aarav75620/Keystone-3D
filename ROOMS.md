# Keystone 3D — Room Design

Design for all six spaces. **Nothing here is built yet.** This document exists to
be argued with before any of it becomes code.

Produced by six parallel room designers, each adversarially fact-checked, then
critiqued on three axes (distinctiveness, design thesis, performance). Where a
critic found a real problem the design below is the **fixed** version, and the
change is noted.

---

## 0. The finding that matters most

**Distributing information is not the same as distributing agency, and the first
draft only did the first.**

Every player holding a different piece prevents *solitaire*. It does nothing
against *centralisation*. Almost every dependency in the first draft was "read a
value aloud" — and any value that survives being spoken can be collected by one
dominant player saying "everyone read me your panel." They do all the reasoning
and dictate answers back. The other five become human OCR: sensors, not solvers.

Worse, that is the **efficient** strategy. A coordinated crew will discover that
funnelling everything through one person is faster than six-way negotiation. The
Alpha Gamer problem your e-portfolio is about would have survived the entire
design intact, wearing a disguise.

### The four mechanics that actually resist it

1. **Values expire.** At least one input per room has a ~15s validity window, so
   it must be called *at the moment of submission* by whoever holds it. You
   cannot pre-collect a value that decays. "Read it to me once" becomes "stay
   with me and call it as I go."
2. **Simultaneous action in two rooms.** The Archive's shelf lights *only while
   the Engine player holds the breaker down*, and which shelf lights depends on a
   value the Archive must call back. Two players in a continuous loop neither can
   perform alone, in advance, or from a transcript.
3. **Shapes, not codes.** Hand-drawn asterisms and glyphs must be *described*
   ("three chevrons, a spiral, a diamond with cross-hatching"), not dictated.
   Description forces the holder to interpret and the receiver to question.
4. **Co-signed submission.** Every Answer Lock needs a confirm press from one
   server-named *other* room within ~4s. It does not stop an alpha saying "press
   it" — but it makes every submission a two-person act, gives every player a
   veto they can actually use, and makes exclusion visible to the whole crew.

### Honest limit

This converts the dominant player from **soloist to conductor**. It does not stop
them being dominant. With teenagers on a voice call that is the achievable goal,
and I would rather say so than claim otherwise.

**So instrument it.** Log per run: how many distinct players contributed a value
that appeared in a successful submission, and submissions per player. If one
player is >60% across playtests, the design failed regardless of how elegant the
graph looks. That is a few lines of server code and it is the only way to know.

---

## 1. The dependency graph

### The core triangle (this part is genuinely good)

```
        ARCHIVE ←──────────────→ ENGINE ROOM
           ↑ ↘                 ↗ ↑
           │   ↘             ↗   │
           │     ↘         ↗     │
           └──────→ OBSERVATORY ─┘
```

Every pair has edges in **both** directions. No player in the triangle can be
served without also serving. This is the model everything else should copy.

- **Archive → Engine:** letter-block key, ceiling fault code, gauge identity key
- **Engine → Archive:** cipher prefix, valve numbers, the breaker that powers the shelf
- **Archive → Observatory:** glyph → constellation catalogue
- **Observatory → Archive:** orientation letter, declination as book-cipher page
- **Engine → Observatory:** meridian zero, loop letters, firing order
- **Observatory → Engine:** redline threshold, live bearing for phasing

### The problem: three star topologies

Vault, Spire and Vestibule were all the same shape — *one global modifier
everyone fetches, one token everyone delivers*. Mechanically identical despite
looking nothing alike, and **star topologies are precisely what centralises
control.** The endgame became three consecutive "everyone report to the hub"
phases.

**Fixes applied:**
- The **Vestibule loses its Answer Lock entirely.** Two keystone-arch completion
  ceremonies is one finale too many. It becomes a pure lobby and relay.
- **Ordering ownership conflict resolved:** the Vestibule owns arch order; the
  Observatory's six chart points are re-cast as *positional*, not ordinal.
- The stacked submission tax (flash letter + shifted digits + bolt digits +
  arch ordinal — four global modifiers from three hubs) is **cut to one**. It was
  arithmetically consistent but it was bookkeeping, not reasoning.

### What the first finisher does

The honest first-draft answer was: *nothing*. They read out a lookup table until
demand dries up, then watch a carousel rotate. Worse, there was a hard
contradiction — if a finished Archive player migrates to the Spire, the Archive's
key goes offline for rooms that still need it. Stay = idle. Leave = break the
game. Both branches fail.

**Fix — solved rooms become live monitors.** When a room solves, its Clue Board
switches to a live partial view of a *still-unsolved* room — specifically a view
that room cannot see of itself. The solved Archive starts showing the Engine
Room's needle **values** while the Engine player still sees only **symbols**. The
finished player now holds fresh, live, un-bankable information, and the struggling
player has an ongoing reason to talk to them. "Finished" becomes "you are now
someone's eyes."

**Migration costs something.** Leave for the Spire and your room's data
downgrades to a static snapshot. The crew decides together whether a second pair
of eyes at the top is worth losing live data. *(Flagged: I do not know whether
teenagers read this as a real group decision or as a punishment for finishing.
Most playtest-dependent mechanic here.)*

### Disconnection

All six rooms were **total-stop single points of failure.** Target audience is
teenagers on school laptops and school wifi. This will happen in essentially
every playtest, and it is more urgent than the alpha-gamer question.

**Fix:** every payload gets a degraded mirror in exactly one other room — a
partial copy two survivors must cross-check. Plus: if a player is absent >90s,
their fragment auto-posts to the Clue Board in redacted form that two remaining
players can reconstruct together. Disconnection costs time and *forces
collaboration* rather than ending the run.

### Player count — 2 is not honest

The graph is authored for 6. At 3 players, three rooms are unoccupied and their
information is simply unreachable. **Minimum is 3**, with the room as the unit:
Archive/Engine/Observatory at 3, +Spire at 4, +Vault at 5, +Vestibule at 6.

A co-op game about not escaping alone has no honest 2-player mode. **This
contradicts the PRD's "2–6" and needs your decision.**

### 5 playable chambers vs 6 players (Aarav's question, 21 Jul)

There are **five spawnable puzzle chambers** — Archive, Engine Room, Observatory,
Vault, Spire — and up to six players. The Spire is both a spawn chamber *and* the
finale where finishers converge; whoever spawns there is the one who can see the
other towers and relay. The Vestibule is staging, not a spawn chamber.

Six players across five chambers is **already handled by spawn assignment**
(`server/chambers.js`): surplus players double up, spread evenly, verified to
never stack 3-deep at 4–6 players. A doubled chamber is on-thesis — two players
see the same room but still depend on the other four, and a less confident player
gets a buddy. This is a spawn-layer fact and is done.

**Separate, unbuilt problem (phase 5):** *how many chambers are active* for a
given crew size. With five chambers and three players, two chambers sit empty and
their info is unreachable — so the puzzle graph must scale with crew (the nested
sequence above: 3→triangle, 4→+Spire, 5→+Vault). Until phase-5 puzzle state
exists, the server just *warns* when a session is under-crewed; it does not yet
deactivate chambers. Do not conflate this with the spawn question — spawning is
solved, graph-scaling is not.

---

## 2. Palette — collisions found and fixed

Two hard collisions, both because rooms independently reasoned toward "the widest
free gap on the colour wheel" and landed on the same pixel.

| Room | Was | Now | Why |
|---|---|---|---|
| Vestibule | `#b8e04a` lichen | **`#9aa38c` bone-grey** | 3° from Engine lime. Also: absence should read as *desaturation*, not another hue — so the empty room is near-monochrome and arriving aqua is a real chromatic event. |
| Archive | `#b26bff` violet | **`#e6ddc8` vellum** | Three purple rooms out of six. Vellum makes the paper room the only warm near-white. |
| Observatory | `#8f7bff` | **`#8f7bff` (kept)** | Now uncontested owner of violet. |
| Spire | `#b39dff` iris | **`#ffd27a` gold** | 4.5° from Observatory. Also: a sunrise that skips orange is not a sunrise. |
| Engine | `#b7f03a` lime | unchanged | Load-bearing — it is the working fluid. |
| Vault | `#3d7bff` bolt blue | unchanged | Genuinely clear of everything. |

**New global semantic: pointer-violet.** "This datum belongs to another room" was
the best single colour idea in the six documents and it was wasted as one room's
signature. It is now global — every room, everywhere a printed value belongs to
someone else. It never appears as room lighting. Cross-room dependency becomes
legible at a glance, everywhere.

Reserved semantics unchanged: **aqua = shared · rose = private · amber = warning.**

**Unresolved risk:** Spire gold sits 6° from amber. Mitigations are scale-based
(amber only ever appears on panel-sized objects; gold is sky-sized). I do not have
high confidence in that on a 6-bit TN panel. **Needs one playtest on target
hardware.**

---

## 3. Distinctiveness — Observatory and Spire were the same room

The most serious non-colour problem. Both had: no ceiling, parapet walls with a
bright cap rail, sky above, distant silhouettes, a rotating star cloud, a large
overhead ring, one warm low light — and **both had a floor compass rose graduated
0–359 off which you read a bearing by aiming a rotatable ring.** Not similar. The
same object and the same verb, twice. Looking down, the screenshots are
indistinguishable.

**Three compounding fixes:**

1. **Divide the angles.** Spire owns **azimuth** (direction across ground — what a
   tower that sees five other towers is *for*). Observatory owns **altitude and
   declination** (height in sky — what an armillary is for). Delete the
   Observatory's floor rose; make its pier polished black, so looking down there
   shows a dark reflection of rings and sky. Two opposite downward moments.
2. **Put the Observatory under glass.** A BackSide sphere at r=6.2 with a
   frost-and-smear canvas texture, plus 12 ribs and 3 latitude rings. One draw
   call converts it from *open* to *sealed under glass* — and answers its own
   worry that removing the ceiling destroys escape-room enclosure.
3. **Cut mullions in the Spire** from 12 to 6, all on east and west, south edge
   completely unframed. The Spire's silhouette gets a **notch** — a hole in its
   outline that no other room has. It becomes the only genuinely open-air room.

**Archive and Vault** were the second pair (both dark boxes, repeated modular
units, dominant circle, pulsing amber, lit from below). Pushed apart on height:
Archive moves all data below 2.6m with the top two metres genuinely empty black
and only the carousel ring floating in it. Vault shrinks its blast door from 4.2m
(64% of a 6.6m wall) and loses its amber pip so the Vault beacon is the game's
only pulsing amber overhead object.

**Motion grammar** — three rooms each claimed "the only room with continuous
motion." Resolved by *kind*: Archive = slow orbital drift, Engine = reciprocating
stroke, Vault = indexed rotation that clicks into detents. Name the room from
motion alone with your eyes half shut.

**Colourblind silhouette test** at a 12px monochrome thumbnail:

| Room | Shape signature |
|---|---|
| Archive | horizontal stripes + one bright ring |
| Engine Room | **a lit floor** — nothing else in the game has one |
| Observatory | curved rib grid overhead |
| Spire | open notch in the outline |
| Vault | diagonal lattice — the only diagonal anywhere |
| Vestibule | one hard light cone |

Also: panels are currently distinguished only by hue and position. Position is
now a **hard invariant no room may reorder** (Fragment left, Clue Board centre,
Answer Lock right), plus shape tokens on the bracket corners — solid for
Fragment, doubled for Clue Board, hatched for Answer Lock.

---

## 4. Coherence — they disagreed about what building they're in

The Observatory was open to vacuum orbiting a gas giant. The Spire was on a
planet with an atmosphere, cloud deck and sunrise. The Observatory said its dome
was visible through an Engine Room viewport; the Spire said the Engine Room was a
tower thirty metres away. **Both were load-bearing on puzzles. They cannot both
be true.**

**Committed: the Spire's version.** A complex of old stone towers on a high
plateau above a cloud deck, retrofitted with ship-grade machinery. Preserves the
Vestibule's masonry (towers are old, fit-out is new), the sunrise, and the
Spire's sightlines. Costs the Observatory's vacuum — recovered with interest,
because real observatories sit on mountains above the cloud layer, and
atmospheric extinction is a better reason for a glass dome than none.

Cheap coherence levers:
- **One cloud deck** under both Observatory parapet and Spire — a RingGeometry
  reusing the same texture. One draw call makes two rooms share a world.
- **The same moon** at consistent bearing, different elevation, visible from
  both. Cheapest possible proof this is one place, and it doubles as a cross-room
  information source costing no new geometry.
- **Three station materials**, every room uses at least two: quarried limestone
  ashlar, grime-steel bulkhead plate, de-blued slate behind panel banks.
- **The waist horizontal at ~1.02–1.09m** is now a stated invariant (it already
  recurs in four rooms and does more coherence work than any colour). Engine Room
  substitutes valve handwheels at 1.15m and says so.
- **Six is the game's number** — six voussoirs, six drums, six stars, six crew.
  Engine Room goes from four pistons to six.

---

## 5. The six rooms

### THE ARCHIVE — `#e6ddc8` vellum · 37 draws
Tall dim stack room, 4.6m ceiling, where the overhead lighting died decades ago
and one raking light crosses the shelf spines. Quiet, vertically overwhelming,
dense with information that is mostly unreadable until another room powers the rack.

**Signature: the catalogue carousel** — a suspended rail at r=2.9m carrying 48
hanging index cards orbiting the player at 0.055 rad/s (one revolution ≈ 114s).
Because the camera is permanently at centre, every card faces you in turn. *Three
draw calls and one Group rotation — the best cost/payoff ratio in the whole
design, and it converts the no-movement constraint into the room's mechanic.*

**Holds:** the letter-block key (any two-digit code → alphabet block) — the crew's
resolver. **Needs:** its own Fragment is incomplete; the prefix is redacted until
the Engine Room reads it off a pipe. **Motion:** orbital drift.
**Particles:** index slivers, 220 / 960.

### ENGINE ROOM — COOLANT LOOP B — `#b7f03a` lime · 41 draws
7.2 × 7.2 × 2.9m — deliberately smaller and lower. Lit almost entirely **from
below**: the coolant loop still glows lime under the deck grating while the
overheads are dead.

**Signature: a 2.5m flywheel spinning half-submerged below the grating**, its six
spokes physically chopping the lime glow as they pass — real occlusion, no shader
— so the room strobes at 0.8Hz through the floor you are standing on. *One
InstancedMesh and one rotation buys genuinely modulated lighting; driving the
point light's intensity from the same angle is free.*

**Holds:** the valve schedule (static) and the **firing order** (temporal — must
be *watched*, cannot be screenshotted). **Needs:** the gauge identity key — its
four dials carry symbols only, no names. **Motion:** reciprocating stroke.
**Exclusive:** the only room where you can see below the floor. Nothing else in
the game gets a transparent surface.

### THE OBSERVATORY — `#8f7bff` declination violet · ~38 draws
Cold silent instrument deck under a glass dome, above the cloud deck. No lamps —
white light would destroy dark adaptation, which is an operational rule, not an
aesthetic one.

**Signature: the armillary you stand inside** — three graduated rings (r = 3.55 /
3.05 / 2.55) on three tilts turning at three rates around the fixed camera, with a
rose-tipped alidade sweeping across them.

**Holds:** the star catalogue — six stars with violet declinations. **Needs:**
meridian zero, which is not on the inside face of its own rings. **Owns:**
altitude and declination only. **Particles:** the starfield *is* the backdrop,
900 / 2600. **Changed:** gas giant shrunk 35° → 12–14° and its ring system
dropped, so it reads as a world you are *observing* rather than falling into.

### THE VAULT — `#3d7bff` bolt blue · ~43 draws
6.6 × 6.6 × 2.6m on backup power. Walls crowd in, ceiling less than a metre above
your eyes, every surface bolted plate. The most amber room in the game.

**Signature: the drum stack** — six horizontal tumbler drums on a shared shaft,
each turning at its own rate, each showing one engraved glyph through a backlit
read-slot. Six drums for six crew slots — the keystone arch restated in steel.

**Holds:** the bolt register. **Needs:** the seal order — the Vault player can
read *what* each drum shows but never the *order*. **Motion:** indexed rotation
with detents. **Cut:** four dead pressure gauges (duplicated the Engine Room's
hero instrument) and the falling-grit ShaderMaterial.

### THE SPIRE — `#ffd27a` gold · ~45 draws (~61 on High)
The finale. An open stone lantern at the top of a tower at pre-dawn. Three of four
walls stop at waist height — you stand in open sky above the cloud deck looking
down at the five neighbouring spires holding everyone else.

**Signature: the dawn as a progress bar you feel rather than read.** A shader sky
whose sun elevation and colour are driven by one `uProgress` uniform tied to
rooms-solved, eased over 2.2s. At 0/5 you sit in near-night violet under stars; at
5/5 the sun clears the cloud deck.

**Changed:** the dawn now runs through a *real* sunrise — deep violet at 0/5,
magenta-orange horizon band at 2/5, full gold at 4/5, white at 5/5. The first
draft ran violet → cool white, forfeiting the one region of the wheel nobody else
claimed. Gold gives the finale the one thing no other room is allowed: **warmth at
scale.**

**The waiting player is not idle.** From the parapet the Spire sees every other
room as a lit tower window. It holds the beacon-extinction order — which only
exists if someone was *watching across the whole run* and cannot be reconstructed
afterward. This is the single best anti-dictation mechanic in the design.

### THE VESTIBULE — `#9aa38c` bone-grey · 31 draws
A quarried stone vestibule that predates the ship, where a six-voussoir keystone
arch stands with its crown stone missing.

**Signature: the absent keystone** — an 18° gap at the crown drawn as a dashed
wireframe ghost. **No lamps at all**, which is why the standard four ceiling
strips are deliberately absent — the one place the established shell pattern is
broken on purpose.

**The crew light:** one PointLight whose intensity and hue are literally
`filled / 6`. *The entire design thesis expressed in one float, and the cheapest
thing in the document.* **Lost its Answer Lock** — it is now a pure lobby and
relay, holding arch order.

---

## 6. Shared helpers — extract before writing a second room

Already in `scenes.js`, will otherwise be copy-pasted six times: `newCanvas`,
`toTexture` (needs `[x,y]` repeat), `drawTrackedText`, `makeScreenTexture`,
`makeMoteTexture` (make it a **true module-level singleton** — six rooms building
and destroying an identical 64px gradient is pure waste), `makeMotes` with the
camera-exclusion sphere.

New, in priority order:
1. **`makeAtlasQuads(cells, atlasSpec)`** → one merged BufferGeometry with
   per-quad UVs. **The single highest-value function in the project** — it is what
   makes N legible text surfaces cost one draw call. The Archive needs it three
   times on day one.
2. **`makePanelBank({wallZ, offsetX})`** → housings, screens with
   `userData.panelId`, pips, computed focus angles. Write it once or one of six
   copies drifts and phase 4's raycasting breaks in exactly one room.
3. `makeSealedDoor` (four rooms specify an identical door), `makeTrimRail`,
   `lcg(seed)` — **must be the same LCG** or two rooms disagree about what
   deterministic means.
4. **Canvas grime kit:** `rivetPass`, `grainPass`, `streakPass`, `scanlinePass`,
   `bevelRect`. ~15 lines each. This is the difference between six rooms that look
   like one game and six that look like six people's homework.

Plus `makeStandardShell({width, depth, height, ceiling, northTint})`, and **decide
`engine.dimensions` now** — four of six rooms vary the box against one shared
constant that fog range and any shadow frustum both read. Cheap today, expensive
after room three.

---

## 7. Performance — draw calls are the wrong metric

School laptops report `devicePixelRatio` 1.0–1.25, so the Low cap resolves to
**1.0** and real fill is ~1.05 Mpix at 1366×768. What a UHD 620 will not push is
**lit fragments × light count × overdraw**.

**The Vault is the room most likely to tank, and it tanks on High.** It is the
*smallest* room, which makes it *more* expensive per pixel — the camera is 3.3m
from every wall. It stacked ten lights (~500 ALU/fragment), two coplanar
`alphaTest` `DoubleSide` lattice layers on the wall the key light rakes (~4×
overdraw at full lighting cost), a shadow-casting spot aimed through the camera
into that wall, and additive planes either side. ≈1.5 GFLOP/frame on lighting
alone against a realistic ~150 GFLOPS at 60fps.

**Fixed:** second lattice layer cut (it existed for "moire parallax as you look
around" — but the camera *rotates*, never *translates*, so the effect is
physically unobtainable), `DoubleSide` dropped, High capped at four point lights.
Lands ~35–45fps Low, ~30 High.

Other cuts: Engine Room ceiling conduits (12 cylinders subtending 1–2px — they
alias into crawling noise, worse than absent), Spire's six separate glyph plates
(6 draws → 1 by merging), Archive pilasters and rail hangers, Observatory's second
emissiveMap canvas pass.

**One free win:** both sky domes used `renderOrder = -1` + `depthWrite: false`, so
the sky draws first at full screen then gets entirely overdrawn. Render it *last*
with depth testing on and early-Z rejects every covered pixel. ~50% saving on the
most-covered surface in the room, for a one-line change.

**Every High figure undercounts by 30–50%** — five of six specs omitted the shadow
pass, which re-renders every caster from the light's view. Whitelist casters
explicitly per room; never let a dome, sky, planet or Points cloud cast.

### Texture memory — the real bottleneck

~92MB raw, ~123MB on GPU with mipmaps. But `CanvasTexture` holds a reference to
the `HTMLCanvasElement`, so unless nulled you *also* retain ~92MB CPU-side. Call
it **200MB+ resident** if all six generate up front. On a 4GB laptop with shared
VRAM alongside Chrome, not survivable.

Generation time is worse: 30–120ms of synchronous main-thread canvas work per
room. All six up front is a 300–700ms freeze.

**Generate lazily on mount, dispose on unmount — the plumbing already exists.**
`engine.mount()` already calls `unmount()` → `dispose()`, and `dispose()` already
walks a `textures` array. Peak residency becomes ~26MB. Caveat: a mid-run
transition hitches 50–120ms, so generate the next room's textures during the
door-opening animation.

**A tier switch must never change what a player can read.** Two players on
different tiers read values to each other — that makes this a *correctness* test,
not a visual one.

---

## 8. Build order

| # | Build | Why here |
|---|---|---|
| 0 | Engine environment hook + shared helpers | Prerequisite. Four rooms have their central lighting concept contradicted without it. |
| 1 | **Archive** | Proves every technique the other five depend on. |
| 2 | **Engine Room** | Second-hardest fragment cost; pairs with Archive for a real two-way loop to playtest. |
| 3 | **Observatory** | Completes the **3-player playable core. Stop and playtest here.** |
| 4 | **Server: puzzle state** | Secret distribution, 15s windows, co-sign, disconnect auto-post. |
| 5 | Spire | Needs Observatory built. |
| 6 | Vault | Highest perf risk — build it with real numbers from three rooms. |
| 7 | Vestibule | Cheapest, lockless, only room cuttable without breaking a puzzle. |

**Build the Archive first, not the Vestibule.** The Vestibule is cheapest and is
the spawn room, and it proves almost nothing — 31 draws, no atlas work, no shader,
no instancing. It will pass and tell you nothing. The Archive exercises merged-
geometry-with-atlas-UVs in three forms, `InstancedMesh` with per-instance
transforms, server-driven canvas redraw, a seeded LCG, a non-standard ceiling, and
tier-gated particles. **It is also the only room needing no `engine.js` change.**

**Measure on the actual target laptop with two tabs open** — two tabs is how this
gets tested locally, and it halves the available GPU.

> **`server/rooms.js` currently holds no puzzle state at all.** Until step 4
> exists, the forcing property of this entire design is aspirational. Do not build
> rooms 4–6 before it, or you ship six rooms of client-side puzzle data any player
> can read out of DevTools.

---

## 9. Open questions — genuinely need your decision

1. **Minimum player count.** I've specified **3**. The PRD says 2–6. If 2 must
   ship, the core triangle has to be rebuilt as a bidirectional *pair* — a
   different puzzle design, not a tuning pass. Cheap now, expensive after phase 3.
2. **May I edit `engine.js`?** Four rooms need a per-room environment hook
   (hemisphere light, suppress the engine key light). It is *additive*, not a
   redesign. If no, four rooms lose their lighting identity and this document
   needs a second pass.
3. **Spire gold vs amber** — 6° apart. Needs one playtest on your real screen.
   Fallback weakens the finale's warmth. No third option keeps a real sunrise.
4. **Should the Observatory's alidade be player-aimable?** Detents make the puzzle
   honest; player-aiming makes that player an **agent rather than a sensor** — the
   crew says what to sight, only they can execute. Single most on-thesis change
   available anywhere. Costs a drag interaction plus server arbitration.
5. **The Vestibule losing its Answer Lock** — largest single change from the
   original specs.
6. **If instrumentation says it failed** (>60% submissions from one player), the
   next lever is *physical*: simultaneous two-room inputs. I specified exactly one
   (the Archive breaker). Scaling to four or five would change several rooms.
   Worth knowing if you'd take that direction before you find out you need it.
