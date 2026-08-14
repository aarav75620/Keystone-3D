// chambers.js - which physical room each player spawns into.
//
// "Room" is overloaded in this project: a *session* (a room code) contains
// several *chambers* (the Archive, the Engine Room, ...). This module owns
// chamber assignment and nothing else. Naming them differently here is worth the
// small friction, because `room.rooms` would be unreadable.
//
// Assignment is SERVER-SIDE and authoritative. It has to be: a client that chose
// its own chamber could pick the one holding the value it needs, which collapses
// the cross-room dependency the whole game is built on.

import { randomInt } from 'node:crypto';

/**
 * The chambers that exist and are mountable. Ordered, because the first three
 * form the complete bidirectional dependency triangle and are therefore the
 * playable core - see ROOMS.md. Chambers are added here as they are built.
 */
// Add an entry here ONLY when the matching client module exists in
// public/js/rooms/. Listing a chamber before it is built means the server deals
// players into a room the client cannot load, and they get silently dropped into
// the fallback - which looks like a spawn bug and is miserable to diagnose.
export const CHAMBERS = [
  { id: 'archive', name: 'The Archive' },
  { id: 'engine-room', name: 'Engine Room' },
  { id: 'observatory', name: 'The Observatory' },
  { id: 'vault', name: 'The Vault' },
  { id: 'spire', name: 'The Spire' },
  // Sixth and last. A real chamber with its own puzzle, and also the shared
  // destination - see the finale design in PROGRESS.md.
  { id: 'vestibule', name: 'The Vestibule' },
];

/** Minimum crew for the dependency graph to be solvable. See ROOMS.md §1. */
export const MIN_CREW_FOR_GRAPH = 3;

/**
 * Fisher-Yates using crypto randomness.
 *
 * Math.random would be fine for shuffling scenery, but this decides who can see
 * which secret, so it uses the same source as the room codes and player tokens.
 */
function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal chambers to players.
 *
 * Rules, in priority order:
 *  1. Every chamber that can be occupied IS occupied. An empty chamber is
 *     information nobody can reach, which can make the session unsolvable.
 *  2. Nobody is alone in a chamber while another chamber is empty.
 *  3. Surplus players double up, spread as evenly as possible.
 *
 * Two players sharing a chamber is a feature, not a fallback: they see the same
 * things and still have to talk to the other chambers, and a less confident
 * player having someone beside them is squarely on-thesis.
 *
 * @param {string[]} playerIds  public ids, in stable join order
 * @param {{chambers?: Array}} [options]
 * @returns {Map<string, string>} playerId -> chamberId
 */
export function assignChambers(playerIds, { chambers = CHAMBERS } = {}) {
  const assignment = new Map();
  if (!playerIds.length || !chambers.length) return assignment;

  // Shuffle BOTH: the chamber order so the same crew does not always get the
  // same rooms, and the players so seat order in the lobby confers nothing.
  const deck = shuffled(chambers.map((c) => c.id));
  const crew = shuffled(playerIds);

  crew.forEach((playerId, index) => {
    assignment.set(playerId, deck[index % deck.length]);
  });

  return assignment;
}

/**
 * Assign chambers to a session and store the result on each player.
 *
 * Returns a report the caller can log or broadcast. Called once when the host
 * starts the run; a player who reconnects keeps the chamber they already had,
 * because it is stored per player and never recomputed.
 */
export function assignSessionChambers(room, { chambers = CHAMBERS } = {}) {
  const players = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const assignment = assignChambers(players.map((p) => p.id), { chambers });

  for (const player of players) {
    player.chamberId = assignment.get(player.id) || null;
  }

  const occupied = new Set(assignment.values());

  return {
    assigned: assignment.size,
    chambersOccupied: occupied.size,
    chambersAvailable: chambers.length,
    /**
     * True when there are fewer players than chambers, so at least one chamber
     * is unoccupied. The information in an unoccupied chamber is unreachable,
     * which is exactly why ROOMS.md sets a floor of three.
     */
    underCrewed: occupied.size < chambers.length,
  };
}

/**
 * A late joiner (someone who reconnects into a running session without a
 * chamber, or joins a session that has already started) gets the emptiest
 * chamber rather than a random one.
 */
export function assignLateJoiner(room, { chambers = CHAMBERS } = {}) {
  const counts = new Map(chambers.map((c) => [c.id, 0]));

  for (const player of room.players.values()) {
    if (player.chamberId && counts.has(player.chamberId)) {
      counts.set(player.chamberId, counts.get(player.chamberId) + 1);
    }
  }

  let best = chambers[0].id;
  let bestCount = Infinity;
  for (const [id, count] of counts) {
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }

  return best;
}

export function chamberName(id) {
  return CHAMBERS.find((c) => c.id === id)?.name || id;
}
