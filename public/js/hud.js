// hud.js - panel interaction.
//
// Owns the bridge between the 3D scene and the DOM: what the pointer is over,
// what happens when it clicks, and which overlay is open. The engine does the
// raycasting and the camera tween; this file decides when to ask for them and
// what to show afterwards.
//
// Two pointing modes have to work identically, because the player can switch
// between them at any time with Ctrl:
//   cursor mode - aim with the mouse, raycast from its position
//   locked mode - aim with the head, raycast from the centre of the screen
// Everything below therefore asks for a normalised aim point rather than
// reading the mouse directly.

const PANEL_META = {
  fragment: {
    title: 'Fragment',
    status: 'yours alone',
    accent: '#ff6b9d',
    body: 'bodyFragment',
  },
  clues: {
    title: 'Clue Board',
    status: 'shared with the crew',
    accent: '#5ef2d0',
    body: 'bodyClues',
  },
  lock: {
    title: 'Answer Lock',
    status: 'sealed',
    accent: '#ffb35c',
    body: 'bodyLock',
  },
};

// A click is a click, not the end of a look-drag. Measured in pixels of pointer
// travel since pointerdown; anything past this was the player turning to look.
const DRAG_SLOP = 6;

export function createHud({
  canvas, engine, net, getRoom, getMe, getConfig,
  getInitialPuzzle, getInitialProgress, chamberLabel,
}) {
  const config = () => getConfig?.() || {};

  const $ = (id) => document.getElementById(id);

  const el = {
    ui: $('panelUi'),
    frame: $('panelFrame'),
    pip: $('panelPip'),
    title: $('panelTitle'),
    status: $('panelStatus'),
    close: $('panelClose'),
    bodies: {
      bodyFragment: $('bodyFragment'),
      bodyClues: $('bodyClues'),
      bodyLock: $('bodyLock'),
    },
    fragmentChamber: $('fragmentChamber'),
    fragmentEmpty: $('fragmentEmpty'),
    fragmentLive: $('fragmentLive'),
    fragBriefTitle: $('fragBriefTitle'),
    fragBrief: $('fragBrief'),
    fragAnswerFormat: $('fragAnswerFormat'),
    fragNeedLabel: $('fragNeedLabel'),
    fragNeedFrom: $('fragNeedFrom'),
    fragKeyLabel: $('fragKeyLabel'),
    fragKeyValue: $('fragKeyValue'),
    fragKeyFor: $('fragKeyFor'),
    fragGate: $('fragGate'),
    fragGateIndex: $('fragGateIndex'),
    fragGateValue: $('fragGateValue'),
    fragGateNote: $('fragGateNote'),
    lockLede: document.querySelector('#bodyLock .panelui__lede'),
    lockFieldLabel: document.querySelector('#bodyLock .field__label'),
    lockoutBar: $('lockoutBar'),
    lockoutTime: $('lockoutTime'),
    lockoutFill: $('lockoutFill'),
    runProgress: $('runProgress'),
    progressList: $('progressList'),
    winScreen: $('winScreen'),
    winBody: $('winBody'),
    winCrew: $('winCrew'),
    winTime: $('winTime'),
    winLockouts: $('winLockouts'),
    winDismiss: $('winDismiss'),
    clueBoard: $('clueBoard'),
    clueState: $('clueState'),
    clueAuthor: $('clueAuthor'),
    lockForm: $('lockForm'),
    lockInput: $('lockInput'),
    lockSubmit: $('lockSubmit'),
    lockNote: $('lockNote'),
  };

  let hovered = null;
  let openPanelId = null;
  let lastReturnFocus = null;

  /** Last puzzle the server sent for this player's chamber. */
  let puzzle = null;
  /** Last public progress. */
  let progress = null;
  /** This player's shard of the Vestibule gate, from the server. */
  let gate = null;
  /** Wrong attempts seen this run, for the win screen. Display only. */
  let lockoutsSeen = 0;
  let runStartedAt = 0;
  let winDismissed = false;

  // ----- aiming -------------------------------------------------------------

  /** Normalised device coords for the current aim point, or null. */
  function aimPoint(event) {
    // Locked: the reticle is the pointer, and it is always dead centre.
    if (engine.isPointerLocked) return { x: 0, y: 0 };
    if (!event) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  function setHovered(panel) {
    if (hovered === panel) return;
    // glowBoost is added into the screen's emissive intensity by the room's own
    // update(), so lighting the panel costs one number rather than a material
    // swap - and it keeps the room in charge of how it renders.
    if (hovered) hovered.glowBoost = 0;
    hovered = panel;
    if (hovered) hovered.glowBoost = 0.55;
    canvas.classList.toggle('is-over-panel', Boolean(hovered));
  }

  function updateHover(event) {
    if (openPanelId) return setHovered(null);
    const aim = aimPoint(event);
    if (!aim) return setHovered(null);
    setHovered(engine.pickPanel(aim.x, aim.y));
  }

  // ----- opening and closing ------------------------------------------------

  function openPanel(panel) {
    const meta = PANEL_META[panel.id];
    if (!meta) return;

    openPanelId = panel.id;
    setHovered(null);

    engine.focusPanel(panel);

    el.frame.style.setProperty('--panel-accent', meta.accent);
    el.title.textContent = meta.title;
    el.status.textContent = meta.status;

    for (const [id, node] of Object.entries(el.bodies)) {
      if (node) node.hidden = id !== meta.body;
    }

    if (panel.id === 'fragment') {
      const me = getMe();
      el.fragmentChamber.textContent = chamberLabel(me?.chamberId);
      renderFragment();
    }

    if (panel.id === 'lock') renderLockState();

    el.ui.hidden = false;

    // Remember where focus came from so closing returns it, and move focus into
    // the dialog so a keyboard player is not left tabbing the scene behind it.
    lastReturnFocus = document.activeElement;
    const first = panel.id === 'clues' ? el.clueBoard
      : panel.id === 'lock' ? el.lockInput
        : el.close;
    first?.focus({ preventScroll: true });
  }

  function closePanel() {
    if (!openPanelId) return;
    openPanelId = null;
    el.ui.hidden = true;
    engine.releaseFocus();

    // Hand the scene back the keyboard, or WASD goes nowhere after a close.
    if (lastReturnFocus && document.contains(lastReturnFocus)) {
      lastReturnFocus.focus({ preventScroll: true });
    } else {
      canvas.focus({ preventScroll: true });
    }
    lastReturnFocus = null;
  }

  // ----- puzzle rendering ---------------------------------------------------

  function renderFragment() {
    const live = Boolean(puzzle);
    el.fragmentEmpty.hidden = live;
    el.fragmentLive.hidden = !live;
    if (!live) return;

    // The BRIEF. Phase 5 replaced the cipher/sequence puzzles with observation
    // puzzles, and the server stopped sending `prompt` - but this function went
    // on reading `puzzle.prompt.instruction`, so it threw on every open in every
    // room and the panel silently never appeared. It renders the brief now.
    //
    // The brief tells the player what KIND of thing the room is and what to
    // report. It deliberately stops short of the observation itself: naming the
    // convention is briefing, naming the tell would be solving it for them.
    const brief = puzzle.brief;
    el.fragBriefTitle.textContent = brief?.title || 'Your puzzle';

    el.fragBrief.replaceChildren();
    for (const line of brief?.lines || []) {
      const p = document.createElement('p');
      // A short ALL-CAPS line is a heading inside the brief ("BOLT REGISTER").
      // Blank strings are paragraph breaks and render as spacing, not an empty
      // element, so the brief keeps the shape it was written in.
      if (!line) {
        p.className = 'frag-brief__gap';
      } else if (line.length < 40 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
        p.className = 'frag-brief__head';
        p.textContent = line;
      } else {
        p.className = 'frag-brief__line';
        p.textContent = line;
      }
      el.fragBrief.append(p);
    }

    el.fragAnswerFormat.textContent = brief?.submit || '—';
    el.fragNeedLabel.textContent = puzzle.needsKeyLabel || 'key';
    el.fragNeedFrom.textContent = puzzle.needsKeyFrom || 'nobody';

    el.fragKeyLabel.textContent = puzzle.key.label;
    el.fragKeyValue.textContent = puzzle.key.value;
    el.fragKeyFor.textContent = puzzle.keyForChamber || 'nobody';

    renderGate();
  }

  /**
   * The keystone shard: this player's one piece of what opens the Vestibule.
   *
   * The server sends the VALUE only once this chamber is solved, so a sealed
   * shard is genuinely absent from the payload rather than merely hidden here.
   * It is still shown as a struck slot, because knowing there is something to
   * earn is information a player can act on - and it is the thing that tells
   * them solving their chamber matters to everyone else, not just to them.
   */
  function renderGate() {
    const g = gate;
    el.fragGate.hidden = !g;
    if (!g) return;

    el.fragGateIndex.textContent = `${g.index} of ${g.of}`;
    el.fragGate.dataset.sealed = String(!g.unlocked);

    if (g.unlocked) {
      el.fragGateValue.textContent = g.text || '—';
      el.fragGateNote.textContent = g.allSolved
        ? 'Every chamber is open. Assemble all shards in order and submit them at the Answer Lock.'
        : 'Read this to the crew. The gate needs every shard, in order.';
    } else {
      el.fragGateValue.textContent = '••';
      el.fragGateNote.textContent = 'Sealed until this chamber is open. Solving it is what releases your shard.';
    }
  }

  function renderProgress() {
    const has = Boolean(progress?.chambers?.length);
    el.runProgress.hidden = !has;
    if (!has) return;

    const me = getMe();
    el.progressList.replaceChildren();

    for (const c of progress.chambers) {
      const row = document.createElement('li');
      row.className = 'progress__row';

      const locked = c.lockedUntil > Date.now();
      row.dataset.state = c.solved ? 'solved'
        : locked ? 'locked'
          : c.id === me?.chamberId ? 'mine' : 'open';

      const name = document.createElement('span');
      name.className = 'progress__name';
      name.textContent = c.name;

      const state = document.createElement('span');
      state.className = 'progress__state';
      state.textContent = c.solved ? 'open' : locked ? 'locked' : '—';

      row.append(name, state);
      el.progressList.append(row);
    }
  }

  // ----- lockout countdown --------------------------------------------------
  //
  // Purely a readout. The deadline is a server timestamp and the server rejects
  // an early submission on its own - this never gates anything, it just stops a
  // player pressing a button that is going to be refused.

  let lockoutTimer = 0;

  function tickLockout() {
    const until = puzzle?.lockedUntil || 0;
    const remaining = until - Date.now();

    if (remaining <= 0) {
      el.lockoutBar.hidden = true;
      el.lockSubmit.disabled = false;
      el.lockInput.disabled = false;
      if (puzzle) puzzle.lockedUntil = 0;
      clearInterval(lockoutTimer);
      lockoutTimer = 0;
      renderProgress();
      return;
    }

    el.lockoutBar.hidden = false;
    el.lockSubmit.disabled = true;
    el.lockInput.disabled = true;
    el.lockoutTime.textContent = String(Math.ceil(remaining / 1000));
    // Bar drains left-to-right over the full penalty.
    el.lockoutFill.style.transform = `scaleX(${Math.max(0, remaining / (config().lockoutMs || 30000))})`;
  }

  function startLockoutCountdown() {
    clearInterval(lockoutTimer);
    tickLockout();
    if (puzzle?.lockedUntil > Date.now()) {
      lockoutTimer = setInterval(tickLockout, 200);
    }
  }

  /**
   * Once every chamber is open there is nothing left to submit here, so the
   * Answer Lock becomes the gate. Any player can open it - deliberately. Making
   * it the Vestibule player's job would put one person in front of the ending,
   * which is the shape this game exists to avoid.
   */
  function applyGateMode() {
    const gating = Boolean(gate?.allSolved && !gate?.open);
    if (!el.lockLede) return;

    if (gating) {
      el.lockLede.textContent =
        'Every chamber is open. Assemble all keystone shards, in order, and submit them.';
      if (el.lockFieldLabel) el.lockFieldLabel.textContent = 'The keystone';
      el.lockInput.maxLength = 24;
      el.lockInput.placeholder = '—'.repeat(Math.max(2, (gate?.of || 6) * 2));
      el.lockNote.textContent =
        'Shard 1 first, then 2, and so on. A wrong keystone costs the crew nothing but time.';
    } else {
      el.lockLede.textContent =
        'Submit when the crew agrees. A wrong answer locks this chamber for everyone.';
      if (el.lockFieldLabel) el.lockFieldLabel.textContent = 'Solution';
      el.lockInput.maxLength = 24;
      el.lockInput.placeholder = '——————';
    }
  }

  function renderLockState() {
    applyGateMode();
    const solved = puzzle?.solved;
    el.lockNote.classList.remove('is-error');

    if (solved) {
      el.lockoutBar.hidden = true;
      el.lockSubmit.disabled = true;
      el.lockInput.disabled = true;
      el.lockNote.textContent = puzzle.solvedByName
        ? `Open — solved by ${puzzle.solvedByName}.`
        : 'Open.';
      clearInterval(lockoutTimer);
      lockoutTimer = 0;
      return;
    }

    if (!puzzle) {
      el.lockoutBar.hidden = true;
      el.lockSubmit.disabled = true;
      el.lockInput.disabled = true;
      el.lockNote.textContent = 'No puzzle in this chamber yet.';
      return;
    }

    // A locked chamber is only ever locked because of a wrong answer, so say so
    // rather than repeating the generic rule. This runs on every puzzle:state,
    // including the echo after a submission, so it must not overwrite the fact
    // of the failure with a description of the mechanic.
    if (puzzle.lockedUntil > Date.now()) {
      el.lockNote.classList.add('is-error');
      el.lockNote.textContent = 'Wrong answer. This chamber is locked — the countdown is above.';
    } else {
      el.lockNote.textContent =
        'A wrong answer locks this chamber for 30 seconds — for everyone in it.';
    }
    startLockoutCountdown();
  }

  // ----- pointer ------------------------------------------------------------

  function onPointerMove(event) {
    updateHover(event);
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (openPanelId) return;
    // The engine counts pointer travel since pointerdown. Past a few pixels the
    // player was turning to look, and a look that happens to end on a panel
    // must not open it.
    if (engine.dragDistance > DRAG_SLOP) return;

    const aim = aimPoint(event);
    if (!aim) return;
    const panel = engine.pickPanel(aim.x, aim.y);
    if (panel) openPanel(panel);
  }

  function onPointerLeave() {
    setHovered(null);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  // In locked mode the pointer never moves, so hover has to be re-evaluated as
  // the head turns. Cheap: one raycast against three quads per frame.
  let hoverTicker = 0;
  function tickHover() {
    if (engine.isPointerLocked && !openPanelId) updateHover(null);
  }
  hoverTicker = setInterval(tickHover, 100);

  // ----- keyboard -----------------------------------------------------------

  function onKeyDown(event) {
    if (event.key === 'Escape' && openPanelId) {
      // Esc also exits pointer lock at the browser level. Closing the panel is
      // the more specific intent, so take it and stop there.
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  el.close.addEventListener('click', closePanel);

  // Clicking the dimmed surround closes; clicking the frame must not.
  el.ui.addEventListener('pointerdown', (event) => {
    if (event.target === el.ui) closePanel();
  });

  // ----- clue board ---------------------------------------------------------
  //
  // The one panel with real function already: a shared scratchpad the whole crew
  // sees, whatever chamber they are standing in. It is not puzzle content, it is
  // the tool the crew uses to pool what they can each see - which makes it the
  // most on-thesis thing in the game to have working first.

  let clueSendTimer = 0;

  function setClueState(state, text) {
    el.clueState.dataset.state = state;
    el.clueState.textContent = text;
  }

  el.clueBoard.addEventListener('input', () => {
    setClueState('saving', 'saving…');
    clearTimeout(clueSendTimer);
    // Debounced: a keystroke per packet would flood the room, and the board is
    // prose being read by humans, not a value anything depends on to the letter.
    clueSendTimer = setTimeout(() => {
      net.socket.emit('clues:set', { text: el.clueBoard.value });
    }, 220);
  });

  net.on('clues:state', (payload) => {
    if (typeof payload?.text !== 'string') return;

    // Do not fight the person typing. If this client authored the change, or the
    // board is focused and the text already matches, leave the caret alone.
    const isMine = getMe() && payload.byId === getMe().id;
    if (isMine) {
      setClueState('synced', 'synced');
      el.clueAuthor.textContent = '';
      return;
    }

    if (document.activeElement === el.clueBoard && el.clueBoard.value !== payload.text) {
      // Someone else edited while we are typing. Their text is authoritative -
      // the server holds the board - but say so rather than silently stealing
      // what was half-typed.
      setClueState('saving', 'updated by crew');
    }

    const caret = el.clueBoard.selectionStart;
    el.clueBoard.value = payload.text;
    if (document.activeElement === el.clueBoard) {
      const pos = Math.min(caret, payload.text.length);
      el.clueBoard.setSelectionRange(pos, pos);
    }

    setClueState('synced', 'synced');
    el.clueAuthor.textContent = payload.byName ? `last: ${payload.byName}` : '';
  });

  net.on('disconnect', () => setClueState('offline', 'offline'));
  net.on('connect', () => setClueState('synced', 'synced'));

  // Seed from the lobby's cache. The puzzle may already have arrived while this
  // module was still being imported.
  const seededPuzzle = getInitialPuzzle?.();
  if (seededPuzzle?.puzzle) puzzle = seededPuzzle.puzzle;

  const seededProgress = getInitialProgress?.();
  if (seededProgress) {
    progress = seededProgress;
    if (!runStartedAt && seededProgress.total) runStartedAt = Date.now();
    renderProgress();
    if (seededProgress.phase === 'solved') showWin(seededProgress);
  }

  if (puzzle?.lockedUntil > Date.now()) startLockoutCountdown();

  // ----- answer lock --------------------------------------------------------

  net.on('puzzle:state', (payload) => {
    if (!payload?.puzzle) return;
    puzzle = payload.puzzle;
    gate = payload.gate || null;
    if (openPanelId === 'fragment') renderFragment();
    if (openPanelId === 'lock') renderLockState();
    // Keep the countdown alive even with the panel shut, so reopening it shows
    // the right remaining time rather than starting from scratch.
    if (puzzle.lockedUntil > Date.now()) startLockoutCountdown();
  });

  net.on('run:progress', (payload) => {
    progress = payload;
    if (!runStartedAt && payload?.total) runStartedAt = Date.now();
    renderProgress();
    if (payload?.phase === 'solved') showWin(payload);
  });

  // ----- win ----------------------------------------------------------------

  function showWin(payload) {
    if (winDismissed) return;
    const room = getRoom();
    const crew = room?.players?.length || 0;

    el.winCrew.textContent = String(crew);
    el.winLockouts.textContent = String(lockoutsSeen);

    const elapsed = payload.completedAt && runStartedAt
      ? Math.max(0, payload.completedAt - runStartedAt)
      : 0;
    el.winTime.textContent = elapsed
      ? `${Math.floor(elapsed / 60000)}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}`
      : '—';

    el.winBody.textContent = `${payload.total} chambers, ${payload.total} keys — and not one of them readable from where it was needed.`;

    closePanel();
    el.winScreen.hidden = false;
    el.winDismiss.focus({ preventScroll: true });
  }

  el.winDismiss.addEventListener('click', () => {
    winDismissed = true;
    el.winScreen.hidden = true;
    canvas.focus({ preventScroll: true });
  });

  // ----- answer lock --------------------------------------------------------

  el.lockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = el.lockInput.value.trim();
    if (!value) return;

    el.lockSubmit.disabled = true;
    const reply = await net.request('lock:submit', { answer: value });

    el.lockNote.classList.toggle('is-error', !reply.ok);
    el.lockNote.textContent = reply.message || 'Something went wrong.';

    if (reply.ok) {
      el.lockInput.value = '';
      el.lockInput.disabled = true;
      // The authoritative solved state arrives on puzzle:state; this is only so
      // the button does not sit enabled in the gap.
      el.lockSubmit.disabled = true;
      return;
    }

    if (reply.error === 'WRONG' || reply.error === 'LOCKED') {
      lockoutsSeen += reply.error === 'WRONG' ? 1 : 0;
      if (puzzle && reply.lockedUntil) puzzle.lockedUntil = reply.lockedUntil;
      startLockoutCountdown();
      return;
    }

    el.lockSubmit.disabled = false;
  });

  return {
    close: closePanel,
    get openPanelId() {
      return openPanelId;
    },
    dispose() {
      clearInterval(hoverTicker);
      clearInterval(lockoutTimer);
      clearTimeout(clueSendTimer);
      el.winScreen.hidden = true;
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown, true);
      setHovered(null);
      closePanel();
    },
  };
}
