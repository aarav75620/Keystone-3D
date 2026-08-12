// puzzle-defs.js - the five observation puzzles.
//
// One definition per chamber. Each generates a seeded arrangement, states the
// answer, and hands the room whatever it needs to paint that arrangement.
//
// THE SHAPE EVERY PUZZLE MUST HAVE (the project owner rejected the first
// implementation for missing it):
//
//   observe -> deduce -> derive
//
// The player watches something physical in their 3D room, works out the rule
// governing it, and derives a code. The neighbour's key gates HOW to read or
// order what they worked out - it is never the answer, and it is inert in the
// hands of someone who has not done the observation. Reading a value aloud is
// transcription, not a puzzle.
//
// Every definition exports:
//   build(rand)  -> { answer, config, keyValue, keyLabel, keyKind }
//   solve(config, key) -> the answer, derived the way a player would
//
// `solve` exists so the tests can PROVE each arrangement is solvable rather
// than assuming it. An earlier bug shipped because the tests checked that the
// bookkeeping agreed with itself instead of actually solving anything.
//
// `config` is sent to the client: it describes what is painted on that room's
// walls, which the player standing there can see anyway. The answer never is.
//
// Every `solve` REJECTS a key of the wrong kind before parsing it. Without that
// guard a solver will happily parse a foreign key's string - the Observatory
// splitting "BLUE - VAULT" on its hyphen, say - and can coincidentally produce
// its own answer, which silently makes the neighbour optional. Caught by
// test/ring.test.mjs trying every key against every chamber.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Letters that survive a voice call. No I/O/S - they collide with 1/0/5. */
const SAFE_LETTERS = 'ABCDEFGHJKLMNPQRTUVWXYZ';

/** Digits that survive a voice call, and never lead with a zero. */
const SAFE_DIGITS = '23456789';

const pickFrom = (rand, list) => list[Math.floor(rand() * list.length)];

