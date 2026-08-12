// Does the Vault's ANIMATION actually show the answer?
//
// The generator is already tested. This checks the room's own timing functions
// agree with it: that the shear line happens once per cycle, that the drums
// show the live collars at that instant, and that reading the room the way a
// player would produces the answer the server is expecting.
//
// Simulating the room's maths rather than rendering it - the geometry is a
// separate concern, but if the numbers are wrong the picture cannot be right.

import { generatePuzzles } from '../server/puzzles.js';
import { defFor } from '../server/puzzle-defs.js';

// Mirrors of the room's timing functions.
function bankPhase(elapsed, faces, seatedStep, beat) {
  const cycle = (faces + 1) * beat;
  let t = ((elapsed % cycle) + cycle) % cycle;
  for (let step = 0; step < faces; step += 1) {
    const isSeated = step === seatedStep;
    const span = isSeated ? beat * 2 : beat;
    if (t < span) {
      const CLICK = isSeated ? 0.88 : 0.78;
      const f = t / span;
      return { step, seated: isSeated && f <= CLICK, holding: f <= CLICK };
    }
    t -= span;
  }
  return { step: faces - 1, seated: false, holding: false };
}

const faceAt = (offsets, i, step, faces) => (offsets[i] + step) % faces;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const puzzles = generatePuzzles(['vault', 'archive', 'spire']);
const vault = puzzles.get('vault');
const cfg = vault.config;
const { collars, drumOffsets, seatedStep, faces, cycleSeconds } = cfg;
const BEAT = cycleSeconds / (faces + 1);

// Sample a whole cycle at 20Hz, exactly as frames would.
const samples = [];
for (let t = 0; t < cycleSeconds; t += 0.05) {
  const phase = bankPhase(t, faces, seatedStep, BEAT);
  const lit = drumOffsets.map((_, i) => !collars[faceAt(drumOffsets, i, phase.step, faces)].thrown);
  samples.push({ t, phase, litCount: lit.filter(Boolean).length });
}

const allLit = samples.filter((s) => s.litCount === 6);
check('all six backlights come on at some point', allLit.length > 0);

check('every all-lit sample is the seated step',
  allLit.every((s) => s.phase.step === seatedStep),
  `steps seen: ${[...new Set(allLit.map((s) => s.phase.step))].join(',')}`);

const litSeconds = allLit.length * 0.05;
check('the shear line is readable for over 2s', litSeconds > 2,
  `only ${litSeconds.toFixed(2)}s`);

// The dwell: the seated step should last about twice a normal one.
const stepDurations = new Map();
for (const s of samples) {
  stepDurations.set(s.phase.step, (stepDurations.get(s.phase.step) || 0) + 0.05);
}
const seatedDur = stepDurations.get(seatedStep);
const others = [...stepDurations.entries()].filter(([k]) => k !== seatedStep).map(([, v]) => v);
const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
check('the bank DWELLS on the shear line', seatedDur > avgOther * 1.6,
  `seated ${seatedDur.toFixed(2)}s vs average ${avgOther.toFixed(2)}s`);

// Near-misses: frames one bar short should exist, so a careless glance is
// punished and the player has to actually watch.
const nearMiss = samples.filter((s) => s.litCount === 5).length;
check('there are near-miss frames (5 of 6 lit)', nearMiss > 0);

// THE test: read the room at the shear line, exactly as a player would, and
// check it produces the answer the server will accept.
const seatedSample = allLit[Math.floor(allLit.length / 2)];
const shown = drumOffsets.map((_, i) =>
  collars[faceAt(drumOffsets, i, seatedSample.phase.step, faces)]);

check('at the shear line no drum shows a thrown bolt',
  shown.every((c) => !c.thrown));

check('the six drums show exactly the six live collars',
  JSON.stringify(shown.map((c) => c.number).sort())
  === JSON.stringify(collars.filter((c) => !c.thrown).map((c) => c.number).sort()),
  'the self-check a player performs would fail');

// Apply the neighbour's key to what the room is showing.
const neighbour = puzzles.get(vault.needsKeyFromChamberId);
const match = /SLOT\s+(\d)\s*\/\s*(.+)/i.exec(String(neighbour.key.value));
const start = Number(match[1]);
const toward = /PANELS/i.test(match[2]) ? -1 : 1;

const read = [];
for (let i = 0; i < 3; i += 1) {
  const slot = ((start - 1 + toward * i) % 6 + 6) % 6;
  read.push(shown[slot].number);
}
const playerAnswer = read.join('');

check('reading the ROOM with the neighbour\'s key gives the server\'s answer',
  playerAnswer === vault.answer,
  `room reads "${playerAnswer}", server expects "${vault.answer}"`);

console.log(`\n  key held next door: ${neighbour.key.label} = "${neighbour.key.value}"`);
console.log(`  shear line at step ${seatedStep}, t≈${seatedSample.t.toFixed(1)}s of ${cycleSeconds}s`);
console.log(`  drums read: ${shown.map((c) => c.number).join(' ')}`);
console.log(`  answer: ${vault.answer}`);
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
