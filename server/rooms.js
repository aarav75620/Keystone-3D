// Authoritative room state. This module owns the truth about who is in which
// room; it holds no sockets and does no broadcasting. index.js reads state from
// here and pushes it out. Keeping the split clean means the state can be tested
// and reasoned about without a live socket server.

import { randomBytes, randomInt } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
} from './config.js';

/** @type {Map<string, Room>} code -> room */
const rooms = new Map();

/** @type {Map<string, {code: string, token: string}>} socket id -> where that socket sits */
const socketIndex = new Map();

/**
 * A player carries two identifiers on purpose:
 *   token - secret, known only to that one client. Proves "I am the player who
 *           held this slot before the refresh". Never sent to anybody else.
 *   id    - public, safe to broadcast. What other clients use to refer to them.
 * Collapsing these into one value would let any player in the room impersonate
 * another by replaying the id they saw in the player list.
 */

// ---------------------------------------------------------------------------
// Input cleaning
// ---------------------------------------------------------------------------

/**
 * Names arrive from the client, so they are hostile until proven otherwise.
 * Strip control characters, flatten whitespace, cap the length.
 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return 'CREW';
  // Keep it to characters that actually render. This rejects C0/C1 control
  // codes and the zero-width / bidi-override range, which would otherwise let
  // a player show up as an invisible or right-to-left name in everyone else's
  // crew list.
  const isRenderable = (code) => {
    if (code < 32 || code === 127) return false;
    if (code >= 128 && code <= 159) return false;
    if (code >= 0x200b && code <= 0x200f) return false;
    if (code >= 0x2028 && code <= 0x202e) return false;
    if (code === 0xfeff) return false;
    return true;
  };

  const cleaned = [...raw]
    .filter((ch) => isRenderable(ch.codePointAt(0)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX_LENGTH);
  return cleaned.length ? cleaned : 'CREW';
}

/** Codes are typed by hand and read aloud, so accept sloppy input generously. */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

function newCode() {
  // With a 30-character alphabet and length 4 there are 810,000 codes. Loop
  // until we find a free one; bail to a longer code in the (absurd) case that
  // the space is saturated, so this can never spin forever.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH + 2; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

const newToken = () => randomBytes(24).toString('hex');
const newPlayerId = () => randomBytes(5).toString('hex');

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function makeRoom() {
  return {
    code: newCode(),
    createdAt: Date.now(),
    /** 'lobby' now; phase 5 adds 'playing' and 'solved'. */
    phase: 'lobby',
    /** Public id of the host. The host is whoever opened the room. */
    hostId: null,
    /** @type {Map<string, Player>} token -> player */
    players: new Map(),
    /** Timestamp the room went empty, or null while anyone holds a slot. */
    emptySince: null,
    /**
     * The shared clue board: one scratchpad the whole crew writes to, whatever
     * chamber each of them is standing in.
     *
     * Server-held rather than peer-to-peer for the same reason as everything
     * else here - it has to survive a refresh and be identical for everyone,
     * and a client-authoritative board would diverge the moment two people
     * typed at once.
     */
    clues: { text: '', byId: null, byName: null, at: 0 },
    /**
     * Puzzle state, created when the host starts the run.
     * @type {Map<string, object>} chamberId -> puzzle
     */
    puzzles: new Map(),
    startedAt: 0,
    completedAt: 0,
  };
}

/** Board text is player input, so it is capped and cleaned like a name. */
export const CLUES_MAX_LENGTH = 2000;

export function setClues(room, text, player) {
  if (typeof text !== 'string') return false;

  const cleaned = [...text]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      if (ch === '\n') return true;
      if (code < 32 || code === 127) return false;
      if (code >= 128 && code <= 159) return false;
      if (code >= 0x200b && code <= 0x200f) return false;
      if (code >= 0x2028 && code <= 0x202e) return false;
      return code !== 0xfeff;
    })
    .join('')
    .slice(0, CLUES_MAX_LENGTH);

  if (cleaned === room.clues.text) return false;

  room.clues = {
    text: cleaned,
    byId: player.id,
    byName: player.name,
    at: Date.now(),
  };
  return true;
}

export function createRoom() {
  const room = makeRoom();
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code) || null;
}

export function roomCount() {
  return rooms.size;
}

