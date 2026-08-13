// rooms/archive.js - the Archive.
//
// 8.4 x 8.4 x 4.6m. Taller than the engine default, so this file builds against
// its own numbers and hands them back for the shadow frustum and fog range.
//
// The room is dark on purpose. The overhead lighting died decades ago; every
// light still working has a body you can see. That means the engine's default
// overhead key has to be re-aimed into a horizontal rake along the west stacks
// and ambient dropped hard, or the room contradicts its own premise on frame one.
//
// The layout rule that separates this room from the Vault at a glance: every
// readable surface lives under 2.6m and the top two metres are genuinely empty.
// Dense stripe band low, one bright ring, void above.

import * as THREE from 'three';
import {
  newCanvas,
  toTexture,
  disposeTexture,
  lcg,
  drawTrackedText,
  grainPass,
  streakPass,
  bevelRect,
} from '../roomkit/canvas.js';
import {
  makeStandardShell,
  makePanelBank,
  makeSealedDoor,
  makeAtlasQuads,
  mergeGeometries,
} from '../roomkit/geometry.js';

const ROOM = { width: 8.4, depth: 8.4, height: 4.6, eyeHeight: 1.62 };

const VELLUM = 0xe6ddc8;
const VELLUM_CSS = '#e6ddc8';
const INK_CSS = '#2a2318';
const POINTER_VIOLET_CSS = '#8f7bff';

const TIERS = {
  low: {
    cardEmissive: 0.34,
    labelEmissive: 0.2,
    railEmissive: 0.5,
    screenIntensity: 0.8,
    accentStrength: 0.5,
    shadows: false,
  },
  high: {
    cardEmissive: 0.46,
    labelEmissive: 0.28,
    railEmissive: 0.8,
    screenIntensity: 1.1,
    accentStrength: 1,
    shadows: true,
  },
};

// ---------------------------------------------------------------------------
// Carousel geometry constants
//
// Rail radius and rate are fixed by the design: one revolution in ~114s, which
// is slow enough that a player reads a card rather than chasing it.
// ---------------------------------------------------------------------------

const CARD_COUNT = 48;
const RAIL_RADIUS = 2.9;
const RAIL_Y = 2.95;
const CARD_RATE = 0.055;

const CARD_W = 0.3;
const CARD_H = 0.52;
// Card top sits 0.09 under the rail. Centre lands at 2.62 and the ink block in
// the lower two thirds falls under 2.6, which is what the "all data low" rule
// actually protects. The ring itself is the one object allowed in the void.
const CARD_Y = RAIL_Y - 0.09 - CARD_H / 2;

const CARD_COLS = 8;
const CARD_ROWS = 6;
const CARD_CELL_W = 96;
const CARD_CELL_H = 166;
const CARD_ATLAS_W = CARD_COLS * CARD_CELL_W;
const CARD_ATLAS_H = CARD_ROWS * CARD_CELL_H;

// ---------------------------------------------------------------------------
// Shelving layout
// ---------------------------------------------------------------------------

const SHELF_DEPTH = 0.42;
const BAY_WIDTH = 2.3;
const BAY_Z = [-1.5, 1.5];
// The third board lands on 1.05 deliberately. That is the game's waist
// horizontal, and here the shelf itself carries it rather than a trim rail -
// see the note where makeTrimRail would otherwise go.
const LEVEL_Y = [0.2, 0.59, 1.05, 1.51, 1.97];
const CAP_Y = 2.43;
const WALL_SIGNS = [-1, 1];

const LABEL_ATLAS_W = 1024;
const LABEL_ATLAS_H = 464;
const STRIP_W = 512;
const STRIP_H = 32;
const DRAWER_W = 168;
const DRAWER_H = 48;
const DRAWER_BAND_Y = 320;

// 20 shelf strips, one per bay level, all distinct - a catalogue that repeats
// its own call numbers is not a catalogue.
const STRIP_TEXT = [
  'AA 001-064  CREW MANIFEST',
  'AB 065-128  WATCH ROTATION',
  'AC 129-192  HULL SURVEY',
  'AD 193-256  COOLANT LOOP A',
  'AE 257-320  COOLANT LOOP B',
  'BA 321-384  VALVE SCHEDULE',
  'BB 385-448  GAUGE INDEX',
  'BC 449-512  BREAKER MAP',
  'BD 513-576  SEAL REGISTER',
  'BE 577-640  BOLT REGISTER',
  'CA 641-704  STAR CATALOGUE',
  'CB 705-768  DECLINATION TBL',
  'CC 769-832  MERIDIAN NOTES',
  'CD 833-896  PLATEAU BEARINGS',
  'CE 897-960  CLOUD DECK LOG',
  'DA 961-024  MASONRY SURVEY',
  'DB 025-088  RETROFIT ORDERS',
  'DC 089-152  KEYSTONE INDEX',
  'DD 153-216  LETTER BLOCKS',
  'DE 217-280  REDACTION LOG',
];

