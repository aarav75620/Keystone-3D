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
// A FULL CHAMBER. It carries all three panels and its own puzzle - THE SETTLING.
// The arch has no crown stone, so it is not resting: the voussoirs take the
// thrust one at a time and the order is the observable. A wall register lists
// seven mason's marks; the arch holds six, and the seventh is the stone that was
// never placed. The neighbour names one mark and you report the two that carry
// it, because what holds a stone up is the stones on either side of it.

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


/**
 * The seven mason's marks. Cut shapes, not letters - a quarry marked stone with
 * a chisel and a straight edge, and it keeps the Vestibule's vocabulary
 * distinct from the Vault's engraved glyphs.
 */
function drawMark(ctx, kind, r) {
  ctx.beginPath();
  switch (kind) {
    case 'tally':
      for (const dx of [-r * 0.6, -r * 0.2, r * 0.2]) {
        ctx.moveTo(dx, -r); ctx.lineTo(dx, r);
      }
      ctx.moveTo(-r * 0.8, r * 0.6); ctx.lineTo(r * 0.5, -r * 0.6);
      ctx.stroke();
      break;
    case 'wedge':
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, r); ctx.lineTo(-r * 0.7, r);
      ctx.closePath(); ctx.stroke();
      break;
    case 'fork':
      ctx.moveTo(0, r); ctx.lineTo(0, -r * 0.1);
      ctx.moveTo(0, -r * 0.1); ctx.lineTo(-r * 0.7, -r);
      ctx.moveTo(0, -r * 0.1); ctx.lineTo(r * 0.7, -r);
      ctx.stroke();
      break;
    case 'crook':
      ctx.moveTo(-r * 0.4, r);
      ctx.lineTo(-r * 0.4, -r * 0.4);
      ctx.quadraticCurveTo(-r * 0.4, -r, r * 0.4, -r * 0.7);
      ctx.stroke();
      break;
    case 'ladder':
      ctx.moveTo(-r * 0.55, -r); ctx.lineTo(-r * 0.55, r);
      ctx.moveTo(r * 0.55, -r); ctx.lineTo(r * 0.55, r);
      for (const y of [-r * 0.5, 0, r * 0.5]) {
        ctx.moveTo(-r * 0.55, y); ctx.lineTo(r * 0.55, y);
      }
      ctx.stroke();
      break;
    case 'comb':
      ctx.moveTo(-r * 0.8, -r * 0.5); ctx.lineTo(r * 0.8, -r * 0.5);
      for (const dx of [-r * 0.5, 0, r * 0.5]) {
        ctx.moveTo(dx, -r * 0.5); ctx.lineTo(dx, r * 0.7);
      }
      ctx.stroke();
      break;
    default: // 'hook'
      ctx.moveTo(r * 0.4, -r);
      ctx.lineTo(r * 0.4, r * 0.3);
      ctx.quadraticCurveTo(r * 0.4, r, -r * 0.4, r * 0.6);
      ctx.stroke();
      break;
  }
}

/**
 * The mason's register, cut into the north wall: all SEVEN marks the quarry
 * made for this arch, each with its stone number.
 *
 * Seven, not six. The arch holds six of them, and working out which one never
 * got placed is half of what the room asks - the crown stone is identified by
 * its absence, which is the only way anything is identified in here.
 */
function makeRegisterTexture(register) {
  const width = 1024;
  const height = 320;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = '600 30px "Chakra Petch", "IBM Plex Mono", monospace';
  drawTrackedText(ctx, "MASON'S REGISTER", width / 2, 36, 8);
  ctx.fillStyle = 'rgba(226,224,206,0.4)';
  drawTrackedText(ctx, "MASON'S REGISTER", width / 2, 34, 8);

  const cell = width / register.length;
  register.forEach((entry, i) => {
    const cx = i * cell + cell / 2;

    // Carved: a dark cut with a pale lip below it.
    ctx.save();
    ctx.translate(cx, 150);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    drawMark(ctx, entry.mark, 40);
    ctx.translate(0, -2);
    ctx.strokeStyle = 'rgba(226,224,206,0.42)';
    drawMark(ctx, entry.mark, 40);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.font = '700 46px "IBM Plex Mono", ui-monospace, monospace';
    drawTrackedText(ctx, entry.number, cx, 244, 4);
    ctx.fillStyle = BONE_CSS;
    drawTrackedText(ctx, entry.number, cx, 242, 4);
  });

  return { texture: toTexture(canvas), width, height };
}

