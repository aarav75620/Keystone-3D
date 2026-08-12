// Lobby screen controller.
//
// Rendering rule for the whole project: this file draws whatever the last
// `room:state` said and nothing else. It never patches the crew list locally
// after an action, never optimistically adds a player, never runs its own
// timers over server-owned values. If the UI shows it and it matters to another
// player, the server said it.

import { createNet, session } from './net.js';

const net = createNet();

// ---------------------------------------------------------------------------
// Element handles
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const el = {
  root: document.documentElement,

  linkState: $('linkState'),
  linkLabel: document.querySelector('.link__label'),
  statusRoom: $('statusRoom'),
  statusRoomCode: $('statusRoomCode'),

  openForm: $('openForm'),
  openName: $('openName'),
  openSubmit: $('openSubmit'),

  joinForm: $('joinForm'),
  joinName: $('joinName'),
  joinCode: $('joinCode'),
  joinSubmit: $('joinSubmit'),

  entryError: $('entryError'),

  codeCopy: $('codeCopy'),
  codeCells: $('codeCells'),
  codeHint: $('codeHint'),

  slots: $('slots'),
  crewCount: $('crewCount'),
  manifestFoot: $('manifestFoot'),

  launchBtn: $('launchBtn'),
  launchNote: $('launchNote'),
  leaveBtn: $('leaveBtn'),

  log: $('log'),

  sceneCanvas: $('sceneCanvas'),
  sceneRoomCode: $('sceneRoomCode'),
  sceneCrew: $('sceneCrew'),
  sceneFps: $('sceneFps'),
  sceneChamber: $('sceneChamber'),
  sceneRoster: $('sceneRoster'),
  lookHint: $('lookHint'),
  recentreBtn: $('recentreBtn'),
  sceneLeaveBtn: $('sceneLeaveBtn'),
};

// ---------------------------------------------------------------------------
// Local view state
// ---------------------------------------------------------------------------

/** Last authoritative room state, or null when we are not in a room. */
let room = null;

/** Who this client is: { id, token, name }. Set by the server on join. */
let me = null;

/** Server-provided limits. Defaults only cover the gap before the first join. */
let config = { minPlayers: 2, maxPlayers: 6, codeLength: 4, nameMaxLength: 16 };

/** Slot ids already animated in, so re-renders do not replay the animation. */
let seenSlotIds = new Set();

/** The 3D engine, created lazily the first time a run starts. */
let engine = null;
let engineBooting = false;
let fpsTimer = 0;

/** Which chamber is currently mounted, so the HUD can name it. */
let mountedChamberId = null;
// The scene module, kept after the first dynamic import so the room can be
// rebuilt later without re-importing.
let scenes = null;
// Guards against two remounts overlapping - each one awaits createRoom(), and a
// second call landing mid-await would leave mountedChamberId lying about which
// room is actually on screen.
let mounting = false;

/** Panel interaction controller, created with the engine. */
let hud = null;

/**
 * Latest puzzle and progress, cached from page load.
 *
 * The HUD cannot listen for these itself in time: it is created inside
 * enterScene(), which awaits dynamic imports, while the server emits
 * puzzle:state in the same tick as the room:state that triggers that import.
 * The event would land before any HUD listener existed and the player would sit
 * looking at an empty Fragment panel for the whole run. Caching here - in a
 * module that has been listening since page load - closes that window.
 */
let latestPuzzle = null;
let latestProgress = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function showScreen(name) {
  el.root.dataset.screen = name;
  // Leaving the entry screen at all means the gate has served its purpose -
  // a restored session goes straight to a room and must not be held behind a
  // click-to-continue for a page it never saw.
  if (name !== 'entry') el.root.dataset.entry = 'open';
}

function setBusy(button, busy) {
  button.classList.toggle('is-busy', busy);
  button.disabled = busy;
}

function showEntryError(message) {
  el.entryError.textContent = message || '';
  el.entryError.classList.remove('is-shown');
  if (message) {
    // Restart the shake: force a reflow between removing and adding the class.
    void el.entryError.offsetWidth;
    el.entryError.classList.add('is-shown');
  }
}

function setLinkState(state, label) {
  el.linkState.dataset.state = state;
  el.linkLabel.textContent = label;
}

