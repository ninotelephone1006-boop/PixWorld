"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "characters.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const catalog = sandbox.window.PixWorldCharacters;
assert(catalog, "Le catalogue des personnages est chargé");
assert.strictEqual(catalog.list.length, 4, "Un héros historique et trois nouveaux héros sont disponibles");
assert.deepStrictEqual(
  Array.from(catalog.list, (character) => character.id),
  ["ninja", "archer", "samurai", "mage"],
);
assert.strictEqual(new Set(Array.from(catalog.list, (character) => character.attackStyle)).size, 4, "Les quatre héros ont des styles d'attaque différents");

/** Vérifie qu'une feuille de sprite est un PNG 256×128 valide. */
function checkSheet(spritePath, label) {
  assert(fs.existsSync(spritePath), "Spritesheet présente pour " + label);
  const png = fs.readFileSync(spritePath);
  assert.strictEqual(png.toString("hex", 0, 8), "89504e470d0a1a0a", "PNG valide pour " + label);
  assert.strictEqual(png.readUInt32BE(16), 256, "Largeur de spritesheet attendue pour " + label);
  assert.strictEqual(png.readUInt32BE(20), 128, "Hauteur de spritesheet attendue pour " + label);
}

const NUMERIC_FIELDS = ["speed", "jumpStrength", "attackDuration", "attackDamage", "knockback"];
const PROJECTILE_FIELDS = ["projectileDelay", "projectileSpeed", "projectileLife"];

for (const character of catalog.list) {
  checkSheet(path.join(__dirname, "..", character.sprite), character.id);
  assert.strictEqual(character.weaponSprite, undefined, "Plus de surcouche d'arme : chaque héros a sa feuille complète (" + character.id + ")");
  for (const field of NUMERIC_FIELDS) {
    assert(typeof character[field] === "number" && character[field] > 0, field + " défini pour " + character.id);
  }
  if (character.attackStyle !== "slash") {
    for (const field of PROJECTILE_FIELDS) {
      assert(typeof character[field] === "number" && character[field] >= 0, field + " défini pour " + character.id);
    }
    assert(character.projectileDelay < character.attackDuration, "Le projectile part pendant le geste d'attaque de " + character.id);
  }
  assert(typeof character.hitSound === "string" && character.hitSound, "Son d'impact défini pour " + character.id);
  assert(typeof character.attackSound === "string" && character.attackSound, "Son d'attaque défini pour " + character.id);
  assert(/^#[0-9a-f]{6}$/i.test(character.accent), "Couleur d'accent (interface) valide pour " + character.id);
  assert(catalog.isValid(character.id), "ID de personnage accepté : " + character.id);
  console.log("  ok   " + character.name + " · " + character.attackName + " · spritesheet 256×128 valide");
}

// Chaque héros a maintenant sa propre feuille : Sora et Raiden ne partagent
// plus le corps du ninja, et aucune teinte n'est appliquée aux sprites.
const sprites = Array.from(catalog.list, (character) => character.sprite);
assert.strictEqual(new Set(sprites).size, 4, "Les quatre héros utilisent quatre feuilles de sprite différentes");
assert(catalog.get("archer").sprite.includes("archer"), "Sora a sa propre feuille d'archère");
assert(catalog.get("samurai").sprite.includes("samurai"), "Raiden a sa propre feuille de samouraï");
assert.notStrictEqual(catalog.get("archer").sprite, catalog.get("ninja").sprite, "Sora n'est pas dessinée avec le sprite de Kage");
assert.notStrictEqual(catalog.get("samurai").sprite, catalog.get("ninja").sprite, "Raiden n'est pas dessiné avec le sprite de Kage");
console.log("  ok   Sora et Raiden ont leurs propres sprites, distincts du ninja");

// Les sons référencés par les héros existent bien dans le moteur audio.
const audioSource = fs.readFileSync(path.join(__dirname, "..", "src", "audio.js"), "utf8");
const audioSandbox = { window: {}, console };
vm.createContext(audioSandbox);
vm.runInContext(audioSource, audioSandbox);
const presetNames = new Set(audioSandbox.window.PixWorldAudio.names);
for (const character of catalog.list) {
  for (const field of ["hitSound", "attackSound", "windupSound"]) {
    if (character[field]) assert(presetNames.has(character[field]), character.id + "." + field + " = " + character[field] + " existe dans l'audio");
  }
}
console.log("  ok   Les sons des héros existent dans le moteur audio");

assert.strictEqual(catalog.get("personnage-inconnu").id, "ninja", "Un ID inconnu retombe sur le ninja par défaut");
assert.strictEqual(catalog.isValid("personnage-inconnu"), false);
console.log("Tous les héros et leurs ressources sont valides");
