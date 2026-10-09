"use strict";

/**
 * Vérifie le minage hors navigateur : un bloc se casse après deux secondes de
 * clic maintenu à portée, la progression repart de zéro si l'on relâche ou si
 * l'on change de case, rien ne se passe hors de portée, dans l'air ou sur la
 * roche-mère, et les coups sonores sont espacés.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "src");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "terrain.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "mining.js"), "utf8"), sandbox);

const Terrain = sandbox.window.PixWorldTerrain;
const Mining = sandbox.window.PixWorldMining;
assert(Mining && typeof Mining.create === "function", "Le module de minage est chargé");
const { MINE_TIME, REACH_BLOCKS } = Mining.constants;
assert.strictEqual(MINE_TIME, 2, "Un bloc se casse en deux secondes de clic maintenu");

const FRAME = 1 / 60;
/** Centre d'une case, comme le verrait un héros posé à côté. */
function beside(col, row) {
  const c = Terrain.create({ width: 3000 }).centerOf(col, row);
  return { x: c.x - 40, y: c.y, enabled: true };
}

/** Un monde, une case visée et un minage prêt. */
function setup() {
  const terrain = Terrain.create({ width: 3000 });
  const events = { breaks: [], hits: [] };
  const miner = Mining.create({
    terrain,
    onBreak: (event) => events.breaks.push(event),
    onHit: (event) => events.hits.push(event),
  });
  return { terrain, miner, events };
}

/** Fait tourner `frames` images avec le même état de souris. */
function run(miner, frames, origin) {
  let state = null;
  for (let i = 0; i < frames; i++) state = miner.update(FRAME, origin);
  return state;
}

// ── Casse après deux secondes de clic maintenu ──────────────────────────────
{
  const { terrain, miner, events } = setup();
  const target = { col: 20, row: 6 }; // pierre
  miner.setHover(target);
  miner.setHolding(true);
  const origin = beside(target.col, target.row);
  const state = run(miner, 90, origin); // 1,5 s
  assert.strictEqual(events.breaks.length, 0, "Pas encore cassé après 1,5 s");
  assert(state.progress > 0.7 && state.progress < 0.8, "Progression d'environ 75 % après 1,5 s (" + state.progress.toFixed(2) + ")");
  assert.strictEqual(state.type, "stone", "La case visée est de la pierre");
  assert.strictEqual(state.inReach, true, "Le bloc est à portée");
  run(miner, 40, origin); // jusqu'à 2,2 s
  assert.strictEqual(events.breaks.length, 1, "Le bloc se casse une seule fois");
  assert.deepStrictEqual({ col: events.breaks[0].col, row: events.breaks[0].row, type: events.breaks[0].type }, { col: 20, row: 6, type: "stone" }, "L'événement décrit le bloc cassé");
  assert.strictEqual(terrain.typeAt(20, 6), null, "Le bloc a disparu du terrain");
  // Après la casse, la case est de l'air : plus de progression.
  const after = run(miner, 30, origin);
  assert.strictEqual(after.progress, 0, "Plus rien à miner sur une case vide");
  assert.strictEqual(events.breaks.length, 1, "Pas de seconde casse sur de l'air");
}

// ── Relâcher le clic remet la progression à zéro ────────────────────────────
{
  const { terrain, miner, events } = setup();
  miner.setHover({ col: 15, row: 3 }); // terre
  const origin = beside(15, 3);
  miner.setHolding(true);
  run(miner, 60, origin); // 1 s
  miner.setHolding(false);
  const released = run(miner, 1, origin);
  assert.strictEqual(released.progress, 0, "Relâché : progression nulle");
  miner.setHolding(true);
  const again = run(miner, 6, origin); // 0,1 s
  assert(again.progress < 0.1, "Reprise : la progression repart de zéro");
  assert.strictEqual(events.breaks.length, 0, "Rien n'est cassé");
  assert.strictEqual(terrain.typeAt(15, 3), "dirt", "La terre est toujours là");
}

