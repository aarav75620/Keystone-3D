// rooms/vestibule.js - the Vestibule.
//
// 7.6 x 7.6 x 5.2m. Quarried stone that predates the ship, and the only chamber
// that is not machinery. Everything else in the game is plate, grating, brass or
// glass; this is cut rock with a keystone arch standing in the middle of it.
//
// THE ABSENT KEYSTONE. Six voussoirs stand and the crown stone is missing - an
// 18-degree gap at the top of the arch, with the stone that belongs there drawn
// as a dashed wireframe ghost. It is the game's thesis as an object: the
// structure cannot close itself, and the missing piece is shaped like a person.
//
// NO LAMPS. The standard four ceiling strips every other room hangs are
// deliberately absent here - this is the one place the established shell pattern
// is broken on purpose, and the break has to be legible as a choice rather than
// an oversight. What light exists comes from the crew.
//
// THE CREW LIGHT. One PointLight whose intensity and colour are a function of
// how many people are in the run: `filled / 6`. An empty vestibule is nearly
// dark and desaturated; a full one is warm and bright. The entire design thesis
// expressed in one float, and the cheapest thing in the project.
//
// Signature hue BONE GREY #9aa38c. Deliberately the least saturated room in the
// game: absence should read as desaturation rather than as another colour, so
// that arriving crew are a real chromatic event rather than a hue change.
//
// No Answer Lock. The Vestibule is a lobby and a relay, not a puzzle chamber, so
// it carries the Fragment and Clue Board panels only.

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
  makeAtlasQuads,
  mergeGeometries,
} from '../roomkit/geometry.js';

const ROOM = { width: 7.6, depth: 7.6, height: 5.2, eyeHeight: 1.62 };

const BONE = 0x9aa38c;
const BONE_CSS = '#9aa38c';
const STONE_CSS = '#4a4a44';
const AQUA = 0x5ef2d0;

// The arch. Six voussoirs plus the gap where the seventh should be.
const ARCH_R_INNER = 1.62;
const ARCH_R_OUTER = 2.24;
const ARCH_DEPTH = 0.52;
const VOUSSOIRS = 6;
// The crown gap, centred on top dead centre. Wide enough to read as a deliberate
// absence from across the room rather than as a joint that failed to close.
const CROWN_GAP = (18 * Math.PI) / 180;

const CREW_MAX = 6;

const TIERS = {
  low: {
    screenIntensity: 0.85,
    crewLightMax: 26,
    ghostOpacity: 0.5,
    dustCount: 0,
  },
  high: {
    screenIntensity: 1.1,
    crewLightMax: 34,
    ghostOpacity: 0.7,
    dustCount: 0,
  },
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Quarried block: big irregular courses, chisel grain, no rivets anywhere. */
function makeWallTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = STONE_CSS;
  ctx.fillRect(0, 0, size, size);

  // Courses are uneven on purpose. Every other room in the game is built from
  // repeated identical plate; stone that repeats reads as wallpaper.
  const rand = lcg(4483);
  let y = 0;
  while (y < size) {
    const h = 46 + rand() * 40;
    let x = -rand() * 90;
    while (x < size) {
      const w = 70 + rand() * 110;
      const shade = 0.09 * (rand() - 0.45);
      ctx.fillStyle = shade > 0
        ? `rgba(226,224,206,${shade})`
        : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(x, y, w, h);
      bevelRect(ctx, { x, y, width: w, height: h, depth: 3, alpha: 0.2 });
      x += w;
    }
    y += h;
  }

  // Chisel grain: short strokes, not the machine streaks the ship rooms use.
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 500; i += 1) {
    const sx = rand() * size;
    const sy = rand() * size;
    const len = 3 + rand() * 9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + (rand() - 0.5) * 3);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 2600, seed: 61, alpha: 0.05 });
  streakPass(ctx, { width: size, height: size, count: 7, seed: 17, alpha: 0.05 });

  return toTexture(canvas, { repeat: [2, 1] });
}

/** Worn flag floor, swept clean in a path around where the arch stands. */
function makeFloorTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3d3d38';
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(9137);
  const cell = size / 4;
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const shade = 0.07 * (rand() - 0.4);
      ctx.fillStyle = shade > 0
        ? `rgba(220,218,200,${shade})`
        : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(c * cell, r * cell, cell, cell);
      bevelRect(ctx, { x: c * cell, y: r * cell, width: cell, height: cell, depth: 2, alpha: 0.22 });
    }
  }

  grainPass(ctx, { width: size, height: size, count: 2000, seed: 23, alpha: 0.055 });

  return toTexture(canvas, { repeat: 3 });
}

