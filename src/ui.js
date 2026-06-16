import { BUILDINGS, BUILD_ORDER, RES_ICON, costToString } from './buildings.js';
import * as game from './game.js';

const $ = (s) => document.querySelector(s);
const RES_LIST = ['food', 'wood', 'stone', 'gold'];

let handlers;
let selectedId = null;
let difficulty = 'normal';
const buildCards = {};

export function initUI(h) {
  handlers = h;
  buildResourceBar();
  buildBuildBar();
  wireButtons();
  return { refresh, toast, showSelection, hideSelection, showWin, showDefeat, showIntro, hideIntro, setPlacing, updateRival };
}

function buildResourceBar() {
  $('#resbar').innerHTML =
    RES_LIST.map((k) =>
      `<div class="res" id="res-${k}" title="${k}"><span class="ic">${RES_ICON[k]}</span><span class="val">0</span><span class="rate"></span></div>`
    ).join('') +
    `<div class="res" id="res-pop" title="population / housing"><span class="ic">👥</span><span class="val">0</span><span class="rate" id="efflbl"></span></div>
     <div class="res" id="res-might" title="Might — defends against raids"><span class="ic">⚔️</span><span class="val">0</span></div>
     <div class="res" id="res-age" title="Age"><span class="ic">⏳</span><span class="val">Age I</span></div>`;
}

function buildBuildBar() {
  const bar = $('#buildbar');
  bar.innerHTML = '';
  BUILD_ORDER.forEach((type) => {
    const def = BUILDINGS[type];
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.type = type;
    card.title = def.desc;
    card.innerHTML =
      `<div class="card-ic">${def.icon}</div>
       <div class="card-name">${def.name}</div>
       <div class="card-cost">${costToString(def.buildCost)}</div>`;
    card.addEventListener('click', () => handlers.onBuild(type));
    bar.appendChild(card);
    buildCards[type] = card;
  });
}

function wireButtons() {
  $('#btn-age').addEventListener('click', () => handlers.onAdvanceAge());
  $('#btn-save').addEventListener('click', () => handlers.onSave());
  $('#btn-reset').addEventListener('click', () => handlers.onReset());
  $('#btn-rival').addEventListener('click', () => handlers.onViewRival());
  $('#sel-close').addEventListener('click', () => handlers.onCloseSel());
  $('#sel-upgrade').addEventListener('click', () => { if (selectedId != null) handlers.onUpgrade(selectedId); });
  $('#sel-demolish').addEventListener('click', () => { if (selectedId != null) handlers.onDemolish(selectedId); });
}

// ---------- rival race panel ----------
export function updateRival(p) {
  $('#rp-fill').style.width = Math.round(p.pct * 100) + '%';
  let status;
  if (p.wonderLevel >= 3) status = '🏆 Wonder complete';
  else if (p.wonderLevel > 0) status = `🏆 Building Wonder · Lv ${p.wonderLevel}/3`;
  else status = `${p.age >= 2 ? 'Age II' : 'Age I'} · ${p.builds} building${p.builds === 1 ? '' : 's'}`;
  $('#rp-status').textContent = status;
  $('#rivalpanel').classList.toggle('danger', p.wonderLevel > 0);
}

export function refresh() {
  const c = game.caps();
  const eff = game.efficiency();
  const happy = 1 + Math.min(0.5, game.happiness() / 100);
  const gross = game.grossProduction();

  for (const k of RES_LIST) {
    const el = document.getElementById('res-' + k);
    el.querySelector('.val').textContent = Math.floor(game.state.res[k]);
    const rate = k === 'food'
      ? gross.food * eff * happy - game.state.population * game.FOOD_PER_POP
      : gross[k] * eff * happy;
    const rEl = el.querySelector('.rate');
    rEl.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(1);
    rEl.className = 'rate ' + (rate >= -0.001 ? 'pos' : 'neg');
    el.classList.toggle('full', game.state.res[k] >= c[k] - 0.5);
  }

  const pop = document.getElementById('res-pop');
  pop.querySelector('.val').textContent = `${Math.floor(game.state.population)}/${game.popCap()}`;
  const need = game.workersNeeded();
  const effEl = document.getElementById('efflbl');
  effEl.textContent = need > 0 ? `${Math.round(eff * 100)}%👷` : '';
  effEl.className = 'rate ' + (eff >= 0.999 ? 'pos' : 'neg');

  document.querySelector('#res-might .val').textContent = Math.round(game.might());
  document.querySelector('#res-age .val').textContent = game.state.age >= 2 ? 'Age II' : 'Age I';

  for (const type of BUILD_ORDER) {
    const def = BUILDINGS[type];
    const locked = !!(def.requiresAge && game.state.age < def.requiresAge);
    const afford = game.canAfford(def.buildCost);
    const card = buildCards[type];
    card.classList.toggle('locked', locked);
    card.classList.toggle('cant', !afford && !locked);
  }

  const ageBtn = $('#btn-age');
  if (game.state.age >= 2) {
    ageBtn.style.display = 'none';
  } else {
    ageBtn.style.display = '';
    ageBtn.disabled = !game.canAdvanceAge();
    ageBtn.title = `Advance to the Second Age — needs a Temple, ${game.AGE2_POP} population, and ${costToString(game.AGE2_COST)}`;
  }
}

