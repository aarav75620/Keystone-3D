// Central tuning values for the Keystone server.
// Everything here is server-side truth: clients get told these numbers,
// they never set them.

export const PORT = Number(process.env.PORT) || 3000;

// Room codes get read aloud over a voice call, so the alphabet drops every
// character pair that sounds or looks alike: no I/1, no O/0, no S/5.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
export const ROOM_CODE_LENGTH = 4;

// PRD: 2-6 players. Two is the floor because the whole design premise is that
// no single player holds enough information to finish alone.
export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 6;

export const NAME_MAX_LENGTH = 16;

// A page refresh drops the socket. Hold the player's slot (and later, their
// fragment and any active lockout) so refreshing doesn't eject them from the
// crew or free up their seat to a stranger.
export const DISCONNECT_GRACE_MS = 45_000;

// Once the last player is gone, keep the room alive briefly so a refresh or a
// dropped wifi connection can still rejoin the same code.
export const EMPTY_ROOM_TTL_MS = 120_000;

// How often the server checks for expired players and dead rooms.
export const SWEEP_INTERVAL_MS = 5_000;

// Wrong answer penalty. Lives here so phase 5 reads the same number the client
// is told at join time.
export const LOCKOUT_MS = 30_000;
