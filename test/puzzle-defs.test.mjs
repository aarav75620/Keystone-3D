// The five observation puzzles: does each arrangement actually work?
//
// The point of this file is that it SOLVES every generated puzzle rather than
// inspecting its bookkeeping. A previous bug shipped because the tests checked
// that pointers agreed with each other while the game was unplayable.
//
//   node test/puzzle-defs.test.mjs

import assert from 'node:assert/strict';
import { PUZZLE_DEFS } from '../server/puzzle-defs.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`  PASS  ${name}`); }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

/** Deterministic RNG so a failure can be reproduced from its seed. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build until a definition accepts (some reject unusable arrangements). */
function buildOne(def, seed) {
  for (let i = 0; i < 200; i += 1) {
    const built = def.build(rng(seed + i * 7919));
    if (built) return built;
  }
  return null;
}

const SAFE_LETTERS = /^[ABCDEFGHJKLMNPQRTUVWXYZ]+$/;
const SAFE_DIGITS = /^[23456789]+$/;

for (const [id, def] of Object.entries(PUZZLE_DEFS)) {
  check(`${id}: generates an arrangement`, () => {
    assert.ok(buildOne(def, 1234), 'never produced a usable arrangement');
  });

  // THE test. Everything else is secondary.
  check(`${id}: the key SOLVES the arrangement, every time`, () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const built = buildOne(def, seed * 31);
      assert.ok(built, `seed ${seed}: no arrangement`);
      const solved = def.solve(built.config, { kind: def.keyKind, value: built.keyValue });
      assert.equal(solved, built.answer,
        `seed ${seed}: solving with the key gave "${solved}", expected "${built.answer}"`);
    }
  });

  check(`${id}: a WRONG key does not solve it`, () => {
    // If a different key still produces the answer, the key is not gating
    // anything and the neighbour is decorative.
    let differed = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const a = buildOne(def, seed * 31);
      const b = buildOne(def, seed * 31 + 5000);
      if (!a || !b || a.keyValue === b.keyValue) continue;
      if (def.solve(a.config, { kind: def.keyKind, value: b.keyValue }) !== a.answer) differed += 1;
    }
    assert.ok(differed > 80,
      `only ${differed}/120 wrong keys failed - the key is barely load-bearing`);
  });

  check(`${id}: answers are sayable over a voice call`, () => {
    // The Spire's answer is two compass bearings, and a bearing legitimately
    // contains 0 and 1 (180, 300). Digits are unambiguous spoken as digits -
    // the I/O/S confusion only arises when letters and numbers are mixed - so
    // bearings are checked as plain digits rather than against the safe set.
    const digitsOnly = id === 'spire' ? /^\d+$/ : SAFE_DIGITS;

    for (let seed = 1; seed <= 200; seed += 1) {
      const built = buildOne(def, seed * 17);
      assert.ok(built, `seed ${seed}`);
      const a = built.answer;
      assert.ok(a.length >= 4 && a.length <= 8, `seed ${seed}: length ${a.length} ("${a}")`);
      assert.ok(SAFE_LETTERS.test(a) || digitsOnly.test(a),
        `seed ${seed}: "${a}" mixes letters and digits, or uses banned characters`);
    }
  });

  check(`${id}: arrangements vary between sessions`, () => {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed += 1) {
      const built = buildOne(def, seed * 101);
      if (built) seen.add(`${built.answer}|${built.keyValue}`);
    }
    assert.ok(seen.size > 45, `only ${seen.size}/60 distinct - too memorisable`);
  });

  check(`${id}: config never contains the answer`, () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const built = buildOne(def, seed * 13);
      if (!built) continue;
      const wire = JSON.stringify(built.config);
      assert.ok(!wire.includes(`"${built.answer}"`),
        `seed ${seed}: answer "${built.answer}" sits in the config sent to the client`);
    }
  });

  check(`${id}: observation cycle is 15-25s`, () => {
    const built = buildOne(def, 99);
    const c = built.config.cycleSeconds;
    assert.ok(c >= 15 && c <= 25, `cycle is ${c}s, outside the agreed 15-25s`);
  });
}

// --- per-puzzle properties that matter -------------------------------------

check('observatory: every fall offers two DIFFERENT letters', () => {
  // If a fall's two candidates were the same letter, the neighbour's bit for
  // that fall would be redundant and guessable.
  const def = PUZZLE_DEFS.observatory;
  for (let seed = 1; seed <= 200; seed += 1) {
    const built = buildOne(def, seed * 7);
    for (const [upper, lower] of built.config.falls) {
      const names = built.config.catalogue;
      const a = names[upper - 1].name[lower - 1];
      const b = names[lower - 1].name[upper - 1];
      assert.notEqual(a, b, `seed ${seed}: fall ${upper}/${lower} gives ${a} either way`);
    }
  }
});

check('observatory: the five falls are distinct', () => {
  const def = PUZZLE_DEFS.observatory;
  for (let seed = 1; seed <= 200; seed += 1) {
    const built = buildOne(def, seed * 11);
    const keys = built.config.falls.map((f) => f.join('-'));
    assert.equal(new Set(keys).size, 5, `seed ${seed}: repeated fall`);
  }
});