export function showSelection(info) {
  if (!info) return;
  selectedId = info.id;
  $('#selpanel').classList.add('open');
  $('#sel-icon').textContent = info.icon;
  $('#sel-name').textContent = info.name;
  $('#sel-level').textContent = `Level ${info.level} / ${info.maxLevel}`;
  $('#sel-stats').innerHTML = info.lines.map((l) => `<div>${l}</div>`).join('');

  const upBtn = $('#sel-upgrade');
  if (info.level >= info.maxLevel) {
    upBtn.innerHTML = 'Max Level';
    upBtn.disabled = true;
  } else {
    const cost = game.upgradeCostOf(info.building);
    upBtn.innerHTML = `Upgrade → Lv ${info.level + 1}<span class="bcost">${costToString(cost)}</span>`;
    upBtn.disabled = !game.canAfford(cost);
  }

  const demo = $('#sel-demolish');
  if (info.type === 'towncenter') {
    demo.style.display = 'none';
  } else {
    demo.style.display = '';
    demo.innerHTML = `Demolish<span class="bcost">refund ${costToString(game.refundOf(info.building))}</span>`;
  }
}
export function hideSelection() { selectedId = null; $('#selpanel').classList.remove('open'); }

export function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3600);
}

export function setPlacing(on, name) {
  const hint = $('#placehint');
  hint.classList.toggle('show', on);
  if (on) hint.innerHTML = `Placing <b>${name}</b> — <kbd>Left-click</kbd> build · <kbd>R</kbd> rotate · <kbd>Esc</kbd> cancel`;
}

export function showWin() {
  showModal(
    `<h1>🏆 Your Wonder is Complete!</h1>
     <p>You beat your rival to the Wonder and crowned a realm for the ages. Masterfully done.</p>
     <div class="m-btns"><button class="big" id="m-again">Build a New Realm</button></div>`
  );
  $('#m-again').addEventListener('click', () => { hideModal(); handlers.onReset(); });
}

export function showDefeat() {
  showModal(
    `<h1>💀 Your Rival Won the Race</h1>
     <p>The rival realm completed its Wonder before you did. Grow faster, defend smarter, and try again.</p>
     <div class="m-btns"><button class="big" id="m-again">Try Again</button></div>`
  );
  $('#m-again').addEventListener('click', () => { hideModal(); handlers.onReset(); });
}

export function showIntro(hasSave) {
  const diffs = [
    ['easy', 'Easy', 'relaxed rival'],
    ['normal', 'Normal', 'a real race'],
    ['hard', 'Hard', 'ruthless rival'],
  ];
  showModal(
    `<h1>🏰 Realm Builder</h1>
     <p>Race a rival realm across the river to build a 🏆 <b>Wonder</b> first. Gather resources, house your people, and defend against raids.</p>
     <ul>
       <li><b>Build</b> from the bar at the bottom, then <b>click the ground</b> to place.</li>
       <li><b>Click a building</b> to upgrade or demolish it.</li>
       <li>Houses raise 👥 population; people <b>work</b> your farms, camps and mines (watch the 👷 staffing %).</li>
       <li>Build a ✨ <b>Temple</b>, reach <b>${game.AGE2_POP}</b> population, then <b>Advance the Age</b>.</li>
       <li>Keep your ⚔️ <b>Might</b> up — raiders come periodically.</li>
       <li><b>Win</b> by finishing your Wonder (to Level 3) before the rival finishes theirs.</li>
     </ul>
     <div class="diffrow" id="diffrow">
       ${diffs.map(([k, label, sub]) => `<button class="diff${k === difficulty ? ' on' : ''}" data-diff="${k}"><b>${label}</b><span>${sub}</span></button>`).join('')}
     </div>
     <p class="ctrls">Drag to rotate · scroll to zoom · right-drag to pan</p>
     <div class="m-btns">
       <button class="big" id="m-new">New Settlement</button>
       ${hasSave ? '<button class="big alt" id="m-cont">Continue Saved</button>' : ''}
     </div>`
  );
  $('#diffrow').querySelectorAll('.diff').forEach((b) => {
    b.addEventListener('click', () => {
      difficulty = b.dataset.diff;
      $('#diffrow').querySelectorAll('.diff').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
  $('#m-new').addEventListener('click', () => { hideModal(); handlers.onStart(false, difficulty); });
  if (hasSave) $('#m-cont').addEventListener('click', () => { hideModal(); handlers.onStart(true); });
}
export function hideIntro() { hideModal(); }

function showModal(html) { $('#modal').classList.add('open'); $('#modal-content').innerHTML = html; }
function hideModal() { $('#modal').classList.remove('open'); }
