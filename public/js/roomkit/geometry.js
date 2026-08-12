// roomkit/geometry.js - shared geometry builders.
//
// Everything here exists because more than one room needs it. The rule for
// adding something: if a second room would otherwise copy-paste it, it belongs
// here, because the copy that gets left behind is the one that drifts.

import * as THREE from 'three';
import { getMoteSprite, makeScreenTexture, disposeTexture } from './canvas.js';

// ---------------------------------------------------------------------------
// Atlas quads
// ---------------------------------------------------------------------------

/**
 * Merge N independently positioned quads into ONE BufferGeometry, each quad
 * mapped to its own rectangle of a shared texture atlas.
 *
 * This is the highest-value function in the project. It is what makes 48
 * separately legible index cards, or 18 drawer labels, cost a single draw call
 * instead of 48. Without it the Archive alone would spend 100+ draws on text.
 *
 * Each quad: {
 *   width, height,            // metres
 *   position: [x, y, z],
 *   rotation: [x, y, z],      // optional euler radians, quad faces +Z at rest
 *   cell: [x, y, w, h],       // PIXELS into the atlas canvas
 * }
 *
 * @param {Array} quads
 * @param {{atlasWidth:number, atlasHeight:number}} atlas
 * @returns {THREE.BufferGeometry}
 */
export function makeAtlasQuads(quads, { atlasWidth, atlasHeight }) {
  const count = quads.length;
  const positions = new Float32Array(count * 4 * 3);
  const normals = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);

  // 4 verts per quad, so >16384 quads would overflow a Uint16 index.
  const IndexArray = count * 4 > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(count * 6);

  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < count; i += 1) {
    const q = quads[i];
    const hw = q.width / 2;
    const hh = q.height / 2;

    const [rx, ry, rz] = q.rotation || [0, 0, 0];
    euler.set(rx, ry, rz);
    matrix.makeRotationFromEuler(euler);

    const [px, py, pz] = q.position;

    // Corners counter-clockwise from bottom-left, quad facing +Z at rest.
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];

    // Canvas Y runs top-down, UV V runs bottom-up. Flipping here rather than at
    // every call site is the whole point of centralising this.
    const [cx, cy, cw, ch] = q.cell;
    const u0 = cx / atlasWidth;
    const u1 = (cx + cw) / atlasWidth;
    const v0 = 1 - (cy + ch) / atlasHeight;
    const v1 = 1 - cy / atlasHeight;

    const cornerUvs = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];

    for (let c = 0; c < 4; c += 1) {
      const vi = (i * 4 + c) * 3;
      const ui = (i * 4 + c) * 2;

      vertex.set(corners[c][0], corners[c][1], 0).applyMatrix4(matrix);
      positions[vi] = vertex.x + px;
      positions[vi + 1] = vertex.y + py;
      positions[vi + 2] = vertex.z + pz;

      normal.set(0, 0, 1).applyMatrix4(matrix).normalize();
      normals[vi] = normal.x;
      normals[vi + 1] = normal.y;
      normals[vi + 2] = normal.z;

      uvs[ui] = cornerUvs[c][0];
      uvs[ui + 1] = cornerUvs[c][1];
    }

    const base = i * 4;
    const ii = i * 6;
    indices[ii] = base;
    indices[ii + 1] = base + 1;
    indices[ii + 2] = base + 2;
    indices[ii + 3] = base;
    indices[ii + 4] = base + 2;
    indices[ii + 5] = base + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Dust
// ---------------------------------------------------------------------------

/**
 * A drifting particle cloud sized to a room.
 *
 * Every room independently rediscovered the same bug and the same fix: the
 * camera sits at room centre, so uniformly distributed motes put some of them
 * centimetres from the lens where size attenuation blows them into blobs across
 * the whole view. The exclusion sphere lives here so no room has to remember.
 *
 * Motion is deliberately NOT per-particle. Rotating the whole cloud costs three
 * float writes per frame at any count; moving 900 points individually costs 900.
 */
