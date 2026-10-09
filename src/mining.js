/**
 * PixWorld — terrain minable, drops et inventaire de blocs.
 *
 * Le monde est une grille de colonnes infinies en largeur et de 15 couches :
 * une herbe, quatre terres, puis dix pierres. La simulation est indépendante
 * du Canvas afin de pouvoir être testée sans navigateur.
 */
window.PixWorldMining = (() => {
  "use strict";

  const BLOCK_SIZE = 30;
  const MINE_TIME = 2;
  const DROP_SIZE = 14;
  const DROP_GRAVITY = 250;
  const LAYER_TYPES = Object.freeze([
    "grass",
    "dirt", "dirt", "dirt", "dirt",
    "stone", "stone", "stone", "stone", "stone",
    "stone", "stone", "stone", "stone", "stone",
  ]);
  const BLOCKS = Object.freeze({
    grass: Object.freeze({ id: "grass", label: "Herbe", image: "assets/blocks/grass.png", base: "#bf895c", detail: "#78c533" }),
    dirt: Object.freeze({ id: "dirt", label: "Terre", image: "assets/blocks/dirt.png", base: "#b98252", detail: "#8f5737" }),
    stone: Object.freeze({ id: "stone", label: "Pierre", image: "assets/blocks/stone.png", base: "#809196", detail: "#526168" }),
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const cellKey = (column, row) => column + "," + row;

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function create(options) {
    const config = options || {};
    const worldWidth = Math.max(BLOCK_SIZE, Number(config.worldWidth) || 100000);
    const blockSize = Math.max(1, Number(config.blockSize) || BLOCK_SIZE);
    const columns = Math.ceil(worldWidth / blockSize);
    const removed = new Set();
    const drops = new Map();
    const inventory = { grass: 0, dirt: 0, stone: 0 };

    function isInBounds(column, row) {
      return Number.isInteger(column) && Number.isInteger(row) &&
        column >= 0 && column < columns && row >= 0 && row < LAYER_TYPES.length;
    }

    function blockType(column, row) {
      if (!isInBounds(column, row) || removed.has(cellKey(column, row))) return null;
      return LAYER_TYPES[row] || null;
    }

    function getBlock(column, row, baseY) {
      const type = blockType(column, row);
      if (!type) return null;
      return {
        column,
        row,
        type,
        key: cellKey(column, row),
        x: column * blockSize,
        y: (Number(baseY) || 0) + row * blockSize,
        size: blockSize,
      };
    }

    function blockAt(worldX, worldY, baseY) {
      const x = Number(worldX);
      const y = Number(worldY);
      const base = Number(baseY) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || y < base) return null;
      const column = Math.floor(x / blockSize);
      const row = Math.floor((y - base) / blockSize);
      return getBlock(column, row, base);
    }

    function surfaceBlockAt(worldX, baseY) {
      const x = Number(worldX);
      if (!Number.isFinite(x) || x < 0 || x >= worldWidth) return null;
      const column = Math.floor(x / blockSize);
      for (let row = 0; row < LAYER_TYPES.length; row++) {
        const block = getBlock(column, row, baseY);
        if (block) return block;
      }
      return null;
    }

    function surfaceAt(worldX, baseY) {
      const block = surfaceBlockAt(worldX, baseY);
      return block ? block.y : null;
    }

    function supportTop(worldX, feet, baseY, stepHeight) {
      const top = surfaceAt(worldX, baseY);
      if (top === null) return null;
      const tolerance = stepHeight == null ? blockSize * 0.8 : Math.max(0, Number(stepHeight) || 0);
      return Math.abs(top - Number(feet)) <= tolerance ? top : null;
    }

    function landingTop(worldX, before, now, baseY) {
      const oldFeet = Number(before);
      const newFeet = Number(now);
      if (!Number.isFinite(oldFeet) || !Number.isFinite(newFeet) || newFeet < oldFeet) return null;
      const top = surfaceAt(worldX, baseY);
      if (top === null) return null;
      return oldFeet <= top + 2 && newFeet >= top ? top : null;
    }

    function makeDrop(column, row, type, data) {
      const id = String(data.id || data.dropId || "local:" + column + ":" + row);
      const seed = hashText(id + ":" + column + ":" + row);
      const ownerId = data.ownerId == null ? null : String(data.ownerId);
      return {
        id,
        column,
        row,
        type,
        ownerId,
        networked: data.networked == null ? ownerId !== null && id.indexOf("local:") !== 0 : Boolean(data.networked),
        x: (column + 0.5) * blockSize,
        depth: row * blockSize - DROP_SIZE * 0.42,
        vx: ((seed & 255) / 255 - 0.5) * 82,
        vy: -42 - ((seed >>> 8) % 34),
        age: 0,
        phase: ((seed >>> 16) % 628) / 100,
        pending: false,
      };
    }

    function breakBlock(column, row, data) {
      const block = getBlock(Number(column), Number(row), data && data.baseY);
      if (!block) return null;
      removed.add(block.key);
      const settings = data || {};
      let drop = null;
      if (settings.createDrop !== false) {
        drop = makeDrop(block.column, block.row, block.type, settings);
        drops.set(drop.id, drop);
      }
      return { ...block, drop: drop ? { ...drop } : null };
    }

    function applyState(state) {
      const snapshot = state || {};
      const mined = Array.isArray(snapshot.mined) ? snapshot.mined : Array.isArray(snapshot.removed) ? snapshot.removed : [];
      mined.forEach((cell) => {
        const column = Array.isArray(cell) ? Number(cell[0]) : Number(cell && cell.column);
        const row = Array.isArray(cell) ? Number(cell[1]) : Number(cell && cell.row);
        if (isInBounds(column, row)) removed.add(cellKey(column, row));
      });

      const active = Array.isArray(snapshot.drops) ? snapshot.drops : [];
      const activeIds = new Set();
      active.forEach((item) => {
        if (!item || typeof item.id !== "string") return;
        const column = Number(item.column);
        const row = Number(item.row);
        if (!isInBounds(column, row)) return;
        const type = LAYER_TYPES[row];
        const id = String(item.id).slice(0, 80);
        activeIds.add(id);
        removed.add(cellKey(column, row));
        if (!drops.has(id)) {
          drops.set(id, makeDrop(column, row, type, { id, ownerId: item.ownerId, networked: true }));
        }
      });
      // Un drop réseau absent de l'état serveur a déjà été ramassé ailleurs.
      drops.forEach((drop, id) => {
        if (drop.networked && !activeIds.has(id)) drops.delete(id);
        else drop.pending = false;
      });
    }

    function clearPendingClaims() {
      drops.forEach((drop) => { drop.pending = false; });
    }

    function updateDrops(delta) {
      const dt = clamp(Number(delta) || 0, 0, 0.05);
      drops.forEach((drop, id) => {
        const previousDepth = drop.depth;
        drop.age += dt;
        drop.phase += dt * 3.4;
        drop.x = clamp(drop.x + drop.vx * dt, 0, worldWidth - 1);
        drop.vx *= Math.exp(-1.8 * dt);
        drop.depth += drop.vy * dt;
        drop.vy += DROP_GRAVITY * dt;

        // Les petits cubes rebondissent sur la première surface solide atteinte.
        const surface = surfaceAt(drop.x, 0);
        const previousBottom = previousDepth + DROP_SIZE / 2;
        const nextBottom = drop.depth + DROP_SIZE / 2;
        if (surface !== null && drop.vy > 0 && previousBottom <= surface && nextBottom >= surface) {
          drop.depth = surface - DROP_SIZE / 2;
          drop.vy = Math.abs(drop.vy) > 28 ? -Math.abs(drop.vy) * 0.16 : 0;
        }
        const worldBottom = LAYER_TYPES.length * blockSize;
        if (drop.depth + DROP_SIZE / 2 > worldBottom) {
          drop.depth = worldBottom - DROP_SIZE / 2;
          drop.vy = Math.abs(drop.vy) > 28 ? -Math.abs(drop.vy) * 0.16 : 0;
        }
        if (drop.age > 45) drops.delete(id);
      });
    }

    function overlaps(rect, drop, baseY) {
      if (!rect) return false;
      const cx = drop.x;
      const cy = (Number(baseY) || 0) + drop.depth + Math.sin(drop.phase) * 1.5;
      const half = DROP_SIZE / 2;
      return cx + half >= Number(rect.x) && cx - half <= Number(rect.x) + Number(rect.width) &&
        cy + half >= Number(rect.y) && cy - half <= Number(rect.y) + Number(rect.height);
    }

    function findTouchedDrops(rect, baseY) {
      const touched = [];
      drops.forEach((drop) => {
        if (!drop.pending && overlaps(rect, drop, baseY)) touched.push({ ...drop });
      });
      return touched;
    }

    function markDropPending(id) {
      const drop = drops.get(String(id));
      if (!drop || drop.pending) return false;
      drop.pending = true;
      return true;
    }

    function collectDrop(id) {
      const drop = drops.get(String(id));
      if (!drop) return null;
      drops.delete(drop.id);
      inventory[drop.type] += 1;
      return { ...drop };
    }

    function removeDrop(id) {
      const drop = drops.get(String(id));
      if (!drop) return null;
      drops.delete(drop.id);
      return { ...drop };
    }

    function collectTouchedLocalDrops(rect, baseY) {
      return findTouchedDrops(rect, baseY)
        .filter((drop) => !drop.networked)
        .map((drop) => collectDrop(drop.id))
        .filter(Boolean);
    }

    function getDrops() {
      return Array.from(drops.values(), (drop) => ({ ...drop }));
    }

    function drawFallbackBlock(ctx, type, x, y, size, column, row) {
      const palette = BLOCKS[type] || BLOCKS.stone;
      ctx.fillStyle = palette.base;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = palette.detail;
      const seed = hashText(column + ":" + row + ":" + type);
      for (let i = 0; i < 5; i++) {
        const px = x + 3 + ((seed >>> (i * 4)) % Math.max(1, size - 7));
        const py = y + 3 + ((seed >>> (i * 3 + 2)) % Math.max(1, size - 7));
        ctx.fillRect(px, py, 2 + (i % 2), 2);
      }
      if (type === "grass") {
        ctx.fillStyle = "#75c83a";
        ctx.fillRect(x, y, size, Math.max(5, Math.round(size * 0.24)));
      }
    }

    function drawTerrain(ctx, view, textures) {
      const width = Math.max(0, Number(view.width) || 0);
      const camX = Number(view.camX) || 0;
      const baseY = Number(view.baseY) || 0;
      const height = Number(view.height) || 0;
      const first = Math.max(0, Math.floor(camX / blockSize));
      const last = Math.min(columns, Math.ceil((camX + width) / blockSize) + 1);
      const images = textures || {};
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      for (let column = first; column < last; column++) {
        const screenX = column * blockSize - camX;
        for (let row = 0; row < LAYER_TYPES.length; row++) {
          const type = blockType(column, row);
          if (!type) continue;
          const y = baseY + row * blockSize;
          if (y > height || y + blockSize < 0) continue;
          const image = images[type];
          if (image && image.complete && image.naturalWidth > 0) {
            ctx.drawImage(image, screenX, y, blockSize, blockSize);
          } else {
            drawFallbackBlock(ctx, type, screenX, y, blockSize, column, row);
          }
          ctx.fillStyle = "rgba(20, 28, 30, 0.12)";
          ctx.fillRect(screenX + blockSize - 1, y, 1, blockSize);
          ctx.fillRect(screenX, y + blockSize - 1, blockSize, 1);
        }
      }
      ctx.restore();
    }

    function drawDrops(ctx, view, textures) {
      const camX = Number(view.camX) || 0;
      const baseY = Number(view.baseY) || 0;
      const time = Number(view.time) || 0;
      const images = textures || {};
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drops.forEach((drop) => {
        const x = drop.x - camX;
        const y = baseY + drop.depth + Math.sin(time * 4 + drop.phase) * 1.5;
        if (x < -DROP_SIZE || x > Number(view.width) + DROP_SIZE || y < -DROP_SIZE || y > Number(view.height) + DROP_SIZE) return;
        const image = images[drop.type];
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        ctx.rotate(Math.sin(time * 3 + drop.phase) * 0.08);
        ctx.globalAlpha = drop.pending ? 0.45 : 1;
        if (image && image.complete && image.naturalWidth > 0) {
          ctx.drawImage(image, -DROP_SIZE / 2, -DROP_SIZE / 2, DROP_SIZE, DROP_SIZE);
        } else {
          drawFallbackBlock(ctx, drop.type, -DROP_SIZE / 2, -DROP_SIZE / 2, DROP_SIZE, drop.column, drop.row);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.58)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-DROP_SIZE / 2 + 0.5, -DROP_SIZE / 2 + 0.5, DROP_SIZE - 1, DROP_SIZE - 1);
        ctx.restore();
      });
      ctx.restore();
    }

    function drawTarget(ctx, block, progress, camX) {
      if (!block) return;
      const x = Math.round(block.x - (Number(camX) || 0));
      const y = Math.round(block.y);
      const size = block.size || blockSize;
      const amount = clamp(Number(progress) || 0, 0, 1);
      ctx.save();
      ctx.shadowColor = amount > 0 ? "rgba(255, 194, 94, 0.85)" : "rgba(255, 255, 255, 0.72)";
      ctx.shadowBlur = 7;
      ctx.lineWidth = 2;
      ctx.strokeStyle = amount > 0 ? "#ffd16e" : "#ffffff";
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      ctx.shadowBlur = 0;
      if (amount > 0) {
        ctx.fillStyle = "rgba(18, 19, 18, " + (0.04 + amount * 0.18) + ")";
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.strokeStyle = "rgba(25, 22, 18, " + (0.35 + amount * 0.55) + ")";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.47, y + size * 0.18);
        ctx.lineTo(x + size * 0.56, y + size * 0.39);
        if (amount > 0.25) {
          ctx.lineTo(x + size * 0.38, y + size * 0.55);
          ctx.lineTo(x + size * 0.45, y + size * 0.74);
        }
        if (amount > 0.55) {
          ctx.moveTo(x + size * 0.56, y + size * 0.39);
          ctx.lineTo(x + size * 0.75, y + size * 0.48);
          ctx.lineTo(x + size * 0.81, y + size * 0.66);
        }
        if (amount > 0.8) {
          ctx.moveTo(x + size * 0.38, y + size * 0.55);
          ctx.lineTo(x + size * 0.2, y + size * 0.48);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    return {
      worldWidth,
      columns,
      blockSize,
      layerCount: LAYER_TYPES.length,
      totalHeight: LAYER_TYPES.length * blockSize,
      getBlock: (column, row, baseY) => getBlock(Number(column), Number(row), baseY),
      blockAt,
      blockType,
      surfaceBlockAt,
      surfaceAt,
      supportTop,
      landingTop,
      breakBlock,
      applyState,
      clearPendingClaims,
      updateDrops,
      findTouchedDrops,
      markDropPending,
      collectDrop,
      removeDrop,
      collectTouchedLocalDrops,
      getDrops,
      inventory: () => ({ ...inventory }),
      isRemoved: (column, row) => removed.has(cellKey(Number(column), Number(row))),
      drawTerrain,
      drawDrops,
      drawTarget,
    };
  }

  return {
    create,
    BLOCKS,
    constants: Object.freeze({
      BLOCK_SIZE,
      MINE_TIME,
      DROP_SIZE,
      DROP_GRAVITY,
      LAYER_TYPES,
      ROWS: LAYER_TYPES.length,
      TOTAL_HEIGHT: LAYER_TYPES.length * BLOCK_SIZE,
      STEP_HEIGHT: BLOCK_SIZE * 0.8,
    }),
  };
})();
