// Does every chamber actually get a briefing, and does it stay a briefing?
//
// The Fragment panel threw on every open in every room for the whole of Phase
// 5: renderFragment() read `puzzle.prompt.instruction`, the observation puzzles
// stopped sending `prompt`, and nothing noticed because no test opened a panel.
// The panel silently never appeared and all three screens sat at "STANDBY".
//
// So this file checks the CONTRACT the panel renders against, not the panel:
// every chamber ships a brief, the brief tells the player what to submit, and
// the brief never carries a value from this session - the moment it does it has
// stopped briefing and started answering.
//
//   node test/brief.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePuzzles, serializePuzzle } from '../server/puzzles.js';
import { PUZZLE_DEFS } from '../server/puzzle-defs.js';

const here = dirname(fileURLToPath(import.meta.url));
const hud = readFileSync(join(here, '../public/js/hud.js'), 'utf8');
const html = readFileSync(join(here, '../public/index.html'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const ALL = ['archive', 'engine-room', 'observatory', 'vault', 'spire'];
const chamberName = (id) => `The ${id}`;

// --- 1. every chamber ships one -------------------------------------------

check('every puzzle def defines a brief',
  ALL.every((id) => PUZZLE_DEFS[id]?.brief),
  ALL.filter((id) => !PUZZLE_DEFS[id]?.brief).join(', ') || '');

const puzzles = generatePuzzles(ALL);
const wire = new Map(ALL.map((id) => [id, serializePuzzle(puzzles.get(id), { chamberName })]));

check('the brief survives serialization to the client',
  ALL.every((id) => wire.get(id).brief?.title && wire.get(id).brief?.lines?.length));

check('every brief says what to submit',
  ALL.every((id) => typeof wire.get(id).brief.submit === 'string' && wire.get(id).brief.submit),
  ALL.map((id) => `${id}:${wire.get(id).brief.submit}`).join(' | '));

// The panel says "You need the X from Y". Without the label it can only say
// "the key", which is not enough for two people who cannot see each other's
// rooms to work out what to read aloud.
check('every chamber knows the NAME of the key it is missing',
  ALL.every((id) => wire.get(id).needsKeyLabel),
  ALL.map((id) => `${id} needs ${wire.get(id).needsKeyLabel}`).join(' | '));

check('the key it needs is the one its neighbour holds',
  ALL.every((id) => {
    const neighbourId = puzzles.get(id).needsKeyFromChamberId;
    return wire.get(id).needsKeyLabel === puzzles.get(neighbourId).key.label;
  }));

// --- 2. a brief never becomes an answer ------------------------------------

// Static per chamber TYPE. If a brief ever varied by session it could only be
// carrying seeded state, which is the one thing it must never do.
check('briefs are identical across two independent sessions',
  (() => {
    const a = generatePuzzles(ALL);
    const b = generatePuzzles(ALL);
    return ALL.every((id) =>
      JSON.stringify(a.get(id).brief) === JSON.stringify(b.get(id).brief));
  })());

check('no brief contains its own answer, over 200 sessions',
  (() => {
    for (let i = 0; i < 200; i += 1) {
      const p = generatePuzzles(ALL);
      for (const id of ALL) {
        const q = p.get(id);
        if (JSON.stringify(q.brief).includes(q.answer)) return false;
      }
    }
    return true;
  })());

check('no brief contains the key value that unlocks it',
  (() => {
    for (let i = 0; i < 200; i += 1) {
      const p = generatePuzzles(ALL);
      for (const id of ALL) {
        const neighbour = p.get(p.get(id).needsKeyFromChamberId);
        if (JSON.stringify(p.get(id).brief).includes(String(neighbour.key.value))) return false;
      }
    }
    return true;
  })());

// --- 3. the renderer can render what the server sends ----------------------

// Mirrors renderFragment()'s classifier exactly. A brief line is a heading only
// if it is short and shouted; everything else is prose. A prose line wrongly
// promoted to a heading loses its wrapping and its meaning.
const isHeading = (line) => line.length < 40 && line === line.toUpperCase() && /[A-Z]/.test(line);

const misread = [];
for (const id of ALL) {
  for (const line of wire.get(id).brief.lines) {
    if (!line) continue;
    // A line ending in a full stop is a sentence, never a section head.
    if (isHeading(line) && /[.:,]$/.test(line)) misread.push(`${id}: "${line}"`);
  }
}
check('no prose line is mistaken for a section heading', misread.length === 0, misread.join(' | '));

const heads = [];
for (const id of ALL) {
  for (const line of wire.get(id).brief.lines) {
    if (line && isHeading(line)) heads.push(`${id}: ${line}`);
  }
}
console.log(`\n  headings detected: ${heads.join(' | ') || 'none'}`);

// --- 4. the wiring the panel depends on still exists -----------------------

for (const id of ['fragBriefTitle', 'fragBrief', 'fragAnswerFormat', 'fragNeedLabel', 'fragNeedFrom']) {
  check(`index.html still has #${id}`, html.includes(`id="${id}"`));
  check(`hud.js still binds ${id}`, hud.includes(`${id}:`) || hud.includes(`el.${id}`));
}

// The exact shape that broke. Nothing may read a field the server stopped
// sending.
// Comments stripped first: the fix is DESCRIBED in a comment above the code
// that replaced it, and a naive source scan would flag its own documentation.
const hudCode = hud.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('renderFragment no longer reads the deleted puzzle.prompt',
  !/puzzle\.prompt/.test(hudCode),
  'puzzle.prompt was removed from the wire in Phase 5; reading it throws');

console.log(`\n  ${ALL.length} chambers briefed`);
for (const id of ALL) {
  console.log(`  ${id.padEnd(13)} ${wire.get(id).brief.title}  ->  ${wire.get(id).brief.submit}`);
}
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
