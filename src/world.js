/**
 * PixWorld — monde procédural.
 *
 * Un monde se décrit entièrement par une graine (texte) : tous les joueurs
 * qui partagent la même graine parcourent exactement le même niveau, sans
 * rien échanger sur le réseau. Ce module ne dessine rien : il calcule
 *
 *   - les biomes, disposés en bandes le long du monde (la prairie du départ,
 *     puis trois biomes mélangés dans un ordre propre à la graine) ;
 *   - le relief : une hauteur de sol (`offsetAt`, en px au-dessus de la
 *     ligne de base de l'écran) qui varie doucement d'un biome à l'autre ;
 *   - les plateformes flottantes, qu'on atteint en sautant et qu'on traverse
 *     par-dessous ;
 *   - les éléments de décor (arbres, cactus, pins, roches, cristaux…).
 *
 * Toutes les fonctions sont déterministes : même graine, même monde.
 *
 *   const world = PixWorldWorld.create("pixworld");
 *   world.width;                         // largeur totale en px
 *   world.biomeAt(x);                    // { id, name, blurb, … }
 *   world.offsetAt(x);                   // hauteur du sol au-dessus de la base
 *   world.platformsIn(x0, x1);           // plateformes qui chevauchent [x0, x1]
 *   world.propsIn(x0, x1);               // décor à dessiner dans [x0, x1]
 *   world.landingTop(cx, before, now, baseY);   // surface atteinte en tombant
 *   world.supportTop(cx, feet, baseY);          // surface sous les pieds
 */
