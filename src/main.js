import './style.css';
import * as world from './world.js';
import * as game from './game.js';
import * as rival from './rival.js';
import { initUI } from './ui.js';
import { BUILDINGS, modelFor, footprintOf } from './buildings.js';
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
world.hooks.onPlace = (type, cx, cz) => { game.tryBuild(type, cx, cz); };
world.hooks.onSelect = (id) => { selId = id; ui.showSelection(game.buildingInfo(id)); };
world.hooks.onDeselect = () => { selId = null; ui.hideSelection(); };

// ----- game -> world/ui -----
game.hooks.spawn = (id, model, fp, cx, cz) => world.spawnBuilding(id, model, fp, cx, cz);
game.hooks.swap = (id, model) => world.swapBuilding(id, model);
game.hooks.remove = (id) => world.removeBuilding(id);
game.hooks.clearWorld = () => { world.clearWorld(); selId = null; };
game.hooks.onToast = (msg, type) => ui.toast(msg, type);
game.hooks.onWin = () => { gameOver = true; ui.showWin(); };
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
    ui.showDefeat();
  },
});

function exitPlacing() { world.cancelPlacing(); ui.setPlacing(false); }
function focusHome() { viewingRival = false; world.focusOn(0, 0); }

// ----- ui -> game/world -----
const ui = initUI({
  onBuild: (type) => {
    selId = null; world.clearSelection(); ui.hideSelection();
    world.startPlacing(type, modelFor(type, game.state.age, 1), footprintOf(type));
    ui.setPlacing(true, BUILDINGS[type].name);
  },
  onUpgrade: (id) => game.tryUpgrade(id),
  onDemolish: (id) => { game.demolish(id); selId = null; world.clearSelection(); ui.hideSelection(); },
  onAdvanceAge: () => game.advanceAge(),
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
  onCloseSel: () => { selId = null; world.clearSelection(); ui.hideSelection(); },
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { exitPlacing(); world.clearSelection(); selId = null; ui.hideSelection(); }
  else if (e.key === 'r' || e.key === 'R') world.rotateGhost();
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
