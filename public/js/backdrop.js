// Lobby backdrop - the 3D layer behind the HUD.
//
// A keystone is the wedge at the crown of an arch: pull it out and the whole
// arch collapses. That is the game's thesis as a physical object, so the
// backdrop is an arch of six voussoirs - one per crew slot - and a segment
// locks and lights only when a real player occupies that seat. An empty room
// shows a visibly incomplete arch.
//
// Budget discipline (PRD 4): 6 wedge meshes + 6 edge overlays + 1 Points cloud.
// Around 13 draw calls, no post-processing, no shadows, no per-particle CPU
// work - the dust drifts by rotating one cloud rather than moving 600 points.
//
// This module never touches game state. It exposes setCrew() so the HUD can
// tell it how many seats are filled, and that is the entire coupling.

import * as THREE from 'three';
import { getTier, setTier, hasUserChoice, subscribe, revealToggle } from './graphics.js';

const SEGMENTS = 6; // matches MAX_PLAYERS - one voussoir per crew slot

const PALETTE = {
  holo: 0x5ef2d0,
  holoDeep: 0x1f7f6d,
  rose: 0xff6b9d,
  hull: 0x16203a,
  void: 0x070b14,
};

// Brightness here is set by one rule: the arch is scenery, and HUD text has to
// stay readable on top of it. An earlier pass ran the locked stones near full
// opacity and it washed out the button labels and the manifest rows sitting in
// front of them. Locked-vs-idle contrast is what carries the meaning, not
// absolute brightness, so the whole range sits low.
const TIERS = {
  low: {
    label: 'LOW',
    motes: 220,
    pixelRatioCap: 1.5,
    toneMapping: THREE.NoToneMapping,
    lockedEmissive: 1.15,
    idleEmissive: 0.07,
    lockedOpacity: 0.6,
    idleOpacity: 0.26,
    lockedEdge: 0.7,
    idleEdge: 0.2,
    moteOpacity: 0.55,
    moteSize: 0.042,
  },
  high: {
    label: 'HIGH',
    motes: 750,
    pixelRatioCap: 2,
    // ACES is the cinematic grade called for at High. It is a per-pixel curve
    // in the existing shader, not an extra full-screen pass, so it is cheap.
    toneMapping: THREE.ACESFilmicToneMapping,
    lockedEmissive: 1.6,
    idleEmissive: 0.1,
    lockedOpacity: 0.68,
    idleOpacity: 0.3,
    lockedEdge: 0.85,
    idleEdge: 0.26,
    moteOpacity: 0.72,
    moteSize: 0.05,
  },
};

/**
 * Build one voussoir: the trapezoid stone of an arch, as a ring sector with
 * real extruded depth so it reads as a solid object under raking light.
 */
function voussoirGeometry(innerR, outerR, thetaStart, thetaLength) {
  const shape = new THREE.Shape();
  const t1 = thetaStart + thetaLength;

  shape.moveTo(Math.cos(thetaStart) * outerR, Math.sin(thetaStart) * outerR);
  shape.absarc(0, 0, outerR, thetaStart, t1, false);
  shape.lineTo(Math.cos(t1) * innerR, Math.sin(t1) * innerR);
  shape.absarc(0, 0, innerR, t1, thetaStart, true);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 10,
  });

  geometry.translate(0, 0, -0.21);
  return geometry;
}

function makeMotes(count, spread, settings) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    // Rejection-free spherical shell: dust hangs around the arch rather than
    // filling a box, so it never clusters visibly in the corners.
    const r = spread * (0.45 + Math.random() * 0.55);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: PALETTE.holo,
    size: settings.moteSize,
    sizeAttenuation: true,
    transparent: true,
    opacity: settings.moteOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

