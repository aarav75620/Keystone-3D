// Does the Vault RENDER what its logic thinks it renders?
//
// vault-room.test.mjs simulates bankPhase() and faceAt() and proves the puzzle
// is solvable. It passed green through two bugs that made the room unsolvable
// on screen:
//
//   1. drawGlyph() switched on numeric indices while the collars were drawn
//      from the server's glyph NAMES, so all eight collars fell to `default`
//      and rendered the same mark. Nothing to match the drums against.
//   2. The drums were seated at k * DETENT_STEP, which parks a cell BOUNDARY in
//      the read window - and the half-glyph showing was face (6-k), not the
//      face k that faceAt() reports and lights the drum from.
//
// Both are agreements between two modules that the logic test cannot see,
// because it never touches the renderer. This file checks the contracts
// themselves, by reading the source rather than trusting a second copy of the
// same arithmetic.
//
//   node test/vault-render.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePuzzles } from '../server/puzzles.js';

const here = dirname(fileURLToPath(import.meta.url));
const room = readFileSync(join(here, '../public/js/rooms/vault.js'), 'utf8');
const defs = readFileSync(join(here, '../server/puzzle-defs.js'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

// --- 1. the glyph vocabulary is shared -------------------------------------

const kinds = /const GLYPH_KINDS = \[([^\]]+)\]/.exec(defs)[1]
  .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

const drawGlyph = /function drawGlyph[\s\S]*?\n}/.exec(room)[0];
const handled = new Set(
  [...drawGlyph.matchAll(/case '([a-z-]+)'/g)].map((m) => m[1]),
);
const fallback = /default: \/\/ '([a-z-]+)'/.exec(drawGlyph)?.[1];
if (fallback) handled.add(fallback);

check('the server emits 8 glyph kinds', kinds.length === 8, kinds.join(','));

check('drawGlyph draws every glyph the server can emit',
  kinds.every((k) => handled.has(k)),
  `unhandled: ${kinds.filter((k) => !handled.has(k)).join(', ') || 'none'}`);

check('drawGlyph has no cases the server never emits',
  [...handled].every((k) => kinds.includes(k)),
  `orphaned: ${[...handled].filter((k) => !kinds.includes(k)).join(', ') || 'none'}`);

check('drawGlyph is keyed by NAME, never by index',
  !/case \d+:/.test(drawGlyph),
  'a numeric case means the collars and the drums are speaking different languages');

// Only ONE kind may reach the default arm, or two glyphs render identically and
// the player cannot tell their collars apart.
const distinct = new Set([...handled]);
check('all 8 glyphs render as distinct marks', distinct.size === 8,
  `${distinct.size} distinct: ${[...distinct].join(',')}`);

// --- 2. the drums show the face faceAt() reports ---------------------------

// Recovered from the room, not re-derived here: if someone edits the seating
// formula, this test reads the edit.
const angleSrc = /const drumAngle = \(k\) => ([^;]+);/.exec(room);
check('the room seats drums through a named drumAngle()', !!angleSrc,
  'seating inline again makes this contract unverifiable');

const drumAngle = angleSrc && new Function('k', 'DETENT_STEP', `return ${angleSrc[1]};`);
const DETENT_STEP = (Math.PI * 2) / 8;

if (drumAngle) {
  // Three's CylinderGeometry puts uv.x = 0 at theta = 0, i.e. +Z; the room then
  // rotates X by +90 deg, sending +Z to -Y. So texture u sits at world angle
  // 2*PI*u - PI/2 about the drum axis, and the read window faces -X (angle PI).
  const cellAtWindow = (k) => {
    const A = drumAngle(k, DETENT_STEP);
    let u = 0.75 - A / (Math.PI * 2);
    u -= Math.floor(u);
    return { cell: Math.floor(u * 8) % 8, frac: (u * 8) % 1 };
  };

  const seats = Array.from({ length: 8 }, (_, k) => cellAtWindow(k));

  check('seating face k puts cell k in the window',
    seats.every((s, k) => s.cell === k),
    seats.map((s, k) => `${k}->${s.cell}`).join(' '));

  check('the glyph is CENTRED in the window, not on a seam',
    seats.every((s) => Math.abs(s.frac - 0.5) < 1e-6),
    seats.map((s) => s.frac.toFixed(3)).join(' '));

  check('consecutive faces are exactly one detent apart',
    Array.from({ length: 7 }, (_, k) =>
      Math.abs(Math.abs(drumAngle(k + 1, DETENT_STEP) - drumAngle(k, DETENT_STEP)) - DETENT_STEP) < 1e-9,
    ).every(Boolean));
}

// --- 3. the tell is carried by the drum, not only by trim ------------------

check('an unseated drum is dimmed on the drum itself',
  /instanceColor\.setXYZ/.test(room) && /DEAD_DRUM_LEVEL/.test(room),
  'if only a bar beside the drum changes, six drums look identical at play distance');

check('the emissive glyph is dimmed too, not just the albedo',
  /totalEmissiveRadiance \*= vColor/.test(room),
  'an emissive glyph ignores instanceColor and stays lit on a dead drum');

check('the drum geometry carries a white color attribute',
  /setAttribute\(\s*'color'/.test(room),
  'vertexColors with no color attribute reads as BLACK and kills the whole drum');

check('the read window is masked by a shroud, not just outlined',
  /CylinderGeometry\([\s\S]{0,200}windowHalfAngle/.test(room),
  'an unmasked drum shows 3-4 glyphs at once and the player cannot tell which counts');

// --- 4. the room still renders with no puzzle ------------------------------

const fallbackRegister = /const BOLT_REGISTER = \[([\s\S]*?)\];/.exec(room)[1];
const entries = [...fallbackRegister.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
check('the no-puzzle fallback register has 8 entries', entries.length === 8);
check('every fallback entry has glyph, num AND code',
  entries.every((e) => /glyph:/.test(e) && /num:/.test(e) && /code:/.test(e)),
  'a missing field throws in drawTrackedText before the room ever draws');
check('the fallback uses the shared glyph vocabulary',
  entries.every((e) => kinds.includes(/glyph: '([a-z-]+)'/.exec(e)?.[1])),
  'the fallback drew room codes as glyphs, which drawGlyph cannot render');

// --- 5. and the puzzle it all serves is still solvable ---------------------

const vault = generatePuzzles(['vault', 'archive', 'observatory']).get('vault');
const { collars, drumOffsets, seatedStep } = vault.config;
const shown = drumOffsets.map((o) => collars[(o + seatedStep) % 8]);
check('at the shear line every window shows a LIVE collar',
  shown.every((c) => !c.thrown),
  shown.map((c) => `${c.glyph}${c.thrown ? '(THROWN)' : ''}`).join(' '));
check('the six windows show six DIFFERENT glyphs',
  new Set(shown.map((c) => c.glyph)).size === 6);

console.log(`\n  shear-line windows: ${shown.map((c) => `${c.glyph}=${c.number}`).join('  ')}`);
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
