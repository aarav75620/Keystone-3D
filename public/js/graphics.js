// Graphics tier - the single source of truth for Low vs High.
//
// There are now two renderers (the lobby arch and the room engine) and one
// toggle in the status bar. If each renderer tracked its own tier the button
// would end up describing one of them while the other quietly disagreed, so
// the setting lives here and both subscribe to it.
//
// Rules from PRD 4, enforced in this file:
//   - Start at Low. Never infer upward from device type or screen size.
//   - Promote to High only on measured evidence, and only once.
//   - A choice the player makes themselves always wins and always persists.

const PREF_KEY = 'keystone.gfx';

const listeners = new Set();

function readPreference() {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    return saved === 'low' || saved === 'high' ? saved : null;
  } catch {
    return null;
  }
}

function writePreference(tier) {
  try {
    localStorage.setItem(PREF_KEY, tier);
  } catch {
    /* storage blocked - the choice applies now but will not survive a reload */
  }
}

const saved = readPreference();

let tier = saved || 'low';
let userChose = saved !== null;

export function getTier() {
  return tier;
}

/** True once the player has picked a tier by hand; suppresses auto-promotion. */
export function hasUserChoice() {
  return userChose;
}

/**
 * @param {'low'|'high'} next
 * @param {{fromUser?: boolean}} [options] fromUser defaults to true. Pass false
 *        for automatic promotion so it neither persists nor blocks a later
 *        automatic decision from being overridden by the player.
 */
export function setTier(next, options = {}) {
  if (next !== 'low' && next !== 'high') return;

  const fromUser = options.fromUser !== false;

  if (fromUser) {
    userChose = true;
    writePreference(next);
  }

  if (next === tier) {
    syncButton();
    return;
  }

  tier = next;
  syncButton();
  for (const listener of listeners) listener(tier);
}

/**
 * Subscribe to tier changes. The callback fires immediately with the current
 * tier so a renderer created later does not need separate setup code for
 * "what is the tier right now" and "what did it just become".
 *
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  listener(tier);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// The toggle in the status bar
// ---------------------------------------------------------------------------

const button = document.getElementById('gfxToggle');
const label = document.getElementById('gfxLabel');

function syncButton() {
  if (!button || !label) return;
  label.textContent = tier === 'high' ? 'HIGH' : 'LOW';
  button.setAttribute(
    'aria-label',
    `Graphics quality: ${tier}. Click to switch to ${tier === 'high' ? 'low' : 'high'}.`,
  );
}

if (button) {
  button.addEventListener('click', () => {
    setTier(tier === 'high' ? 'low' : 'high');
  });
  syncButton();
}

/**
 * Reveal the toggle. Called by the first renderer to get a working WebGL
 * context - until something is actually being rendered the control governs
 * nothing and should not be offered.
 */
export function revealToggle() {
  if (button) button.hidden = false;
}
