// rooms/engine-room.js - Coolant Loop B.
//
// 7.2 x 7.2 x 2.9m - smaller and lower than standard, so this file builds
// against its own numbers and returns them. Cramped is the point.
//
// The room is lit from BELOW. The overheads are dead; the coolant loop still
// glows lime under the deck grating, and a six-spoke flywheel turning under
// the floor physically chops that glow as it passes - real occlusion, no
// shader - so the whole room strobes at walking-pace rhythm. The engine's
// overhead key light is disabled outright: a top-down key would contradict
// the room's entire concept in the first frame.
//
// This is the only room in the game where you can see below the floor, and it
// keeps that exclusive: nothing else gets a transparent surface.
//
// No particles. Aarav cut floating motes from all rooms (they also clipped
// through walls); the Engine Room never needed them - its atmosphere is the
// strobing floor.

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
  makePanelBank,
  makeSealedDoor,
  makeAtlasQuads,
  makeCeilingStrips,
  mergeGeometries,
} from '../roomkit/geometry.js';

const ROOM = { width: 7.2, depth: 7.2, height: 2.9, eyeHeight: 1.62 };

const LIME = 0xb7f03a;
const LIME_CSS = '#b7f03a';
const POINTER_VIOLET_CSS = '#8f7bff';
const STEEL_CSS = '#2e3438';

// Undercroft: the visible pit below the grating.
const PIT_DEPTH = 0.8;
const FLYWHEEL_RADIUS = 1.25;
const SPOKES = 6; // six, not four - six is the game's number

const TIERS = {
  low: {
    glowIntensity: 30,
    screenIntensity: 0.85,
    stencilEmissive: 0.5,
    accentStrength: 0.6,
    secondGlow: false,
  },
  high: {
    glowIntensity: 38,
    screenIntensity: 1.1,
    stencilEmissive: 0.75,
    accentStrength: 1,
    secondGlow: true,
  },
};

/** Bulkhead plate: heavy courses, rivet lines, industrial grime. */
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
        depth: 3, alpha: 0.16, lightFromBelow: true,
      });
    }
  }

  rivetPass(ctx, { width: size, height: size, spacing: course / 2, radius: 4, inset: 12, alpha: 0.3 });
  streakPass(ctx, { width: size, height: size, count: 14, seed: 83, alpha: 0.09 });
  grainPass(ctx, { width: size, height: size, count: 2200, seed: 19, alpha: 0.05 });

  return toTexture(canvas, { repeat: [2, 1] });
}

/**
 * The deck grating. Transparent holes punched by leaving the canvas alpha
 * empty; alphaTest discards them at draw time. FrontSide ONLY - this is the
 * most-covered surface in the room (the player looks down constantly, that is
 * the concept) and DoubleSide would double its fragment cost for faces nobody
 * can ever see from above.
 */
function makeGratingTexture() {
  const size = 256;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Canvas starts fully transparent: draw only the bars.
  const bar = 10;
  const cell = 32;
  ctx.fillStyle = '#1c2124';
  for (let x = 0; x < size; x += cell) ctx.fillRect(x, 0, bar, size);
  for (let y = 0; y < size; y += cell) ctx.fillRect(0, y, size, bar);

  // A worn top edge on each bar so the grid reads as metal, not lines.
  ctx.fillStyle = 'rgba(183,240,58,0.12)';
  for (let x = 0; x < size; x += cell) ctx.fillRect(x, 0, 2, size);
  for (let y = 0; y < size; y += cell) ctx.fillRect(0, y, size, 2);

  return toTexture(canvas, { repeat: 10 });
}

/** The coolant bed: what actually glows up through the grating. */
function makeGlowBedTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 30, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, '#d8ff6e');
  gradient.addColorStop(0.45, '#9fd42e');
  gradient.addColorStop(1, '#3d5410');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Dark channel plates breaking the pool into a machine, not a puddle.
  ctx.fillStyle = 'rgba(10,14,6,0.55)';
  const rand = lcg(6673);
  for (let i = 0; i < 7; i += 1) {
    const w = 20 + rand() * 40;
    ctx.fillRect(rand() * size, 0, w, size);
  }

  grainPass(ctx, { width: size, height: size, count: 1200, seed: 29, alpha: 0.08 });

  return toTexture(canvas);
}