const DRAWER_TEXT = [
  'A-01 ACK', 'A-02 ADM', 'A-03 ALT',
  'B-01 BLK', 'B-02 BOL', 'B-03 BRK',
  'C-01 CAL', 'C-02 CIP', 'C-03 CLD',
  'D-01 DEC', 'D-02 DRM', 'D-03 DWL',
  'E-01 ENG', 'E-02 EXT', 'E-03 EYE',
  'F-01 FLW', 'F-02 FRG', 'F-03 FUS',
];

/** Dark board floor. Vellum grit in the grain is the only warm note down here. */
function makeFloorTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1a1712';
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(9041);
  const plank = size / 8;
  for (let i = 0; i < 8; i += 1) {
    const shade = 0.045 * (rand() - 0.5);
    ctx.fillStyle = shade > 0 ? `rgba(230,221,200,${shade})` : `rgba(0,0,0,${-shade})`;
    ctx.fillRect(0, i * plank, size, plank);

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, i * plank);
    ctx.lineTo(size, i * plank);
    ctx.stroke();

    // End joints stagger per plank so the floor does not read as a single sheet.
    const joint = rand() * size;
    ctx.beginPath();
    ctx.moveTo(joint, i * plank);
    ctx.lineTo(joint, (i + 1) * plank);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 2600, seed: 31, alpha: 0.05 });

  return toTexture(canvas, { repeat: 3 });
}

/** Ledger-stone wall: coursed ashlar, damp weeping down from the dead fixtures. */
function makeWallTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#211e19';
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(5527);
  const course = size / 6;
  for (let row = 0; row < 6; row += 1) {
    const offset = (row % 2) * (size / 8);
    for (let col = -1; col < 5; col += 1) {
      const x = offset + col * (size / 4);
      const y = row * course;
      const shade = 0.05 * (rand() - 0.45);
      ctx.fillStyle = shade > 0 ? `rgba(230,221,200,${shade})` : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(x, y, size / 4, course);
      bevelRect(ctx, { x, y, width: size / 4, height: course, depth: 2, alpha: 0.08 });
    }
  }

  streakPass(ctx, { width: size, height: size, count: 22, seed: 61, alpha: 0.07 });
  grainPass(ctx, { width: size, height: size, count: 1800, seed: 17, alpha: 0.04 });

  return toTexture(canvas, { repeat: [2, 1.4] });
}

/** Shelf carcass and cabinet bodies. One texture across every merged box. */
function makeCarcassTexture() {
  const size = 256;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b2519';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  const rand = lcg(7723);
  for (let i = 0; i < 26; i += 1) {
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + 4, size * 0.7, y - 4, size, y);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 900, seed: 43, alpha: 0.05 });

  // Every merged box carries UVs 0..1 per face, so a repeat tiles finer on the
  // small drawer faces than on the long boards. That reads as grain scale, not
  // as an error, which is why the carcass is textured at all.
  return toTexture(canvas, { repeat: 2 });
}

/**
 * 48 index cards into one atlas.
 *
 * Seeded, because two players must read the same card to each other. Six cards
 * carry a pointer-violet redaction instead of a letter block - the prefix the
 * Engine Room has to read off a pipe before this room's own fragment closes.
 */
