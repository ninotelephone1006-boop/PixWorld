/**
 * PixWorld — terrain en blocs carrés (minage 2D).
 *
 * Le sol est une grille de blocs carrés de BLOCK px, alignés sur la surface.
 * De haut en bas :
 *   - 1 couche d'herbe (la surface) ;
 *   - 4 couches de terre ;
 *   - 10 couches de pierre ;
 *   - 1 couche de roche-mère incassable, qui ferme le monde par le bas : sans
 *     elle, un personnage qui creuse jusqu'au bout tomberait dans le vide.
 *
 * Un bloc mesure la moitié de la hauteur du héros : deux blocs = 60 px.
 * Le terrain est généré par couches et ne stocke que les blocs minés.
 *
 * Repère : `col` = colonne (x monde / BLOCK), `row` = ligne. La profondeur
 * croît vers le bas, comme l'écran ; la surface est à 0. `feet` = profondeur
 * des pieds (négatif = dans l'air). Une boîte de collision est
 * { x, feet, width, height } : x = bord gauche, feet = bord bas, en px monde.
 * Ce module ne dessine rien : src/block-view.js s'en charge.
 *
 *   const terrain = PixWorldTerrain.create({ width: world.width });
 *   terrain.typeAt(col, row);   // "grass" | "dirt" | "stone" | "bedrock", ou null (air)
 *   terrain.breakAt(col, row);  // casse un bloc cassable ; renvoie son type, ou null
 *   terrain.move(box, dx, dy);  // déplacement avec collisions
 *   terrain.isSupported(box);   // un bloc solide est-il posé sous les pieds ?
 */
