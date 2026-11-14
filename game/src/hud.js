// hud.js - every pixel of the interface: health, armour, ammo, timer,
// score, money, spike status, kill feed, crosshair spread, plant/defuse
// progress, buy menu, banners and the start / match screens. One job: read
// the state and show it; it never decides game rules.

import { WEAPONS } from './weapons.js';
import { BUY_ITEMS } from './rounds.js';

export function createHud(S) {
  const $ = (id) => document.getElementById(id);
  const el = {
    healthNum: $('health-num'),
    healthFill: $('health-fill'),
    armour: $('armour'),
    weaponName: $('weapon-name'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    grenades: $('grenades'),
    timer: $('timer'),
    roundLabel: $('round-label'),
    scoreV: $('score-v'),
    scoreB: $('score-b'),
    money: $('money'),
    spike: $('spike-status'),
    killfeed: $('killfeed'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    plantBar: $('plant-bar'),
    plantLabel: $('plant-label'),
    plantFill: $('plant-fill'),
    hint: $('hint'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bannerScore: $('banner-score'),
    buyMenu: $('buy-menu'),
    buyList: $('buy-list'),
    buyMoney: $('buy-money'),
    buyClose: $('buy-close'),
    overlay: $('overlay'),
    play: $('play'),
    matchOverlay: $('match-overlay'),
    matchTitle: $('match-title'),
    matchSub: $('match-sub'),
    restart: $('restart'),
  };
  let kick = 0;
  let hitT = null;
  let bannerT = null;

  const hud = {
    // The buy menu lists every item with its price and stats; clicking a
    // row buys it (the same function the B key path uses).
    buildBuy() {
      el.buyList.innerHTML = '';
      for (const item of BUY_ITEMS) {
        const row = document.createElement('div');
        row.className = 'buy-row';
        row.dataset.name = item.name;
        row.innerHTML = `<span class="name">${item.name}</span><span class="stats">${item.desc}</span><span class="price">$${item.price}</span><span class="key">BUY</span>`;
        row.addEventListener('click', () => S.rounds.buyItem(S, item.name));
        el.buyList.appendChild(row);
      }
    },
    refreshBuy() {
      const p = S.player;
      el.buyMoney.textContent = `CREDITS $${p.money} | BUY PHASE | PRESS B TO CLOSE`;
      for (const row of el.buyList.children) {
        const owned = p.owned.includes(row.dataset.name);
        row.classList.toggle('owned', owned);
        row.querySelector('.key').textContent = owned ? 'OWNED' : 'BUY';
      }
    },
    showBuy(open) {
      S.round.buyOpen = open;
      el.buyMenu.classList.toggle('show', open);
      if (open) {
        hud.buildBuy();
        hud.refreshBuy();
      }
    },
    showStart(show) {
      el.overlay.hidden = !show;
    },
    showMatch(won, scoreLine) {
      el.matchTitle.textContent = won ? 'VICTORY - VANGUARD TAKES THE YARD' : 'DEFEAT - BULWARK HELD THE YARD';
      el.matchSub.textContent = `${scoreLine} | First to 5 rounds. The yard remembers every duel.`;
      el.matchOverlay.hidden = false;
    },
    banner(title, sub, won, scoreLine, sticky) {
      el.bannerTitle.textContent = title;
      el.bannerTitle.className = won ? 'win' : 'lose';
      el.bannerSub.textContent = sub;
      el.bannerScore.textContent = scoreLine;
      el.banner.classList.add('show');
      if (bannerT) clearTimeout(bannerT);
      if (!sticky) bannerT = setTimeout(() => hud.bannerHide(), 4200);
    },
    bannerHide() {
      el.banner.classList.remove('show');
    },
    killfeed(S2, killer, victim, head) {
      const div = document.createElement('div');
      const kc = killer === 'You' || S2.player.name === killer ? 'van' : (S2.bots.find((b) => b.name === killer)?.team === 'Vanguard' ? 'van' : 'bul');
      const vc = victim === 'You' ? 'van' : (S2.bots.find((b) => b.name === victim)?.team === 'Vanguard' ? 'van' : 'bul');
      div.innerHTML = `<span class="${kc}">${killer}</span> ${head ? '*' : '-'} <span class="${vc}">${victim}</span>`;
      el.killfeed.appendChild(div);
      while (el.killfeed.children.length > 5) el.killfeed.removeChild(el.killfeed.firstChild);
      setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 5000);
    },
    hitmarker(head) {
      el.hitmarker.classList.add('on');
      el.hitmarker.style.opacity = head ? '1' : '0.85';
      if (hitT) clearTimeout(hitT);
      hitT = setTimeout(() => el.hitmarker.classList.remove('on'), 120);
    },
    kickFlash() { kick = 1; },
    plantBar(show, label, frac) {
      el.plantBar.style.display = show ? 'block' : 'none';
      if (show) {
        el.plantLabel.textContent = label;
        el.plantFill.style.width = `${Math.round(frac * 100)}%`;
      }
    },
    // Per-frame refresh: numbers, bars, timer, crosshair spread.
    update() {
      const p = S.player;
      const r = S.round;
      el.healthNum.textContent = Math.max(0, Math.ceil(p.hp));
      el.healthFill.style.width = `${Math.max(0, p.hp)}%`;
      el.healthFill.style.background = p.hp < 30 ? '#e0524d' : '#f0a830';
      el.armour.textContent = p.armour > 0 ? '#'.repeat(Math.ceil(p.armour / 10)) + ` ARMOUR ${Math.round(p.armour)}` : '';
      el.weaponName.textContent = p.weapon.toUpperCase() + (p.carrier ? ' | SPIKE CARRIER' : '');
      el.ammoMag.textContent = p.mag;
      el.ammoReserve.textContent = `/ ${p.reserve}`;
      el.ammoBox.classList.toggle('empty', p.mag === 0);
      el.grenades.textContent = `SPARK-4 x${p.grenades}  [G]`;
      const t = S.spike.state === 'planted' ? Math.max(0, S.spike.fuseT) : Math.max(0, r.timer);
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60).toString().padStart(2, '0');
      el.timer.textContent = `${mm}:${ss}`;
      el.timer.classList.toggle('low', t < 15 || S.spike.state === 'planted');
      el.roundLabel.textContent = `ROUND ${r.num} - FIRST TO 5`;
      el.scoreV.textContent = r.scoreV;
      el.scoreB.textContent = r.scoreB;
      el.money.textContent = `$${p.money}`;
      const sp = S.spike;
      let spikeText = 'SPIKE: WITH CARRIER';
      if (sp.state === 'planted') spikeText = `SPIKE PLANTED ${sp.site} - ${Math.ceil(sp.fuseT)}s`;
      else if (sp.state === 'defused') spikeText = 'SPIKE: DEFUSED';
      else if (sp.state === 'detonated') spikeText = 'SPIKE: DETONATED';
      else if (sp.carrier && sp.carrier.isPlayer) spikeText = 'SPIKE: YOU CARRY IT - E TO PLANT';
      el.spike.textContent = spikeText;
      el.spike.classList.toggle('planted', sp.state === 'planted');
      // Crosshair widens with spread and kicks with each shot.
      kick = Math.max(0, kick - 0.06);
      const spreadPx = 1 + p.spread * 260 + kick * 0.9;
      el.crosshair.style.transform = `translate(-50%, -50%) scale(${spreadPx.toFixed(2)})`;
      el.hint.style.display = r.phase === 'live' ? 'block' : 'none';
    },
  };

  el.play.addEventListener('click', () => S.startGame());
  el.restart.addEventListener('click', () => window.location.reload());
  el.buyClose.addEventListener('click', () => hud.showBuy(false));
  hud.buildBuy();
  return hud;
}