function shuffle(rand, items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isSafeLetter = (ch) => SAFE_LETTERS.includes(ch);

// ---------------------------------------------------------------------------
// OBSERVATORY - "Paired Fall"
//
// Six bright stars sit in a rising line. Meteors arrive in pairs and die on two
// of them, which burn for three seconds. The parapet frieze lists six stars
// sorted by declination, +64 down to -63.
//
// THE DEDUCTION: the chain in the sky IS that list, ordered by height. The
// signs are what stop a player reading it upside down.
//
// Each fall gives two candidate letters (count into each name by the partner's
// number) and nothing in the room chooses between them. The neighbour holds
// four bits - upper or lower - which is meaningless without the observation.
// ---------------------------------------------------------------------------

const CATALOGUE = [
  { index: 1, name: 'THUBAN', dec: '+64°22′' },
  { index: 2, name: 'ALKAID', dec: '+49°19′' },
  { index: 3, name: 'SADR', dec: '+40°15′' },
  { index: 4, name: 'MENKAR', dec: '+04°05′' },
  { index: 5, name: 'KEID', dec: '−07°39′' },
  { index: 6, name: 'ACRUX', dec: '−63°06′' },
];

/** Letter from a plate: count into its name by the partner's index. */
function plateLetter(plateIndex, partnerIndex) {
  const name = CATALOGUE[plateIndex - 1].name;
  if (partnerIndex > name.length) return null;
  return name[partnerIndex - 1];
}

/**
 * Pairs where BOTH letters are safe and the two differ.
 *
 * They must differ or the neighbour's bit would be redundant on that fall - the
 * player could guess it and the key would stop being load-bearing.
 */
function legalObservatoryPairs() {
  const pairs = [];
  for (let a = 1; a <= 6; a += 1) {
    for (let b = a + 1; b <= 6; b += 1) {
      const upper = plateLetter(a, b);
      const lower = plateLetter(b, a);
      if (!upper || !lower) continue;
      if (!isSafeLetter(upper) || !isSafeLetter(lower)) continue;
      if (upper === lower) continue;
      pairs.push({ upper: a, lower: b, upperLetter: upper, lowerLetter: lower });
    }
  }
  return pairs;
}

const observatory = {
  id: 'observatory',
  keyKind: 'sides',
  keyLabel: 'TRACK READ',

  brief: {
    title: 'PAIRED FALL \u2014 LOGGING PROCEDURE',
    lines: [
      'Falls arrive in twos. A fall is logged as the two catalogue plates it ends on.',
      '',
      "Each plate gives up ONE letter: count into that plate's NAME by the OTHER plate's number.",
      '',
      'One letter per fall, logged in the order the falls occur.',
      '',
      'WHICH plate of the two you log is set by the TRACK READ, held next door.',
    ],
    submit: 'Five letters. No spaces.',
  },

  build(rand) {
    // FIVE falls, not four.
    //
    // With four the key is four bits - only 16 possible readings - so a WRONG
    // key coincidentally produced the right answer in roughly 6% of sessions,
    // which quietly made the neighbour optional. Five bits halves that per
    // fall and the letters differ on every one, so a wrong key now has to be
    // wrong in a way that cancels out across five independent choices.
    const falls = shuffle(rand, legalObservatoryPairs()).slice(0, 5);
    const sides = Array.from({ length: 5 }, () => (rand() < 0.5 ? 'LOW' : 'HIGH'));

    const answer = falls
      .map((f, i) => (sides[i] === 'HIGH' ? f.upperLetter : f.lowerLetter))
      .join('');

    // Reject any arrangement where a DIFFERENT bit pattern yields the same
    // answer, which would make the neighbour's key optional for that session.
    //
    // Counting bits is not sufficient: two falls can share a letter pair, so
    // flipping both cancels out and a wrong key lands on the right string
    // anyway. Adding more falls narrows the odds but never eliminates them, so
    // the generator checks all 32 readings directly and re-rolls on a clash.
    // The property is then guaranteed rather than merely likely.
    let collisions = 0;
    for (let mask = 0; mask < 32; mask += 1) {
      const candidate = falls
        .map((f, i) => ((mask >> i) & 1 ? f.upperLetter : f.lowerLetter))
        .join('');
      if (candidate === answer) collisions += 1;
    }
    if (collisions !== 1) return null;

    return {
      answer,
      keyValue: sides.join('-'),
      config: {
        // Where the six beacons hang. The chain is always a rising line; the
        // seed only turns it, so the height ordering is never ambiguous.
        azimuthOffset: Math.floor(rand() * 360),
        // Which two plates each fall lights, in loop order.
        falls: falls.map((f) => [f.upper, f.lower]),
        catalogue: CATALOGUE,
        cycleSeconds: 20,
      },
    };
  },

  solve(config, key) {
    if (key?.kind !== observatory.keyKind) return '';
    const sides = String(key.value).split('-');
    return config.falls
      .map(([upper, lower], i) =>
        (sides[i] === 'HIGH' ? plateLetter(upper, lower) : plateLetter(lower, upper)))
      .join('');
  },
};

// ---------------------------------------------------------------------------
// VAULT - "The Shear Line"
//
// Six drums step together through eight faces. Each drum's backlight comes on
// only when its glyph is on a collar that is NOT struck through.
//
// THE DEDUCTION: once per cycle all six light at once - the instant neither
// thrown bolt is in the stack. That is the shear line, and the bank pauses
// there. Read the six glyphs, match them to collars, take the numbers.
//
// The neighbour holds a start slot and a direction, which selects three of the
// six and orders them.
// ---------------------------------------------------------------------------

const GLYPH_KINDS = ['plus', 'square-dot', 'double-bar', 'triangle',
  'hourglass', 'bolt', 'diamond', 'chevrons'];
const ROOM_CODES = ['AR', 'EN', 'OB', 'SP', 'VE', 'VA', 'KC', 'DC'];

const DRUM_SLOTS = 6;
const VAULT_FACES = 8;

const vault = {
  id: 'vault',
  keyKind: 'read-rule',
  keyLabel: 'READ RULE',

  brief: {
    title: 'TUMBLER BANK \u2014 6 SLOTS, 8 FACES',
    lines: [
      'The bank steps together. The beacon keeps the beat.',
      'Eight faces, six slots: two faces are always out of the bank.',
      '',
      'BOLT REGISTER',
      'A collar struck through in blue is a THROWN bolt.',
      'Bolt-blue is never information in this room. It means SEATED.',
      '',
      'Slots number 1 at the panel end to 6 at the door end.',
      'Read on round the shaft if you run off an end.',
      '',
      'Your neighbour holds where to start and which way to read.',
    ],
    submit: 'Six digits. No spaces.',
  },

  build(rand) {
    // Eight collars: a glyph, a two-digit number, a room code. Two are struck
    // through - those bolts are thrown, and a drum showing one stays dark.
    const glyphOrder = shuffle(rand, GLYPH_KINDS);
    const codes = shuffle(rand, ROOM_CODES);

    const numbers = [];
    while (numbers.length < VAULT_FACES) {
      const n = `${pickFrom(rand, SAFE_DIGITS.split(''))}${pickFrom(rand, SAFE_DIGITS.split(''))}`;
      if (!numbers.includes(n)) numbers.push(n);
    }

    // The two thrown bolts must not be adjacent on the ring, or the seated
    // frame is easy to spot without understanding why it happens.
    let thrownA = Math.floor(rand() * VAULT_FACES);
    let thrownB;
    do {
      thrownB = Math.floor(rand() * VAULT_FACES);
    } while (
      thrownB === thrownA
      || Math.abs(thrownA - thrownB) === 1
      || Math.abs(thrownA - thrownB) === VAULT_FACES - 1
    );

    const collars = glyphOrder.map((glyph, i) => ({
      position: i,
      glyph,
      number: numbers[i],
      code: codes[i],
      thrown: i === thrownA || i === thrownB,
    }));

    // Six drums, each with a fixed offset into the eight faces. The two faces
    // NOT in the bank at the seated frame are exactly the two thrown ones -
    // that is what makes all six backlights come on together.
    const liveFaces = collars.filter((c) => !c.thrown).map((c) => c.position);
    const drumOffsets = shuffle(rand, liveFaces).slice(0, DRUM_SLOTS);

    // At step s, drum d shows face (drumOffsets[d] + s) mod 8. Find the step
    // where every drum lands on a live collar - the shear line.
    let seatedStep = -1;
    for (let s = 0; s < VAULT_FACES; s += 1) {
      const allLive = drumOffsets.every((off) => !collars[(off + s) % VAULT_FACES].thrown);
      if (allLive) {
        // Must be UNIQUE, or the player has two candidate frames and no way to
        // choose. Regenerating is cheaper than disambiguating in the fiction.
        if (seatedStep !== -1) return null;
        seatedStep = s;
      }
    }
    if (seatedStep === -1) return null;

    const startSlot = 1 + Math.floor(rand() * DRUM_SLOTS);
    const direction = rand() < 0.5 ? 'TOWARD THE PANELS' : 'TOWARD THE DOOR';

    const config = {
      collars,
      drumOffsets,
      seatedStep,
      cycleSeconds: 22.5,
      faces: VAULT_FACES,
      slots: DRUM_SLOTS,
    };

    const keyValue = `SLOT ${startSlot} / ${direction}`;
    return {
      // solve() rejects a key of the wrong kind, so the key handed to it here
      // must carry its kind - a bare {value} yields an empty answer.
      answer: vault.solve(config, { kind: vault.keyKind, value: keyValue }),
      keyValue,
      config,
    };
  },

  solve(config, key) {
    if (key?.kind !== vault.keyKind) return '';
    const match = /SLOT\s+(\d)\s*\/\s*(.+)/i.exec(String(key.value));
    if (!match) return '';
    const start = Number(match[1]);
    const toward = /PANELS/i.test(match[2]) ? -1 : 1;

    const out = [];
    for (let i = 0; i < 3; i += 1) {
      // Slots are 1-based; wrap around the shaft rather than running off it.
      const slot = ((start - 1 + toward * i) % config.slots + config.slots) % config.slots;
      const face = (config.drumOffsets[slot] + config.seatedStep) % config.faces;
      out.push(config.collars[face].number);
    }
    return out.join('');
  },
};

// ---------------------------------------------------------------------------
// ENGINE ROOM - "Manifold Trace"
//
// A slug of coolant crawls past six numbered stations. Four gauges sit idle,
// then slam to full deflection - each exactly when the slug reaches ITS station.
//
// THE DEDUCTION: the gauges are not measuring, they are pointing. Two of the
// six stations are decoys nothing ever fires on.
//
// The neighbour holds the four gauge SYMBOLS in order. The gauges have no
// names, so the key has to be described aloud rather than dictated as a code.
// ---------------------------------------------------------------------------

const GAUGE_SYMBOLS = ['◇▲', '○▮', '△△', '▮◇'];
const STATION_COUNT = 6;

const engineRoom = {
  id: 'engine-room',
  keyKind: 'manifold',
  keyLabel: 'MANIFOLD ORDER',

  brief: {
    title: 'COOLANT LOOP B \u2014 MANIFOLD TRACE',
    lines: [
      'One slug of hot coolant runs the east channel, past six numbered stations, once per loop.',
      '',
      'Four manifold gauges. No names, no units. Each one vents exactly once per loop \u2014 and not one of them vents at random.',
      '',
      'Submit four station numbers, in the MANIFOLD ORDER your neighbour holds. Two stations never come up.',
    ],
    submit: 'Four station numbers. No spaces.',
  },

  build(rand) {
    const period = pickFrom(rand, [16, 18, 20, 22]);

    // Six station digits painted along the channel, north to south.
    const digits = shuffle(rand, SAFE_DIGITS.split('')).slice(0, STATION_COUNT);

    // Four of the six stations are live, one per gauge. The mapping is
    // deliberately non-monotonic: if gauge order matched station order the
    // player could guess the alignment without watching.
    let stations;
    let attempts = 0;
    do {
      stations = shuffle(rand, [0, 1, 2, 3, 4, 5]).slice(0, 4);
      attempts += 1;
    } while (attempts < 50 && stations.every((s, i) => i === 0 || s > stations[i - 1]));

    const order = shuffle(rand, [0, 1, 2, 3]);
    const answer = order.map((g) => digits[stations[g]]).join('');

    return {
      answer,
      keyValue: order.map((g) => GAUGE_SYMBOLS[g]).join(' '),
      config: {
        period,
        stationDigits: digits,
        // Which station each gauge vents on. Painted on the room in the sense
        // that the player can watch it happen - not a secret.
        gaugeStations: stations,
        symbols: GAUGE_SYMBOLS,
        cycleSeconds: period,
      },
    };
  },

  solve(config, key) {
    if (key?.kind !== engineRoom.keyKind) return '';
    const order = String(key.value).trim().split(/\s+/);
    return order
      .map((sym) => {
        const g = config.symbols.indexOf(sym);
        return g === -1 ? '' : config.stationDigits[config.gaugeStations[g]];
      })
      .join('');
  },
};

// ---------------------------------------------------------------------------
// ARCHIVE - "Outstanding Withdrawals"
//
// Four gaps of different sizes in the 48-card ring, each beside a violet
// WITHDRAWN card carrying a three-digit call number. Shelf strips state ranges.
//
// THE DEDUCTION: gap size identifies a withdrawal, and a call number is an
// address - find the strip whose range contains it to get a section word.
//
// The neighbour's slip says how many entries each withdrawal took, which is
// what turns four holes into four labelled things, and fixes the order.
// ---------------------------------------------------------------------------

const SECTION_WORDS = [
  'UPDRAFT', 'BALLAST', 'CONDUIT', 'DATUM', 'EMBER', 'FULCRUM',
  'GANTRY', 'HAWSER', 'KEELSON', 'LUMEN', 'MANIFOLD', 'NACELLE',
  'PLENUM', 'QUENCH', 'RATCHET', 'TRUNNION', 'VERNIER', 'WARDEN',
];

const CARD_SLOTS = 48;

const archive = {
  id: 'archive',
  keyKind: 'slip',
  keyLabel: 'REQUEST SLIP — ENTRIES PER WITHDRAWAL',

  brief: {
    title: 'CIRCULATION \u2014 OUTSTANDING WITHDRAWALS',
    lines: [
      'Four charge cards are still out on the rail. Each one stands where entries were taken out of the file. Nothing leaves this room without leaving its place behind.',
      '',
      'A call number is an address. Every strip on these shelves states the range it holds.',
      '',
      'REPORT: four letters \u2014 the initial of the section each withdrawal was filed under, in the order the desk asks for.',
      '',
      "The desk's request slip is in your neighbour's chamber.",
    ],
    submit: 'Four letters. No spaces.',
  },

  build(rand) {
    // Four gaps, all different sizes so each is a unique identifier.
    const sizes = shuffle(rand, [2, 3, 4, 5, 6, 7]).slice(0, 4);

    // 20 shelf strips, each holding a 48-wide range. Ranges tile without gaps
    // so every call number resolves to exactly one section.
    const base = 100 + Math.floor(rand() * 4) * 48;
    const words = shuffle(rand, SECTION_WORDS).slice(0, 20);
    const strips = words.map((word, i) => ({
      code: `${String.fromCharCode(65 + Math.floor(i / 2))}${'AB'[i % 2]}`,
      lo: base + i * 48,
      hi: base + i * 48 + 47,
      word,
    }));

    // One call number per withdrawal, each landing on a DIFFERENT strip - two
    // withdrawals resolving to the same word would make the answer ambiguous.
    const chosen = shuffle(rand, strips).slice(0, 4);
    const withdrawals = sizes.map((size, i) => ({
      size,
      callNumber: String(chosen[i].lo + Math.floor(rand() * 48)),
      // Where the gap sits on the ring. Spread so the gaps never merge visually.
      slot: Math.floor((i * CARD_SLOTS) / 4 + rand() * 4),
    }));

    // The slip lists the sizes in the order they must be read.
    const readOrder = shuffle(rand, [0, 1, 2, 3]);

    const config = {
      withdrawals,
      strips,
      slots: CARD_SLOTS,
      revolutionSeconds: 17 + Math.floor(rand() * 6),
      cycleSeconds: 19,
    };

    const keyValue = readOrder.map((i) => withdrawals[i].size).join('-');

    return {
      answer: archive.solve(config, { kind: archive.keyKind, value: keyValue }),
      keyValue,
      config,
    };
  },

  solve(config, key) {
    if (key?.kind !== archive.keyKind) return '';
    const order = String(key.value).split('-').map(Number);
    return order
      .map((size) => {
        const w = config.withdrawals.find((x) => x.size === size);
        if (!w) return '';
        const n = Number(w.callNumber);
        const strip = config.strips.find((s) => n >= s.lo && n <= s.hi);
        return strip ? strip.word[0] : '';
      })
      .join('');
  },
};

// ---------------------------------------------------------------------------
// SPIRE - "Signal Watch"
//
// Five towers, each with a lit lantern. One blinks; another answers with a long
// steady hold.
//
// THE DEDUCTION: the blink count is how many lanterns clockwise the answerer
// is. That lets a player resolve pairs happening behind their back, and the
// five arrows close into one loop.
//
// The neighbour names one lantern - the cut point. The answer is the two
// lanterns adjacent to it in the loop, read off the floor compass.
// ---------------------------------------------------------------------------

const BEARING_MARKS = [120, 150, 180, 210, 240, 270, 300];
const LANTERN_HUES = [
  { hue: 'VELLUM', chamber: 'ARCHIVE' },
  { hue: 'LIME', chamber: 'ENGINE ROOM' },
  { hue: 'VIOLET', chamber: 'OBSERVATORY' },
  { hue: 'BLUE', chamber: 'VAULT' },
  { hue: 'GOLD', chamber: 'SPIRE' },
];

const spire = {
  id: 'spire',
  keyKind: 'relay',
  keyLabel: 'RELAY LANTERN',

  brief: {
    title: 'SIGNAL WATCH \u00b7 CYCLE 21s',
    lines: [
      'The five lanterns take the horizon in turn, sunwise, four seconds each, then one second of quiet.',
      '',
      'One lantern SPEAKS in short blinks.',
      'Somewhere else, one lantern ANSWERS with a single long hold.',
      '',
      'Count the blinks. They are not decoration.',
      '',
      "Sight along a spoke of the rose to read a lantern's bearing.",
      '',
      "REPORT: the bearing of the lantern that calls your neighbour's lantern, then the bearing of the lantern it calls.",
    ],
    submit: 'Six digits. No spaces.',
  },

  build(rand) {
    // Five bearings spanning at least 120 degrees, so the towers are spread
    // round the horizon rather than clustered in one view.
    let bearings;
    let attempts = 0;
    do {
      bearings = shuffle(rand, BEARING_MARKS).slice(0, 5).sort((a, b) => a - b);
      attempts += 1;
    } while (attempts < 50 && bearings[4] - bearings[0] < 120);

    const hues = shuffle(rand, LANTERN_HUES);

    // A single 5-cycle: every lantern calls exactly one and is called by one.
    // Built as a random cyclic permutation so it can never split into a pair
    // plus a triangle, which would give the player two loops and no answer.
    const cycle = shuffle(rand, [0, 1, 2, 3, 4]);
    const callsIndex = new Map();
    for (let i = 0; i < 5; i += 1) {
      callsIndex.set(cycle[i], cycle[(i + 1) % 5]);
    }

    // Blink count = how many positions clockwise the answerer sits.
    const lanterns = bearings.map((bearing, i) => {
      const target = callsIndex.get(i);
      const hops = ((target - i) + 5) % 5;
      return {
        bearing,
        hue: hues[i].hue,
        chamber: hues[i].chamber,
        blinks: hops,
        answers: target,
      };
    });

    // A uniform hop count would let a player skip the rule entirely.
    const hopSet = new Set(lanterns.map((l) => l.blinks));
    if (hopSet.size < 2) return null;

    const relay = Math.floor(rand() * 5);
    const config = { lanterns, cycleSeconds: 21 };
    const keyValue = `${lanterns[relay].hue} — ${lanterns[relay].chamber}`;

    return {
      answer: spire.solve(config, { kind: spire.keyKind, value: keyValue }),
      keyValue,
      config,
    };
  },

  solve(config, key) {
    if (key?.kind !== spire.keyKind) return '';
    const hue = String(key.value).split('—')[0].trim().toUpperCase();
    const idx = config.lanterns.findIndex((l) => l.hue === hue);
    if (idx === -1) return '';

    const caller = config.lanterns.findIndex((l) => l.answers === idx);
    const callee = config.lanterns[idx].answers;

    const pad = (b) => String(b).padStart(3, '0');
    return `${pad(config.lanterns[caller].bearing)}${pad(config.lanterns[callee].bearing)}`;
  },
};

// ---------------------------------------------------------------------------

export const PUZZLE_DEFS = {
  observatory,
  vault,
  'engine-room': engineRoom,
  archive,
  spire,
};

/** Fallback for a chamber with no bespoke puzzle (room-one). */
export const DEFAULT_DEF = observatory;

export function defFor(chamberId) {
  return PUZZLE_DEFS[chamberId] || DEFAULT_DEF;
}
