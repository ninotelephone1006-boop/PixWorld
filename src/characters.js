/*
 * Catalogue des combattants PixWorld.
 * Les sprites sont sous CC0 ; les quatre règles de combat et leurs effets
 * (shuriken, flèche, coupe, orbe) sont propres à PixWorld.
 *
 * Feuilles de sprite : `sprite` contient le corps du combattant. Certains
 * héros ont en plus une `weaponSprite` — surcouche contenant uniquement
 * l'arme (arc, sabre), dessinée par-dessus le corps image par image.
 * C'est le montage voulu par le pack d'origine (quadplay) : les feuilles
 * d'arc et de sabre ne contiennent que l'arme, pas le personnage.
 */
(() => {
  "use strict";

  const BODY = "assets/ninja-black-32x32.png";

  const characters = [
    {
      id: "ninja",
      name: "Kage",
      role: "Ninja",
      sprite: BODY,
      weaponSprite: null,
      accent: "#ff8a5c",
      attackStyle: "shuriken",
      attackName: "Shuriken",
      attackDescription: "Étoile tournoyante · tir rapide",
      attackDuration: 0.36,
      projectileSpeed: 590,
      projectileLife: 1.6,
      attackDamage: 8,
      speed: 340,
      jumpStrength: 700,
    },
    {
      id: "archer",
      name: "Sora",
      role: "Archère",
      sprite: BODY,
      weaponSprite: "assets/characters/ninja-bow-32x32.png",
      accent: "#7ee39a",
      attackStyle: "arrow",
      attackName: "Flèche de vent",
      attackDescription: "Tir tendu · portée longue",
      attackDuration: 0.48,
      projectileSpeed: 790,
      projectileLife: 2.2,
      attackDamage: 12,
      speed: 355,
      jumpStrength: 720,
    },
    {
      id: "samurai",
      name: "Raiden",
      role: "Samouraï",
      sprite: BODY,
      weaponSprite: "assets/characters/ninja-sword-32x32.png",
      accent: "#ff6b73",
      attackStyle: "slash",
      attackName: "Coupe du tonnerre",
      attackDescription: "Grand arc lumineux · mêlée",
      attackDuration: 0.42,
      attackDamage: 20,
      speed: 320,
      jumpStrength: 690,
    },
    {
      id: "mage",
      name: "Yume",
      role: "Arcaniste",
      sprite: "assets/characters/ninja-purple-32x32.png",
      weaponSprite: null,
      accent: "#c792ea",
      attackStyle: "orb",
      attackName: "Orbe astral",
      attackDescription: "Projectile magique · large et stable",
      attackDuration: 0.58,
      projectileSpeed: 420,
      projectileLife: 2.7,
      attackDamage: 16,
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
