/*
 * Physique des projectiles : les valeurs choisies par le jeu.
 *
 * Ces réglages sont volontairement figés : aucun joueur ne peut changer la
 * vitesse, la gravité, la portée ou la taille d'un tir. Le panneau ⚙ du jeu
 * n'offre que l'affichage de l'aperçu du tir, purement local. Le projectile
 * part donc toujours de la même façon chez tout le monde et le serveur n'a
 * aucune physique à valider : il ne reçoit plus ces valeurs.
 *
 * Chaque héros garde néanmoins son tir d'origine (la flèche de Sora retombe
 * plus franchement que le shuriken de Kage) : c'est une différence de design,
 * pas un réglage personnel. src/characters.js recopie ces valeurs dans la
 * feuille de chaque héros, et c'est cette feuille que le jeu applique.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PixWorldProjectilePhysics = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    ninja: Object.freeze({ speed: 590, gravity: 300, gravityDelay: 0.2, life: 1.6, scale: 1 }),
    archer: Object.freeze({ speed: 820, gravity: 760, gravityDelay: 0.28, life: 2.2, scale: 0.9 }),
    mage: Object.freeze({ speed: 430, gravity: 100, gravityDelay: 0.1, life: 2.7, scale: 1.1 }),
  });

  /** Le tir fixé par le jeu pour un héros (le ninja sert de repli). */
  function forCharacter(characterId) {
    return DEFAULTS[characterId] || DEFAULTS.ninja;
  }

  return Object.freeze({ DEFAULTS, forCharacter });
});
