// rooms/room-one.js - the phase 3 proving room.
//
// Rebuilt on roomkit. Visually identical to the hand-written version; the point
// of the rewrite is that the shell, rail, strips, panel bank, door and dust now
// come from shared helpers, so this file contains only what is specific to this
// room. It is the reference for how a room is written.
//
// This room will likely be absorbed into the Archive. It is kept as-is for now
// because it is the only thing currently provable end-to-end.

import * as THREE from 'three';
import {
  newCanvas,
  toTexture,
  disposeTexture,
  grainPass,
  rivetPass,
  bevelRect,
} from '../roomkit/canvas.js';
import {
  makeStandardShell,
  makeTrimRail,
  makeCeilingStrips,
  makePanelBank,
  makeSealedDoor,
  makeMotes,
} from '../roomkit/geometry.js';

const TIERS = {
  low: {
    motes: 150,
    moteOpacity: 0.4,
    stripIntensity: 1.6,
    screenIntensity: 0.85,
    accentStrength: 0.55,
    shadows: false,
  },
  high: {
    motes: 520,
    moteOpacity: 0.6,
    stripIntensity: 2.4,
    screenIntensity: 1.15,
    accentStrength: 1,
    shadows: true,
  },
};

/** Deck plating: panel seams, per-tile shade variation, bolt heads. */
function makeFloorTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#232f3e';
  ctx.fillRect(0, 0, size, size);

  const tile = size / 4;
  for (let ty = 0; ty < 4; ty += 1) {
    for (let tx = 0; tx < 4; tx += 1) {
      const shade = 0.03 * (((tx * 7 + ty * 13) % 5) - 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, shade)})`;
      ctx.fillRect(tx * tile, ty * tile, tile, tile);
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, -shade)})`;
      ctx.fillRect(tx * tile, ty * tile, tile, tile);
      bevelRect(ctx, { x: tx * tile, y: ty * tile, width: tile, height: tile, depth: 2, alpha: 0.1 });
    }
  }

  ctx.strokeStyle = 'rgba(120,160,200,0.16)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    const p = i * tile;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  rivetPass(ctx, { width: size, height: size, spacing: tile, radius: 3, alpha: 0.2 });
  grainPass(ctx, { width: size, height: size, count: 1400, seed: 11, alpha: 0.05 });

  return toTexture(canvas, { repeat: 3 });
}

/** Wall plating: vertical seams, subtler than the floor. */
function makeWallTexture() {
  const size = 512;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2b3950';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(130,170,215,0.13)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    const x = (i * size) / 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(130,170,215,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i += 1) {
    const y = (i * size) / 8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  grainPass(ctx, { width: size, height: size, count: 900, seed: 23, alpha: 0.04 });

  return toTexture(canvas, { repeat: 2 });
}

