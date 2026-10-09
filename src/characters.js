/*
 * Catalogue des combattants PixWorld.
 * Les sprites sont sous CC0 ; les quatre règles de combat et leurs effets
 * (shuriken, flèche, coupe, orbe) sont propres à PixWorld.
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
      projectileSpeed: 590,
      projectileLife: 1.6,
      speed: 340,
      jumpStrength: 700,
    },
    {
      id: "archer",
      name: "Sora",
      role: "Archère",
      sprite: "assets/characters/ninja-bow-32x32.png",
      accent: "#7ee39a",
      attackStyle: "arrow",
      attackName: "Flèche de vent",
      attackDescription: "Tir tendu · portée longue",
      attackDuration: 0.48,
      projectileSpeed: 790,
      projectileLife: 2.2,
      speed: 355,
      jumpStrength: 720,
    },
    {
      id: "samurai",
      name: "Raiden",
      role: "Samouraï",
      sprite: "assets/characters/ninja-sword-32x32.png",
      accent: "#ff6b73",
      attackStyle: "slash",
      attackName: "Coupe du tonnerre",
      attackDescription: "Grand arc lumineux · mêlée",
      attackDuration: 0.42,
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
      projectileSpeed: 420,
      projectileLife: 2.7,
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
