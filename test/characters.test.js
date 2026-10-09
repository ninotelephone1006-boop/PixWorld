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

for (const character of catalog.list) {
  const spritePath = path.join(__dirname, "..", character.sprite);
  assert(fs.existsSync(spritePath), "Spritesheet présent pour " + character.id);
  const png = fs.readFileSync(spritePath);
  assert.strictEqual(png.toString("hex", 0, 8), "89504e470d0a1a0a", "PNG valide pour " + character.id);
  assert.strictEqual(png.readUInt32BE(16), 256, "Largeur de spritesheet attendue pour " + character.id);
  assert.strictEqual(png.readUInt32BE(20), 128, "Hauteur de spritesheet attendue pour " + character.id);
  assert(catalog.isValid(character.id), "ID de personnage accepté : " + character.id);
  console.log("  ok   " + character.name + " · " + character.attackName + " · spritesheet CC0 valide");
}

assert.strictEqual(catalog.get("personnage-inconnu").id, "ninja", "Un ID inconnu retombe sur le ninja par défaut");
assert.strictEqual(catalog.isValid("personnage-inconnu"), false);
console.log("Tous les héros et leurs ressources sont valides");
