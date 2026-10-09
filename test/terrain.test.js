"use strict";

/**
 * Vérifie le terrain en blocs hors navigateur : couches (herbe, terre, pierre,
 * roche-mère), casse des blocs, collisions (sol, murs, plafond), chute dans un
 * trou et passage d'un héros de 42 × 60 px (deux blocs de haut) dans un tunnel.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "terrain.js"), "utf8");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Terrain = sandbox.window.PixWorldTerrain;

/** Comparaison par valeur : les objets du sandbox n'ont pas les mêmes prototypes que ceux de Node. */
function same(actual, expected, message) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}
assert(Terrain && typeof Terrain.create === "function", "Le module de terrain est chargé");

// ── Dimensions et couches ────────────────────────────────────────────────────
const BLOCK = Terrain.BLOCK;
assert.strictEqual(BLOCK, 30, "Un bloc fait 30 px");
assert.strictEqual(BLOCK * 2, 60, "Deux blocs font la hauteur du héros (60 px)");
same(
  Terrain.constants.LAYERS.map((layer) => [layer.type, layer.rows]),
  [["grass", 1], ["dirt", 4], ["stone", 10], ["bedrock", 1]],
  "Une couche d'herbe, quatre de terre, dix de pierre, puis la roche-mère",
);
assert.strictEqual(Terrain.ROWS, 16, "Seize lignes de blocs au total");
assert.strictEqual(Terrain.DEPTH, 16 * BLOCK, "Profondeur totale du terrain");

const terrain = Terrain.create({ width: 3000 });
assert.strictEqual(terrain.columns, 100, "3000 px font 100 colonnes de 30 px");
assert.strictEqual(terrain.typeAt(5, -1), null, "Au-dessus de la surface : air");
assert.strictEqual(terrain.typeAt(5, 0), "grass", "Ligne 0 : herbe");
for (let row = 1; row <= 4; row++) assert.strictEqual(terrain.typeAt(5, row), "dirt", "Lignes 1 à 4 : terre");
for (let row = 5; row <= 14; row++) assert.strictEqual(terrain.typeAt(5, row), "stone", "Lignes 5 à 14 : pierre");
assert.strictEqual(terrain.typeAt(5, 15), "bedrock", "Ligne 15 : roche-mère");
assert.strictEqual(terrain.typeAt(5, 16), "bedrock", "Sous le monde : roche-mère");
assert.strictEqual(terrain.typeAt(-1, 3), "bedrock", "Hors du monde : paroi");
assert.strictEqual(terrain.typeAt(100, 0), "bedrock", "Hors du monde (droite) : paroi");
assert.strictEqual(terrain.isSolid(5, 0), true, "L'herbe est solide");
assert.strictEqual(terrain.isSolid(5, -1), false, "L'air n'est pas solide");

// Coordonnées : cases et centres.
same(terrain.cellAt(95, 61), { col: 3, row: 2 }, "Case qui contient (95, 61)");
same(terrain.centerOf(3, 2), { x: 105, y: 75 }, "Centre d'une case");

// ── Casse des blocs ──────────────────────────────────────────────────────────
assert.strictEqual(terrain.breakAt(7, 0), "grass", "Casser l'herbe renvoie son type");
assert.strictEqual(terrain.typeAt(7, 0), null, "Le bloc cassé devient de l'air");
assert.strictEqual(terrain.breakAt(7, 0), null, "Un bloc déjà cassé ne se casse pas deux fois");
assert.strictEqual(terrain.breakAt(7, 15), null, "La roche-mère est incassable");
assert.strictEqual(terrain.typeAt(7, 15), "bedrock", "La roche-mère reste en place");
assert.strictEqual(terrain.breakAt(-3, 2), null, "Rien à casser hors du monde");
assert.strictEqual(terrain.minedCount, 1, "Un seul bloc miné jusqu'ici");
assert.strictEqual(terrain.isBreakable(8, 2), true, "La terre est cassable");
assert.strictEqual(terrain.isBreakable(8, 15), false, "La roche-mère n'est pas cassable");

// ── Pose sur la surface et chute ─────────────────────────────────────────────
const HERO = { width: 42, height: 60 };
const onSurface = { x: 200, feet: 0, width: HERO.width, height: HERO.height };
assert.strictEqual(terrain.isSupported(onSurface), true, "Le héros est posé sur l'herbe");

// Marche sur la surface : aucune gêne, la boîte reste aux pieds 0.
const walked = terrain.move(onSurface, 300, 0);
assert.strictEqual(walked.x, 500, "Marche libre sur le sol plat");
assert.strictEqual(walked.hitX, false, "Pas de mur sur la surface");
assert.strictEqual(walked.feet, 0, "Les pieds restent sur la surface");

