// rooms/vault.js - the Vault.
//
// 6.6 x 6.6 x 2.6m - the smallest and lowest room in the game, so this file
// builds against its own numbers and hands them back. The ceiling sits 0.98m
// above the eye; the walls are 3.3m from a camera fixed at centre. That crowding
// is the whole point, and it is also why this is the room most likely to tank:
// the smallest box has the most lit pixels per wall. Everything below is
// disciplined against that - four lights, no shadows, no DoubleSide alphaTest,
// no coplanar overdraw.
//
// On BACKUP POWER. The overhead key is disabled outright (keyEnabled:false) and
// the strips every other room lights are visibly dead up there. What light there
// is comes from a few emergency sources with visible bodies - a bolt-blue drum
// backlight, an amber wall lamp, an amber ceiling beacon - enough that the drums
// and the three panels read clearly at a standing eye. The Archive shipped too
// dark once and had to be re-lit; this room does not repeat that.
//
// Signature hue BOLT BLUE #3d7bff means one thing only: mechanically ENGAGED - a
// bolt thrown, a tumbler seated. It is never information and never warning. This
// is the most AMBER room in the game (warning), with bolt-blue as the accent.
//
// Motion grammar is INDEXED ROTATION: the drums hold in a detent, then click to
// the next. Nothing here spins smoothly - that reads as the Engine Room.
//
// No particle dust (rule 9). The design's "concrete dust and swarf" is CUT.

import * as THREE from 'three';
import {
  newCanvas,
  toTexture,
  disposeTexture,
  lcg,
  drawTrackedText,
  rivetPass,
  grainPass,
  streakPass,
  bevelRect,
} from '../roomkit/canvas.js';
import {
  makeStandardShell,
  makePanelBank,
  makeSealedDoor,
  makeAtlasQuads,
  makeCeilingStrips,
  mergeGeometries,
} from '../roomkit/geometry.js';

const ROOM = { width: 6.6, depth: 6.6, height: 2.6, eyeHeight: 1.62 };

const BOLT_BLUE = 0x3d7bff;
const BOLT_BLUE_CSS = '#3d7bff';
const AMBER = 0xffb35c;
const AMBER_CSS = '#ffb35c';
const AQUA = 0x5ef2d0;
const STEEL_CSS = '#262c34';

// The drum stack. Six horizontal tumbler drums on a shared shaft along the east
// wall - six drums for six crew slots, the keystone arch restated in steel.
const DRUM_COUNT = 6;
const DRUM_R = 0.4;
const DRUM_W = 0.6;
const DRUM_X = 2.8;                       // 0.5m off the east wall (x = +3.3)
const DRUM_Y = 1.45;                      // read-slot centre, near the eye
const DRUM_Z = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
const DETENTS = 8;                        // eight glyphs, eight detents per drum
// How far an unseated drum falls. Not 0 - a drum that vanished would read as a
// hole in the stack rather than a tumbler that has not found its bolt. This is
// dark enough that the glyph stops being legible, which is the whole point: you
// can only read the faces that are lit.
const DEAD_DRUM_LEVEL = 0.16;
const DETENT_STEP = (Math.PI * 2) / DETENTS;

// The bolt register - the Vault's cross-room payload. Eight collars ring the
// blast door, each stencilled with a room glyph and a two-digit number. Two are
// struck through in bolt-blue: those bolts are thrown (engaged), the rest run
// free. Fixed strings, not seeded: another room reads these numbers aloud, and a
// payload that differs between clients is a correctness bug, not a puzzle.
const BOLT_REGISTER = [
  { glyph: 'triangle', num: '41', code: 'AR', thrown: false },
  { glyph: 'bolt', num: '08', code: 'EN', thrown: true },
  { glyph: 'square-dot', num: '17', code: 'OB', thrown: false },
  { glyph: 'chevrons', num: '23', code: 'SP', thrown: false },
  { glyph: 'hourglass', num: '05', code: 'VE', thrown: true },
  { glyph: 'plus', num: '62', code: 'VA', thrown: false },
  { glyph: 'diamond', num: '34', code: 'KC', thrown: false },
  { glyph: 'double-bar', num: '19', code: 'DC', thrown: false },
];

const TIERS = {
  low: {
    drumEmissive: 0.8,
    backlightEmissive: 1.3,
    collarEmissive: 0.42,
    stencilEmissive: 0.36,
    latticeEmissive: 0.22,
    screenIntensity: 0.8,
    beaconIntensity: 7,
    drumLight: 11,
    amberLamp: 14,
    panelWash: 6,
  },
  high: {
    drumEmissive: 1.05,
    backlightEmissive: 1.8,
    collarEmissive: 0.58,
    stencilEmissive: 0.5,
    latticeEmissive: 0.32,
    screenIntensity: 1.1,
    beaconIntensity: 9,
    drumLight: 14,
    amberLamp: 18,
    panelWash: 8,
  },
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Bolted plate: heavy courses, rivet lines, industrial grime. */
function makeWallTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = STEEL_CSS;
  ctx.fillRect(0, 0, size, size);

  const course = size / 3;
  for (let row = 0; row < 3; row += 1) {
    const offset = (row % 2) * (size / 4);
    for (let col = -1; col < 3; col += 1) {
      const x = offset + col * (size / 2);
      bevelRect(ctx, {
        x, y: row * course, width: size / 2, height: course,
        depth: 3, alpha: 0.15,
      });
    }
  }

  rivetPass(ctx, { width: size, height: size, spacing: course / 2, radius: 4, inset: 12, alpha: 0.32 });
  streakPass(ctx, { width: size, height: size, count: 16, seed: 47, alpha: 0.1 });
  grainPass(ctx, { width: size, height: size, count: 2200, seed: 13, alpha: 0.05 });

  return toTexture(canvas, { repeat: [2, 1] });
}