check('vault: the shear line is unique in the cycle', () => {
  // Two all-lit frames would give the player two candidate readings.
  const def = PUZZLE_DEFS.vault;
  for (let seed = 1; seed <= 200; seed += 1) {
    const built = buildOne(def, seed * 19);
    const { collars, drumOffsets, faces, seatedStep } = built.config;
    let count = 0;
    for (let s = 0; s < faces; s += 1) {
      if (drumOffsets.every((off) => !collars[(off + s) % faces].thrown)) count += 1;
    }
    assert.equal(count, 1, `seed ${seed}: ${count} seated frames`);
    assert.ok(seatedStep >= 0 && seatedStep < faces);
  }
});

check('vault: at the shear line the drums show exactly the live collars', () => {
  // The self-check a player can perform: the six numbers they collect should be
  // the six collars that are not struck through.
  const def = PUZZLE_DEFS.vault;
  for (let seed = 1; seed <= 120; seed += 1) {
    const built = buildOne(def, seed * 23);
    const { collars, drumOffsets, faces, seatedStep } = built.config;
    const shown = drumOffsets.map((off) => collars[(off + seatedStep) % faces].number).sort();
    const live = collars.filter((c) => !c.thrown).map((c) => c.number).sort();
    assert.deepEqual(shown, live, `seed ${seed}: shown glyphs are not the live set`);
  }
});

check('engine-room: gauge-to-station mapping is non-monotonic', () => {
  // If gauges lined up with stations in order, the alignment could be guessed
  // without ever watching the slug.
  const def = PUZZLE_DEFS['engine-room'];
  let monotonic = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const s = buildOne(def, seed * 29).config.gaugeStations;
    if (s.every((v, i) => i === 0 || v > s[i - 1])) monotonic += 1;
  }
  assert.ok(monotonic < 10, `${monotonic}/200 mappings were in order - too guessable`);
});

check('engine-room: two stations are decoys', () => {
  const def = PUZZLE_DEFS['engine-room'];
  for (let seed = 1; seed <= 120; seed += 1) {
    const c = buildOne(def, seed * 37).config;
    assert.equal(c.stationDigits.length, 6);
    assert.equal(new Set(c.gaugeStations).size, 4, `seed ${seed}: gauges share a station`);
  }
});

check('archive: gap sizes are unique, so each identifies one withdrawal', () => {
  const def = PUZZLE_DEFS.archive;
  for (let seed = 1; seed <= 200; seed += 1) {
    const w = buildOne(def, seed * 41).config.withdrawals;
    assert.equal(new Set(w.map((x) => x.size)).size, 4, `seed ${seed}: duplicate gap size`);
  }
});

check('archive: every call number resolves to exactly one shelf strip', () => {
  const def = PUZZLE_DEFS.archive;
  for (let seed = 1; seed <= 200; seed += 1) {
    const c = buildOne(def, seed * 43).config;
    for (const w of c.withdrawals) {
      const n = Number(w.callNumber);
      const hits = c.strips.filter((s) => n >= s.lo && n <= s.hi);
      assert.equal(hits.length, 1, `seed ${seed}: call ${n} matched ${hits.length} strips`);
    }
  }
});

check('archive: the four sections start with different letters', () => {
  // Two withdrawals resolving to words with the same initial would make the
  // answer ambiguous to read back.
  const def = PUZZLE_DEFS.archive;
  for (let seed = 1; seed <= 200; seed += 1) {
    const c = buildOne(def, seed * 47).config;
    const initials = c.withdrawals.map((w) => {
      const n = Number(w.callNumber);
      return c.strips.find((s) => n >= s.lo && n <= s.hi).word[0];
    });
    assert.equal(new Set(initials).size, 4, `seed ${seed}: repeated initial ${initials}`);
  }
});

check('spire: the lanterns form one closed 5-cycle', () => {
  // Two separate loops would leave the player with no single chain to cut.
  const def = PUZZLE_DEFS.spire;
  for (let seed = 1; seed <= 200; seed += 1) {
    const l = buildOne(def, seed * 53).config.lanterns;
    let cur = 0;
    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      assert.ok(!seen.has(cur), `seed ${seed}: loop closed early`);
      seen.add(cur);
      cur = l[cur].answers;
    }
    assert.equal(seen.size, 5, `seed ${seed}: only ${seen.size} lanterns in the loop`);
    assert.equal(cur, 0, `seed ${seed}: loop did not close`);
  }
});

check('spire: blink counts are not all identical', () => {
  const def = PUZZLE_DEFS.spire;
  for (let seed = 1; seed <= 200; seed += 1) {
    const l = buildOne(def, seed * 59).config.lanterns;
    assert.ok(new Set(l.map((x) => x.blinks)).size > 1,
      `seed ${seed}: every lantern blinks the same, so the rule teaches nothing`);
  }
});

check('spire: every lantern calls one and is called by one', () => {
  const def = PUZZLE_DEFS.spire;
  for (let seed = 1; seed <= 120; seed += 1) {
    const l = buildOne(def, seed * 61).config.lanterns;
    assert.equal(new Set(l.map((x) => x.answers)).size, 5, `seed ${seed}: a lantern is called twice`);
    for (let i = 0; i < 5; i += 1) {
      assert.notEqual(l[i].answers, i, `seed ${seed}: lantern ${i} calls itself`);
    }
  }
});

console.log(results.join('\n'));
console.log(process.exitCode ? '\nFAILURES PRESENT' : '\nall green');
