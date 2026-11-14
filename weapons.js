// weapons.js - the armoury: weapon table, hitscan fire with headshots,
// recoil and spread, reloads, and the Spark-4 grenade. One job: resolve
// every shot against bodies and walls. Hits are ray-vs-sphere (head and
// body), walls are ray-vs-AABB, so a crate between shooter and target saves
// a life. No new objects in the hot path: module-level scratch vectors.

import * as THREE from 'three';
import { rayWalls } from './world.js';

export const WEAPONS = {
  'P9 Sparrow': { slot: 1, price: 0, mag: 12, reserve: 24, dmg: 34, rof: 0.15, spread: 0.011, auto: false, kick: 0.010, reload: 1.1, range: 60 },
  'Raptor-9': { slot: 2, price: 1500, mag: 25, reserve: 75, dmg: 26, rof: 0.07, spread: 0.019, auto: true, kick: 0.014, reload: 1.4, range: 55 },
  'VK-9 Carbine': { slot: 2, price: 2700, mag: 30, reserve: 90, dmg: 34, rof: 0.10, spread: 0.007, auto: true, kick: 0.018, reload: 1.6, range: 80 },
  'Longshot-7': { slot: 3, price: 4200, mag: 5, reserve: 15, dmg: 82, rof: 0.95, spread: 0.002, auto: false, kick: 0.05, reload: 2.2, range: 120, scoped: true },
};

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

// Ray vs sphere. Returns the hit distance, or Infinity.
function raySphere(origin, dir, centre, radius) {
  _to.copy(centre).sub(origin);
  const tca = _to.dot(dir);
  if (tca < 0) return Infinity;
  const d2 = _to.lengthSq() - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// A fighter's hit spheres: head (2x damage) and two body spheres.
function hitSpheres(fighter) {
  const p = fighter.pos;
  return [
    { c: _eye.set(p.x, p.y + 1.52, p.z), r: 0.21, head: true },
    { c: new THREE.Vector3(p.x, p.y + 1.0, p.z), r: 0.42, head: false },
    { c: new THREE.Vector3(p.x, p.y + 0.45, p.z), r: 0.40, head: false },
  ];
}

// Fire one hitscan shot from `shooter` along `dir` (already spread).
// Returns the hit record, or null. Applies damage, kill feed, tracers.
export function fireShot(S, shooter, origin, dir) {
  const w = WEAPONS[shooter.weapon];
  if (!w) return null;
  const wallT = rayWalls(origin, dir, w.range, S.world.colliders);
  let bestT = wallT;
  let bestTarget = null;
  let bestHead = false;

  const enemies = shooter.isPlayer
    ? S.bots.filter((b) => b.alive && b.team !== shooter.team)
    : S.bots.filter((b) => b.alive && b.team !== shooter.team && !b.isPlayer)
        .concat(S.player.alive && S.player.team !== shooter.team ? [S.player] : []);
  for (const t of enemies) {
    const spheres = hitSpheres(t);
    for (const s of spheres) {
      const hit = raySphere(origin, dir, s.c, s.r);
      if (hit < bestT) {
        bestT = hit;
        bestTarget = t;
        bestHead = s.head;
      }
    }
  }

  // Tracer from the muzzle to the impact point (reused line objects).
  const end = _muzzle.copy(dir).multiplyScalar(bestT === Infinity ? w.range : bestT).add(origin);
  addTracer(S, origin, end);

  if (!bestTarget) return { hit: false, dist: wallT };
  const dmg = w.dmg * (bestHead ? 2 : 1);
  const killed = applyDamage(S, bestTarget, dmg, shooter, bestHead);
  if (shooter.isPlayer) {
    S.hud.hitmarker(bestHead);
    S.audio.hit();
    if (killed) S.audio.kill();
  }
  return { hit: true, target: bestTarget, head: bestHead, killed, dist: bestT };
}

function applyDamage(S, target, dmg, shooter, head) {
  if (target.isPlayer) {
    const { damagePlayer } = S.playerFns;
    const died = damagePlayer(S, dmg, shooter.name);
    if (died) S.rounds.onKill(S, shooter, target);
    return died;
  }
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.mesh.visible = false;
    S.hud.killfeed(S, shooter.name, target.name, head);
    if (shooter.isPlayer) {
      shooter.kills += 1;
      shooter.money += 300;
    }
    S.rounds.onKill(S, shooter, target);
    return true;
  }
  return false;
}