/** Floor plate: diamond tread with a bolt-blue hazard border around the sump. */
function makeFloorTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1b2027';
  ctx.fillRect(0, 0, size, size);

  // Diamond tread - the cheapest thing that reads as a plated floor rather than
  // a flat slate under a fixed camera that mostly looks level.
  ctx.strokeStyle = 'rgba(210,225,245,0.06)';
  ctx.lineWidth = 2;
  const step = 34;
  for (let d = -size; d < size; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d + size, 0);
    ctx.lineTo(d, size);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 1800, seed: 71, alpha: 0.06 });
  streakPass(ctx, { width: size, height: size, count: 8, seed: 5, alpha: 0.07 });

  return toTexture(canvas, { repeat: 3 });
}

/**
 * The drum band. 8 engraved glyphs wrapped around one circumference; ONE canvas
 * used as both map and emissiveMap, so the glyphs read backlit (bolt-blue on
 * near-black steel) while the drum body barely emits. Six drums share this via a
 * single InstancedMesh - identical alphabet, different seated detent, which is
 * exactly how a tumbler lock is built.
 *
 * The cylinder wraps U around the tube and V along its length, so a glyph's
 * upright axis at the read-slot runs along the circumference (U). The marks are
 * drawn deliberately symmetric geometric tokens rather than lettered so that the
 * U/V transpose never turns readable text on its side.
 */
function makeDrumGlyphTexture(register) {
  const cell = 128;
  const width = cell * DETENTS;
  const height = cell;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#10141b';
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < DETENTS; i += 1) {
    const x0 = i * cell;
    // Faint machined seam between faces so the drum reads as facetted steel.
    bevelRect(ctx, { x: x0 + 3, y: 3, width: cell - 6, height: cell - 6, depth: 3, alpha: 0.12 });
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, height);
    ctx.stroke();

    const cx = x0 + cell / 2;
    const cy = height / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = BOLT_BLUE_CSS;
    ctx.fillStyle = BOLT_BLUE_CSS;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawGlyph(ctx, register[i].glyph);
    ctx.restore();
  }

  grainPass(ctx, { width, height, count: 700, seed: 91, alpha: 0.05 });
  return toTexture(canvas);
}

/**
 * Eight distinct engraved marks, drawn centred at the origin, radius ~40.
 *
 * Keyed by the SERVER's glyph names (GLYPH_KINDS in server/puzzle-defs.js), not
 * by position. This used to switch on a numeric index while the collars were
 * drawn from named glyphs, so every collar fell through to `default` and the
 * ring showed eight identical double-bars - the player could read the drums
 * perfectly and still have nothing to match them against. Sharing one named
 * vocabulary is what makes a drum face and a collar the same mark.
 */
function drawGlyph(ctx, kind) {
  const r = 40;
  ctx.beginPath();
  switch (kind) {
    case 'triangle':
      ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); ctx.stroke();
      break;
    case 'bolt': // zigzag
      ctx.moveTo(-r * 0.4, -r); ctx.lineTo(r * 0.3, -r * 0.15);
      ctx.lineTo(-r * 0.15, 0); ctx.lineTo(r * 0.45, r); ctx.stroke();
      break;
    case 'square-dot':
      ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
      break;
    case 'chevrons': // double chevron
      ctx.moveTo(-r, -r * 0.2); ctx.lineTo(0, r * 0.5); ctx.lineTo(r, -r * 0.2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.7); ctx.lineTo(0, 0); ctx.lineTo(r, -r * 0.7); ctx.stroke();
      break;
    case 'hourglass':
      ctx.moveTo(-r, -r); ctx.lineTo(r, -r); ctx.lineTo(-r, r); ctx.lineTo(r, r); ctx.closePath(); ctx.stroke();
      break;
    case 'plus':
      ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      break;
    case 'diamond':
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.stroke();
      break;
    default: // 'double-bar'
      ctx.moveTo(-r, -r * 0.4); ctx.lineTo(r, -r * 0.4);
      ctx.moveTo(-r, r * 0.4); ctx.lineTo(r, r * 0.4); ctx.stroke();
      break;
  }
}

/**
 * The west-wall security lattice - the only diagonal texture in the game, and
 * this room's 12px silhouette signature. ONE alphaTest plane, FrontSide.
 *
 * The second parallax layer the first draft carried is deliberately NOT here:
 * it existed to shimmer as you look around, but this camera only rotates about
 * a fixed point, so the effect is physically unobtainable and the layer was pure
 * overdraw on the wall a light rakes. A diamond grid tiles seamlessly at 45°
 * because the period divides the canvas.
 */
function makeLatticeTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fully transparent between bars; alphaTest discards it at draw time.
  ctx.clearRect(0, 0, size, size);

  const spacing = 64;
  const bar = 11;
  ctx.lineWidth = bar;
  ctx.lineCap = 'butt';

  // Both diagonals, wrapped, so the diamond mesh is continuous across tiles.
  for (const dir of [1, -1]) {
    for (let o = -size; o <= size * 2; o += spacing) {
      ctx.strokeStyle = '#3a424c';
      ctx.beginPath();
      ctx.moveTo(o, 0);
      ctx.lineTo(o + dir * size, size);
      ctx.stroke();
      // Bolt-blue edge catch on one side of each bar - a caged section, engaged.
      ctx.strokeStyle = 'rgba(61,123,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o + dir * 4, 0);
      ctx.lineTo(o + dir * (size + 4), size);
      ctx.stroke();
      ctx.lineWidth = bar;
    }
  }

  return toTexture(canvas, { repeat: [2, 1] });
}

/**
 * The eight bolt-register stencils in one atlas -> one draw call.
 *
 * Each collar carries the SAME engraved shape vocabulary as the drum faces -
 * matching a drum to a collar is the puzzle's second half, so a collar labelled
 * with letters while the drums carry shapes would make that impossible.
 */