window.PixWorldWorld = (() => {
  "use strict";

  const DEFAULT_SEED = "pixworld";
  const PRAIRIE_LENGTH = 2000; // la prairie du départ, toujours en premier
  const BAND_MIN = 1800; // longueur des autres biomes : entre ces deux bornes
  const BAND_EXTRA = 500;
  const BLEND = 260; // transition douce du relief entre deux biomes
  const SPAWN_CLEAR = 560; // zone plate autour du point d'apparition
  const SPAWN_RAMP = 420; // distance pour remonter progressivement au relief
  const PLATFORM_CELL = 400; // une plateforme au plus par cellule de 400 px
  const PROP_CELL = 160; // un élément de décor au plus par cellule de 160 px
  const STEP = 28; // dénivelé franchi sans saut (montée comme descente)
  const TILE = 64;

  /** Biomes : relief (amplitude des collines), rugosité et décor possible. */
  const BIOMES = Object.freeze({
    prairie: Object.freeze({
      id: "prairie",
      name: "Prairie",
      blurb: "Plaines verdoyantes et collines douces",
      relief: 70,
      roughness: 0.6,
      density: 0.55,
      props: [["tree", 3], ["bush", 3], ["rock", 1]],
    }),
    desert: Object.freeze({
      id: "desert",
      name: "Dunes dorées",
      blurb: "Dunes de sable, cactus et ruines de grès",
      relief: 80,
      roughness: 0.25,
      density: 0.42,
      props: [["cactus", 4], ["deadbush", 2], ["ruin", 1], ["rock", 2]],
    }),
    snow: Object.freeze({
      id: "snow",
      name: "Taïga gelée",
      blurb: "Pins enneigés, glace et vent glacial",
      relief: 130,
      roughness: 0.85,
      density: 0.5,
      props: [["pine", 5], ["snowrock", 2], ["icespire", 1]],
    }),
    volcano: Object.freeze({
      id: "volcano",
      name: "Terres de cendre",
      blurb: "Roche basaltique, lave et braises",
      relief: 115,
      roughness: 1,
      density: 0.45,
      props: [["basalt", 3], ["lava", 2], ["vent", 1], ["crystal", 1]],
    }),
  });

  // ───────────────────────── Outils déterministes ─────────────────────────

  /** Texte → entier 32 bits (FNV-1a). */
  function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Mélange deux entiers en un nombre dans [0, 1[. */
  function mix(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /** Générateur pseudo-aléatoire seedé (mulberry32). */
  function generator(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function smooth(t) {
    const c = clamp(t, 0, 1);
    return c * c * (3 - 2 * c);
  }

  /**
   * Construit un monde à partir d'une graine. Les biomes autres que la prairie
   * sont tirés dans un ordre propre à la graine ; leur longueur aussi.
   */
  function create(seedText) {
    const text = String(seedText == null || seedText === "" ? DEFAULT_SEED : seedText).slice(0, 64);
    const seed = hashString(text);
    const rng = generator(seed);

    const rest = ["desert", "snow", "volcano"];
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const order = ["prairie"].concat(rest);

    const bands = [];
    let cursor = 0;
    order.forEach((id, index) => {
      const length = index === 0 ? PRAIRIE_LENGTH : BAND_MIN + Math.round(rng() * BAND_EXTRA);
      bands.push({ biome: BIOMES[id], start: cursor, end: cursor + length });
      cursor += length;
    });
    const width = cursor;

    /** Valeur de bruit lissée entre deux nœuds aléatoires, dans [0, 1]. */
    function valueNoise(t, salt) {
      const i = Math.floor(t);
      const f = t - i;
      const u = f * f * (3 - 2 * f);
      const a = mix(seed ^ salt, i);
      const b = mix(seed ^ salt, i + 1);
      return a + (b - a) * u;
    }

    function bandIndexAt(x) {
      for (let i = bands.length - 1; i > 0; i--) {
        if (x >= bands[i].start) return i;
      }
      return 0;
    }

    function biomeAt(x) {
      const px = clamp(x, 0, width - 1);
      return bands[bandIndexAt(px)].biome;
    }

    /** Amplitude du relief, avec transition douce à la frontière des biomes. */
    function reliefAt(x) {
      const i = bandIndexAt(x);
      const band = bands[i];
      const relief = band.biome.relief;
      const into = x - band.start;
      if (i > 0 && into < BLEND) {
        const previous = bands[i - 1].biome.relief;
        return previous + (relief - previous) * smooth(into / BLEND);
      }
      return relief;
    }

    /** Biome « de départ » et « d'arrivée » autour de x, avec la part t du second. */
    function blendAt(x) {
      const i = bandIndexAt(clamp(x, 0, width - 1));
      const band = bands[i];
      const into = x - band.start;
      if (i > 0 && into < BLEND) {
        return { from: bands[i - 1].biome.id, to: band.biome.id, t: smooth(into / BLEND) };
      }
      return { from: band.biome.id, to: band.biome.id, t: 1 };
    }

    function roughnessAt(x) {
      return biomeAt(x).roughness;
    }

    /** Hauteur du sol au-dessus de la ligne de base (px, jamais négative). */
    function offsetAt(x) {
      const flat = smooth((x - SPAWN_CLEAR) / SPAWN_RAMP);
      if (flat <= 0) return 0;
      const rough = roughnessAt(x);
      const broad = valueNoise(x / 420, 0x1111);
      const hills = valueNoise(x / 170 + 31, 0x2222);
      const fine = valueNoise(x / 64 + 77, 0x3333);
      const h = 0.6 * broad + 0.3 * hills * rough + 0.1 * fine * rough;
      const shape = smooth((h - 0.36) / 0.34);
      return Math.max(0, reliefAt(x) * shape * flat);
    }

    /** Plateformes flottantes qui chevauchent [x0, x1]. */
    function platformsIn(x0, x1) {
      const out = [];
      const first = Math.max(0, Math.floor((x0 - 320) / PLATFORM_CELL));
      const last = Math.min(Math.floor(width / PLATFORM_CELL), Math.floor((x1 + 320) / PLATFORM_CELL));
      for (let k = first; k <= last; k++) {
        if (mix(seed ^ 0xa1, k) > 0.45) continue;
        const cx = k * PLATFORM_CELL + PLATFORM_CELL * (0.2 + 0.6 * mix(seed ^ 0xa2, k));
        if (cx < SPAWN_CLEAR + 260 || cx > width - 260) continue;
        const tiles = 3 + Math.floor(mix(seed ^ 0xa3, k) * 3); // 3 à 5 tuiles
        const w = tiles * TILE;
        const x = Math.round(cx - w / 2);
        // Au-dessus du point le plus haut du dessous, pour rester accessible.
        let highest = 0;
        for (let s = 0; s <= 4; s++) highest = Math.max(highest, offsetAt(x + (w * s) / 4));
        const rise = 74 + mix(seed ^ 0xa4, k) * 30; // franchissable en un saut
        const biome = biomeAt(cx);
        out.push({ id: "p" + k, x, w, offset: Math.round(highest + rise), biome: biome.id });
      }
      return out.filter((p) => p.x + p.w >= x0 && p.x <= x1);
    }

    /** Éléments de décor à dessiner dans [x0, x1], posés sur le sol. */
    function propsIn(x0, x1) {
      const out = [];
      const first = Math.max(0, Math.floor((x0 - 80) / PROP_CELL));
      const last = Math.min(Math.floor(width / PROP_CELL), Math.floor((x1 + 80) / PROP_CELL));
      for (let k = first; k <= last; k++) {
        const x = k * PROP_CELL + PROP_CELL * mix(seed ^ 0xb1, k);
        if (x < SPAWN_CLEAR - 40 || x > width - 40) continue;
        const biome = biomeAt(x);
        if (mix(seed ^ 0xb2, k) > biome.density) continue;
        const total = biome.props.reduce((sum, entry) => sum + entry[1], 0);
        let roll = mix(seed ^ 0xb3, k) * total;
        let kind = biome.props[0][0];
        for (const [name, weight] of biome.props) {
          if (roll < weight) {
            kind = name;
            break;
          }
          roll -= weight;
        }
        out.push({
          id: k,
          kind,
          biome: biome.id,
          x,
          offset: offsetAt(x),
          scale: 0.8 + mix(seed ^ 0xb4, k) * 0.5,
          flip: mix(seed ^ 0xb5, k) < 0.5 ? -1 : 1,
          variant: Math.floor(mix(seed ^ 0xb6, k) * 3),
        });
      }
      return out;
    }

    /**
     * Surface sur laquelle un personnage tombant vient de se poser, ou null.
     * cx : centre horizontal ; before / now : hauteur des pieds avant et après
     * le pas de simulation ; baseY : ligne de base de l'écran.
     */
    function landingTop(cx, before, now, baseY) {
      let best = null;
      const consider = (top) => {
        const crossing = before <= top + 2 && now >= top;
        const inside = now >= top && now - top <= 24 && before > top; // pente montante
        if ((crossing || inside) && (best === null || top < best)) best = top;
      };
      consider(baseY - offsetAt(cx));
      platformsIn(cx - 1, cx + 1).forEach((p) => {
        if (cx >= p.x && cx <= p.x + p.w) consider(baseY - p.offset);
      });
      return best;
    }

    /** Surface la plus proche des pieds (marche sur le relief), ou null. */
    function supportTop(cx, feet, baseY) {
      let best = null;
      let bestDistance = Infinity;
      const consider = (top) => {
        const distance = Math.abs(top - feet);
        if (distance <= STEP && distance < bestDistance) {
          best = top;
          bestDistance = distance;
        }
      };
      consider(baseY - offsetAt(cx));
      platformsIn(cx - 1, cx + 1).forEach((p) => {
        if (cx >= p.x && cx <= p.x + p.w) consider(baseY - p.offset);
      });
      return best;
    }

    return {
      seed: text,
      width,
      bands: bands.map((band) => ({ biome: band.biome.id, start: band.start, end: band.end })),
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
    constants: Object.freeze({ DEFAULT_SEED, STEP, TILE, BLEND, SPAWN_CLEAR, PRAIRIE_LENGTH }),
    hashString,
    mix,
    generator,
  };
})();
