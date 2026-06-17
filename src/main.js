import './style.css';
import * as world from './world.js';
import * as game from './game.js';
import * as rival from './rival.js';
import * as audio from './audio.js';
import { initUI } from './ui.js';
import { BUILDINGS, BUILD_ORDER, modelFor, footprintOf } from './buildings.js';
import { RIVAL_CENTER } from './config.js';

const canvas = document.getElementById('app');
world.initWorld(canvas);

let started = false;
let gameOver = false;
let selId = null;
let acc = 0;
let viewingRival = false;

// ----- world -> game/ui -----
world.hooks.canAfford = (type) => game.canAfford(BUILDINGS[type].buildCost);
world.hooks.onPlace = (type, cx, cz) => { if (game.tryBuild(type, cx, cz)) audio.play('build'); };
world.hooks.onSelect = (id) => { selId = id; ui.showSelection(game.buildingInfo(id)); };
world.hooks.onDeselect = () => { selId = null; ui.hideSelection(); };

// ----- game -> world/ui -----
game.hooks.spawn = (id, model, fp, cx, cz) => world.spawnBuilding(id, model, fp, cx, cz);
game.hooks.swap = (id, model) => world.swapBuilding(id, model);
game.hooks.remove = (id) => world.removeBuilding(id);
game.hooks.clearWorld = () => { world.clearWorld(); selId = null; };
game.hooks.onToast = (msg, type) => ui.toast(msg, type);
game.hooks.onSound = (kind) => audio.play(kind);
game.hooks.onWin = () => { gameOver = true; audio.play('win'); ui.showWin(); };
game.hooks.onChange = () => { ui.refresh(); if (selId != null) ui.showSelection(game.buildingInfo(selId)); };
game.hooks.serializeRival = () => rival.serialize();
game.hooks.restoreRival = (data, difficulty) => rival.restore(data, difficulty);

// ----- rival -> world/ui -----
rival.setHooks({
  spawn: (rkey, model, size, x, z) => world.spawnRival(rkey, model, size, x, z),
  clear: () => world.clearRival(),
  onProgress: (p) => ui.updateRival(p),
  onWin: () => {
    if (gameOver) return;
    gameOver = true;
    game.markLost();
    audio.play('lose');
    ui.showDefeat();
  },
});

function exitPlacing() { world.cancelPlacing(); ui.setPlacing(false); }
function focusHome() { viewingRival = false; world.focusOn(0, 0); }

function startBuild(type) {
  const def = BUILDINGS[type];
  if (def.requiresAge && game.state.age < def.requiresAge) { ui.toast(`${def.name} requires the Second Age`, 'warn'); return; }
  audio.resume();
  selId = null; world.clearSelection(); ui.hideSelection();
  world.startPlacing(type, modelFor(type, game.state.age, 1), footprintOf(type));
  ui.setPlacing(true, def.name);
}

// ----- ui -> game/world -----
const ui = initUI({
  onBuild: (type) => startBuild(type),
  onUpgrade: (id) => { if (game.tryUpgrade(id)) audio.play('upgrade'); },
  onDemolish: (id) => { game.demolish(id); selId = null; world.clearSelection(); ui.hideSelection(); },
  onAdvanceAge: () => { if (game.advanceAge()) audio.play('age'); },
  onSave: () => game.save(),
  onReset: () => {
    if (!started || confirm('Start a new settlement? This erases your saved game.')) {
      exitPlacing();
      game.reset();                       // resets player (keeps chosen difficulty)
      rival.reset(game.state.difficulty); // resets rival to match
      started = true; gameOver = false; focusHome();
    }
  },
  onStart: (continueGame, difficulty) => {
    audio.resume();
    if (continueGame && game.hasSave()) {
      game.load();                        // also restores the rival via hook
    } else {
      game.startNew(difficulty);
      rival.reset(difficulty);
    }
    started = true; gameOver = false; focusHome();
  },
  onViewRival: () => {
    viewingRival = !viewingRival;
    if (viewingRival) world.focusOn(RIVAL_CENTER.x, RIVAL_CENTER.z); else focusHome();
  },
  onToggleMute: () => audio.toggleMuted(),
  onCloseSel: () => { selId = null; world.clearSelection(); ui.hideSelection(); },
});

const modalOpen = () => document.getElementById('modal').classList.contains('open');

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { exitPlacing(); world.clearSelection(); selId = null; ui.hideSelection(); return; }
  if (e.key === 'r' || e.key === 'R') { world.rotateGhost(); return; }
  // number keys 1-9, 0 are build hotkeys for the first ten buildings
  if (started && !gameOver && !modalOpen() && /^[0-9]$/.test(e.key)) {
    const idx = e.key === '0' ? 9 : Number(e.key) - 1;
    const type = BUILD_ORDER[idx];
    if (type) startBuild(type);
  }
});

ui.showIntro(game.hasSave());

// ----- main loop -----
function loop() {
  const dt = world.getDelta();
  if (started && !gameOver) {
    game.tick(dt);
    rival.tick(dt);
    acc += dt;
    if (acc > 0.2) {
      acc = 0;
      ui.refresh();
      if (selId != null) ui.showSelection(game.buildingInfo(selId));
    }
  }
  world.render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