/** One voussoir's face: its mark, cut large enough to read across the room. */
function makeVoussoirAtlas(marks) {
  const cell = 128;
  const width = cell * marks.length;
  const canvas = newCanvas(width, cell);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, cell);

  const cells = marks.map((mark, i) => {
    ctx.save();
    ctx.translate(i * cell + cell / 2, cell / 2);
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    drawMark(ctx, mark, 40);
    ctx.translate(0, -2.5);
    ctx.strokeStyle = 'rgba(232,230,212,0.85)';
    drawMark(ctx, mark, 40);
    ctx.restore();
    return [i * cell, 0, cell, cell];
  });

  return { texture: toTexture(canvas), cells, width, height: cell };
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

export function createVestibule({ dimensions, puzzle } = {}) {
  void dimensions;

  // The arrangement the server generated: which mark is cut on each voussoir,
  // which mark was never placed, and the order the stones take the thrust.
  const cfg = puzzle?.config || null;
  const register = cfg?.register || [
    { mark: 'tally', number: '34' }, { mark: 'wedge', number: '52' },
    { mark: 'fork', number: '76' }, { mark: 'crook', number: '23' },
    { mark: 'ladder', number: '68' }, { mark: 'comb', number: '95' },
    { mark: 'hook', number: '47' },
  ];
  const absentMark = cfg?.absent || 'fork';
  const settling = cfg?.settling
    || register.filter((r) => r.mark !== absentMark).map((r) => r.mark);
  const beatSeconds = cfg?.beatSeconds || 2.6;

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

  // SIX separate voussoirs, not one merged mesh.
  //
  // Each stone has to show when it is carrying the thrust, which is the entire
  // puzzle, and one shared material cannot say different things about six
  // stones. Fifth time in this project that merging had to be undone the moment
  // an object needed to carry state - by now the rule is: if it will ever speak
  // individually, do not merge it.
  const archMaterials = voussoirParts.map(() => new THREE.MeshStandardMaterial({
    color: 0x6f7263,
    emissive: 0xffb27a,
    emissiveIntensity: 0,
    roughness: 0.95,
    metalness: 0.02,
  }));
  const stones = voussoirParts.map((g, i) => {
    const mesh = new THREE.Mesh(g, archMaterials[i]);
    archGroup.add(mesh);
    return mesh;
  });
  void stones;

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
      for (const g of voussoirParts) g.dispose();
      for (const m of archMaterials) m.dispose();
      plinthGeometry.dispose();
      plinthMaterial.dispose();
      ghostGeometry.dispose();
      ghostMaterial.dispose();
    },
  });

  // ----- the marks and the register ----------------------------------------
  // Each standing stone carries its mason's mark on the face toward the room.
  // The settling order is an order of MARKS, so the mark has to be readable
  // from where the player stands or the sequence is unreadable.

  const archMarks = settling.slice();
  const voussoirAtlas = makeVoussoirAtlas(archMarks);
  textures.push(voussoirAtlas.texture);

  const markQuads = [];
  for (let i = 0; i < VOUSSOIRS; i += 1) {
    const before = i < VOUSSOIRS / 2;
    const t = before
      ? i * step
      : gapStart + CROWN_GAP + (i - VOUSSOIRS / 2) * step;
    const mid = t + step / 2;
    const rMid = (ARCH_R_INNER + ARCH_R_OUTER) / 2;
    markQuads.push({
      width: 0.42,
      height: 0.42,
      // Sat just proud of the stone's front face, on the same radius.
      position: [Math.cos(mid) * rMid, Math.sin(mid) * rMid + 0.05, ARCH_DEPTH / 2 + 0.012],
      rotation: [0, 0, 0],
      cell: voussoirAtlas.cells[i],
    });
  }

  const markGeometry = makeAtlasQuads(markQuads, {
    atlasWidth: voussoirAtlas.width,
    atlasHeight: voussoirAtlas.height,
  });
  // The marks are cut, not lit - but they are also the puzzle, so they carry a
  // little emissive of their own. A carving that depends entirely on a light
  // across the room is unreadable the moment anyone stands between them.
  const markMaterial = new THREE.MeshStandardMaterial({
    map: voussoirAtlas.texture,
    emissive: 0xffffff,
    emissiveMap: voussoirAtlas.texture,
    emissiveIntensity: 0.42,
    transparent: true,
    roughness: 1,
    metalness: 0,
  });
  group.add(new THREE.Mesh(markGeometry, markMaterial));

  // The register: all SEVEN marks with their stone numbers, cut into the east
  // wall. Six of them stand in the arch; the seventh never got placed.
  const registerTex = makeRegisterTexture(register);
  textures.push(registerTex.texture);

  const registerGeometry = makeAtlasQuads([{
    width: 4.6,
    height: 1.44,
    position: [halfW - 0.03, 2.0, 0],
    rotation: [0, -Math.PI / 2, 0],
    cell: [0, 0, registerTex.width, registerTex.height],
  }], { atlasWidth: registerTex.width, atlasHeight: registerTex.height });

  // Same for the register, and more so: it hangs on the far wall, furthest from
  // the only light in the room, and it holds the numbers the answer is made of.
  const registerMaterial = new THREE.MeshStandardMaterial({
    map: registerTex.texture,
    emissive: 0xffffff,
    emissiveMap: registerTex.texture,
    emissiveIntensity: 0.5,
    transparent: true,
    roughness: 1,
    metalness: 0,
  });
  group.add(new THREE.Mesh(registerGeometry, registerMaterial));

  own({
    dispose() {
      markGeometry.dispose();
      markMaterial.dispose();
      registerGeometry.dispose();
      registerMaterial.dispose();
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
  const bank = own(makePanelBank({
    wallZ: -halfD,
    eyeHeight: room.eyeHeight,
    spacing: 2.35,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // THREE panels. The Vestibule was first built as a lobby with no Answer Lock,
  // but it is a chamber in the ring now - somebody stands here, solves the
  // settling, and submits like everyone else.
  const panels = bank.panels;

  // ----- the crew light -----------------------------------------------------
  // The whole thesis in one float. Intensity and hue are `filled / CREW_MAX`:
  // an empty vestibule is nearly dark and grey, a full one is warm and bright.
  // Nothing else in this room emits at all.

  // Decay 1.2, not 2. Physically correct inverse-square falloff from a single
  // point 3.1m up left the walls - and the register on the east wall - almost
  // unlit, and this room has no other source. Range covers the 11.9m diagonal.
  const crewLight = new THREE.PointLight(BONE, 10, 26, 1.2);
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
    // Never fully dark: a player standing alone still has to READ the room, not
    // merely see the arch. The floor is what a lone player gets, and it has to
    // be enough to work the settling out on their own.
    crewLight.intensity = 10 + settings.crewLightMax * share;
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

    // THE SETTLING. An arch with no crown stone is not resting, it is working:
    // the thrust passes from stone to stone, one at a time, round and round.
    // The order is the server's, and it is the whole observable.
    //
    // Driven off the shared run clock, so two players standing here watch the
    // same stone take the load at the same moment.
    const loop = beatSeconds * VOUSSOIRS;
    const at = ((elapsed % loop) + loop) % loop;
    const index = Math.floor(at / beatSeconds);
    const withinBeat = (at - index * beatSeconds) / beatSeconds;

    // The mark whose turn it is. `settling` is an order of MARKS, and the
    // stones were built carrying those marks in the same order, so the beat
    // index addresses the stone directly.
    for (let i = 0; i < archMaterials.length; i += 1) {
      // Load comes on fast and eases off - a stone takes weight suddenly and
      // sheds it slowly, and a symmetric pulse reads as a blinking light
      // rather than as something bearing down.
      let load = 0;
      if (i === index) {
        load = withinBeat < 0.18
          ? withinBeat / 0.18
          : Math.max(0, 1 - (withinBeat - 0.18) / 0.62);
      }
      archMaterials[i].emissiveIntensity = load * 1.35;
    }

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
      // The crew light is still the thing that CHANGES, but it can no longer be
      // the only thing that lights the room.
      //
      // This shipped at ambient 0.75 with no key, which was defensible while
      // the Vestibule was a lobby with nothing to read. It is a chamber now: the
      // mason's marks and the seven-mark register are the puzzle, and a puzzle
      // you cannot see is not a puzzle. Fourth room in this project to ship too
      // dark, and the standing rule is right there in PROGRESS.md - ambient is
      // the cheap lever, and no room opens at its darkest state.
      //
      // The crew effect survives: empty is still noticeably colder and dimmer
      // than full. It just no longer bottoms out below legibility.
      ambientColour: 0x4a4c40,
      ambientIntensity: 1.55,
      keyEnabled: true,
      keyIntensity: 0.55,
      keyColour: 0xbfc4ad,
      fogColour: 0x14150f,
      // Was 9. The room is 7.6m across and 5.2m tall, so fog starting at 9m put
      // haze on the far wall - which is exactly where the register hangs.
      fogNear: 16,
      fogFar: 40,
      cameraFar: 60,
    },
  };
}