/**
 * The one carved inscription. Cut into the stone rather than printed on it, so
 * it reads as older than everything else in the game.
 *
 * It states the room's function and nothing about any other chamber - static art
 * cannot know who holds what, and pointer-violet is reserved for values the
 * server assigns per run.
 */
function makeInscriptionTexture() {
  const width = 1024;
  const height = 256;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  // Carved, not lit: a dark cut with a pale lower lip catching light from below.
  const carve = (text, y, px, track) => {
    ctx.font = `600 ${px}px "Chakra Petch", "IBM Plex Mono", monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    drawTrackedText(ctx, text, width / 2, y + 2, track);
    ctx.fillStyle = 'rgba(226,224,206,0.34)';
    drawTrackedText(ctx, text, width / 2, y, track);
  };

  carve('THE VESTIBULE', 66, 62, 14);
  carve('AN ARCH STANDS ONLY WHEN EVERY STONE IS SET', 150, 26, 6);

  return { texture: toTexture(canvas), width, height };
}

// ---------------------------------------------------------------------------
// The arch
// ---------------------------------------------------------------------------

/**
 * One voussoir: a wedge of the arch ring, extruded.
 *
 * Built from an explicit BufferGeometry rather than a lathe or extrude helper
 * because the shape is trivial (eight corners) and this keeps the vertex count
 * exact - the arch is the room's only real geometry and it should stay cheap.
 */
function voussoirGeometry(rInner, rOuter, thetaStart, thetaLength, depth) {
  const hd = depth / 2;
  const a0 = thetaStart;
  const a1 = thetaStart + thetaLength;

  const p = (r, a, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
  const inner0 = p(rInner, a0, -hd);
  const outer0 = p(rOuter, a0, -hd);
  const outer1 = p(rOuter, a1, -hd);
  const inner1 = p(rInner, a1, -hd);
  const inner0f = p(rInner, a0, hd);
  const outer0f = p(rOuter, a0, hd);
  const outer1f = p(rOuter, a1, hd);
  const inner1f = p(rInner, a1, hd);

  const verts = [];
  const quad = (a, b, c, d) => { verts.push(...a, ...b, ...c, ...a, ...c, ...d); };

  quad(inner0f, outer0f, outer1f, inner1f);   // front
  quad(inner1, outer1, outer0, inner0);       // back
  quad(outer0, outer1, outer1f, outer0f);     // outer curve
  quad(inner1, inner0, inner0f, inner1f);     // inner curve
  quad(inner0, outer0, outer0f, inner0f);     // start face
  quad(outer1, inner1, inner1f, outer1f);     // end face

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The ghost of the crown stone: the wedge that is missing, drawn as a dashed
 * wireframe so it reads as a shape that ought to be there rather than as a
 * translucent object that is there.
 */
function crownGhostGeometry(rInner, rOuter, thetaStart, thetaLength, depth) {
  const hd = depth / 2;
  const a0 = thetaStart;
  const a1 = thetaStart + thetaLength;
  const p = (r, a, z) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);

  const corners = [
    p(rInner, a0, -hd), p(rOuter, a0, -hd), p(rOuter, a1, -hd), p(rInner, a1, -hd),
    p(rInner, a0, hd), p(rOuter, a0, hd), p(rOuter, a1, hd), p(rInner, a1, hd),
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const pts = [];
  for (const [a, b] of edges) { pts.push(corners[a], corners[b]); }

  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return g;
}

// ---------------------------------------------------------------------------

export function createVestibule({ dimensions } = {}) {
  void dimensions;
  const room = ROOM;
  const group = new THREE.Group();

  const parts = [];
  const textures = [];
  const own = (part) => { parts.push(part); return part; };

  let settings = TIERS.low;

  const halfW = room.width / 2;
  const halfD = room.depth / 2;

  // ----- shell --------------------------------------------------------------

  const wallTexture = makeWallTexture();
  const floorTexture = makeFloorTexture();
  textures.push(wallTexture, floorTexture);

  const shell = own(makeStandardShell({
    width: room.width,
    depth: room.depth,
    height: room.height,
    ceiling: true,
    floorMap: floorTexture,
    wallMap: wallTexture,
    floorTint: 0xffffff,
    wallTint: 0xffffff,
    // Cool and low: the ceiling is unlit stone, not a lit surface.
    ceilingTint: 0x23241f,
    northTint: 0xa8ab9a,
    roughness: 0.94,
    metalness: 0.02,
  }));
  group.add(shell.group);

  // NO ceiling strips. Every other room hangs four; this one hangs none, and
  // that absence is the point rather than an omission.

  // ----- the arch -----------------------------------------------------------
  // Six voussoirs around a semicircle, with an 18-degree gap at the crown.

  const archGroup = new THREE.Group();
  archGroup.position.set(0, 0.05, 0);
  group.add(archGroup);

  const span = Math.PI - CROWN_GAP;          // total stone-covered sweep
  const step = span / VOUSSOIRS;
  const gapStart = Math.PI / 2 - CROWN_GAP / 2;

  const voussoirParts = [];
  for (let i = 0; i < VOUSSOIRS; i += 1) {
    // Three stones climb from the left springing to the gap, three descend from
    // the gap to the right, so the absence sits exactly at top dead centre.
    const before = i < VOUSSOIRS / 2;
    const t = before
      ? i * step
      : gapStart + CROWN_GAP + (i - VOUSSOIRS / 2) * step;
    const jointGap = 0.012;
    voussoirParts.push(voussoirGeometry(
      ARCH_R_INNER, ARCH_R_OUTER, t + jointGap, step - jointGap * 2, ARCH_DEPTH,
    ));
  }

  const archGeometry = mergeGeometries(voussoirParts);
  for (const g of voussoirParts) g.dispose();

  const archMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f7263,
    roughness: 0.95,
    metalness: 0.02,
  });
  archGroup.add(new THREE.Mesh(archGeometry, archMaterial));

  // The springing blocks the arch stands on, so it does not float.
  const plinthGeometry = new THREE.BoxGeometry(0.74, 0.34, ARCH_DEPTH + 0.16);
  const plinthMaterial = new THREE.MeshStandardMaterial({
    color: 0x5e6153, roughness: 0.95, metalness: 0.02,
  });
  for (const sx of [-1, 1]) {
    const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
    plinth.position.set(sx * (ARCH_R_INNER + (ARCH_R_OUTER - ARCH_R_INNER) / 2), -0.12, 0);
    archGroup.add(plinth);
  }

  // ----- the absent crown ---------------------------------------------------
  // A dashed wireframe of the stone that belongs in the gap. Aqua, because the
  // missing piece is the crew's - aqua is "shared" everywhere in this game.

  const ghostGeometry = crownGhostGeometry(
    ARCH_R_INNER, ARCH_R_OUTER, gapStart, CROWN_GAP, ARCH_DEPTH,
  );
  const ghostMaterial = new THREE.LineDashedMaterial({
    color: AQUA,
    dashSize: 0.09,
    gapSize: 0.07,
    transparent: true,
    opacity: settings.ghostOpacity,
  });
  const ghost = new THREE.LineSegments(ghostGeometry, ghostMaterial);
  // Dashes need per-vertex distances computed or the material draws solid.
  ghost.computeLineDistances();
  archGroup.add(ghost);

  own({
    dispose() {
      archGeometry.dispose();
      archMaterial.dispose();
      plinthGeometry.dispose();
      plinthMaterial.dispose();
      ghostGeometry.dispose();
      ghostMaterial.dispose();
    },
  });

  // ----- inscription --------------------------------------------------------

  const inscription = makeInscriptionTexture();
  textures.push(inscription.texture);

  const inscriptionGeometry = makeAtlasQuads([{
    width: 3.4,
    height: 0.85,
    position: [0, 3.5, -halfD + 0.03],
    rotation: [0, 0, 0],
    cell: [0, 0, inscription.width, inscription.height],
  }], { atlasWidth: inscription.width, atlasHeight: inscription.height });

  const inscriptionMaterial = new THREE.MeshStandardMaterial({
    map: inscription.texture,
    transparent: true,
    roughness: 1,
    metalness: 0,
  });
  group.add(new THREE.Mesh(inscriptionGeometry, inscriptionMaterial));

  own({
    dispose() {
      inscriptionGeometry.dispose();
      inscriptionMaterial.dispose();
    },
  });

  // ----- panels -------------------------------------------------------------
  // TWO panels, not three. The Vestibule has no Answer Lock: it is a lobby and
  // a relay, and there is nothing here to submit.

  const bank = own(makePanelBank({
    wallZ: -halfD,
    eyeHeight: room.eyeHeight,
    spacing: 2.35,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // Drop the lock panel from the bank rather than building a second helper.
  const lockPanel = bank.panels.find((p) => p.id === 'lock');
  if (lockPanel) {
    lockPanel.screen.parent?.removeFromParent?.();
    lockPanel.screen.visible = false;
  }
  const panels = bank.panels.filter((p) => p.id !== 'lock');

  // ----- the crew light -----------------------------------------------------
  // The whole thesis in one float. Intensity and hue are `filled / CREW_MAX`:
  // an empty vestibule is nearly dark and grey, a full one is warm and bright.
  // Nothing else in this room emits at all.

  const crewLight = new THREE.PointLight(BONE, 2, 22, 2);
  crewLight.position.set(0, 3.1, 0.4);
  group.add(crewLight);

  // A visible body for it, hanging in the arch's gap. Without one the light has
  // no cause, and every other room in the game gives its light a source.
  const emberGeometry = new THREE.SphereGeometry(0.1, 12, 10);
  const emberMaterial = new THREE.MeshBasicMaterial({ color: BONE });
  const ember = new THREE.Mesh(emberGeometry, emberMaterial);
  ember.position.copy(crewLight.position);
  group.add(ember);

  own({
    dispose() {
      emberGeometry.dispose();
      emberMaterial.dispose();
    },
  });

  /** How many of the crew have arrived, and of how many seats. */
  let filled = 0;

  const COLD = new THREE.Color(0x6d7366);   // empty: grey, barely lit
  const WARM = new THREE.Color(0xffe4b0);   // full: warm, bright

  function applyCrew() {
    const share = CREW_MAX > 0 ? Math.min(1, filled / CREW_MAX) : 0;
    // Never fully dark: a player standing alone still has to see the arch.
    crewLight.intensity = 2 + settings.crewLightMax * share;
    crewLight.color.copy(COLD).lerp(WARM, share);
    emberMaterial.color.copy(crewLight.color);
    // The ghost brightens too - the missing stone becomes more present as the
    // people who could fill it arrive.
    ghostMaterial.opacity = settings.ghostOpacity * (0.45 + 0.55 * share);
  }
  applyCrew();

  // ----- update -------------------------------------------------------------

  function update(elapsed, dt, flags = {}) {
    void dt;
    void flags;

    // The only motion in the room: the ember breathes. Slow, so the stillness
    // reads as stillness rather than as a frozen frame.
    const breath = 0.94 + 0.06 * Math.sin(elapsed * 0.9);
    ember.scale.setScalar(breath);

    for (const panel of panels) {
      const wave = Math.sin(elapsed * 0.8 + panel.id.length);
      panel.screenMaterial.emissiveIntensity =
        settings.screenIntensity * (0.9 + wave * 0.1) + panel.glowBoost;
      panel.pipMaterial.emissiveIntensity = 1.6 + Math.sin(elapsed * 2.2) * 0.7;
    }
  }

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;
    applyCrew();
  }

  function dispose() {
    for (const part of parts) part.dispose?.();
    for (const texture of textures) disposeTexture(texture);
  }

  return {
    id: 'vestibule',
    group,
    panels,
    dimensions: { ...room },
    update,
    applyTier,
    dispose,

    /**
     * How many of the crew are in the run.
     *
     * This is the room's entire behaviour. The Vestibule does not animate to a
     * clock like the puzzle chambers - it responds to people arriving, which is
     * the one thing it is about.
     */
    setCrew(count) {
      filled = Math.max(0, Math.min(CREW_MAX, Number(count) || 0));
      applyCrew();
    },

    // The arch stands in the middle of the floor and must be walked around.
    colliders: [
      { x: -(ARCH_R_INNER + 0.3), z: 0, hw: 0.42, hd: ARCH_DEPTH / 2 + 0.12 },
      { x: (ARCH_R_INNER + 0.3), z: 0, hw: 0.42, hd: ARCH_DEPTH / 2 + 0.12 },
    ],

    environment: {
      // Stone, unlit, cold. The ambient is low because the crew light is meant
      // to be the thing that changes - a generous ambient would flatten the
      // difference between an empty vestibule and a full one, which is the only
      // thing this room has to say.
      ambientColour: 0x3a3d36,
      ambientIntensity: 0.75,
      keyEnabled: false,
      fogColour: 0x14150f,
      fogNear: 9,
      fogFar: 26,
      cameraFar: 60,
    },
  };
}