/**
 * Codes of every live room. Returned as an array rather than the Map itself so
 * callers can iterate without being able to mutate the registry.
 */
export function activeRoomCodes() {
  return [...rooms.keys()];
}

/**
 * Put a socket into a room, either as a brand new player or as a returning one
 * reclaiming the slot they held before a refresh.
 *
 * @returns {{ok: true, room: Room, player: Player, rejoined: boolean}
 *          | {ok: false, error: string}}
 */
export function joinRoom({ code, name, token, socketId }) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'NO_ROOM' };

  const existing = token ? room.players.get(token) : null;

  if (existing) {
    // Same player returning. If their old socket is somehow still registered
    // (fast refresh, second tab), retire it so we don't leave a stale index
    // entry that would later "disconnect" the player who has since returned.
    // Their chamberId is deliberately untouched - they come back to their room.
    if (existing.socketId && existing.socketId !== socketId) {
      socketIndex.delete(existing.socketId);
    }
    existing.socketId = socketId;
    existing.connected = true;
    existing.disconnectedAt = null;
    if (typeof name === 'string' && name.trim()) {
      existing.name = normalizeName(name);
    }
    room.emptySince = null;
    socketIndex.set(socketId, { code: room.code, token: existing.token });
    return { ok: true, room, player: existing, rejoined: true };
  }

  // New player. Disconnected-but-in-grace players still hold their seat, so
  // they count against capacity - their slot is reserved, not free.
  if (room.players.size >= MAX_PLAYERS) return { ok: false, error: 'ROOM_FULL' };
  if (room.phase !== 'lobby') return { ok: false, error: 'IN_PROGRESS' };

  const player = {
    token: newToken(),
    id: newPlayerId(),
    name: normalizeName(name),
    socketId,
    connected: true,
    joinedAt: Date.now(),
    disconnectedAt: null,
    /**
     * Which chamber this player spawns into. Null until the host starts the run.
     * Stored per player rather than recomputed, so a reconnecting player returns
     * to the same chamber - coming back to a different room mid-run would strand
     * whatever the crew had already learned about theirs.
     */
    chamberId: null,
  };

  room.players.set(player.token, player);
  room.emptySince = null;
  if (!room.hostId) room.hostId = player.id;
  socketIndex.set(socketId, { code: room.code, token: player.token });

  return { ok: true, room, player, rejoined: false };
}

/**
 * Mark a socket's player as disconnected without removing them. The sweeper
 * removes them for real once the grace window expires.
 *
 * @returns {{room: Room, player: Player} | null}
 */
export function detachSocket(socketId) {
  const where = socketIndex.get(socketId);
  if (!where) return null;
  socketIndex.delete(socketId);

  const room = rooms.get(where.code);
  if (!room) return null;

  const player = room.players.get(where.token);
  if (!player) return null;

  // Only clear the socket if it is still the one we are detaching. A player who
  // refreshed fast enough may already be back on a newer socket.
  if (player.socketId !== socketId) return null;

  player.socketId = null;
  player.connected = false;
  player.disconnectedAt = Date.now();

  if (![...room.players.values()].some((p) => p.connected)) {
    room.emptySince = Date.now();
  }

  return { room, player };
}

/** Deliberate leave (pressed the button) - drop the slot immediately. */
export function leaveRoom(socketId) {
  const where = socketIndex.get(socketId);
  if (!where) return null;
  socketIndex.delete(socketId);

  const room = rooms.get(where.code);
  if (!room) return null;

  const player = room.players.get(where.token);
  if (!player) return null;

  room.players.delete(player.token);
  reassignHost(room);

  if (room.players.size === 0) {
    room.emptySince = Date.now();
  }

  return { room, player };
}

export function whereIsSocket(socketId) {
  const where = socketIndex.get(socketId);
  if (!where) return null;
  const room = rooms.get(where.code);
  if (!room) return null;
  const player = room.players.get(where.token);
  if (!player) return null;
  return { room, player };
}

/**
 * Host left, so hand the role to whoever has been aboard longest. Prefer a
 * currently-connected player; fall back to any remaining player so the room
 * still has a nominal host while everyone is briefly offline.
 */
