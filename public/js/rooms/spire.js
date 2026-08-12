// rooms/spire.js - the Spire. The final room.
//
// 8.4 x 8.4 x 4.8m. An open stone lantern at the top of a tower at pre-dawn.
// Three of the four walls stop at a 1.1m parapet, so you stand in open sky above
// a cloud sea; the north wall runs full height and carries the panels.
//
// This is the payoff room and the place a player who finishes early WAITS, so it
// has to be worth standing in. Its spectacle is the dawn light and the open air,
// deliberately not a giant planet - the Observatory owns the big instrument and
// the close sky, and the Spire must not read as a second Observatory.
//
// Shared world: the same cloud deck and the same moon, on the same compass
// bearing the Observatory sees it, at a lower altitude because this tower is
// higher and the dawn is further along. One consistent moon across two rooms is
// the cheapest possible proof that these are one place.
//
// Silhouette rule: the Spire is the only genuinely OPEN-AIR room (the Observatory
// is under glass). Its outline has a notch - six mullions, all on east and west,
// and the south edge left completely unframed. Nothing else in the game does.

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
  makePanelBank,
  makeAtlasQuads,
  mergeGeometries,
} from '../roomkit/geometry.js';

const ROOM = { width: 8.4, depth: 8.4, height: 4.8, eyeHeight: 1.62 };

const GOLD = 0xffd27a;
const GOLD_CSS = '#ffd27a';
const STONE_CSS = '#6d6455';

const PARAPET_H = 1.1;
const PARAPET_T = 0.34;
const SOCKET_RING_Y = 4.4;
const SOCKETS = 6;

// The Observatory's moon direction is (-0.736, 0.438, 0.516). Same compass
// bearing here (the x:z ratio is preserved) but a lower altitude - this tower is
// higher and dawn is further along, so the moon has sunk. Same object, two rooms.
const MOON_DIR = new THREE.Vector3(-0.790, 0.26, 0.554).normalize();

// The sun rises opposite the setting moon.
const SUN_DIR = new THREE.Vector3(0.790, 0.10, -0.554).normalize();

// Dawn runs one way and holds at full light. Phase 5 replaces this with
// rooms-solved via setDawn(); until then it must not loop back to night, because
// a player who waited for sunrise should not watch it un-happen.
const DAWN_SECONDS = 100;

// Lifted after playtest. The old night tint (0.30, 0.26, 0.44) multiplied an
// already-dark sky gradient down to near-black, and since the dawn starts at 0
// a player arriving at the Spire stood in the dark for the first minute of a
// hundred-second cycle. Pre-dawn should read as blue-hour, not as unlit.
const NIGHT_TINT = new THREE.Color(0.52, 0.48, 0.66);
const DAY_TINT = new THREE.Color(1, 1, 1);

// Nobody arrives at true midnight. Starting part-way up means the room is
// legible the moment you get there and still has most of its sunrise left to
// give - the waiting player is the whole audience for this room.
const DAWN_START = 0.42;

const TIERS = {
  low: {
    stars: 420,
    starOpacity: 0.75,
    screenIntensity: 0.9,
    socketEmissive: 0.35,
    windowEmissive: 1.5,
    shadows: false,
  },
  high: {
    stars: 1400,
    starOpacity: 0.95,
    screenIntensity: 1.15,
    socketEmissive: 0.5,
    windowEmissive: 2.1,
    shadows: true,
  },
};

/**
 * Weathered flagstone, with the azimuth rose baked straight into the albedo.
 *
 * The Spire owns azimuth (the Observatory owns altitude and declination), and
 * baking the rose into the floor texture costs zero extra draw calls for what is
 * functionally an instrument. It is also the room's downward moment: looking
 * down in the Observatory shows a dark polished pier, looking down here shows a
 * compass. Two opposite gestures instead of the same one twice.
 */