function makeCollarAtlas(register) {
  const width = 512;
  const height = 256;
  const cellW = 128;
  const cellH = 128;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  const cells = register.map((entry, i) => {
    const cx = (i % 4) * cellW;
    const cy = Math.floor(i / 4) * cellH;
    const mx = cx + cellW / 2;

    // Amber is the room's warning hue and carries the payload; only the strike
    // marking a thrown bolt is bolt-blue.
    // The engraved shape, matching the drum faces.
    ctx.save();
    ctx.translate(mx, cy + 42);
    ctx.strokeStyle = AMBER_CSS;
    ctx.fillStyle = AMBER_CSS;
    ctx.lineWidth = 5;
    drawGlyph(ctx, entry.glyph);
    ctx.restore();

    // The two-digit number: what the player actually collects.
    ctx.fillStyle = AMBER_CSS;
    ctx.font = '700 44px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, entry.num, mx, cy + 92, 3);

    // Room code, small, so the ring still reads as a register of chambers.
    ctx.fillStyle = 'rgba(255,179,92,0.45)';
    ctx.font = '500 18px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, entry.code, mx, cy + 116, 3);

    if (entry.thrown) {
      ctx.strokeStyle = BOLT_BLUE_CSS;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(cx + 24, cy + 24);
      ctx.lineTo(cx + cellW - 24, cy + cellH - 24);
      ctx.stroke();
    }

    return [cx, cy, cellW, cellH];
  });

  return { texture: toTexture(canvas), cells, width, height };
}

/**
 * Wall stencils: the room's own labels in amber, plus one bolt-blue "engaged"
 * indicator. All in one atlas -> one draw call.
 */
