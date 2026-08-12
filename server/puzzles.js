// puzzles.js - puzzle generation, the dependency ring, and answer checking.
//
// Every chamber gets its OWN puzzle, defined in puzzle-defs.js and read off the
// 3D objects in that room. This module does not know how any of them work; it
// generates them from a seed, wires them into a ring, and judges answers.
//
// THE RING, which is the whole design:
//
// Chamber i's puzzle needs a key that exists only in chamber i+1, and chamber i
// holds the key chamber i-1 needs. Everyone needs someone and everyone is
// needed - no dead end, no spectator, no chamber solvable alone. A ring rather
// than a hub, because a hub is exactly the shape that lets one dominant player
// sit in the middle and run everything.
//
// Nothing here is hardcoded: content is generated fresh per session with crypto
// randomness, so answers cannot be memorised between playthroughs. It all lives
// on the server - a client that could see the generator could see every answer.

import { randomInt } from 'node:crypto';
import { defFor } from './puzzle-defs.js';

function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Seeded RNG for a chamber's arrangement.
 *
 * Seeded rather than crypto so the SAME seed reproduces the SAME room - which
 * is what lets a bug be reproduced from its seed, and lets the tests solve
 * every arrangement deterministically. The seed itself comes from crypto, so
 * sessions are still unpredictable.
 */
function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compare a submitted answer to the expected one.
 *
 * Generous about presentation, strict about content: case, spaces and hyphens
 * are noise when a value is read aloud over a call and typed by someone else.
 * Nothing here makes a wrong answer pass.
 */
export function answersMatch(submitted, expected) {
  const clean = (s) => String(s || '').toUpperCase().replace(/[\s\-_.]/g, '');
  const a = clean(submitted);
  return a.length > 0 && a === clean(expected);
}

/**
 * Generate a puzzle for every occupied chamber and wire them into a ring.
 *
 * @param {string[]} chamberIds occupied chambers, in any order
 * @returns {Map<string, object>} chamberId -> puzzle state
 */
export function generatePuzzles(chamberIds, { epoch = Date.now() } = {}) {
  const puzzles = new Map();
  if (!chamberIds.length) return puzzles;

  // Every chamber gets a seed. The room builds its own arrangement from it -
  // which cards are missing, which collars are struck, where the beacons sit -
  // so the layout differs every session and cannot be memorised. The seed is
  // NOT a secret: it describes what is painted on the walls, which the player
  // in that chamber can see anyway. Only the answer stays server-side.
  const seedFor = new Map(chamberIds.map((id) => [id, randomInt(1, 2 ** 31 - 1)]));

  // Shuffle so the ring is not the chamber list order - otherwise the same crew
  // would learn "the Archive always needs the Engine Room".
  const ring = shuffled(chamberIds);

  // Each chamber gets ITS OWN puzzle - the Vault's drums, the Spire's lanterns.
  // The puzzle is the room, so there is no type to assign and no way for one
  // chamber's key to accidentally open another's prompt: a "read rule" cannot
  // solve a lantern loop. The self-solve collision the old shared-type builders
  // needed a repair pass for cannot arise here.
  const built = ring.map((chamberId) => {
    const def = defFor(chamberId);
    const rand = makeRand(seedFor.get(chamberId));

    // A definition may reject an unusable arrangement (two shear lines, a
    // lantern loop that splits). Re-roll rather than shipping a broken room.
    let made = null;
    for (let attempt = 0; attempt < 200 && !made; attempt += 1) made = def.build(rand);
    if (!made) throw new Error(`puzzle generation failed for ${chamberId}`);

    return {
      chamberId,
      type: def.id,
      answer: made.answer,
      config: made.config,
      key: { kind: def.keyKind, label: def.keyLabel, value: made.keyValue },
      // Static per chamber type, never seeded. The brief names the convention
      // and the payload the room is built around; it must never carry a value
      // from THIS session, or it stops being a briefing and starts being the
      // answer.
      brief: def.brief,
    };
  });

  const n = built.length;
  const soloRing = n < 2;

  built.forEach((entry, i) => {
    // Chamber i needs the key belonging to its OWN puzzle, and that key is
    // deliberately placed in the NEXT chamber. So the key this chamber holds is
    // the previous chamber's - never its own.
    //
    // Getting this backwards is the one bug that silently guts the whole game:
    // hand a chamber the key to its own prompt and every player can finish
    // alone while the dependency graph still *looks* correct on paper. It
    // shipped that way once. The invariant is asserted in the tests by actually
    // solving each puzzle with the neighbour's key, not by checking that the
    // pointers agree.
    const prev = built[(i - 1 + n) % n];
    const next = built[(i + 1) % n];

    puzzles.set(entry.chamberId, {
      type: entry.type,
      answer: entry.answer,
      // What the room paints: gap sizes, collar numbers, lantern bearings. The
      // player standing there can see all of it, so it is not secret - but it
      // is useless without the neighbour's key.
      config: entry.config,
      brief: entry.brief,
      // What the room needs to build itself, and when the run's clock started.
      // Both go to the client: the seed only describes visible furniture, and
      // the epoch is what keeps two players in one chamber in step.
      seed: seedFor.get(entry.chamberId),
      epoch,
      // What this chamber HOLDS: the previous chamber's key, useless here.
      key: soloRing ? entry.key : prev.key,
      keyForChamberId: soloRing ? null : prev.chamberId,
      // Where this chamber's own missing piece is: the next chamber along.
      needsKeyFromChamberId: soloRing ? null : next.chamberId,
      // WHAT to ask them for, by name. The label is a category ("TRACK READ"),
      // never a value, so naming it leaks nothing - and without it the panel can
      // only say "ask them for the key", which is not enough to start a
      // conversation between two people who cannot see each other's rooms.
      needsKeyLabel: entry.key.label,
      solved: false,
      solvedAt: null,
      solvedByName: null,
      lockedUntil: 0,
      attempts: 0,
    });
  });

  return puzzles;
}

/**
 * What a player in this chamber is allowed to see.
 *
 * The answer is never included. The key is included because it belongs to the
 * NEIGHBOUR, not to this chamber - holding a value you cannot use, for someone
 * who cannot see it, is the mechanic.
 */
export function serializePuzzle(puzzle, { chamberName }) {
  if (!puzzle) return null;
  return {
    type: puzzle.type,
    // The arrangement this room paints. Not secret - the player standing in the
    // chamber can see every bit of it - but useless without the neighbour's key.
    config: puzzle.config,
    brief: puzzle.brief,
    key: puzzle.key,
    seed: puzzle.seed,
    epoch: puzzle.epoch,
    keyForChamber: puzzle.keyForChamberId ? chamberName(puzzle.keyForChamberId) : null,
    needsKeyFrom: puzzle.needsKeyFromChamberId
      ? chamberName(puzzle.needsKeyFromChamberId)
      : null,
    needsKeyLabel: puzzle.needsKeyLabel,
    solved: puzzle.solved,
    solvedByName: puzzle.solvedByName,
    lockedUntil: puzzle.lockedUntil,
    attempts: puzzle.attempts,
  };
}

/** Public progress: which chambers are done. Never leaks a prompt or a key. */
export function serializeProgress(puzzles, { chamberName }) {
  const chambers = [...puzzles.entries()].map(([id, p]) => ({
    id,
    name: chamberName(id),
    solved: p.solved,
    lockedUntil: p.lockedUntil,
  }));

  return {
    chambers,
    solvedCount: chambers.filter((c) => c.solved).length,
    total: chambers.length,
  };
}