function timestamp(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addLogLine(text, tone = 'info', at = Date.now()) {
  const line = document.createElement('div');
  line.className = 'log__line';
  line.dataset.tone = tone;

  const time = document.createElement('span');
  time.className = 'log__time';
  time.textContent = timestamp(at);

  const body = document.createElement('span');
  body.className = 'log__text';
  body.textContent = text;

  line.append(time, body);
  el.log.prepend(line);

  // Keep the log short; it is a glance-at-it feed, not a transcript.
  while (el.log.children.length > 6) el.log.lastElementChild.remove();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderCode(code) {
  el.codeCells.replaceChildren();
  [...code].forEach((char, i) => {
    const cell = document.createElement('span');
    cell.className = 'code__cell';
    cell.textContent = char;
    cell.style.animationDelay = `${i * 70}ms`;
    el.codeCells.append(cell);
  });

  el.statusRoomCode.textContent = code;
  el.statusRoom.hidden = false;
}

/**
 * The crew manifest. Renders `maxPlayers` rows always: filled ones for the
 * players present, and explicit "awaiting crew" rows for the rest. Empty seats
 * are drawn rather than omitted because the missing player is the point.
 */
function renderSlots() {
  const total = config.maxPlayers;
  const players = room.players;

  el.slots.replaceChildren();

  for (let i = 0; i < total; i += 1) {
    const player = players[i] || null;

    const li = document.createElement('li');
    li.className = 'slot';

    const index = document.createElement('span');
    index.className = 'slot__index';
    index.textContent = String(i + 1).padStart(2, '0');

    const name = document.createElement('span');
    name.className = 'slot__name';

    const tags = document.createElement('span');
    tags.className = 'slot__tags';

    const state = document.createElement('span');
    state.className = 'slot__state';

    if (player) {
      li.classList.add('slot--filled');
      name.textContent = player.name;

      if (me && player.id === me.id) {
        li.classList.add('slot--self');
        tags.append(makeTag('you', 'tag--you'));
      }

      if (player.isHost) {
        tags.append(makeTag('host', 'tag--host'));
      }

      if (player.connected) {
        state.textContent = 'linked';
      } else {
        li.classList.add('slot--dropped');
        state.textContent = 'reconnecting';
      }

      // Only animate a row the first time we see that player.
      if (seenSlotIds.has(player.id)) {
        li.style.animation = 'none';
      }
    } else {
      li.classList.add('slot--empty');
      name.textContent = 'awaiting crew';
      li.style.animationDelay = `${i * 180}ms`;
    }

    li.append(index, name, tags, state);
    el.slots.append(li);
  }

  seenSlotIds = new Set(players.map((p) => p.id));
}

function makeTag(text, className) {
  const tag = document.createElement('span');
  tag.className = `tag ${className}`;
  tag.textContent = text;
  return tag;
}

function renderControls() {
  const players = room.players;
  const count = players.length;
  const linked = players.filter((p) => p.connected).length;
  const isHost = Boolean(me) && room.hostId === me.id;
  // Match the server's rule exactly: only players on a live socket count toward
  // the minimum, so the button never looks enabled when the server would refuse.
  const enough = linked >= config.minPlayers;

  el.crewCount.textContent = `${count} / ${config.maxPlayers}`;

  // Light one voussoir of the backdrop arch per occupied seat. Optional
  // chaining because the backdrop is absent when WebGL is unavailable or the
  // Three.js CDN is blocked - the lobby must not care either way.
  // Seats held, not sockets live, so a brief disconnect does not make the arch
  // visibly break apart while that player is reconnecting.
  window.keystoneBackdrop?.setCrew(count);

  if (count < config.minPlayers) {
    const needed = config.minPlayers - count;
    el.manifestFoot.textContent =
      `Waiting on ${needed} more ${needed === 1 ? 'player' : 'players'}. ` +
      'Each one gets a fragment nobody else can see, so the room cannot be solved without them.';
  } else if (linked < count) {
    el.manifestFoot.textContent =
      'Someone dropped out. Their seat is held while they reconnect.';
  } else {
    el.manifestFoot.textContent =
      `${count} aboard. Every player holds a different fragment - talk to each other.`;
  }

  el.launchBtn.hidden = !isHost;
  el.launchBtn.disabled = !enough;

  if (!isHost) {
    const host = players.find((p) => p.isHost);
    el.launchNote.textContent = host
      ? `${host.name} starts the run.`
      : 'Waiting for a host.';
  } else if (!enough) {
    el.launchNote.textContent = `Needs ${config.minPlayers} players minimum.`;
  } else {
    el.launchNote.textContent = 'Everyone ready? Start when your crew is on the call.';
  }

  el.launchNote.classList.remove('is-error');
}

function render() {
  if (!room) return;
  renderSlots();
  renderControls();
}

// ---------------------------------------------------------------------------
// The 3D scene
// ---------------------------------------------------------------------------

/**
 * Boot the room engine and hand it the screen.
 *
 * engine.js is imported dynamically rather than at the top of this file for the
 * same reason backdrop-boot.js is a separate module: it pulls Three.js off a
 * CDN, and a school network that blocks that must not take the lobby down with
 * it. A failure here surfaces as a message, not a blank screen.
 */
/**
 * Build and mount the chamber the server says this player is in.
 *
 * Safe to call again: it is a no-op when the mounted room already matches the
 * assignment, and rebuilds when it does not.
 *
 * That re-entrancy is the whole point. `me` is captured at join time and the
 * chamber is not dealt until the host starts the run, so the value this reads
 * can change AFTER the scene has already been built. It used to be inlined in
 * enterScene(), which runs exactly once and then bails on its own guards - so a
 * player whose assignment landed late was left standing in whatever room was
 * mounted first, holding a puzzle for a different chamber. The Observatory's
 * meteor falls are not in the Vault; the puzzle was unobservable, and the
 * status bar (reading mountedChamberId) and the Fragment panel (reading
 * me.chamberId) disagreed about where the player was.
 *
 * The SERVER decides the chamber. The client only renders the assignment - it
 * never picks, because a client that chose its own chamber could choose the one
 * holding the value it needs.
 */
async function mountAssignedChamber() {
  if (!engine || !scenes || mounting) return;

  const chamberId = scenes.hasRoom(me?.chamberId) ? me.chamberId : 'room-one';
  if (chamberId === mountedChamberId) return;

  mounting = true;
  try {
    // The room builds its arrangement from the server's seed, and animates on
    // the run clock rather than time-since-mount, so two players standing in
    // the same chamber read the same thing at the same moment.
    const puzzleState = latestPuzzle?.puzzle || null;
    if (puzzleState?.epoch) engine.setRunEpoch(puzzleState.epoch);

    engine.mount(await scenes.createRoom(chamberId, {
      dimensions: engine.dimensions,
      seed: puzzleState?.seed ?? 0,
      // The whole puzzle: the room paints its own arrangement from config and
      // animates on the run clock so every client in it agrees.
      puzzle: puzzleState,
    }));

    mountedChamberId = chamberId;
    syncSceneHud();
  } finally {
    mounting = false;
  }
}

async function enterScene() {
  if (el.root.dataset.screen === 'scene') return;

  if (engine) {
    showScene();
    return;
  }

  if (engineBooting) return;
  engineBooting = true;

  try {
    const [{ createEngine }, { createRoom, hasRoom }, { createHud }] = await Promise.all([
      import('./engine.js'),
      import('./scenes.js'),
      import('./hud.js'),
    ]);

    engine = createEngine(el.sceneCanvas);

    if (!engine) {
      el.launchNote.textContent = 'This device could not open a 3D view.';
      el.launchNote.classList.add('is-error');
      return;
    }

    scenes = { createRoom, hasRoom };
    await mountAssignedChamber();
    engine.onFirstLook(() => el.lookHint.classList.add('is-gone'));

    hud = createHud({
      canvas: el.sceneCanvas,
      engine,
      net,
      getRoom: () => room,
      getMe: () => me,
      getConfig: () => config,
      // Seeded from the cache, so a puzzle that arrived before the HUD existed
      // is not lost.
      getInitialPuzzle: () => latestPuzzle,
      getInitialProgress: () => latestProgress,
      chamberLabel,
    });
    showScene();
  } catch (error) {
    // Keep the real error visible. An earlier version swallowed it and blamed
    // the network, which sent debugging in exactly the wrong direction when the
    // actual cause was a bug in the scene code.
    console.error('[keystone] the 3D engine failed to start:', error);
    el.launchNote.textContent = 'The 3D view could not start. See the browser console.';
    el.launchNote.classList.add('is-error');
  } finally {
    engineBooting = false;
  }
}

function showScene() {
  // The lobby arch keeps its WebGL context but stops drawing. Two renderers
  // running at once would double the GPU cost for a scene nobody can see.
  window.keystoneBackdrop?.pause();

  // Deliberately global, same as the backdrop: it is how in-browser tests and
  // debugging reach the engine without lobby.js exporting its internals.
  window.keystoneEngine = engine;

  engine.start();
  showScreen('scene');
  syncSceneHud();

  // Focus the canvas so the arrow-key look works without a click first.
  el.sceneCanvas.focus({ preventScroll: true });

  clearInterval(fpsTimer);
  fpsTimer = setInterval(() => {
    el.sceneFps.textContent = String(engine.getFps());
  }, 500);
}

function leaveScene() {
  clearInterval(fpsTimer);
  fpsTimer = 0;

  // The HUD holds listeners on the canvas and an open dialog, so it must go
  // before the engine it points at.
  if (hud) {
    hud.dispose();
    hud = null;
  }

  if (engine) {
    engine.dispose();
    engine = null;
    delete window.keystoneEngine;
  }

  el.lookHint.classList.remove('is-gone');
  window.keystoneBackdrop?.resume();
}

/** Mirror the room state into the in-scene readouts. */
function syncSceneHud() {
  if (!room) return;
  el.sceneRoomCode.textContent = room.code;
  el.sceneCrew.textContent = `${room.players.length} / ${config.maxPlayers}`;

  if (mountedChamberId) {
    el.sceneChamber.textContent = chamberLabel(mountedChamberId);
  }

  // Who is standing where. This is the crew's whole basis for knowing who to ask
  // about what, so it is always on screen rather than behind a key press.
  el.sceneRoster.replaceChildren();
  for (const player of room.players) {
    const row = document.createElement('li');
    row.className = 'roster__row';
    if (me && player.id === me.id) row.classList.add('roster__row--self');
    if (!player.connected) row.classList.add('roster__row--dropped');

    const name = document.createElement('span');
    name.className = 'roster__name';
    name.textContent = player.name;

    const where = document.createElement('span');
    where.className = 'roster__where';
    where.textContent = player.connected
      ? chamberLabel(player.chamberId)
      : 'reconnecting';

    row.append(name, where);
    el.sceneRoster.append(row);
  }
}

function chamberLabel(id) {
  if (!id) return '—';
  const found = (config.chambers || []).find((c) => c.id === id);
  return found ? found.name : id;
}

el.recentreBtn.addEventListener('click', () => {
  engine?.recentre();
  el.sceneCanvas.focus({ preventScroll: true });
});

el.sceneLeaveBtn.addEventListener('click', async () => {
  setBusy(el.sceneLeaveBtn, true);
  await net.request('room:leave', {});
  setBusy(el.sceneLeaveBtn, false);
  exitToEntry();
});

// ---------------------------------------------------------------------------
// Entering and leaving rooms
// ---------------------------------------------------------------------------

function enterRoom(reply) {
  me = reply.you;
  room = reply.room;
  config = { ...config, ...reply.config };

  session.write({ token: me.token, code: room.code, name: me.name });

  // Make the URL shareable, so the host can paste a link instead of spelling
  // out the code over a call.
  const url = new URL(window.location.href);
  url.searchParams.set('room', room.code);
  window.history.replaceState({}, '', url);

  renderCode(room.code);
  seenSlotIds = new Set();
  render();
  showScreen('room');
}

function exitToEntry({ keepCode = true } = {}) {
  const lastCode = room?.code || '';
  room = null;
  me = null;
  seenSlotIds = new Set();

  session.clear();

  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url);

  leaveScene();

  el.statusRoom.hidden = true;
  el.log.replaceChildren();
  window.keystoneBackdrop?.setCrew(0);

  if (keepCode && lastCode) el.joinCode.value = lastCode;
  showScreen('entry');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

el.openForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showEntryError('');

  const name = el.openName.value.trim();
  if (!name) {
    showEntryError('Enter a callsign first.');
    el.openName.focus();
    return;
  }

  setBusy(el.openSubmit, true);
  const reply = await net.request('room:open', { name });
  setBusy(el.openSubmit, false);

  if (!reply.ok) {
    showEntryError(reply.message);
    return;
  }

  enterRoom(reply);
  addLogLine('Room opened. Share the code.', 'good');
});