export function makeMotes({
  count,
  room,
  eyeHeight,
  tint = 0x5ef2d0,
  opacity = 0.5,
  size = 0.036,
  clearRadius = 1.4,
  seed = null,
}) {
  const positions = new Float32Array(count * 3);
  const rand = seed === null ? Math.random : (() => {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let y = 0;
    let z = 0;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      x = (rand() - 0.5) * room.width * 0.92;
      y = rand() * (room.height - 0.3) + 0.15;
      z = (rand() - 0.5) * room.depth * 0.92;

      const dy = y - eyeHeight;
      if (x * x + dy * dy + z * z >= clearRadius * clearRadius) break;

      if (attempt === 5) {
        x = Math.sign(x || 1) * room.width * 0.42;
        z = Math.sign(z || 1) * room.depth * 0.42;
      }
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: tint,
    map: getMoteSprite(),
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------
// Room shell
// ---------------------------------------------------------------------------

/**
 * Floor, ceiling and four walls.
 *
 * `ceiling: false` produces an open-topped room (the Observatory and Spire both
 * need this). The north wall takes its own material so it can be tinted darker
 * behind the glowing panel bank without touching the other three.
 *
 * IMPORTANT: MeshStandardMaterial MULTIPLIES color into map. When a texture
 * carries the colour, the tint must stay at or near white - setting both to the
 * same dark slate multiplies two dark values together and the room renders
 * black. That bug cost real time in phase 3; the default here is white.
 */
export function makeStandardShell({
  width,
  depth,
  height,
  ceiling = true,
  floorMap = null,
  wallMap = null,
  floorTint = 0xffffff,
  wallTint = 0xffffff,
  northTint = 0xb9c6d8,
  ceilingTint = 0x2c3a52,
  roughness = 0.82,
  metalness = 0.18,
}) {
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: floorTint,
    map: floorMap,
    roughness: roughness - 0.1,
    metalness: metalness + 0.16,
  });

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallTint,
    map: wallMap,
    roughness,
    metalness,
  });

  const northMaterial = new THREE.MeshStandardMaterial({
    color: northTint,
    map: wallMap,
    roughness: roughness - 0.05,
    metalness: metalness + 0.06,
  });

  materials.push(floorMaterial, wallMaterial, northMaterial);

  const floorGeometry = new THREE.PlaneGeometry(width, depth);
  geometries.push(floorGeometry);

  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  let ceilingMaterial = null;
  if (ceiling) {
    ceilingMaterial = new THREE.MeshStandardMaterial({
      color: ceilingTint,
      roughness: 0.9,
      metalness: 0.1,
    });
    materials.push(ceilingMaterial);

    const ceilingMesh = new THREE.Mesh(floorGeometry, ceilingMaterial);
    ceilingMesh.rotation.x = Math.PI / 2;
    ceilingMesh.position.y = height;
    group.add(ceilingMesh);
  }

  const sideGeometry = new THREE.PlaneGeometry(width, height);
  const endGeometry = new THREE.PlaneGeometry(depth, height);
  geometries.push(sideGeometry, endGeometry);

  const walls = [
    { geometry: sideGeometry, material: northMaterial, pos: [0, height / 2, -depth / 2], rotY: 0 },
    { geometry: sideGeometry, material: wallMaterial, pos: [0, height / 2, depth / 2], rotY: Math.PI },
    { geometry: endGeometry, material: wallMaterial, pos: [-width / 2, height / 2, 0], rotY: Math.PI / 2 },
    { geometry: endGeometry, material: wallMaterial, pos: [width / 2, height / 2, 0], rotY: -Math.PI / 2 },
  ];

  for (const spec of walls) {
    const mesh = new THREE.Mesh(spec.geometry, spec.material);
    mesh.position.set(...spec.pos);
    mesh.rotation.y = spec.rotY;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    floorMaterial,
    wallMaterial,
    northMaterial,
    ceilingMaterial,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Trim rail
// ---------------------------------------------------------------------------

/**
 * A waist-height rail around the room, merged into one geometry.
 *
 * Three rooms independently invented "merge four boxes". The rail is doing more
 * coherence work across the game than any colour: it is a horizontal reference
 * at a known height, which is what gives a fixed-camera room its sense of scale.
 */
export function makeTrimRail({ width, depth, y = 1.05, thickness = 0.07, inset = 0.05, colour = 0x415571 }) {
  const parts = [];

  const long = new THREE.BoxGeometry(width, thickness, thickness);
  const short = new THREE.BoxGeometry(thickness, thickness, depth);

  const placements = [
    [long, 0, -depth / 2 + inset],
    [long, 0, depth / 2 - inset],
    [short, -width / 2 + inset, 0],
    [short, width / 2 - inset, 0],
  ];

  const matrix = new THREE.Matrix4();
  for (const [geometry, x, z] of placements) {
    const cloned = geometry.clone();
    matrix.makeTranslation(x, y, z);
    cloned.applyMatrix4(matrix);
    parts.push(cloned);
  }

  long.dispose();
  short.dispose();

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  const material = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.45,
    metalness: 0.65,
  });

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;

  return {
    mesh,
    material,
    dispose() {
      merged.dispose();
      material.dispose();
    },
  };
}