function makeFloorTexture() {
  const size = 1024;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const mid = size / 2;

  ctx.fillStyle = '#544c40';
  ctx.fillRect(0, 0, size, size);

  // Flagstones, laid in courses, each slightly its own shade.
  const rand = lcg(2287);
  const course = size / 7;
  for (let row = 0; row < 7; row += 1) {
    const offset = (row % 2) * (size / 10);
    for (let col = -1; col < 6; col += 1) {
      const x = offset + col * (size / 5);
      const y = row * course;
      const shade = 0.06 * (rand() - 0.45);
      ctx.fillStyle = shade > 0 ? `rgba(255,240,215,${shade})` : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(x, y, size / 5, course);
      bevelRect(ctx, { x, y, width: size / 5, height: course, depth: 3, alpha: 0.1 });
    }
  }

  // Azimuth rose: outer ring, degree ticks every 10, cardinals every 90.
  ctx.strokeStyle = 'rgba(255,210,122,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.30, 0, Math.PI * 2);
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg - 90) * Math.PI / 180;
    const major = deg % 30 === 0;
    const r0 = size * 0.40;
    const r1 = size * (major ? 0.355 : 0.378);
    ctx.strokeStyle = `rgba(255,210,122,${major ? 0.7 : 0.4})`;
    ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    ctx.lineTo(mid + Math.cos(a) * r1, mid + Math.sin(a) * r1);
    ctx.stroke();
  }

  // Bearing numerals every 30 degrees - the readable half of the instrument.
  ctx.fillStyle = 'rgba(255,222,150,0.8)';
  ctx.font = '600 30px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg - 90) * Math.PI / 180;
    const r = size * 0.335;
    const label = String(deg).padStart(3, '0');
    drawTrackedText(ctx, label, mid + Math.cos(a) * r, mid + Math.sin(a) * r, 2);
  }

  // Cardinals, larger, inside the inner ring.
  ctx.fillStyle = GOLD_CSS;
  ctx.font = '700 52px "Chakra Petch", "IBM Plex Mono", monospace';
  const cardinals = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  for (const [letter, deg] of cardinals) {
    const a = (deg - 90) * Math.PI / 180;
    const r = size * 0.23;
    drawTrackedText(ctx, letter, mid + Math.cos(a) * r, mid + Math.sin(a) * r, 0);
  }

  grainPass(ctx, { width: size, height: size, count: 3000, seed: 53, alpha: 0.045 });

  // repeat 1: the rose must appear ONCE, centred, not tiled.
  return toTexture(canvas, { anisotropy: 8 });
}

/** Parapet and north wall stone: coursed ashlar, weathered from above. */
function makeStoneTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = STONE_CSS;
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(6151);
  const course = size / 5;
  for (let row = 0; row < 5; row += 1) {
    const offset = (row % 2) * (size / 6);
    for (let col = -1; col < 4; col += 1) {
      const x = offset + col * (size / 3);
      const y = row * course;
      const shade = 0.07 * (rand() - 0.42);
      ctx.fillStyle = shade > 0 ? `rgba(255,244,220,${shade})` : `rgba(0,0,0,${-shade})`;
      ctx.fillRect(x, y, size / 3, course);
      bevelRect(ctx, { x, y, width: size / 3, height: course, depth: 3, alpha: 0.13 });
    }
  }

  streakPass(ctx, { width: size, height: size, count: 16, seed: 71, alpha: 0.06 });
  grainPass(ctx, { width: size, height: size, count: 1800, seed: 29, alpha: 0.04 });

  return toTexture(canvas, { repeat: [3, 1] });
}

/**
 * The dawn sky, as one vertical gradient.
 *
 * Three's SphereGeometry puts uv.y = 1 at the zenith and 0 at the nadir, and the
 * texture is flipped by default, so canvas TOP is the zenith and canvas MIDDLE
 * is the horizon. The horizon band therefore sits at y = 0.5, which is why the
 * gold is where it is rather than at the bottom of the image.
 *
 * The whole sunrise is baked in once; the time of day is then a tint multiplied
 * over it in update(), which is one colour lerp per frame instead of redrawing
 * a 1024px canvas. The gradient runs deep violet -> magenta -> orange -> gold,
 * because a sunrise that skips orange is not a sunrise.
 */
function makeSkyTexture() {
  const width = 16;
  const height = 1024;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0.00, '#140e26'); // zenith, deep night violet
  g.addColorStop(0.22, '#241a3e');
  g.addColorStop(0.36, '#4a2a55');
  g.addColorStop(0.43, '#8f4560'); // magenta approach
  // The warm band is deliberately WIDE. A first pass put the gold in a 0.6%
  // slice, which is about one degree of sky - technically a sunrise and visually
  // a hairline nobody notices. A dawn has to occupy real angular height.
  g.addColorStop(0.462, '#d9743f'); // orange
  g.addColorStop(0.485, '#ffb95e');
  g.addColorStop(0.500, '#ffe6ae'); // horizon core, brightest
  g.addColorStop(0.515, '#ffc879');
  g.addColorStop(0.545, '#9a6a44'); // falling away below the horizon
  g.addColorStop(0.64, '#3a2a30');
  g.addColorStop(1.00, '#08080e'); // nadir
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  return toTexture(canvas, { anisotropy: 2 });
}