el.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showEntryError('');

  const name = el.joinName.value.trim();
  const code = el.joinCode.value.trim().toUpperCase();

  if (!name) {
    showEntryError('Enter a callsign first.');
    el.joinName.focus();
    return;
  }

  if (code.length !== config.codeLength) {
    showEntryError(`A room code is ${config.codeLength} characters.`);
    el.joinCode.focus();
    return;
  }

  setBusy(el.joinSubmit, true);
  const reply = await net.request('room:join', { code, name });
  setBusy(el.joinSubmit, false);

  if (!reply.ok) {
    showEntryError(reply.message);
    return;
  }

  enterRoom(reply);
});

// Correct the code field as it is typed rather than rejecting it on submit.
// Filtering against the server's own alphabet means a character that can never
// appear in a code (I, O, S, 0, 1, 5 - the ones that get misheard over a call)
// simply never lands, instead of being accepted and then failing confusingly.
el.joinCode.addEventListener('input', () => {
  const allowed = config.codeAlphabet;
  const cleaned = [...el.joinCode.value.toUpperCase()]
    .filter((ch) => (allowed ? allowed.includes(ch) : /[A-Z0-9]/.test(ch)))
    .join('')
    .slice(0, config.codeLength);
  if (cleaned !== el.joinCode.value) el.joinCode.value = cleaned;
});

