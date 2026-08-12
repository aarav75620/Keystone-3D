// Keystone 3D - server entry point.
//
// Owns the HTTP server, the socket connections, and all broadcasting. Room
// truth lives in rooms.js; this file never invents state, it only relays what
// that module says is true. Clients are treated as untrusted input throughout:
// every value they send is re-validated here before it reaches room state.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import express from 'express';
import { Server as SocketServer } from 'socket.io';

import {
  PORT,
  SWEEP_INTERVAL_MS,
  MIN_PLAYERS_TO_START,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  LOCKOUT_MS,
  DISCONNECT_GRACE_MS,
} from './config.js';

import {
  CHAMBERS,
  MIN_CREW_FOR_GRAPH,
  assignSessionChambers,
  assignLateJoiner,
  chamberName,
} from './chambers.js';

import {
  generatePuzzles,
  serializePuzzle,
  serializeProgress,
  answersMatch,
} from './puzzles.js';

import {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  detachSocket,
  whereIsSocket,
  setClues,
  submitAnswer,
  expireLockouts,
  serializeRoom,
  normalizeCode,
  normalizeName,
  sweep,
  roomCount,
  activeRoomCodes,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  // Players are on school wifi and phone hotspots. Give a dropped connection a
  // real chance to come back before the transport gives up on it.
  pingTimeout: 20_000,
  pingInterval: 10_000,
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Free hosts ping this to decide whether the process is alive.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: roomCount(), uptime: Math.round(process.uptime()) });
});

// ---------------------------------------------------------------------------
// Broadcasting
// ---------------------------------------------------------------------------

/** Push the authoritative room state to everyone sitting in that room. */
function broadcastRoom(room) {
  io.to(room.code).emit('room:state', serializeRoom(room));
}

/** A one-line transient notice for the room log ("MAYA joined"). Not state. */
function broadcastNotice(room, text, tone = 'info') {
  io.to(room.code).emit('room:notice', { text, tone, at: Date.now() });
}

/**
 * Send each player the puzzle for the chamber they are standing in.
 *
 * Targeted per socket, never room-wide: a player's prompt and the key they hold
 * are exactly the information the other chambers must ask them for out loud.
 * Broadcasting the lot would hand every client every secret and collapse the
 * entire design into one person reading their own screen.
 */
function sendPuzzles(room) {
  for (const player of room.players.values()) {
    if (!player.socketId || !player.chamberId) continue;
    const puzzle = room.puzzles.get(player.chamberId);
    io.to(player.socketId).emit('puzzle:state', {
      chamberId: player.chamberId,
      puzzle: serializePuzzle(puzzle, { chamberName }),
    });
  }
}

/** Public progress: who has solved, what is locked. Leaks no prompt or key. */
function broadcastProgress(room) {
  io.to(room.code).emit('run:progress', {
    ...serializeProgress(room.puzzles, { chamberName }),
    phase: room.phase,
    completedAt: room.completedAt || 0,
  });
}

/**
 * Numbers the client is allowed to display but never to decide. Sent on join so
 * the UI can render "2 of 6" and the lockout length without hardcoding them in
 * two places that can drift apart.
 */
const clientConfig = {
  minPlayers: MIN_PLAYERS_TO_START,
  maxPlayers: MAX_PLAYERS,
  nameMaxLength: NAME_MAX_LENGTH,
  codeLength: ROOM_CODE_LENGTH,
  // Sent so the join field can reject characters that can never appear in a
  // code, rather than accepting them and failing with a confusing message.
  codeAlphabet: ROOM_CODE_ALPHABET,
  lockoutMs: LOCKOUT_MS,
  disconnectGraceMs: DISCONNECT_GRACE_MS,
  // Chamber ids and display names, so the client never hardcodes a list that
  // could drift from the server's.
  chambers: CHAMBERS,
  // Advisory, not enforced. Below this the dependency graph has unreachable
  // information; the server warns rather than refusing, because a pair wanting
  // to look around should be allowed to.
  minCrewForGraph: MIN_CREW_FOR_GRAPH,
};