/** Soft banded cloud sea. Reused idea from the Observatory - same world. */
function makeCloudTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8e8399';
  ctx.fillRect(0, 0, size, size);

  const rand = lcg(9931);
  for (let i = 0; i < 90; i += 1) {
    const y = rand() * size;
    const h = 6 + rand() * 46;
    const light = rand() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,228,196,${0.05 + rand() * 0.13})`
      : `rgba(38,30,52,${0.05 + rand() * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, y, 60 + rand() * 190, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  grainPass(ctx, { width: size, height: size, count: 1400, seed: 13, alpha: 0.05 });

  return toTexture(canvas, { repeat: [6, 6] });
}

/** Lit windows on the five distant towers, one atlas cell each. */
function makeWindowAtlas(hueNames) {
  const width = 256;
  const height = 64;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const cells = [];

  // Each chamber's window carries a hint of that chamber's own hue, so a player
  // who has been told "the lime one" can find it. They are 60m away and a few
  // pixels tall, so this is a tint, not a readable label.
  const HUE_CSS = {
    VELLUM: '#e6ddc8', LIME: '#b7f03a', VIOLET: '#8f7bff',
    BLUE: '#3d7bff', GOLD: '#ffd27a',
  };
  const hues = hueNames.map((n) => HUE_CSS[n] || '#ffd27a');

  for (let i = 0; i < 5; i += 1) {
    const x = i * 51;
    ctx.clearRect(x, 0, 51, height);

    // A soft halo first, then a hard bright core. A pure radial falloff was too
    // faint at 60m against a dawn sky - it read as a smudge on the stone rather
    // than as a lit window, and "someone is in there" is the whole point of it.
    const halo = ctx.createRadialGradient(x + 25, 32, 1, x + 25, 32, 25);
    halo.addColorStop(0, `${hues[i]}dd`);
    halo.addColorStop(0.45, `${hues[i]}55`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x, 0, 51, height);

    // The lit aperture itself: a small bright rectangle, hue-tinted at its edge
    // so the chamber it belongs to is still guessable.
    ctx.fillStyle = hues[i];
    ctx.fillRect(x + 17, 20, 17, 24);
    ctx.fillStyle = 'rgba(255,250,235,0.92)';
    ctx.fillRect(x + 20, 23, 11, 18);

    cells.push([x, 4, 51, 56]);
  }

  return { texture: toTexture(canvas), cells, width, height };
}

export function createSpire({ dimensions, puzzle } = {}) {
  // The signal watch the server generated: where each lantern stands on the
  // horizon, whose chamber it belongs to, how many blinks it calls with and
  // which lantern answers. Falls back so the room still renders in isolation.
  const cfg = puzzle?.config || null;
  const lanterns = cfg?.lanterns || [
    { bearing: 120, hue: 'VELLUM', chamber: 'ARCHIVE', blinks: 2, answers: 2 },
    { bearing: 156, hue: 'LIME', chamber: 'ENGINE ROOM', blinks: 3, answers: 0 },
    { bearing: 200, hue: 'VIOLET', chamber: 'OBSERVATORY', blinks: 1, answers: 3 },
    { bearing: 244, hue: 'BLUE', chamber: 'VAULT', blinks: 4, answers: 4 },
    { bearing: 288, hue: 'GOLD', chamber: 'SPIRE', blinks: 3, answers: 1 },
  ];
  const cycleSeconds = cfg?.cycleSeconds || 21;

  // The engine passes its default; this room is taller and builds its own.
  void dimensions;
  const room = ROOM;
  const group = new THREE.Group();

  const parts = [];
  const textures = [];
  const own = (part) => { parts.push(part); return part; };

  let settings = TIERS.low;
  let dawn = 0; // 0 = pre-dawn night, 1 = full sunrise

  // ----- floor --------------------------------------------------------------

  const floorTexture = makeFloorTexture();
  textures.push(floorTexture);

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTexture,
    roughness: 0.88,
    metalness: 0.06,
  });
  const floorGeometry = new THREE.PlaneGeometry(room.width, room.depth);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  own({
    dispose() {
      floorGeometry.dispose();
      floorMaterial.dispose();
    },
  });

  // ----- parapet + north wall ----------------------------------------------
  // Three low walls merged into one mesh. The coping at 1.1m carries the game's
  // waist horizontal - the recurring reference height that gives a room its
  // sense of scale - so this room needs no trim rail.

  const stoneTexture = makeStoneTexture();
  textures.push(stoneTexture);

  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: stoneTexture,
    roughness: 0.9,
    metalness: 0.04,
  });

  const parapetParts = [];
  const half = room.width / 2;
  const m = new THREE.Matrix4();

  // South, east, west. North is the full-height panel wall.
  const runs = [
    { w: room.width, d: PARAPET_T, x: 0, z: half - PARAPET_T / 2 },
    { w: PARAPET_T, d: room.depth, x: half - PARAPET_T / 2, z: 0 },
    { w: PARAPET_T, d: room.depth, x: -(half - PARAPET_T / 2), z: 0 },
  ];
  for (const run of runs) {
    const box = new THREE.BoxGeometry(run.w, PARAPET_H, run.d);
    m.makeTranslation(run.x, PARAPET_H / 2, run.z);
    box.applyMatrix4(m);
    parapetParts.push(box);
  }

  const parapetGeometry = mergeGeometries(parapetParts);
  for (const p of parapetParts) p.dispose();
  const parapet = new THREE.Mesh(parapetGeometry, stoneMaterial);
  parapet.castShadow = true;
  parapet.receiveShadow = true;
  group.add(parapet);

  const northGeometry = new THREE.PlaneGeometry(room.width, room.height);
  const northWall = new THREE.Mesh(northGeometry, stoneMaterial);
  northWall.position.set(0, room.height / 2, -half);
  northWall.receiveShadow = true;
  group.add(northWall);

  own({
    dispose() {
      parapetGeometry.dispose();
      northGeometry.dispose();
      stoneMaterial.dispose();
    },
  });

  // ----- mullions -----------------------------------------------------------
  // Six uprights carrying a lintel, ALL on east and west. The south edge is left
  // completely unframed, which is the notch in this room's silhouette and the
  // single thing that stops it reading as the Observatory's rib cage.

  const mullionParts = [];
  const mullionZ = [-2.6, 0, 2.6];
  for (const sign of [-1, 1]) {
    for (const z of mullionZ) {
      const post = new THREE.BoxGeometry(0.22, room.height - PARAPET_H, 0.22);
      m.makeTranslation(sign * (half - 0.16), PARAPET_H + (room.height - PARAPET_H) / 2, z);
      post.applyMatrix4(m);
      mullionParts.push(post);
    }
    const lintel = new THREE.BoxGeometry(0.3, 0.3, room.depth);
    m.makeTranslation(sign * (half - 0.16), room.height - 0.15, 0);
    lintel.applyMatrix4(m);
    mullionParts.push(lintel);
  }

  const mullionGeometry = mergeGeometries(mullionParts);
  for (const p of mullionParts) p.dispose();

  const mullionMaterial = new THREE.MeshStandardMaterial({
    color: 0x5f5749,
    roughness: 0.88,
    metalness: 0.06,
  });
  const mullions = new THREE.Mesh(mullionGeometry, mullionMaterial);
  mullions.castShadow = true;
  group.add(mullions);

  own({
    dispose() {
      mullionGeometry.dispose();
      mullionMaterial.dispose();
    },
  });

  // ----- sky ---------------------------------------------------------------
  // Drawn LAST with depth testing on, so early-Z throws away every pixel the
  // architecture already covers. (renderOrder -1 would draw it first at full
  // screen and then overdraw the lot - the same picture for a lot more fill.)
  // fog is off: sky is the thing fog is meant to fade toward, not fade itself.

  const skyTexture = makeSkyTexture();
  textures.push(skyTexture);

  const skyMaterial = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  skyMaterial.color.copy(NIGHT_TINT);

  const skyGeometry = new THREE.SphereGeometry(90, 32, 20);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.renderOrder = 900;
  group.add(sky);

  own({
    dispose() {
      skyGeometry.dispose();
      skyMaterial.dispose();
    },
  });

  // ----- stars --------------------------------------------------------------
  // Allowed here where in-room dust is not: this is the sky beyond the parapet,
  // not motes in the room, so it cannot drift through a wall. It fades out as
  // the dawn comes up, which makes it a second readout of the same progress.

  function makeStars(count) {
    const positions = new Float32Array(count * 3);
    const rand = lcg(4423);
    for (let i = 0; i < count; i += 1) {
      // Upper hemisphere only, biased away from the horizon haze.
      const theta = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92;
      const r = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(theta) * r * 80;
      positions[i * 3 + 1] = y * 80;
      positions[i * 3 + 2] = Math.sin(theta) * r * 80;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xdfe4ff,
      map: getMoteSprite(),
      size: 0.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: settings.starOpacity,
      depthWrite: false,
      fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 901;
    return points;
  }

  let stars = makeStars(settings.stars);
  group.add(stars);

  // ----- moon ---------------------------------------------------------------

  const moonGeometry = new THREE.SphereGeometry(1.5, 16, 12);
  const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xe8e2ff, fog: false });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.copy(MOON_DIR).multiplyScalar(72);
  moon.renderOrder = 902;
  group.add(moon);

  own({
    dispose() {
      moonGeometry.dispose();
      moonMaterial.dispose();
    },
  });

  // ----- cloud deck ---------------------------------------------------------
  // The shared-world lever: the same cloud sea the Observatory looks down on.
  // The inner radius is well beyond the parapet because the parapet occludes
  // everything steeper than about 7 degrees of depression from a standing eye -
  // cloud any closer than that is geometry nobody can ever see.

  const cloudTexture = makeCloudTexture();
  textures.push(cloudTexture);

  const cloudMaterial = new THREE.MeshBasicMaterial({
    map: cloudTexture,
    fog: false,
  });
  cloudMaterial.color.copy(NIGHT_TINT);

  const cloudGeometry = new THREE.RingGeometry(45, 140, 64, 1);
  const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
  cloud.rotation.x = -Math.PI / 2;
  cloud.position.y = -7;
  group.add(cloud);

  own({
    dispose() {
      cloudGeometry.dispose();
      cloudMaterial.dispose();
    },
  });

  // ----- the five other towers ---------------------------------------------
  // The Spire is the only room that can see the others. Five silhouettes at
  // session-fixed bearings, rising out of the cloud, each with one lit window in
  // its chamber's hue. Bodies merge to one draw; windows merge to a second.

  // Bearings must stay inside the OPEN arc. The north wall runs full height from
  // (-4.2,-4.2) to (4.2,-4.2), so it occludes everything between 315 and 45
  // degrees - a tower placed there is geometry the player can never see. These
  // five spread across the parapet sides only.
  // Bearings are the server's now. They land inside the open arc (the north
  // wall occludes 315..45), and they are what the player sights off the floor
  // rose - a decorative bearing would make the reported answer wrong.
  const TOWER_BEARINGS = lanterns.map((l) => (l.bearing * Math.PI) / 180);
  const TOWER_DIST = 62;

  const towerParts = [];
  const towerRand = lcg(7717);
  const windowQuads = [];
  const windowAtlas = makeWindowAtlas(lanterns.map((l) => l.hue));
  textures.push(windowAtlas.texture);

  TOWER_BEARINGS.forEach((bearing, i) => {
    const tx = Math.sin(bearing) * TOWER_DIST;
    const tz = -Math.cos(bearing) * TOWER_DIST;
    const w = 4.4 + towerRand() * 2.2;
    const h = 22 + towerRand() * 7;
    const baseY = -18;

    const shaft = new THREE.BoxGeometry(w, h, w);
    m.makeRotationY(bearing);
    m.setPosition(tx, baseY + h / 2, tz);
    shaft.applyMatrix4(m);
    towerParts.push(shaft);

    // A crown a little wider than the shaft, so they read as built, not as bars.
    const crown = new THREE.BoxGeometry(w * 1.3, 0.9, w * 1.3);
    m.makeRotationY(bearing);
    m.setPosition(tx, baseY + h + 0.45, tz);
    crown.applyMatrix4(m);
    towerParts.push(crown);

    // The lit window sits on the face TOWARD the player, just proud of the
    // stone. Scaling the tower's centre position toward the origin does not
    // work: these towers are ~5m wide, so anything short of subtracting the
    // half-width buries the window inside its own shaft.
    //
    // Rotation is -bearing, not bearing+PI. RotationY(t) sends the quad's rest
    // normal +Z to (sin t, 0, cos t); the direction from tower back to origin is
    // (-sin b, 0, cos b), and only t = -b satisfies both components.
    const faceDist = TOWER_DIST - w / 2 - 0.06;
    const wy = baseY + h - 2.4;
    windowQuads.push({
      width: 3.4,
      height: 3.4,
      position: [Math.sin(bearing) * faceDist, wy, -Math.cos(bearing) * faceDist],
      rotation: [0, -bearing, 0],
      cell: windowAtlas.cells[i],
    });
  });

  const towerGeometry = mergeGeometries(towerParts);
  for (const p of towerParts) p.dispose();

  const towerMaterial = new THREE.MeshBasicMaterial({ color: 0x171622, fog: false });
  const towers = new THREE.Mesh(towerGeometry, towerMaterial);
  group.add(towers);

  // FIVE separate window meshes, one material each.
  //
  // They were merged into a single draw, which was right when a lit window was
  // scenery. Now each lantern has to blink and hold on its own schedule - that
  // signalling IS the puzzle - and one shared material cannot say different
  // things about five towers. Five draws on two triangles apiece.
  //
  // Opacity carries the signal, not colour: these sit on an additive layer over
  // a brightening dawn sky, and additive blending saturates to white long
  // before the eye reads a hue change. The Observatory learned that the hard
  // way with its beacons.
  // The five lit windows stay ONE merged draw - static scenery, unchanged.
  const windowGeometry = makeAtlasQuads(windowQuads, {
    atlasWidth: windowAtlas.width,
    atlasHeight: windowAtlas.height,
  });
  const windowMaterial = new THREE.MeshBasicMaterial({
    map: windowAtlas.texture,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  const windowsMesh = new THREE.Mesh(windowGeometry, windowMaterial);
  windowsMesh.renderOrder = 5;
  group.add(windowsMesh);

  // THE LAMPS. One emissive bead per tower, and this is what actually carries
  // the signal watch.
  //
  // The signal was first built by splitting the window atlas into five quads
  // and animating their opacity. The geometry was right, the UVs were right and
  // the texture was right - and the quads would not draw, while an identical
  // quad with the atlas swapped for a flat colour drew fine. Rather than keep
  // bisecting a rendering path that only had to be decorative, the signal moved
  // onto solid geometry: a sphere with a basic material is the one thing in
  // this project that has never failed to appear.
  //
  // A bead also reads better than a texture at 60m. It is a lamp, not a lit
  // rectangle, so it holds its shape against a sky that brightens under it.
  const LAMP_R = 0.85;
  const lampGeometry = new THREE.SphereGeometry(LAMP_R, 10, 8);
  const HUE_HEX = {
    VELLUM: 0xe6ddc8, LIME: 0xb7f03a, VIOLET: 0x8f7bff,
    BLUE: 0x3d7bff, GOLD: 0xffd27a,
  };
  const lampMaterials = lanterns.map((l) => new THREE.MeshBasicMaterial({
    color: HUE_HEX[l.hue] || 0xffd27a,
    fog: false,
    transparent: true,
    opacity: 1,
  }));
  const lamps = lanterns.map((l, i) => {
    const mesh = new THREE.Mesh(lampGeometry, lampMaterials[i]);
    const q = windowQuads[i];
    // Pulled a fixed 2.2m toward the viewer along its own bearing, not scaled
    // by a percentage.
    //
    // The tower bodies are rotated so that for most bearings a CORNER faces the
    // room, and a corner reaches ~0.2w further out than the face the window was
    // offset from. A lamp placed just proud of the window therefore ended up
    // inside its own tower on every bearing where that happened - two lanterns
    // lit, three swallowed, which looks exactly like a signalling bug.
    const dist = Math.hypot(q.position[0], q.position[2]);
    const pull = (dist - 2.2) / dist;
    mesh.position.set(q.position[0] * pull, q.position[1], q.position[2] * pull);
    mesh.renderOrder = 6;
    group.add(mesh);
    return mesh;
  });
  void lamps;

  own({
    dispose() {
      towerGeometry.dispose();
      towerMaterial.dispose();
      windowGeometry.dispose();
      windowMaterial.dispose();
      lampGeometry.dispose();
      for (const m of lampMaterials) m.dispose();
    },
  });

  // ----- keystone socket ring ----------------------------------------------
  // The completion object, overhead and dormant. Six sockets for six crew slots
  // - the lobby arch restated a third time, in stone. Phase 5 seats a glyph in
  // each as its chamber solves. It sits at 4.4m: visible when you look up,
  // deliberately never something you must read.

  const ringGeometry = new THREE.TorusGeometry(1.15, 0.07, 8, 40);
  ringGeometry.rotateX(Math.PI / 2);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b6153,
    roughness: 0.7,
    metalness: 0.25,
  });
  const socketRing = new THREE.Mesh(ringGeometry, ringMaterial);
  socketRing.position.y = SOCKET_RING_Y;
  group.add(socketRing);

  const socketGeometry = new THREE.BoxGeometry(0.2, 0.12, 0.2);
  const socketMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2418,
    emissive: GOLD,
    emissiveIntensity: settings.socketEmissive,
    roughness: 0.5,
  });
  // SIX separate sockets, not one instanced mesh.
  //
  // A socket has to light on its own as its chamber falls - that is the whole
  // completion signal - and one shared material cannot say different things
  // about six stones. Six draws on a 12-triangle box, which is nothing, and it
  // is the fourth time in this project that instancing had to be undone the
  // moment the thing needed to carry state.
  const socketMaterials = Array.from({ length: SOCKETS }, () => socketMaterial.clone());
  const sockets = Array.from({ length: SOCKETS }, (_, i) => {
    const a = (i / SOCKETS) * Math.PI * 2;
    const mesh = new THREE.Mesh(socketGeometry, socketMaterials[i]);
    mesh.rotation.y = -a;
    mesh.position.set(Math.cos(a) * 1.15, SOCKET_RING_Y, Math.sin(a) * 1.15);
    group.add(mesh);
    return mesh;
  });
  void sockets;

  /** How many chambers are open, and of how many. Drives the whole room. */
  let solvedCount = 0;
  let chamberTotal = 0;

  function applyProgress() {
    for (let i = 0; i < SOCKETS; i += 1) {
      // A seated stone burns; an empty socket is cold and barely there. The
      // ring fills clockwise so the crew can read progress as a shape.
      const seated = i < solvedCount;
      socketMaterials[i].emissiveIntensity = seated
        ? settings.socketEmissive * 5.5
        : settings.socketEmissive * 0.35;
      socketMaterials[i].color.setHex(seated ? 0xffe6b0 : 0x2a2418);
    }
  }
  applyProgress();

  own({
    dispose() {
      ringGeometry.dispose();
      ringMaterial.dispose();
      socketGeometry.dispose();
      for (const sm of socketMaterials) sm.dispose();
      socketMaterial.dispose();
    },
  });

  // ----- panels -------------------------------------------------------------

  const bank = own(makePanelBank({
    wallZ: -half,
    eyeHeight: room.eyeHeight,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // No sealed door. The Spire is where the crew arrives, not a room they are
  // trying to get out of - the way out is the keystone overhead.

  // ----- lights -------------------------------------------------------------
  // Two room lights. The engine's overhead key is disabled and replaced by a
  // room-owned sun, because the sun has to MOVE and change colour with the dawn,
  // which the engine's static environment key cannot do.

  const sunLight = new THREE.DirectionalLight(0xffb066, 0.5);
  sunLight.position.copy(SUN_DIR).multiplyScalar(40);
  sunLight.target.position.set(0, 1, 0);
  sunLight.shadow.camera.left = -6;
  sunLight.shadow.camera.right = 6;
  sunLight.shadow.camera.top = 6;
  sunLight.shadow.camera.bottom = -6;
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 70;
  sunLight.shadow.bias = -0.0012;
  group.add(sunLight);
  group.add(sunLight.target);

  // Tight and weak on purpose. At a wider range this washed the warm stone
  // green and fought the gold the whole room is built on; it only needs to pool
  // on the panel faces, not light the wall.
  const panelWash = new THREE.PointLight(0x5ef2d0, 1.6, 3.2, 2);
  panelWash.position.set(0, room.eyeHeight + 0.35, -half + 0.9);
  group.add(panelWash);

  // ----- tier ---------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;

    bank.setScreenIntensity(settings.screenIntensity);
    bank.setShadows(settings.shadows);
    socketMaterial.emissiveIntensity = settings.socketEmissive;
    sunLight.castShadow = settings.shadows;
    parapet.castShadow = settings.shadows;
    mullions.castShadow = settings.shadows;

    group.remove(stars);
    stars.geometry.dispose();
    stars.material.dispose();
    stars = makeStars(settings.stars);
    group.add(stars);
  }

  // ----- dawn ---------------------------------------------------------------

  const skyTint = new THREE.Color();
  const sunColour = new THREE.Color();
  const NIGHT_SUN = new THREE.Color(0x5a4a7a);
  const DAY_SUN = new THREE.Color(0xffc98a);

  function applyDawn(t) {
    dawn = Math.max(0, Math.min(1, t));
    // Ease so the last third - the part a waiting player actually watches - is
    // slow and worth watching.
    const e = dawn * dawn * (3 - 2 * dawn);

    skyTint.copy(NIGHT_TINT).lerp(DAY_TINT, e);
    skyMaterial.color.copy(skyTint);
    cloudMaterial.color.copy(skyTint);

    stars.material.opacity = settings.starOpacity * (1 - e) ** 1.5;
    moonMaterial.color.setScalar(0.35 + 0.55 * (1 - e));

    sunColour.copy(NIGHT_SUN).lerp(DAY_SUN, e);
    sunLight.color.copy(sunColour);
    // The floor was 0.35, which left the stone barely shaded at all before
    // sunrise. Pre-dawn light is dim, not absent.
    sunLight.intensity = 1.25 + 2.2 * e;

    // The sun climbs as the dawn runs. Same bearing, rising altitude.
    const elevation = 0.04 + e * 0.42;
    sunLight.position.set(SUN_DIR.x, elevation, SUN_DIR.z).normalize().multiplyScalar(40);

    // Windows in the far towers dim as the sky brightens past them. This is a
    // SCALE, not an assignment: the signal watch owns window opacity frame to
    // frame, and the dawn only says how much of that signal survives the sky.
    // Setting opacity directly here would silently overwrite whichever lantern
    // was mid-blink.
    // The floor is 0.7, not 0.35. Windows washing out in daylight is the right
    // instinct for scenery, but these lanterns are the PUZZLE, and the dawn
    // runs one way to full light in a room whose whole job is being somewhere
    // to wait. Dimming them to a third meant the signal a late player needs was
    // faintest exactly when they arrived. It still dims - just never below
    // readable.
    dawnWindowScale = 0.7 + 0.3 * (1 - e);
  }

  // How much of a lantern's signal survives the brightening sky. Owned by
  // applyDawn(), applied by the signal watch.
  let dawnWindowScale = 1;

  // ----- animation ----------------------------------------------------------

  /** Push the dawn to at least `t`, never back. */
  function setDawnFloor(t) {
    const target = Math.max(0, Math.min(1, t));
    if (target * DAWN_SECONDS <= elapsedDawn) return;
    elapsedDawn = target * DAWN_SECONDS;
    applyDawn(target);
  }

  let elapsedDawn = DAWN_START * DAWN_SECONDS;
  applyDawn(DAWN_START);

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  function update(elapsed, dt, flags = {}) {
    // One-way to full light, then hold. Phase 5 replaces this with setDawn()
    // driven by rooms-solved; a looping day/night would mean a player who
    // waited for the sunrise gets to watch it un-happen.
    if (elapsedDawn < DAWN_SECONDS) {
      elapsedDawn = Math.min(DAWN_SECONDS, elapsedDawn + dt);
      applyDawn(elapsedDawn / DAWN_SECONDS);
    }

    // ----- THE SIGNAL WATCH -------------------------------------------------
    // The five lanterns take the horizon in turn, sunwise, four seconds each,
    // then one second of quiet. In a lantern's turn it SPEAKS in short blinks,
    // and the lantern it is calling ANSWERS with one long steady hold.
    //
    // The blink count is how many places clockwise the answerer sits, so a
    // player can resolve a pair that happens behind their back - the room is
    // open on every side and nobody can watch all five at once. That is the
    // deduction, and it is why the count has to be countable: the blinks are
    // paced well apart rather than fluttering.
    //
    // Driven off the shared run clock, so two players on this tower see the
    // same lantern speaking at the same moment.
    const SLOT = 4;
    const QUIET = cycleSeconds - lanterns.length * SLOT;
    const watch = ((elapsed % cycleSeconds) + cycleSeconds) % cycleSeconds;
    const speaking = watch < lanterns.length * SLOT ? Math.floor(watch / SLOT) : -1;
    const inSlot = speaking >= 0 ? watch - speaking * SLOT : 0;
    void QUIET;

    for (let i = 0; i < lampMaterials.length; i += 1) {
      // Resting glow: the towers must still read as inhabited between turns.
      let level = 0.34;

      if (speaking === i) {
        // SPEAK. `blinks` deliberate pulses, spaced so they can be counted out
        // loud, then silence for the rest of the slot.
        const BLINK = 0.42;
        const lead = 0.35;
        const n = lanterns[i].blinks;
        const since = inSlot - lead;
        if (since >= 0 && since < n * BLINK) {
          const phase = (since % BLINK) / BLINK;
          level = phase < 0.5 ? 1 : 0.2;
        } else {
          level = 0.2;
        }
      } else if (speaking >= 0 && lanterns[speaking].answers === i) {
        // ANSWER. ONE long hold, deliberately not a blink - it has to be
        // distinguishable from the speaker at a glance, from any bearing.
        const holdFrom = 0.55;
        const holdTo = 3.5;
        if (inSlot >= holdFrom && inSlot <= holdTo) {
          // Soft edges so it reads as a lamp being held open, not a hard cut.
          const edge = 0.25;
          const up = Math.min(1, (inSlot - holdFrom) / edge);
          const down = Math.min(1, (holdTo - inSlot) / edge);
          level = 0.34 + 0.66 * Math.min(up, down);
        }
      }

      // Colour scaled past 1 is what makes a lamp read as LIT rather than
      // merely present: the material clamps on screen, so the overdrive lands
      // as a hard white core exactly where a lamp should have one. The dawn
      // scale keeps a resting lamp from out-shouting a brightening sky.
      const base = HUE_HEX[lanterns[i].hue] || 0xffd27a;
      lampMaterials[i].color.setHex(base)
        .multiplyScalar(0.5 + 2.8 * level * dawnWindowScale);
      lampMaterials[i].opacity = 0.5 + 0.5 * level;
    }

    // Rigid-body star drift. Whole-cloud rotation, so cost is one write however
    // many stars HIGH turns on.
    stars.rotation.y += dt * 0.0055;

    // The socket ring breathes very slightly - alive, but dormant until phase 5.
    socketMaterial.emissiveIntensity =
      settings.socketEmissive * (0.75 + Math.sin(elapsed * 0.8) * 0.25);

    for (let i = 0; i < bank.panels.length; i += 1) {
      const panel = bank.panels[i];
      const wave = Math.sin(elapsed * 0.9 + i * 2.1);
      panel.screenMaterial.emissiveIntensity =
        settings.screenIntensity * (0.9 + wave * 0.1) + panel.glowBoost;
      panel.pipMaterial.emissiveIntensity = 1.7 + Math.sin(elapsed * 2.4 + i * 1.7) * 0.8;
    }
  }

  function dispose() {
    stars.geometry.dispose();
    stars.material.dispose();
    for (const part of parts) part.dispose?.();
    for (const texture of textures) disposeTexture(texture);
  }

  return {
    id: 'spire',
    group,
    panels: bank.panels,
    dimensions: { ...room },

    /**
     * Phase 5 hook: drive the dawn from rooms-solved instead of the clock.
     * Calling this stops the automatic cycle.
     */
    setDawn(progress) {
      elapsedDawn = DAWN_SECONDS;
      applyDawn(progress);
    },

    /**
     * The completion signal. Called whenever the server's progress changes.
     *
     * Solving a chamber used to change nothing anyone could see - five puzzles
     * fell and the payoff room carried on running its own clock. Now the crew's
     * progress IS the sunrise: each chamber opened seats a stone in the ring
     * overhead and pushes the dawn further up. The last one lands at full light.
     *
     * Dawn is floored at its starting value so the room never gets darker than
     * a player found it; progress may only ever add light.
     */
    setProgress({ solved = 0, total = 0 } = {}) {
      solvedCount = Math.max(0, Math.min(SOCKETS, solved));
      chamberTotal = total;
      applyProgress();
      if (total > 0) {
        const share = solved / total;
        setDawnFloor(DAWN_START + (1 - DAWN_START) * share);
      }
    },

    // No colliders and no keepInsideRadius on purpose. The engine already clamps
    // the player to the room's rectangular bounds minus a margin, which on this
    // 8.4m platform stops them 0.32m short of a parapet standing at 4.2m - so
    // the parapet reads as the barrier and is backed by the clamp. A
    // keepInsideRadius would inscribe a circle in a square floor and fence off
    // the corners for no reason.

    environment: {
      // Cool pre-dawn sky fill. The sun is room-owned (it has to move), so the
      // engine's fixed overhead key is switched off - left on, it would light
      // the room from a direction with nothing in the sky to justify it.
      ambientColour: 0x6b78a4,
      ambientIntensity: 2.6,
      keyEnabled: false,
      fogColour: 0x2a2740,
      fogNear: 18,
      fogFar: 150,
      clearColour: 0x140e26,
      // The vista lives between 30m and 90m. At the engine's 60m interior
      // default the sky dome, moon, stars and every distant tower fall outside
      // the frustum and are silently clipped - the room renders as bare clear
      // colour and looks broken rather than looking near-sighted.
      cameraFar: 220,
    },
    update,
    applyTier,
    dispose,
  };
}
