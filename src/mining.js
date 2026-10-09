/**
 * PixWorld — minage au clic maintenu.
 *
 * La souris désigne une case (src/game.js transmet la case survolée). Tant que
 * le clic gauche reste enfoncé, que la case est à portée du héros et qu'elle
 * contient un bloc cassable, la progression avance : elle atteint 1 au bout de
 * MINE_TIME secondes et le bloc se casse. Relâcher le bouton, viser une autre
 * case ou s'éloigner remet la progression à zéro.
 *
 *   const miner = PixWorldMining.create({ terrain, onBreak, onHit });
 *   miner.setHover({ col, row } | null);
 *   miner.setHolding(true | false);
 *   miner.update(delta, { x, y, enabled });  // (x, y) : centre du héros, en px monde / profondeur
 *   miner.state;  // { col, row, type, progress, inReach, breakable }
 */
window.PixWorldMining = (() => {
  "use strict";

  const MINE_TIME = 2; // secondes de clic maintenu pour casser un bloc
  const REACH_BLOCKS = 4.5; // portée, en blocs, entre le centre du héros et le bloc visé
  const HIT_INTERVAL = 0.25; // rythme des coups de pioche (son et particules), en secondes
  const MAX_DELTA = 0.05;

  function create(options) {
    const settings = options || {};
    const terrain = settings.terrain;
    if (!terrain) throw new Error("PixWorldMining.create : un terrain est requis");
    const block = terrain.block;
    const reach = REACH_BLOCKS * block;
    const onBreak = settings.onBreak || (() => {});
    const onHit = settings.onHit || (() => {});

    let hover = null; // case survolée : { col, row } ou null
    let holding = false;
    let progress = 0;
    let hitTimer = 0;
    let current = null; // identifiant de la case en cours de minage
    const state = { col: null, row: null, type: null, progress: 0, inReach: false, breakable: false };

    function clearProgress() {
      progress = 0;
      hitTimer = 0;
      current = null;
      state.progress = 0;
    }

    function setHover(cell) {
      hover = cell ? { col: cell.col, row: cell.row } : null;
    }

    function setHolding(flag) {
      holding = Boolean(flag);
      if (!holding) clearProgress();
    }

    /** Fait avancer le minage d'une image. origin : centre du héros et autorisation. */
    function update(delta, origin) {
      const dt = Math.min(Math.max(Number(delta) || 0, 0), MAX_DELTA);
      const cell = hover;
      const type = cell ? terrain.typeAt(cell.col, cell.row) : null;
      if (!cell || !type) {
        state.col = null;
        state.row = null;
        state.type = null;
        state.inReach = false;
        state.breakable = false;
        clearProgress();
        return state;
      }

      const center = terrain.centerOf(cell.col, cell.row);
      const inReach = Math.hypot(center.x - origin.x, center.y - origin.y) <= reach;
      const breakable = terrain.isBreakable(cell.col, cell.row);
      state.col = cell.col;
      state.row = cell.row;
      state.type = type;
      state.inReach = inReach;
      state.breakable = breakable;

      const id = cell.col + ":" + cell.row;
      if (id !== current) {
        current = id;
        progress = 0;
        hitTimer = 0;
      }
      if (!holding || !origin.enabled || !inReach || !breakable) {
        clearProgress();
        current = id;
        return state;
      }

      progress += dt / MINE_TIME;
      hitTimer -= dt;
      if (hitTimer <= 0) {
        hitTimer = HIT_INTERVAL;
        onHit({ col: cell.col, row: cell.row, type, progress });
      }
      if (progress >= 1) {
        const broken = terrain.breakAt(cell.col, cell.row);
        clearProgress();
        if (broken) onBreak({ col: cell.col, row: cell.row, type: broken });
      }
      state.progress = progress;
      return state;
    }

    return {
      setHover,
      setHolding,
      update,
      reset: clearProgress,
      get state() {
        return state;
      },
      get holding() {
        return holding;
      },
    };
  }

  return {
    create,
    constants: Object.freeze({ MINE_TIME, REACH_BLOCKS, HIT_INTERVAL }),
  };
})();
