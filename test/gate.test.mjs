// Can the gate be reached without doing the work?
//
// The Vestibule opens on a value assembled from one shard per chamber, and the
// only thing making that value worth anything is WHEN each shard is released. A
// shard sent early is the ending sitting in devtools.
//
//   node test/gate.test.mjs

import { buildGate } from '../server/rooms.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const ALL = ['archive', 'engine-room', 'observatory', 'vault', 'spire', 'vestibule'];

// --- one shard per chamber, and they concatenate to the value --------------

for (const n of [2, 3, 4, 5, 6]) {
  const ids = ALL.slice(0, n);
  const gate = buildGate(ids);

  const inOrder = ids.map((id) => gate.shards.get(id));
  check(`crew ${n}: one shard per chamber, numbered 1..${n}`,
    gate.shards.size === n && inOrder.every((s, i) => s.index === i + 1 && s.of === n));

  check(`crew ${n}: shards concatenate in order to the gate value`,
    inOrder.map((s) => s.text).join('') === gate.value,
    `${inOrder.map((s) => s.text).join('')} vs ${gate.value}`);

  check(`crew ${n}: no single shard is the whole value`,
    n === 1 || inOrder.every((s) => s.text !== gate.value));
}

// --- the value survives being said out loud --------------------------------

// The crew reads shards to each other down a voice call. 0/O and 1/I are the
// pairs that get misheard, so the alphabet excludes them - the same rule the
// chamber answers are held to in puzzle-defs.test.mjs.
let unsayable = 0;
for (let i = 0; i < 400; i += 1) {
  const gate = buildGate(ALL);
  if (!/^[23456789]+$/.test(gate.value)) unsayable += 1;
}
check('gate values never contain 0 or 1, over 400 builds', unsayable === 0,
  `${unsayable}/400 unsayable`);

// --- a gate is not guessable ------------------------------------------------

const seen = new Set();
for (let i = 0; i < 400; i += 1) seen.add(buildGate(ALL).value);
check('gate values vary between runs', seen.size > 300, `${seen.size}/400 distinct`);

check('a full-crew gate is 12 characters', buildGate(ALL).value.length === 12);

// --- the release rule, stated ----------------------------------------------

// buildGate holds every shard from the start; the withholding happens in
// sendPuzzles, which only puts `text` on the wire once that chamber is solved.
// This asserts the server still does that, since it is the whole security
// property and it lives in one line that would be easy to "simplify".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(here, '../server/index.js'), 'utf8');

check('a shard is only put on the wire when its chamber is solved',
  /text:\s*solved\s*\?\s*shard\.text\s*:\s*null/.test(index),
  'sendPuzzles is sending shard text unconditionally - the ending is readable early');

check('the gate is checked only once every chamber is open',
  /everySolved\s*&&\s*room\.gate\s*&&\s*!room\.gate\.open/.test(index));

check('opening the gate moves EVERY player to the vestibule',
  /for \(const p2 of room\.players\.values\(\)\) p2\.chamberId = 'vestibule';/.test(index));

console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