const ERROR_TEXT = {
  NO_ROOM: 'No room with that code.',
  ROOM_FULL: `That room is full. ${MAX_PLAYERS} is the maximum crew.`,
  IN_PROGRESS: 'That run has already started. Ask the host to open a new room.',
  BAD_CODE: `A room code is ${ROOM_CODE_LENGTH} characters.`,
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_HOST: 'Only the host can start the run.',
  NOT_ENOUGH_PLAYERS: `You need at least ${MIN_PLAYERS_TO_START} players. No one escapes alone.`,
};

function fail(code) {
  return { ok: false, error: code, message: ERROR_TEXT[code] || 'Something went wrong.' };
}

/** Ack callbacks come from the client, so confirm it really is a function. */
function replyWith(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  // Hand over the limits straight away rather than waiting for a join, so the
  // entry screen can validate against the real values instead of guesses.
  socket.emit('server:hello', { config: clientConfig });

  // Cheap brute-force guard: room codes are short, so an unthrottled client
  // could walk the whole code space looking for live rooms to barge into.
  let joinAttempts = 0;
  const attemptWindow = setInterval(() => {
    joinAttempts = 0;
  }, 60_000);

  const overAttemptLimit = () => {
    joinAttempts += 1;
    return joinAttempts > 20;
  };

  /** Send the joining client everything it needs, then tell the room. */
  function completeJoin({ socket: sock, room, player, rejoined }, ack) {
    sock.join(room.code);

    // A run already in progress and this player has no chamber: they are a
    // reconnect whose record was swept, or an edge case we have not thought of.
    // Put them somewhere rather than leaving them in a session with nothing to
    // stand in.
    if (room.phase !== 'lobby' && !player.chamberId) {
      player.chamberId = assignLateJoiner(room);
    }

    replyWith(ack, {
      ok: true,
      you: {
        id: player.id,
        token: player.token,
        name: player.name,
        chamberId: player.chamberId || null,
      },
      room: serializeRoom(room),
      config: clientConfig,
    });
    // Hand the newcomer the board as it stands. Without this they see it blank
    // until somebody happens to type, and would not know the crew had already
    // written down half of what they need.
    if (room.clues.text) sock.emit('clues:state', room.clues);

    // Hand a returning player their puzzle and the live progress. This is what
    // makes a lockout survive a refresh: the deadline is a server timestamp, so
    // reloading mid-penalty returns the same deadline rather than clearing it.
    if (room.puzzles.size && player.chamberId) {
      sock.emit('puzzle:state', {
        chamberId: player.chamberId,
        puzzle: serializePuzzle(room.puzzles.get(player.chamberId), { chamberName }),
      });
      sock.emit('run:progress', {
        ...serializeProgress(room.puzzles, { chamberName }),
        phase: room.phase,
        completedAt: room.completedAt || 0,
      });
    }

    broadcastRoom(room);
    broadcastNotice(
      room,
      rejoined ? `${player.name} reconnected.` : `${player.name} joined the crew.`,
      rejoined ? 'info' : 'good',
    );
  }

  socket.on('room:open', (payload, ack) => {
    const name = normalizeName(payload?.name);
    const room = createRoom();
    const result = joinRoom({ code: room.code, name, token: null, socketId: socket.id });

    if (!result.ok) {
      replyWith(ack, fail(result.error));
      return;
    }

    completeJoin({ socket, room: result.room, player: result.player, rejoined: false }, ack);
  });

  socket.on('room:join', (payload, ack) => {
    if (overAttemptLimit()) {
      replyWith(ack, fail('RATE_LIMITED'));
      return;
    }

    const code = normalizeCode(payload?.code);
    if (code.length !== ROOM_CODE_LENGTH) {
      replyWith(ack, fail('BAD_CODE'));
      return;
    }

    const name = normalizeName(payload?.name);
    const token = typeof payload?.token === 'string' ? payload.token : null;

    const result = joinRoom({ code, name, token, socketId: socket.id });
    if (!result.ok) {
      replyWith(ack, fail(result.error));
      return;
    }

    completeJoin(
      { socket, room: result.room, player: result.player, rejoined: result.rejoined },
      ack,
    );
  });

  socket.on('room:leave', (_payload, ack) => {
    const result = leaveRoom(socket.id);
    if (!result) {
      replyWith(ack, fail('NOT_IN_ROOM'));
      return;
    }
    socket.leave(result.room.code);
    replyWith(ack, { ok: true });
    broadcastRoom(result.room);
    broadcastNotice(result.room, `${result.player.name} left.`, 'warn');
  });

  // Phase 1 stops at the lobby, so starting a run only flips the room phase and
  // tells everyone. Phase 5 hangs puzzle generation off this same event.
  socket.on('room:start', (_payload, ack) => {
    const here = whereIsSocket(socket.id);
    if (!here) {
      replyWith(ack, fail('NOT_IN_ROOM'));
      return;
    }

    const { room, player } = here;
    if (player.id !== room.hostId) {
      replyWith(ack, fail('NOT_HOST'));
      return;
    }

    // Count only players actually on a live socket. Someone mid-reconnect holds
    // their seat, but they cannot receive a fragment yet, so they must not make
    // up the difference to the minimum.
    const liveCount = [...room.players.values()].filter((p) => p.connected).length;
    if (liveCount < MIN_PLAYERS_TO_START) {
      replyWith(ack, fail('NOT_ENOUGH_PLAYERS'));
      return;
    }

    // Deal chambers. Server-side and authoritative: a client that picked its own
    // chamber could choose the one holding the value it needs, which collapses
    // the cross-chamber dependency the whole game rests on.
    const report = assignSessionChambers(room);

    // Generate puzzles for the chambers that actually have someone in them.
    // An empty chamber's puzzle would be a link in the ring nobody can read,
    // which makes the whole ring unsolvable.
    const occupied = [...new Set(
      [...room.players.values()].map((p) => p.chamberId).filter(Boolean),
    )];
    room.startedAt = Date.now();
    // The run epoch anchors every room's animation clock. Passing it through
    // the puzzle state means a reconnecting player gets the SAME epoch and
    // rejoins mid-cycle in step with everyone else, rather than restarting the
    // cycle from wherever they happened to reload.
    room.puzzles = generatePuzzles(occupied, { epoch: room.startedAt });
    room.completedAt = 0;

    room.phase = 'playing';
    replyWith(ack, { ok: true });
    broadcastRoom(room);
    broadcastNotice(room, 'Run starting. Hold position.', 'good');
    sendPuzzles(room);
    broadcastProgress(room);

    // Tell each player privately where they woke up. It is also in the public
    // room state, but a targeted line in their own log reads as *being placed*
    // rather than as a roster update.
    for (const player of room.players.values()) {
      if (!player.socketId || !player.chamberId) continue;
      io.to(player.socketId).emit('room:notice', {
        text: `You are in ${chamberName(player.chamberId)}.`,
        tone: 'good',
        at: Date.now(),
      });
    }

    // Say it plainly when the crew is too small to reach every chamber. An
    // unoccupied chamber holds information nobody can get to, and a crew that
    // does not know that will hunt for a value that is not reachable.
    if (report.underCrewed) {
      const empty = report.chambersAvailable - report.chambersOccupied;
      broadcastNotice(
        room,
        `${empty} chamber${empty === 1 ? '' : 's'} left empty — some clues are out of reach with ${liveCount} player${liveCount === 1 ? '' : 's'}.`,
        'warn',
      );
    }
  });

  // The shared clue board. Broadcast to the WHOLE room including the author:
  // the server is authoritative, so the author's own echo is what confirms
  // their text actually landed rather than being dropped or truncated.
  socket.on('clues:set', (payload) => {
    const here = whereIsSocket(socket.id);
    if (!here) return;

    const { room, player } = here;
    if (!setClues(room, payload?.text, player)) return;

    io.to(room.code).emit('clues:state', room.clues);
  });

  socket.on('lock:submit', (payload, ack) => {
    const here = whereIsSocket(socket.id);
    if (!here) {
      replyWith(ack, fail('NOT_IN_ROOM'));
      return;
    }

    const { room, player } = here;
    if (!player.chamberId) {
      replyWith(ack, { ok: false, error: 'NO_CHAMBER', message: 'You are not in a chamber yet.' });
      return;
    }

    const result = submitAnswer(room, player.chamberId, payload?.answer, player, {
      answersMatch,
      lockoutMs: LOCKOUT_MS,
    });

    const label = chamberName(player.chamberId);

    if (result.ok) {
      replyWith(ack, { ok: true, message: 'Correct. This chamber is open.' });
      broadcastNotice(room, `${label} is open — ${player.name} solved it.`, 'good');

      if (result.allSolved) {
        broadcastNotice(room, 'Every chamber is open. Nobody escaped alone.', 'good');
      }

      sendPuzzles(room);
      broadcastProgress(room);
      broadcastRoom(room);
      return;
    }

    if (result.error === 'LOCKED') {
      replyWith(ack, {
        ok: false,
        error: 'LOCKED',
        message: `Locked for another ${Math.ceil(result.remainingMs / 1000)}s.`,
        lockedUntil: room.puzzles.get(player.chamberId)?.lockedUntil || 0,
      });
      return;
    }

    if (result.error === 'WRONG') {
      const seconds = Math.round(result.remainingMs / 1000);
      replyWith(ack, {
        ok: false,
        error: 'WRONG',
        message: `Wrong. ${label} is locked for ${seconds}s.`,
        lockedUntil: result.lockedUntil,
      });

      // Broadcast to the whole crew. The PRD requires everyone to see it, and
      // the honest reason is that a chamber going quiet for 30s is something
      // the others need to understand rather than guess at.
      broadcastNotice(room, `${label} is locked for ${seconds}s — wrong answer.`, 'warn');

      sendPuzzles(room);
      broadcastProgress(room);
      return;
    }

    if (result.error === 'ALREADY_SOLVED') {
      replyWith(ack, { ok: false, error: result.error, message: 'This chamber is already open.' });
      return;
    }

    replyWith(ack, {
      ok: false,
      error: result.error || 'NO_PUZZLE',
      message: 'No puzzle is loaded in this chamber.',
    });
  });

  socket.on('disconnect', () => {
    clearInterval(attemptWindow);
    const result = detachSocket(socket.id);
    if (!result) return;
    broadcastRoom(result.room);
    broadcastNotice(result.room, `${result.player.name} lost connection.`, 'warn');
  });
});

