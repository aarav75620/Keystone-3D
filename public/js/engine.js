// engine.js - the 3D core.
//
// Owns the renderer, the camera, the look controls, the render loop and the
// global lighting rig. It knows nothing about any particular room: rooms are
// built by scenes.js and handed here via mount().
//
// Camera position is a constant, not a variable. The PRD fixes the player at
// room centre - there is no movement system and nothing here should grow one.

import * as THREE from 'three';
import { getTier, subscribe, revealToggle } from './graphics.js';

// Metres. Rooms are built against these numbers, so scenes.js reads them from
// engine.dimensions rather than restating them.
const ROOM = { width: 8.4, depth: 8.4, height: 3.4 };
const EYE_HEIGHT = 1.62;

// Radians of camera rotation per pixel dragged.
const LOOK_SENSITIVITY = 0.0026;
const KEY_LOOK_STEP = 0.045;

// Movement. Added at Aarav's request on 20 Jul, deliberately overriding the
// PRD's fixed-camera rule - that was a scope decision, not a design one, and
// the project owner changed it. Walking speed is deliberately modest: these
// are small rooms and the game is about reading them, not traversing them.
const MOVE_SPEED = 2.1;
const SPRINT_MULTIPLIER = 1.8;
// The player is a circle on the floor plan. No jumping, no crouching - eye
// height stays fixed, which also keeps every readability decision made for the
// fixed camera valid at any position in the room.
const PLAYER_RADIUS = 0.32;
const WALL_MARGIN = PLAYER_RADIUS + 0.06;

// Stop just short of straight up/down. Reaching the pole makes the horizon
// spin, which is disorienting and serves no purpose in a room like this.
const PITCH_LIMIT = THREE.MathUtils.degToRad(85);

const TIERS = {
  low: {
    pixelRatioCap: 1.5,
    toneMapping: THREE.NoToneMapping,
    exposure: 1,
    shadows: false,
    shadowMapSize: 512,
  },
  high: {
    pixelRatioCap: 2,
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.08,
    shadows: true,
    shadowMapSize: 1024,
  },
};

