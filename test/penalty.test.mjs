// The penalty engine: lockouts, and the win condition.
//
// Puzzle CONTENT is covered by puzzle-defs.test.mjs (each puzzle solvable) and
// ring.test.mjs (they compose into a forcing ring). This file is only about
// what happens when an answer is submitted.
//
//   node test/penalty.test.mjs

import assert from 'node:assert/strict';
import { generatePuzzles, answersMatch } from '../server/puzzles.js';
import { submitAnswer, expireLockouts } from '../server/rooms.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`  PASS  ${name}`); }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const CHAMBERS = ['archive', 'engine-room', 'observatory', 'vault', 'spire'];
const LOCKOUT = 30_000;

const fakeRoom = (ids) => ({ phase: 'playing', puzzles: generatePuzzles(ids), completedAt: 0 });
const player = { name: 'AARAV' };
const opts = { answersMatch, lockoutMs: LOCKOUT };

// --- the penalty engine ----------------------------------------------------

check('a correct answer opens the chamber', () => {
  const room = fakeRoom(CHAMBERS);
  const puzzle = room.puzzles.get('archive');
  assert.equal(submitAnswer(room, 'archive', puzzle.answer, player, opts).ok, true);
  assert.equal(puzzle.solved, true);
  assert.equal(puzzle.solvedByName, 'AARAV');
});

check('a wrong answer locks the chamber for exactly the penalty', () => {
  const room = fakeRoom(CHAMBERS);
  const now = 1_000_000;
  const r = submitAnswer(room, 'archive', 'NOPE', player, { ...opts, now });
  assert.equal(r.error, 'WRONG');
  assert.equal(room.puzzles.get('archive').lockedUntil, now + LOCKOUT);
});

check('a locked chamber refuses even a CORRECT answer', () => {
  // Guards the exploit: guess wrong, learn, resubmit before the penalty bites.
  const room = fakeRoom(CHAMBERS);
  const now = 1_000_000;
  const correct = room.puzzles.get('archive').answer;
  submitAnswer(room, 'archive', 'WRONG', player, { ...opts, now });
  assert.equal(submitAnswer(room, 'archive', correct, player, { ...opts, now: now + 5000 }).error, 'LOCKED');
  assert.equal(submitAnswer(room, 'archive', correct, player, { ...opts, now: now + LOCKOUT + 1 }).ok, true);
});

check('one chamber locking does NOT lock the others', () => {
  const room = fakeRoom(CHAMBERS);
  const now = 2_000_000;
  submitAnswer(room, 'archive', 'WRONG', player, { ...opts, now });
  for (const id of CHAMBERS.filter((c) => c !== 'archive')) {
    assert.equal(room.puzzles.get(id).lockedUntil, 0, `${id} locked by the Archive`);
    assert.equal(submitAnswer(room, id, room.puzzles.get(id).answer, player, { ...opts, now }).ok, true);
  }
});

check('a solved chamber cannot be re-submitted', () => {
  const room = fakeRoom(CHAMBERS);
  const p = room.puzzles.get('archive');
  submitAnswer(room, 'archive', p.answer, player, opts);
  assert.equal(submitAnswer(room, 'archive', p.answer, player, opts).error, 'ALREADY_SOLVED');
});

check('the run completes only when every chamber is open', () => {
  const room = fakeRoom(CHAMBERS);
  const ids = [...room.puzzles.keys()];
  ids.slice(0, -1).forEach((id) => {
    assert.equal(submitAnswer(room, id, room.puzzles.get(id).answer, player, opts).allSolved, false);
    assert.notEqual(room.phase, 'solved');
  });
  const last = ids[ids.length - 1];
  assert.equal(submitAnswer(room, last, room.puzzles.get(last).answer, player, opts).allSolved, true);
  assert.equal(room.phase, 'solved');
});

check('expireLockouts clears only genuinely expired chambers', () => {
  const room = fakeRoom(CHAMBERS);
  const now = 9_000_000;
  submitAnswer(room, 'archive', 'WRONG', player, { ...opts, now });
  submitAnswer(room, 'vault', 'WRONG', player, { ...opts, now: now + 10_000 });
  assert.deepEqual(expireLockouts(room, now + 1000), []);
  assert.deepEqual(expireLockouts(room, now + LOCKOUT + 1), ['archive']);
  assert.ok(room.puzzles.get('vault').lockedUntil > 0);
});

check('submitting to a chamber with no puzzle fails cleanly', () => {
  assert.equal(submitAnswer(fakeRoom(CHAMBERS), 'nowhere', 'X', player, opts).error, 'NO_PUZZLE');
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\nFAILURES PRESENT' : '\nall green');
