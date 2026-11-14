// bots.js - the seven bots: three Vanguard allies, four Bulwark defenders.
// One job: decide where each bot goes and when it shoots. State machine:
// advance (follow the waypoint route) / hold (guard an angle, scan) /
// engage (a visible enemy, with reaction delay and distance-scaled accuracy)
// / plant / defuse / investigate (gunfire heard nearby). Bots see through
// line-of-sight and a field of view, and hear shots, so a still, aiming
// player wins duels and a sprinting one loses them.

import * as THREE from 'three';
import { nearestWaypoint, findRoute, losClear } from './world.js';
import { fireShot, updateReload, WEAPONS } from './weapons.js';

const ALLY_NAMES = ['Dara', 'Kestrel', 'Mira'];
const ENEMY_NAMES = ['Rook', 'Fen', 'Hale', 'Voss'];
const EYE_Y = 1.5;
const BOT_SPEED = 4.3;
const SEE_DIST = 48;
const FOV_COS = 0.42; // ~65 degrees half-angle

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function makeBot(S, team, name, spawn, weaponName) {
  const color = team === 'Vanguard' ? 0xf0a830 : 0x2e7f86;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, 0.34), mat);
  body.position.y = 1.0;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), dark);
  head.position.y = 1.55;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), new THREE.MeshBasicMaterial({ color }));
  visor.position.set(0, 1.56, -0.19);
  group.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.24), dark);
  legL.position.set(-0.14, 0.25, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.24), dark);
  legR.position.set(0.14, 0.25, 0);
  group.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.72), dark);
  gun.position.set(0.28, 1.28, -0.3);
  group.add(gun);
  group.position.set(spawn.x, 0, spawn.z);
  S.scene.add(group);
  const w = WEAPONS[weaponName];
  return {
    isPlayer: false,
    team,
    name,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: team === 'Vanguard' ? 0 : Math.PI,
    hp: 100,
    armour: 0,
    alive: true,
    mesh: group,
    weapon: weaponName,
    mag: w.mag,
    reserve: w.reserve,
    reloading: 0,
    spread: 0,
    recoil: 0,
    grenades: 0,
    money: 0,
    kills: 0,
    state: 'hold',
    route: [],
    routeIdx: 0,
    holdNode: 0,
    target: null,
    lastSeen: null,
    lastSeenT: -99,
    reactionT: 0,
    fireT: 0,
    burstLeft: 0,
    scanT: 0,
    actionT: 0,
    carrier: false,
    site: null,
    speed: BOT_SPEED,
  };
}

export function createBots(S) {
  const bots = [];
  const vSpawns = S.world.spawns.Vanguard;
  const bSpawns = S.world.spawns.Bulwark;
  for (let i = 0; i < 3; i++) {
    bots.push(makeBot(S, 'Vanguard', ALLY_NAMES[i], vSpawns[i + 1], 'VK-9 Carbine'));
  }
  const enemyGuns = ['Raptor-9', 'VK-9 Carbine', 'Raptor-9', 'VK-9 Carbine'];
  for (let i = 0; i < 4; i++) {
    bots.push(makeBot(S, 'Bulwark', ENEMY_NAMES[i], bSpawns[i], enemyGuns[i]));
  }
  return bots;
}

export function resetBot(S, bot, spawn) {
  bot.pos.set(spawn.x, 0, spawn.z);
  bot.vel.set(0, 0, 0);
  bot.hp = 100;
  bot.alive = true;
  bot.mesh.visible = true;
  bot.mesh.position.set(spawn.x, 0, spawn.z);
  bot.yaw = bot.team === 'Vanguard' ? 0 : Math.PI;
  bot.state = 'hold';
  bot.route = [];
  bot.routeIdx = 0;
  bot.target = null;
  bot.lastSeen = null;
  bot.reactionT = 0;
  bot.burstLeft = 0;
  bot.actionT = 0;
  bot.carrier = false;
  const w = WEAPONS[bot.weapon];
  bot.mag = w.mag;
  bot.reserve = w.reserve;
  bot.reloading = 0;
}

// Send a bot along the waypoint graph to a node index.
export function sendBot(S, bot, nodeIdx) {
  const from = nearestWaypoint(bot.pos.x, bot.pos.z, S.world.waypoints);
  bot.route = findRoute(from, nodeIdx, S.world.waypoints);
  bot.routeIdx = 0;
  bot.state = 'advance';
}