export function createEngine(canvas) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x0a1220, 1);

  // Declared before applyTier runs during setup - it calls invalidateSize, and
  // these would be in the temporal dead zone if declared further down.
  let lastWidth = 0;
  let lastHeight = 0;

  const scene = new THREE.Scene();
  // Starts beyond the far corners (about 5.9m from the centre) so the fog reads
  // as atmosphere on the dust rather than the walls fading to black.
  scene.fog = new THREE.Fog(0x121b2b, 9, 26);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 60);
  camera.position.set(0, EYE_HEIGHT, 0);
  // YXZ applies yaw before pitch, which keeps the horizon level. The default
  // XYZ order rolls the camera as you look around.
  camera.rotation.order = 'YXZ';

  // -------------------------------------------------------------------------
  // Global lighting
  //
  // Ambient plus one shadow-casting key. Room-specific accent lights belong to
  // the room and live in scenes.js. A single shadow caster is the whole
  // High-tier shadow budget on purpose: each additional caster is another full
  // render of the scene from that light's point of view.
  // -------------------------------------------------------------------------

  const ambient = new THREE.AmbientLight(0x5b7ba6, 2.1);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xd6f0ff, 1.9);
  keyLight.name = 'engineKey';
  keyLight.position.set(2.6, ROOM.height + 2.4, 3.2);
  keyLight.target.position.set(0, 1, -ROOM.depth / 2);
  keyLight.shadow.camera.left = -ROOM.width / 2 - 1;
  keyLight.shadow.camera.right = ROOM.width / 2 + 1;
  keyLight.shadow.camera.top = ROOM.depth / 2 + 1;
  keyLight.shadow.camera.bottom = -ROOM.depth / 2 - 1;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 18;
  keyLight.shadow.bias = -0.0012;
  scene.add(keyLight);
  scene.add(keyLight.target);

  // -------------------------------------------------------------------------
  // Mounted room
  // -------------------------------------------------------------------------

  /** @type {{group: THREE.Object3D, update?: Function, applyTier?: Function, dispose?: Function} | null} */
  let mounted = null;

  /**
   * The global lighting rig is tuned for a lit, sealed, standard-sized room.
   * Several rooms are none of those - one is on backup power with every ceiling
   * fixture dead, one is lit entirely from below, one is open to the sky. For
   * those, a 2.1-intensity ambient does not merely look wrong, it actively
   * contradicts the room's whole concept while still costing full per-fragment
   * shading.
   *
   * So a room may declare an `environment`. Every field is optional and every
   * default is exactly the previous hard-coded value, so a room that declares
   * nothing renders identically to before this existed. Restored on unmount, so
   * one room can never leak its lighting into the next.
   */
  const DEFAULT_ENV = {
    ambientColour: 0x5b7ba6,
    ambientIntensity: 2.1,
    keyColour: 0xd6f0ff,
    keyIntensity: 1.9,
    keyEnabled: true,
    keyPosition: [2.6, ROOM.height + 2.4, 3.2],
    keyTarget: [0, 1, -ROOM.depth / 2],
    fogColour: 0x121b2b,
    fogNear: 9,
    fogFar: 26,
    clearColour: 0x0a1220,
    // 60m is ample for a sealed interior and keeps depth precision tight. A room
    // that opens onto a landscape legitimately needs further - the Spire looks
    // at towers and a horizon tens of metres out, and at 60m they are silently
    // clipped away, which reads as "the sky did not render" rather than as a
    // clipping plane. Rooms that do not ask keep the tighter default.
    cameraFar: 60,
  };

  function applyEnvironment(env) {
    const e = { ...DEFAULT_ENV, ...(env || {}) };

    ambient.color.setHex(e.ambientColour);
    ambient.intensity = e.ambientIntensity;

    keyLight.color.setHex(e.keyColour);
    keyLight.visible = e.keyEnabled;
    // Intensity is zeroed as well as hidden. A hidden light still participates
    // in the material's light-count uniform on some drivers, and a room that
    // suppressed the key should not pay for it.
    keyLight.intensity = e.keyEnabled ? e.keyIntensity : 0;
    keyLight.position.set(...e.keyPosition);
    keyLight.target.position.set(...e.keyTarget);
    keyLight.target.updateMatrixWorld();

    scene.fog.color.setHex(e.fogColour);
    scene.fog.near = e.fogNear;
    scene.fog.far = e.fogFar;

    if (camera.far !== e.cameraFar) {
      camera.far = e.cameraFar;
      camera.updateProjectionMatrix();
    }

    renderer.setClearColor(e.clearColour, 1);
  }

  /** Fit the shadow frustum to a room that is not the standard box. */
  function fitShadowFrustum(dims) {
    const d = dims || ROOM;
    keyLight.shadow.camera.left = -d.width / 2 - 1;
    keyLight.shadow.camera.right = d.width / 2 + 1;
    keyLight.shadow.camera.top = d.depth / 2 + 1;
    keyLight.shadow.camera.bottom = -d.depth / 2 - 1;
    keyLight.shadow.camera.far = d.height + 14;
    keyLight.shadow.camera.updateProjectionMatrix();
  }

  // Collision state for the mounted room. The engine always keeps the player
  // inside the walls; rooms add furniture via `colliders` (solid boxes) and,
  // for circular rooms, `keepInsideRadius`.
  let bounds = { hw: ROOM.width / 2 - WALL_MARGIN, hd: ROOM.depth / 2 - WALL_MARGIN };
  let colliders = [];
  let insideRadius = 0;

  function unmount() {
    if (!mounted) return;
    scene.remove(mounted.group);
    mounted.dispose?.();
    mounted = null;
    applyEnvironment(null);
    fitShadowFrustum(null);
    bounds = { hw: ROOM.width / 2 - WALL_MARGIN, hd: ROOM.depth / 2 - WALL_MARGIN };
    colliders = [];
    insideRadius = 0;
  }

  function mount(room) {
    unmount();
    mounted = room;
    scene.add(room.group);
    applyEnvironment(room.environment);
    fitShadowFrustum(room.dimensions);

    const dims = room.dimensions || ROOM;
    bounds = { hw: dims.width / 2 - WALL_MARGIN, hd: dims.depth / 2 - WALL_MARGIN };
    colliders = room.colliders || [];
    insideRadius = room.keepInsideRadius || 0;

    // Spawn at room centre, at this room's eye height, facing the panels.
    camera.position.set(0, dims.eyeHeight ?? EYE_HEIGHT, 0);

    room.applyTier?.(getTier());
  }

  // -------------------------------------------------------------------------
  // Tier application
  // -------------------------------------------------------------------------

  function applyTier(name) {
    const settings = TIERS[name];

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap));
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = settings.exposure;
    // The pixel-ratio cap differs per tier, so the drawing buffer has to be
    // rebuilt even though the CSS size has not changed.
    invalidateSize();

    renderer.shadowMap.enabled = settings.shadows;
    if (settings.shadows) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      keyLight.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      if (keyLight.shadow.map) {
        keyLight.shadow.map.dispose();
        keyLight.shadow.map = null;
      }
    }
    keyLight.castShadow = settings.shadows;

    mounted?.applyTier?.(name);
  }

  const unsubscribeTier = subscribe(applyTier);

  // -------------------------------------------------------------------------
  // Look controls - drag to look, no movement
  //
  // Deliberately not pointer lock. Phase 4 needs the cursor for clicking panels
  // and typing into the clue board overlay, and a locked pointer would have to
  // be released and recaptured around every interaction.
  // -------------------------------------------------------------------------

  let yaw = 0;
  let pitch = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hasLooked = false;
  let dragDistance = 0;

  const lookListeners = new Set();

  function notifyFirstLook() {
    if (hasLooked) return;
    hasLooked = true;
    for (const fn of lookListeners) fn();
  }

  function applyLook() {
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  // ----- focus: raycasting and the framing tween ---------------------------
  //
  // Clicking a panel swings the camera to face it and hands control to the HUD.
  // Framing is computed from where the player is STANDING at click time, not
  // from the room's stored focusYaw/focusPitch - those were measured from room
  // centre back when the camera could not move, and are wrong everywhere else.

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const focusTarget = new THREE.Vector3();

  let focus = null; // {fromYaw, fromPitch, toYaw, toPitch, t, duration, panel}
  let focusedPanel = null;

  /**
   * Which panel is under a point on screen.
   * @param {number} nx normalised device x, -1..1
   * @param {number} ny normalised device y, -1..1
   */
  function pickPanel(nx, ny) {
    if (!mounted?.panels?.length) return null;
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, camera);

    const screens = mounted.panels.map((p) => p.screen);
    const hits = raycaster.intersectObjects(screens, false);
    if (!hits.length) return null;

    const id = hits[0].object.userData.panelId;
    return mounted.panels.find((p) => p.id === id) || null;
  }

  /** Shortest signed angular difference, so a tween never takes the long way. */
  function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * Swing the camera to face a panel. Rotation only - the player does not walk
   * to it, because being teleported across a room you are standing in is far
   * more disorienting than simply turning to look.
   */
  function focusPanel(panel, { duration = 0.55 } = {}) {
    if (!panel) return;

    panel.screen.getWorldPosition(focusTarget);
    const dx = focusTarget.x - camera.position.x;
    const dy = focusTarget.y - camera.position.y;
    const dz = focusTarget.z - camera.position.z;

    const toYaw = Math.atan2(-dx, -dz);
    const toPitch = Math.atan2(dy, Math.hypot(dx, dz));

    focusedPanel = panel;
    focus = {
      fromYaw: yaw,
      fromPitch: pitch,
      deltaYaw: shortestAngle(yaw, toYaw),
      deltaPitch: toPitch - pitch,
      t: 0,
      duration: Math.max(0.001, duration),
    };
  }

  function releaseFocus() {
    focus = null;
    focusedPanel = null;
  }

  function stepFocus(dt) {
    if (!focus) return;
    focus.t = Math.min(focus.duration, focus.t + dt);
    const k = focus.t / focus.duration;
    // Ease-in-out: starts and stops gently, so it reads as the player turning
    // their head rather than the camera being snapped by the game.
    const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;

    yaw = focus.fromYaw + focus.deltaYaw * e;
    pitch = focus.fromPitch + focus.deltaPitch * e;
    applyLook();

    if (focus.t >= focus.duration) focus = null;
  }

  // ----- pointer lock ("shift lock" - Aarav's request, Ctrl toggles) --------
  //
  // Drag-look keeps the cursor available for panels; pointer lock feels like a
  // real first-person game. The toggle gives both: Ctrl locks the mouse into
  // free-look, Ctrl again (or Esc - browser-enforced, cannot be overridden)
  // releases it for clicking. Phase 4 treats a click while locked as "interact
  // with whatever the reticle is on", which is why the reticle brightens.

  let pointerLocked = false;

  function togglePointerLock() {
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
      return;
    }
    // Chrome returns a promise that rejects on the Esc cooldown (~1.5s after an
    // Esc exit) or without user activation. A refused lock just leaves
    // drag-look working, so log it rather than surfacing an error.
    const result = canvas.requestPointerLock?.();
    result?.catch?.((error) => {
      console.warn('[keystone] pointer lock refused:', error?.message || error);
    });
  }

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === canvas;
    canvas.classList.toggle('is-locked', pointerLocked);
    // Entering lock mid-drag would leave a stale drag that never ends.
    if (pointerLocked && dragging) {
      dragging = false;
      canvas.classList.remove('is-dragging');
    }
  }

  function onPointerLockError() {
    console.warn('[keystone] pointer lock failed - drag-look still works');
  }

  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('pointerlockerror', onPointerLockError);

  function onPointerDown(event) {
    if (event.button !== 0) return;
    // While locked there is nothing to drag - the mouse already steers the
    // camera, and clicks are reserved for phase 4's reticle interaction.
    if (pointerLocked) return;
    dragging = true;
    dragDistance = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    // While a panel overlay is open the player is reading it, not steering.
    // Letting the camera drift behind an open overlay means closing it drops
    // them somewhere they never chose to be looking.
    if (focusedPanel) return;

    if (pointerLocked) {
      // movementX/Y, not client deltas: while locked the OS cursor does not
      // move, so clientX is frozen and only the relative motion is real.
      yaw -= event.movementX * LOOK_SENSITIVITY;
      pitch -= event.movementY * LOOK_SENSITIVITY;
      applyLook();
      notifyFirstLook();
      return;
    }

    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    dragDistance += Math.abs(dx) + Math.abs(dy);

    yaw -= dx * LOOK_SENSITIVITY;
    pitch -= dy * LOOK_SENSITIVITY;
    applyLook();
    notifyFirstLook();
  }

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    canvas.classList.remove('is-dragging');
  }

  // Arrow keys look too. A drag-only camera would be unusable for anyone who
  // cannot hold a button and move a pointer at the same time.
  function onKeyDown(event) {
    // Ctrl toggles pointer lock. `event.repeat` guards the auto-repeat that
    // fires while the key is held - without it, holding Ctrl flickers the lock
    // on and off every frame. Never fires while typing into a phase-4 overlay.
    if ((event.code === 'ControlLeft' || event.code === 'ControlRight')
        && !event.repeat && !isTypingTarget(event.target)) {
      event.preventDefault();
      togglePointerLock();
      return;
    }

    if (focusedPanel) return;

    const step = event.shiftKey ? KEY_LOOK_STEP * 2.4 : KEY_LOOK_STEP;
    let handled = true;

    switch (event.key) {
      case 'ArrowLeft': yaw += step; break;
      case 'ArrowRight': yaw -= step; break;
      case 'ArrowUp': pitch += step; break;
      case 'ArrowDown': pitch -= step; break;
      default: handled = false;
    }

    if (!handled) return;
    event.preventDefault();
    applyLook();
    notifyFirstLook();
  }

  // -------------------------------------------------------------------------
  // Movement - WASD, collision against walls and per-room colliders
  //
  // event.code is the PHYSICAL key position, so WASD here is automatically
  // ZQSD on an AZERTY keyboard with no aliasing needed. Arrow keys stay on
  // look (above): someone who cannot drag and hold at once still gets both
  // verbs, on opposite hands.
  // -------------------------------------------------------------------------

  const moveState = { f: false, b: false, l: false, r: false, sprint: false };

  // Phase 4 puts text inputs in overlays; WASD while typing a clue must not
  // walk the player around behind the panel.
  function isTypingTarget(target) {
    return Boolean(
      target
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
    );
  }

  function onMoveKey(event, down) {
    if (isTypingTarget(event.target)) return;
    // Walking away while reading a panel would leave the overlay open on a
    // panel the player is no longer anywhere near.
    if (focusedPanel) {
      onWindowBlur();
      return;
    }
    switch (event.code) {
      case 'KeyW': moveState.f = down; break;
      case 'KeyS': moveState.b = down; break;
      case 'KeyA': moveState.l = down; break;
      case 'KeyD': moveState.r = down; break;
      case 'ShiftLeft':
      case 'ShiftRight': moveState.sprint = down; break;
      default: return;
    }
    if (down) notifyFirstLook();
  }

  const onMoveKeyDown = (event) => onMoveKey(event, true);
  const onMoveKeyUp = (event) => onMoveKey(event, false);

  // Alt-tabbing away with W held would leave the player walking forever -
  // keyup never arrives once focus is gone.
  const onWindowBlur = () => {
    moveState.f = false;
    moveState.b = false;
    moveState.l = false;
    moveState.r = false;
    moveState.sprint = false;
  };

  /** Circle-vs-AABB against every solid collider in the room. */
  function blockedAt(x, z) {
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      const dx = Math.max(Math.abs(x - c.x) - c.hw, 0);
      const dz = Math.max(Math.abs(z - c.z) - c.hd, 0);
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    return false;
  }

  function stepMovement(dt) {
    const forward = (moveState.f ? 1 : 0) - (moveState.b ? 1 : 0);
    const strafe = (moveState.r ? 1 : 0) - (moveState.l ? 1 : 0);
    if (!forward && !strafe) return;

    // Normalise so diagonals are not 41% faster.
    const length = Math.hypot(forward, strafe);
    const speed = (MOVE_SPEED * (moveState.sprint ? SPRINT_MULTIPLIER : 1) * dt) / length;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    const nx = camera.position.x + (-sin * forward + cos * strafe) * speed;
    const nz = camera.position.z + (-cos * forward - sin * strafe) * speed;

    // Axis-separated resolution: try each axis alone, keep the axes that do
    // not collide. Rejecting one axis while accepting the other is what makes
    // the player SLIDE along a shelf instead of sticking to it.
    if (!blockedAt(nx, camera.position.z)) camera.position.x = nx;
    if (!blockedAt(camera.position.x, nz)) camera.position.z = nz;

    // The walls are absolute, whatever the colliders said.
    camera.position.x = Math.min(bounds.hw, Math.max(-bounds.hw, camera.position.x));
    camera.position.z = Math.min(bounds.hd, Math.max(-bounds.hd, camera.position.z));

    // Circular rooms (the Observatory's instrument pier) confine radially.
    if (insideRadius > 0) {
      const d = Math.hypot(camera.position.x, camera.position.z);
      if (d > insideRadius) {
        const k = insideRadius / d;
        camera.position.x *= k;
        camera.position.z *= k;
      }
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keydown', onMoveKeyDown);
  window.addEventListener('keyup', onMoveKeyUp);
  window.addEventListener('blur', onWindowBlur);

  applyLook();

  // -------------------------------------------------------------------------
  // Sizing
  //
  // Checked every frame against the canvas's laid-out size rather than measured
  // once from window.innerWidth. The engine can be created while the canvas is
  // still display:none, or while the page is hidden - a run starting in a
  // background tab does exactly that. Measuring once in that state yields 0x0
  // and the view stays broken until something happens to fire a resize event.
  // -------------------------------------------------------------------------

  function resizeIfNeeded() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (!w || !h) return false;
    if (w === lastWidth && h === lastHeight) return true;

    lastWidth = w;
    lastHeight = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    return true;
  }

  function invalidateSize() {
    lastWidth = 0;
    lastHeight = 0;
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  const clock = new THREE.Clock();
  let frameHandle = 0;
  let running = false;
  let manualElapsed = 0; // clock for step(), see below

  // ----- the run clock ------------------------------------------------------
  //
  // Rooms are animated from a RUN clock, not from time-since-mount.
  //
  // The puzzles are read off moving geometry, so two players standing in the
  // same chamber must see the identical arrangement at the identical instant.
  // A per-client accumulator cannot do that: it starts at zero whenever that
  // player's engine happened to mount, so a player who joined thirty seconds
  // late would watch a different part of the cycle and read a different answer.
  //
  // The server sends the run's start timestamp; every client derives its own
  // offset from it once. No continuous sync, no packets per frame - just one
  // number, and from then on everyone's arithmetic agrees.
  let runEpoch = 0;

  /** Seconds since the run began, shared by every client in the session. */
  function runClock() {
    if (!runEpoch) return manualElapsed || clock.elapsedTime;
    return (Date.now() - runEpoch) / 1000;
  }

  // No document.hidden gate on purpose. Browsers already stop firing
  // requestAnimationFrame for a backgrounded tab, so the check buys nothing -
  // and it actively breaks any embedding context that reports hidden while
  // still compositing, where the loop would spin forever without ever drawing.

  let fpsAccumulator = 0;
  let fpsFrames = 0;
  let fps = 0;

  function frame() {
    frameHandle = requestAnimationFrame(frame);
    if (!running) return;
    if (!resizeIfNeeded()) return;

    const dt = Math.min(clock.getDelta(), 0.1);

    fpsAccumulator += dt;
    fpsFrames += 1;
    if (fpsAccumulator >= 0.5) {
      fps = Math.round(fpsFrames / fpsAccumulator);
      fpsAccumulator = 0;
      fpsFrames = 0;
    }

    // Movement runs regardless of prefers-reduced-motion: that setting is
    // about ambient motion the player did not ask for, not about the player's
    // own deliberate travel.
    stepFocus(dt);
    stepMovement(dt);

    // The room ALWAYS updates, including under prefers-reduced-motion.
    //
    // It used to be skipped, which was an accessibility lockout: the puzzles
    // are read from moving objects, so freezing update() left that player
    // staring at a still room with no way to solve it. Rooms tone their own
    // ambient motion down instead - they receive `reducedMotion` and decide
    // what to calm, while anything the puzzle depends on keeps moving.
    mounted?.update?.(runClock(), dt, { reducedMotion });

    renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,

    /** Room dimensions, so scenes.js builds against real numbers. */
    dimensions: { ...ROOM, eyeHeight: EYE_HEIGHT },

    mount,
    unmount,

    /** The room currently on screen, or null. Lets callers hand it state. */
    getMounted: () => mounted,


    /** The currently mounted room, or null. Phase 4 raycasts against this. */
    get room() {
      return mounted;
    },

    start() {
      if (running) return;
      running = true;
      revealToggle();
      clock.getDelta();
      if (!frameHandle) frame();
    },

    stop() {
      running = false;
    },

    getFps: () => fps,
    getTier,

    /**
     * Advance exactly one frame by hand: movement, room animation, render.
     * Exists because the browser pane this project is verified in suspends
     * requestAnimationFrame entirely, so the real loop cannot be exercised
     * there. Identical code path to the loop - if step() is correct, the only
     * untested part is rAF scheduling itself.
     */
    /**
     * Anchor the run clock to a server timestamp. Called once when the run
     * starts, and again on reconnect - the epoch is the same either way, which
     * is what lets a refreshing player rejoin mid-cycle in step with everyone.
     */
    setRunEpoch(ms) {
      runEpoch = Number(ms) || 0;
    },

    getRunTime: runClock,

    step(dt = 1 / 60) {
      manualElapsed += dt;
      stepFocus(dt);
      stepMovement(dt);
      mounted?.update?.(runClock(), dt, { reducedMotion });
      resizeIfNeeded();
      renderer.render(scene, camera);
    },

    /** True while the pointer is being dragged to look. */
    get isDragging() {
      return dragging;
    },

    /**
     * Pixels travelled during the current or most recent drag. Phase 4 uses
     * this to tell a click on a panel from the end of a look-drag.
     */
    get dragDistance() {
      return dragDistance;
    },

    /** Fires once, the first time the player moves the camera at all. */
    onFirstLook(fn) {
      if (hasLooked) {
        fn();
        return () => {};
      }
      lookListeners.add(fn);
      return () => lookListeners.delete(fn);
    },

    /**
     * Face the north wall from wherever the player is standing. With movement
     * in the game this is rotation-only on purpose - teleporting a lost player
     * back to centre would be more disorienting than the lostness.
     */
    recentre() {
      yaw = 0;
      pitch = 0;
      applyLook();
    },

    /**
     * Where the player is standing. Panel focus angles were computed from room
     * centre and are only correct there - framing is recomputed from the live
     * position at click time.
     */
    getPosition() {
      return camera.position.clone();
    },

    /** True while the pointer is captured for free-look. */
    get isPointerLocked() {
      return pointerLocked;
    },

    /**
     * The panel under a screen point, or null.
     * Coordinates are normalised device space (-1..1, y up).
     */
    pickPanel,

    focusPanel,
    releaseFocus,

    /** The panel currently framed, or null. Look and movement are held while set. */
    get focusedPanel() {
      return focusedPanel;
    },

    dispose() {
      running = false;
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;

      unmount();
      unsubscribeTier();
      // Release the lock before tearing down, or the cursor stays captured with
      // no scene to steer - leaving the run would trap the pointer on the lobby.
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onMoveKeyDown);
      window.removeEventListener('keyup', onMoveKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);

      renderer.dispose();
    },
  };
}
