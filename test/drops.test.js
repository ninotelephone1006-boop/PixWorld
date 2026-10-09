"use strict";

/**
 * Vérifie les objets lâchés hors navigateur : un bloc cassé laisse un objet
 * qui tombe et se pose sur le terrain, il ne se ramasse qu'après un court
 * délai et au contact du héros, et il reste au sol si l'inventaire est plein.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "src");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "terrain.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "drops.js"), "utf8"), sandbox);

const Terrain = sandbox.window.PixWorldTerrain;
const Drops = sandbox.window.PixWorldDrops;
assert(Drops && typeof Drops.create === "function", "Le module d'objets lâchés est chargé");
const { PICKUP_DELAY, MAX_ITEMS } = Drops.constants;
const FRAME = 1 / 60;
const HERO = { width: 42, height: 60 };

/** Chaque tirage vaut 0,5 : les objets partent droit, sans dispersion. */
function fixedRandom() {
  return () => 0.5;
}

/** Un monde avec la case (col, 0) minée : l'objet tombe dans un trou de la surface. */
function minedSurface(col) {
  const terrain = Terrain.create({ width: 3000 });
  terrain.breakAt(col, 0);
  const drops = Drops.create({ terrain, random: fixedRandom() });
  return { terrain, drops };
}

// ── Chute : l'objet se pose sur la terre sous le trou ───────────────────────
{
  const { terrain, drops } = minedSurface(5);
  const centre = terrain.centerOf(5, 0);
  drops.spawn("grass", centre.x, centre.y);
  assert.strictEqual(drops.list.length, 1, "Un objet est apparu");
  for (let i = 0; i < 90; i++) drops.update(FRAME); // 1,5 s
  const item = drops.list[0];
  assert.strictEqual(item.landed, true, "L'objet s'est posé");
  assert.strictEqual(item.feet, 30, "Posé sur la terre, juste sous le trou (bas de la ligne 0)");
  assert.strictEqual(item.type, "grass", "L'objet garde le type du bloc");
}

// ── Pas de ramassage pendant le délai ───────────────────────────────────────
{
  const { terrain, drops } = minedSurface(5);
  const centre = terrain.centerOf(5, 0);
  drops.spawn("dirt", centre.x, centre.y);
  const player = { x: 150, feet: 0, width: HERO.width, height: HERO.height };
  // Juste après l'apparition, le héros est au contact mais le délai n'est pas écoulé.
  const early = drops.collect(player, () => true);
  assert.strictEqual(early.length, 0, "Trop tôt : rien n'est ramassé");
  for (let i = 0; i < Math.ceil((PICKUP_DELAY + 0.05) * 60); i++) drops.update(FRAME);
  const taken = drops.collect(player, () => true);
  assert.strictEqual(JSON.stringify(taken), '["dirt"]', "Après le délai, le contact suffit : l'objet est ramassé");
  assert.strictEqual(drops.list.length, 0, "L'objet a disparu du sol");
}

// ── Contact : seulement à portée du héros ───────────────────────────────────
{
  const { terrain, drops } = minedSurface(5);
  const centre = terrain.centerOf(5, 0);
  drops.spawn("stone", centre.x, centre.y);
  for (let i = 0; i < 90; i++) drops.update(FRAME);
  const far = { x: 900, feet: 0, width: HERO.width, height: HERO.height };
  assert.strictEqual(drops.collect(far, () => true).length, 0, "Trop loin : l'objet reste au sol");
  const near = { x: 150, feet: 0, width: HERO.width, height: HERO.height };
  assert.strictEqual(drops.collect(near, () => true).length, 1, "Au contact, l'objet est ramassé");
}

// ── Inventaire plein : l'objet reste au sol ─────────────────────────────────
{
  const { terrain, drops } = minedSurface(5);
  const centre = terrain.centerOf(5, 0);
  drops.spawn("stone", centre.x, centre.y);
  for (let i = 0; i < 90; i++) drops.update(FRAME);
  const near = { x: 150, feet: 0, width: HERO.width, height: HERO.height };
  const refused = drops.collect(near, () => false);
  assert.strictEqual(refused.length, 0, "Refusé : rien n'est ramassé");
  assert.strictEqual(drops.list.length, 1, "L'objet reste sur le terrain");
}

// ── Un trou de deux blocs : le héros tombe et ramasse au fond ───────────────
{
  const terrain = Terrain.create({ width: 3000 });
  terrain.breakAt(5, 0);
  terrain.breakAt(5, 1);
  const drops = Drops.create({ terrain, random: fixedRandom() });
  const centre = terrain.centerOf(5, 1);
  drops.spawn("dirt", centre.x, centre.y);
  for (let i = 0; i < 120; i++) drops.update(FRAME);
  const item = drops.list[0];
  assert.strictEqual(item.feet, 60, "L'objet tombe au fond du trou (sur la ligne 2)");
}

// ── Attraction : un objet au fond d'un trou étroit remonte vers le héros ────
{
  const terrain = Terrain.create({ width: 3000 });
  terrain.breakAt(5, 0);
  terrain.breakAt(5, 1);
  const drops = Drops.create({ terrain, random: fixedRandom() });
  const centre = terrain.centerOf(5, 1);
  drops.spawn("dirt", centre.x, centre.y);
  for (let i = 0; i < 90; i++) drops.update(FRAME, null); // au fond du trou, sans héros
  assert.strictEqual(drops.list[0].feet, 60, "Sans héros à proximité, l'objet reste au fond du trou");
  const hero = { x: 150, feet: 0, width: HERO.width, height: HERO.height };
  let taken = [];
  for (let i = 0; i < 180 && taken.length === 0; i++) {
    drops.update(FRAME, hero);
    taken = drops.collect(hero, () => true);
  }
  assert.strictEqual(JSON.stringify(taken), '["dirt"]', "Attiré vers le héros, l'objet remonte du trou et est ramassé");
}

// ── Hors de portée d'attraction, l'objet reste où il est ────────────────────
{
  const terrain = Terrain.create({ width: 3000 });
  terrain.breakAt(5, 0);
  terrain.breakAt(5, 1);
  const drops = Drops.create({ terrain, random: fixedRandom() });
  const centre = terrain.centerOf(5, 1);
  drops.spawn("dirt", centre.x, centre.y);
  for (let i = 0; i < 90; i++) drops.update(FRAME, null);
  const far = { x: 900, feet: 0, width: HERO.width, height: HERO.height };
  for (let i = 0; i < 120; i++) drops.update(FRAME, far);
  assert.strictEqual(drops.list[0].feet, 60, "Trop loin pour être attiré : l'objet ne bouge pas");
}

// ── Liste bornée : les plus anciens objets sont retirés ─────────────────────
{
  const terrain = Terrain.create({ width: 3000 });
  const drops = Drops.create({ terrain, random: fixedRandom() });
  for (let i = 0; i < MAX_ITEMS + 25; i++) drops.spawn("stone", 100 + i, 200);
  assert.strictEqual(drops.list.length, MAX_ITEMS, "La liste reste bornée");
  drops.clear();
  assert.strictEqual(drops.list.length, 0, "clear vide la liste");
}

// ── Aucune valeur non finie, même avec un pas de temps énorme ───────────────
{
  const terrain = Terrain.create({ width: 3000 });
  const drops = Drops.create({ terrain, random: fixedRandom() });
  drops.spawn("grass", 300, 20);
  drops.update(10);
  const item = drops.list[0];
  assert(Number.isFinite(item.x) && Number.isFinite(item.feet), "Position finie après un pas géant");
}

console.log("drops.test.js : ok");