function makeCardAtlas(cardBySlot) {
  const canvas = newCanvas(CARD_ATLAS_W, CARD_ATLAS_H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CARD_ATLAS_W, CARD_ATLAS_H);

  const rand = lcg(20724);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  for (let i = 0; i < CARD_COUNT; i += 1) {
    const cx = (i % CARD_COLS) * CARD_CELL_W;
    const cy = Math.floor(i / CARD_COLS) * CARD_CELL_H;

    ctx.save();
    ctx.translate(cx, cy);

    // 2px bleed guard: neighbouring cells must not sample into each other when
    // the card is minified at the far side of the ring.
    const w = CARD_CELL_W - 4;
    const h = CARD_CELL_H - 4;
    ctx.translate(2, 2);

    const age = rand();
    ctx.fillStyle = VELLUM_CSS;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgba(70,58,38,${0.05 + age * 0.11})`;
    ctx.fillRect(0, 0, w, h);

    bevelRect(ctx, { x: 0, y: 0, width: w, height: h, depth: 2, alpha: 0.16 });

    // Punch hole - a filing card without one is a business card.
    ctx.fillStyle = 'rgba(20,16,10,0.85)';
    ctx.beginPath();
    ctx.arc(w / 2, 15, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(60,50,32,0.45)';
    ctx.lineWidth = 1;
    for (const y of [30, 74, 118]) {
      ctx.beginPath();
      ctx.moveTo(9, y);
      ctx.lineTo(w - 9, y);
      ctx.stroke();
    }

    // A CHARGE CARD: the slip left behind when entries are withdrawn. It
    // carries the call number, which is the address the shelf strips resolve.
    // Drawn large and flagged in violet, because it is the one thing on this
    // rail the player has to read and it goes past at walking pace.
    const charge = cardBySlot.get(i);
    if (charge) {
      // Stamped in INK, not pointer-violet. A charge card's call number is
      // resolved against the strips on THIS room's own shelves, so it is local
      // data - and violet is reserved for values that belong to another
      // chamber. Flagging it violet would send the reader looking for a room
      // that has nothing to do with it.
      ctx.fillStyle = INK_CSS;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(9, 26, w - 18, 20);
      ctx.globalAlpha = 1;
      ctx.fillStyle = VELLUM_CSS;
      ctx.font = '700 13px "IBM Plex Mono", ui-monospace, monospace';
      drawTrackedText(ctx, 'CHARGE', w / 2, 36, 2);

      ctx.fillStyle = INK_CSS;
      ctx.font = '700 40px "IBM Plex Mono", ui-monospace, monospace';
      drawTrackedText(ctx, String(charge.callNumber), w / 2, 78, 3);

      ctx.fillStyle = 'rgba(52,43,28,0.75)';
      ctx.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
      drawTrackedText(ctx, 'CALL No.', w / 2, 106, 3);
      drawTrackedText(ctx, 'ENTRIES OUT >', w / 2, 132, 1);

      ctx.restore();
      continue;
    }

    const code = String(i).padStart(2, '0');
    ctx.fillStyle = INK_CSS;
    ctx.font = '700 36px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, code, w / 2, 53, 4);

    // Every card carries an ordinary letter block.
    //
    // Every eighth one used to be stamped with a pointer-violet "PREFIX"
    // redaction - phase 3 art from when the Archive needed a fixed prefix held
    // by the Engine Room. Violet means "this belongs to another chamber", so
    // once the ring became dynamic these cards were telling the player to go
    // find a chamber that may not be in the run at all. The Archive's real
    // dependency is the request slip named on the Fragment panel.
    const start = Math.floor(rand() * 24);
    const block = alphabet.slice(start, start + 3);
    ctx.fillStyle = INK_CSS;
    ctx.font = '600 24px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, block, w / 2, 96, 7);

    ctx.fillStyle = 'rgba(52,43,28,0.72)';
    ctx.font = '400 12px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, `BLK ${String(i % 12).padStart(2, '0')}`, w / 2, 132, 2);

    ctx.fillStyle = 'rgba(52,43,28,0.42)';
    ctx.font = '400 10px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, `DC-${String(89 + i).padStart(3, '0')}`, w / 2, 150, 1);

    // Foxing. Same generator, so both clients see the same stained cards.
    const spots = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < spots; s += 1) {
      ctx.fillStyle = `rgba(96,72,36,${0.05 + rand() * 0.09})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 1.5 + rand() * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  return toTexture(canvas);
}

/** Shelf-edge strips and drawer labels share one atlas so they share one draw. */
function makeLabelAtlas(stripText) {
  const canvas = newCanvas(LABEL_ATLAS_W, LABEL_ATLAS_H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, LABEL_ATLAS_W, LABEL_ATLAS_H);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  for (let i = 0; i < stripText.length; i += 1) {
    const x = (i % 2) * STRIP_W;
    const y = Math.floor(i / 2) * STRIP_H;

    ctx.save();
    ctx.translate(x + 2, y + 2);
    const w = STRIP_W - 4;
    const h = STRIP_H - 4;

    ctx.fillStyle = VELLUM_CSS;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,58,38,0.1)';
    ctx.fillRect(0, 0, w, h);
    bevelRect(ctx, { x: 0, y: 0, width: w, height: h, depth: 2, alpha: 0.2 });

    ctx.fillStyle = INK_CSS;
    ctx.font = '600 20px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, stripText[i], w / 2, h / 2, 2);
    ctx.restore();
  }

  for (let i = 0; i < DRAWER_TEXT.length; i += 1) {
    const x = (i % 6) * DRAWER_W;
    const y = DRAWER_BAND_Y + Math.floor(i / 6) * DRAWER_H;

    ctx.save();
    ctx.translate(x + 2, y + 2);
    const w = DRAWER_W - 4;
    const h = DRAWER_H - 4;

    ctx.fillStyle = VELLUM_CSS;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(70,58,38,0.13)';
    ctx.fillRect(0, 0, w, h);
    bevelRect(ctx, { x: 0, y: 0, width: w, height: h, depth: 2, alpha: 0.22 });

    ctx.fillStyle = INK_CSS;
    ctx.font = '600 24px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, DRAWER_TEXT[i], w / 2, h / 2, 3);
    ctx.restore();
  }

  return toTexture(canvas);
}