window.PixWorldTerrain = (() => {
  "use strict";

  const BLOCK = 30; // taille d'un bloc (px) : deux blocs = la hauteur du héros (60 px)
  const EPS = 0.01; // tolérance des contacts, pour ne jamais se coincer dans un bloc
  const STEP = 2; // pas de déplacement (px) : un personnage ne traverse jamais un bloc
  const PROBE = 1; // on sonde 1 px sous les pieds pour savoir si l'on est posé

  /** Couches du haut vers le bas. */
  const LAYERS = Object.freeze([
    Object.freeze({ type: "grass", rows: 1 }),
    Object.freeze({ type: "dirt", rows: 4 }),
    Object.freeze({ type: "stone", rows: 10 }),
    Object.freeze({ type: "bedrock", rows: 1 }),
  ]);
  const ROW_TYPES = Object.freeze(LAYERS.flatMap((layer) => Array.from({ length: layer.rows }, () => layer.type)));
  const ROWS = ROW_TYPES.length; // 16 lignes
  const DEPTH = ROWS * BLOCK; // 480 px sous la surface
  const BREAKABLE = Object.freeze({ grass: true, dirt: true, stone: true, bedrock: false });
  const DEFAULT_WIDTH = 100000;

  function create(options) {
    const settings = options || {};
    const width = Number(settings.width) > 0 ? Number(settings.width) : DEFAULT_WIDTH;
    const columns = Math.ceil(width / BLOCK);
    const mined = new Set(); // blocs minés, repérés par col * ROWS + row

    /**
     * Type du bloc à cette case, ou null pour l'air. Au-dessus de la surface :
     * air. Sous la dernière couche et hors des bords du monde : roche-mère.
     */
    function typeAt(col, row) {
      if (row < 0) return null;
      if (row >= ROWS || col < 0 || col >= columns) return "bedrock";
      if (mined.has(col * ROWS + row)) return null;
      return ROW_TYPES[row];
    }

    /** Casse le bloc s'il est cassable. Renvoie son type, ou null. */
    function breakAt(col, row) {
      const type = typeAt(col, row);
      if (!type || !BREAKABLE[type]) return null;
      mined.add(col * ROWS + row);
      return type;
    }

    /** Case qui contient le point (x monde, profondeur). */
    function cellAt(x, depth) {
      return { col: Math.floor(x / BLOCK), row: Math.floor(depth / BLOCK) };
    }

    /** Centre d'une case, en px monde (x) et en profondeur (y). */
    function centerOf(col, row) {
      return { x: (col + 0.5) * BLOCK, y: (row + 0.5) * BLOCK };
    }

    /** Un bloc solide touche-t-il le rectangle ouvert (left, top)-(right, bottom) ? */
    function overlapsSolid(left, top, right, bottom) {
      const c0 = Math.floor((left + EPS) / BLOCK);
      const c1 = Math.floor((right - EPS) / BLOCK);
      const r0 = Math.floor((top + EPS) / BLOCK);
      const r1 = Math.floor((bottom - EPS) / BLOCK);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          if (typeAt(col, row) !== null) return true;
        }
      }
      return false;
    }

    /**
     * Déplace la boîte de (dx, dy) px en s'arrêtant contre les blocs solides.
     * Renvoie { x, feet, hitX, hitY, landed } : hitX = mur rencontré,
     * hitY = sol ou plafond rencontré, landed = posé sur un bloc en tombant.
     * Le déplacement se fait par pas de STEP px, puis la position est calée
     * exactement sur la face du bloc touché.
     */
    function move(box, dx, dy) {
      const w = box.width;
      const h = box.height;
      let x = box.x;
      let feet = box.feet;
      let hitX = false;
      let hitY = false;
      let landed = false;

      let across = Number(dx) || 0;
      while (Math.abs(across) > 1e-9) {
        const step = Math.sign(across) * Math.min(Math.abs(across), STEP);
        const nx = x + step;
        if (overlapsSolid(nx, feet - h, nx + w, feet)) {
          // Mur : on se cale contre la face du bloc.
          hitX = true;
          x = step > 0
            ? Math.floor((nx + w - EPS) / BLOCK) * BLOCK - w
            : (Math.floor((nx + EPS) / BLOCK) + 1) * BLOCK;
          break;
        }
        x = nx;
        across -= step;
      }

      let vertical = Number(dy) || 0;
      while (Math.abs(vertical) > 1e-9) {
        const step = Math.sign(vertical) * Math.min(Math.abs(vertical), STEP);
        const nf = feet + step;
        if (overlapsSolid(x, nf - h, x + w, nf)) {
          hitY = true;
          if (step > 0) {
            // Sol : on se pose exactement sur le haut du bloc.
            feet = Math.floor((nf - EPS) / BLOCK) * BLOCK;
            landed = true;
          } else {
            // Plafond : la tête s'arrête sous le bloc.
            feet = (Math.floor((nf - h + EPS) / BLOCK) + 1) * BLOCK + h;
          }
          break;
        }
        feet = nf;
        vertical -= step;
      }
      return { x, feet, hitX, hitY, landed };
    }

    /** Vrai si la boîte repose sur au moins un bloc solide. */
    function isSupported(box) {
      return overlapsSolid(box.x, box.feet - box.height + PROBE, box.x + box.width, box.feet + PROBE);
    }

    return {
      block: BLOCK,
      rows: ROWS,
      depth: DEPTH,
      columns,
      width,
      typeAt,
      breakAt,
      cellAt,
      centerOf,
      overlapsSolid,
      move,
      isSupported,
      isSolid(col, row) {
        return typeAt(col, row) !== null;
      },
      isBreakable(col, row) {
        const type = typeAt(col, row);
        return Boolean(type && BREAKABLE[type]);
      },
      get minedCount() {
        return mined.size;
      },
    };
  }

  return {
    create,
    BLOCK,
    ROWS,
    DEPTH,
    constants: Object.freeze({ BLOCK, ROWS, DEPTH, EPS, STEP, LAYERS, ROW_TYPES, BREAKABLE, DEFAULT_WIDTH }),
  };
})();
