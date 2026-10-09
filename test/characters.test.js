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

for (const character of catalog.list) {
  checkSheet(path.join(__dirname, "..", character.sprite), character.id + " (corps)");
  if (character.weaponSprite) {
    checkSheet(path.join(__dirname, "..", character.weaponSprite), character.id + " (arme)");
  }
  assert(typeof character.attackDamage === "number" && character.attackDamage > 0, "Dégâts définis pour " + character.id);
  assert(catalog.isValid(character.id), "ID de personnage accepté : " + character.id);
  console.log("  ok   " + character.name + " · " + character.attackName + " · spritesheet CC0 valide");
}

// Sora et Raiden portent une surcouche d'arme : leurs feuilles d'arc et de
// sabre ne contiennent que l'arme et doivent se poser sur le corps du ninja.
const archer = catalog.get("archer");
const samurai = catalog.get("samurai");
assert(archer.weaponSprite, "Sora a une surcouche d'arc (sinon seul son arme s'affiche)");
assert(samurai.weaponSprite, "Raiden a une surcouche de sabre (sinon seul son arme s'affiche)");
assert.strictEqual(archer.weaponSprite.includes("bow"), true, "La surcouche de Sora est bien l'arc");
assert.strictEqual(samurai.weaponSprite.includes("sword"), true, "La surcouche de Raiden est bien le sabre");
assert.strictEqual(typeof archer.weaponSprite, "string");
assert.strictEqual(catalog.get("ninja").weaponSprite, null, "Kage n'a pas de surcouche d'arme");
assert.strictEqual(catalog.get("mage").weaponSprite, null, "Yume n'a pas de surcouche d'arme");
console.log("  ok   Sora et Raiden : corps + surcouche d'arme (arc / sabre)");

assert.strictEqual(catalog.get("personnage-inconnu").id, "ninja", "Un ID inconnu retombe sur le ninja par défaut");
assert.strictEqual(catalog.isValid("personnage-inconnu"), false);
console.log("Tous les héros et leurs ressources sont valides");
