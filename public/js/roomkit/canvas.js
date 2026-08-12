// roomkit/canvas.js - shared canvas and texture helpers.
//
// Every surface in this game is drawn into an HTML canvas at runtime. No image
// files anywhere. That is a deliberate constraint: the game has to work on a
// locked-down school network that may block CDNs, and a 512px canvas costs less
// than the HTTP request an image would need.
//
// These were originally written inline in scenes.js. They are extracted here
// because six rooms need them, and six copies guarantees one drifts.

import * as THREE from 'three';

export function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Wrap a canvas as a texture.
 *
 * `repeat` accepts a number for uniform tiling or [x, y] for anisotropic
 * tiling - a tall wall wants more vertical repeats than a square floor, and
 * forcing a single number there was distorting the plating on non-square
 * surfaces.
 *
 * Pass `keepCanvas: true` only if the canvas will be redrawn later (a live
 * readout). Otherwise the backing store is released, because CanvasTexture holds
 * a reference to the element and six rooms' worth of retained canvases is ~92MB
 * of CPU memory on top of the GPU copy.
 */
export function toTexture(canvas, { repeat = 1, anisotropy = 4, keepCanvas = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  if (rx !== 1 || ry !== 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(rx, ry);
  }

  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;

  // Marker read by disposeTexture. Not a Three.js field.
  texture.userData.keepCanvas = keepCanvas;
  return texture;
}

/**
 * Dispose a texture and drop its canvas backing store.
 *
 * Three's texture.dispose() frees the GPU copy but leaves the HTMLCanvasElement
 * alive as long as the texture object is reachable. Shrinking it to 1x1 first
 * releases the pixel buffer immediately rather than waiting on GC.
 */
export function disposeTexture(texture) {
  if (!texture) return;
  const canvas = texture.image;
  texture.dispose();
  if (canvas && !texture.userData?.keepCanvas && typeof canvas.width === 'number') {
    canvas.width = 1;
    canvas.height = 1;
  }
}

/**
 * Deterministic pseudo-random. Three rooms independently need determinism so
 * every client generates an identical room from a server seed, and it must be
 * the SAME generator everywhere or two rooms disagree about what deterministic
 * means. Mulberry32: small, fast, good enough for surface detail.
 */
export function lcg(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canvas has no reliable letter-spacing across browsers, so space the glyphs by
 * hand. Everything in this game's UI is uppercase mono at wide tracking.
 *
 * Returns the total width drawn, so callers can size a plate around it.
 */
export function drawTrackedText(ctx, text, centreX, y, tracking) {
  const chars = [...text];
  let total = 0;
  for (const char of chars) total += ctx.measureText(char).width + tracking;
  total -= tracking;

  let x = centreX - total / 2;
  for (const char of chars) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + tracking;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Grime kit
//
// Four room specs described these in near-identical prose. They are the
// difference between six rooms that look like one game and six that look like
// six people's homework. All take a ctx and mutate it in place.
// ---------------------------------------------------------------------------

/** Rows of rivet heads: a dark bore with a light top-left catch. */
export function rivetPass(ctx, { width, height, spacing = 64, radius = 3, inset = 0, alpha = 0.22 }) {
  for (let y = inset; y <= height - inset; y += spacing) {
    for (let x = inset; x <= width - inset; x += spacing) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(210,235,255,${alpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(x - radius * 0.28, y - radius * 0.28, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Fine speckle. Seeded so a surface looks identical on every client. */
export function grainPass(ctx, { width, height, count = 2000, seed = 1, alpha = 0.06, size = 1.6 }) {
  const rand = lcg(seed);
  for (let i = 0; i < count; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
    ctx.fillRect(x, y, size, size);
  }
}

/** Vertical weep streaks below a feature line. Reads as age and damp. */
export function streakPass(ctx, { width, height, count = 18, seed = 7, alpha = 0.05, from = 0 }) {
  const rand = lcg(seed);
  for (let i = 0; i < count; i += 1) {
    const x = rand() * width;
    const w = 2 + rand() * 9;
    const start = from + rand() * (height - from) * 0.35;
    const len = (height - start) * (0.35 + rand() * 0.6);

    const gradient = ctx.createLinearGradient(0, start, 0, start + len);
    gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, start, w, len);
  }
}

/** Horizontal scan lines. Screens only - never architecture. */
export function scanlinePass(ctx, { width, height, step = 4, thickness = 2, alpha = 0.16 }) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < height; y += step) ctx.fillRect(0, y, width, thickness);
}

/**
 * A bevelled rectangle: light top-left, dark bottom-right.
 *
 * This is baked lighting in the albedo. It replaces real light sources and
 * costs nothing at runtime, which is the single highest-leverage trick in the
 * whole design. Pass `lightFromBelow` for rooms lit from the floor, where a
 * top-lit bevel would read as wrong.
 */
export function bevelRect(ctx, { x, y, width, height, depth = 3, alpha = 0.3, lightFromBelow = false }) {
  const lit = `rgba(220,240,255,${alpha})`;
  const shade = `rgba(0,0,0,${alpha * 1.2})`;

  ctx.fillStyle = lightFromBelow ? shade : lit;
  ctx.fillRect(x, y, width, depth);
  ctx.fillRect(x, y, depth, height);

  ctx.fillStyle = lightFromBelow ? lit : shade;
  ctx.fillRect(x, y + height - depth, width, depth);
  ctx.fillRect(x + width - depth, y, depth, height);
}

// ---------------------------------------------------------------------------
// Shared singletons
// ---------------------------------------------------------------------------

let moteSprite = null;

/**
 * Soft round dot for dust. THREE.Points with no map renders hard squares, which
 * is invisible at low density and unmistakably wrong at High.
 *
 * A true module-level singleton: six rooms each building and destroying an
 * identical 64px gradient is pure waste. Never disposed per-room.
 */
export function getMoteSprite() {
  if (moteSprite) return moteSprite;

  const size = 64;
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  moteSprite = toTexture(canvas, { keepCanvas: true });
  return moteSprite;
}

/**
 * A panel's idle screen. All six rooms use this; only the strings and accent
 * differ. Owned here so phase 4 cannot end up with six subtly different screens.
 */
export function makeScreenTexture({ title, status, footer = 'STANDBY', accentCss }) {
  const width = 512;
  const height = 346;
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#111d2c');
  gradient.addColorStop(1, '#0a121d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Accent wash from the top, so the screen looks lit by its own header.
  const wash = ctx.createLinearGradient(0, 0, 0, height * 0.7);
  wash.addColorStop(0, `${accentCss}22`);
  wash.addColorStop(1, 'transparent');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = accentCss;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, width - 28, height - 28);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = accentCss;
  ctx.lineWidth = 5;
  const tick = 34;
  const corners = [
    [14, 14, 1, 1],
    [width - 14, 14, -1, 1],
    [14, height - 14, 1, -1],
    [width - 14, height - 14, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + tick * sx, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + tick * sy);
    ctx.stroke();
  }

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  ctx.fillStyle = accentCss;
  ctx.font = '600 40px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, title, width / 2, height / 2 - 26, 6);

  ctx.fillStyle = 'rgba(190,215,230,0.55)';
  ctx.font = '400 21px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, status, width / 2, height / 2 + 24, 5);

  ctx.fillStyle = 'rgba(190,215,230,0.3)';
  ctx.font = '400 17px "IBM Plex Mono", ui-monospace, monospace';
  drawTrackedText(ctx, footer, width / 2, height - 52, 4);

  scanlinePass(ctx, { width, height });

  return toTexture(canvas);
}
