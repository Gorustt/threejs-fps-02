// main.js - boot and the fixed-step loop. One job: build the single shared
// state, run the simulation at a fixed 60 Hz kept apart from rendering, and
// render. The state lives in one place (`S`); every module reads it and no
// module keeps its own copy of the match.
//
// Deterministic screenshots: ?shot=start|play|site|end&seed=N sets up a
// fixed scene from a fixed seed (mulberry32) with bots holding their marks
// (S.demo), so the same URL renders the same frame every time.

import * as THREE from 'three';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { buildWorld, mulberry32, collideCircle } from './world.js';
import { createPlayer, updatePlayer, damagePlayer } from './player.js';
import { createBots, updateBots, resetBot, sendBot } from './bots.js';
import { playerShoot, startReload, updateReload, switchSlot, throwGrenade, updateGrenades, updateTracers } from './weapons.js';
import { createMatch, createSpike, setupRound, updateRound, buyItem, takeSpike, plantSpike, defuseSpike } from './rounds.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;

// The rounds module's onKill hook: elimination is checked every tick in
// updateRound, so a planted spike can still decide the round after the
// attackers fall. This hook exists so weapons.js has one kill callback.
function onKill(S, killer, victim) {
  void S;
  void killer;
  void victim;
}

function boot() {
  const params = new URLSearchParams(window.location.search);
  const shotMode = params.get('shot');
  const seed = Number(params.get('seed') || 1) || 1;
  const rng = mulberry32(seed);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  document.getElementById('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);
  scene.add(camera);

  // First-person view model: a simple dark carbine in the lower right of
  // the frame, so the weapon is visible in every screenshot.
  const gun = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.6, metalness: 0.3 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), gunMat);
  gun.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
  gunBarrel.position.set(0, 0.03, -0.42);
  gun.add(gunBarrel);
  const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), new THREE.MeshStandardMaterial({ color: 0xf0a830 }));
  gunSight.position.set(0, 0.1, -0.1);
  gun.add(gunSight);
  gun.position.set(0.28, -0.24, -0.5);
  camera.add(gun);

  const S = {
    renderer,
    scene,
    camera,
    rng,
    time: 0,
    tick: 0,
    started: false,
    demo: !!shotMode,
    shotMode,
    errors: [],
    grenades: [],
    tracers: [],
    flashes: [],
    noiseEvents: [],
    worldFns: { collideCircle },
    playerFns: { damagePlayer },
    weaponFns: { startReload },
    botFns: { resetBot, sendBot },
    // Cross-module calls, wired here so no module imports another in a
    // circle: bots plant/defuse through S.rounds, weapons report kills
    // through it, the HUD buys through it.
    rounds: { plantSpike, defuseSpike, onKill, buyItem },
    hud: null,
    input: null,
    audio: null,
    world: null,
    player: null,
    bots: [],
    round: null,
    spike: null,
  };

  S.world = buildWorld(scene);
  S.input = createInput(renderer.domElement);
  S.audio = createAudio();
  S.player = createPlayer(S.world.spawns.Vanguard[0]);
  S.bots = createBots(S);
  S.round = createMatch();
  S.spike = createSpike();
  S.hud = createHud(S);
  setupRound(S);

  // Start the game: hide the overlay, unlock audio, ask for pointer lock.
  S.startGame = () => {
    S.started = true;
    S.audio.unlock();
    S.hud.showStart(false);
    S.input.requestLock();
  };
  renderer.domElement.addEventListener('click', () => {
    if (S.started) S.input.requestLock();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('error', (e) => S.errors.push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => S.errors.push(String(e.reason)));

  if (shotMode) setupShot(S, shotMode);

  // Fixed-step simulation, decoupled from the render rate.
  let acc = 0;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(100, now - last);
    last = now;
    acc += dtMs / 1000;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      step(S, STEP);
      acc -= STEP;
      steps += 1;
    }
    if (steps === 5) acc = 0;
    S.hud.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // Test hook for the headless play-test: state, errors and a way to drive
  // input without a device.
  window.__MY = {
    S,
    version: 'meridian-yard-1.0',
    get errors() { return S.errors; },
    state() {
      return {
        phase: S.round.phase,
        round: S.round.num,
        timer: +S.round.timer.toFixed(1),
        scoreV: S.round.scoreV,
        scoreB: S.round.scoreB,
        player: {
          x: +S.player.pos.x.toFixed(2), z: +S.player.pos.z.toFixed(2),
          hp: S.player.hp, alive: S.player.alive, mag: S.player.mag,
          reserve: S.player.reserve, weapon: S.player.weapon, money: S.player.money,
        },
        spike: { state: S.spike.state, site: S.spike.site, fuse: +S.spike.fuseT.toFixed(1) },
        bots: S.bots.map((b) => ({ name: b.name, team: b.team, hp: b.hp, alive: b.alive, state: b.state, x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1) })),
      };
    },
  };
  return S;
}

