// rooms/observatory.js - the instrument deck under the glass dome.
//
// The room owns ALTITUDE and DECLINATION. The Spire owns azimuth and the floor
// rose, so there is deliberately no compass rose here: the downward moment is a
// polished black pier holding a dim reflection of the rings, not a graduated
// disc. Silhouette signature is the curved rib grid overhead.
//
// VERTICAL LAYOUT - the one thing to understand before editing anything.
// The engine hard-fixes the camera at y = 1.62 (engine.js:71) and a room cannot
// move it. A 2.4m parapet standing on a floor at y = 0 therefore puts the eye
// 0.78m BELOW the cap, which hides the sky, the dome, the moon and the cloud
// deck - every single thing this room is about. So the observing deck is sunk to
// y = -2.2 and the player stands on a 2.2m instrument pier. The parapet is still
// 2.4m of real masonry (-2.2 to +0.2); the eye is now 1.42m above its cap and
// looks down over it. Real observatories are built exactly this way, for exactly
// this reason. Every height below is world-space, pier top = 0.

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
  getMoteSprite,
} from '../roomkit/canvas.js';
import {
  makeStandardShell,
  makeTrimRail,
  makePanelBank,
  makeSealedDoor,
  makeAtlasQuads,
  mergeGeometries,
} from '../roomkit/geometry.js';

const DECK_Y = -2.2;        // observing floor, 2.2m below the pier top
const PARAPET_H = 2.4;      // masonry height; cap lands at DECK_Y + 2.4 = +0.2
const PIER_R = 1.6;         // 3.2m pier. Larger and its rim eats the door sill.
const DOME_R = 6.2;
const CAGE_R = 6.15;
const HUB_Y = 1.62;         // armillary centre = eye. The player is the origin.

const VIOLET = '#8f7bff';
const VIOLET_HEX = 0x8f7bff;

const TIERS = {
  low: {
    stars: 900,
    starOpacity: 0.72,
    starSize: 0.20,
    ringGlow: 0.55,
    screenIntensity: 0.85,
    tipGlow: 1.4,
    friezeGlow: 0.5,
  },
  high: {
    stars: 2600,
    starOpacity: 0.9,
    starSize: 0.22,
    ringGlow: 0.8,
    screenIntensity: 1.15,
    tipGlow: 2.1,
    friezeGlow: 0.5,
  },
};

// The catalogue this room HOLDS. Other rooms read these six values off the
// frieze, so they are data, not decoration - ordered by declination so a player
// reading them aloud has an unambiguous sequence.
const CATALOGUE = [
  { index: '01', name: 'THUBAN', dec: '+64°22′' },
  { index: '02', name: 'ALKAID', dec: '+49°19′' },
  { index: '03', name: 'SADR', dec: '+40°15′' },
  { index: '04', name: 'MENKAR', dec: '+04°05′' },
  { index: '05', name: 'KEID', dec: '−07°39′' },
  { index: '06', name: 'ACRUX', dec: '−63°06′' },
];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Quarried limestone ashlar - the shared station material, cool and unlit. */
function makeDeckTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6f6c64';
  ctx.fillRect(0, 0, size, size);

  const slab = size / 4;
  const rand = lcg(0x0b5e);
  for (let ry = 0; ry < 4; ry += 1) {
    for (let rx = 0; rx < 4; rx += 1) {
      const shade = (rand() - 0.5) * 0.09;
      ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(rx * slab, ry * slab, slab, slab);
      // Baked bevel instead of a light: the deck sits 2.2m below the eye and no
      // real fixture is allowed in this room, so the joints have to carry their
      // own relief in the albedo or they vanish entirely.
      bevelRect(ctx, {
        x: rx * slab, y: ry * slab, width: slab, height: slab, depth: 3, alpha: 0.16,
      });
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    const p = i * slab;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 2200, seed: 41, alpha: 0.07 });
  return toTexture(canvas, { repeat: 3 });
}

/** Parapet masonry: horizontal courses, weathered. Six courses per 2.4m. */
function makeParapetTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#767267';
  ctx.fillRect(0, 0, size, size);

  const course = size / 6;
  const rand = lcg(0x27d1);
  for (let c = 0; c < 6; c += 1) {
    // Stagger every other course so the vertical joints do not stack into a
    // continuous seam, which is the giveaway that masonry was tiled.
    const offset = (c % 2) * (size / 8);
    for (let b = 0; b < 4; b += 1) {
      const x = offset + b * (size / 4);
      const shade = (rand() - 0.5) * 0.1;
      ctx.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(x, c * course, size / 4, course);
      bevelRect(ctx, {
        x, y: c * course, width: size / 4, height: course, depth: 3, alpha: 0.18,
      });
    }
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(0, c * course, size, 3);
  }

  streakPass(ctx, { width: size, height: size, count: 22, seed: 9, alpha: 0.07 });
  grainPass(ctx, { width: size, height: size, count: 1800, seed: 57, alpha: 0.06 });
  return toTexture(canvas, { repeat: [3, 1] });
}

/**
 * The polished pier top.
 *
 * The brief asks for a dim reflection of the rings and sky. A real reflection is
 * a second render pass this room cannot afford, so it is PAINTED - and painted
 * deliberately vague: broad soft arcs rather than a literal mirror image,
 * because the rings above actually turn and a crisp static reflection under
 * moving rings is a lie a player will catch. Vague polish streaks are not.
 */
function makePierTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  ctx.fillStyle = '#07080e';
  ctx.fillRect(0, 0, size, size);

  const sky = ctx.createRadialGradient(c, c, 0, c, c, c);
  sky.addColorStop(0, 'rgba(92,84,158,0.30)');
  sky.addColorStop(0.55, 'rgba(58,54,104,0.16)');
  sky.addColorStop(1, 'rgba(10,11,22,0.02)');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);

  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(143,123,255,0.10)';
  for (const [rx, ry, rot] of [[196, 74, 0.22], [162, 108, -0.5], [128, 52, 1.05]]) {
    ctx.beginPath();
    ctx.ellipse(c, c, rx, ry, rot, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Moon glint. Bottom-left of the canvas is the south-west quadrant of the pier
  // once the disc is laid flat; approximate on purpose, it is a smear not a body.
  const glint = ctx.createRadialGradient(168, 344, 0, 168, 344, 96);
  glint.addColorStop(0, 'rgba(214,206,188,0.20)');
  glint.addColorStop(1, 'rgba(214,206,188,0)');
  ctx.fillStyle = glint;
  ctx.fillRect(72, 248, 192, 192);

  grainPass(ctx, { width: size, height: size, count: 900, seed: 77, alpha: 0.035 });
  return toTexture(canvas);
}

/**
 * A graduated ring band. 2048px = one full turn, so the U axis is degrees.
 *
 * No baked cylinder shading: the texture repeats three times around the tube so
 * a painted highlight would give the ring three flat facets, and the torus
 * normals already shade it correctly.
 */
function makeRingTexture({ ticks, majorEvery, labelFor, markCss }) {
  const width = 2048;
  const height = 64;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#14141f';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, width, 2);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  for (let i = 0; i < ticks; i += 1) {
    const x = (i * width) / ticks;
    const major = i % majorEvery === 0;
    ctx.fillStyle = major ? markCss : 'rgba(214,220,236,0.5)';
    const h = major ? 22 : 10;
    ctx.fillRect(x, 0, major ? 3 : 2, h);
    ctx.fillRect(x, height - h, major ? 3 : 2, h);
  }

  // Labels sit just clockwise of their tick rather than centred on it. Centring
  // would clip the zero label in half against the canvas edge, and the seam is
  // the one place on a graduated ring a player will definitely be looking.
  const nudge = ((majorEvery * width) / ticks) * 0.42;
  ctx.font = '700 34px "IBM Plex Mono", ui-monospace, monospace';
  for (let i = 0; i < ticks; i += majorEvery) {
    ctx.fillStyle = markCss;
    drawTrackedText(ctx, labelFor(i), (i * width) / ticks + nudge, height / 2, 3);
  }

  // Repeat 3x around the tube so whichever face of the ring is turned toward the
  // player carries a complete, readable graduation rather than a third of one.
  return toTexture(canvas, { repeat: [1, 3], anisotropy: 8 });
}

/**
 * Dome glass: frost, smears, and the distant cloud horizon.
 *
 * The horizon band is the interesting part. The camera's downward view over the
 * parapet reaches ~13.6 degrees of depression at the corners; the cloud
 * RingGeometry only spans 31-59m before the engine's 60m far plane cuts it off,
 * which leaves a wedge of empty space between the cloud's outer edge and the
 * true horizon. Painting that wedge into the dome's lower rows fills it for zero
 * draw calls, and "distant cloud seen through glass" is what it physically is.
 * v = 0 is the zenith, v = 1 the dome's lower rim.
 */