// Can this bot see that fighter? Distance, field of view, line of sight.
function canSee(S, bot, fighter) {
  if (!fighter.alive) return false;
  _eye.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
  _to.set(fighter.pos.x, fighter.pos.y + 1.2, fighter.pos.z).sub(_eye);
  const dist = _to.length();
  if (dist > SEE_DIST) return false;
  _dir.copy(_to).normalize();
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const facing = _dir.x * fx + _dir.z * fz;
  if (facing < FOV_COS && dist > 7) return false;
  const targetEye = new THREE.Vector3(fighter.pos.x, fighter.pos.y + EYE_Y, fighter.pos.z);
  return losClear(_eye, targetEye, S.world.colliders);
}

function nearestVisibleEnemy(S, bot) {
  let best = null;
  let bestD = Infinity;
  const foes = S.bots.filter((b) => b.alive && b.team !== bot.team);
  if (S.player.alive && S.player.team !== bot.team) foes.push(S.player);
  for (const f of foes) {
    if (!canSee(S, bot, f)) continue;
    const d = Math.hypot(f.pos.x - bot.pos.x, f.pos.z - bot.pos.z);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

// Aim at the target's chest with an error that grows with distance and
// with how fast the target moves - a still target is an easy target.
function aimAt(S, bot, target, out) {
  _eye.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
  out.set(target.pos.x, target.pos.y + 1.05, target.pos.z).sub(_eye);
  const dist = out.length();
  out.normalize();
  const speed = Math.hypot(target.vel.x, target.vel.z);
  const err = 0.012 + dist * 0.0011 + speed * 0.0045 + (target.crouch ? -0.004 : 0);
  _up.set(0, 1, 0);
  _right.crossVectors(out, _up).normalize();
  _up.crossVectors(_right, out).normalize();
  const ex = (S.rng() - 0.5) * 2 * err;
  const ey = (S.rng() - 0.5) * 2 * err;
  out.addScaledVector(_right, ex).addScaledVector(_up, ey).normalize();
  return dist;
}

function botShoot(S, bot, dt) {
  if (!bot.target || !bot.target.alive) return;
  if (bot.reloading > 0) return;
  if (bot.reactionT > 0) {
    bot.reactionT -= dt;
    return;
  }
  if (bot.mag <= 0) {
    const { startReload } = S.weaponFns;
    startReload(S, bot);
    return;
  }
  bot.fireT -= dt;
  if (bot.fireT > 0) return;
  if (bot.burstLeft <= 0) {
    bot.burstLeft = 3 + Math.floor(S.rng() * 3);
    bot.fireT = 0.15;
    return;
  }
  // One shot of the burst.
  bot.burstLeft -= 1;
  bot.fireT = 0.12;
  bot.mag -= 1;
  _eye.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
  const dist = aimAt(S, bot, bot.target, _dir);
  fireShot(S, bot, _eye, _dir);
  S.audio.enemyShot(dist);
  S.noiseEvents.push({ x: bot.pos.x, z: bot.pos.z, t: S.time });
  if (bot.burstLeft === 0) bot.fireT = 0.7 + S.rng() * 0.7;
}

function moveAlongRoute(S, bot, dt) {
  if (bot.routeIdx >= bot.route.length) return true;
  const node = S.world.waypoints[bot.route[bot.routeIdx]];
  const dx = node.x - bot.pos.x;
  const dz = node.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.2) {
    bot.routeIdx += 1;
    return bot.routeIdx >= bot.route.length;
  }
  const sp = bot.speed * (bot.state === 'engage' ? 0.45 : 1);
  bot.vel.x = (dx / d) * sp;
  bot.vel.z = (dz / d) * sp;
  bot.pos.x += bot.vel.x * dt;
  bot.pos.z += bot.vel.z * dt;
  bot.yaw = Math.atan2(-dx, -dz);
  const { collideCircle } = S.worldFns;
  collideCircle(bot.pos, 0.42, 1.75, S.world.colliders);
  const b = S.world.bounds;
  bot.pos.x = Math.max(b.minX, Math.min(b.maxX, bot.pos.x));
  bot.pos.z = Math.max(b.minZ, Math.min(b.maxZ, bot.pos.z));
  return false;
}

function hearNoise(S, bot) {
  for (const n of S.noiseEvents) {
    const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
    if (d < 26 && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
      const node = nearestWaypoint(n.x, n.z, S.world.waypoints);
      sendBot(S, bot, node);
      return true;
    }
  }
  return false;
}

export function updateBots(S, dt) {
  for (const bot of S.bots) {
    if (!bot.alive) continue;
    updateReload(S, bot, dt);

    // Sense: a visible enemy becomes the target, with a reaction delay.
    const seen = nearestVisibleEnemy(S, bot);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactionT = 0.45 + S.rng() * 0.35;
        bot.burstLeft = 0;
      }
      bot.lastSeen = { x: seen.pos.x, z: seen.pos.z };
      bot.lastSeenT = S.time;
      if (bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'engage';
    } else if (bot.target && S.time - bot.lastSeenT > 1.2) {
      bot.target = null;
      if (bot.state === 'engage') {
        bot.state = 'hold';
        bot.holdNode = nearestWaypoint(bot.pos.x, bot.pos.z, S.world.waypoints);
      }
    }

    // Demo / screenshot scenes: bots hold their marks and never fire.
    if (S.demo) {
      bot.mesh.position.copy(bot.pos);
      bot.mesh.rotation.y = bot.yaw;
      continue;
    }

    if (S.round.phase !== 'live') {
      bot.mesh.position.copy(bot.pos);
      bot.mesh.rotation.y = bot.yaw;
      continue;
    }

    switch (bot.state) {
      case 'engage': {
        if (bot.target) {
          const dx = bot.target.pos.x - bot.pos.x;
          const dz = bot.target.pos.z - bot.pos.z;
          bot.yaw = Math.atan2(-dx, -dz);
          // Strafe slowly while duelling; never stand in the open still.
          const strafe = Math.sin(S.time * 0.9 + bot.pos.x) * 1.2;
          bot.pos.x += Math.cos(bot.yaw) * strafe * dt;
          bot.pos.z += -Math.sin(bot.yaw) * strafe * dt;
          botShoot(S, bot, dt);
        }
        break;
      }
      case 'advance': {
        const arrived = moveAlongRoute(S, bot, dt);
        if (arrived) {
          if (bot.carrier && S.spike.state === 'carried' && S.spike.carrier === bot) {
            bot.state = 'plant';
            bot.actionT = 0;
          } else {
            bot.state = 'hold';
            bot.holdNode = nearestWaypoint(bot.pos.x, bot.pos.z, S.world.waypoints);
          }
        }
        hearNoise(S, bot);
        break;
      }
      case 'plant': {
        bot.actionT += dt;
        S.hud.plantBar(true, 'SPIKE BEING PLANTED', Math.min(1, bot.actionT / 3));
        if (bot.actionT >= 3) {
          S.rounds.plantSpike(S, bot, bot.site || 'A');
          bot.state = 'hold';
          S.hud.plantBar(false, '', 0);
        }
        break;
      }
      case 'defuse': {
        bot.actionT += dt;
        S.hud.plantBar(true, 'SPIKE BEING DEFUSED', Math.min(1, bot.actionT / 5));
        if (bot.actionT >= 5) {
          S.rounds.defuseSpike(S, bot);
          bot.state = 'hold';
          S.hud.plantBar(false, '', 0);
        }
        break;
      }
      case 'hold':
      default: {
        // Guard the angle: slow yaw sweep, listening for gunfire.
        bot.scanT += dt;
        bot.yaw += Math.sin(bot.scanT * 0.5) * 0.25 * dt;
        hearNoise(S, bot);
        break;
      }
    }

    // Spike duties: carrier walks to its site; defenders retake a plant.
    if (bot.carrier && S.spike.state === 'carried' && S.spike.carrier === bot && bot.state !== 'plant' && bot.state !== 'engage') {
      const site = S.world.sites[bot.site || 'A'];
      const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
      if (d < site.r) {
        bot.state = 'plant';
        bot.actionT = 0;
      } else if (bot.state === 'hold') {
        const node = bot.site === 'B' ? 13 : 11;
        sendBot(S, bot, node);
      }
    }
    if (bot.team === 'Bulwark' && S.spike.state === 'planted' && bot.state !== 'defuse' && bot.state !== 'engage') {
      const site = S.world.sites[S.spike.site];
      const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
      if (d < 2.5) {
        bot.state = 'defuse';
        bot.actionT = 0;
      } else if (bot.state === 'hold') {
        sendBot(S, bot, S.spike.site === 'B' ? 13 : 11);
      }
    }

    bot.mesh.position.copy(bot.pos);
    bot.mesh.rotation.y = bot.yaw;
  }
}