el.leaveBtn.addEventListener('click', async () => {
  setBusy(el.leaveBtn, true);
  await net.request('room:leave', {});
  setBusy(el.leaveBtn, false);
  exitToEntry();
});

el.launchBtn.addEventListener('click', async () => {
  setBusy(el.launchBtn, true);
  const reply = await net.request('room:start', {});
  setBusy(el.launchBtn, false);

  if (!reply.ok) {
    el.launchNote.textContent = reply.message;
    el.launchNote.classList.add('is-error');
  }
});

el.codeCopy.addEventListener('click', async () => {
  if (!room) return;

  const shareUrl = `${window.location.origin}/?room=${room.code}`;
  let copied = false;

  try {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
  } catch {
    // Clipboard API needs a secure context. Over plain http on a LAN address it
    // will refuse, so fall back to a selection the player can copy by hand.
    const range = document.createRange();
    range.selectNodeContents(el.codeCells);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  el.codeHint.textContent = copied ? 'link copied' : 'press ctrl+c to copy';
  el.codeHint.classList.add('is-copied');

  setTimeout(() => {
    el.codeHint.textContent = 'click to copy';
    el.codeHint.classList.remove('is-copied');
  }, 2000);
});

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------

net.on('room:state', (state) => {
  room = state;
  config.maxPlayers = state.maxPlayers ?? config.maxPlayers;

  // Refresh our own record from the broadcast. `me` is captured at join time,
  // which is BEFORE the host starts the run and therefore before chambers are
  // dealt - without this, me.chamberId stays null forever and every player
  // mounts the fallback room instead of the chamber they were actually given.
  if (me) {
    const mine = state.players.find((p) => p.id === me.id);
    if (mine) me = { ...me, name: mine.name, chamberId: mine.chamberId };
  }

  render();
  syncSceneHud();

  // The server owns the phase, so this is the one place the client learns a run
  // has started - including for a player who was mid-reconnect when the host
  // pressed start.
  if (state.phase !== 'lobby') {
    enterScene();
    // enterScene() returns early once the scene exists, so a chamber that was
    // dealt or changed AFTER the first mount would otherwise never reach the
    // screen. This is the line that keeps the room the player is standing in
    // and the puzzle they were given the same chamber.
    mountAssignedChamber();
  }
});

net.on('server:hello', (payload) => {
  config = { ...config, ...payload.config };
  el.joinCode.maxLength = config.codeLength;
  el.openName.maxLength = config.nameMaxLength;
  el.joinName.maxLength = config.nameMaxLength;
});

// Cached from page load - see latestPuzzle above for why the HUD cannot do this.
net.on('puzzle:state', (payload) => {
  if (!payload?.puzzle) return;
  latestPuzzle = payload;
  // Re-anchor on every delivery, including the reconnect one, so a refreshing
  // player picks the cycle up where the crew already is.
  if (payload.puzzle.epoch) engine?.setRunEpoch(payload.puzzle.epoch);
});

net.on('run:progress', (payload) => {
  latestProgress = payload;
});

net.on('room:notice', ({ text, tone, at }) => {
  addLogLine(text, tone, at);
});

net.on('room:closed', () => {
  addLogLine('Room closed.', 'warn');
  exitToEntry();
  showEntryError('That room closed because everyone left.');
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

net.on('connect', async () => {
  setLinkState('online', 'linked');

  // Rejoin automatically after a refresh or a dropped connection, using the
  // token held for this tab. The server decides whether that seat is still
  // ours; we just ask.
  const saved = session.read();
  if (!saved.token || !saved.code) return;

  const reply = await net.request('room:join', {
    code: saved.code,
    name: saved.name,
    token: saved.token,
  });

  if (reply.ok) {
    enterRoom(reply);
    return;
  }

  // The seat is gone (grace expired, room closed, run already started).
  session.clear();
  if (room) exitToEntry();
  showEntryError(reply.message);
});

net.on('disconnect', () => {
  setLinkState('offline', 'dropped');
  if (room) addLogLine('Connection lost. Trying to reconnect.', 'bad');
});

net.on('connect_error', () => {
  setLinkState('offline', 'no server');
});

net.socket.io.on('reconnect_attempt', () => {
  setLinkState('connecting', 'reconnecting');
});

// ---------------------------------------------------------------------------
// First paint
// ---------------------------------------------------------------------------

(function boot() {
  const saved = session.read();

  // Prefill from a shared link, then from whatever this tab last used.
  const linkCode = new URL(window.location.href).searchParams.get('room');
  if (linkCode) el.joinCode.value = linkCode.toUpperCase().slice(0, config.codeLength);
  else if (saved.code) el.joinCode.value = saved.code;

  if (saved.name) {
    el.openName.value = saved.name;
    el.joinName.value = saved.name;
  }

  // A shared link means they are here to join, so point them at that form.
  // preventScroll matters: without it the browser scrolls the focused input
  // into view on load, which pushes the status bar (and the connection lamp)
  // off the top of the screen.
  const focusOptions = { preventScroll: true };
  if (linkCode && !saved.token) el.joinName.focus(focusOptions);
  else el.openName.focus(focusOptions);
})();

// ---------------------------------------------------------------------------
// Entry gate
// ---------------------------------------------------------------------------

/**
 * Hold the page behind one click, then move into it.
 *
 * The lobby used to arrive fully assembled, which left its empty space reading
 * as unfinished. Gating it does two things: the wordmark gets a moment alone
 * over the arch, and the click gives the assembly a cause. The camera push is a
 * real dolly on the backdrop's own camera, so the arch and the stars behind it
 * separate as it moves - a CSS scale on the canvas would just enlarge an
 * already-rendered frame.
 */
function openEntryGate() {
  const root = document.documentElement;
  if (root.dataset.entry !== 'locked') return;

  const gate = document.getElementById('enterGate');
  gate?.classList.add('is-gone');

  const backdrop = window.keystoneBackdrop;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (backdrop?.dolly && !reduced) {
    // Start pulled back, settle to rest. Ease-out so it decelerates into the
    // page rather than stopping dead.
    const FROM = 5.2;
    const MS = 1150;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / MS);
      const eased = 1 - Math.pow(1 - k, 3);
      backdrop.dolly(FROM * (1 - eased));
      if (k < 1) requestAnimationFrame(tick);
    };
    backdrop.dolly(FROM);
    requestAnimationFrame(tick);
  }

  root.dataset.entry = 'open';
  setTimeout(() => gate?.remove(), 700);

  // Focus the first thing they came here to use.
  setTimeout(() => el.openName?.focus({ preventScroll: true }), 900);
}

document.getElementById('enterGate')?.addEventListener('click', openEntryGate);
// Keyboard and touch users get the same door.
addEventListener('keydown', (e) => {
  if (document.documentElement.dataset.entry !== 'locked') return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEntryGate(); }
});