// Player trigger pull: rate of fire, ammo, recoil, spread. Called every tick
// while the trigger is held (auto weapons) or on the press edge (semi-auto).
export function playerShoot(S, dt) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  if (!p.alive || S.round.phase !== 'live') return;
  if (p.reloading > 0) return;
  p.fireCooldown = Math.max(0, (p.fireCooldown || 0) - dt);
  // Auto weapons fire while the trigger is held; semi-auto weapons fire
  // once per click (on the trigger's rising edge).
  const trigger = S.input.firing;
  const wantFire = w.auto ? trigger : trigger && !p._wasFiring;
  p._wasFiring = trigger;
  if (!wantFire || p.fireCooldown > 0) return;
  if (p.mag <= 0) {
    S.audio.dryFire();
    p.fireCooldown = 0.25;
    startReload(S, p);
    return;
  }
  p.fireCooldown = w.rof;
  p.mag -= 1;
  p.recoil = Math.min(0.09, p.recoil + w.kick);
  // Spread: base weapon spread + bloom from movement/recoil, tighter aiming.
  const spread = w.spread + p.spread + (p.crouch ? -0.002 : 0);
  _o.copy(S.camera.position);
  S.camera.getWorldDirection(_d);
  const a = (Math.random() - 0.5) * 2 * spread;
  const b = (Math.random() - 0.5) * 2 * spread;
  // Jitter the direction in camera space without allocating.
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(S.camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(S.camera.quaternion);
  _d.addScaledVector(right, a).addScaledVector(up, b).normalize();
  fireShot(S, p, _o, _d);
  S.audio.shot(p.weapon);
  S.noiseEvents.push({ x: p.pos.x, z: p.pos.z, t: S.time });
  S.hud.kickFlash();
}

export function startReload(S, shooter) {
  const w = WEAPONS[shooter.weapon];
  if (!w || shooter.reloading > 0 || shooter.mag >= w.mag || shooter.reserve <= 0) return;
  shooter.reloading = w.reload;
  if (shooter.isPlayer) S.audio.reload();
}

export function updateReload(S, shooter, dt) {
  if (shooter.reloading <= 0) return;
  shooter.reloading -= dt;
  if (shooter.reloading <= 0) {
    shooter.reloading = 0;
    const w = WEAPONS[shooter.weapon];
    const need = w.mag - shooter.mag;
    const take = Math.min(need, shooter.reserve);
    shooter.mag += take;
    shooter.reserve -= take;
  }
}

export function giveWeapon(S, shooter, name) {
  const w = WEAPONS[name];
  if (!w) return false;
  shooter.weapon = name;
  shooter.mag = w.mag;
  shooter.reserve = w.reserve;
  shooter.reloading = 0;
  return true;
}

export function switchSlot(S, slot) {
  const p = S.player;
  const owned = p.owned.filter((n) => WEAPONS[n].slot === slot);
  if (owned.length === 0) return;
  const cur = owned.indexOf(p.weapon);
  giveWeapon(S, p, owned[(cur + 1) % owned.length]);
}

// --- Grenades ---------------------------------------------------------------

export function throwGrenade(S, shooter) {
  if (shooter.grenades <= 0) return;
  shooter.grenades -= 1;
  const dir = new THREE.Vector3();
  if (shooter.isPlayer) S.camera.getWorldDirection(dir);
  else dir.set(Math.sin(shooter.yaw), 0.25, -Math.cos(shooter.yaw)).normalize();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x222222 }),
  );
  mesh.position.copy(shooter.pos).add(new THREE.Vector3(0, 1.4, 0));
  S.scene.add(mesh);
  S.grenades.push({
    mesh,
    pos: mesh.position,
    vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
    fuse: 1.6,
  });
  S.audio.grenadeThrow();
}

export function updateGrenades(S, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.vel.y -= 14 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      g.vel.y *= -0.4;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(S, g);
      S.scene.remove(g.mesh);
      S.grenades.splice(i, 1);
    }
  }
}

function explodeGrenade(S, g) {
  S.audio.explosion();
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.9 }),
  );
  flash.position.copy(g.pos);
  S.scene.add(flash);
  S.flashes.push({ mesh: flash, life: 0.25 });
  const targets = S.bots.filter((b) => b.alive).concat(S.player.alive ? [S.player] : []);
  for (const t of targets) {
    const d = Math.hypot(t.pos.x - g.pos.x, t.pos.z - g.pos.z);
    if (d > 6.5) continue;
    const dmg = Math.round(95 - (d / 6.5) * 70);
    if (t.isPlayer) {
      const { damagePlayer } = S.playerFns;
      if (damagePlayer(S, dmg, 'Spark-4')) S.rounds.onKill(S, { name: 'Spark-4' }, t);
    } else {
      t.hp -= dmg;
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        t.mesh.visible = false;
        S.hud.killfeed(S, 'Spark-4', t.name, false);
        S.rounds.onKill(S, { name: 'Spark-4' }, t);
      }
    }
  }
}

// --- Tracers ----------------------------------------------------------------

function addTracer(S, from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 }));
  S.scene.add(line);
  S.tracers.push({ line, life: 0.08 });
}

export function updateTracers(S, dt) {
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    const t = S.tracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      S.scene.remove(t.line);
      t.line.geometry.dispose();
      S.tracers.splice(i, 1);
    }
  }
  for (let i = S.flashes.length - 1; i >= 0; i--) {
    const f = S.flashes[i];
    f.life -= dt;
    f.mesh.material.opacity = Math.max(0, f.life / 0.25) * 0.9;
    if (f.life <= 0) {
      S.scene.remove(f.mesh);
      S.flashes.splice(i, 1);
    }
  }
}