// ── Changer de case repart de zéro ──────────────────────────────────────────
{
  const { miner, events } = setup();
  const origin = beside(10, 6);
  miner.setHolding(true);
  miner.setHover({ col: 10, row: 6 });
  run(miner, 100, origin); // presque 2 s
  miner.setHover({ col: 11, row: 6 });
  const moved = run(miner, 1, origin);
  assert(moved.progress < 0.05, "Une autre case : la progression est remise à zéro");
  assert.strictEqual(events.breaks.length, 0, "L'ancien bloc n'est pas cassé par erreur");
}

// ── Hors de portée : rien ne se passe, la case est signalée ─────────────────
{
  const { terrain, miner, events } = setup();
  miner.setHover({ col: 5, row: 4 });
  miner.setHolding(true);
  const far = { x: 5 * 30 + 15 + REACH_BLOCKS * 30 + 60, y: 4 * 30 + 15, enabled: true };
  const state = run(miner, 300, far);
  assert.strictEqual(state.inReach, false, "Le bloc est hors de portée");
  assert.strictEqual(state.progress, 0, "Aucune progression hors de portée");
  assert.strictEqual(events.breaks.length, 0, "Aucun bloc cassé à distance");
  assert.strictEqual(terrain.typeAt(5, 4), "dirt", "Le bloc lointain n'a pas bougé");
}

// ── Roche-mère : incassable ─────────────────────────────────────────────────
{
  const { terrain, miner, events } = setup();
  miner.setHover({ col: 12, row: 15 });
  miner.setHolding(true);
  const state = run(miner, 240, beside(12, 15));
  assert.strictEqual(state.breakable, false, "La roche-mère n'est pas cassable");
  assert.strictEqual(state.progress, 0, "Aucune progression sur la roche-mère");
  assert.strictEqual(events.breaks.length, 0, "Rien ne se casse");
  assert.strictEqual(terrain.typeAt(12, 15), "bedrock", "La roche-mère reste en place");
}

// ── Air au-dessus de la surface : pas de cible ──────────────────────────────
{
  const { miner, events } = setup();
  miner.setHover({ col: 3, row: -2 });
  miner.setHolding(true);
  const state = run(miner, 200, { x: 90, y: -40, enabled: true });
  assert.strictEqual(state.col, null, "Pas de cible dans l'air");
  assert.strictEqual(events.breaks.length, 0, "Rien à casser dans l'air");
}

// ── Personnage mort ou menu ouvert : pas de minage ──────────────────────────
{
  const { miner, events } = setup();
  miner.setHover({ col: 8, row: 2 });
  miner.setHolding(true);
  run(miner, 200, { ...beside(8, 2), enabled: false });
  assert.strictEqual(events.breaks.length, 0, "Désactivé : aucun minage");
}

// ── Les coups sonores sont espacés (environ 4 par seconde) ──────────────────
{
  const { miner, events } = setup();
  miner.setHover({ col: 9, row: 5 });
  miner.setHolding(true);
  run(miner, 60, beside(9, 5)); // 1 s de minage
  assert(events.hits.length >= 3 && events.hits.length <= 5, "Environ quatre coups par seconde (" + events.hits.length + ")");
  assert.strictEqual(events.hits[0].type, "stone", "Chaque coup décrit la matière touchée");
}

// ── Réinitialisation explicite (pause, retour au titre) ─────────────────────
{
  const { miner, events } = setup();
  miner.setHover({ col: 4, row: 5 });
  miner.setHolding(true);
  run(miner, 100, beside(4, 5));
  miner.reset();
  miner.setHolding(true);
  const state = run(miner, 10, beside(4, 5));
  assert(state.progress < 0.1, "Après reset, le minage repart de zéro");
  assert.strictEqual(events.breaks.length, 0, "Pas de casse après reset");
}

console.log("mining.test.js : ok");