export function createBackdrop(canvas) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    return null; // no WebGL at all - the CSS layer carries the look on its own
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  // The tier itself lives in graphics.js so the room engine and the status bar
  // toggle all agree on one value. This module only reacts to it.
  let settings = TIERS[getTier()];

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 0, 9.4);
  let baseZ = 9.4;
  let dollyOffset = 0;

  // Lighting is deliberately flat and cheap: no shadow maps anywhere. There is
  // nothing in this scene for a shadow to fall on, so a shadow map would be
  // pure cost. The real Low/High shadow rig belongs with the playable room.
  scene.add(new THREE.AmbientLight(0x223a52, 2.1));

  const keyLight = new THREE.PointLight(PALETTE.holo, 55, 40);
  keyLight.position.set(4.5, 3.5, 6);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(PALETTE.rose, 26, 40);
  rimLight.position.set(-5.5, -3, 3.5);
  scene.add(rimLight);

  // ----- the arch -----------------------------------------------------------

  const arch = new THREE.Group();
  arch.rotation.x = -0.34;
  // Sized to sit inside the gap between the HUD panels rather than spanning the
  // whole viewport. At full scale the ring read as the subject of the screen,
  // which is the manifest's job.
  arch.scale.setScalar(0.86);
  scene.add(arch);

  const gap = 0.14;
  const sweep = (Math.PI * 2) / SEGMENTS;
  const geometry = voussoirGeometry(2.28, 3.08, -sweep / 2 + gap / 2, sweep - gap);

  const stones = [];

  for (let i = 0; i < SEGMENTS; i += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: PALETTE.hull,
      emissive: PALETTE.holo,
      emissiveIntensity: settings.idleEmissive,
      roughness: 0.42,
      metalness: 0.55,
      transparent: true,
      opacity: settings.idleOpacity,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.z = i * sweep;

    // Glowing edges are what sells "holographic" without a bloom pass.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({
        color: PALETTE.holo,
        transparent: true,
        opacity: settings.idleEdge,
      }),
    );
    mesh.add(edges);

    arch.add(mesh);
    stones.push({
      mesh,
      material,
      edgeMaterial: edges.material,
      locked: false,
      // Current animated values, lerped toward targets each frame.
      glow: settings.idleEmissive,
      fill: settings.idleOpacity,
      edge: settings.idleEdge,
    });
  }

  // ----- dust ---------------------------------------------------------------

  let motes = makeMotes(settings.motes, 7.2, settings);
  scene.add(motes);

  // ----- tier switching -----------------------------------------------------

  function applyTier(name) {
    settings = TIERS[name];

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap));
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = name === 'high' ? 1.05 : 1;

    scene.remove(motes);
    motes.geometry.dispose();
    motes.material.dispose();
    motes = makeMotes(settings.motes, 7.2, settings);
    scene.add(motes);

    for (const stone of stones) {
      stone.material.needsUpdate = true;
    }
  }

  const unsubscribeTier = subscribe(applyTier);

  // ----- sizing -------------------------------------------------------------

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;

    // On a narrow window the arch would crop; pull the camera back so it always
    // reads as a complete ring.
    baseZ = w / h < 0.95 ? 12.6 : 9.4;
    camera.position.z = baseZ + dollyOffset;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });

  // ----- crew state ---------------------------------------------------------

  let filled = 0;

  function setCrew(count) {
    filled = Math.max(0, Math.min(SEGMENTS, Number(count) || 0));
    stones.forEach((stone, i) => {
      stone.locked = i < filled;
    });
  }

  // ----- pointer parallax ---------------------------------------------------

  const pointer = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };

  if (!reducedMotion) {
    window.addEventListener(
      'pointermove',
      (event) => {
        pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true },
    );
  }

  // ----- loop ---------------------------------------------------------------

  const clock = new THREE.Clock();
  let frameHandle = 0;

  // Two independent reasons to stop drawing, tracked separately. Collapsing
  // them into one flag means returning to a hidden tab resumes the backdrop
  // even when the room engine has taken over the screen.
  let visible = !document.hidden;
  let paused = false;
  const shouldRender = () => visible && !paused;

  // One-time FPS probe. Only ever promotes Low -> High, never the reverse, and
  // never overrides a choice the player made themselves. It runs here rather
  // than in the engine because the lobby is what loads first, so by the time a
  // room opens the decision has already been made and paid for.
  let probeFrames = 0;
  let probeTime = 0;
  let probeDone = hasUserChoice();

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function frame() {
    frameHandle = requestAnimationFrame(frame);
    if (!shouldRender()) return;

    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    if (!probeDone) {
      probeFrames += 1;
      probeTime += dt;
      // Ignore the first half-second of warm-up, then judge over ~1.5s.
      if (probeTime > 2) {
        const fps = probeFrames / probeTime;
        probeDone = true;
        // fromUser: false - an automatic promotion must not persist, or the
        // machine's mood on one page load would silently become a permanent
        // setting the player never chose.
        if (fps >= 52 && renderer.capabilities.isWebGL2) {
          setTier('high', { fromUser: false });
        }
      }
    }

    if (!reducedMotion) {
      pointer.x = lerp(pointer.x, pointerTarget.x, 1 - Math.pow(0.002, dt));
      pointer.y = lerp(pointer.y, pointerTarget.y, 1 - Math.pow(0.002, dt));

      // In-plane spin keeps the ring permanently side-on to the camera, so it
      // never rotates edge-on and vanishes the way a Y-axis spin would.
      arch.rotation.z += dt * 0.075;
      arch.rotation.x = -0.34 + Math.sin(t * 0.32) * 0.05 - pointer.y * 0.14;
      arch.rotation.y = Math.sin(t * 0.21) * 0.07 + pointer.x * 0.18;
      arch.position.y = Math.sin(t * 0.5) * 0.09;

      motes.rotation.y += dt * 0.018;
      motes.rotation.x += dt * 0.006;

      keyLight.position.x = 4.5 + Math.sin(t * 0.4) * 1.2;
      keyLight.position.y = 3.5 + Math.cos(t * 0.33) * 0.9;
    }

    // Ease each stone toward its target look. Lerping rather than snapping is
    // what makes a seat filling feel like the arch locking together.
    for (const stone of stones) {
      const targetGlow = stone.locked
        ? settings.lockedEmissive * (0.86 + Math.sin(t * 1.6) * 0.14)
        : settings.idleEmissive;
      const targetFill = stone.locked ? settings.lockedOpacity : settings.idleOpacity;
      const targetEdge = stone.locked ? settings.lockedEdge : settings.idleEdge;

      const ease = 1 - Math.pow(0.02, dt);
      stone.glow = lerp(stone.glow, targetGlow, ease);
      stone.fill = lerp(stone.fill, targetFill, ease);
      stone.edge = lerp(stone.edge, targetEdge, ease);

      stone.material.emissiveIntensity = stone.glow;
      stone.material.opacity = stone.fill;
      stone.edgeMaterial.opacity = stone.edge;
    }

    renderer.render(scene, camera);
  }

  frame();

  // Stop rendering entirely when the tab is hidden. A lobby left open in a
  // background tab should not burn battery on a school laptop.
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (shouldRender()) clock.getDelta(); // discard the gap so nothing jumps
  });

  // ----- public surface -----------------------------------------------------

  return {
    setCrew,
    getTier,

    /**
     * Push the arch camera in or out along Z.
     *
     * The entry sequence uses this for a real dolly rather than a CSS scale on
     * the canvas: scaling the canvas resamples an already-rendered frame and
     * reads as a zoom on a picture, while moving the camera changes the
     * parallax between the arch and the star field behind it, which is what
     * makes it feel like moving THROUGH something.
     *
     * @param {number} offset metres toward the arch; positive pulls back.
     */
    dolly(offset) {
      dollyOffset = offset;
      camera.position.z = baseZ + dollyOffset;
    },

    /**
     * Stop rendering without tearing anything down. Called when the room engine
     * takes over the screen: two WebGL contexts drawing at once would double
     * the GPU cost for a scene nobody can see.
     */
    pause() {
      paused = true;
    },

    resume() {
      if (!paused) return;
      paused = false;
      clock.getDelta(); // drop the paused interval so nothing jumps
    },

    dispose() {
      cancelAnimationFrame(frameHandle);
      unsubscribeTier();
      window.removeEventListener('resize', resize);
      geometry.dispose();
      motes.geometry.dispose();
      motes.material.dispose();
      for (const stone of stones) {
        stone.material.dispose();
        stone.edgeMaterial.dispose();
      }
      renderer.dispose();
    },
  };
}