function step(S, dt) {
  S.time += dt;
  S.tick += 1;
  const input = S.input;
  const p = S.player;

  // Edge-triggered keys, handled once per tick.
  if (input.pressed.has('KeyR')) startReload(S, p);
  if (input.pressed.has('KeyG')) throwGrenade(S, p);
  if (input.pressed.has('KeyB')) {
    if (S.round.phase === 'buy') S.hud.showBuy(!S.round.buyOpen);
    else S.hud.showBuy(false);
  }
  if (input.pressed.has('Digit1')) switchSlot(S, 1);
  if (input.pressed.has('Digit2')) switchSlot(S, 2);
  if (input.pressed.has('Digit3')) switchSlot(S, 3);
  if (input.pressed.has('Digit4')) takeSpike(S);

  updatePlayer(S, dt);
  updateBots(S, dt);
  playerShoot(S, dt);
  updateReload(S, p, dt);
  updateGrenades(S, dt);
  updateTracers(S, dt);
  updateRound(S, dt);
  // Gunfire noise stays audible for a quarter of a second so bots that
  // run after the shooter still hear it; older noise is dropped.
  for (let i = S.noiseEvents.length - 1; i >= 0; i--) {
    if (S.time - S.noiseEvents[i].t > 0.25) S.noiseEvents.splice(i, 1);
  }
}

// Fixed screenshot scenes. Bots hold their marks (S.demo) and never fire,
// so the frame is stable; the HUD, the map and the objective read at once.
function setupShot(S, mode) {
  S.started = true;
  S.hud.showStart(false);
  const p = S.player;
  if (mode === 'start') {
    // Spawn view, buy menu open.
    S.round.phase = 'buy';
    S.round.timer = 15;
    S.hud.showBuy(true);
    p.pos.set(0, 0, 26);
    p.yaw = 0;
    p.pitch = 0;
  } else if (mode === 'play') {
    // Mid-round firefight: an enemy bot in the sights down Mid Alley.
    // The foe stands south of the central silo so the sightline is clear.
    S.round.phase = 'live';
    S.round.timer = 62;
    S.round.num = 2;
    S.round.scoreV = 2;
    S.round.scoreB = 1;
    p.money = 2400;
    p.hp = 76;
    p.mag = 24;
    p.pos.set(0, 0, 20);
    p.yaw = 0;
    p.pitch = -0.01;
    const foe = S.bots.find((b) => b.name === 'Rook');
    foe.pos.set(0.6, 0, 8);
    foe.yaw = Math.PI;
    foe.mesh.position.copy(foe.pos);
    foe.mesh.rotation.y = foe.yaw;
    const ally = S.bots.find((b) => b.name === 'Dara');
    ally.pos.set(-6, 0, 14);
    ally.yaw = 0.4;
    ally.mesh.position.copy(ally.pos);
    ally.mesh.rotation.y = ally.yaw;
    S.hud.showBuy(false);
  } else if (mode === 'site') {
    // Site A, spike planted, fuse counting down.
    S.round.phase = 'live';
    S.round.timer = 18;
    S.round.num = 4;
    S.round.scoreV = 3;
    S.round.scoreB = 2;
    S.spike.state = 'planted';
    S.spike.site = 'A';
    S.spike.fuseT = 18;
    S.spike.carrier = null;
    p.pos.set(-19, 0, -10);
    p.yaw = 0.85;
    p.pitch = -0.02;
    const def = S.bots.find((b) => b.name === 'Fen');
    def.pos.set(-24, 0, -14);
    def.yaw = 2.4;
    def.mesh.position.copy(def.pos);
    def.mesh.rotation.y = def.yaw;
    S.hud.showBuy(false);
  } else if (mode === 'end') {
    // Round-end scoreboard: Vanguard takes the round 4-2. The banner is
    // sticky here so the screenshot timer cannot hide it first.
    S.round.phase = 'ended';
    S.round.timer = 60;
    S.round.num = 6;
    S.round.scoreV = 4;
    S.round.scoreB = 2;
    S.round.roundWinner = 'Vanguard';
    S.round.roundReason = 'Bulwark eliminated';
    S.hud.banner('ROUND WON', 'Bulwark eliminated', true, 'VANGUARD 4 - 2 BULWARK', true);
    S.hud.showBuy(false);
  }
}

boot();
