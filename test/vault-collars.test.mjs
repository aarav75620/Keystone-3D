// Can the player actually SEE the bolt register?
//
// The collar ring is the Vault's cross-room payload: eight numbers, two struck
// through, that the drums are matched against. It shipped with the ring at
// z = 3.17 and a radius of 1.62 x 1.05, which put six of the eight collars
// INSIDE the door leaves - the leaves span x +/-1.35, y 0..2.3 with their front
// face at z = 3.10, so those six sat two centimetres behind solid steel. Only
// the two at x = +/-1.62 cleared the door edge.
//
// The player saw two numbers out of eight. No test noticed, because every test
// checked the register's DATA and none checked whether it was on screen.
//
// This file derives the door and the ring from their own sources and asserts
// the geometry that has to hold for the register to be readable at all.
//
//   node test/vault-collars.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const room = readFileSync(join(here, '../public/js/rooms/vault.js'), 'utf8');
const kit = readFileSync(join(here, '../public/js/roomkit/geometry.js'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  if (!ok) failures += 1;
};

const num = (src, re, label) => {
  const m = re.exec(src);
  if (!m) throw new Error(`could not read ${label} from source`);
  return parseFloat(m[1]);
};

// --- the door, from the room's call and the roomkit's construction ----------

const doorW = num(room, /makeSealedDoor\(\{[\s\S]{0,80}?width:\s*([\d.]+)/, 'door width');
const doorH = num(room, /makeSealedDoor\(\{[\s\S]{0,140}?height:\s*([\d.]+)/, 'door height');
const doorZ = num(room, /door\.group\.position\.set\(0,\s*0,\s*halfD\s*-\s*([\d.]+)\)/, 'door z inset');
const halfD = 6.6 / 2;
const doorGroupZ = halfD - doorZ;

// leaf: BoxGeometry(width/2 - 0.015, height, LEAF_D) at local z = -LEAF_OFF
const leafD = num(kit, /const leafGeometry = new THREE\.BoxGeometry\(.*?height,\s*([\d.]+)\)/, 'leaf depth');
const leafOff = num(kit, /leaf\.position\.set\(.*?height \/ 2,\s*-([\d.]+)\)/, 'leaf z offset');
const leafFrontZ = doorGroupZ - leafOff - leafD / 2;   // smaller z = nearer the room
const leafHalfW = doorW / 2;

// --- the ring, from the room ------------------------------------------------

const ringRX = num(room, /const RING_RX = ([\d.]+)/, 'RING_RX');
const ringRY = num(room, /const RING_RY = ([\d.]+)/, 'RING_RY');
const ringCY = num(room, /const RING_CY = ([\d.]+)/, 'RING_CY');
const collarZInset = num(room, /const COLLAR_Z = halfD - ([\d.]+)/, 'COLLAR_Z');
const collarZ = halfD - collarZInset;
const collarR = num(room, /new THREE\.CylinderGeometry\(([\d.]+), [\d.]+, [\d.]+, 12\)/, 'collar radius');
const collarLen = num(room, /new THREE\.CylinderGeometry\([\d.]+, [\d.]+, ([\d.]+), 12\)/, 'collar length');
const hasPhase = /const RING_PHASE = Math\.PI \/ register\.length/.test(room);

const N = 8;
const phase = hasPhase ? Math.PI / N : 0;
const collars = Array.from({ length: N }, (_, i) => {
  const a = (i / N) * Math.PI * 2 - Math.PI / 2 + phase;
  return { i, x: Math.cos(a) * ringRX, y: ringCY + Math.sin(a) * ringRY };
});

// --- 1. the ring is in FRONT of the door, not inside it ---------------------

// The collar body straddles COLLAR_Z; its rearmost face must clear the leaf.
const collarBackZ = collarZ + collarLen / 2;
check('the collar bodies sit in front of the door leaf',
  collarBackZ < leafFrontZ,
  `collar back z=${collarBackZ.toFixed(3)} vs leaf front z=${leafFrontZ.toFixed(3)} — the ring is buried`);

const sealOff = num(kit, /seal\.position\.set\(0,\s*height \* [\d.]+,\s*-([\d.]+)\)/, 'seal z offset');
const sealD = num(kit, /const sealGeometry = new THREE\.BoxGeometry\(width, [\d.]+, ([\d.]+)\)/, 'seal depth');
const sealFrontZ = doorGroupZ - sealOff - sealD / 2;
check('the collar bodies also clear the seal bar',
  collarBackZ < sealFrontZ,
  `collar back z=${collarBackZ.toFixed(3)} vs seal front z=${sealFrontZ.toFixed(3)}`);

// --- 2. every collar lands ON the leaf, fully -------------------------------

const offLeaf = collars.filter((c) =>
  Math.abs(c.x) + collarR > leafHalfW || c.y - collarR < 0 || c.y + collarR > doorH);
check('all eight collars land fully on the door face',
  offLeaf.length === 0,
  offLeaf.map((c) => `#${c.i} at (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`).join(', '));

// --- 3. they do not overlap each other --------------------------------------

const overlaps = [];
for (let a = 0; a < N; a += 1) {
  for (let b = a + 1; b < N; b += 1) {
    const d = Math.hypot(collars[a].x - collars[b].x, collars[a].y - collars[b].y);
    if (d < collarR * 2) overlaps.push(`#${a}/#${b} ${d.toFixed(2)}m apart`);
  }
}
check('no two collars overlap', overlaps.length === 0, overlaps.join(', '));

// --- 4. none is centred on the seal bar -------------------------------------

// The bar runs across the door at height*0.52 and is 0.07 tall. A number
// stencilled across it is unreadable.
const barY = doorH * 0.52;
const onBar = collars.filter((c) => Math.abs(c.y - barY) < 0.035 + collarR * 0.6);
check('no collar is centred on the seal bar',
  onBar.length === 0,
  onBar.map((c) => `#${c.i} at y=${c.y.toFixed(2)} vs bar y=${barY.toFixed(2)}`).join(', '));

check('the ring is rotated off the cardinal points', hasPhase,
  'without a half-step phase, two collars land on the seal bar');

// --- 5. the stencil fits its collar -----------------------------------------

const stencilW = num(room, /width: ([\d.]+),\n      height: [\d.]+,\n      position: \[slot\.x/, 'stencil width');
check('the stencil fits within the collar face',
  stencilW <= collarR * 2,
  `stencil ${stencilW}m on a ${(collarR * 2).toFixed(2)}m collar`);

console.log(`\n  door leaf: x +/-${leafHalfW}, y 0..${doorH}, front z ${leafFrontZ.toFixed(2)}`);
console.log(`  ring: rx ${ringRX} ry ${ringRY} at z ${collarZ.toFixed(2)} (back face ${collarBackZ.toFixed(3)})`);
console.log(`  collars: ${collars.map((c) => `(${c.x.toFixed(2)},${c.y.toFixed(2)})`).join(' ')}`);
console.log(failures ? '\nFAILURES PRESENT' : '\nall green');
process.exit(failures ? 1 : 0);