function makeStencilAtlas() {
  const width = 1024;
  const height = 512;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  const cells = {};

  // Cell A: room title, west wall over the lattice.
  ctx.fillStyle = AMBER_CSS;
  ctx.font = '600 52px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'VAULT', 300, 46, 12);
  ctx.font = '400 26px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,179,92,0.6)';
  drawTrackedText(ctx, 'SECTOR VI - BACKUP POWER', 300, 104, 4);
  cells.title = [0, 0, 620, 150];

  // Cell B: hazard, near the drums.
  ctx.fillStyle = AMBER_CSS;
  ctx.font = '600 40px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'MECHANICAL HAZARD', 320, 210, 4);
  ctx.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,179,92,0.55)';
  drawTrackedText(ctx, 'INDEXED TUMBLERS - DO NOT REACH IN', 320, 252, 3);
  cells.hazard = [0, 160, 680, 130];

  // Cell C: bolt register header, over the door.
  ctx.fillStyle = AMBER_CSS;
  ctx.font = '600 42px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'BOLT REGISTER', 280, 330, 6);
  cells.register = [0, 290, 560, 90];

  // Cell D: the one bolt-blue indicator - physical state, not information.
  ctx.fillStyle = BOLT_BLUE_CSS;
  ctx.font = '600 38px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'BOLTS ENGAGED', 260, 430, 5);
  cells.engaged = [0, 390, 520, 90];

  return { texture: toTexture(canvas), cells, width, height };
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export function createVault({ dimensions, puzzle } = {}) {
  // The puzzle arrangement the server generated for this session: which glyph
  // sits on which collar, which two bolts are thrown, where each drum rests.
  // Falls back to a static register so the room still renders in isolation
  // (room preview, a client whose puzzle has not arrived yet).
  const cfg = puzzle?.config || null;
  const register = cfg
    ? cfg.collars.map((c) => ({ glyph: c.glyph, num: c.number, code: c.code, thrown: c.thrown }))
    : BOLT_REGISTER;
  // The engine passes its default box; this room is smaller and uses its own,
  // reading only eyeHeight so a future engine-wide eye change still propagates.
  const room = { ...ROOM, eyeHeight: dimensions?.eyeHeight ?? ROOM.eyeHeight };
  const group = new THREE.Group();

  const parts = [];
  const textures = [];
  const own = (part) => { parts.push(part); return part; };

  let settings = TIERS.low;

  const halfW = room.width / 2;
  const halfD = room.depth / 2;

  // ----- shell -------------------------------------------------------------

  const floorTexture = makeFloorTexture();
  const wallTexture = makeWallTexture();
  textures.push(floorTexture, wallTexture);

  const shell = own(makeStandardShell({
    width: room.width,
    depth: room.depth,
    height: room.height,
    floorMap: floorTexture,
    wallMap: wallTexture,
    // Textures carry the colour, so tints stay near white (rule 1). North is the
    // de-blued slate the panel bank sits on. The ceiling is dead on backup power.
    northTint: 0x9aa6b6,
    ceilingTint: 0x232c38,
    roughness: 0.8,
    metalness: 0.34,
  }));
  group.add(shell.group);

  // Dead overhead strips: present, visibly OFF - the room narrates its own power
  // state exactly the way the Engine Room does.
  const deadStrips = own(makeCeilingStrips({
    width: room.width,
    depth: room.depth,
    y: room.height - 0.22,
    colour: 0x0d1622,
    bodyColour: 0x161d26,
    intensity: 0.05,
  }));
  group.add(deadStrips.mesh);

  // No trim rail. The waist horizontal every other room gets from makeTrimRail
  // would run straight through the drum stack on the east wall and the collars
  // on the south; the slot-bezel line and the collar ring carry that reference
  // height here instead.

  // ----- panels ------------------------------------------------------------
  // Narrower spacing than standard: three 1.7m panels have to sit inside a 6.6m
  // wall, so 2.0 keeps the outer pair clear of the corners.

  const bank = own(makePanelBank({
    wallZ: -halfD,
    eyeHeight: room.eyeHeight,
    spacing: 2.0,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // ----- blast door --------------------------------------------------------
  // Shrunk to ~3.0m (frame included) from the original 4.2m, which was 64% of
  // the wall and made the door, not the drum stack, the room's signature. A
  // heavier leaf and sealColour reading bolt-blue: the seal bar is the one place
  // the door's own physical-engaged state shows.

  const door = own(makeSealedDoor({
    width: 2.7,
    height: 2.3,
    frameColour: 0x2c333d,
    leafColour: 0x14181f,
    sealColour: AMBER,
  }));
  door.group.position.set(0, 0, halfD - 0.09);
  group.add(door.group);

  // ----- bolt collars ------------------------------------------------------
  // Eight collars ring the door, each a short bolt-head cylinder. Merged into
  // one geometry; the stencils are a second draw via the atlas.

  const collarParts = [];
  const collarSlots = [];      // {x, y} for the stencil quads
  const collarMatrix = new THREE.Matrix4();
  const collarGeometry = new THREE.CylinderGeometry(0.15, 0.16, 0.09, 12);
  collarGeometry.rotateX(Math.PI / 2);   // axis along Z, face toward the room

  // The ring sits on the FACE of the door leaves, proud of them.
  //
  // It used to be a wide ring at z = 3.17, which put six of the eight collars
  // inside the leaves (x within +/-1.35, y within 0..2.3, leaf front at 3.10) -
  // buried two centimetres deep and invisible. Only the two at x = +/-1.62
  // cleared the door edge, so the player saw two numbers out of eight and had
  // no register to match the drums against.
  //
  // Now the ring is small enough to land on the leaf (collar radius 0.16, so
  // everything stays inside +/-1.17 and 0.28..2.12) and sits in front of it.
  // Bolts around the perimeter of a vault leaf is also simply what the thing is.
  const RING_RX = 1.15;
  const RING_RY = 0.85;
  const RING_CY = 1.2;
  const COLLAR_Z = halfD - 0.28;            // = 3.02, clear of the leaf face at 3.10
  // Half a step of rotation, so no collar is centred on the seal bar that runs
  // across the door at y = 1.16..1.23.
  const RING_PHASE = Math.PI / register.length;

  for (let i = 0; i < register.length; i += 1) {
    const a = (i / register.length) * Math.PI * 2 - Math.PI / 2 + RING_PHASE;
    const cx = Math.cos(a) * RING_RX;
    const cy = RING_CY + Math.sin(a) * RING_RY;
    const clone = collarGeometry.clone();
    collarMatrix.makeTranslation(cx, cy, COLLAR_Z);
    clone.applyMatrix4(collarMatrix);
    collarParts.push(clone);
    collarSlots.push({ x: cx, y: cy });
  }
  collarGeometry.dispose();

  const collarBodyGeometry = mergeGeometries(collarParts);
  for (const p of collarParts) p.dispose();

  const collarBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x323944,
    roughness: 0.5,
    metalness: 0.78,
  });
  group.add(new THREE.Mesh(collarBodyGeometry, collarBodyMaterial));

  const collarAtlas = makeCollarAtlas(register);
  textures.push(collarAtlas.texture);

  const collarStencilGeometry = makeAtlasQuads(
    collarSlots.map((slot, i) => ({
      width: 0.24,
      height: 0.24,
      position: [slot.x, slot.y, COLLAR_Z - 0.05],
      rotation: [0, Math.PI, 0],   // face -Z, toward the camera
      cell: collarAtlas.cells[i],
    })),
    { atlasWidth: collarAtlas.width, atlasHeight: collarAtlas.height },
  );

  const collarStencilMaterial = new THREE.MeshStandardMaterial({
    map: collarAtlas.texture,
    emissive: 0xffffff,
    emissiveMap: collarAtlas.texture,
    emissiveIntensity: settings.collarEmissive,
    transparent: true,
    roughness: 0.9,
  });
  group.add(new THREE.Mesh(collarStencilGeometry, collarStencilMaterial));

  own({
    dispose() {
      collarBodyGeometry.dispose();
      collarBodyMaterial.dispose();
      collarStencilGeometry.dispose();
      collarStencilMaterial.dispose();
    },
  });

  // ----- drum stack --------------------------------------------------------
  // The signature. One shared shaft, six drums as a single InstancedMesh (1
  // draw), rim rings to facet them, a slot bezel, and a bolt-blue backlight bar
  // per slot. The drums are the one thing a player should read from here.

  // Shaft: a thin cylinder along Z carrying all six drums. It is the collider.
  const shaftGeometry = new THREE.CylinderGeometry(0.06, 0.06, room.depth - 0.5, 10);
  shaftGeometry.rotateX(Math.PI / 2);
  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b434d,
    roughness: 0.4,
    metalness: 0.85,
  });
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
  shaft.position.set(DRUM_X, DRUM_Y, 0);
  group.add(shaft);

  const drumGlyphTexture = makeDrumGlyphTexture(register);
  textures.push(drumGlyphTexture);

  const drumGeometry = new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_W, 24);
  drumGeometry.rotateX(Math.PI / 2);   // axis along Z; spin about Z shows glyphs
  // A white vertex-colour attribute, required rather than decorative. The
  // fragment shader only declares vColor under USE_COLOR (vertexColors:true),
  // but that same flag makes the vertex shader multiply by a `color` attribute
  // - and a missing attribute reads as BLACK, which multiplies the whole drum,
  // glyph included, down to nothing. White here is the identity that lets
  // instanceColor through untouched.
  drumGeometry.setAttribute(
    'color',
    new THREE.BufferAttribute(
      new Float32Array(drumGeometry.attributes.position.count * 3).fill(1),
      3,
    ),
  );
  const drumMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: drumGlyphTexture,
    emissive: 0xffffff,
    emissiveMap: drumGlyphTexture,
    emissiveIntensity: settings.drumEmissive,
    roughness: 0.5,
    metalness: 0.6,
    // Required for instanceColor to reach the shader as vColor.
    vertexColors: true,
  });

  // Stock MeshStandardMaterial multiplies vColor into the albedo but NOT the
  // emissive, so a dark instance would still glow. One line in the fragment
  // shader makes the glyph itself go out.
  drumMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor;',
    );
  };

  const drums = new THREE.InstancedMesh(drumGeometry, drumMaterial, DRUM_COUNT);
  drums.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DRUM_COUNT * 3), 3);
  for (let i = 0; i < DRUM_COUNT; i += 1) drums.instanceColor.setXYZ(i, 1, 1, 1);

  // The bank steps TOGETHER, one detent at a time.
  //
  // Six drums drifting at six rates looks busier but destroys the puzzle: the
  // player has to catch the single frame where every backlight is lit, and that
  // frame only exists if the drums are in lockstep. Each drum keeps its own
  // fixed offset into the eight faces, so the row still shows six different
  // marks - what is shared is the clock, not the glyph.
  const drumOffsets = cfg ? cfg.drumOffsets : [0, 1, 2, 3, 5, 6];
  const seatedStep = cfg ? cfg.seatedStep : 0;
  const cycleSeconds = cfg?.cycleSeconds ?? 22.5;
  const faces = cfg?.faces ?? DETENTS;

  // One step per beat, plus a double beat of dwell at the shear line so the
  // player has time to read six glyphs before the bank moves on.
  const BEAT = cycleSeconds / (faces + 1);

  const drumMatrix = new THREE.Matrix4();
  const drumQuat = new THREE.Quaternion();
  const drumEuler = new THREE.Euler();
  const drumPos = new THREE.Vector3();
  const drumScale = new THREE.Vector3(1, 1, 1);

  // Rotation that puts face k's CENTRE in the read window.
  //
  // The glyph band is laid out with u=0 at the drum's bottom after the rotateX,
  // so the window at -X sits at u=0.75 - A/2PI. Seating by k*DETENT_STEP alone
  // therefore parked a cell BOUNDARY in the window - the player saw the bottom
  // of one mark above the top of the next - and the cell it half-showed was
  // (6-k), not the face k that faceAt() reports. The lit/dark tell was being
  // computed for a glyph other than the one on screen. Solving for u = (k+0.5)/8
  // makes the window agree with faceAt().
  const drumAngle = (k) => Math.PI * 1.5 - (k + 0.5) * DETENT_STEP;

  const seatDrum = (i, angle) => {
    drumPos.set(DRUM_X, DRUM_Y, DRUM_Z[i]);
    drumEuler.set(0, 0, angle);
    drumQuat.setFromEuler(drumEuler);
    drumMatrix.compose(drumPos, drumQuat, drumScale);
    drums.setMatrixAt(i, drumMatrix);
  };
  // Seat the initial frame so the bank is not all-zeros for the first tick.
  for (let i = 0; i < DRUM_COUNT; i += 1) seatDrum(i, drumAngle(drumOffsets[i]));
  drums.instanceMatrix.needsUpdate = true;
  group.add(drums);

  // Rim rings facet the drums so the stack reads as six tumblers, not one tube.
  const rimParts = [];
  const rimGeometry = new THREE.TorusGeometry(DRUM_R + 0.005, 0.028, 6, 20);
  const rimMatrix = new THREE.Matrix4();
  for (const z of DRUM_Z) {
    for (const edge of [-1, 1]) {
      const clone = rimGeometry.clone();
      rimMatrix.makeTranslation(DRUM_X, DRUM_Y, z + edge * (DRUM_W / 2));
      clone.applyMatrix4(rimMatrix);
      rimParts.push(clone);
    }
  }
  rimGeometry.dispose();
  const rimMergedGeometry = mergeGeometries(rimParts);
  for (const p of rimParts) p.dispose();
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a313a,
    roughness: 0.45,
    metalness: 0.82,
  });
  group.add(new THREE.Mesh(rimMergedGeometry, rimMaterial));

  // Slot bezel: a shroud over each drum with ONE window cut in it, merged.
  //
  // This used to be four thin bars outlining the window, which framed the slot
  // without hiding anything - the glyph band wrapped right over the drum's top
  // and bottom curve, so a player saw three or four marks per drum and had no
  // way to tell which one the lock was reading. A tumbler window has to occlude.
  //
  // The plates sit at x = 2.36, a couple of centimetres proud of the drum's
  // frontmost point (2.4) so parallax stays small at every distance the player
  // can stand: the drum's upper curve recedes to x = 2.43 by the slot edge, and
  // a sight line from eye height clears the plate at every position inside the
  // room. The thin bars stay on top as the machined lip.
  const bezelParts = [];
  const bezelMatrix = new THREE.Matrix4();
  const BEZEL_X = DRUM_X - DRUM_R - 0.02;                   // = 2.38, just proud of the drum face
  const slotHalfY = 0.16;
  const slotHalfZ = 0.22;
  // The shroud is a SHELL around the drum, not a plate in front of it. A flat
  // mask big enough to hide the wrapped band reads as a slab floating in the
  // room and buries the drum it is supposed to frame; a slightly larger cylinder
  // with the window arc removed hugs the drum and looks like the housing it is.
  //
  // After rotateX(+PI/2) the cylinder's theta origin maps so that the -X face -
  // the one the player reads - sits at 3*PI/2. The window's half-angle is
  // whatever subtends the slot height at the shell radius.
  const SHELL_R = DRUM_R + 0.035;
  const windowHalfAngle = Math.asin(slotHalfY / SHELL_R);
  const shroud = new THREE.CylinderGeometry(
    SHELL_R, SHELL_R, DRUM_W + 0.02, 40, 1, true,
    Math.PI * 1.5 + windowHalfAngle,             // start just past the window
    Math.PI * 2 - windowHalfAngle * 2,           // wrap all the way back to it
  );
  shroud.rotateX(Math.PI / 2);
  const barLong = new THREE.BoxGeometry(0.04, 0.05, 0.5);   // top/bottom lip (along z)
  const barTall = new THREE.BoxGeometry(0.04, 0.34, 0.05);  // side lips (along y)
  for (const z of DRUM_Z) {
    const s = shroud.clone();
    bezelMatrix.makeTranslation(DRUM_X, DRUM_Y, z);
    s.applyMatrix4(bezelMatrix);
    bezelParts.push(s);
    // The machined lip, unchanged - it reads as a bezel around the window.
    for (const dy of [-slotHalfY, slotHalfY]) {
      const c = barLong.clone();
      bezelMatrix.makeTranslation(BEZEL_X, DRUM_Y + dy, z);
      c.applyMatrix4(bezelMatrix);
      bezelParts.push(c);
    }
    for (const dz of [-slotHalfZ, slotHalfZ]) {
      const c = barTall.clone();
      bezelMatrix.makeTranslation(BEZEL_X, DRUM_Y, z + dz);
      c.applyMatrix4(bezelMatrix);
      bezelParts.push(c);
    }
  }
  barLong.dispose();
  barTall.dispose();
  shroud.dispose();
  const bezelGeometry = mergeGeometries(bezelParts);
  for (const p of bezelParts) p.dispose();
  const bezelMaterial = new THREE.MeshStandardMaterial({
    color: 0x20262e,
    roughness: 0.55,
    metalness: 0.7,
  });
  group.add(new THREE.Mesh(bezelGeometry, bezelMaterial));

  // Backlight bars: bolt-blue emissive strips BRACKETING each slot - the visible
  // body for the drum point light, and the "backlit" in backlit read-slot.
  // SIX separate brackets, one material each.
  //
  // They used to be one merged mesh, which was right when they were decoration.
  // Now each bracket reports whether ITS drum is seated on a live collar - that
  // is the tell the whole puzzle is read from - so they have to light
  // independently. Six draw calls instead of one, on small geometry, in
  // exchange for the room's central mechanic.
  //
  // Sized up from a single 2cm strip tucked under the bezel. At a standing eye
  // 3m away that strip was a few pixels tall and read as trim, so the player saw
  // six identically-lit drums and had nothing to read. A bar above AND below,
  // both wider than the slot they frame and proud of the bezel face, makes an
  // unlit slot obvious from anywhere in the room.
  const barParts = [-1, 1].map((side) => {
    const g = new THREE.BoxGeometry(0.035, 0.05, slotHalfZ * 2 + 0.09);
    g.translate(DRUM_X - SHELL_R - 0.03, DRUM_Y + side * (slotHalfY + 0.05), 0);
    return g;
  });
  const backlightBar = mergeGeometries(barParts);
  for (const p of barParts) p.dispose();
  const backlightMaterials = DRUM_Z.map(() => new THREE.MeshStandardMaterial({
    color: 0x0a0f18,
    emissive: BOLT_BLUE,
    emissiveIntensity: settings.backlightEmissive,
    roughness: 0.5,
  }));
  DRUM_Z.forEach((z, i) => {
    const bar = new THREE.Mesh(backlightBar, backlightMaterials[i]);
    bar.position.set(0, 0, z);
    group.add(bar);
  });

  own({
    dispose() {
      shaftGeometry.dispose();
      shaftMaterial.dispose();
      drumGeometry.dispose();
      drumMaterial.dispose();
      drums.dispose();
      rimMergedGeometry.dispose();
      rimMaterial.dispose();
      bezelGeometry.dispose();
      bezelMaterial.dispose();
      backlightBar.dispose();
      for (const m of backlightMaterials) m.dispose();
    },
  });

  // ----- west lattice ------------------------------------------------------
  // One alphaTest plane, FrontSide. The diagonal is this room's silhouette.

  const latticeTexture = makeLatticeTexture();
  textures.push(latticeTexture);

  const latticeGeometry = new THREE.PlaneGeometry(room.depth - 0.5, room.height - 0.5);
  const latticeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: latticeTexture,
    emissive: BOLT_BLUE,
    emissiveMap: latticeTexture,
    emissiveIntensity: settings.latticeEmissive,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    roughness: 0.5,
    metalness: 0.6,
  });
  const lattice = new THREE.Mesh(latticeGeometry, latticeMaterial);
  lattice.position.set(-halfW + 0.04, room.height / 2, 0);
  lattice.rotation.y = Math.PI / 2;   // face +X, into the room
  group.add(lattice);

  own({
    dispose() {
      latticeGeometry.dispose();
      latticeMaterial.dispose();
    },
  });

  // ----- wall stencils -----------------------------------------------------

  const stencils = makeStencilAtlas();
  textures.push(stencils.texture);

  const stencilGeometry = makeAtlasQuads([
    // Title on the west wall over the lattice.
    { width: 2.0, height: 0.48, position: [-halfW + 0.05, 2.28, 0.9], rotation: [0, Math.PI / 2, 0], cell: stencils.cells.title },
    // Hazard on the east wall over the drums.
    { width: 2.1, height: 0.4, position: [halfW - 0.05, 2.22, 0], rotation: [0, -Math.PI / 2, 0], cell: stencils.cells.hazard },
    // Bolt-register header over the door.
    { width: 1.7, height: 0.27, position: [0, 2.46, halfD - 0.05], rotation: [0, Math.PI, 0], cell: stencils.cells.register },
    // Engaged indicator on the north wall, above the panels - bolt-blue.
    { width: 1.5, height: 0.26, position: [halfW - 0.05, 1.0, -1.6], rotation: [0, -Math.PI / 2, 0], cell: stencils.cells.engaged },
  ], { atlasWidth: stencils.width, atlasHeight: stencils.height });

  const stencilMaterial = new THREE.MeshStandardMaterial({
    map: stencils.texture,
    emissive: 0xffffff,
    emissiveMap: stencils.texture,
    emissiveIntensity: settings.stencilEmissive,
    transparent: true,
    roughness: 0.9,
  });
  group.add(new THREE.Mesh(stencilGeometry, stencilMaterial));

  own({
    dispose() {
      stencilGeometry.dispose();
      stencilMaterial.dispose();
    },
  });

  // ----- amber ceiling beacon ----------------------------------------------
  // The one pulsing amber overhead object in the game - the Vault's beacon. Its
  // dome hangs just under the dead strips; a cage merged with the mount is the
  // second draw. The light is one of the room's four.

  const beaconDomeGeometry = new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  beaconDomeGeometry.rotateX(Math.PI);   // curved face downward
  const beaconDomeMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1206,
    emissive: AMBER,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  });
  const beaconDome = new THREE.Mesh(beaconDomeGeometry, beaconDomeMaterial);
  beaconDome.position.set(0, room.height - 0.24, 0);
  group.add(beaconDome);

  const beaconCageParts = [];
  const cageMount = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8);
  cageMount.translate(0, room.height - 0.12, 0);
  beaconCageParts.push(cageMount);
  const cageRing = new THREE.TorusGeometry(0.14, 0.012, 6, 16);
  cageRing.rotateX(Math.PI / 2);
  cageRing.translate(0, room.height - 0.26, 0);
  beaconCageParts.push(cageRing);
  const beaconCageGeometry = mergeGeometries(beaconCageParts);
  for (const p of beaconCageParts) p.dispose();
  const beaconCageMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2118,
    roughness: 0.6,
    metalness: 0.6,
  });
  group.add(new THREE.Mesh(beaconCageGeometry, beaconCageMaterial));

  own({
    dispose() {
      beaconDomeGeometry.dispose();
      beaconDomeMaterial.dispose();
      beaconCageGeometry.dispose();
      beaconCageMaterial.dispose();
    },
  });

  // ----- west emergency lamp -----------------------------------------------
  // A visible-bodied amber fixture high on the west wall, raking the lattice and
  // filling the panels. Nothing in this room is lit by an invisible source.

  const lampParts = [];
  const lampMatrix = new THREE.Matrix4();
  const lampBracket = new THREE.BoxGeometry(0.24, 0.05, 0.05);
  lampMatrix.makeTranslation(-halfW + 0.14, 2.32, -1.9);
  lampBracket.applyMatrix4(lampMatrix);
  lampParts.push(lampBracket);
  const lampHousing = new THREE.BoxGeometry(0.2, 0.18, 0.34);
  lampMatrix.makeTranslation(-halfW + 0.28, 2.24, -1.9);
  lampHousing.applyMatrix4(lampMatrix);
  lampParts.push(lampHousing);
  const lampBodyGeometry = mergeGeometries(lampParts);
  for (const p of lampParts) p.dispose();
  const lampBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2620,
    roughness: 0.45,
    metalness: 0.72,
  });
  group.add(new THREE.Mesh(lampBodyGeometry, lampBodyMaterial));

  const lampLensGeometry = new THREE.PlaneGeometry(0.16, 0.14);
  const lampLensMaterial = new THREE.MeshStandardMaterial({
    color: 0x140f08,
    emissive: AMBER,
    emissiveIntensity: 3.2,
    roughness: 0.3,
  });
  const lampLens = new THREE.Mesh(lampLensGeometry, lampLensMaterial);
  lampLens.position.set(-halfW + 0.45, 2.22, -1.9);
  lampLens.rotation.y = Math.PI / 2;
  group.add(lampLens);

  own({
    dispose() {
      lampBodyGeometry.dispose();
      lampBodyMaterial.dispose();
      lampLensGeometry.dispose();
      lampLensMaterial.dispose();
    },
  });

  // ----- lights ------------------------------------------------------------
  // Four point lights, the critique's hard cap for this room, on BOTH tiers - a
  // fifth light is what tanked the first draft. HIGH raises intensities, never
  // the count. No shadows: the overhead key is disabled and the smallest room
  // cannot afford a shadow pass.

  const beaconLight = new THREE.PointLight(AMBER, settings.beaconIntensity, 12, 2);
  beaconLight.position.set(0, room.height - 0.35, 0);
  group.add(beaconLight);

  const drumLight = new THREE.PointLight(BOLT_BLUE, settings.drumLight, 10, 2);
  drumLight.position.set(DRUM_X - 0.6, DRUM_Y, 0);
  group.add(drumLight);

  const amberLamp = new THREE.PointLight(AMBER, settings.amberLamp, 12, 2);
  amberLamp.position.set(-halfW + 0.6, 2.2, -1.9);
  group.add(amberLamp);

  const panelWash = new THREE.PointLight(AQUA, settings.panelWash, 9, 2);
  panelWash.position.set(0, room.eyeHeight + 0.4, -halfD + 1.2);
  group.add(panelWash);

  // ----- tier --------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;

    drumMaterial.emissiveIntensity = settings.drumEmissive;
    for (const m of backlightMaterials) m.emissiveIntensity = settings.backlightEmissive;
    collarStencilMaterial.emissiveIntensity = settings.collarEmissive;
    stencilMaterial.emissiveIntensity = settings.stencilEmissive;
    latticeMaterial.emissiveIntensity = settings.latticeEmissive;

    bank.setScreenIntensity(settings.screenIntensity);
    bank.setShadows(false);
    door.frame.castShadow = false;

    drumLight.intensity = settings.drumLight;
    amberLamp.intensity = settings.amberLamp;
    panelWash.intensity = settings.panelWash;
    // beaconLight is driven every frame in update(); seed it so a tier switch on
    // a paused frame still lands near the right brightness.
    beaconLight.intensity = settings.beaconIntensity;
  }

  // ----- animation ---------------------------------------------------------

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  function update(elapsed, dt, flags = {}) {
    // The bank steps in unison, holding on each detent and dwelling a double
    // beat on the shear line. Pure function of the shared run clock, so two
    // players in this chamber read the same glyphs at the same moment.
    const phase = bankPhase(elapsed, faces, seatedStep, BEAT);

    for (let i = 0; i < DRUM_COUNT; i += 1) {
      seatDrum(i, drumAngle(drumOffsets[i] + phase.step + phase.ease));
    }
    drums.instanceMatrix.needsUpdate = true;

    // THE TELL. A drum lights only when it is showing a glyph whose collar is
    // NOT struck through - a tumbler can only seat on a bolt that is still live.
    // Once per cycle every drum comes on at once: the shear line, the instant
    // neither thrown bolt is anywhere in the stack.
    //
    // The signal is carried by the DRUM FACE, not just the bracket beside it.
    // Every glyph used to glow at the same intensity whatever its collar said,
    // so all six drums looked identical and "which are lit" meant nothing on
    // screen. Now an unseated drum drops to dark steel - its glyph stops
    // emitting entirely - and the shear line is six faces igniting together.
    for (let i = 0; i < DRUM_COUNT; i += 1) {
      const face = faceAt(drumOffsets, i, phase.step, faces);
      const live = !register[face]?.thrown;
      // A touch of shimmer so a lit drum reads as powered rather than painted.
      const shimmer = 0.96 + 0.04 * Math.sin(elapsed * 3.1 + i);
      backlightMaterials[i].emissiveIntensity = live
        ? settings.backlightEmissive * shimmer
        : 0.02;
      const level = live ? shimmer : DEAD_DRUM_LEVEL;
      drums.instanceColor.setXYZ(i, level, level, level);
    }
    drums.instanceColor.needsUpdate = true;

    // The beacon keeps a strict metronome against the bank's stepping, so the
    // dwell at the shear line is audible-in-the-eye: the beacon beats on while
    // the drums visibly pause.
    const pulse = 0.7 + 0.3 * Math.sin((elapsed / BEAT) * Math.PI * 2);
    beaconLight.intensity = settings.beaconIntensity * pulse;
    beaconDomeMaterial.emissiveIntensity = 2.4 * (0.75 + 0.25 * pulse);

    for (let i = 0; i < bank.panels.length; i += 1) {
      const panel = bank.panels[i];
      const wave = Math.sin(elapsed * 0.9 + i * 2.1);
      panel.screenMaterial.emissiveIntensity =
        settings.screenIntensity * (0.9 + wave * 0.1) + panel.glowBoost;
      panel.pipMaterial.emissiveIntensity = 1.7 + Math.sin(elapsed * 2.4 + i * 1.7) * 0.8;
    }

    door.pulse(elapsed);
  }

  function dispose() {
    for (const part of parts) part.dispose?.();
    for (const texture of textures) disposeTexture(texture);
  }

  return {
    id: 'vault',
    group,
    panels: bank.panels,
    dimensions: { ...room },
    // The drum stack is the one freestanding obstacle. The shaft footprint plus
    // the drums keeps the player far enough west to read the slots but never
    // walk into the tumblers. The door frame and collars sit beyond the south
    // wall's own player margin, so they need no collider.
    colliders: [
      { x: DRUM_X + 0.02, z: 0, hw: 0.46, hd: 2.85 },
    ],
    environment: {
      // Backup power: the overhead key stays off and the dead ceiling strips
      // carry that story. Ambient does NOT have to be starved to sell it.
      //
      // Raised from 1.15 after playtest - the room read as atmospheric in a
      // screenshot and unreadable to stand in. Ambient is the right lever: it
      // is a single uniform, so it costs nothing per-light the way another lamp
      // would, and it lifts the floor without touching the emergency-lit look.
      ambientColour: 0x54617a,
      ambientIntensity: 2.9,
      keyEnabled: false,
      // Fog was the real culprit. In a 6.6m room the corner-to-corner diagonal
      // is 9.3m, so near=4.5/far=13 had every wall already fading toward black
      // before any lamp reached it. Pushed beyond the room so fog only softens
      // the far corners instead of draining the whole space.
      fogColour: 0x141b26,
      fogNear: 11,
      fogFar: 30,
      clearColour: 0x0b1018,
    },
    update,
    applyTier,
    dispose,
  };
}

