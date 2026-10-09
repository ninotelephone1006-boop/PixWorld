"use strict";

/**
 * Vérifie le monde plat hors navigateur : sol toujours plat (offset = 0),
 * un seul biome (prairie avec texture d'herbe), pas de plateforme ni de
 * décor généré, déplacement sans chute et atterrissage cohérent.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "world.js"), "utf8");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const World = sandbox.window.PixWorldWorld;
assert(World && typeof World.create === "function", "Le module de monde est chargé");
const { STEP } = World.constants;
const BASE_Y = 500; // ligne de base d'un écran de test

const world = World.create("pixworld");

// Déterminisme : deux créations donnent le même monde.
const twin = World.create("pixworld");
assert.strictEqual(twin.width, world.width, "Même largeur");
for (let x = 0; x < world.width; x += 997) {
  assert.strictEqual(twin.offsetAt(x), world.offsetAt(x), "Même relief (plat) à x=" + x);
  assert.strictEqual(twin.biomeAt(x).id, world.biomeAt(x).id, "Même biome à x=" + x);
}
// La graine est conservée mais le monde reste plat quelle que soit la graine.
const other = World.create("autre-graine");
assert.strictEqual(other.width, world.width, "Largeur identique pour toute graine");
assert.strictEqual(other.offsetAt(4200), 0, "Sol plat même avec une autre graine");

// Un seul biome : la prairie, sur toute la largeur.
assert.strictEqual(world.bands.length, 1, "Une seule bande (prairie)");
assert.strictEqual(world.bands[0].biome, "prairie", "Uniquement la prairie");
assert.strictEqual(world.bands[0].start, 0, "La bande part de 0");
assert.strictEqual(world.bands[0].end, world.width, "La bande couvre tout le monde");
assert.strictEqual(world.biomeAt(0).id, "prairie");
assert.strictEqual(world.biomeAt(world.width / 2).id, "prairie");
assert.strictEqual(world.biomeAt(world.width + 5000).id, "prairie");

const prairie = World.BIOMES.prairie;
assert(prairie && prairie.name && prairie.blurb, "La prairie a un nom et une description");

// Sol plat : offset toujours à 0, partout.
for (let x = 0; x < world.width; x += 47) {
  const offset = world.offsetAt(x);
  assert.strictEqual(offset, 0, "Sol plat (offset=0) à x=" + x);
}

// Pas de plateforme flottante.
assert.strictEqual(world.platformsIn(0, world.width).length, 0, "Aucune plateforme");
assert.strictEqual(world.platformsIn(-100, 500).length, 0, "Aucune plateforme près du départ");

// Pas de décor généré.
assert.strictEqual(world.propsIn(0, world.width).length, 0, "Aucun décor généré");

// Marchabilité : le sol est toujours au même niveau (BASE_Y), on marche sans jamais tomber.
let feet = BASE_Y - world.offsetAt(0);
for (let x = 0; x < Math.min(world.width - 6, 20000); x += 5.67) {
  const next = world.supportTop(x + 5.67, feet, BASE_Y);
  assert(next !== null, "Le sol reste sous les pieds à x=" + Math.round(x));
  assert.strictEqual(next, BASE_Y, "Le sol est toujours à la hauteur de base à x=" + Math.round(x));
  feet = next;
}

// Atterrissage : un personnage qui tombe sur le sol s'y pose.
const groundTop = BASE_Y - world.offsetAt(300);
assert.strictEqual(groundTop, BASE_Y, "Sol plat = hauteur de base");
assert.strictEqual(world.landingTop(300, groundTop - 40, groundTop + 3, BASE_Y), groundTop, "Atterrissage au sol");
assert.strictEqual(world.landingTop(300, groundTop + 30, groundTop + 60, BASE_Y), null, "Pas d'atterrissage quand on est déjà au sol");
assert.strictEqual(world.supportTop(300, groundTop + 80, BASE_Y), null, "Trop bas pour être soutenu : on tombe");
assert.strictEqual(world.supportTop(300, groundTop + 1, BASE_Y), groundTop, "Soutien au niveau du sol");

// blendAt ne signale aucune transition : toujours dans la prairie.
for (const x of [0, 500, 5000, world.width / 2, world.width - 1]) {
  const b = world.blendAt(x);
  assert.strictEqual(b.from, "prairie");
  assert.strictEqual(b.to, "prairie");
  assert.strictEqual(b.t, 1);
}

// Constantes toujours exposées pour compatibilité.
assert.strictEqual(typeof World.constants.STEP, "number");
assert.strictEqual(typeof World.constants.TILE, "number");
assert.strictEqual(typeof World.constants.DEFAULT_SEED, "string");
assert.strictEqual(typeof World.constants.PRAIRIE_LENGTH, "number");

console.log("world.test.js : ok");