export function createArchive({ dimensions, puzzle }) {
  // CIRCULATION. The arrangement the server generated: which four withdrawals
  // are outstanding, where each stands on the rail and how many entries came
  // out with it, plus the shelf strips whose ranges turn a call number into a
  // section. Falls back so the room still renders in isolation.
  const cfg = puzzle?.config || null;
  const withdrawals = cfg?.withdrawals || [
    { size: 6, callNumber: '693', slot: 3 },
    { size: 7, callNumber: '833', slot: 14 },
    { size: 2, callNumber: '900', slot: 25 },
    { size: 3, callNumber: '540', slot: 38 },
  ];
  const stripRows = cfg?.strips || null;
  // Same shape the room already used: CODE lo-hi WORD. The word's initial is
  // the payload, so the range and the word must sit on one strip together.
  const stripLabels = stripRows
    ? stripRows.map((r) => `${r.code} ${String(r.lo).padStart(3, '0')}-${String(r.hi).padStart(3, '0')}  ${r.word}`)
    : STRIP_TEXT;

  // A withdrawal's charge card stands at its slot and the entries it took come
  // out of the slots AFTER it. Counting that gap is how the player recovers the
  // size - the neighbour's request slip is a list of sizes, and without the gap
  // there is nothing to match it against.
  const cardBySlot = new Map();
  const removed = new Set();
  for (const w of withdrawals) {
    cardBySlot.set(w.slot % CARD_COUNT, w);
    for (let k = 1; k <= w.size; k += 1) removed.add((w.slot + k) % CARD_COUNT);
  }

  // dimensions arrives as the engine default; this room is taller, so it builds
  // against ROOM and hands ROOM back. `dimensions` is read only for eyeHeight so
  // a future engine-wide eye change still propagates here.
  const room = { ...ROOM, eyeHeight: dimensions?.eyeHeight ?? ROOM.eyeHeight };
  const group = new THREE.Group();

  const parts = [];
  const textures = [];
  const own = (part) => {
    parts.push(part);
    return part;
  };

  let settings = TIERS.low;

  // ----- shell -------------------------------------------------------------

  const floorTexture = makeFloorTexture();
  const wallTexture = makeWallTexture();
  const carcassTexture = makeCarcassTexture();
  const cardTexture = makeCardAtlas(cardBySlot);
  const labelTexture = makeLabelAtlas(stripLabels);
  textures.push(floorTexture, wallTexture, carcassTexture, cardTexture, labelTexture);

  const shell = own(makeStandardShell({
    width: room.width,
    depth: room.depth,
    height: room.height,
    floorMap: floorTexture,
    wallMap: wallTexture,
    // Textures carry the colour, so tints stay at white. The north wall is the
    // one exception and it is only slightly off white.
    northTint: 0xd8d2c6,
    // The dead ceiling. Near black and unlit is the entire point of the room -
    // it is what leaves the top two metres empty.
    ceilingTint: 0x08070a,
    roughness: 0.9,
    metalness: 0.06,
  }));
  group.add(shell.group);

  // No makeTrimRail here, and this is a substitution rather than an omission.
  // The rail runs at a fixed inset on all four sides: at the default 0.05 its
  // east and west runs pass straight through the shelf uprights and the books,
  // and at an inset clearing the 0.42 carcass it stands in front of the sealed
  // door. So the waist invariant is carried by the shelf board at 1.05 across
  // both stack walls - a real horizontal at the stated height, 22 metres of it,
  // for no draw call at all.

  // ----- panels ------------------------------------------------------------

  const bank = own(makePanelBank({
    wallZ: -room.depth / 2,
    eyeHeight: room.eyeHeight,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // ----- door --------------------------------------------------------------

  const door = own(makeSealedDoor({ frameColour: 0x3a352a, leafColour: 0x171410 }));
  door.group.position.set(0, 0, room.depth / 2 - 0.09);
  group.add(door.group);

  // ----- shelf carcass + card cabinets -------------------------------------
  // Every box in this section merges into one geometry. Sixty-odd boxes at one
  // draw is the reason the stripe band can be this dense at all.

  const carcassParts = [];
  const matrix = new THREE.Matrix4();
  const pushBox = (geometry, x, y, z) => {
    const cloned = geometry.clone();
    matrix.makeTranslation(x, y, z);
    cloned.applyMatrix4(matrix);
    carcassParts.push(cloned);
  };

  const boardGeometry = new THREE.BoxGeometry(SHELF_DEPTH, 0.05, BAY_WIDTH);
  const uprightGeometry = new THREE.BoxGeometry(SHELF_DEPTH, 2.28, 0.06);
  const cabinetGeometry = new THREE.BoxGeometry(1.12, 1.08, 0.44);
  const drawerGeometry = new THREE.BoxGeometry(0.345, 0.325, 0.05);

  const carcassX = room.width / 2 - SHELF_DEPTH / 2;

  for (const sign of WALL_SIGNS) {
    for (const bz of BAY_Z) {
      for (const y of [...LEVEL_Y, CAP_Y]) {
        pushBox(boardGeometry, sign * carcassX, y, bz);
      }
      for (const edge of [-1, 1]) {
        pushBox(uprightGeometry, sign * carcassX, (LEVEL_Y[0] + CAP_Y) / 2, bz + edge * (BAY_WIDTH / 2));
      }
    }
  }

  // Card cabinets flank the door. They sit on the south wall so the player's
  // first look away from the panel bank still lands on readable text.
  const cabinetZ = room.depth / 2 - 0.22;
  const drawerZ = cabinetZ - 0.22 - 0.025;
  const drawerCols = [-0.375, 0, 0.375];
  const drawerRows = [0.2, 0.545, 0.89];

  for (const sign of WALL_SIGNS) {
    pushBox(cabinetGeometry, sign * 1.7, 0.54, cabinetZ);
    for (const dy of drawerRows) {
      for (const dx of drawerCols) {
        pushBox(drawerGeometry, sign * 1.7 + dx, dy, drawerZ);
      }
    }
  }

  boardGeometry.dispose();
  uprightGeometry.dispose();
  cabinetGeometry.dispose();
  drawerGeometry.dispose();

  const carcassGeometry = mergeGeometries(carcassParts);
  for (const p of carcassParts) p.dispose();

  const carcassMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: carcassTexture,
    roughness: 0.86,
    metalness: 0.08,
  });

  const carcass = new THREE.Mesh(carcassGeometry, carcassMaterial);
  carcass.receiveShadow = true;
  group.add(carcass);

  own({
    dispose() {
      carcassGeometry.dispose();
      carcassMaterial.dispose();
    },
  });

  // ----- shelf spines ------------------------------------------------------
  // One InstancedMesh. Widths and tints come from the shared LCG so both clients
  // see the same stack - a player saying "the pale one, third from the left"
  // has to mean the same object on both machines.

  const spineRand = lcg(3319);
  const spineTransforms = [];
  const spineColour = new THREE.Color();
  const spineColours = [];

  for (const sign of WALL_SIGNS) {
    for (const bz of BAY_Z) {
      for (const y of LEVEL_Y) {
        let cursor = bz - BAY_WIDTH / 2 + 0.06;
        const limit = bz + BAY_WIDTH / 2 - 0.06;
        while (cursor < limit) {
          // Thinner books, packed tighter. Roughly 1.6x the count of the first
          // pass - the shelves should read as genuinely full, and they are one
          // InstancedMesh so the extra volumes cost nothing per draw.
          const w = 0.022 + spineRand() * 0.05;
          if (cursor + w > limit) break;

          const h = 0.24 + spineRand() * 0.14;
          const d = 0.24 + spineRand() * 0.09;
          const lean = (spineRand() - 0.5) * 0.05;

          spineTransforms.push({
            x: sign * (room.width / 2 - 0.06 - d / 2),
            y: y + 0.025 + h / 2,
            z: cursor + w / 2,
            sx: d,
            sy: h,
            sz: w,
            lean,
          });

          // Mostly drab board with occasional vellum-bright cloth: the raking
          // light needs something to catch or the rake is invisible.
          const bright = spineRand();
          const warm = 0.1 + spineRand() * 0.06;
          spineColour.setHSL(warm, 0.18 + spineRand() * 0.2, bright > 0.82 ? 0.5 : 0.13 + bright * 0.14);
          spineColours.push(spineColour.clone());

          cursor += w + 0.0035;
        }
      }
    }
  }

  const spineGeometry = new THREE.BoxGeometry(1, 1, 1);
  const spineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.02,
  });

  const spines = new THREE.InstancedMesh(spineGeometry, spineMaterial, spineTransforms.length);
  spines.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const spineMatrix = new THREE.Matrix4();
  const spineQuat = new THREE.Quaternion();
  const spineEuler = new THREE.Euler();
  const spinePos = new THREE.Vector3();
  const spineScale = new THREE.Vector3();

  for (let i = 0; i < spineTransforms.length; i += 1) {
    const t = spineTransforms[i];
    spinePos.set(t.x, t.y, t.z);
    spineScale.set(t.sx, t.sy, t.sz);
    spineEuler.set(t.lean, 0, 0);
    spineQuat.setFromEuler(spineEuler);
    spineMatrix.compose(spinePos, spineQuat, spineScale);
    spines.setMatrixAt(i, spineMatrix);
    spines.setColorAt(i, spineColours[i]);
  }
  spines.instanceMatrix.needsUpdate = true;
  if (spines.instanceColor) spines.instanceColor.needsUpdate = true;

  group.add(spines);

  own({
    dispose() {
      spineGeometry.dispose();
      spineMaterial.dispose();
      spines.dispose();
    },
  });

  // ----- shelf strips + drawer labels --------------------------------------
  // 38 legible text surfaces, one draw call.

  const labelQuads = [];
  let stripIndex = 0;

  for (const sign of WALL_SIGNS) {
    for (const bz of BAY_Z) {
      for (const y of LEVEL_Y) {
        const cell = [
          (stripIndex % 2) * STRIP_W,
          Math.floor(stripIndex / 2) * STRIP_H,
          STRIP_W,
          STRIP_H,
        ];
        stripIndex += 1;

        labelQuads.push({
          width: BAY_WIDTH * 0.96,
          height: 0.144,
          // Hangs just under the board edge, the way a real shelf label clip
          // does. Sits inside the bay below, which is why spines are short.
          position: [sign * (room.width / 2 - SHELF_DEPTH - 0.004), y - 0.075, bz],
          rotation: [0, sign * Math.PI / 2, 0],
          cell,
        });
      }
    }
  }

  let drawerIndex = 0;
  for (const sign of WALL_SIGNS) {
    for (const dy of drawerRows) {
      for (const dx of drawerCols) {
        const cell = [
          (drawerIndex % 6) * DRAWER_W,
          DRAWER_BAND_Y + Math.floor(drawerIndex / 6) * DRAWER_H,
          DRAWER_W,
          DRAWER_H,
        ];
        drawerIndex += 1;

        labelQuads.push({
          width: 0.28,
          height: 0.08,
          position: [sign * 1.7 + dx, dy, drawerZ - 0.028],
          rotation: [0, Math.PI, 0],
          cell,
        });
      }
    }
  }

  const labelGeometry = makeAtlasQuads(labelQuads, {
    atlasWidth: LABEL_ATLAS_W,
    atlasHeight: LABEL_ATLAS_H,
  });

  const labelMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: labelTexture,
    emissive: 0xffffff,
    emissiveMap: labelTexture,
    emissiveIntensity: settings.labelEmissive,
    roughness: 0.95,
    metalness: 0,
  });

  const labels = new THREE.Mesh(labelGeometry, labelMaterial);
  group.add(labels);

  own({
    dispose() {
      labelGeometry.dispose();
      labelMaterial.dispose();
    },
  });

  // ----- catalogue carousel ------------------------------------------------
  // The room's whole argument. 48 cards on one merged geometry plus one torus,
  // rotated as a single Group. Because the camera can only turn, orbiting the
  // cards past a fixed viewpoint is the same thing as walking a card index -
  // the no-movement constraint becomes the mechanic instead of fighting it.
  //
  // Rail hangers were cut per the critique: at 2.9m they subtend under 2px and
  // alias into crawling noise, which costs more than the missing detail.

  const carouselGroup = new THREE.Group();
  group.add(carouselGroup);

  const cardQuads = [];
  for (let i = 0; i < CARD_COUNT; i += 1) {
    // THE GAP. Slots whose entries are out on loan carry no card at all.
    // "Nothing leaves this room without leaving its place behind" - the empty
    // run after a charge card is how many entries went with it, and counting it
    // is the only way to match a card to the neighbour's request slip.
    if (removed.has(i)) continue;
    const theta = (i / CARD_COUNT) * Math.PI * 2;
    cardQuads.push({
      width: CARD_W,
      height: CARD_H,
      position: [Math.sin(theta) * RAIL_RADIUS, CARD_Y, Math.cos(theta) * RAIL_RADIUS],
      // Quad faces +Z at rest; +PI turns its normal back toward the origin, so
      // every card presents its face to the fixed camera. No per-card tilt -
      // an X term in an XYZ euler would rotate about world X and skew every
      // card not already on the Z axis.
      rotation: [0, theta + Math.PI, 0],
      cell: [
        (i % CARD_COLS) * CARD_CELL_W,
        Math.floor(i / CARD_COLS) * CARD_CELL_H,
        CARD_CELL_W,
        CARD_CELL_H,
      ],
    });
  }

  const cardGeometry = makeAtlasQuads(cardQuads, {
    atlasWidth: CARD_ATLAS_W,
    atlasHeight: CARD_ATLAS_H,
  });

  // The cards carry their own low emissive. Judgment call against the "every
  // light has a body" rule: one raking lamp lights maybe a third of the ring at
  // a time, and rule 9 says both players must be able to read every card. So the
  // cards are lit paper rather than lamps - intensity stays under 0.5 so they
  // read as catching light, not glowing.
  const cardMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: cardTexture,
    emissive: 0xffffff,
    emissiveMap: cardTexture,
    emissiveIntensity: settings.cardEmissive,
    roughness: 0.96,
    metalness: 0,
  });

  const cards = new THREE.Mesh(cardGeometry, cardMaterial);
  cards.frustumCulled = false;
  carouselGroup.add(cards);

  const railGeometry = new THREE.TorusGeometry(RAIL_RADIUS, 0.018, 6, 96);
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2620,
    emissive: VELLUM,
    emissiveIntensity: settings.railEmissive,
    roughness: 0.4,
    metalness: 0.7,
  });

  const carouselRail = new THREE.Mesh(railGeometry, railMaterial);
  carouselRail.rotation.x = Math.PI / 2;
  carouselRail.position.y = RAIL_Y;
  carouselGroup.add(carouselRail);

  own({
    dispose() {
      cardGeometry.dispose();
      cardMaterial.dispose();
      railGeometry.dispose();
      railMaterial.dispose();
    },
  });

  // ----- the one working lamp ----------------------------------------------
  // South-west corner, aimed north along the west stacks. Grazing incidence is
  // what makes a wall of spines read as depth rather than as a flat stripe.

  const lampParts = [];
  const bracketGeometry = new THREE.BoxGeometry(0.34, 0.05, 0.05);
  const housingGeometry = new THREE.BoxGeometry(0.22, 0.2, 0.46);

  const bracketClone = bracketGeometry.clone();
  matrix.makeTranslation(-3.88, 2.66, 3.5);
  bracketClone.applyMatrix4(matrix);
  lampParts.push(bracketClone);

  const housingClone = housingGeometry.clone();
  matrix.makeTranslation(-3.7, 2.55, 3.5);
  housingClone.applyMatrix4(matrix);
  lampParts.push(housingClone);

  bracketGeometry.dispose();
  housingGeometry.dispose();

  const lampBodyGeometry = mergeGeometries(lampParts);
  for (const p of lampParts) p.dispose();

  const lampBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e2a22,
    roughness: 0.42,
    metalness: 0.72,
  });

  const lampBody = new THREE.Mesh(lampBodyGeometry, lampBodyMaterial);
  group.add(lampBody);

  const lensGeometry = new THREE.PlaneGeometry(0.19, 0.16);
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0x14110b,
    emissive: VELLUM,
    emissiveIntensity: 3.4,
    roughness: 0.3,
  });

  const lampLens = new THREE.Mesh(lensGeometry, lensMaterial);
  lampLens.position.set(-3.7, 2.53, 3.268);
  lampLens.rotation.y = Math.PI;
  group.add(lampLens);

  own({
    dispose() {
      lampBodyGeometry.dispose();
      lampBodyMaterial.dispose();
      lensGeometry.dispose();
      lensMaterial.dispose();
    },
  });

  // ----- accent lights -----------------------------------------------------
  // Two point lights, plus the engine's ambient and re-aimed key: four total on
  // LOW, which is the cap. Both have a visible body - the lamp housing and the
  // panel screens - so nothing in here is lit by an invisible source.

  const lampGlow = new THREE.PointLight(VELLUM, 0, 7.5, 2);
  lampGlow.position.set(-3.62, 2.5, 3.34);
  group.add(lampGlow);

  const panelWash = new THREE.PointLight(0x5ef2d0, 0, 8, 2);
  panelWash.position.set(0, room.eyeHeight + 0.4, -room.depth / 2 + 1.5);
  group.add(panelWash);

  // ----- ceiling lighting --------------------------------------------------
  //
  // The original design had the ceiling lighting DEAD - one raking side lamp and
  // nothing else - to make the Archive the dark room. It read as atmospheric in
  // a screenshot and as "I cannot see the room" in play, which is the wrong
  // trade: a player who cannot read the shelves cannot do the one thing this
  // room is for.
  //
  // So the fixtures work now. Four pendant lamps over the floor, each with a
  // VISIBLE BODY and a real light inside it, which keeps the room's rule that
  // nothing is lit by an invisible source. The Archive stays warmer and moodier
  // than the other chambers; it is no longer dark to the point of unusable.

  const fixtureBodyGeometry = new THREE.CylinderGeometry(0.26, 0.34, 0.16, 10, 1, true);
  const fixtureLensGeometry = new THREE.CircleGeometry(0.3, 12);
  const fixtureRodGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6);

  const fixtureBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d1a14,
    roughness: 0.6,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });

  const fixtureLensMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2418,
    emissive: 0xffe9bd,
    emissiveIntensity: 3.2,
  });

  const fixtureRodMaterial = new THREE.MeshStandardMaterial({
    color: 0x24201a,
    roughness: 0.7,
    metalness: 0.6,
  });

  const FIXTURE_POSITIONS = [
    [-2.1, -2.1],
    [2.1, -2.1],
    [-2.1, 2.1],
    [2.1, 2.1],
  ];

  const FIXTURE_Y = room.height - 0.75;
  const ceilingFixtures = [];

  for (const [fx, fz] of FIXTURE_POSITIONS) {
    const rod = new THREE.Mesh(fixtureRodGeometry, fixtureRodMaterial);
    rod.position.set(fx, FIXTURE_Y + 0.33, fz);
    group.add(rod);

    const body = new THREE.Mesh(fixtureBodyGeometry, fixtureBodyMaterial);
    body.position.set(fx, FIXTURE_Y, fz);
    group.add(body);

    const lens = new THREE.Mesh(fixtureLensGeometry, fixtureLensMaterial);
    lens.position.set(fx, FIXTURE_Y - 0.081, fz);
    lens.rotation.x = -Math.PI / 2;
    group.add(lens);

    // Warm, short-range, and NOT a shadow caster. Four shadow-casting lights
    // would mean four extra full renders of the room per frame; the one
    // directional key already carries the shadows.
    const light = new THREE.PointLight(0xffe4b0, 0, 8.5, 2);
    light.position.set(fx, FIXTURE_Y - 0.2, fz);
    group.add(light);

    // Only the diagonal pair casts real light on LOW. Every extra light is
    // evaluated per lit fragment on every surface, and four of them puts this
    // room over budget on an integrated GPU. The other two fixtures keep their
    // lens emissive, so all four still LOOK lit - the room reads identically and
    // costs a third less. HIGH turns the full four on.
    const diagonalPair = (fx < 0) === (fz < 0);
    ceilingFixtures.push({ light, baseIntensity: 11, lowTier: diagonalPair });
  }

  own({
    dispose() {
      fixtureBodyGeometry.dispose();
      fixtureLensGeometry.dispose();
      fixtureRodGeometry.dispose();
      fixtureBodyMaterial.dispose();
      fixtureLensMaterial.dispose();
      fixtureRodMaterial.dispose();
    },
  });

  // ----- no floating particles ---------------------------------------------
  //
  // The index slivers were cut. Two reasons, and the second is a real bug.
  //
  // 1. Aarav did not want particles drifting in the rooms.
  // 2. They passed through the walls. The cloud filled the whole floor plan and
  //    the drift was a Y rotation of the entire cloud - so a mote in a corner,
  //    5.5m from centre, swung straight through a wall standing 4.2m away. Any
  //    rotating cloud in a rectangular room has this defect; a fix would need
  //    per-particle bounds work, which is exactly the per-frame CPU cost the
  //    whole particle approach exists to avoid.
  //
  // Atmosphere here now comes from the raking light and the shelf shadows,
  // which is cheaper and does not float through masonry.

  // ----- tier --------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;

    cardMaterial.emissiveIntensity = settings.cardEmissive;
    labelMaterial.emissiveIntensity = settings.labelEmissive;
    railMaterial.emissiveIntensity = settings.railEmissive;

    lampGlow.intensity = 9 * settings.accentStrength;
    panelWash.intensity = 5 * settings.accentStrength;

    bank.setScreenIntensity(settings.screenIntensity);
    bank.setShadows(settings.shadows);
    door.frame.castShadow = settings.shadows;
    carcass.castShadow = settings.shadows;
    // Spines are the only thing worth casting here - the rake across them is the
    // room's single lighting idea and shadow is most of what sells it.
    spines.castShadow = settings.shadows;

    for (const fixture of ceilingFixtures) {
      const lit = name === 'high' || fixture.lowTier;
      // The pair that stays on at LOW burns brighter to cover for the pair that
      // does not, so the room's overall brightness barely changes between tiers.
      // A tier switch must never change what a player can read.
      fixture.light.intensity = lit
        ? fixture.baseIntensity * (name === 'high' ? 1 : 1.5)
        : 0;
    }
  }

  // ----- animation ---------------------------------------------------------

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  function update(elapsed, dt, flags = {}) {
    // The entire signature: one Group rotation, 48 cards, zero per-card cost.
    carouselGroup.rotation.y += dt * CARD_RATE;

    // A ballast on its way out. Deliberately shallow - a hard flicker would
    // change what a player can read, and two players on different frames must
    // still agree about the shelf.
    const flicker = 0.94
      + Math.sin(elapsed * 7.3) * 0.03
      + Math.sin(elapsed * 23.7) * 0.02;
    lensMaterial.emissiveIntensity = 3.4 * flicker;
    lampGlow.intensity = 9 * settings.accentStrength * flicker;

    railMaterial.emissiveIntensity = settings.railEmissive * (0.9 + Math.sin(elapsed * 0.7) * 0.1);

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
    id: 'archive',
    group,
    panels: bank.panels,
    dimensions: { ...room },
    // Solid furniture, as circles-vs-boxes on the floor plan. Four shelf bays
    // and the two card cabinets flanking the door. The carousel needs nothing -
    // it orbits at 2.4m+, well above anyone's head.
    colliders: [
      { x: room.width / 2 - 0.21, z: -1.5, hw: 0.3, hd: 1.25 },
      { x: room.width / 2 - 0.21, z: 1.5, hw: 0.3, hd: 1.25 },
      { x: -(room.width / 2 - 0.21), z: -1.5, hw: 0.3, hd: 1.25 },
      { x: -(room.width / 2 - 0.21), z: 1.5, hw: 0.3, hd: 1.25 },
      { x: 1.7, z: room.depth / 2 - 0.22, hw: 0.62, hd: 0.3 },
      { x: -1.7, z: room.depth / 2 - 0.22, hw: 0.62, hd: 0.3 },
    ],
    environment: {
      // Raised from 0.5 to 1.35 now the ceiling fixtures work. The original was
      // tuned for a room with no overhead lighting at all, and at that level the
      // shelves were unreadable rather than moody.
      ambientColour: 0x4a4438,
      ambientIntensity: 1.35,
      // The key is not overhead here. It is the lamp in the south-west corner
      // firing north along the west stacks; if it stays overhead it contradicts
      // the dead-ceiling premise in the first frame.
      keyColour: VELLUM,
      keyIntensity: 3.1,
      keyEnabled: true,
      keyPosition: [-3.7, 2.55, 3.5],
      keyTarget: [-3.95, 1.0, -3.8],
      fogColour: 0x0a0908,
      fogNear: 5.5,
      fogFar: 17,
      clearColour: 0x07060a,
    },
    update,
    applyTier,
    dispose,
  };
}