/**
 * Indexed detent angle for a drum: it rests in a detent for most of each cycle,
 * then eases (smoothstep) into the next over the final slice. Held long enough
 * that the seated glyph stays readable - a value a player cannot read is a
 * correctness bug, and both clients must agree, so this is a pure function of
 * elapsed with no per-client state.
 */
/**
 * Where the bank is in its cycle at `elapsed`.
 *
 * Returns { step, ease }: which detent the bank has reached, and how far it has
 * eased into the next one. The shear line gets a DOUBLE beat - the bank visibly
 * pauses there, which is the second tell (the first being all six backlights
 * coming on) that this is the frame to read.
 *
 * Pure function of elapsed, so every client in the chamber agrees without any
 * network sync. `elapsed` is the shared run clock, not time-since-mount.
 */
function bankPhase(elapsed, faces, seatedStep, beat) {
  // The seated step lasts two beats, so a full cycle is faces + 1 beats long.
  const cycle = (faces + 1) * beat;
  let t = ((elapsed % cycle) + cycle) % cycle;

  for (let step = 0; step < faces; step += 1) {
    const isSeated = step === seatedStep;
    const span = isSeated ? beat * 2 : beat;
    if (t < span) {
      // Hold still for most of the beat, then ease into the next detent.
      const CLICK = isSeated ? 0.88 : 0.78;
      const f = t / span;
      const e = f > CLICK ? (() => {
        const u = (f - CLICK) / (1 - CLICK);
        return u * u * (3 - 2 * u);
      })() : 0;
      return { step, ease: e, seated: isSeated && f <= CLICK };
    }
    t -= span;
  }
  return { step: faces - 1, ease: 0, seated: false };
}

/** The face drum `i` is showing at `step`. */
function faceAt(offsets, i, step, faces) {
  return (offsets[i] + step) % faces;
}
