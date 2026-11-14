// world.js - Meridian Yard: a rail depot / container yard at dusk. One job:
// build the map (geometry, lights, palette), hold its collision boxes and
// its waypoint graph, and answer collision and line-of-sight queries. The
// simulation never touches three.js meshes directly; it asks this module.
//
// Layout (metres, x east, z south, north is -z): a walled yard 80 x 60.
// Site A, the container stack, sits north-west; Site B, the rail shed,
// sits south-east. Three lanes join them: Long Haul (west), Mid Alley
// (centre) and Underpass (east). Vanguard spawns south, Bulwark north.

import * as THREE from 'three';

// Deterministic RNG for map-adjacent choices (bot routes, shot setups).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palette: dusk amber accent, concrete grey, deep teal shadow.
export const PALETTE = {
  amber: 0xf0a830,
  concrete: 0x8a8d90,
  concreteDark: 0x5c6063,
  teal: 0x2e7f86,
  tealDark: 0x1d4a50,
  rust: 0x9a5a34,
  ground: 0x3a3f42,
  wall: 0x6e7276,
  sky: 0x1a222b,
};

// One box in the map: position, size, colour, and whether it blocks movement.
const BOXES = [
  // Perimeter walls (height 5).
  { x: 0, z: -30.5, w: 82, h: 5, d: 1, c: PALETTE.wall },
  { x: 0, z: 30.5, w: 82, h: 5, d: 1, c: PALETTE.wall },
  { x: -40.5, z: 0, w: 1, h: 5, d: 62, c: PALETTE.wall },
  { x: 40.5, z: 0, w: 1, h: 5, d: 62, c: PALETTE.wall },
  // Site A - container stack (north-west).
  { x: -30, z: -20, w: 6, h: 2.6, d: 2.6, c: PALETTE.rust },
  { x: -30, z: -20, w: 6, h: 2.6, d: 2.6, c: PALETTE.rust, y: 2.6 },
  { x: -24, z: -15, w: 2.6, h: 2.6, d: 6, c: PALETTE.tealDark },
  { x: -34, z: -14, w: 2.4, h: 2.4, d: 2.4, c: PALETTE.concreteDark },
  { x: -22, z: -22, w: 4, h: 1.3, d: 2, c: PALETTE.concrete },
  // Site B - rail shed (south-east), open on its west and north sides.
  { x: 33, z: 18, w: 1, h: 4, d: 12, c: PALETTE.wall },
  { x: 28, z: 23.5, w: 11, h: 4, d: 1, c: PALETTE.wall },
  { x: 28, z: 18, w: 8, h: 0.4, d: 10, c: PALETTE.tealDark, y: 4, roof: true },
  { x: 24, z: 16, w: 2.4, h: 2.4, d: 2.4, c: PALETTE.rust },
  { x: 31, z: 21, w: 3, h: 1.3, d: 2, c: PALETTE.concrete },
  // Mid: central silo and crates.
  { x: 0, z: 0, w: 4, h: 6, d: 4, c: PALETTE.concreteDark },
  { x: 8, z: 5, w: 2, h: 1.2, d: 2, c: PALETTE.concrete },
  { x: -9, z: 7, w: 3, h: 1.4, d: 2, c: PALETTE.rust },
  { x: -6, z: -6, w: 2, h: 1.2, d: 2, c: PALETTE.concrete },
  { x: 10, z: -7, w: 3, h: 1.4, d: 2, c: PALETTE.tealDark },
  // Long Haul (west lane) crates.
  { x: -34, z: 8, w: 2.4, h: 2.4, d: 2.4, c: PALETTE.concreteDark },
  { x: -34, z: -8, w: 2, h: 1.2, d: 2, c: PALETTE.rust },
  { x: -36, z: -2, w: 2, h: 1.2, d: 3, c: PALETTE.concrete },
  // Underpass (east lane): two long walls and a low roof.
  { x: 30, z: 0, w: 1, h: 3.4, d: 22, c: PALETTE.wall },
  { x: 37, z: 0, w: 1, h: 3.4, d: 22, c: PALETTE.wall },
  { x: 33.5, z: 0, w: 8, h: 0.4, d: 22, c: PALETTE.concreteDark, y: 3.4, roof: true },
  { x: 33.5, z: -12, w: 2, h: 1.2, d: 2, c: PALETTE.rust },
  // Scatter: rail sleepers and low barriers worth crouching behind.
  { x: -14, z: 14, w: 4, h: 1.1, d: 1, c: PALETTE.concreteDark },
  { x: 14, z: -14, w: 4, h: 1.1, d: 1, c: PALETTE.concreteDark },
  { x: 18, z: 8, w: 1, h: 1.1, d: 4, c: PALETTE.concreteDark },
  { x: -18, z: -8, w: 1, h: 1.1, d: 4, c: PALETTE.concreteDark },
];

