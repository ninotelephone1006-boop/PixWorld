/**
 * PixWorld — vue 2,5D pixel art (vue de base / cubes 3/4).
 *
 * Le plan de jeu reste le monde 2D existant (z = 0) : minage, collisions,
 * sauts et visée ne changent pas. Seule la vue de base (face sud, repère écran
 * x - camX, y - camY) est conservée : les autres directions sont retirées.
 *
 * Projection oblique (cabinet 3/4) : les faces supérieure et latérale des
 * blocs donnent le relief « comme les anciens Pokémon » sans déplacer les
 * clics ni les collisions.
 *
 * Quand le joueur creuse, les blocs situés au-dessus de lui s'estompent
 * puis récupèrent leur opacité dès qu'il s'éloigne.
 *
 *   const look = PixWorldCamera.create();
 *   look.update(delta);
 *   look.updateOcclusion({ column, row, underground }, delta);
 *   look.project(x, y, z, view);   // → { x, y, depth }
 */
window.PixWorldCamera = (() => {
  "use strict";

  const TAU = Math.PI * 2;
  const TURN_SPEED = 9.5;
  const SNAP_ANGLE = 0.02;
  // Contribution de la profondeur (z) à l'écran : 3/4 pixel art en vue de base.
  const PITCH_K = 0.22;
  const OBLIQUE_K = 0.28;
  const Z_EXTENT = 0;
  const OCCLUSION_RADIUS = 5;
  const OCCLUSION_FADE = 6.5; // vitesse de l'estompage / du retour
  const OCCLUSION_MIN = 0.16;

  // Seule la vue de base (sud, repère identité) est conservée.
  const FACINGS = Object.freeze([
    Object.freeze({ id: "south", name: "Sud", yaw: 0 }),
  ]);

  const ARROW_TO_FACING = Object.freeze({});

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Ramène un angle dans ]-π, π]. */
  function normalizeAngle(angle) {
    const value = Number(angle) || 0;
    let wrapped = (value + Math.PI) % TAU;
    if (wrapped < 0) wrapped += TAU;
    return wrapped - Math.PI;
  }

  function lerpAngle(from, to, t) {
    const k = clamp(t, 0, 1);
    return from + normalizeAngle(to - from) * k;
  }

  function facingIndex(id) {
    return 0;
  }

  /**
   * Opacité cible d'un bloc : les cellules au-dessus du joueur, et assez
   * proches, s'effacent pour le laisser visible sous terre.
   */
  function occlusionTarget(column, row, zTile, playerCol, playerRow, underground) {
    if (!underground || playerRow < 1) return 1;
    if (!Number.isFinite(column) || !Number.isFinite(row)) return 1;
    const colDist = Math.abs(column - playerCol);
    const zDist = Math.abs(zTile || 0);
    if (colDist > OCCLUSION_RADIUS && zDist > 2) return 1;
    // Au niveau du joueur ou plus bas : on garde le sol sous ses pieds.
    if (row > playerRow) return 1;
    const near = clamp(1 - colDist / (OCCLUSION_RADIUS + 0.5), 0, 1) *
      clamp(1 - zDist / 3.5, 0, 1);
    if (near <= 0) return 1;
    // Plus le bloc est juste au-dessus, plus il gène.
    const above = row < playerRow;
    const cover = above
      ? 0.55 + 0.45 * clamp(1 - (playerRow - row - 1) / 7, 0, 1)
      : 0.28;
    // Premier plan visuel (z > 0) : il se dresse entre la caméra et le héros.
    const front = (zTile || 0) > 0 ? 1 : 0.85;
    return clamp(1 - near * cover * front, OCCLUSION_MIN, 1);
  }

  function create() {
    let facing = 0;
    let yaw = 0;
    let targetYaw = 0;
    const alphas = new Map();
    let playerCol = 0;
    let playerRow = 0;
    let underground = false;

    function currentFacing() {
      return FACINGS[0];
    }

    function setFacing(index) {
      facing = 0;
      targetYaw = 0;
      yaw = 0;
    }

    function setFacingById(id) {
      setFacing(0);
    }

    function setFacingByArrow(code) {
      // Les autres vues sont retirées : les flèches ne tournent plus la caméra.
      return false;
    }

    function reset() {
      facing = 0;
      yaw = 0;
      targetYaw = 0;
      alphas.clear();
      underground = false;
    }

    function update(delta) {
      yaw = 0;
    }

    function isIdentity() {
      return true;
    }

    /**
     * Repère écran d'un point monde en vue de base.
     * Pour z = 0, produit exactement (x - camX, y - camY).
     */
    function project(worldX, worldY, worldZ, view) {
      const camX = Number(view && view.camX) || 0;
      const camY = Number(view && view.camY) || 0;
      const x = Number(worldX) || 0;
      const y = Number(worldY) || 0;
      const z = Number(worldZ) || 0;
      return {
        x: x - camX - z * OBLIQUE_K,
        y: y - camY + z * PITCH_K,
        depth: z,
      };
    }

    /** Inverse de project() dans le plan z = 0 (visée, minage). */
    function unproject(screenX, screenY, view) {
      const camX = Number(view && view.camX) || 0;
      const camY = Number(view && view.camY) || 0;
      const sx = Number(screenX) || 0;
      const sy = Number(screenY) || 0;
      return { x: sx + camX, y: sy + camY, z: 0 };
    }

    /**
     * Bloc solide correspondant au pixel écran dans la vue de base.
     */
    function pickSolid(screenX, screenY, view) {
      const size = Math.max(1, Number(view && view.blockSize) || 48);
      const baseY = Number(view && view.baseY) || 0;
      const getBlock = view && view.getBlock;
      if (typeof getBlock !== "function") return null;
      const camX = Number(view && view.camX) || 0;
      const camY = Number(view && view.camY) || 0;
      const col = Math.floor((screenX + camX) / size);
      const row = Math.floor((screenY + camY - baseY) / size);
      return getBlock(col, row);
    }

    function alphaKey(column, row, zTile) {
      return column + "," + row + "," + (zTile || 0);
    }

    function updateOcclusion(info, delta) {
      const dt = Math.max(0, Number(delta) || 0);
      const data = info || {};
      playerCol = Number.isFinite(data.column) ? data.column : playerCol;
      playerRow = Number.isFinite(data.row) ? data.row : playerRow;
      underground = Boolean(data.underground);
      const rate = clamp(OCCLUSION_FADE * dt, 0, 1);
      const seen = new Set();
      if (underground) {
        const z0 = -2;
        const z1 = 2;
        for (let row = playerRow - 10; row <= playerRow + 1; row++) {
          for (let column = playerCol - OCCLUSION_RADIUS; column <= playerCol + OCCLUSION_RADIUS; column++) {
            for (let zTile = z0; zTile <= z1; zTile++) {
              const target = occlusionTarget(column, row, zTile, playerCol, playerRow, true);
              const key = alphaKey(column, row, zTile);
              seen.add(key);
              const current = alphas.has(key) ? alphas.get(key) : 1;
              const next = current + (target - current) * rate;
              if (next >= 0.995 && target >= 0.995) alphas.delete(key);
              else alphas.set(key, next);
            }
          }
        }
      }
      // Les blocs qu'on ne suit plus retrouvent leur opacité.
      alphas.forEach((value, key) => {
        if (seen.has(key)) return;
        const next = value + (1 - value) * rate;
        if (next >= 0.995) alphas.delete(key);
        else alphas.set(key, next);
      });
    }

    function alpha(column, row, zTile) {
      const key = alphaKey(column, row, zTile);
      if (!alphas.has(key)) return 1;
      return alphas.get(key);
    }

    function zExtent() {
      return 0;
    }

    return {
      update,
      reset,
      setFacing,
      setFacingById,
      setFacingByArrow,
      isIdentity,
      project,
      unproject,
      pickSolid,
      updateOcclusion,
      alpha,
      zExtent,
      get facing() { return facing; },
      get facingId() { return currentFacing().id; },
      get facingName() { return currentFacing().name; },
      get yaw() { return yaw; },
      get targetYaw() { return targetYaw; },
      get underground() { return underground; },
    };
  }

  return {
    create,
    FACINGS,
    occlusionTarget,
    normalizeAngle,
    lerpAngle,
    constants: Object.freeze({
      TURN_SPEED,
      PITCH_K,
      OBLIQUE_K,
      Z_EXTENT,
      OCCLUSION_RADIUS,
      OCCLUSION_MIN,
      SNAP_ANGLE,
    }),
  };
})();