// ---------------------------------------------------------------------------
// Sweeper
// ---------------------------------------------------------------------------

const sweeper = setInterval(() => {
  const { changed, closed } = sweep();
  for (const room of changed) broadcastRoom(room);
  for (const code of closed) io.to(code).emit('room:closed');
}, SWEEP_INTERVAL_MS);

/**
 * Push lockout expiry.
 *
 * The deadline is authoritative on its own - a submission is checked against
 * the timestamp, not against this tick - so this exists purely so a waiting
 * chamber sees "you can try again" without having to poke the form. Runs at 1s
 * because that is the resolution a countdown is read at.
 */
const lockoutTicker = setInterval(() => {
  for (const code of activeRoomCodes()) {
    const room = getRoom(code);
    if (!room?.puzzles.size) continue;
    const cleared = expireLockouts(room);
    if (!cleared.length) continue;

    sendPuzzles(room);
    broadcastProgress(room);
    for (const chamberId of cleared) {
      broadcastNotice(room, `${chamberName(chamberId)} can try again.`, 'info');
    }
  }
}, 1000);

lockoutTicker.unref?.();

// Do not hold the process open just for the sweeper.
sweeper.unref?.();

// ---------------------------------------------------------------------------
// Boot / shutdown
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`Keystone server listening on http://localhost:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, closing down.`);
  clearInterval(sweeper);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  // Do not hang forever if a socket refuses to close.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