/**
 * Minimal geometry merge for non-indexed/indexed position+normal+uv geometries.
 *
 * Three ships BufferGeometryUtils as an addon, but importing it means a second
 * CDN path and this game's whole premise is that the CDN may be blocked. Four
 * box merges do not justify that risk.
 */
export function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;

  for (const g of geometries) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(indexCount);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geometries) {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;

    positions.set(pos.array, vOffset * 3);
    if (nrm) normals.set(nrm.array, vOffset * 3);
    if (uv) uvs.set(uv.array, vOffset * 2);

    if (g.index) {
      for (let i = 0; i < g.index.count; i += 1) {
        indices[iOffset + i] = g.index.array[i] + vOffset;
      }
      iOffset += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i += 1) indices[iOffset + i] = vOffset + i;
      iOffset += pos.count;
    }

    vOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Panel bank
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 1.7;
const PANEL_HEIGHT = 1.15;
const HOUSING_DEPTH = 0.18;

/**
 * The three wall panels. Written ONCE, deliberately.
 *
 * Six hand-written copies guarantees one drifts, and the one that drifts breaks
 * phase 4's raycasting in exactly one room - the worst possible bug to hunt.
 *
 * Panel ORDER is a hard invariant no room may change: Fragment left, Clue Board
 * centre, Answer Lock right. Colour alone does not distinguish them for a
 * colourblind player; position does.
 */
export function makePanelBank({
  wallZ,
  eyeHeight,
  spacing = 2.05,
  accents = {
    fragment: { hex: 0xff6b9d, css: '#ff6b9d' },
    clues: { hex: 0x5ef2d0, css: '#5ef2d0' },
    lock: { hex: 0xffb35c, css: '#ffb35c' },
  },
  statuses = { fragment: 'YOURS ALONE', clues: 'SHARED', lock: 'SEALED' },
  screenIntensity = 0.85,
}) {
  const specs = [
    { id: 'fragment', title: 'FRAGMENT', offsetX: -spacing },
    { id: 'clues', title: 'CLUE BOARD', offsetX: 0 },
    { id: 'lock', title: 'ANSWER LOCK', offsetX: spacing },
  ];

  const group = new THREE.Group();

  const housingGeometry = new THREE.BoxGeometry(
    PANEL_WIDTH + 0.16,
    PANEL_HEIGHT + 0.16,
    HOUSING_DEPTH,
  );
  const screenGeometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  const pipGeometry = new THREE.SphereGeometry(0.035, 10, 8);

  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0x18222f,
    roughness: 0.5,
    metalness: 0.7,
  });

  const textures = [];
  const materials = [housingMaterial];

  const panels = specs.map((spec) => {
    const accent = accents[spec.id];

    const holder = new THREE.Group();
    holder.position.set(spec.offsetX, eyeHeight, wallZ + HOUSING_DEPTH / 2);
    group.add(holder);

    const housing = new THREE.Mesh(housingGeometry, housingMaterial);
    housing.castShadow = true;
    holder.add(housing);

    const screenTexture = makeScreenTexture({
      title: spec.title,
      status: statuses[spec.id],
      accentCss: accent.css,
    });
    textures.push(screenTexture);

    const screenMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a121d,
      map: screenTexture,
      emissive: accent.hex,
      emissiveMap: screenTexture,
      emissiveIntensity: screenIntensity,
      roughness: 0.32,
      metalness: 0.1,
    });
    materials.push(screenMaterial);

    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.z = HOUSING_DEPTH / 2 + 0.004;
    screen.userData.panelId = spec.id;
    holder.add(screen);

    const pipMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a121d,
      emissive: accent.hex,
      emissiveIntensity: 2,
    });
    materials.push(pipMaterial);

    const pip = new THREE.Mesh(pipGeometry, pipMaterial);
    pip.position.set(
      -(PANEL_WIDTH / 2) - 0.02,
      -(PANEL_HEIGHT / 2) - 0.02,
      HOUSING_DEPTH / 2 + 0.01,
    );
    holder.add(pip);

    // Where the camera must ROTATE to frame this panel. Camera position is fixed
    // at room centre, so framing is never a move.
    const dx = spec.offsetX;
    const dz = wallZ;
    const horizontal = Math.hypot(dx, dz);

    return {
      id: spec.id,
      title: spec.title,
      accentHex: accent.hex,
      holder,
      housing,
      screen,
      screenMaterial,
      pipMaterial,
      focusYaw: Math.atan2(-dx, -dz),
      focusPitch: Math.atan2(0, horizontal),
      glowBoost: 0,
    };
  });

  return {
    group,
    panels,
    setShadows(enabled) {
      for (const panel of panels) panel.housing.castShadow = enabled;
    },
    setScreenIntensity(value) {
      for (const panel of panels) panel.screenMaterial.emissiveIntensity = value;
    },
    dispose() {
      housingGeometry.dispose();
      screenGeometry.dispose();
      pipGeometry.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) disposeTexture(t);
    },
  };
}