/**
 * Everything stencilled on the walls, in one atlas -> one draw call.
 * The valve numbers and the cipher prefix are pointer-violet: they are the
 * Engine Room's PAYLOAD, read aloud to other rooms, never used here.
 */
function makeStencilAtlas() {
  const width = 1024;
  const height = 512;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  const cells = {};

  // Cell A: loop title + chevrons (lime - this room's own furniture).
  ctx.fillStyle = LIME_CSS;
  ctx.font = '600 44px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'COOLANT LOOP B', 300, 50, 8);
  ctx.font = '600 36px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, '>>>>>', 300, 110, 14);
  cells.title = [0, 0, 600, 150];

  // Cell B: the valve schedule. Violet - belongs to the Archive.
  ctx.fillStyle = POINTER_VIOLET_CSS;
  ctx.font = '600 40px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'V-214  V-083  V-442', 340, 200, 6);
  ctx.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(143,123,255,0.55)';
  drawTrackedText(ctx, 'VALVE SCHEDULE - REPORT ON REQUEST', 340, 245, 4);
  cells.valves = [0, 160, 680, 110];

  // Cell C: the cipher prefix. Violet - the Archive's missing fragment half.
  ctx.fillStyle = POINTER_VIOLET_CSS;
  ctx.font = '600 48px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'PREFIX  KC-', 260, 330, 8);
  cells.prefix = [0, 280, 520, 100];

  // Cell D: loop letters, lime, this room's own plumbing labels.
  ctx.fillStyle = LIME_CSS;
  ctx.font = '600 34px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, 'B · D · G', 160, 430, 6);
  cells.loops = [0, 390, 320, 80];

  return { texture: toTexture(canvas), cells, width, height };
}

/**
 * Six station plates for the coolant channel. Big lime digits on dark plate -
 * these are what the player actually collects, so they are sized to be read
 * from across the room rather than leaned into.
 */
function makeStationAtlas(digits) {
  const cell = 128;
  const width = cell * 6;
  const height = cell;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const cells = [];

  ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i += 1) {
    const x0 = i * cell;

    ctx.fillStyle = '#12160d';
    ctx.fillRect(x0 + 6, 6, cell - 12, cell - 12);
    ctx.strokeStyle = LIME_CSS;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 6, 6, cell - 12, cell - 12);
    ctx.globalAlpha = 1;

    // The digit.
    ctx.fillStyle = LIME_CSS;
    ctx.font = '700 62px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, String(digits[i] ?? '-'), x0 + cell / 2, cell / 2 - 6, 2);

    // Station index beneath it, small. The player needs to say "station four"
    // out loud to a neighbour who cannot see this wall.
    ctx.fillStyle = 'rgba(183,240,58,0.5)';
    ctx.font = '500 20px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, `ST ${i + 1}`, x0 + cell / 2, cell - 26, 3);

    cells.push([x0, 0, cell, cell]);
  }

  return { texture: toTexture(canvas), cells, width, height };
}

/**
 * Four gauge faces. Labelled with two-glyph SYMBOLS only - deliberately no
 * names or units. The mapping from symbol to meaning is the gauge identity
 * key, and it lives in the Archive. That asymmetry IS the puzzle dependency.
 */
