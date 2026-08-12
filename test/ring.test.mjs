// The ring: can a crew actually finish, and can any one player finish alone?
//
// puzzle-defs.test.mjs proves each puzzle works in isolation. This proves they
// compose - that the key sitting in chamber i+1 is the key chamber i needs, for
// the real generated ring rather than in principle.
//
//   node test/ring.test.mjs

import assert from 'node:assert/strict';
import { generatePuzzles, serializePuzzle, answersMatch } from '../server/puzzles.js';
import { defFor } from '../server/puzzle-defs.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`  PASS  ${name}`); }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const ALL = ['archive', 'engine-room', 'observatory', 'vault', 'spire'];
const chamberName = (id) => id;

check('a crew can solve every chamber by passing keys round the ring', () => {
  for (let trial = 0; trial < 200; trial += 1) {
    const puzzles = generatePuzzles(ALL);

    for (const [id, puzzle] of puzzles) {
      // The player in `id` asks their neighbour for the key. The neighbour is
      // holding it because the ring put it there.
      const neighbour = puzzles.get(puzzle.needsKeyFromChamberId);
      const solved = defFor(id).solve(puzzle.config, neighbour.key);

      assert.ok(answersMatch(solved, puzzle.answer),
        `trial ${trial}: ${id} could not be solved with ${puzzle.needsKeyFromChamberId}'s key `
        + `(got "${solved}", wanted "${puzzle.answer}")`);
    }
  }
});

check('NO chamber can be solved with the key it holds itself', () => {
  // The failure that shipped once: every chamber held the key to its own
  // prompt, so the whole crew was optional.
  for (let trial = 0; trial < 200; trial += 1) {
    for (const [id, puzzle] of generatePuzzles(ALL)) {
      const selfSolved = defFor(id).solve(puzzle.config, puzzle.key);
      assert.ok(!answersMatch(selfSolved, puzzle.answer),
        `trial ${trial}: ${id} solved itself with the key it holds`);
    }
  }
});

check('no chamber can be solved with ANY key except its neighbour\'s', () => {
  for (let trial = 0; trial < 100; trial += 1) {
    const puzzles = generatePuzzles(ALL);
    for (const [id, puzzle] of puzzles) {
      for (const [otherId, other] of puzzles) {
        if (otherId === puzzle.needsKeyFromChamberId) continue;
        const solved = defFor(id).solve(puzzle.config, other.key);
        assert.ok(!answersMatch(solved, puzzle.answer),
          `trial ${trial}: ${id} was solved by ${otherId}'s key`);
      }
    }
  }
});

check('the ring works at every crew size from 2 to 5', () => {
  // At n=2 the ring is mutual: A holds B's key and B holds A's. That is still
  // forcing - neither can finish alone - it is just the smallest possible ring.
  for (let n = 2; n <= 5; n += 1) {
    for (let trial = 0; trial < 60; trial += 1) {
      const ids = ALL.slice(0, n);
      const puzzles = generatePuzzles(ids);
      assert.equal(puzzles.size, n);

      for (const [id, puzzle] of puzzles) {
        const neighbour = puzzles.get(puzzle.needsKeyFromChamberId);
        assert.notEqual(puzzle.needsKeyFromChamberId, id, `n=${n}: ${id} needs itself`);
        const solved = defFor(id).solve(puzzle.config, neighbour.key);
        assert.ok(answersMatch(solved, puzzle.answer),
          `n=${n} trial ${trial}: ${id} unsolvable with its neighbour's key`);
      }
    }
  }
});

check('nothing sent to a client contains an answer', () => {
  for (let trial = 0; trial < 100; trial += 1) {
    const puzzles = generatePuzzles(ALL);
    for (const [id, puzzle] of puzzles) {
      const sent = serializePuzzle(puzzle, { chamberName });
      const wire = JSON.stringify(sent);
      assert.ok(!wire.includes('"answer"'), `${id}: answer field on the wire`);

      // The BRIEF is the only free text the server authors, so it is the only
      // place an answer could leak by being written down.
      //
      // `config` is deliberately excluded. The room's arrangement IS the raw
      // material the answer is drawn from - collar numbers, station digits,
      // strip words - and the security property is that you cannot select the
      // right subset without the neighbour's key, which is asserted above by
      // actually solving each chamber. A blanket substring scan cannot express
      // that, and it produced steady false positives: a four-digit answer
      // landing inside the epoch timestamp, and the Archive's initials-based
      // answer "VERN" appearing inside its own strip word "VERNIER". Both are
      // coincidences that tell a player nothing, and between them they failed
      // roughly half of all runs.
      assert.ok(!JSON.stringify(sent.brief || {}).includes(puzzle.answer),
        `${id}: the answer "${puzzle.answer}" is written into the brief`);
    }
  }
});

check('a client payload carries the seed, epoch and arrangement', () => {
  // The room cannot paint itself without these, and two players in one chamber
  // cannot stay in step without the epoch.
  const epoch = 1_700_000_000_000;
  for (const [, puzzle] of generatePuzzles(ALL, { epoch })) {
    const wire = serializePuzzle(puzzle, { chamberName });
    assert.equal(wire.epoch, epoch);
    assert.ok(Number.isInteger(wire.seed) && wire.seed > 0);
    assert.ok(wire.config && typeof wire.config === 'object', 'no arrangement sent');
    assert.ok(wire.key?.value, 'no key sent');
  }
});

check('each chamber holds a key of a DIFFERENT kind than it needs', () => {
  // A nice structural consequence: the Vault holds a manifold order, which
  // could not possibly open the Vault's own drums even by accident.
  for (let trial = 0; trial < 100; trial += 1) {
    const puzzles = generatePuzzles(ALL);
    for (const [id, puzzle] of puzzles) {
      const ownKind = defFor(id).keyKind;
      assert.notEqual(puzzle.key.kind, ownKind,
        `${id} holds a ${puzzle.key.kind} key, which is its own kind`);
    }
  }
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\nFAILURES PRESENT' : '\nall green');
