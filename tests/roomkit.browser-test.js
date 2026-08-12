// roomkit browser test
//
// There is no test runner in this project on purpose - it is a no-build, vanilla
// ES module game, and adding a toolchain to test nine pure functions would cost
// more than it returns. These run in the browser console instead, where the real
// Three.js is already loaded.
//
// HOW TO RUN
//   1. npm start
//   2. open http://localhost:3000
//   3. open DevTools console
//   4. paste this whole file and press enter
//
// Everything here is pure geometry maths. It needs no server, no room, and no
// running game - it can be run from the lobby screen.
//
// makeAtlasQuads is the highest-value function in the project (it is what makes
// 48 legible index cards cost one draw call instead of 48) and it is also the
// easiest to get silently wrong: canvas Y runs top-down while UV V runs
// bottom-up, so a missing flip renders every label upside down. That is the
// single most important assertion below.

(async () => {
  const THREE = await import('three');
  const { makeAtlasQuads, mergeGeometries } = await import('/js/roomkit/geometry.js');
  const { lcg } = await import('/js/roomkit/canvas.js');

  const results = [];
  const check = (name, fn) => {
    try {
      fn();
      results.push(`PASS  ${name}`);
    } catch (error) {
      results.push(`FAIL  ${name} :: ${error.message}`);
    }
  };
  const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) < tolerance;

  // --- makeAtlasQuads ------------------------------------------------------

  const quad = makeAtlasQuads(
    [{ width: 2, height: 1, position: [0, 0, 0], cell: [0, 0, 256, 256] }],
    { atlasWidth: 256, atlasHeight: 256 },
  );

  check('one quad is 4 verts and 6 indices', () => {
    if (quad.attributes.position.count !== 4) throw new Error(`verts=${quad.attributes.position.count}`);
    if (quad.index.count !== 6) throw new Error(`indices=${quad.index.count}`);
  });

  check('corners honour width and height', () => {
    const p = quad.attributes.position.array;
    if (!near(p[0], -1) || !near(p[1], -0.5)) throw new Error(`bottom-left ${p[0]},${p[1]}`);
    if (!near(p[6], 1) || !near(p[7], 0.5)) throw new Error(`top-right ${p[6]},${p[7]}`);
  });

  check('a full-atlas cell spans UV 0..1', () => {
    const uv = quad.attributes.uv.array;
    if (!near(uv[0], 0) || !near(uv[1], 0)) throw new Error('bottom-left uv');
    if (!near(uv[4], 1) || !near(uv[5], 1)) throw new Error('top-right uv');
  });

  check('normal faces +Z at rest', () => {
    if (!near(quad.attributes.normal.array[2], 1)) throw new Error('normal.z');
  });

  // THE IMPORTANT ONE. A cell at canvas (0,0) is the TOP-left of the image and
  // must map to the TOP of the quad. Get this wrong and every label is mirrored
  // vertically - which looks like a texture bug, not a UV bug, and costs hours.
  const topLeft = makeAtlasQuads(
    [{ width: 1, height: 1, position: [0, 0, 0], cell: [0, 0, 128, 128] }],
    { atlasWidth: 256, atlasHeight: 256 },
  );

  check('canvas top-left cell maps to the TOP of the quad (V flip)', () => {
    const uv = topLeft.attributes.uv.array;
    if (!near(uv[1], 0.5)) throw new Error(`bottom vertex v should be 0.5, got ${uv[1]}`);
    if (!near(uv[7], 1)) throw new Error(`top vertex v should be 1, got ${uv[7]}`);
  });

  check('rotation reaches the normals', () => {
    const rotated = makeAtlasQuads(
      [{ width: 2, height: 1, position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], cell: [0, 0, 8, 8] }],
      { atlasWidth: 8, atlasHeight: 8 },
    );
    const nx = rotated.attributes.normal.array[0];
    if (!near(Math.abs(nx), 1)) throw new Error(`rotated normal.x=${nx}`);
    rotated.dispose();
  });

  check('position offsets the quad', () => {
    const moved = makeAtlasQuads(
      [{ width: 1, height: 1, position: [5, 6, 7], cell: [0, 0, 8, 8] }],
      { atlasWidth: 8, atlasHeight: 8 },
    );
    const p = moved.attributes.position.array;
    if (!near(p[0], 4.5) || !near(p[1], 5.5) || !near(p[2], 7)) {
      throw new Error(`${p[0]},${p[1]},${p[2]}`);
    }
    moved.dispose();
  });

  check('48 quads merge into one geometry with in-range indices', () => {
    const many = Array.from({ length: 48 }, (_, i) => ({
      width: 0.2,
      height: 0.3,
      position: [i * 0.1, 1, 0],
      cell: [(i % 8) * 64, Math.floor(i / 8) * 64, 64, 64],
    }));
    const merged = makeAtlasQuads(many, { atlasWidth: 512, atlasHeight: 512 });
    if (merged.attributes.position.count !== 192) {
      throw new Error(`verts=${merged.attributes.position.count}`);
    }
    const index = merged.index.array;
    for (let i = 0; i < index.length; i += 1) {
      if (index[i] >= 192) throw new Error(`index out of range: ${index[i]}`);
    }
    merged.dispose();
  });

  // --- mergeGeometries -----------------------------------------------------

  check('mergeGeometries preserves totals and reindexes correctly', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.BoxGeometry(1, 1, 1);
    const merged = mergeGeometries([a, b]);

    if (merged.attributes.position.count !== a.attributes.position.count * 2) {
      throw new Error('vertex count mismatch');
    }
    if (merged.index.count !== a.index.count * 2) throw new Error('index count mismatch');

    let max = 0;
    const index = merged.index.array;
    for (let i = 0; i < index.length; i += 1) max = Math.max(max, index[i]);
    if (max !== merged.attributes.position.count - 1) {
      throw new Error(`highest index ${max} should be ${merged.attributes.position.count - 1}`);
    }

    a.dispose();
    b.dispose();
    merged.dispose();
  });

  // --- lcg -----------------------------------------------------------------
  // Three rooms need deterministic surface detail so every client generates an
  // identical room from a server seed. If this is not stable, two players see
  // different rooms and any puzzle that depends on surface detail breaks.

  check('lcg is deterministic for a given seed', () => {
    const a = lcg(12345);
    const b = lcg(12345);
    for (let i = 0; i < 50; i += 1) {
      if (a() !== b()) throw new Error(`diverged at call ${i}`);
    }
  });

  check('lcg differs across seeds and stays in [0,1)', () => {
    const a = lcg(1);
    const b = lcg(2);
    let same = 0;
    for (let i = 0; i < 50; i += 1) {
      const va = a();
      const vb = b();
      if (va < 0 || va >= 1) throw new Error(`out of range: ${va}`);
      if (va === vb) same += 1;
    }
    if (same > 2) throw new Error(`seeds too correlated (${same}/50 identical)`);
  });

  quad.dispose();
  topLeft.dispose();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log(failed.length ? `\n${failed.length} FAILING` : '\nall green');
  return failed.length ? 'FAILURES' : 'all green';
})();
