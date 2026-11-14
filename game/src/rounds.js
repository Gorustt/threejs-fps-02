// rounds.js - rounds, the spike, the economy and the buy menu. One job:
// own the match state machine. Buy phase (15 s, frozen, shop open) ->
// live (100 s, elimination / plant / defuse / timer) -> round end (banner,
// money, 4.5 s) -> next round. First to 5, at most 9 rounds.

import { WEAPONS, giveWeapon } from './weapons.js';

export const BUY_ITEMS = [
  { name: 'P9 Sparrow', kind: 'weapon', price: 0, desc: 'Sidearm | 12+24 | 34 dmg' },
  { name: 'Raptor-9', kind: 'weapon', price: 1500, desc: 'SMG | 25+75 | 26 dmg | fast' },
  { name: 'VK-9 Carbine', kind: 'weapon', price: 2700, desc: 'Rifle | 30+90 | 34 dmg | accurate' },
  { name: 'Longshot-7', kind: 'weapon', price: 4200, desc: 'Marksman | 5+15 | 82 dmg | scoped' },
  { name: 'Spark-4', kind: 'grenade', price: 300, desc: 'Frag grenade | key G' },
  { name: 'Kevlar Vest', kind: 'armour', price: 650, desc: 'Armour 50 | absorbs half damage' },
];

export function createMatch() {
  return {
    num: 1,
    phase: 'buy', // 'buy' | 'live' | 'ended' | 'match'
    timer: 15,
    scoreV: 0,
    scoreB: 0,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    buyOpen: false,
  };
}

export function createSpike() {
  return {
    state: 'carried', // 'carried' | 'planted' | 'defused' | 'detonated'
    carrier: null, // a bot, or the player object
    site: null, // 'A' | 'B'
    plantT: 0,
    fuseT: 35,
    defuseT: 0,
    beepT: 0,
    plantSite: null,
  };
}

// Place everyone at their spawn, reset health, pick the spike carrier and
// the bots' destinations for this round. Weapons owned carry over.
export function setupRound(S) {
  const p = S.player;
  const vSpawns = S.world.spawns.Vanguard;
  const bSpawns = S.world.spawns.Bulwark;
  p.pos.set(vSpawns[0].x, 0, vSpawns[0].z);
  p.vel.set(0, 0, 0);
  p.yaw = 0;
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  p.reloading = 0;
  const w = WEAPONS[p.weapon];
  p.mag = w.mag;
  p.reserve = w.reserve;
  p.grenades = Math.max(p.grenades, 0);

  const { resetBot, sendBot } = S.botFns;
  S.bots.forEach((bot, i) => {
    const sp = bot.team === 'Vanguard' ? vSpawns[(i % 3) + 1] : bSpawns[i - 3];
    resetBot(S, bot, sp);
  });

  // Spike carrier: the first ally bot, unless the player took it (key 4).
  const carrier = S.bots.find((b) => b.team === 'Vanguard');
  S.spike.state = 'carried';
  S.spike.carrier = carrier;
  S.spike.site = null;
  S.spike.plantT = 0;
  S.spike.fuseT = 35;
  S.spike.defuseT = 0;
  if (carrier) {
    carrier.carrier = true;
    carrier.site = S.rng() < 0.5 ? 'A' : 'B';
  }
  p.carrier = false;

  // Destinations: the carrier walks to its site; the other attackers split
  // across the lanes; defenders split two and two over the sites.
  S.bots.forEach((bot) => {
    if (!bot.alive) return;
    if (bot.team === 'Vanguard') {
      if (bot.carrier) sendBot(S, bot, bot.site === 'B' ? 13 : 11);
      else if (bot.name === 'Kestrel') sendBot(S, bot, 7);
      else sendBot(S, bot, bot.site === 'B' ? 14 : 12);
    } else {
      const holdNodes = { Rook: 11, Fen: 12, Hale: 13, Voss: 14 };
      const node = holdNodes[bot.name] ?? 17;
      sendBot(S, bot, node);
      bot.state = 'advance';
    }
  });

  S.round.phase = 'buy';
  S.round.timer = 15;
  S.round.roundWinner = null;
  S.round.roundReason = '';
  S.hud.showBuy(true);
  S.hud.bannerHide();
}

export function startLive(S) {
  S.round.phase = 'live';
  S.round.timer = 100;
  S.hud.showBuy(false);
  S.round.buyOpen = false;
}

function awardMoney(S, winner) {
  const p = S.player;
  if (p.team === winner) p.money += 3000;
  else p.money += 1900;
}

export function endRound(S, winner, reason) {
  if (S.round.phase === 'ended' || S.round.phase === 'match') return;
  S.round.phase = 'ended';
  S.round.timer = 4.5;
  S.round.roundWinner = winner;
  S.round.roundReason = reason;
  if (winner === 'Vanguard') S.round.scoreV += 1;
  else S.round.scoreB += 1;
  awardMoney(S, winner);
  const won = winner === S.player.team;
  if (won) S.audio.roundWin();
  else S.audio.roundLose();
  S.hud.banner(
    won ? 'ROUND WON' : 'ROUND LOST',
    reason,
    won,
    `VANGUARD ${S.round.scoreV} - ${S.round.scoreB} BULWARK`,
  );
  S.hud.showBuy(false);
}

function endMatch(S, winner) {
  S.round.phase = 'match';
  S.round.matchWinner = winner;
  const won = winner === S.player.team;
  S.hud.showMatch(won, `VANGUARD ${S.round.scoreV} - ${S.round.scoreB} BULWARK`);
  if (won) S.audio.roundWin();
  else S.audio.roundLose();
}