// Waypoint graph: nodes bots walk between. `links` are node indices.
const WAYPOINTS = [
  { x: -6, z: 26, links: [1, 2] },      // 0 Vanguard spawn west
  { x: 6, z: 26, links: [0, 2, 4] },    // 1 Vanguard spawn east
  { x: 0, z: 18, links: [0, 1, 3, 4, 7] }, // 2 south mid
  { x: -20, z: 20, links: [2, 5, 18] }, // 3 west approach
  { x: 20, z: 20, links: [1, 2, 9, 14] }, // 4 east approach
  { x: -34, z: 8, links: [3, 6, 18] },  // 5 Long Haul south
  { x: -34, z: -8, links: [5, 12] },    // 6 Long Haul north
  { x: 0, z: 6, links: [2, 8, 18, 19] }, // 7 Mid Alley south
  { x: 0, z: -8, links: [7, 17, 18, 19] }, // 8 Mid Alley north
  { x: 34, z: 8, links: [4, 10, 19] },  // 9 Underpass south
  { x: 34, z: -8, links: [9, 17] },     // 10 Underpass north
  { x: -28, z: -18, links: [6, 12] },   // 11 Site A
  { x: -20, z: -12, links: [6, 11, 17] }, // 12 A approach
  { x: 28, z: 18, links: [4, 9, 14] },  // 13 Site B
  { x: 20, z: 12, links: [4, 13, 19] }, // 14 B approach
  { x: -6, z: -26, links: [16, 17] },   // 15 Bulwark spawn west
  { x: 6, z: -26, links: [15, 17] },    // 16 Bulwark spawn east
  { x: 0, z: -18, links: [8, 10, 12, 15, 16] }, // 17 north mid
  { x: -12, z: 0, links: [3, 5, 7, 8] }, // 18 mid west
  { x: 12, z: 0, links: [7, 8, 9, 14] }, // 19 mid east
];

export function buildWorld(scene) {
  // Dusk sky, warm sun low in the west, cool hemisphere fill, amber fog.
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(0x2a2620, 30, 95);
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x1d3a40, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb347, 1.6);
  sun.position.set(-30, 26, 12);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x2e7f86, 0.35);
  fill.position.set(20, 18, -20);
  scene.add(fill);

  // Ground: dark concrete with a painted amber centre line down Mid Alley.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(82, 62),
    new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 56),
    new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.8 }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.02, 0);
  scene.add(line);

  // Site markers: amber ring at A, teal ring at B, painted on the ground.
  const ringGeo = new THREE.RingGeometry(5.4, 6.4, 40);
  const ringA = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PALETTE.amber, side: THREE.DoubleSide }));
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(-28, 0.03, -18);
  scene.add(ringA);
  const ringB = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PALETTE.teal, side: THREE.DoubleSide }));
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(28, 0.03, 18);
  scene.add(ringB);

  // Boxes: one shared geometry per size is overkill here; a BoxGeometry per
  // box is fine at this count (33 boxes) and keeps the code readable.
  const colliders = [];
  for (const b of BOXES) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshStandardMaterial({ color: b.c, roughness: 0.85, metalness: 0.08 }),
    );
    mesh.position.set(b.x, (b.y || 0) + b.h / 2, b.z);
    scene.add(mesh);
    if (!b.roof) {
      colliders.push({
        minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
        minY: b.y || 0, maxY: (b.y || 0) + b.h,
        minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
      });
    }
  }

  // A few amber yard lamps so the scene reads at a glance.
  for (const [x, z] of [[-20, 0], [20, 0], [-28, -10], [28, 10]]) {
    const lamp = new THREE.PointLight(PALETTE.amber, 12, 18, 1.8);
    lamp.position.set(x, 4.2, z);
    scene.add(lamp);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    pole.position.set(x, 2.1, z);
    scene.add(pole);
  }

  return {
    colliders,
    waypoints: WAYPOINTS,
    sites: {
      A: { x: -28, z: -18, r: 6.5, name: 'Site A' },
      B: { x: 28, z: 18, r: 6.5, name: 'Site B' },
    },
    spawns: {
      Vanguard: [{ x: -6, z: 26 }, { x: -2, z: 27 }, { x: 2, z: 27 }, { x: 6, z: 26 }],
      Bulwark: [{ x: -6, z: -26 }, { x: -2, z: -27 }, { x: 2, z: -27 }, { x: 6, z: -26 }],
    },
    bounds: { minX: -39.4, maxX: 39.4, minZ: -29.4, maxZ: 29.4 },
  };
}

// Push a feet-position out of every AABB it overlaps (circle in XZ, height
// in Y). Mutates and returns `pos` (a THREE.Vector3, feet at pos.y).
export function collideCircle(pos, radius, height, colliders) {
  for (const c of colliders) {
    if (pos.y + height <= c.minY || pos.y >= c.maxY) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pl = pos.x - (c.minX - radius);
      const pr = (c.maxX + radius) - pos.x;
      const pn = pos.z - (c.minZ - radius);
      const pf = (c.maxZ + radius) - pos.z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) pos.x = c.minX - radius;
      else if (m === pr) pos.x = c.maxX + radius;
      else if (m === pn) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  return pos;
}

// Ray vs AABB (slab method). Returns the nearest hit distance, or Infinity.
export function rayBox(origin, dir, maxDist, box) {
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.minX, box.minY, box.minZ];
  const mx = [box.maxX, box.maxY, box.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest wall distance along a ray, or Infinity when nothing is hit.
export function rayWalls(origin, dir, maxDist, colliders) {
  let best = Infinity;
  for (const c of colliders) {
    const t = rayBox(origin, dir, maxDist, c);
    if (t < best) best = t;
  }
  return best;
}

// True when the segment a->b is not cut by any collider (eye-height sight).
export function losClear(a, b, colliders) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  return rayWalls(a, dir, len, colliders) === Infinity;
}

// Nearest waypoint index to a position (XZ only).
export function nearestWaypoint(x, z, waypoints) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first route over the waypoint graph: list of node indices from
// `from` to `to` (excluding `from`, including `to`).
export function findRoute(from, to, waypoints) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of waypoints[cur].links) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let n = to;
        while (n !== from) { n = prev[n]; path.unshift(n); }
        return path.slice(1);
      }
      queue.push(nb);
    }
  }
  return [to];
}
