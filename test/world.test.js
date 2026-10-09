"use strict";

/**
 * Vérifie le monde procédural hors navigateur : même graine, même monde ;
 * quatre biomes dans un ordre propre à la graine ; un relief marchable (le
 * personnage ne tombe jamais en avançant sur le sol) ; des plateformes
 * atteignables en sautant ; des collisions cohérentes à l'atterrissage.
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
const { STEP, SPAWN_CLEAR } = World.constants;
const BASE_Y = 500; // ligne de base d'un écran de test
const JUMP_HEIGHT = (700 * 700) / (2 * 1900); // hauteur maximale d'un saut, px

const world = World.create("pixworld");
const expectedBiomes = ["prairie", "desert", "snow", "volcano"];

// Déterminisme : deux clients avec la même graine voient exactement le même monde.
const twin = World.create("pixworld");
assert.strictEqual(JSON.stringify(twin.bands), JSON.stringify(world.bands), "Même graine, mêmes biomes");
assert.strictEqual(twin.width, world.width, "Même graine, même largeur");
for (let x = 0; x < world.width; x += 97) {
  assert.strictEqual(twin.offsetAt(x), world.offsetAt(x), "Même relief à x=" + x);
}
assert.notStrictEqual(JSON.stringify(World.create("autre-graine").bands), JSON.stringify(world.bands), "Une autre graine change le monde");

// Biomes : la prairie part du départ, les trois autres suivent, sans trou.
assert.strictEqual(world.bands[0].biome, "prairie", "Le départ est dans la prairie");
assert.strictEqual(
  world.bands.map((b) => b.biome).sort().join(","),
  expectedBiomes.slice().sort().join(","),
  "Quatre biomes distincts",
);
world.bands.forEach((band, index) => {
  assert(band.end > band.start, "Bande non vide");
  if (index > 0) assert.strictEqual(band.start, world.bands[index - 1].end, "Bandes contiguës");
});
assert.strictEqual(world.bands[world.bands.length - 1].end, world.width, "Les bandes couvrent le monde");
const ordersSeen = new Set();
for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
  const other = World.create(seed);
  ordersSeen.add(other.bands.map((b) => b.biome).join(">"));
  assert.strictEqual(other.bands[0].biome, "prairie", "La prairie reste au départ quelle que soit la graine");
}
assert(ordersSeen.size > 1, "L'ordre des biomes varie selon la graine");

// Chaque biome est bien identifié par son nom et sa description.
for (const id of expectedBiomes) {
  const biome = World.BIOMES[id];
  assert(biome && biome.name && biome.blurb, "Le biome " + id + " a un nom et une description");
  assert(biome.props.length > 0, "Le biome " + id + " a du décor");
}
assert.strictEqual(world.biomeAt(0).id, "prairie");
assert.strictEqual(world.biomeAt(world.width + 500).id, world.bands[3].biome, "Hors monde : le dernier biome");

// Relief : positif, nul au départ, borné par l'amplitude du biome.
for (let x = 0; x < world.width; x += 7) {
  const offset = world.offsetAt(x);
  assert(Number.isFinite(offset) && offset >= 0, "Relief fini et positif à x=" + x);
  assert(offset <= 140, "Relief borné à x=" + x);
}
for (let x = 0; x <= SPAWN_CLEAR; x += 10) {
  assert.strictEqual(world.offsetAt(x), 0, "Zone de départ plate à x=" + x);
}

// Marchabilité : en avançant au pas de la marche (340 px/s, 60 Hz), le sol ne
// s'éloigne jamais de plus de STEP entre deux positions : le personnage suit.
let feet = BASE_Y - world.offsetAt(0);
let worstStep = 0;
for (let x = 0; x < world.width - 6; x += 5.67) {
  const next = world.supportTop(x + 5.67, feet, BASE_Y);
  assert(next !== null, "Le sol reste sous les pieds en marchant à x=" + Math.round(x));
  worstStep = Math.max(worstStep, Math.abs(next - feet));
  feet = next;
}
assert(worstStep <= STEP, "Dénivelé marchable : " + worstStep.toFixed(1) + " px");

// Plateformes : bien dans le monde, au-dessus du relief dessous, et atteignables.
const platforms = world.platformsIn(0, world.width);
assert(platforms.length >= 5, "Assez de plateformes dans le monde");
platforms.forEach((platform) => {
  assert(platform.x >= 0 && platform.x + platform.w <= world.width, "Plateforme dans le monde");
  assert(platform.w >= 192 && platform.w % 64 === 0, "Plateforme en tuiles entières");
  for (let s = 0; s <= 4; s++) {
    const x = platform.x + (platform.w * s) / 4;
    assert(platform.offset >= world.offsetAt(x), "Plateforme au-dessus du relief");
  }
  const rise = platform.offset - world.offsetAt(platform.x + platform.w / 2);
  assert(rise <= JUMP_HEIGHT, "Plateforme atteignable en sautant (" + rise.toFixed(0) + " px)");
  assert(rise >= 60, "Plateforme visible au-dessus du sol");
});
assert.strictEqual(JSON.stringify(world.platformsIn(0, world.width)), JSON.stringify(platforms), "Les plateformes sont stables");

// Atterrissage : un personnage qui tombe sur une plateforme s'y pose.
const p = platforms[0];
const cx = p.x + p.w / 2;
const topY = BASE_Y - p.offset;
assert.strictEqual(world.landingTop(cx, topY - 30, topY + 5, BASE_Y), topY, "Atterrissage sur une plateforme");
assert.strictEqual(world.landingTop(cx, topY + 30, topY + 60, BASE_Y) === topY, false, "Pas de collision par le dessous");
assert.strictEqual(world.landingTop(p.x - 60, topY - 30, topY + 5, BASE_Y) === topY, false, "Hors de la plateforme : pas d'appui");

// Au sol : une chute au-dessus du relief se pose sur le relief.
const groundX = 300;
const groundTop = BASE_Y - world.offsetAt(groundX);
assert.strictEqual(world.landingTop(groundX, groundTop - 40, groundTop + 3, BASE_Y), groundTop, "Atterrissage au sol");
assert.strictEqual(world.supportTop(groundX, groundTop + 80, BASE_Y), null, "Trop bas pour être soutenu : on tombe");

// Décor : placé dans le monde, sur le bon biome, et déterministe.
const props = world.propsIn(0, world.width);
assert(props.length > 10, "Assez de décor dans le monde");
props.forEach((prop) => {
  assert(prop.x >= 0 && prop.x <= world.width, "Décor dans le monde");
  assert(World.BIOMES[prop.biome].props.some((entry) => entry[0] === prop.kind), "Décor cohérent avec son biome");
  assert(prop.scale >= 0.8 && prop.scale <= 1.3, "Échelle du décor");
});
const kinds = new Set(props.map((prop) => prop.kind));
for (const id of expectedBiomes.slice(1)) {
  assert(props.some((prop) => prop.biome === id), "Décor présent dans " + id);
}
assert(kinds.size >= 8, "Plusieurs sortes de décor");
assert.strictEqual(
  JSON.stringify(world.propsIn(0, 800)),
  JSON.stringify(props.filter((prop) => prop.x <= 800 + 80 && prop.x >= -80)),
  "Décor par fenêtre cohérent",
);

// Transition de biome : douce, et continue.
const boundary = world.bands[1].start;
const before = world.blendAt(boundary - 1);
const middle = world.blendAt(boundary + 130);
const after = world.blendAt(boundary + 400);
assert.strictEqual(before.from, "prairie");
assert.strictEqual(before.to, "prairie");
assert(middle.t > 0 && middle.t < 1, "Transition en cours au milieu");
assert.strictEqual(after.t, 1, "Transition finie plus loin");
assert.strictEqual(after.to, world.bands[1].biome);

console.log("world.test.js : ok");
