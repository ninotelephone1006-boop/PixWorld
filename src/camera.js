/**
 * PixWorld — caméra 2,5D à 4 directions, façon RPG pixel art.
 *
 * Le plan de jeu reste le monde 2D existant (z = 0) : minage, collisions,
 * sauts et visée ne changent pas. Les flèches visent l'un des quatre azimuts
 * (sud, est, nord, ouest) ; l'angle s'interpolé pour tourner en douceur.
 *
 * Projection oblique (cabinet 3/4) : la face avant d'un bloc, sur z = 0,
 * retombe exactement sur l'ancien repère écran (x - camX, y - camY) tant
 * que l'on regarde vers le sud. Les faces supérieure et latérale, ainsi
 * qu'une extrusion visuelle en z, donnent le relief « comme les anciens
 * Pokémon » sans déplacer les clics ni les collisions.
 *
 * Quand le joueur creuse, les blocs situés au-dessus de lui s'estompent
 * puis récupèrent leur opacité dès qu'il s'éloigne.
 *
 *   const look = PixWorldCamera.create();
 *   look.setFacingByArrow("ArrowRight");
 *   look.update(delta);
 *   look.updateOcclusion({ column, row, underground }, delta);
 *   look.project(x, y, z, view);   // → { x, y, depth }
 */
window.PixWorldCamera = (() => {
  "use strict";

  const TAU = Math.PI * 2;
  const TURN_SPEED = 9.5; // rad/s : un quart de tour se pose en ~0,45 s
  const SNAP_ANGLE = 0.02;
  // Contribution de la profondeur (z) à l'écran : 3/4 pixel art.
  const PITCH_K = 0.22;
  const OBLIQUE_K = 0.28;
  // Extrusion visuelle nord-sud, uniquement hors vue sud (sinon identité).
  const Z_EXTENT = 6;
  const OCCLUSION_RADIUS = 5;
  const OCCLUSION_FADE = 6.5; // vitesse de l'estompage / du retour
  const OCCLUSION_MIN = 0.16;

  const FACINGS = Object.freeze([
    Object.freeze({ id: "south", name: "Sud", yaw: 0, arrow: "ArrowDown" }),
    Object.freeze({ id: "east", name: "Est", yaw: Math.PI / 2, arrow: "ArrowRight" }),
    Object.freeze({ id: "north", name: "Nord", yaw: Math.PI, arrow: "ArrowUp" }),
    Object.freeze({ id: "west", name: "Ouest", yaw: -Math.PI / 2, arrow: "ArrowLeft" }),
  ]);

  const ARROW_TO_FACING = Object.freeze({
    ArrowDown: 0,
    ArrowRight: 1,
    ArrowUp: 2,
    ArrowLeft: 3,
  });

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
    const index = FACINGS.findIndex((item) => item.id === id);
    return index < 0 ? 0 : index;
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
      return FACINGS[facing] || FACINGS[0];
    }

    function setFacing(index) {
      const next = ((Number(index) || 0) % FACINGS.length + FACINGS.length) % FACINGS.length;
      facing = next;
      targetYaw = FACINGS[next].yaw;
    }

    function setFacingById(id) {
      setFacing(facingIndex(id));
    }

    function setFacingByArrow(code) {
      if (!Object.prototype.hasOwnProperty.call(ARROW_TO_FACING, code)) return false;
      setFacing(ARROW_TO_FACING[code]);
      return true;
    }

    function reset() {
      facing = 0;
      yaw = 0;
      targetYaw = 0;
      alphas.clear();
      underground = false;
    }

    function update(delta) {
      const dt = Math.max(0, Number(delta) || 0);
      const k = 1 - Math.exp(-TURN_SPEED * dt);
      yaw = lerpAngle(yaw, targetYaw, k);
      if (Math.abs(normalizeAngle(yaw - targetYaw)) < SNAP_ANGLE) yaw = targetYaw;
    }

    function isIdentity() {
      return Math.abs(normalizeAngle(yaw)) < SNAP_ANGLE;
    }

    /**
     * Repère écran d'un point monde. z = 0 et yaw = 0 reproduisent
     * exactement (x - camX, y - camY).
     */
    function project(worldX, worldY, worldZ, view) {
      const camX = Number(view && view.camX) || 0;
      const camY = Number(view && view.camY) || 0;
      const focusX = view && view.focusX != null ? Number(view.focusX) : camX;
      const focusY = view && view.focusY != null ? Number(view.focusY) : camY;
      const x = Number(worldX) || 0;
      const y = Number(worldY) || 0;
      const z = Number(worldZ) || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const relX = x - focusX;
      const relY = y - focusY;
      const alongRight = relX * c + z * s;
      const alongFwd = -relX * s + z * c;
      return {
        x: alongRight - alongFwd * OBLIQUE_K + (focusX - camX),
        y: relY + alongFwd * PITCH_K + (focusY - camY),
        depth: alongFwd,
      };
    }

    /** Inverse de project() dans le plan z = 0 (visée, minage). */
    function unproject(screenX, screenY, view) {
      const camX = Number(view && view.camX) || 0;
      const camY = Number(view && view.camY) || 0;
      const focusX = view && view.focusX != null ? Number(view.focusX) : camX;
      const focusY = view && view.focusY != null ? Number(view.focusY) : camY;
      const sx = Number(screenX) || 0;
      const sy = Number(screenY) || 0;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const originX = focusX - camX;
      const originY = focusY - camY;
      // sx = relX * c - alongFwd * OBLIQUE + originX, alongFwd = -relX * s
      // sx = relX * c + relX * s * OBLIQUE + originX
      const denom = c + s * OBLIQUE_K;
      let relX;
      if (Math.abs(denom) < 0.12) {
        // Profil est/ouest : x devient de la profondeur, on le laisse au focus.
        relX = 0;
      } else {
        relX = (sx - originX) / denom;
      }
      const alongFwd = -relX * s;
      const relY = sy - originY - alongFwd * PITCH_K;
      return { x: relX + focusX, y: relY + focusY, z: 0 };
    }

    /**
     * Bloc dont la face projetée contient le pixel écran. Sert quand la
     * caméra n'est plus de profil sud (le simple unproject suffit sinon).
     */
    function pickSolid(screenX, screenY, view) {
      const size = Math.max(1, Number(view && view.blockSize) || 48);
      const baseY = Number(view && view.baseY) || 0;
      const getBlock = view && view.getBlock;
      if (typeof getBlock !== "function") return null;
      const focusX = view.focusX != null ? Number(view.focusX) : 0;
      const focusY = view.focusY != null ? Number(view.focusY) : baseY;
      const pc = Math.floor(focusX / size);
      const pr = Math.floor((focusY - baseY) / size);
      let best = null;
      let bestDepth = -Infinity;
      for (let row = pr - 10; row <= pr + 10; row++) {
        for (let column = pc - 12; column <= pc + 12; column++) {
          const block = getBlock(column, row);
          if (!block) continue;
          const corners = [
            project(block.x, block.y, 0, view),
            project(block.x + size, block.y, 0, view),
            project(block.x, block.y + size, 0, view),
            project(block.x + size, block.y + size, 0, view),
            project(block.x, block.y, -size, view),
            project(block.x + size, block.y, -size, view),
          ];
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          let depth = 0;
          for (let i = 0; i < corners.length; i++) {
            const p = corners[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
            depth += p.depth;
          }
          depth /= corners.length;
          if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
            if (depth > bestDepth) {
              bestDepth = depth;
              best = block;
            }
          }
        }
      }
      return best;
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
      return isIdentity() ? 0 : Z_EXTENT;
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