export function createRoomOne({ dimensions }) {
  const room = dimensions;
  const group = new THREE.Group();

  // Anything needing teardown is registered as it is created, so dispose()
  // cannot drift out of sync as this room grows.
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
  textures.push(floorTexture, wallTexture);

  const shell = own(makeStandardShell({
    width: room.width,
    depth: room.depth,
    height: room.height,
    floorMap: floorTexture,
    wallMap: wallTexture,
  }));
  group.add(shell.group);

  const rail = own(makeTrimRail({ width: room.width, depth: room.depth, y: 1.02 }));
  group.add(rail.mesh);

  const strips = own(makeCeilingStrips({
    width: room.width,
    depth: room.depth,
    y: room.height - 0.34,
    intensity: settings.stripIntensity,
  }));
  group.add(strips.mesh);

  // ----- panels ------------------------------------------------------------

  const bank = own(makePanelBank({
    wallZ: -room.depth / 2,
    eyeHeight: room.eyeHeight,
    screenIntensity: settings.screenIntensity,
  }));
  group.add(bank.group);

  // ----- door --------------------------------------------------------------

  const door = own(makeSealedDoor({}));
  door.group.position.set(0, 0, room.depth / 2 - 0.09);
  group.add(door.group);

  // ----- ceiling core ------------------------------------------------------
  // Slowly rotating, directly overhead. Deliberately small: it sits ~1.5m above
  // eye level, so a ring that reads as modest in plan fills half the view when
  // you actually look up.

  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x122032,
    emissive: 0x5ef2d0,
    emissiveIntensity: 0.95,
    roughness: 0.35,
    metalness: 0.6,
  });

  const ringGeometry = new THREE.TorusGeometry(0.34, 0.026, 8, 32);
  const innerGeometry = new THREE.OctahedronGeometry(0.13, 0);

  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, room.height - 0.22, 0);
  group.add(coreGroup);

  const ring = new THREE.Mesh(ringGeometry, coreMaterial);
  ring.rotation.x = Math.PI / 2;
  coreGroup.add(ring);

  const innerCore = new THREE.Mesh(innerGeometry, coreMaterial);
  coreGroup.add(innerCore);

  own({
    dispose() {
      ringGeometry.dispose();
      innerGeometry.dispose();
      coreMaterial.dispose();
    },
  });

  // ----- accent lights -----------------------------------------------------

  const panelWash = new THREE.PointLight(0x5ef2d0, 0, 11, 2);
  panelWash.position.set(0, room.eyeHeight + 0.5, -room.depth / 2 + 1.7);
  group.add(panelWash);

  const doorWash = new THREE.PointLight(0xffb35c, 0, 9, 2);
  doorWash.position.set(0, 1.7, room.depth / 2 - 1.5);
  group.add(doorWash);

  // ----- dust --------------------------------------------------------------

  let motes = makeMotes({
    count: settings.motes,
    room,
    eyeHeight: room.eyeHeight,
    opacity: settings.moteOpacity,
  });
  group.add(motes);

  // ----- tier --------------------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name] || TIERS.low;

    strips.material.emissiveIntensity = settings.stripIntensity;
    panelWash.intensity = 14 * settings.accentStrength;
    doorWash.intensity = 7 * settings.accentStrength;

    bank.setScreenIntensity(settings.screenIntensity);
    bank.setShadows(settings.shadows);
    door.frame.castShadow = settings.shadows;

    group.remove(motes);
    motes.geometry.dispose();
    motes.material.dispose();
    motes = makeMotes({
      count: settings.motes,
      room,
      eyeHeight: room.eyeHeight,
      opacity: settings.moteOpacity,
    });
    group.add(motes);
  }

  // ----- animation ---------------------------------------------------------

  /**
   * @param {number} elapsed seconds since the RUN began (shared by every client
   *   in the session - not time since this player's engine mounted).
   * @param {number} dt seconds since the previous frame.
   * @param {{reducedMotion: boolean}} flags
   */
  function update(elapsed, dt, flags = {}) {
    coreGroup.rotation.y += dt * 0.32;
    innerCore.rotation.x += dt * 0.5;
    innerCore.rotation.z += dt * 0.22;
    coreMaterial.emissiveIntensity = 0.9 + Math.sin(elapsed * 1.1) * 0.22;

    // Rotating the whole cloud is what makes the dust drift, so per-point cost
    // stays at zero no matter how many points High turns on.
    motes.rotation.y += dt * 0.012;

    for (let i = 0; i < bank.panels.length; i += 1) {
      const panel = bank.panels[i];
      // Offset each panel's phase so the three do not breathe in lockstep,
      // which reads as a repeating loop rather than idling equipment.
      const wave = Math.sin(elapsed * 0.9 + i * 2.1);
      panel.screenMaterial.emissiveIntensity =
        settings.screenIntensity * (0.9 + wave * 0.1) + panel.glowBoost;
      panel.pipMaterial.emissiveIntensity = 1.7 + Math.sin(elapsed * 2.4 + i * 1.7) * 0.8;
    }

    door.pulse(elapsed);
  }

  function dispose() {
    motes.geometry.dispose();
    motes.material.dispose();
    for (const part of parts) part.dispose?.();
    for (const texture of textures) disposeTexture(texture);
  }

  return {
    id: 'room-one',
    group,
    panels: bank.panels,
    update,
    applyTier,
    dispose,
  };
}