function reassignHost(room) {
  const stillHere = [...room.players.values()].some((p) => p.id === room.hostId);
  if (stillHere) return;

  const bySeniority = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const next = bySeniority.find((p) => p.connected) || bySeniority[0];
  room.hostId = next ? next.id : null;
}

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

/**
 * Evict players whose grace window has expired and close rooms that have been
 * empty past their TTL.
 *
 * @returns {{changed: Room[], closed: string[]}} rooms needing a re-broadcast,
 *          and the codes of rooms that no longer exist.
 */
export function sweep(now = Date.now()) {
  const changed = [];
  const closed = [];

  for (const room of rooms.values()) {
    let dirty = false;

    for (const player of room.players.values()) {
      if (player.connected) continue;
      if (now - player.disconnectedAt < DISCONNECT_GRACE_MS) continue;
      room.players.delete(player.token);
      dirty = true;
    }

    if (dirty) {
      reassignHost(room);
      if (room.players.size === 0 && !room.emptySince) room.emptySince = now;
    }

    const isEmpty = room.players.size === 0;
    if (isEmpty && room.emptySince && now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
      rooms.delete(room.code);
      closed.push(room.code);
      continue;
    }

    if (dirty) changed.push(room);
  }

  return { changed, closed };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * The room as every client is allowed to see it. Tokens never appear here.
 * Slot order is join order so the manifest is stable for everyone.
 */
export function serializeRoom(room) {
  const players = [...room.players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
      /**
       * Deliberately public. Everyone needs to know who is standing where, or
       * they cannot direct a question at the person who can answer it - which is
       * the entire point of the cross-chamber dependency. It reveals nothing
       * secret: what a chamber CONTAINS is only visible to whoever is in it.
       */
      chamberId: p.chamberId || null,
    }));

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players,
    maxPlayers: MAX_PLAYERS,
  };
}

// ---------------------------------------------------------------------------
// The penalty engine
//
// Every value here is server-held. That is the point: a lockout enforced by the
// client is a lockout any player can skip by editing a variable, and the PRD's
// competitor analysis names exactly that as the failure in "We Were Here".
// ---------------------------------------------------------------------------

/**
 * Judge an answer.
 *
 * Returns a result the caller broadcasts; it never throws and never mutates
 * anything on a rejected submission except the attempt counter.
 */
export function submitAnswer(room, chamberId, rawAnswer, player, {
  answersMatch,
  lockoutMs,
  now = Date.now(),
}) {
  const puzzle = room.puzzles.get(chamberId);
  if (!puzzle) return { ok: false, error: 'NO_PUZZLE' };
  if (puzzle.solved) return { ok: false, error: 'ALREADY_SOLVED' };

  // A locked chamber refuses outright. Checked against the stored deadline
  // rather than a timer, so it survives a server tick being late, a client
  // refresh, and a client that simply lies about the clock.
  if (puzzle.lockedUntil > now) {
    return { ok: false, error: 'LOCKED', remainingMs: puzzle.lockedUntil - now };
  }

  puzzle.attempts += 1;

  if (answersMatch(rawAnswer, puzzle.answer)) {
    puzzle.solved = true;
    puzzle.solvedAt = now;
    puzzle.solvedByName = player.name;
    puzzle.lockedUntil = 0;

    const remaining = [...room.puzzles.values()].filter((p) => !p.solved).length;
    if (remaining === 0) {
      room.phase = 'solved';
      room.completedAt = now;
    }

    return { ok: true, solved: true, allSolved: remaining === 0 };
  }

  puzzle.lockedUntil = now + lockoutMs;
  return { ok: false, error: 'WRONG', lockedUntil: puzzle.lockedUntil, remainingMs: lockoutMs };
}

/**
 * Chambers whose lockout has just expired.
 *
 * The deadline is the source of truth, so this exists only to push a "you can
 * try again" update; nothing depends on it running on time.
 */
export function expireLockouts(room, now = Date.now()) {
  const cleared = [];
  for (const [chamberId, puzzle] of room.puzzles) {
    if (puzzle.lockedUntil && puzzle.lockedUntil <= now) {
      puzzle.lockedUntil = 0;
      cleared.push(chamberId);
    }
  }
  return cleared;
}

/** Test/debug helper: wipe everything. Not reachable over the network. */
export function _resetAll() {
  rooms.clear();
  socketIndex.clear();
}
