/**
 * PixWorld — herbe interactive.
 *
 * Les touffes posées sur le sol (décor de src/game.js) réagissent au passage
 * des personnages : elles se courbent dans le sens de la marche, reviennent
 * avec un léger rebond, font un froissement et, parfois, projettent quelques
 * brins. Ce module ne dessine rien et ne joue aucun son : il calcule l'état
 * des touffes et signale les événements à src/game.js, qui les traduit en
 * sons spatialisés et en particules.
 *
 *   const grass = PixWorldGrass.create({ onRustle, onBlades });
 *   grass.update(delta, [{ id, x, width, vx, gap }]);   // coordonnées monde
 *   const pose = grass.poseFor(tile);                    // null au repos
 *
 * Coordonnées monde : une tuile de sol fait 64 px et la touffe occupe ses
 * 48 px centraux. `gap` est la hauteur des pieds au-dessus du sol (0 = posé).
 */
window.PixWorldGrass = (() => {
  "use strict";

  const TILE = 64; // largeur d'une tuile de sol (tileSize × tileScale dans game.js)
  const TUFT_INSET = 8; // la touffe est centrée dans sa tuile…
  const TUFT_WIDTH = 48; // …sur 16 px de feuille, à l'échelle 3
  const TUFT_VARIANTS = 2; // deux touffes dans la feuille de tuiles
  const TUFT_CHANCE = 0.2; // une tuile sur cinq porte une touffe

  const CONTACT_GAP = 14; // pieds plus haut que ça : le personnage saute au-dessus
  const CONTACT_MARGIN = 8; // la touffe réagit un peu avant que le corps la touche
  const MIN_SPEED = 25; // px/s : une marche trop lente ne bouge pas l'herbe
  const WALK_SPEED = 340; // vitesse de marche de référence (courbure maximale)
  const MAX_LEAN = 11; // courbure de la pointe à pleine vitesse, en px
  const ENTRY_KICK = 60; // petit coup de vent à l'entrée dans la touffe, px/s
  const OMEGA = 2 * Math.PI * 2.4; // fréquence propre du ressort, rad/s
  const ZETA = 0.45; // amortissement : un léger rebond au retour
  const SUBSTEPS = 2; // sous-pas d'intégration, pour rester stable
  const RUSTLE_MIN_SPEED = 80; // px/s : en dessous, pas de froissement (l'herbe plie seulement)
  const RUSTLE_COOLDOWN = 0.16; // délai minimal entre deux froissements d'une même touffe…
  const RUSTLE_JITTER = 0.08; // …à pleine vitesse ; il s'allonge quand on marche doucement
  const BLADE_CHANCE = 0.35; // part des froissements accompagnés de brins
  const REST_BEND = 0.05; // en dessous, la touffe est revenue au repos…
  const REST_SPEED = 0.5; // …et on peut l'oublier
  const RIPPLE_SPEED = 14; // rad/s : vitesse de l'ondulation qui parcourt les brins
  const AGITATION_SPEED = 90; // px/s : vitesse de la pointe pour une agitation maximale

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Même hachage que le décor de src/game.js : la pose des touffes ne change pas. */
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Touffe posée sur la tuile `tile` (index de tuile, pas de pixels), ou null.
   * `variant` désigne la touffe de la feuille de tuiles (0 ou 1).
   */
  function tuftFor(tile) {
    if (hash(tile + 999) >= TUFT_CHANCE) return null;
    return {
      tile,
      variant: Math.floor(hash(tile + 777) * TUFT_VARIANTS),
      x0: tile * TILE + TUFT_INSET,
      x1: tile * TILE + TUFT_INSET + TUFT_WIDTH,
    };
  }

  function create(options) {
    const settings = options || {};
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const onRustle = settings.onRustle || (() => {});
    const onBlades = settings.onBlades || (() => {});
    const states = new Map(); // tuile → ressort, seulement pour les touffes non revenues au repos
    let clock = 0;

    /** Sens, vitesse et force d'un personnage posé ou presque sur le sol, sinon null. */
    function contactOf(walker) {
      const gap = Number(walker.gap) || 0;
      if (gap > CONTACT_GAP) return null;
      const vx = Number(walker.vx) || 0;
      const speed = Math.abs(vx);
      if (speed < MIN_SPEED) return null;
      return {
        walkerId: walker.id,
        speed,
        dir: vx < 0 ? -1 : 1,
        strength: clamp(speed / WALK_SPEED, 0, 1),
      };
    }

    /**
     * Fait avancer l'herbe d'une image. walkers : personnages en monde
     * (x = bord gauche, width, vx en px/s, gap en px).
     */
    function update(delta, walkers) {
      const dt = clamp(Number(delta) || 0, 0, 0.05);
      clock += dt;
      const touched = new Map(); // tuile → contact retenu pour cette image

      (walkers || []).forEach((walker) => {
        const contact = contactOf(walker);
        if (!contact) return;
        const reach = CONTACT_MARGIN;
        const first = Math.floor((walker.x - reach - TUFT_INSET - TUFT_WIDTH) / TILE);
        const last = Math.floor((walker.x + walker.width + reach - TUFT_INSET) / TILE);
        for (let tile = first; tile <= last; tile++) {
          const tuft = tuftFor(tile);
          if (!tuft) continue;
          if (walker.x + walker.width < tuft.x0 - reach || walker.x > tuft.x1 + reach) continue;
          // Si plusieurs personnages touchent la même touffe, le plus rapide la mène.
          const previous = touched.get(tile);
          if (!previous || contact.strength > previous.strength) touched.set(tile, contact);
        }
      });

      // Les touffes que plus personne ne touche retrouvent leur position de repos.
      states.forEach((state, tile) => {
        if (!touched.has(tile)) {
          state.target = 0;
          state.touching = false;
        }
      });
      touched.forEach((contact, tile) => {
        let state = states.get(tile);
        if (!state) {
          state = { bend: 0, vel: 0, target: 0, touching: false, cooldown: 0, wave: 0 };
          states.set(tile, state);
        }
        // Premier contact : petit coup de vent dans le sens de la marche.
        if (!state.touching) state.vel += contact.dir * ENTRY_KICK * contact.strength;
        state.touching = true;
        state.target = contact.dir * MAX_LEAN * contact.strength;
      });

      // Ressort amorti : la pointe suit la cible en oscillant légèrement.
      const h = dt / SUBSTEPS;
      const stiffness = OMEGA * OMEGA;
      const damping = 2 * ZETA * OMEGA;
      states.forEach((state, tile) => {
        for (let i = 0; i < SUBSTEPS; i++) {
          const accel = stiffness * (state.target - state.bend) - damping * state.vel;
          state.vel += accel * h;
          state.bend += state.vel * h;
        }
        // L'ondulation suit l'agitation réelle de la touffe, en douceur.
        const agitation = clamp(Math.abs(state.vel) / AGITATION_SPEED, 0, 1);
        state.wave += (agitation - state.wave) * Math.min(1, dt * 6);

        state.cooldown -= dt;
        const contact = touched.get(tile);
        if (contact && contact.speed >= RUSTLE_MIN_SPEED && state.cooldown <= 0) {
          const pace = clamp(contact.strength, 0.4, 1);
          state.cooldown = (RUSTLE_COOLDOWN + random() * RUSTLE_JITTER) / pace;
          const event = {
            tile,
            x: tile * TILE + TUFT_INSET + TUFT_WIDTH / 2,
            walkerId: contact.walkerId,
            speed: contact.speed,
            dir: contact.dir,
            strength: contact.strength,
          };
          onRustle(event);
          if (random() < BLADE_CHANCE) onBlades(event);
        }
      });

      states.forEach((state, tile) => {
        if (!state.touching && Math.abs(state.bend) < REST_BEND && Math.abs(state.vel) < REST_SPEED) {
          states.delete(tile);
        }
      });
    }

    /**
     * Pose d'une touffe en mouvement : lean (déviation de la pointe, px),
     * wave (agitation 0 à 1) et phase de l'ondulation. null si elle est au repos.
     */
    function poseFor(tile) {
      const state = states.get(tile);
      if (!state) return null;
      return { lean: state.bend, wave: state.wave, phase: clock * RIPPLE_SPEED + tile * 2.1 };
    }

    return {
      update,
      poseFor,
      clear() {
        states.clear();
      },
      get activeCount() {
        return states.size;
      },
    };
  }

  return {
    create,
    tuftFor,
    constants: Object.freeze({
      TILE,
      TUFT_INSET,
      TUFT_WIDTH,
      TUFT_VARIANTS,
      MAX_LEAN,
      CONTACT_GAP,
      MIN_SPEED,
      RUSTLE_MIN_SPEED,
    }),
  };
})();
