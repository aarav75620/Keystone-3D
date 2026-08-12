// Does the Observatory's SKY actually show the answer?
//
// Simulates the room's fall timeline and reads it the way a player would:
// watch which two chain beacons hold lit each fall, map the chain to the
// frieze by height, count into each name by the partner's number, then apply
// the neighbour's TRACK READ. The result must be what the server expects.
//
//   node test/observatory-room.test.mjs

import { generatePuzzles } from '../server/puzzles.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

// Mirrors of the room's timing constants.
const FLIGHT = 1.1;
const HOLD = 3.0;
const SLOT = FLIGHT + HOLD;

/** What the chain looks like at `t`, exactly as the room computes it. */
function chainAt(t, falls, cycleSeconds) {
  const BLACKOUT = Math.max(2.4, cycleSeconds - falls.length * SLOT);
  const LOOP = falls.length * SLOT + BLACKOUT;

  const local0 = ((t % LOOP) + LOOP) % LOOP;
  const index = Math.min(falls.length - 1, Math.floor(local0 / SLOT));
  const inBlackout = local0 >= falls.length * SLOT;
  const local = local0 - index * SLOT;
  const holding = !inBlackout && local >= FLIGHT;

  const lit = [];
  if (holding) lit.push(...falls[index]);

  return { index, inBlackout, holding, lit, loop: LOOP, blackout: BLACKOUT };
}

const puzzles = generatePuzzles(['observatory', 'vault', 'archive']);
const obs = puzzles.get('observatory');
const { falls, catalogue, cycleSeconds } = obs.config;

// --- what a player can see -------------------------------------------------

const samples = [];
const { loop } = chainAt(0, falls, cycleSeconds);
for (let t = 0; t < loop; t += 0.05) samples.push({ t, ...chainAt(t, falls, cycleSeconds) });

check('exactly two beacons are lit whenever any are',
  samples.every((s) => s.lit.length === 0 || s.lit.length === 2));

check('every fall gets a readable hold of ~3s',
  falls.every((_, i) => {
    const held = samples.filter((s) => s.index === i && s.holding).length * 0.05;
    return held > 2.5;
  }),
  falls.map((_, i) => samples.filter((s) => s.index === i && s.holding).length * 0.05).join(', '));

const blackoutSeconds = samples.filter((s) => s.inBlackout).length * 0.05;
check('the blackout is long enough to mark the loop start', blackoutSeconds > 2.2,
  `${blackoutSeconds.toFixed(2)}s`);

check('the blackout is longer than any gap between falls',
  blackoutSeconds > FLIGHT * 1.9,
  `blackout ${blackoutSeconds.toFixed(2)}s vs flight gap ${FLIGHT}s`);

check('the loop is within the agreed 15-25s', loop >= 15 && loop <= 25,
  `${loop.toFixed(1)}s`);

// The order must be phase-invariant: a player who arrives late still logs the
// same sequence of falls, because the blackout tells them where it starts.
// A player logs from the BLACKOUT, not from the instant they arrived - that is
// what the blackout is for. Sampling from an arbitrary offset without waiting
// for it produces a rotated sequence, which is the player's mistake to avoid,
// not the room's to fix.
function sequenceFrom(offset) {
  const out = [];
  let last = -1;
  let seenBlackoutHere = false;
  for (let t = offset; t < offset + loop * 3; t += 0.05) {
    const s = chainAt(t, falls, cycleSeconds);
    if (s.inBlackout) { seenBlackoutHere = true; last = -1; continue; }
    if (!seenBlackoutHere) continue;
    if (s.holding && s.index !== last) { out.push(s.index); last = s.index; }
    if (out.length === falls.length) break;
  }
  return out.join(',');
}
check('two players who mounted at different times log the same order',
  sequenceFrom(0) === sequenceFrom(7.3) && sequenceFrom(0) === sequenceFrom(15.8),
  `${sequenceFrom(0)} vs ${sequenceFrom(7.3)} vs ${sequenceFrom(15.8)}`);

// --- reading the room the way a player does --------------------------------

// 1. Watch a loop from the blackout, logging the two plates lit each fall.
const observed = [];
let seenBlackout = false;
let lastIndex = -1;
for (let t = 0; t < loop * 2; t += 0.05) {
  const s = chainAt(t, falls, cycleSeconds);
  if (s.inBlackout) { seenBlackout = true; lastIndex = -1; continue; }
  if (!seenBlackout) continue;
  if (s.holding && s.index !== lastIndex) {
    // "the upper of the two" - the chain is monotone, so the smaller plate
    // number is always the higher beacon.
    const [a, b] = s.lit;
    observed.push({ upper: Math.min(a, b), lower: Math.max(a, b) });
    lastIndex = s.index;
  }
  if (observed.length === falls.length) break;
}

check('a full loop can be logged from the blackout',
  observed.length === falls.length, `logged ${observed.length}/${falls.length}`);

// 2. Convert: count into each plate's NAME by the OTHER plate's number.
const letterOf = (plate, partner) => catalogue[plate - 1].name[partner - 1];

const candidates = observed.map((f) => ({
  high: letterOf(f.upper, f.lower),
  low: letterOf(f.lower, f.upper),
}));

check('every fall offers two DIFFERENT candidate letters',
  candidates.every((c) => c.high !== c.low),
  candidates.map((c) => `${c.high}/${c.low}`).join(' '));

check('the room alone cannot choose - two full candidate strings exist',
  candidates.map((c) => c.high).join('') !== candidates.map((c) => c.low).join(''));

// 3. Apply the neighbour's key.
const neighbour = puzzles.get(obs.needsKeyFromChamberId);
const sides = String(neighbour.key.value).split('-');
const playerAnswer = candidates.map((c, i) => (sides[i] === 'HIGH' ? c.high : c.low)).join('');

check('reading the SKY with the neighbour\'s key gives the server\'s answer',
  playerAnswer === obs.answer,
  `sky reads "${playerAnswer}", server expects "${obs.answer}"`);

console.log(`\n  key held next door: ${neighbour.key.label} = "${neighbour.key.value}"`);
console.log(`  loop ${loop.toFixed(1)}s, ${falls.length} falls, blackout ${blackoutSeconds.toFixed(1)}s`);
console.log(`  falls observed: ${observed.map((f) => `${f.upper}+${f.lower}`).join('  ')}`);
console.log(`  high string: ${candidates.map((c) => c.high).join('')}`);
console.log(`  low  string: ${candidates.map((c) => c.low).join('')}`);
console.log(`  answer: ${obs.answer}`);
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