function makeGaugeAtlas(SYMBOLS) {
  const width = 512;
  const height = 128;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const cells = [];

  for (let i = 0; i < 4; i += 1) {
    const cx = i * 128 + 64;
    const cy = 56;

    ctx.fillStyle = '#11150f';
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = LIME_CSS;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Tick arc, upper 270 degrees.
    ctx.strokeStyle = 'rgba(183,240,58,0.7)';
    ctx.lineWidth = 2;
    for (let t = 0; t <= 12; t += 1) {
      const a = Math.PI * 0.75 + (t / 12) * Math.PI * 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
      ctx.lineTo(cx + Math.cos(a) * (t % 3 === 0 ? 34 : 39), cy + Math.sin(a) * (t % 3 === 0 ? 34 : 39));
      ctx.stroke();
    }

    ctx.fillStyle = LIME_CSS;
    ctx.font = '600 20px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    drawTrackedText(ctx, SYMBOLS[i], cx, cy + 30, 2);

    cells.push([i * 128, 0, 128, 128]);
  }

  return { texture: toTexture(canvas), cells, width, height };
}

export function createEngineRoom({ dimensions, puzzle } = {}) {
  // Engine passes its default; this room is smaller and uses its own numbers.
  void dimensions;

  // The arrangement the server generated: which digit sits at each station,
  // which station each gauge is plumbed to, and how long a lap takes. Falls
  // back so the room still renders in isolation (preview, or a client whose
  // puzzle has not arrived yet).
  const cfg = puzzle?.config || null;
  const stationDigits = cfg?.stationDigits || ['5', '3', '7', '9', '6', '2'];
  const gaugeStations = cfg?.gaugeStations || [0, 5, 2, 4];
  const gaugeSymbols = cfg?.symbols || ['◇▲', '○▮', '△△', '▮◇'];
  const period = cfg?.period || 20;

  const room = ROOM;
  const group = new THREE.Group();

  const parts = [];
  const textures = [];
  const own = (part) => { parts.push(part); return part; };

  let settings = TIERS.low;

  // ----- shell (manual - the floor is custom, so makeStandardShell's
  // one-piece floor would z-fight the grating) ------------------------------

  const wallTexture = makeWallTexture();
  textures.push(wallTexture);

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: wallTexture,
    roughness: 0.78,
    metalness: 0.35,
  });
  const northMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9c6d8,
    map: wallTexture,
    roughness: 0.74,
    metalness: 0.4,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0x232a2e,
    roughness: 0.9,
    metalness: 0.2,
  });

  const sideGeometry = new THREE.PlaneGeometry(room.width, room.height);
  const capGeometry = new THREE.PlaneGeometry(room.width, room.depth);

  const walls = [
    { material: northMaterial, pos: [0, room.height / 2, -room.depth / 2], rotY: 0 },
    { material: wallMaterial, pos: [0, room.height / 2, room.depth / 2], rotY: Math.PI },
    { material: wallMaterial, pos: [-room.width / 2, room.height / 2, 0], rotY: Math.PI / 2 },
    { material: wallMaterial, pos: [room.width / 2, room.height / 2, 0], rotY: -Math.PI / 2 },
  ];
  for (const spec of walls) {
    const mesh = new THREE.Mesh(sideGeometry, spec.material);
    mesh.position.set(...spec.pos);
    mesh.rotation.y = spec.rotY;
    group.add(mesh);
  }

  const ceiling = new THREE.Mesh(capGeometry, ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = room.height;
  group.add(ceiling);

  own({
    dispose() {
      sideGeometry.dispose();
      capGeometry.dispose();
      wallMaterial.dispose();
      northMaterial.dispose();
      ceilingMaterial.dispose();
    },
  });

  // Dead overhead strips: visibly present, visibly OFF. The room narrates its
  // own power state - the fixtures every other chamber has are dark here.
  const deadStrips = own(makeCeilingStrips({
    width: room.width,
    depth: room.depth,
    y: room.height - 0.3,
    colour: 0x0e1410,
    bodyColour: 0x1b2226,
    intensity: 0.06,
  }));
  group.add(deadStrips.mesh);

  // ----- undercroft ---------------------------------------------------------

  const glowBedTexture = makeGlowBedTexture();
  textures.push(glowBedTexture);

  // MeshBasic on purpose: the bed IS a light source, it should not be shaded
  // by anything, and unlit material is the cheapest thing that can glow.
  const glowBedMaterial = new THREE.MeshBasicMaterial({ map: glowBedTexture });
  const glowBedGeometry = new THREE.PlaneGeometry(room.width, room.depth);
  const glowBed = new THREE.Mesh(glowBedGeometry, glowBedMaterial);
  glowBed.rotation.x = -Math.PI / 2;
  glowBed.position.y = -PIT_DEPTH;
  group.add(glowBed);

  // Skirt: inward faces of the pit, so looking down at a wall edge shows steel
  // going down into the glow rather than the void outside the room.
  const skirtGeometry = new THREE.BoxGeometry(room.width, PIT_DEPTH, room.depth);
  const skirtMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a3034,
    roughness: 0.85,
    metalness: 0.3,
    side: THREE.BackSide,
  });
  const skirt = new THREE.Mesh(skirtGeometry, skirtMaterial);
  skirt.position.y = -PIT_DEPTH / 2;
  group.add(skirt);

  own({
    dispose() {
      glowBedGeometry.dispose();
      glowBedMaterial.dispose();
      skirtGeometry.dispose();
      skirtMaterial.dispose();
    },
  });

  // ----- flywheel -----------------------------------------------------------
  // Rim + six spokes + hub merged into one mesh. Dark on purpose: it works by
  // OCCLUDING the glow bed, and the occlusion is the room's strobe.

  const flywheelParts = [];
  const rimGeometry = new THREE.TorusGeometry(FLYWHEEL_RADIUS, 0.07, 8, 40);
  rimGeometry.rotateX(Math.PI / 2);
  flywheelParts.push(rimGeometry);

  const spokeGeometry = new THREE.BoxGeometry(FLYWHEEL_RADIUS - 0.1, 0.05, 0.16);
  const spokeMatrix = new THREE.Matrix4();
  for (let i = 0; i < SPOKES; i += 1) {
    const spoke = spokeGeometry.clone();
    const angle = (i / SPOKES) * Math.PI * 2;
    spokeMatrix.makeRotationY(angle);
    spokeMatrix.setPosition(
      Math.cos(angle) * (FLYWHEEL_RADIUS / 2),
      0,
      -Math.sin(angle) * (FLYWHEEL_RADIUS / 2),
    );
    spoke.applyMatrix4(spokeMatrix);
    flywheelParts.push(spoke);
  }

  const hubGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.22, 10);
  flywheelParts.push(hubGeometry);

  const flywheelGeometry = mergeGeometries(flywheelParts);
  for (const p of flywheelParts) p.dispose();
  spokeGeometry.dispose();

  const flywheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1f22,
    roughness: 0.6,
    metalness: 0.7,
  });

  const flywheel = new THREE.Mesh(flywheelGeometry, flywheelMaterial);
  flywheel.position.y = -0.42;
  group.add(flywheel);

  own({
    dispose() {
      flywheelGeometry.dispose();
      flywheelMaterial.dispose();
    },
  });

  // ----- grating ------------------------------------------------------------

  const gratingTexture = makeGratingTexture();
  textures.push(gratingTexture);

  const gratingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: gratingTexture,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    roughness: 0.6,
    metalness: 0.55,
  });
  const gratingGeometry = new THREE.PlaneGeometry(room.width, room.depth);
  const grating = new THREE.Mesh(gratingGeometry, gratingMaterial);
  grating.rotation.x = -Math.PI / 2;
  grating.position.y = 0.001;
  group.add(grating);

  own({
    dispose() {
      gratingGeometry.dispose();
      gratingMaterial.dispose();
    },
  });

  // ----- pistons ------------------------------------------------------------
  // Six housings (static instanced) along the west wall; six rods stroking
  // with phase offsets. Six matrix writes per frame is the entire CPU cost.

  const housingGeometry = new THREE.CylinderGeometry(0.26, 0.3, 1.9, 10);
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x272d31,
    roughness: 0.55,
    metalness: 0.65,
  });
  const housings = new THREE.InstancedMesh(housingGeometry, housingMaterial, SPOKES);
  housings.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const rodGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8);
  const rodMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa4a8,
    roughness: 0.3,
    metalness: 0.9,
  });
  const rods = new THREE.InstancedMesh(rodGeometry, rodMaterial, SPOKES);

  const PISTON_X = -room.width / 2 + 0.52;
  const pistonZ = [];
  const instanceMatrix = new THREE.Matrix4();
  for (let i = 0; i < SPOKES; i += 1) {
    const z = -2.6 + i * 1.04;
    pistonZ.push(z);
    instanceMatrix.makeTranslation(PISTON_X, 0.95, z);
    housings.setMatrixAt(i, instanceMatrix);
  }
  housings.instanceMatrix.needsUpdate = true;
  group.add(housings);
  group.add(rods);

  own({
    dispose() {
      housingGeometry.dispose();
      housingMaterial.dispose();
      rodGeometry.dispose();
      rodMaterial.dispose();
    },
  });

  // ----- header pipes -------------------------------------------------------

  const pipeParts = [];
  const pipeMatrix = new THREE.Matrix4();
  for (const y of [2.3, 2.5, 2.7]) {
    const pipe = new THREE.CylinderGeometry(0.08, 0.08, room.depth - 0.4, 8);
    pipeMatrix.makeRotationX(Math.PI / 2);
    pipeMatrix.setPosition(-room.width / 2 + 0.3, y, 0);
    pipe.applyMatrix4(pipeMatrix);
    pipeParts.push(pipe);
  }
  const pipeGeometry = mergeGeometries(pipeParts);
  for (const p of pipeParts) p.dispose();

  const pipeMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a4145,
    roughness: 0.5,
    metalness: 0.7,
  });
  group.add(new THREE.Mesh(pipeGeometry, pipeMaterial));

  own({
    dispose() {
      pipeGeometry.dispose();
      pipeMaterial.dispose();
    },
  });

  // ----- stencils -----------------------------------------------------------

  const stencils = makeStencilAtlas();
  textures.push(stencils.texture);

  const stencilGeometry = makeAtlasQuads([
    // Title over the pistons, west wall.
    { width: 2.4, height: 0.6, position: [-room.width / 2 + 0.06, 2.05, 0], rotation: [0, Math.PI / 2, 0], cell: stencils.cells.title },
    // Valve schedule between the pistons, low, where the crew must crouch a
    // look. Violet: the Archive's data, printed in the Engine Room.
    { width: 2.2, height: 0.36, position: [-room.width / 2 + 0.06, 1.28, 1.2], rotation: [0, Math.PI / 2, 0], cell: stencils.cells.valves },
    // Cipher prefix on the east wall, over the gauges.
    { width: 1.7, height: 0.33, position: [room.width / 2 - 0.06, 2.1, -0.6], rotation: [0, -Math.PI / 2, 0], cell: stencils.cells.prefix },
    // Loop letters by the door.
    { width: 1.0, height: 0.25, position: [1.9, 2.2, room.depth / 2 - 0.06], rotation: [0, Math.PI, 0], cell: stencils.cells.loops },
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

  // ----- gauges -------------------------------------------------------------

  const gauges = makeGaugeAtlas(gaugeSymbols);
  textures.push(gauges.texture);

  const gaugeGeometry = makeAtlasQuads(
    gauges.cells.map((cell, i) => ({
      width: 0.52,
      height: 0.52,
      position: [room.width / 2 - 0.06, 1.5, -1.35 + i * 0.9],
      rotation: [0, -Math.PI / 2, 0],
      cell,
    })),
    { atlasWidth: gauges.width, atlasHeight: gauges.height },
  );

  const gaugeMaterial = new THREE.MeshStandardMaterial({
    map: gauges.texture,
    emissive: 0xffffff,
    emissiveMap: gauges.texture,
    emissiveIntensity: 0.55,
    transparent: true,
    roughness: 0.85,
  });
  group.add(new THREE.Mesh(gaugeGeometry, gaugeMaterial));

  // Needles: FOUR separate meshes, not one instanced mesh.
  //
  // A needle now has to brighten on its own when its gauge vents, and one
  // shared material cannot do that. Instancing four tiny boxes saved three
  // draw calls and cost the room its only readable signal - the Vault made the
  // same trade and had to be undone. Four draws on 12-triangle geometry is
  // nothing next to the strobing floor.
  //
  // The needle points +Y at angle 0 and rotating about +Z is counter-clockwise,
  // so a direction is (-sin t, cos t): 2.36 is the lower-LEFT peg, 0 is
  // straight up.
  //
  // Rest low-left, full swinging UP and slightly right. Using the dial's whole
  // 270-degree arc would end at lower-right - correct for a real pressure gauge
  // and useless here, because rest and full would both sit in the bottom half
  // and the difference between them would read as a twitch rather than a slam.
  const NEEDLE_REST = 2.36;
  const NEEDLE_SWING = -2.96;

  const needleGeometry = new THREE.BoxGeometry(0.015, 0.19, 0.01);
  needleGeometry.translate(0, 0.075, 0);
  const needleMaterials = Array.from({ length: 4 }, () => new THREE.MeshStandardMaterial({
    color: 0x0c0e0a,
    emissive: LIME,
    emissiveIntensity: 1.6,
  }));
  const needles = Array.from({ length: 4 }, (_, i) => {
    const mesh = new THREE.Mesh(needleGeometry, needleMaterials[i]);
    mesh.position.set(room.width / 2 - 0.075, 1.5, -1.35 + i * 0.9);
    group.add(mesh);
    return mesh;
  });

  own({
    dispose() {
      gaugeGeometry.dispose();
      gaugeMaterial.dispose();
      needleGeometry.dispose();
      for (const m of needleMaterials) m.dispose();
    },
  });

  // ----- coolant channel, stations and slug ---------------------------------
  // THE PUZZLE. A slug of hot coolant runs the east channel once per lap, past
  // six numbered stations. Four gauges hang on the wall above it, and each one
  // slams to full deflection exactly when the slug reaches ITS station - which
  // is the only thing that tells you which station a gauge is plumbed to.
  //
  // Channel below, gauges above, both in one view: the player must see the
  // cause and the effect in the same glance or the pairing is unreadable.

  const CHANNEL_X = room.width / 2 - 0.22;
  const CHANNEL_Y = 0.62;
  const CHANNEL_Z0 = -2.9;
  const CHANNEL_Z1 = 2.9;
  const STATION_Z = Array.from({ length: 6 }, (_, i) => -2.6 + i * 1.04);

  const channelGeometry = new THREE.CylinderGeometry(0.075, 0.075, CHANNEL_Z1 - CHANNEL_Z0, 12, 1, true);
  channelGeometry.rotateX(Math.PI / 2);
  channelGeometry.translate(CHANNEL_X, CHANNEL_Y, (CHANNEL_Z0 + CHANNEL_Z1) / 2);
  const channelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1f16,
    roughness: 0.6,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(channelGeometry, channelMaterial));

  // Station collars on the pipe, so a station is a place on the plumbing and
  // not just a number floating on the wall.
  const collarParts = [];
  const collarProto = new THREE.TorusGeometry(0.1, 0.022, 6, 14);
  const collarMatrix = new THREE.Matrix4();
  for (const z of STATION_Z) {
    const c = collarProto.clone();
    collarMatrix.makeTranslation(CHANNEL_X, CHANNEL_Y, z);
    c.applyMatrix4(collarMatrix);
    collarParts.push(c);
  }
  collarProto.dispose();
  const collarGeometry = mergeGeometries(collarParts);
  for (const c of collarParts) c.dispose();
  const collarMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b3324, roughness: 0.5, metalness: 0.8,
  });
  group.add(new THREE.Mesh(collarGeometry, collarMaterial));

  const stations = makeStationAtlas(stationDigits);
  textures.push(stations.texture);
  const stationGeometry = makeAtlasQuads(
    stations.cells.map((cell, i) => ({
      width: 0.34,
      height: 0.34,
      position: [room.width / 2 - 0.06, CHANNEL_Y + 0.42, STATION_Z[i]],
      rotation: [0, -Math.PI / 2, 0],
      cell,
    })),
    { atlasWidth: stations.width, atlasHeight: stations.height },
  );
  const stationMaterial = new THREE.MeshStandardMaterial({
    map: stations.texture,
    emissive: 0xffffff,
    emissiveMap: stations.texture,
    emissiveIntensity: 0.7,
    transparent: true,
    roughness: 0.85,
  });
  group.add(new THREE.Mesh(stationGeometry, stationMaterial));

  // The slug itself: a hot bead in the pipe, plus a point light so it throws
  // real light onto the wall as it passes. One light, added to the room's
  // budget deliberately - it is the thing the whole room is watching.
  const slugGeometry = new THREE.SphereGeometry(0.088, 12, 8);
  const slugMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe8ff9a,
    emissiveIntensity: 3.2,
  });
  const slug = new THREE.Mesh(slugGeometry, slugMaterial);
  slug.position.set(CHANNEL_X, CHANNEL_Y, CHANNEL_Z0);
  group.add(slug);

  const slugLight = new THREE.PointLight(LIME, 9, 3.4, 2);
  slugLight.position.copy(slug.position);
  group.add(slugLight);

  own({
    dispose() {
      channelGeometry.dispose();
      channelMaterial.dispose();
      collarGeometry.dispose();
      collarMaterial.dispose();
      stationGeometry.dispose();
      stationMaterial.dispose();
      slugGeometry.dispose();
      slugMaterial.dispose();
    },
  });

  // ----- valve handwheels ---------------------------------------------------
  // Flanking the door at 1.15m. These carry the waist-height horizontal that
  // other rooms get from a trim rail - a rail here would occlude the grating,
  // and the grating is the room.

  const wheelParts = [];
  const wheelMatrix = new THREE.Matrix4();
  for (const wx of [-2.4, -1.6, 2.4]) {
    const ring = new THREE.TorusGeometry(0.17, 0.025, 6, 18);
    wheelMatrix.makeTranslation(wx, 1.15, room.depth / 2 - 0.18);
    ring.applyMatrix4(wheelMatrix);
    wheelParts.push(ring);
  }
  const wheelGeometry = mergeGeometries(wheelParts);
  for (const p of wheelParts) p.dispose();

  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b3f2a,
    roughness: 0.6,
    metalness: 0.5,
  });
  group.add(new THREE.Mesh(wheelGeometry, wheelMaterial));

  own({
    dispose() {
      wheelGeometry.dispose();
      wheelMaterial.dispose();
    },
  });

  // ----- panels + door ------------------------------------------------------

  const bank = own(makePanelBank({
    wallZ: -room.depth / 2,
    eyeHeight: room.eyeHeight,
    spacing: 1.85, // narrower wall than standard
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  const door = own(makeSealedDoor({}));
  door.group.position.set(0, 0, room.depth / 2 - 0.09);
  group.add(door.group);

  // ----- lights -------------------------------------------------------------
  // The glow under the grating is the room's key light. Its intensity is
  // driven from the flywheel angle in update(), so the light and the geometry
  // that is supposed to be causing it can never disagree.

  const limeGlow = new THREE.PointLight(LIME, TIERS.low.glowIntensity, 11, 2);
  limeGlow.position.set(0, -0.3, 0);
  group.add(limeGlow);

  const limeGlow2 = new THREE.PointLight(LIME, 0, 9, 2);
  limeGlow2.position.set(1.9, -0.3, 1.9);
  group.add(limeGlow2);

  const panelWash = new THREE.PointLight(0x5ef2d0, 4, 6, 2);
  panelWash.position.set(0, room.eyeHeight + 0.4, -room.depth / 2 + 1.2);
  group.add(panelWash);

  // ----- tier ---------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;
    stencilMaterial.emissiveIntensity = settings.stencilEmissive;
    bank.setScreenIntensity(settings.screenIntensity);
    limeGlow2.intensity = settings.secondGlow ? 14 : 0;
    panelWash.intensity = 4 * settings.accentStrength + 2;
    // No shadow toggles: the engine key light is disabled in this room, so
    // there is nothing to cast from. The flywheel's occlusion of the glow bed
    // does the job real shadows would, for free.
  }

  // ----- animation ----------------------------------------------------------

  const rodMatrixWork = new THREE.Matrix4();

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  function update(elapsed, dt, flags = {}) {
    // ~0.86 strobes per second at six spokes: mechanical, walking-pace, felt.
    flywheel.rotation.y += dt * 0.9;

    // Spokes passing a fixed bearing: 6 occlusions per revolution.
    const strobe = 0.55 + 0.45 * Math.abs(Math.sin(flywheel.rotation.y * 3));
    limeGlow.intensity = settings.glowIntensity * strobe;
    // The bed dims in sympathy so light and emissive agree about the cause.
    glowBedMaterial.color.setScalar(0.72 + 0.28 * strobe);

    for (let i = 0; i < SPOKES; i += 1) {
      const stroke = Math.sin(elapsed * 4.2 + i * 1.05) * 0.22;
      rodMatrixWork.makeTranslation(PISTON_X, 1.9 + stroke, pistonZ[i]);
      rods.setMatrixAt(i, rodMatrixWork);
    }
    rods.instanceMatrix.needsUpdate = true;

    // THE SLUG. One lap per `period`, driven off the shared run clock rather
    // than time-since-mount, so two players in this chamber watch the same slug
    // reach the same station at the same moment.
    const lap = ((elapsed % period) + period) % period;
    const travel = lap / period;
    const slugZ = CHANNEL_Z0 + travel * (CHANNEL_Z1 - CHANNEL_Z0);
    slug.position.z = slugZ;
    slugLight.position.z = slugZ;
    // Brightest mid-run, banked at the ends, so the lap has a visible start.
    const heat = 0.35 + 0.65 * Math.sin(Math.PI * travel);
    slugMaterial.emissiveIntensity = 3.2 * heat;
    slugLight.intensity = 9 * heat;

    // THE TELL. A gauge slams to full deflection only while the slug is at the
    // station it is plumbed to. Nothing else in the room says which gauge goes
    // with which station - watching the spike IS the measurement.
    for (let i = 0; i < 4; i += 1) {
      const stationZ = STATION_Z[gaugeStations[i] % STATION_Z.length];
      // Triangular response: full at the station, back to rest 0.42m either
      // side. A step function would be missed between frames; a sine would
      // never look like a needle being slammed by pressure.
      const near = Math.max(0, 1 - Math.abs(slugZ - stationZ) / 0.42);
      const deflect = near * near;
      // Rest is a slack needle low on the dial; full deflection swings it up.
      needles[i].rotation.z = NEEDLE_REST + deflect * NEEDLE_SWING
        + (1 - deflect) * Math.sin(elapsed * 1.7 + i * 2.3) * 0.03;
      needleMaterials[i].emissiveIntensity = 1.1 + deflect * 3.4;
    }

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
    id: 'engine-room',
    group,
    panels: bank.panels,
    dimensions: { ...room },
    // The piston bank is the one freestanding obstacle; wall margins cover the
    // pipes, gauges and handwheels, which all hug their walls.
    colliders: [
      { x: PISTON_X, z: 0, hw: 0.48, hd: 3.0 },
    ],
    environment: {
      // Lit from below: kill the overhead key outright. Ambient carries just
      // enough cool fill that the ceiling reads as present rather than absent.
      ambientColour: 0x39422e,
      ambientIntensity: 1.15,
      keyEnabled: false,
      fogColour: 0x0a0d07,
      fogNear: 8,
      fogFar: 22,
      clearColour: 0x070a05,
    },
    update,
    applyTier,
    dispose,
  };
}