function makeDomeTexture() {
  const width = 1024;
  const height = 512;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const horizon = ctx.createLinearGradient(0, height * 0.66, 0, height * 0.90);
  horizon.addColorStop(0, 'rgba(38,40,74,0)');
  horizon.addColorStop(0.42, 'rgba(96,96,150,0.55)');
  horizon.addColorStop(0.72, 'rgba(126,124,176,0.72)');
  horizon.addColorStop(1, 'rgba(20,20,38,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, height * 0.66, width, height * 0.24);

  // Cloud tops break the horizon band's straight edge; without them it reads as
  // a gradient on glass rather than as weather far below.
  const rand = lcg(0x3f10);
  ctx.fillStyle = 'rgba(150,148,196,0.34)';
  for (let i = 0; i < 90; i += 1) {
    const x = rand() * width;
    const y = height * 0.735 + (rand() - 0.5) * 22;
    const w = 24 + rand() * 90;
    ctx.beginPath();
    ctx.ellipse(x, y, w, 5 + rand() * 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Frost and cleaning smears over the whole shell, heavier low where hands and
  // condensation reach.
  ctx.strokeStyle = 'rgba(176,188,224,0.055)';
  for (let i = 0; i < 46; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const len = 40 + rand() * 210;
    const arc = (rand() - 0.5) * 1.4;
    ctx.lineWidth = 6 + rand() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y + arc * 60, x + len, y + arc * 18);
    ctx.stroke();
  }

  grainPass(ctx, { width, height, count: 5200, seed: 88, alpha: 0.045, size: 2 });
  return toTexture(canvas);
}

/** Cloud sea, tiled. Seen at a grazing angle 7.6m below the eye. */
function makeCloudTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3b3d63';
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(0x6c2a);
  for (let i = 0; i < 160; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 26 + rand() * 82;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    const lum = 0.16 + rand() * 0.3;
    blob.addColorStop(0, `rgba(178,180,222,${lum})`);
    blob.addColorStop(1, 'rgba(178,180,222,0)');
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  grainPass(ctx, { width: size, height: size, count: 1400, seed: 5, alpha: 0.03 });
  return toTexture(canvas, { repeat: 9 });
}

/** An airless moon. Shrunk to ~13 degrees and stripped of its ring system. */
function makeMoonTexture() {
  const width = 512;
  const height = 256;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#b3ad9f';
  ctx.fillRect(0, 0, width, height);

  const rand = lcg(0x1a44);
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * width;
    const y = height * 0.18 + rand() * height * 0.64;
    const r = 18 + rand() * 54;
    ctx.fillStyle = `rgba(108,104,98,${0.2 + rand() * 0.24})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.62, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 120; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 2 + rand() * 9;
    ctx.strokeStyle = `rgba(240,236,224,${0.1 + rand() * 0.16})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Baked terminator. The moon uses MeshBasicMaterial - lighting it for real
  // would need a light the room's own rule forbids, and an unlit full disc reads
  // as a hole punched in the sky.
  const term = ctx.createLinearGradient(0, 0, width, 0);
  term.addColorStop(0, 'rgba(255,250,238,0.22)');
  term.addColorStop(0.42, 'rgba(0,0,0,0)');
  term.addColorStop(0.78, 'rgba(0,0,0,0.55)');
  term.addColorStop(1, 'rgba(0,0,0,0.82)');
  ctx.fillStyle = term;
  ctx.fillRect(0, 0, width, height);

  const limb = ctx.createLinearGradient(0, 0, 0, height);
  limb.addColorStop(0, 'rgba(0,0,0,0.4)');
  limb.addColorStop(0.5, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, width, height);

  return toTexture(canvas);
}

/** Six engraved catalogue plates in one 1024x512 atlas -> one draw call. */
function makeFriezeAtlas() {
  const width = 1024;
  const height = 512;
  const cellW = 512;
  const cellH = 160;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const cells = CATALOGUE.map((entry, i) => {
    const cx = (i % 2) * cellW;
    const cy = Math.floor(i / 2) * cellH;

    ctx.fillStyle = '#171928';
    ctx.fillRect(cx, cy, cellW, cellH);
    bevelRect(ctx, {
      x: cx + 6, y: cy + 6, width: cellW - 12, height: cellH - 12, depth: 4, alpha: 0.26,
    });

    ctx.strokeStyle = 'rgba(143,123,255,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx + 16, cy + 14, cellW - 32, cellH - 28);

    ctx.fillStyle = 'rgba(196,206,228,0.42)';
    ctx.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(entry.index, cx + 34, cy + 40);

    ctx.fillStyle = 'rgba(226,232,246,0.92)';
    ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, entry.name, cx + cellW / 2, cy + 52, 7);

    // The declination is the value another room needs, so it is the only violet
    // on the plate and the largest thing on it.
    ctx.fillStyle = VIOLET;
    ctx.font = '700 46px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, entry.dec, cx + cellW / 2, cy + 112, 5);

    return [cx, cy, cellW, cellH];
  });

  return { texture: toTexture(canvas, { anisotropy: 8 }), cells, width, height };
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export function createObservatory({ dimensions, puzzle } = {}) {
  // The session's arrangement: where the chain hangs, and which two plates each
  // meteor fall lights. Falls back to a fixed demo chain so the room still
  // renders standalone.
  const cfg = puzzle?.config || null;
  const chainAzimuth = cfg?.azimuthOffset ?? 60;
  const falls = cfg?.falls ?? [[2, 4], [1, 6], [3, 4], [1, 5], [2, 3]];
  const fallCycle = cfg?.cycleSeconds ?? 20;
  const room = {
    width: dimensions.width,
    depth: dimensions.depth,
    height: PARAPET_H,
    eyeHeight: dimensions.eyeHeight,
  };

  const group = new THREE.Group();
  const parts = [];
  const textures = [];
  const own = (part) => {
    parts.push(part);
    return part;
  };

  let settings = TIERS.low;

  const halfW = room.width / 2;
  const halfD = room.depth / 2;

  // ----- shell -------------------------------------------------------------

  const deckTexture = makeDeckTexture();
  const parapetTexture = makeParapetTexture();
  textures.push(deckTexture, parapetTexture);

  const shell = own(makeStandardShell({
    width: room.width,
    depth: room.depth,
    height: PARAPET_H,
    ceiling: false,
    floorMap: deckTexture,
    wallMap: parapetTexture,
    // Both maps carry their own colour, so the tints stay at or near white.
    // North is the de-blued slate the panel bank sits on - darker, not tinted.
    northTint: 0x8d94a6,
    roughness: 0.92,
    metalness: 0.04,
  }));
  shell.group.position.set(0, DECK_Y, 0);
  group.add(shell.group);

  const cap = own(makeTrimRail({
    width: room.width,
    depth: room.depth,
    y: DECK_Y + PARAPET_H,
    thickness: 0.07,
    colour: 0x4a4d63,
  }));
  group.add(cap.mesh);

  // ----- pier --------------------------------------------------------------
  // Drum and top are separate meshes because the drum is rough quarried stone
  // and the top is polished. One mesh with a material array costs the same two
  // draws and buys nothing.

  const pierTexture = makePierTexture();
  textures.push(pierTexture);

  const drumGeometry = new THREE.CylinderGeometry(PIER_R, PIER_R + 0.07, -DECK_Y, 36, 1, true);
  const drumMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b2b36,
    roughness: 0.95,
    metalness: 0.05,
  });
  const drum = new THREE.Mesh(drumGeometry, drumMaterial);
  drum.position.set(0, DECK_Y / 2, 0);
  group.add(drum);

  const pierTopGeometry = new THREE.CircleGeometry(PIER_R, 44);
  const pierTopMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: pierTexture,
    roughness: 0.16,
    metalness: 0.72,
  });
  const pierTop = new THREE.Mesh(pierTopGeometry, pierTopMaterial);
  pierTop.rotation.x = -Math.PI / 2;
  group.add(pierTop);

  own({
    dispose() {
      drumGeometry.dispose();
      drumMaterial.dispose();
      pierTopGeometry.dispose();
      pierTopMaterial.dispose();
    },
  });

  // ----- ring beam ---------------------------------------------------------
  // The waist horizontal, 1.05m above the surface the player stands on. It sits
  // at r = 3.9 rather than at the pier rim: a rail on the rim would land at the
  // exact height that cuts a band out of the panel bank, and the beam is where
  // the armillary bearings would really be anyway. Merged with its eight struts.

  const beamParts = [];
  {
    const beam = new THREE.TorusGeometry(3.9, 0.055, 6, 64);
    beam.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    beam.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 1.05, 0));
    beamParts.push(beam);

    // Struts tie the beam down to the parapet cap: 0.28m out and 0.80m down,
    // so they lean 0.336rad off vertical. The box is long in Z and the yaw is
    // applied after the lean, which is what keeps the lean RADIAL rather than
    // tangential - getting that order backwards makes eight struts that all
    // splay sideways.
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const strut = new THREE.BoxGeometry(0.05, 0.05, 0.86);
      const m = new THREE.Matrix4()
        .makeRotationY(a)
        .multiply(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - 0.336)));
      m.setPosition(Math.sin(a) * 4.04, 0.63, Math.cos(a) * 4.04);
      strut.applyMatrix4(m);
      beamParts.push(strut);
    }
  }
  const beamGeometry = mergeGeometries(beamParts);
  for (const g of beamParts) g.dispose();

  const beamMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4155,
    roughness: 0.44,
    metalness: 0.78,
  });
  group.add(new THREE.Mesh(beamGeometry, beamMaterial));
  own({
    dispose() {
      beamGeometry.dispose();
      beamMaterial.dispose();
    },
  });

  // ----- panels ------------------------------------------------------------
  // Panel centres sit low on the parapet's inner face - the parapet only has
  // 2.4m of face and the eye is above its cap, so a console you look DOWN at is
  // the only option. It is also the right one: this room looks up at sky and
  // down at instruments.

  const PANEL_Y = DECK_Y + 1.65;

  const bank = own(makePanelBank({
    wallZ: -halfD,
    eyeHeight: PANEL_Y,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // makePanelBank computes focusPitch assuming the panel is at eye level. It is
  // not, here - 27 degrees below it - and phase 4 aims the camera with this
  // value, so correct it rather than leaving the helper lying to every caller.
  for (const panel of bank.panels) {
    const dx = panel.holder.position.x;
    const dz = panel.holder.position.z;
    panel.focusPitch = Math.atan2(PANEL_Y - room.eyeHeight, Math.hypot(dx, dz));
  }

  // ----- door --------------------------------------------------------------

  const door = own(makeSealedDoor({ width: 1.6, height: 2.15 }));
  door.group.position.set(0, DECK_Y, halfD - 0.09);
  group.add(door.group);

  // ----- frieze ------------------------------------------------------------

  const frieze = makeFriezeAtlas();
  textures.push(frieze.texture);

  const friezeQuads = CATALOGUE.map((_, i) => {
    const east = i < 3;
    const slot = i % 3;
    return {
      width: 1.44,
      height: 0.45,
      position: [east ? halfW - 0.02 : -halfW + 0.02, DECK_Y + 1.9, (slot - 1) * 1.75],
      rotation: [0, east ? -Math.PI / 2 : Math.PI / 2, 0],
      cell: frieze.cells[i],
    };
  });

  const friezeGeometry = makeAtlasQuads(friezeQuads, {
    atlasWidth: frieze.width,
    atlasHeight: frieze.height,
  });
  const friezeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: frieze.texture,
    emissive: 0xffffff,
    emissiveMap: frieze.texture,
    emissiveIntensity: settings.friezeGlow,
    roughness: 0.6,
    metalness: 0.1,
  });
  group.add(new THREE.Mesh(friezeGeometry, friezeMaterial));
  own({
    dispose() {
      friezeGeometry.dispose();
      friezeMaterial.dispose();
    },
  });

  // ----- glass dome --------------------------------------------------------
  // The single object that stops this room being the Spire. thetaLength runs
  // past the horizontal so the dome's rim finishes below the deck and is hidden
  // behind the parapet from every angle, instead of floating in mid-air.

  const domeTexture = makeDomeTexture();
  textures.push(domeTexture);

  const domeGeometry = new THREE.SphereGeometry(
    DOME_R, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.58,
  );
  const domeMaterial = new THREE.MeshBasicMaterial({
    map: domeTexture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  group.add(new THREE.Mesh(domeGeometry, domeMaterial));
  own({
    dispose() {
      domeGeometry.dispose();
      domeMaterial.dispose();
    },
  });

  // ----- glazing cage ------------------------------------------------------
  // 12 ribs + 3 latitude rings, one merged geometry. Left unlit and dark on
  // purpose: it is a silhouette against the sky, and a silhouette is what the
  // 12px thumbnail test actually reads.

  const cageParts = [];
  {
    const RIB_DROP = 0.28;
    for (let i = 0; i < 12; i += 1) {
      const rib = new THREE.TorusGeometry(CAGE_R, 0.045, 6, 20, Math.PI / 2 + RIB_DROP);
      const m = new THREE.Matrix4()
        .makeRotationY((i / 12) * Math.PI * 2)
        .multiply(new THREE.Matrix4().makeRotationZ(-RIB_DROP));
      rib.applyMatrix4(m);
      cageParts.push(rib);
    }
    for (const lat of [0.38, 0.80, 1.22]) {
      const ring = new THREE.TorusGeometry(CAGE_R * Math.cos(lat), 0.04, 6, 40);
      const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      m.setPosition(0, CAGE_R * Math.sin(lat), 0);
      ring.applyMatrix4(m);
      cageParts.push(ring);
    }
  }
  const cageGeometry = mergeGeometries(cageParts);
  for (const g of cageParts) g.dispose();

  const cageMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b1d2b,
    roughness: 0.72,
    metalness: 0.42,
  });
  group.add(new THREE.Mesh(cageGeometry, cageMaterial));
  own({
    dispose() {
      cageGeometry.dispose();
      cageMaterial.dispose();
    },
  });

  // ----- armillary ---------------------------------------------------------
  // The signature. Three graduated rings around the fixed camera, on three
  // tilts, at three rates.
  //
  // Tilts are chosen so each ring is clear of the panel bank where it crosses
  // the north sightline - two ride above it, one below. They still sweep across
  // the panels twice a revolution as a ~1.5 degree hairline, which is what a
  // real instrument does and is the price of the player standing inside it.
  // Anything thinner than this and the graduations stop being readable, which
  // would cost more than the crossing does.

  // 72 ticks = one every 5 degrees, labelled every 30. A label every 20 was the
  // first attempt and is wrong: 20 does not divide 90, so the quadrant fold
  // produced values no altitude scale has ever carried.
  const quadrant = (deg) => 90 - Math.abs(90 - (deg % 180));

  const RINGS = [
    {
      radius: 3.55,
      tube: 0.095,
      tilt: [0.40, 0.07],
      rate: 0.055,
      texture: makeRingTexture({
        ticks: 72,
        majorEvery: 6,
        markCss: 'rgba(222,228,244,0.92)',
        // Altitude: 0 at the horizon, 90 at the zenith, repeating each quadrant.
        // Height above the horizon, never a bearing - the Spire owns bearings.
        labelFor: (i) => `${quadrant(i * 5)}`,
      }),
    },
    {
      radius: 3.05,
      tube: 0.085,
      tilt: [0.50, -0.12],
      rate: -0.082,
      texture: makeRingTexture({
        ticks: 72,
        majorEvery: 6,
        markCss: VIOLET,
        // The declination ring, and the only one with violet numerals. The
        // room's hue marks the value the crew has to read off and nothing else,
        // which is what makes "declination violet" a measurement rather than a
        // decor choice.
        labelFor: (i) => {
          const deg = i * 5;
          const value = quadrant(deg);
          if (value === 0) return '0';
          return `${deg < 180 ? '+' : '−'}${value}`;
        },
      }),
    },
    {
      radius: 2.55,
      tube: 0.075,
      tilt: [-0.28, 0.18],
      rate: 0.037,
      texture: makeRingTexture({
        ticks: 96,
        majorEvery: 4,
        markCss: 'rgba(222,228,244,0.92)',
        labelFor: (i) => `${i / 4}h`,
      }),
    },
  ];

  const ringMaterials = [];
  const ringSpinners = [];
  const ringGeometries = [];

  for (const spec of RINGS) {
    textures.push(spec.texture);

    const tilt = new THREE.Group();
    tilt.position.set(0, HUB_Y, 0);
    tilt.rotation.set(spec.tilt[0], 0, spec.tilt[1]);
    group.add(tilt);

    const spinner = new THREE.Group();
    tilt.add(spinner);
    ringSpinners.push({ node: spinner, rate: spec.rate });

    const geometry = new THREE.TorusGeometry(spec.radius, spec.tube, 10, 220);
    ringGeometries.push(geometry);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: spec.texture,
      emissive: 0xffffff,
      emissiveMap: spec.texture,
      emissiveIntensity: settings.ringGlow,
      roughness: 0.38,
      metalness: 0.66,
    });
    ringMaterials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    spinner.add(mesh);
  }

  own({
    dispose() {
      for (const g of ringGeometries) g.dispose();
      for (const m of ringMaterials) m.dispose();
    },
  });

  // ----- alidade -----------------------------------------------------------
  // Rides 1.05m above the eye rather than pivoting through it, because a bar
  // pivoting at the hub would pass through the camera every revolution. Two
  // draws: the bar, and both rose tips merged.

  const alidade = new THREE.Group();
  alidade.position.set(0, HUB_Y + 1.05, 0);
  alidade.rotation.z = 0.10;
  group.add(alidade);

  const barParts = [];
  {
    const spine = new THREE.BoxGeometry(7.4, 0.05, 0.05);
    barParts.push(spine);
    for (const side of [-1, 1]) {
      const vane = new THREE.BoxGeometry(0.06, 0.26, 0.06);
      vane.applyMatrix4(new THREE.Matrix4().makeTranslation(side * 2.6, 0.1, 0));
      barParts.push(vane);
    }
    const boss = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 16);
    barParts.push(boss);
  }
  const barGeometry = mergeGeometries(barParts);
  for (const g of barParts) g.dispose();

  const barMaterial = new THREE.MeshStandardMaterial({
    color: 0x555a70,
    roughness: 0.38,
    metalness: 0.82,
  });
  alidade.add(new THREE.Mesh(barGeometry, barMaterial));

  const tipParts = [];
  for (const side of [-1, 1]) {
    const tip = new THREE.ConeGeometry(0.07, 0.3, 10);
    const m = new THREE.Matrix4().makeRotationZ(side * -Math.PI / 2);
    m.setPosition(side * 3.6, 0, 0);
    tip.applyMatrix4(m);
    tipParts.push(tip);
  }
  const tipGeometry = mergeGeometries(tipParts);
  for (const g of tipParts) g.dispose();

  // Rose is the game's "private" colour, so this is the one place the palette is
  // stretched: here it is a physical index mark on an instrument, kept small and
  // deliberately NOT pulsing, so it cannot be mistaken for a private-data pip.
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a1520,
    emissive: 0xff6b9d,
    emissiveIntensity: settings.tipGlow,
    roughness: 0.4,
  });
  alidade.add(new THREE.Mesh(tipGeometry, tipMaterial));

  own({
    dispose() {
      barGeometry.dispose();
      barMaterial.dispose();
      tipGeometry.dispose();
      tipMaterial.dispose();
    },
  });

  // ----- cloud deck --------------------------------------------------------
  // The shared-world lever: the same cloud sea the Spire stands above. Inner
  // radius is set so the parapet hides its near edge - you never see where the
  // deck starts, only that it goes on. Unfogged and unlit; the engine's fog is
  // tuned for an 8m room and would flatten it to one colour.

  const cloudTexture = makeCloudTexture();
  textures.push(cloudTexture);

  const cloudGeometry = new THREE.RingGeometry(31, 59, 72, 1);
  // Opaque and FrontSide on purpose. It is what depth-rejects the half of the
  // starfield that is below the horizon: the parapet blocks everything steeper
  // than 13.6 degrees of depression and the cloud annulus covers exactly the
  // band from there up to the haze painted on the dome, so no star ever shows
  // through the floor of the sky.
  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTexture,
    fog: false,
  });
  const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
  cloud.rotation.x = -Math.PI / 2;
  cloud.position.set(0, -6, 0);
  group.add(cloud);
  own({
    dispose() {
      cloudGeometry.dispose();
      cloudMaterial.dispose();
    },
  });

  // ----- moon --------------------------------------------------------------
  // 4.5m radius at 40m = ~12.8 degrees. It reads as a world being observed. It
  // does NOT rotate with the starfield: two rooms use its bearing as shared
  // information, and information that drifts is information nobody can quote.

  const MOON_DIR = new THREE.Vector3(-0.736, 0.438, 0.516);
  const moonTexture = makeMoonTexture();
  textures.push(moonTexture);

  const moonGeometry = new THREE.SphereGeometry(4.5, 24, 16);
  const moonMaterial = new THREE.MeshBasicMaterial({ map: moonTexture, fog: false });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.copy(MOON_DIR).multiplyScalar(40);
  group.add(moon);
  own({
    dispose() {
      moonGeometry.dispose();
      moonMaterial.dispose();
    },
  });

  // ----- starfield ---------------------------------------------------------
  // This room's particle system IS its backdrop; there is no dust layered on top
  // of it. Seeded, because the catalogue is read off this sky and two clients
  // that disagree about the sky have a bug that looks like a puzzle.

  const sky = new THREE.Group();
  sky.rotation.z = 0.66;   // celestial pole tilted to the site latitude
  group.add(sky);

  function buildStars(count, opacity, size) {
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    const rand = lcg(0x5747a1);

    for (let i = 0; i < count; i += 1) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      // Shell sits inside the engine's 60m far plane; anything beyond it is
      // clipped and the sky develops a hole.
      const r = 48 + rand() * 8;

      positions[i * 3] = r * s * Math.cos(phi);
      positions[i * 3 + 1] = r * u;
      positions[i * 3 + 2] = r * s * Math.sin(phi);

      // Biased dim so a handful of bright stars stand out; a uniform field reads
      // as noise and gives the eye nothing to name.
      const mag = 0.26 + rand() ** 2.4 * 0.74;
      const warm = rand();
      colours[i * 3] = mag * (0.84 + warm * 0.16);
      colours[i * 3 + 1] = mag * (0.88 + warm * 0.06);
      colours[i * 3 + 2] = mag * (1 - warm * 0.14);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));

    const material = new THREE.PointsMaterial({
      map: getMoteSprite(),
      size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  let stars = buildStars(settings.stars, settings.starOpacity, settings.starSize);
  sky.add(stars);

  // ----- the catalogue chain ------------------------------------------------
  //
  // Six abnormally bright beacons in a single rising line - a staircase. They
  // hang off `group`, NOT off `sky`, so they never drift with the star field:
  // the chain is a fixed landmark and the sky turns behind it.
  //
  // THE DEDUCTION lives here. The six are unlabelled, and the parapet frieze
  // names six stars sorted by declination (+64 at the top down to -63). Six and
  // six, both ordered, one line each - the top of the chain is plate 01. The
  // plus and minus signs are what stop a player reading the chain upside down.

  // The whole chain must fit in ONE view or the player cannot see it as a line,
  // and seeing it as a line IS the deduction. The camera's vertical FOV is 62
  // degrees, so the chain spans 40 of altitude and 30 of azimuth - comfortably
  // inside a single glance, with room to spare at the edges.
  const CHAIN_ALT = [22, 30, 38, 46, 54, 62];   // degrees, bottom rung to top
  const CHAIN_AZ_SPREAD = 6;                     // degrees between rungs
  const CHAIN_R = 44;

  const chainPositions = new Float32Array(6 * 3);
  const chainColours = new Float32Array(6 * 3);

  for (let i = 0; i < 6; i += 1) {
    // Index 0 is the FAINTEST rung at the bottom; plate 01 is the top, so the
    // catalogue index of rung i is 6 - i.
    const altRad = (CHAIN_ALT[i] * Math.PI) / 180;
    const azRad = ((chainAzimuth + i * CHAIN_AZ_SPREAD) * Math.PI) / 180;
    const horiz = Math.cos(altRad) * CHAIN_R;

    chainPositions[i * 3] = Math.sin(azRad) * horiz;
    chainPositions[i * 3 + 1] = Math.sin(altRad) * CHAIN_R;
    chainPositions[i * 3 + 2] = -Math.cos(azRad) * horiz;
  }

  const chainSizes = new Float32Array(6);

  const chainGeometry = new THREE.BufferGeometry();
  chainGeometry.setAttribute('position', new THREE.BufferAttribute(chainPositions, 3));
  chainGeometry.setAttribute('color', new THREE.BufferAttribute(chainColours, 3));
  chainGeometry.setAttribute('beaconSize', new THREE.BufferAttribute(chainSizes, 1));

  const chainMaterial = new THREE.PointsMaterial({
    map: getMoteSprite(),
    // Background stars are 0.20-0.22. These are an order of magnitude bigger so
    // the chain cannot be mistaken for part of the field.
    size: 2.4,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  chainMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute float beaconSize;\nvoid main() {')
      // Stock PointsMaterial writes `gl_PointSize = size * ...`; scale it.
      .replace('gl_PointSize = size;', 'gl_PointSize = size * beaconSize;');
  };

  chainSizes.fill(1);

  const chain = new THREE.Points(chainGeometry, chainMaterial);
  chain.frustumCulled = false;
  group.add(chain);

  // ----- meteors ------------------------------------------------------------
  //
  // Two streaks per fall, each dying ON one of the chain beacons rather than
  // passing through. One merged mesh of two camera-facing quads, moved by
  // rewriting eight vertices - no per-streak object, no per-frame allocation.

  const meteorPositions = new Float32Array(2 * 4 * 3);
  const meteorGeometry = new THREE.BufferGeometry();
  meteorGeometry.setAttribute('position', new THREE.BufferAttribute(meteorPositions, 3));
  meteorGeometry.setAttribute('uv', new THREE.BufferAttribute(
    new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]), 2,
  ));
  meteorGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

  const meteorMaterial = new THREE.MeshBasicMaterial({
    color: 0xd9d4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const meteors = new THREE.Mesh(meteorGeometry, meteorMaterial);
  meteors.frustumCulled = false;
  group.add(meteors);

  own({
    dispose() {
      chainGeometry.dispose();
      chainMaterial.dispose();
      meteorGeometry.dispose();
      meteorMaterial.dispose();
    },
  });

  /** World position of chain rung `plate` (1 = top of the chain). */
  function plateWorld(plate, out) {
    const rung = 6 - plate;   // plate 1 is the highest rung, index 5
    out.set(
      chainPositions[rung * 3],
      chainPositions[rung * 3 + 1],
      chainPositions[rung * 3 + 2],
    );
    return out;
  }

  // ----- tier --------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;

    for (const material of ringMaterials) material.emissiveIntensity = settings.ringGlow;
    tipMaterial.emissiveIntensity = settings.tipGlow;
    friezeMaterial.emissiveIntensity = settings.friezeGlow;

    bank.setScreenIntensity(settings.screenIntensity);

    // Shadows stay off on BOTH tiers. The only light is a 0.7-intensity key
    // raking in along the moon's bearing; a shadow pass would re-render every
    // caster to produce edges nobody can see, and the dome, cage, cloud and
    // starfield must never cast in any case.
    bank.setShadows(false);
    door.frame.castShadow = false;

    sky.remove(stars);
    stars.geometry.dispose();
    stars.material.dispose();
    stars = buildStars(settings.stars, settings.starOpacity, settings.starSize);
    sky.add(stars);
  }

  // ----- animation ---------------------------------------------------------

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  // ----- the fall timeline --------------------------------------------------
  //
  // Per loop: N falls, then a blackout that marks where the loop starts.
  //
  //   fall k:  streaks fly in (1.1s), then the two struck beacons HOLD lit
  //            for 3.0s so the player reads rather than reacts
  //   blackout: the whole chain drops to 15% - three times longer than the
  //            gaps between falls and visibly darker, so it can never be
  //            mistaken for one
  //
  // Pure function of the shared run clock: the ORDER is phase-invariant, so two
  // players who mounted at different moments still log the same sequence.

  const FLIGHT = 1.1;
  const HOLD = 3.0;
  const SLOT = FLIGHT + HOLD;
  const BLACKOUT = Math.max(2.4, fallCycle - falls.length * SLOT);
  const LOOP = falls.length * SLOT + BLACKOUT;

  // Wide separation on purpose: "which two are lit" has to be answerable at a
  // glance from across the room, not by comparing similar greys.
  // Additive blending clips at 1.0, so brightness alone cannot separate lit from
  // unlit - both saturate to white. SIZE is the readable channel: a struck
  // beacon swells to 2.6x, which reads instantly from across the room and is
  // impossible to confuse with a background star.
  const BASE_MAG = 0.55;
  const LIT_MAG = 1.0;
  const DARK_MAG = 0.18;
  const BASE_SIZE = 1.0;
  const LIT_SIZE = 2.6;
  const DARK_SIZE = 0.8;

  const meteorFrom = new THREE.Vector3();
  const meteorTo = new THREE.Vector3();
  const meteorDir = new THREE.Vector3();
  const meteorSide = new THREE.Vector3();
  const meteorTmp = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Seeded entry bearing for streak `s` of fall `k`, so it never jitters. */
  function streakOrigin(k, s, out) {
    const a = ((k * 2 + s) * 2.399) % (Math.PI * 2);   // golden-angle spread
    const alt = 1.15 + ((k + s) % 3) * 0.12;
    const horiz = Math.cos(alt) * 58;
    return out.set(Math.sin(a) * horiz, Math.sin(alt) * 58, -Math.cos(a) * horiz);
  }

  function stepFalls(elapsed) {
    const t = ((elapsed % LOOP) + LOOP) % LOOP;
    const index = Math.min(falls.length - 1, Math.floor(t / SLOT));
    const inBlackout = t >= falls.length * SLOT;
    const local = t - index * SLOT;

    // Chain brightness. Every rung sits at base except the two this fall struck,
    // which hold at full while the streaks have landed.
    const holding = !inBlackout && local >= FLIGHT;
    const [plateA, plateB] = falls[index];

    for (let rung = 0; rung < 6; rung += 1) {
      const plate = 6 - rung;
      const struck = holding && (plate === plateA || plate === plateB);

      const mag = inBlackout ? DARK_MAG : (struck ? LIT_MAG : BASE_MAG);
      const size = inBlackout ? DARK_SIZE : (struck ? LIT_SIZE : BASE_SIZE);

      // Slightly blue-white so the chain reads as its own thing against the
      // warmer background field.
      chainColours[rung * 3] = mag * 0.92;
      chainColours[rung * 3 + 1] = mag * 0.95;
      chainColours[rung * 3 + 2] = mag;
      chainSizes[rung] = size;
    }
    chainGeometry.attributes.color.needsUpdate = true;
    chainGeometry.attributes.beaconSize.needsUpdate = true;

    // Streaks. Two quads stretched from an entry bearing to the beacon they
    // die on - they terminate there rather than passing through, which is what
    // makes "this fall struck those two" readable.
    if (!inBlackout && local < FLIGHT) {
      const k = local / FLIGHT;
      meteorMaterial.opacity = Math.sin(k * Math.PI) * 0.9;

      for (let sIdx = 0; sIdx < 2; sIdx += 1) {
        streakOrigin(index, sIdx, meteorFrom);
        plateWorld(sIdx === 0 ? plateA : plateB, meteorTo);

        // Head travels from entry to the beacon; tail trails behind it.
        meteorDir.copy(meteorTo).sub(meteorFrom);
        const head = meteorTmp.copy(meteorFrom).addScaledVector(meteorDir, k);
        const tailK = Math.max(0, k - 0.16);
        const tail = meteorFrom.clone().addScaledVector(meteorDir, tailK);

        meteorSide.copy(meteorDir).normalize().cross(UP).normalize().multiplyScalar(0.18);

        const base = sIdx * 4 * 3;
        const write = (slot, v, sign) => {
          meteorPositions[base + slot * 3] = v.x + meteorSide.x * sign;
          meteorPositions[base + slot * 3 + 1] = v.y + meteorSide.y * sign;
          meteorPositions[base + slot * 3 + 2] = v.z + meteorSide.z * sign;
        };
        write(0, tail, -1);
        write(1, tail, 1);
        write(2, head, 1);
        write(3, head, -1);
      }
      meteorGeometry.attributes.position.needsUpdate = true;
    } else if (meteorMaterial.opacity !== 0) {
      meteorMaterial.opacity = 0;
    }
  }

  function update(elapsed, dt, flags = {}) {
    for (const ring of ringSpinners) ring.node.rotation.y += dt * ring.rate;

    // Slow enough that a player notices it has moved rather than watching it
    // move. An armillary that spins is a toy.
    alidade.rotation.y += dt * 0.028;

    // Rigid body, about the tilted pole. Zero per-point CPU cost at 2600 stars.
    sky.rotation.y += dt * 0.006;

    stepFalls(elapsed);

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
    stars.geometry.dispose();
    stars.material.dispose();   // never getMoteSprite() itself - it is shared
    for (const part of parts) part.dispose?.();
    for (const texture of textures) disposeTexture(texture);
  }

  return {
    id: 'observatory',
    group,
    panels: bank.panels,
    dimensions: room,
    // The armillary's innermost ring sweeps at radius 2.55, centred on spawn.
    // Walking through a rotating brass ring would break the room harder than
    // any wall clip, so the player is confined to the pier - standing INSIDE
    // the instrument is the room's whole conceit anyway. Every readable surface
    // was placed for a fixed centre camera, so nothing becomes unreachable.
    // The pier is PIER_R = 1.6 and the player is a 0.32 circle, so 1.25 is the
    // largest radius that keeps them ON it. The previous 2.2 let them walk clean
    // off the rim and stand in mid-air over the sunken deck 2.2m below - the
    // room reads as a raised pier, so the confinement has to match the masonry
    // rather than the armillary it was originally measured against.
    keepInsideRadius: 1.25,
    // No lamps. White light destroys an observer's dark adaptation, which is an
    // operational rule here, not a look. Ambient is dropped to a cold sky wash
    // and the key is kept only at 0.7, re-aimed along the moon's bearing so the
    // one directional source in the room is the thing you can actually see in
    // the sky. Killing it outright was tried in principle and rejected: it
    // flattens the graduated rings into unreadable silhouettes, and a value a
    // player cannot read is a correctness bug, not a mood.
    environment: {
      ambientColour: 0x2e3560,
      ambientIntensity: 1.25,
      keyColour: 0xa79bff,
      keyIntensity: 0.7,
      keyPosition: [MOON_DIR.x * 14, MOON_DIR.y * 14, MOON_DIR.z * 14],
      keyTarget: [0, 0.3, -2],
      fogColour: 0x080a16,
      fogNear: 7,
      fogFar: 34,
      clearColour: 0x04050d,
    },
    update,
    applyTier,
    dispose,
  };
}
