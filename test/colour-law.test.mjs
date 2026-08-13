// Does any room's ART claim to hold something for another chamber?
//
// Pointer-violet (#8f7bff) is the game's one global semantic: "this value
// belongs to a different chamber". It is the thing that makes cross-room
// dependency legible at a glance, which only works while it is never wrong.
//
// It went wrong. The Engine Room had `PREFIX KC-` and a valve schedule captioned
// "REPORT ON REQUEST" stencilled in violet, and the Archive stamped a violet
// "PREFIX" redaction on every eighth card. Both were phase-3 art from when the
// Engine Room was hand-wired to hold a fixed value for the Archive. Once the
// ring became dynamic they were lies in the one colour that must not lie: they
// advertised a pairing the ring may never create, and sent players to a chamber
// that might have nobody standing in it. Aarav hit exactly that - two players in
// the Archive and the Spire, with the Archive's own art pointing at the Engine
// Room.
//
// Static art cannot know who holds what. The ring is generated per run over the
// OCCUPIED chambers only, so the sole honest carrier of a cross-room value is
// the key on the Fragment panel, which the server assigns.
//
//   node test/colour-law.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const roomsDir = join(here, '../public/js/rooms');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const POINTER_VIOLET = /#8f7bff|0x8f7bff/i;
const files = readdirSync(roomsDir).filter((f) => f.endsWith('.js'));

// --- 1. no room PAINTS in pointer-violet -----------------------------------

const offenders = [];
for (const file of files) {
  const src = readFileSync(join(roomsDir, file), 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    // The constant's own declaration is fine; using it to paint is not.
    if (/^\s*(const|let)\s+\w*POINTER_VIOLET/.test(line)) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;

    const paints = /fillStyle|strokeStyle|setHex|new THREE\.Color|color:|emissive/.test(line);
    const usesConstant = /POINTER_VIOLET/.test(line);
    if (paints && (usesConstant || POINTER_VIOLET.test(line))) {
      offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 76)}`);
    }
  });
}

check('no room paints anything in pointer-violet',
  offenders.length === 0,
  offenders.join('\n        '));

// --- 2. no room NAMES another chamber in drawn text ------------------------

// A room may reference chambers in data the SERVER supplies (the Spire's
// lantern list is generated per run). What it must not do is draw a chamber
// name into a texture, because that text survives into runs where the chamber
// is empty.
const CHAMBER_WORDS = /'[^']*\b(ARCHIVE|ENGINE ROOM|OBSERVATORY|VAULT|SPIRE|VESTIBULE)\b[^']*'/i;

const named = [];
for (const file of files) {
  const src = readFileSync(join(roomsDir, file), 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (!/drawTrackedText|fillText/.test(line)) return;
    if (!CHAMBER_WORDS.test(line)) return;
    // A room naming ITSELF on its own signage is correct and expected.
    const self = file.replace('.js', '').replace('-', ' ');
    if (new RegExp(self, 'i').test(line)) return;
    named.push(`${file}:${i + 1}  ${line.trim().slice(0, 76)}`);
  });
}

check('no room draws another chamber\'s name into a texture',
  named.length === 0,
  named.join('\n        '));

// --- 3. the phase-3 pairing is really gone ---------------------------------

const engine = readFileSync(join(roomsDir, 'engine-room.js'), 'utf8');
const archive = readFileSync(join(roomsDir, 'archive.js'), 'utf8');

check('the Engine Room no longer stencils a prefix for the Archive',
  !/PREFIX\s+KC-/.test(engine),
  'the hand-wired Engine-Room-to-Archive payload is back');

check('the Archive no longer redacts cards with a PREFIX stamp',
  !/'PREFIX'/.test(archive),
  'cards are claiming a missing half that lives in another room');

// Comments stripped: the removal is DESCRIBED in a comment above the code that
// replaced it, and a raw scan flags its own documentation. Same trap as the
// puzzle.prompt check in brief.test.mjs.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('nothing is captioned as a payload for elsewhere',
  !/REPORT ON REQUEST/.test(strip(engine) + strip(archive)));

console.log(`\n  ${files.length} room files scanned`);
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
