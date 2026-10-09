/**
 * PixWorld — monde plat (prairie uniquement).
 *
 * La génération procédurale a été retirée : le monde est un sol plat
 * uniforme recouvert de la texture d'herbe de la prairie. Il n'y a plus
 * de relief, plus de biomes autres que la prairie, plus de plateformes
 * flottantes ni d'éléments de décor générés.
 *
 * L'API reste identique pour ne rien casser dans src/game.js et src/scenery.js :
 *
 *   const world = PixWorldWorld.create("pixworld");
 *   world.width;                         // largeur totale en px
 *   world.biomeAt(x);                    // toujours la prairie
 *   world.offsetAt(x);                   // toujours 0 (sol plat)
 *   world.platformsIn(x0, x1);           // [] (pas de plateforme)
 *   world.propsIn(x0, x1);               // [] (pas de décor généré)
 *   world.landingTop(cx, before, now, baseY);
 *   world.supportTop(cx, feet, baseY);
 */
window.PixWorldWorld = (() => {
  "use strict";

  const DEFAULT_SEED = "pixworld";
  // Monde vaste mais plat : 100 000 px de large (~1,5 km de prairie).
  const WORLD_WIDTH = 100000;
  const STEP = 28; // dénivelé franchi sans saut (reste à 28 pour compatibilité)
  const TILE = 64;

  /** Seul biome conservé : la prairie d'herbe. */
  const BIOMES = Object.freeze({
    prairie: Object.freeze({
      id: "prairie",
      name: "Prairie",
      blurb: "Plaines verdoyantes et sol plat",
      relief: 0,
      roughness: 0,
      density: 0,
      props: [],
    }),
  });

  const PRAIRIE_BAND = Object.freeze({ biome: BIOMES.prairie, start: 0, end: WORLD_WIDTH });

  /**
   * Construit un monde plat à partir d'une graine (la graine est conservée
   * pour compatibilité mais n'a plus d'effet : le monde est toujours le même).
   */
  function create(seedText) {
    const text = String(seedText == null || seedText === "" ? DEFAULT_SEED : seedText).slice(0, 64);
    const width = WORLD_WIDTH;

    /** Toujours la prairie, quelle que soit la position. */
    function biomeAt(x) {
      return BIOMES.prairie;
    }

    /** Pas de transition : on est toujours dans la prairie. */
    function blendAt(x) {
      return { from: "prairie", to: "prairie", t: 1 };
    }

    /** Sol parfaitement plat : aucun dénivelé, toujours 0. */
    function offsetAt(x) {
      return 0;
    }

    /** Aucune plateforme flottante. */
    function platformsIn(x0, x1) {
      return [];
    }

    /** Aucun décor généré (arbres, rochers, etc.). */
    function propsIn(x0, x1) {
      return [];
    }

    /**
     * Surface sur laquelle un personnage tombant vient de se poser.
     * Comme le sol est plat et sans plateforme, c'est toujours la ligne
     * de base si le personnage la traverse en tombant.
     */
    function landingTop(cx, before, now, baseY) {
      const top = baseY; // sol plat : offsetAt === 0
      const crossing = before <= top + 2 && now >= top;
      const inside = now >= top && now - top <= 24 && before > top;
      return crossing || inside ? top : null;
    }

    /** Surface la plus proche des pieds : le sol plat, s'il est à portée. */
    function supportTop(cx, feet, baseY) {
      const top = baseY;
      const distance = Math.abs(top - feet);
      return distance <= STEP ? top : null;
    }

    return {
      seed: text,
      width,
      bands: [{ biome: PRAIRIE_BAND.biome.id, start: 0, end: width }],
      biomeAt,
      blendAt,
      offsetAt,
      platformsIn,
      propsIn,
      landingTop,
      supportTop,
    };
  }

  return {
    create,
    BIOMES,
    constants: Object.freeze({
      DEFAULT_SEED,
      STEP,
      TILE,
      BLEND: 260,
      SPAWN_CLEAR: 560,
      PRAIRIE_LENGTH: WORLD_WIDTH,
    }),
    // Utilitaires internes conservés pour ne pas casser d'éventuels imports.
    hashString(text) {
      let h = 0x811c9dc5;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    },
    mix(a, b) {
      let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      h ^= h >>> 12;
      h = Math.imul(h, 0x297a2d39);
      h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    },
    generator(seed) {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };
})();
