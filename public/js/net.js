// Socket transport + local identity.
//
// The client stores exactly one secret: the token that proves "I was already in
// this room before I refreshed". It never stores player lists, crew counts, or
// (later) puzzle answers - those come from the server on every change, because
// the server is the only thing allowed to know them.

const STORAGE_KEY = 'keystone.session';

/*
 * sessionStorage, not localStorage, and that is load-bearing.
 *
 * sessionStorage is scoped per tab, so two windows on the same laptop are two
 * genuinely separate players - which is exactly how you test this locally.
 * localStorage is shared across tabs, so both windows would present the same
 * token, and the second would take over the first one's seat instead of
 * joining as a second player.
 *
 * It also survives a refresh, which is what the reconnect path needs.
 */
function readSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeSession(patch) {
  try {
    const next = { ...readSession(), ...patch };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return readSession();
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage disabled (private mode, locked-down school profile) - the app
       still works, it just cannot survive a refresh. */
  }
}

export const session = {
  read: readSession,
  write: writeSession,
  clear: clearSession,
};

/**
 * Thin wrapper over the socket.io client.
 *
 * `request` turns socket.io's ack callbacks into promises and adds a timeout,
 * so a dropped connection surfaces as a rejected promise the UI can show,
 * rather than a button that silently spins forever.
 */
export function createNet() {
  const socket = window.io({
    // Reconnect aggressively but back off, so a whole class refreshing at once
    // does not hammer a free-tier host.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 8000,
  });

  const listeners = new Map();

  function on(event, handler) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
      socket.on(event, (payload) => {
        for (const fn of listeners.get(event)) fn(payload);
      });
    }
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  }

  function request(event, payload, { timeout = 8000 } = {}) {
    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          error: 'TIMEOUT',
          message: 'The server did not answer. Check your connection.',
        });
      }, timeout);

      socket.emit(event, payload, (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply || { ok: false, error: 'NO_REPLY', message: 'No reply from the server.' });
      });
    });
  }

  return {
    socket,
    on,
    request,
    get id() {
      return socket.id;
    },
    get connected() {
      return socket.connected;
    },
  };
}
