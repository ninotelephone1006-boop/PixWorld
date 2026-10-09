"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "mining.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Mining = sandbox.window.PixWorldMining;
assert(Mining && typeof Mining.create === "function", "Le module de minage est chargé");
assert.equal(Mining.constants.MINE_TIME, 0.2, "0,2 seconde de maintien suffit à casser un bloc");
assert.equal(Mining.constants.ROWS, 15, "Le terrain contient quinze couches");
assert.equal(Mining.constants.LAYER_TYPES[0], "grass", "Une couche d'herbe en surface");
assert.equal(Array.from(Mining.constants.LAYER_TYPES.slice(1, 5)).join(","), "dirt,dirt,dirt,dirt", "Quatre couches de terre");
assert.equal(Array.from(Mining.constants.LAYER_TYPES.slice(5)).every((type) => type === "stone"), true, "Dix couches de pierre");

const baseY = 120;
const mine = Mining.create({ worldWidth: 96, blockSize: 32 });
assert.equal(mine.columns, 3);
assert.equal(mine.totalHeight, 480);
assert.equal(mine.blockAt(15, baseY + 15, baseY).type, "grass");
assert.equal(mine.blockAt(33, baseY + 33, baseY).type, "dirt");
assert.equal(mine.blockAt(33, baseY + 5 * 32 + 2, baseY).type, "stone");
assert.equal(mine.blockAt(15, baseY - 1, baseY), null, "Le curseur au-dessus du sol ne cible rien");
assert.equal(mine.blockAt(15, baseY + 15 * 32, baseY), null, "Pas de couche au-dessous des dix pierres");
assert.equal(mine.surfaceAt(10, baseY), baseY);

const grass = mine.breakBlock(0, 0, { baseY, dropId: "local:1", networked: false });
assert.equal(grass.type, "grass");
assert.equal(grass.drop.type, "grass");
assert.equal(mine.isRemoved(0, 0), true);
assert.equal(mine.breakBlock(0, 0), null, "Un bloc cassé ne peut pas être cassé deux fois");
assert.equal(mine.surfaceAt(10, baseY), baseY + 32, "La terre devient la surface après le minage");
assert.equal(mine.supportTop(10, baseY, baseY, 32 * 0.8), null, "Un trou d'un bloc fait tomber le joueur");
assert.equal(mine.landingTop(10, baseY + 20, baseY + 32, baseY), baseY + 32, "Le joueur atterrit sur le bloc suivant");

const dirt = mine.breakBlock(0, 1, { baseY, dropId: "local:2", networked: false });
assert.equal(dirt.type, "dirt");
assert.equal(mine.surfaceBlockAt(10, baseY).row, 2);
const stone = mine.breakBlock(0, 5, { baseY, dropId: "local:3", networked: false });
assert.equal(stone.type, "stone", "La cinquième ligne sous la surface est en pierre");

const picker = Mining.create({ worldWidth: 64, blockSize: 32 });
picker.breakBlock(0, 0, { baseY, dropId: "local:pickup", networked: false });
const playerRect = { x: 0, y: baseY - 60, width: 30, height: 60 };
assert.equal(picker.findTouchedDrops(playerRect, baseY).length, 1, "Un drop touché est détecté");
const collected = picker.collectTouchedLocalDrops(playerRect, baseY);
assert.equal(collected.length, 1);
assert.equal(collected[0].type, "grass");
assert.equal(picker.inventory().grass, 1, "Le bloc ramassé entre dans l'inventaire");
assert.equal(picker.getDrops().length, 0, "Le drop disparaît après le ramassage");

const shared = Mining.create({ worldWidth: 64, blockSize: 32 });
shared.breakBlock(0, 0, { baseY, dropId: "p1:4", ownerId: "p1", networked: true });
assert.equal(shared.findTouchedDrops(playerRect, baseY)[0].networked, true, "Les drops réseau attendent confirmation");
assert.equal(shared.markDropPending("p1:4"), true);
assert.equal(shared.findTouchedDrops(playerRect, baseY).length, 0, "Une collecte en attente n'est pas renvoyée");
assert.equal(shared.inventory().grass, 0, "Pas d'inventaire avant confirmation du serveur");
shared.applyState({ mined: [[1, 0]], drops: [
  { id: "p1:4", column: 0, row: 0, ownerId: "p1" },
  { id: "p2:9", column: 1, row: 0, ownerId: "p2" },
] });
assert.equal(shared.isRemoved(1, 0), true, "L'état réseau synchronise les blocs cassés");
assert.equal(shared.getDrops().some((drop) => drop.id === "p2:9"), true, "L'état réseau synchronise les drops");
shared.clearPendingClaims();
assert.equal(shared.collectDrop("p1:4").type, "grass");
assert.equal(shared.inventory().grass, 1);
shared.removeDrop("p2:9");
assert.equal(shared.inventory().grass, 1, "Ramasser le drop d'un autre joueur ne modifie pas son inventaire");

