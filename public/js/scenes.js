// scenes.js - room registry.
//
// A room is a plain object the engine can mount:
//   { group, panels, dimensions?, environment?, colliders?, keepInsideRadius?,
//     update?, applyTier?, dispose? }
//
// colliders: [{x, z, hw, hd}] - solid boxes on the floor plan the player cannot
// walk through. Walls are automatic (the engine clamps to dimensions); this is
// for furniture. keepInsideRadius confines circular rooms radially.
//
// The engine owns the renderer, camera, controls and the global lighting rig.
// A room owns its geometry, its own accent lights, and optionally an
// `environment` that overrides the global rig for rooms the default lighting
// would contradict.
//
// Individual rooms live in ./rooms/. This file only maps ids to factories, so
// adding a room is one import and one registry entry.

// Rooms are imported LAZILY, one module at a time, for two reasons.
//
// Correctness: a static import of six rooms means one missing or broken module
// takes down every room including the working ones. A chamber that fails should
// fail alone.
//
// Cost: each room generates 12-25MB of canvas textures in its factory. Loading
// all of them up front is a 300-700ms main-thread freeze and ~200MB resident,
// which a 4GB school laptop running Chrome does not have spare. A player only
// ever stands in one chamber at a time.

/**
 * Every room factory takes ({ dimensions }) and returns a mountable room.
 * Rooms are constructed at MOUNT time, never at module load - each one
 * generates 12-25MB of canvas textures in its factory, and building all six up
 * front would be a 300-700ms freeze and ~200MB resident on a 4GB laptop.
 */
const REGISTRY = {
  archive: { module: './rooms/archive.js', factory: 'createArchive' },
  'engine-room': { module: './rooms/engine-room.js', factory: 'createEngineRoom' },
  observatory: { module: './rooms/observatory.js', factory: 'createObservatory' },
  vault: { module: './rooms/vault.js', factory: 'createVault' },
  spire: { module: './rooms/spire.js', factory: 'createSpire' },
  // The phase-3 proving room, and the fallback when an assigned chamber cannot
  // be loaded. Something to stand in beats a black screen.
  'room-one': { module: './rooms/room-one.js', factory: 'createRoomOne' },
};

const FALLBACK = 'room-one';

/**
 * Load and build a chamber.
 *
 * If the assigned chamber fails to load or throws while building, fall back to
 * a room that works and say so loudly in the console. A player dropped into a
 * broken chamber mid-run cannot rejoin, so a wrong-but-standing room is strictly
 * better than an empty screen - and the crew can still talk to them.
 */
export async function createRoom(id, options) {
  const entry = REGISTRY[id];

  if (!entry) {
    console.warn(`[keystone] unknown chamber "${id}", falling back to ${FALLBACK}`);
    return createRoom(FALLBACK, options);
  }

  try {
    const module = await import(entry.module);
    const factory = module[entry.factory];
    if (typeof factory !== 'function') {
      throw new Error(`${entry.module} does not export ${entry.factory}`);
    }
    return factory(options);
  } catch (error) {
    console.error(`[keystone] chamber "${id}" failed to load:`, error);
    if (id === FALLBACK) throw error;
    return createRoom(FALLBACK, options);
  }
}

export function hasRoom(id) {
  return Boolean(id) && Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

export function roomIds() {
  return Object.keys(REGISTRY);
}

/** Which chambers actually have a module on disk right now. */
export async function availableRoomIds() {
  const checks = await Promise.all(
    Object.entries(REGISTRY).map(async ([id, entry]) => {
      try {
        await import(entry.module);
        return id;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter(Boolean);
}
