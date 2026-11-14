// player.js - the human player: movement, look, health, crouch and jump.
// One job: turn the input state into a first-person body that collides with
// the map. Acceleration/deceleration, crouch and aim-down-sights all feed the
// same speed model the bots use, so stopping to aim genuinely pays.

import * as THREE from 'three';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;
const RADIUS = 0.42;
const HEIGHT_STAND = 1.75;
const HEIGHT_CROUCH = 1.2;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.7;
const ADS_SPEED = 3.1;
const SLOW_SPEED = 2.9;
const JUMP_VEL = 5.4;
const GRAVITY = -15;

export function createPlayer(spawn) {
  return {
    isPlayer: true,
    team: 'Vanguard',
    name: 'You',
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0, // facing north (-z) at spawn
    pitch: 0,
    hp: 100,
    armour: 0,
    alive: true,
    crouch: false,
    onGround: true,
    eyeHeight: EYE_STAND,
    height: HEIGHT_STAND,
    weapon: 'VK-9 Carbine',
    mag: 30,
    reserve: 90,
    reloading: 0,
    spread: 0,
    recoil: 0,
    grenades: 1,
    money: 800,
    kills: 0,
    deaths: 0,
    moving: false,
    stepAcc: 0,
    owned: ['P9 Sparrow', 'VK-9 Carbine'],
  };
}

// Apply damage with armour absorbing half until it is spent. Returns true
// when the hit killed the player.
export function damagePlayer(S, amount, fromName) {
  const p = S.player;
  if (!p.alive) return false;
  let left = amount;
  if (p.armour > 0) {
    const absorbed = Math.min(p.armour, left * 0.5);
    p.armour -= absorbed;
    left -= absorbed;
  }
  p.hp -= left;
  S.audio.hurt();
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deaths += 1;
    S.hud.killfeed(S, fromName, 'You', false);
    return true;
  }
  return false;
}

export function updatePlayer(S, dt) {
  const p = S.player;
  const input = S.input;
  if (!p.alive || S.round.phase === 'ended' || S.round.phase === 'match') {
    // Dead or between rounds: no movement, but the camera still looks.
    const look = input.consumeLook();
    const arrows = input.arrowLook();
    p.yaw -= (look.dx + arrows.dx) * 0.0021;
    p.pitch -= (look.dy + arrows.dy) * 0.0021;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    input.endTick();
    return;
  }

  // Look: mouse (or drag fallback) plus arrow keys.
  const look = input.consumeLook();
  const arrows = input.arrowLook();
  p.yaw -= (look.dx + arrows.dx) * 0.0021;
  p.pitch -= (look.dy + arrows.dy) * 0.0021;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

  // Crouch (hold Ctrl) lowers the eye and the body, and steadies the aim.
  const wantCrouch = input.down.has('ControlLeft') || input.down.has('ControlRight');
  p.crouch = wantCrouch;
  const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
  p.eyeHeight += (targetEye - p.eyeHeight) * Math.min(1, dt * 12);
  p.height = wantCrouch ? HEIGHT_CROUCH : HEIGHT_STAND;

  // Movement: WASD in yaw space, with acceleration and friction.
  const frozen = S.round.phase === 'buy';
  let ix = 0;
  let iz = 0;
  if (!frozen) {
    if (input.down.has('KeyW')) iz -= 1;
    if (input.down.has('KeyS')) iz += 1;
    if (input.down.has('KeyA')) ix -= 1;
    if (input.down.has('KeyD')) ix += 1;
  }
  const moving = ix !== 0 || iz !== 0;
  p.moving = moving;
  const slow = input.down.has('ShiftLeft') || input.down.has('ShiftRight');
  let speed = WALK_SPEED;
  if (p.crouch) speed = CROUCH_SPEED;
  else if (input.ads) speed = ADS_SPEED;
  else if (slow) speed = SLOW_SPEED;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // Forward is -z rotated by yaw; right is +x rotated by yaw.
  let wx = 0;
  let wz = 0;
  if (moving) {
    const len = Math.hypot(ix, iz);
    const nx = ix / len;
    const nz = iz / len;
    wx = (-sin * -nz + cos * nx) * speed;
    wz = (-cos * -nz - sin * nx) * speed;
  }
  // Exponential approach to the target velocity: quick to start, quick to
  // stop, so stopping to aim is a real choice.
  const k = 1 - Math.exp(-(moving ? 10 : 12) * dt);
  p.vel.x += (wx - p.vel.x) * k;
  p.vel.z += (wz - p.vel.z) * k;

  // Jump (small) with gravity.
  if (input.pressed.has('Space') && p.onGround && !frozen) {
    p.vel.y = JUMP_VEL;
    p.onGround = false;
  }
  p.vel.y += GRAVITY * dt;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) {
    p.pos.y = 0;
    p.vel.y = 0;
    p.onGround = true;
  }

  // Collide with the map, then clamp to the yard bounds.
  const { collideCircle } = S.worldFns;
  collideCircle(p.pos, RADIUS, p.height, S.world.colliders);
  const b = S.world.bounds;
  p.pos.x = Math.max(b.minX, Math.min(b.maxX, p.pos.x));
  p.pos.z = Math.max(b.minZ, Math.min(b.maxZ, p.pos.z));

  // Footsteps: one tick per stride while moving on the ground.
  if (moving && p.onGround) {
    p.stepAcc += Math.hypot(p.vel.x, p.vel.z) * dt;
    if (p.stepAcc > 2.4) {
      p.stepAcc = 0;
      S.audio.step();
    }
  }

  // Spread bloom: grows while firing and moving, shrinks when still,
  // crouched or aiming. Recoil decays back to zero.
  const baseBloom = p.crouch ? 0.4 : 1;
  const moveBloom = Math.hypot(p.vel.x, p.vel.z) / WALK_SPEED;
  const adsBloom = input.ads ? 0.45 : 1;
  const target = (0.004 + moveBloom * 0.012) * baseBloom * adsBloom + p.recoil * 0.02;
  p.spread += (target - p.spread) * Math.min(1, dt * 8);
  p.recoil = Math.max(0, p.recoil - dt * 2.4);

  // Camera follows the body; recoil kicks the pitch up briefly.
  S.camera.position.set(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
  S.camera.rotation.order = 'YXZ';
  S.camera.rotation.y = p.yaw;
  S.camera.rotation.x = p.pitch + p.recoil * 0.35;
  S.camera.rotation.z = 0;

  input.endTick();
}