export function plantSpike(S, planter, siteKey) {
  S.spike.state = 'planted';
  S.spike.site = siteKey;
  S.spike.plantSite = S.world.sites[siteKey];
  S.spike.fuseT = 35;
  S.spike.beepT = 0;
  S.spike.carrier = null;
  if (planter && planter.isPlayer) {
    planter.money += 300;
    planter.carrier = false;
  }
  if (planter && planter.carrier) planter.carrier = false;
  S.audio.plantDone();
  S.hud.plantBar(false, '', 0);
}

export function defuseSpike(S, defuser) {
  S.spike.state = 'defused';
  S.spike.defuseT = 0;
  endRound(S, 'Bulwark', `${defuser.name} defused the spike`);
}

// Called by the simulation when a fighter dies; the round-end checks live
// in updateRound, which runs every tick.
export function onKill(S, killer, victim) {
  // Nothing to do here yet: elimination is checked in updateRound so a
  // planted spike can still decide the round after the attackers fall.
}

function teamAlive(S, team) {
  if (team === 'Vanguard') {
    return S.player.alive || S.bots.some((b) => b.alive && b.team === 'Vanguard');
  }
  return S.bots.some((b) => b.alive && b.team === 'Bulwark');
}

// The player plants by holding E inside a site while carrying the spike;
// a planted spike is defused by holding E beside it (defenders only -
// the player's team attacks, so the player's E plants).
export function updatePlayerObjective(S, dt) {
  const p = S.player;
  if (S.round.phase !== 'live' || !p.alive) {
    if (S.spike.state !== 'planted') S.hud.plantBar(false, '', 0);
    return;
  }
  const holding = S.input.down.has('KeyE');
  if (S.spike.state === 'carried' && S.spike.carrier === p && holding) {
    for (const key of ['A', 'B']) {
      const site = S.world.sites[key];
      const d = Math.hypot(site.x - p.pos.x, site.z - p.pos.z);
      if (d < site.r) {
        S.spike.plantT += dt;
        S.hud.plantBar(true, `PLANTING SPIKE - ${site.name}`, Math.min(1, S.spike.plantT / 3));
        if (S.spike.plantT >= 3) plantSpike(S, p, key);
        return;
      }
    }
  }
  if (S.spike.state === 'carried' || S.spike.state === 'planted') {
    S.spike.plantT = 0;
    if (S.spike.state === 'carried') S.hud.plantBar(false, '', 0);
  }
}

export function updateRound(S, dt) {
  const r = S.round;
  if (r.phase === 'match') return;

  if (r.phase === 'buy') {
    r.timer -= dt;
    if (r.timer <= 0) startLive(S);
    return;
  }

  if (r.phase === 'ended') {
    r.timer -= dt;
    if (r.timer <= 0) {
      if (r.scoreV >= 5 || r.scoreB >= 5 || r.num >= 9) {
        endMatch(S, r.scoreV > r.scoreB ? 'Vanguard' : 'Bulwark');
      } else {
        r.num += 1;
        setupRound(S);
      }
    }
    return;
  }

  // Live phase.
  if (S.spike.state === 'planted') {
    // After the plant the round timer stops; the fuse decides.
    S.spike.fuseT -= dt;
    S.spike.beepT -= dt;
    if (S.spike.beepT <= 0) {
      const fast = S.spike.fuseT < 10;
      S.audio.plantBeep(fast);
      S.spike.beepT = fast ? 0.35 : 0.8;
    }
    if (S.spike.fuseT <= 0) {
      S.spike.state = 'detonated';
      S.audio.explosion();
      endRound(S, 'Vanguard', 'The spike detonated at ' + S.world.sites[S.spike.site].name);
      return;
    }
    // All defenders dead after a plant: nobody can defuse.
    if (!teamAlive(S, 'Bulwark')) {
      endRound(S, 'Vanguard', 'Bulwark eliminated - the spike stands');
      return;
    }
  } else {
    r.timer -= dt;
    if (r.timer <= 0) {
      endRound(S, 'Bulwark', 'Time expired - the sites held');
      return;
    }
    if (!teamAlive(S, 'Vanguard')) {
      endRound(S, 'Bulwark', 'Vanguard eliminated');
      return;
    }
    if (!teamAlive(S, 'Bulwark')) {
      endRound(S, 'Vanguard', 'Bulwark eliminated');
      return;
    }
  }
  updatePlayerObjective(S, dt);
}

// Buy menu: weapons, grenades and armour, buy phase only, exact prices.
export function buyItem(S, name) {
  const p = S.player;
  if (S.round.phase !== 'buy') return false;
  const item = BUY_ITEMS.find((i) => i.name === name);
  if (!item) return false;
  if (p.money < item.price) return false;
  if (item.kind === 'weapon') {
    if (p.owned.includes(name)) return false;
    p.money -= item.price;
    p.owned.push(name);
    giveWeapon(S, p, name);
  } else if (item.kind === 'grenade') {
    p.money -= item.price;
    p.grenades += 1;
  } else if (item.kind === 'armour') {
    if (p.armour >= 50) return false;
    p.money -= item.price;
    p.armour = 50;
  }
  S.audio.buy();
  S.hud.refreshBuy(S);
  return true;
}

// Key 4: the player takes the spike from the carrier bot (buy phase only).
export function takeSpike(S) {
  if (S.round.phase !== 'buy') return false;
  if (S.spike.state !== 'carried') return false;
  const old = S.spike.carrier;
  if (old && old.isPlayer) return false;
  if (old) old.carrier = false;
  S.spike.carrier = S.player;
  S.player.carrier = true;
  return true;
}