// ─────────── Collisions : ni traverse-muraille, ni chute dans le vide ───────────
const arena = Mining.create({ worldWidth: 320, blockSize: 32 });
// Au sol, un corps est soutenu par la surface.
assert.equal(arena.standingOn(40, baseY - 60, 20, 60, baseY), true, "La surface soutient le joueur");
// On creuse intégralement la colonne 1 : plus aucune surface…
for (let row = 0; row < arena.layerCount; row++) {
  arena.breakBlock(1, row, { baseY, createDrop: false });
}
// La roche mère reste : c'est elle qui interdit de tomber dans le vide.
assert.equal(arena.surfaceAt(40, baseY), baseY + (arena.layerCount - 1) * 32, "Seule la roche mère reste au fond");
// …mais la chute s'arrête sur le plancher du monde (roche mère), pas dans le vide.
const fall = arena.moveEntity({ x: 40, y: baseY - 60, width: 20, height: 60 }, 0, 5000, baseY);
assert.equal(fall.grounded, true, "La chute finit au sol");
assert.ok(fall.y + 60 <= baseY + arena.totalHeight + 0.01, "Le plancher du monde arrête la chute");
// Depuis le trou, foncer vers la paroi intacte de la colonne 0 : on est bloqué.
const walled = arena.moveEntity({ x: 40, y: fall.y, width: 20, height: 60 }, -500, 0, baseY);
assert.ok(walled.x >= 32 - 0.01 && walled.x <= 32 + 0.5, "Un mur de blocs bloque l'avancée");
// ─────────── Pose de blocs : jamais en l'air, toujours contre un bloc ───────────
assert.equal(arena.canPlaceAt(5, -3), false, "Pas de bloc posé en plein air");
assert.equal(arena.canPlaceAt(0, -1), true, "Contre la surface : pose autorisée");
const tower = arena.placeBlock(0, -1, "stone");
assert.equal(tower.type, "stone");
assert.equal(arena.blockType(0, -1), "stone", "Le bloc posé existe");
assert.equal(arena.canPlaceAt(0, -2), true, "On peut empiler sur un bloc posé");
assert.equal(arena.surfaceAt(10, baseY), baseY - 32, "La tour devient la surface");
// Casser un bloc de la tour ne fait rien d'autre : rien ne s'effondre.
arena.breakBlock(0, -1, { baseY, createDrop: false });
assert.equal(arena.blockType(0, -1), null, "Le bloc cassé disparaît");
assert.equal(arena.blockType(0, 0), "grass", "Le reste du terrain est intact");
// Reboucher un trou : la pose dans une cellule minée fonctionne.
assert.equal(arena.canPlaceAt(1, 0), true, "Reboucher un trou est autorisé");
arena.placeBlock(1, 0, "dirt");
assert.equal(arena.blockType(1, 0), "dirt", "Le trou est rebouché");
// Un plafond bâti bloque le saut (on ne traverse pas les blocs vers le haut).
arena.breakBlock(4, 0, { baseY, createDrop: false });
assert.equal(arena.placeBlock(3, -1, "stone").type, "stone");
assert.equal(arena.placeBlock(4, -1, "stone").type, "stone", "Pose contre un bloc posé");
const ceiling = arena.moveEntity({ x: 4 * 32 + 6, y: baseY + 6, width: 20, height: 20 }, 0, -500, baseY);
assert.equal(ceiling.hitCeiling, true, "Le plafond bloque le saut");

// La roche mère (dernière rangée) est incassable.
assert.equal(arena.breakBlock(2, arena.layerCount - 1), null, "La roche mère ne casse pas");
// Inventaire : dépenser puis rembourser.
assert.equal(arena.spendBlock("stone"), false, "Rien à dépenser sans collecte");

console.log("mining.test.js : terrain, couches, minage, collisions, drops, inventaire et synchronisation : ok");