// Chute depuis l'air : on se pose exactement sur le haut du bloc.
const falling = terrain.move({ x: 200, feet: -100, width: HERO.width, height: HERO.height }, 0, 150);
assert.strictEqual(falling.feet, 0, "Atterrissage exact sur la surface");
assert.strictEqual(falling.landed, true, "Atterrissage signalé");
assert.strictEqual(falling.hitY, true, "Le sol arrête la chute");

// ── Un trou d'un seul bloc ne laisse pas tomber un héros de 42 px ───────────
const shaft1 = Terrain.create({ width: 3000 });
for (let row = 0; row <= 6; row++) shaft1.breakAt(10, row); // colonne 10 seule
const edge = { x: 300, feet: 0, width: HERO.width, height: HERO.height };
assert.strictEqual(shaft1.isSupported(edge), true, "Un trou d'un bloc : le héros reste soutenu par ses voisins");
assert.strictEqual(shaft1.move({ x: 300, feet: 0, width: 42, height: 60 }, 0, 300).feet, 0, "Il ne tombe pas dans un trou d'un bloc");

// ── Un puits de deux blocs de large : le héros tombe jusqu'à la pierre ──────
const shaft2 = Terrain.create({ width: 3000 });
for (let col = 10; col <= 11; col++) {
  for (let row = 0; row <= 6; row++) shaft2.breakAt(col, row);
}
const dropped = shaft2.move({ x: 305, feet: 0, width: 42, height: 60 }, 0, 300);
assert.strictEqual(dropped.feet, 7 * BLOCK, "Dans un puits de deux blocs, le héros se pose sur la pierre (ligne 7)");
assert.strictEqual(dropped.landed, true, "La chute se termine par un atterrissage");
assert.strictEqual(shaft2.isSupported({ x: 305, feet: dropped.feet, width: 42, height: 60 }), true, "Posé au fond du puits");

// ── Tunnel de deux blocs de haut : marche, mur, plafond ─────────────────────
const tunnel = Terrain.create({ width: 3000 });
for (let col = 10; col <= 13; col++) {
  for (let row = 5; row <= 6; row++) tunnel.breakAt(col, row);
}
const inside = { x: 310, feet: 7 * BLOCK, width: HERO.width, height: HERO.height }; // pieds sur la pierre (ligne 7)
assert.strictEqual(tunnel.overlapsSolid(inside.x, inside.feet - 60, inside.x + 42, inside.feet), false, "Le héros tient dans le tunnel de deux blocs");
assert.strictEqual(tunnel.isSupported(inside), true, "Le sol du tunnel porte le héros");
const toWall = tunnel.move(inside, 1000, 0);
assert.strictEqual(toWall.hitX, true, "Le mur du tunnel arrête le héros");
assert.strictEqual(toWall.x, 14 * BLOCK - HERO.width, "Il s'arrête exactement contre la face du bloc (pas de traversée)");

// Un plafond de pierre : la tête s'arrête sous le bloc, sans traverser.
const headBump = tunnel.move(inside, 0, -80);
assert.strictEqual(headBump.hitY, true, "Le plafond est touché en sautant");
assert.strictEqual(headBump.landed, false, "Ce n'est pas un atterrissage");
assert.strictEqual(headBump.feet, 7 * BLOCK, "La tête reste sous le plafond, les pieds ne montent pas");

// Un grand bond horizontal (500 px en un seul appel) est arrêté par le mur :
// le déplacement est découpé en pas, il n'y a pas de téléportation.
const longStep = Terrain.create({ width: 3000 });
for (let col = 10; col <= 13; col++) {
  for (let row = 5; row <= 6; row++) longStep.breakAt(col, row);
}
const blocked = longStep.move({ x: 310, feet: 7 * BLOCK, width: 42, height: 60 }, 500, 0);
assert.strictEqual(blocked.hitX, true, "Un bond horizontal de 500 px est arrêté par le mur");
assert.strictEqual(blocked.x, 14 * BLOCK - HERO.width, "Le héros s'arrête contre la face du bloc suivant");

// Creuser le sol du tunnel : sans bloc dessous, le héros n'est plus soutenu et tombe.
for (let col = 10; col <= 13; col++) tunnel.breakAt(col, 7);
assert.strictEqual(tunnel.isSupported(inside), false, "Sans bloc sous les pieds, le héros n'est plus soutenu");
const fallen = tunnel.move(inside, 0, 200);
assert.strictEqual(fallen.feet, 8 * BLOCK, "Il tombe jusqu'à la ligne de pierre suivante");

// Entrées sans effet et valeurs nulles.
const still = terrain.move(onSurface, 0, 0);
assert.strictEqual(still.x, 200, "Un déplacement nul ne bouge rien");
assert.strictEqual(still.feet, 0, "Un déplacement nul ne bouge pas non plus les pieds");

console.log("terrain.test.js : ok");