// ---------------------------------------------------------------------------
// Sealed door
// ---------------------------------------------------------------------------

/**
 * The way out, locked. Four rooms specify an identical frame + two leaves +
 * pulsing amber seal bar.
 *
 * Amber because that is this game's colour for "locked out", the same hue the
 * penalty timer uses. The door and the lockout are the same idea at different
 * scales, and using one colour for both is what makes that legible without text.
 */
export function makeSealedDoor({
  width = 1.7,
  height = 2.35,
  frameColour = 0x415571,
  leafColour = 0x1b2534,
  sealColour = 0xffb35c,
}) {
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: frameColour,
    roughness: 0.4,
    metalness: 0.75,
  });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: leafColour,
    roughness: 0.55,
    metalness: 0.6,
  });
  const sealMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1208,
    emissive: sealColour,
    emissiveIntensity: 1.8,
    roughness: 0.5,
  });
  materials.push(frameMaterial, leafMaterial, sealMaterial);

  const frameGeometry = new THREE.BoxGeometry(width + 0.24, height + 0.16, 0.16);
  geometries.push(frameGeometry);
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.y = height / 2;
  frame.castShadow = true;
  group.add(frame);

  const leafGeometry = new THREE.BoxGeometry(width / 2 - 0.015, height, 0.1);
  geometries.push(leafGeometry);
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    leaf.position.set(side * (width / 4 + 0.008), height / 2, -0.06);
    group.add(leaf);
  }

  const sealGeometry = new THREE.BoxGeometry(width, 0.07, 0.04);
  geometries.push(sealGeometry);
  const seal = new THREE.Mesh(sealGeometry, sealMaterial);
  seal.position.set(0, height * 0.52, -0.12);
  group.add(seal);

  return {
    group,
    frame,
    sealMaterial,
    /** Call from the room's update(); the seal breathes at the lockout rhythm. */
    pulse(elapsed) {
      sealMaterial.emissiveIntensity = 1.5 + Math.sin(elapsed * 1.6) * 0.5;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** Emissive strips near the ceiling, merged into one mesh. */
export function makeCeilingStrips({
  width,
  depth,
  y,
  colour = 0x5ef2d0,
  bodyColour = 0x415571,
  intensity = 1.6,
  inset = 0.08,
}) {
  const parts = [];
  const long = new THREE.BoxGeometry(width - 0.5, 0.05, 0.06);
  const short = new THREE.BoxGeometry(0.06, 0.05, depth - 0.5);

  const placements = [
    [long, 0, -depth / 2 + inset],
    [long, 0, depth / 2 - inset],
    [short, -width / 2 + inset, 0],
    [short, width / 2 - inset, 0],
  ];

  const matrix = new THREE.Matrix4();
  for (const [geometry, x, z] of placements) {
    const cloned = geometry.clone();
    matrix.makeTranslation(x, y, z);
    cloned.applyMatrix4(matrix);
    parts.push(cloned);
  }

  long.dispose();
  short.dispose();

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();

  const material = new THREE.MeshStandardMaterial({
    color: bodyColour,
    emissive: colour,
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.3,
  });

  return {
    mesh: new THREE.Mesh(merged, material),
    material,
    dispose() {
      merged.dispose();
      material.dispose();
    },
  };
}
