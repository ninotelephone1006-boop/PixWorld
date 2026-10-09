/*
 * Catalogue des combattants PixWorld.
 *
 * Chaque héros possède sa propre feuille de sprite complète (256 × 128 px,
 * cellules de 32 × 32 : idle, course, saut, attaque, blessé, K.O.) :
 *   - Kage et Yume utilisent les ninjas CC0 du pack quadplay ;
 *   - Sora et Raiden ont des sprites originaux dessinés pour PixWorld
 *     (voir tools/make-sprites.py), afin de ne plus ressembler au ninja.
 *
 * Les réglages de combat (dégâts, vitesse, délai de tir, recul, sons) sont
 * lus par src/game.js ; le serveur ne connaît que les identifiants.
 */
(() => {
  "use strict";

  const characters = [
    {
      id: "ninja",
      name: "Kage",
      role: "Ninja",
      sprite: "assets/ninja-black-32x32.png",
      accent: "#ff8a5c",
      attackStyle: "shuriken",
      attackName: "Shuriken",
      attackDescription: "Étoile tournoyante · tir rapide",
      attackDuration: 0.36,
      // Le projectile part un peu après le début du geste (préparation).
      projectileDelay: 0.08,
      projectileSpeed: 590,
      projectileLife: 1.6,
      attackDamage: 8,
      knockback: 180,
      hitSound: "hitShuriken",
      attackSound: "throwShuriken",
      speed: 340,
      jumpStrength: 700,
    },
    {
      id: "archer",
      name: "Sora",
      role: "Archère",
      sprite: "assets/characters/archer-32x32.png",
      accent: "#7ee39a",
      attackStyle: "arrow",
      attackName: "Flèche de vent",
      attackDescription: "Tir tendu · portée longue",
      attackDuration: 0.48,
      // La flèche est décochée sur la 3e image : corde tirée puis relâchée.
      projectileDelay: 0.24,
      projectileSpeed: 820,
      projectileLife: 2.2,
      attackDamage: 12,
      knockback: 230,
      hitSound: "hitArrow",
      attackSound: "bowRelease",
      windupSound: "bowDraw",
      speed: 355,
      jumpStrength: 720,
    },
    {
      id: "samurai",
      name: "Raiden",
      role: "Samouraï",
      sprite: "assets/characters/samurai-32x32.png",
      accent: "#ff6b73",
      attackStyle: "slash",
      attackName: "Coupe du tonnerre",
      attackDescription: "Enchaînement de 3 coupes · mêlée",
      attackDuration: 0.42,
      attackDamage: 20,
      knockback: 360,
      hitSound: "hitSlash",
      attackSound: "slash",
      speed: 320,
      jumpStrength: 690,
    },
    {
      id: "mage",
      name: "Yume",
      role: "Arcaniste",
      sprite: "assets/characters/ninja-purple-32x32.png",
      accent: "#c792ea",
      attackStyle: "orb",
      attackName: "Orbe astral",
      attackDescription: "Projectile magique · large et stable",
      attackDuration: 0.58,
      // L'orbe se forme dans la main pendant l'incantation avant de partir.
      projectileDelay: 0.2,
      projectileSpeed: 430,
      projectileLife: 2.7,
      attackDamage: 16,
      knockback: 260,
      hitSound: "hitOrb",
      attackSound: "castOrb",
      windupSound: "chargeOrb",
      speed: 330,
      jumpStrength: 700,
    },
  ];

  const byId = new Map(characters.map((character) => [character.id, Object.freeze(character)]));
  const list = Object.freeze(characters.map((character) => byId.get(character.id)));

  window.PixWorldCharacters = Object.freeze({
    list,
    get(id) {
      return byId.get(id) || byId.get("ninja");
    },
    isValid(id) {
      return byId.has(id);
    },
  });
})();
