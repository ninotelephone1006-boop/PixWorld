/**
 * PixWorld — terrain minable, blocs posables, collisions, drops et inventaire.
 *
 * Le monde est une grille de colonnes (largeur du monde) et de 15 couches
 * naturelles : une herbe, quatre terres, puis dix pierres. La dernière couche
 * de pierre est de la « roche mère » : impossible à casser, elle forme le
 * plancher du monde (personne ne tombe dans le vide). Au-dessus du sol, on
 * peut empiler des blocs jusqu'à 48 rangées (tours, ponts…).
 *
 * Les blocs posés par les joueurs vivent dans une carte séparée (`placed`) ;
 * un bloc naturel cassé laisse un trou qui peut être rebouché en posant un
 * bloc. La simulation est indépendante du Canvas afin de pouvoir être testée
 * sans navigateur.
 */
window.PixWorldMining = (() => {
  "use strict";

  const BLOCK_SIZE = 48;
  const MINE_TIME = 0.2;
  const DROP_SIZE = 14;
  const DROP_GRAVITY = 250;
  // Rangée la plus haute où l'on peut poser un bloc (au-dessus de la surface).
  const MIN_ROW = -48;
  const LAYER_TYPES = Object.freeze([
    "grass",
    "dirt", "dirt", "dirt", "dirt",
    "stone", "stone", "stone", "stone", "stone",
    "stone", "stone", "stone", "stone", "stone",
  ]);
  const BEDROCK_ROW = LAYER_TYPES.length - 1; // roche mère : incassable
  const BLOCKS = Object.freeze({
    grass: Object.freeze({ id: "grass", label: "Herbe", image: "assets/blocks/grass.png", base: "#bf895c", detail: "#78c533" }),
    dirt: Object.freeze({ id: "dirt", label: "Terre", image: "assets/blocks/dirt.png", base: "#b98252", detail: "#8f5737" }),
    stone: Object.freeze({ id: "stone", label: "Pierre", image: "assets/blocks/stone.png", base: "#809196", detail: "#526168" }),
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const cellKey = (column, row) => column + "," + row;
  const EPS = 0.001;

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
    const removed = new Set(); // blocs naturels cassés
    const placed = new Map(); // clé -> type (blocs posés par les joueurs)
    let minPlacedRow = 0; // rangée la plus haute occupée par un bloc posé
    const drops = new Map();
    const inventory = { grass: 0, dirt: 0, stone: 0 };

    function isInBounds(column, row) {
      return Number.isInteger(column) && Number.isInteger(row) &&
        column >= 0 && column < columns && row >= MIN_ROW && row < LAYER_TYPES.length;
    }

    /** Type du bloc (naturel ou posé) en (column, row), ou null si vide. */
    function blockType(column, row) {
      if (!isInBounds(column, row)) return null;
      const key = cellKey(column, row);
      const placedType = placed.get(key);
      if (placedType) return placedType; // un trou rebouché est de nouveau plein
      if (removed.has(key)) return null;
      if (row < 0) return null;
      return LAYER_TYPES[row] || null;
    }

    /**
     * Un bloc (naturel ou posé) occupe-t-il la cellule ? La rangée sous la
     * grille (row >= 15) compte comme solide : c'est le plancher du monde,
     * personne ne peut tomber dans le vide.
     */
    function solidAt(column, row) {
      if (!Number.isInteger(column) || !Number.isInteger(row)) return false;
      if (row >= LAYER_TYPES.length) return true; // roche mère sous la grille
      if (column < 0 || column >= columns || row < MIN_ROW) return false;
      return blockType(column, row) !== null;
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
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const column = Math.floor(x / blockSize);
      const row = Math.floor((y - base) / blockSize);
      if (row < MIN_ROW) return null;
      return getBlock(column, row, base);
    }

    function surfaceBlockAt(worldX, baseY) {
      const x = Number(worldX);
      if (!Number.isFinite(x) || x < 0 || x >= worldWidth) return null;
      const column = Math.floor(x / blockSize);
      const top = Math.min(0, minPlacedRow);
      for (let row = top; row < LAYER_TYPES.length; row++) {
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

    // ─────────────────────────── Collisions ───────────────────────────

    function cellsOverlapping(x, y, w, h, baseY) {
      const c0 = Math.floor(x / blockSize);
      const c1 = Math.floor((x + w - EPS) / blockSize);
      const r0 = Math.floor((y - baseY) / blockSize);
      const r1 = Math.floor((y + h - EPS - baseY) / blockSize);
      return { c0, c1, r0, r1 };
    }

    function rectOverlapsSolid(x, y, w, h, baseY) {
      const { c0, c1, r0, r1 } = cellsOverlapping(x, y, w, h, baseY);
      for (let row = r0; row <= r1; row++) {
        for (let column = c0; column <= c1; column++) {
          if (solidAt(column, row)) return true;
        }
      }
      return false;
    }

    /** Les pieds (y + h) touchent-ils un bloc solide juste en dessous ? */
    function standingOn(x, y, w, h, baseY) {
      const base = Number(baseY) || 0;
      const row = Math.floor((y + h + 0.5 - base) / blockSize);
      const c0 = Math.floor(x / blockSize);
      const c1 = Math.floor((x + w - EPS) / blockSize);
      for (let column = c0; column <= c1; column++) {
        if (solidAt(column, row)) return true;
      }
      return false;
    }

    /**
     * Déplace un rectangle (joueur) en résolvant les collisions avec la
     * grille, axe par axe, par petits pas pour éviter de traverser les blocs
     * à grande vitesse. Renvoie la position résolue et les contacts.
     */
    function moveEntity(rect, dx, dy, baseY) {
      const base = Number(baseY) || 0;
      const w = Number(rect.width);
      const h = Number(rect.height);
      let x = Number(rect.x);
      let y = Number(rect.y);
      const maxStep = blockSize * 0.5;
      let grounded = false;
      let hitWall = false;
      let hitCeiling = false;

      let remainingX = Number(dx) || 0;
      while (remainingX !== 0) {
        const step = clamp(remainingX, -maxStep, maxStep);
        remainingX -= step;
        let next = x + step;
        if (rectOverlapsSolid(next, y, w, h, base)) {
          hitWall = true;
          if (step > 0) {
            next = Math.floor((next + w) / blockSize) * blockSize - w - EPS;
          } else {
            next = (Math.floor(next / blockSize) + 1) * blockSize + EPS;
          }
          if (rectOverlapsSolid(next, y, w, h, base)) next = x;
          remainingX = 0;
        }
        x = next;
      }

      let remainingY = Number(dy) || 0;
      while (remainingY !== 0) {
        const step = clamp(remainingY, -maxStep, maxStep);
        remainingY -= step;
        let next = y + step;
        if (rectOverlapsSolid(x, next, w, h, base)) {
          if (step > 0) {
            grounded = true;
            next = Math.floor((next + h - base) / blockSize) * blockSize + base - h - EPS;
          } else {
            hitCeiling = true;
            next = (Math.floor((next - base) / blockSize) + 1) * blockSize + base + EPS;
          }
          if (rectOverlapsSolid(x, next, w, h, base)) next = y;
          remainingY = 0;
        }
        y = next;
      }

      return { x, y, grounded, hitWall, hitCeiling };
    }

    // ─────────────────────── Pose de blocs ───────────────────────

    /**
     * Règles de pose (façon Minecraft) : la cellule visée doit être vide,
     * dans les limites du monde, et collée à au moins un bloc existant
     * (pas de bloc posé en l'air).
     */
    function canPlaceAt(column, row) {
      if (!Number.isInteger(column) || !Number.isInteger(row)) return false;
      if (column < 0 || column >= columns || row < MIN_ROW || row >= LAYER_TYPES.length) return false;
      const key = cellKey(column, row);
      if (placed.has(key)) return false;
      if (row >= 0 && !removed.has(key)) return false; // bloc naturel présent
      return (
        solidAt(column - 1, row) ||
        solidAt(column + 1, row) ||
        solidAt(column, row - 1) ||
        solidAt(column, row + 1)
      );
    }

    function placeBlock(column, row, type) {
      if (!BLOCKS[type] || !canPlaceAt(column, row)) return null;
      const key = cellKey(column, row);
      placed.set(key, type);
      minPlacedRow = Math.min(minPlacedRow, row);
      return {
        column,
        row,
        type,
        key,
        x: column * blockSize,
        y: row * blockSize,
        size: blockSize,
      };
    }

    /** Dépose un bloc posé (casse) ou marque un bloc naturel comme cassé. */
    function breakBlock(column, row, data) {
      column = Number(column);
      row = Number(row);
      if (!isInBounds(column, row) || row === BEDROCK_ROW) return null; // roche mère
      const key = cellKey(column, row);
      const settings = data || {};
      const base = Number(settings.baseY) || 0;
      const placedType = placed.get(key);
      let type;
      if (placedType) {
        type = placedType;
        placed.delete(key);
      } else {
        if (removed.has(key) || row < 0) return null;
        type = LAYER_TYPES[row];
        removed.add(key);
      }
      const block = {
        column,
        row,
        type,
        key,
        x: column * blockSize,
        y: base + row * blockSize,
        size: blockSize,
      };
      let drop = null;
      if (settings.createDrop !== false) {
        drop = makeDrop(column, row, type, settings);
        drops.set(drop.id, drop);
      }
      return { ...block, drop: drop ? { ...drop } : null };
    }

    function spendBlock(type) {
      if (!BLOCKS[type] || inventory[type] <= 0) return false;
      inventory[type] -= 1;
      return true;
    }

    /** Retire un bloc posé (annulation locale après refus du serveur). */
    function removePlaced(column, row) {
      return placed.delete(cellKey(Number(column), Number(row)));
    }

    function refundBlock(type) {
      if (BLOCKS[type]) inventory[type] += 1;
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

    function applyState(state) {
      const snapshot = state || {};
      const mined = Array.isArray(snapshot.mined) ? snapshot.mined : Array.isArray(snapshot.removed) ? snapshot.removed : [];
      mined.forEach((cell) => {
        const column = Array.isArray(cell) ? Number(cell[0]) : Number(cell && cell.column);
        const row = Array.isArray(cell) ? Number(cell[1]) : Number(cell && cell.row);
        if (isInBounds(column, row)) removed.add(cellKey(column, row));
      });

      // Blocs posés par les autres joueurs (état complet venu du serveur).
      if (Array.isArray(snapshot.placed)) {
        placed.clear();
        minPlacedRow = 0;
        snapshot.placed.forEach((cell) => {
          if (!Array.isArray(cell)) return;
          const column = Number(cell[0]);
          const row = Number(cell[1]);
          const type = BLOCKS[cell[2]] ? cell[2] : null;
          if (!type || !isInBounds(column, row)) return;
          placed.set(cellKey(column, row), type);
          minPlacedRow = Math.min(minPlacedRow, row);
        });
      }

      const active = Array.isArray(snapshot.drops) ? snapshot.drops : [];
      const activeIds = new Set();
      active.forEach((item) => {
        if (!item || typeof item.id !== "string") return;
        const column = Number(item.column);
        const row = Number(item.row);
        if (!isInBounds(column, row)) return;
        const type = BLOCKS[item.type] ? item.type : LAYER_TYPES[row];
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

    /**
     * État complet du terrain, dans la même forme que l'instantané envoyé par
     * le serveur dans son « welcome » : mined (blocs cassés), placed (blocs
     * posés) et drops encore au sol. Sert en direct entre joueurs (sans
     * serveur) pour présenter le terrain à un nouveau venu. Les drops purement
     * locaux (minés hors ligne) ne sont pas partagés.
     */
    function snapshot() {
      return {
        mined: Array.from(removed, (key) => key.split(",").map(Number)),
        placed: Array.from(placed.entries(), ([key, type]) => {
          const [column, row] = key.split(",").map(Number);
          return [column, row, type];
        }),
        drops: Array.from(drops.values(), (drop) => (drop.networked ? {
          id: drop.id,
          column: drop.column,
          row: drop.row,
          type: drop.type,
          ownerId: drop.ownerId,
        } : null)).filter(Boolean),
      };
    }

    function updateDrops(delta, baseY) {
      const dt = clamp(Number(delta) || 0, 0, 0.05);
      const base = Number(baseY) || 0;
      const half = DROP_SIZE / 2;
      drops.forEach((drop, id) => {
        drop.age += dt;
        drop.phase += dt * 3.4;
        drop.vx *= Math.exp(-1.8 * dt);
        // Le cube est un petit corps solide : on réutilise la résolution de
        // collision des joueurs (pas à pas, axe par axe). Il ne peut ainsi
        // traverser aucun bloc — ni en naissant sous une plateforme posée,
        // ni en dérivant contre un mur, ni en tombant à grande vitesse.
        const moved = moveEntity(
          { x: drop.x - half, y: base + drop.depth - half, width: DROP_SIZE, height: DROP_SIZE },
          drop.vx * dt,
          drop.vy * dt,
          base
        );
        drop.x = clamp(moved.x + half, 0, worldWidth - 1);
        drop.depth = moved.y + half - base;
        if (moved.hitWall) drop.vx = 0;
        if (moved.grounded) {
          drop.vy = Math.abs(drop.vy) > 28 ? -Math.abs(drop.vy) * 0.16 : 0;
        } else if (moved.hitCeiling) {
          drop.vy = Math.abs(drop.vy) > 28 ? Math.abs(drop.vy) * 0.16 : 0;
        }
        drop.vy += DROP_GRAVITY * dt;
        // Sécurité : le plancher du monde (sous la roche mère) arrête tout.
        const worldBottom = base + LAYER_TYPES.length * blockSize;
        if (base + drop.depth + half > worldBottom) {
          drop.depth = worldBottom - base - half;
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

    /** Image ou canvas utilisable (les variantes miroir sont des canvas). */
    function drawable(image) {
      return image && (image.naturalWidth > 0 || image.width > 0);
    }

    /**
     * Dessine le terrain sans aucune délimitation entre les blocs : positions
     * arrondies au pixel, taille exacte d'un bloc, et variantes miroir des
     * textures (les textures sont sans couture, donc tout se recolle).
     * `textures[type]` peut être une image seule ou un tableau de 4 variantes
     * [normal, miroir H, miroir V, double miroir].
     */
    function drawTerrain(ctx, view, textures) {
      const width = Math.max(0, Number(view.width) || 0);
      const camX = Number(view.camX) || 0;
      const camY = Number(view.camY) || 0;
      const baseY = Number(view.baseY) || 0;
      const height = Number(view.height) || 0;
      const first = Math.max(0, Math.floor(camX / blockSize));
      const last = Math.min(columns, Math.ceil((camX + width) / blockSize) + 1);
      const topRow = Math.min(0, minPlacedRow);
      const bottomRow = Math.min(LAYER_TYPES.length, Math.ceil((camY + height - baseY) / blockSize) + 1);
      const firstRow = Math.max(topRow, Math.floor((camY - baseY) / blockSize) - 1);
      const images = textures || {};
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      for (let column = first; column < last; column++) {
        const screenX = Math.round(column * blockSize - camX);
        for (let row = firstRow; row < bottomRow; row++) {
          const type = blockType(column, row);
          if (!type) continue;
          const y = Math.round(baseY + row * blockSize - camY);
          if (y > height || y + blockSize < 0) continue;
          // Une herbe enfouie sous un autre bloc se dessine comme de la terre.
          const buriedGrass = type === "grass" && solidAt(column, row - 1);
          const effectiveType = buriedGrass ? "dirt" : type;
          const entry = images[effectiveType];
          const variants = Array.isArray(entry) ? entry : entry ? [entry] : null;
          if (variants && variants.length && drawable(variants[0])) {
            // L'herbe garde sa calotte vers le haut : miroir horizontal seul.
            const orientation = hashText(column + ":" + row) & (effectiveType === "grass" ? 1 : 3);
            const image = variants[Math.min(orientation, variants.length - 1)];
            if (drawable(image)) {
              if (orientation === 1 || orientation === 3) {
                ctx.save();
                ctx.translate(screenX + blockSize, 0);
                ctx.scale(-1, 1);
                if (orientation === 3) {
                  ctx.translate(0, y + blockSize);
                  ctx.scale(1, -1);
                  ctx.drawImage(image, 0, 0, blockSize, blockSize);
                } else {
                  ctx.drawImage(image, 0, y, blockSize, blockSize);
                }
                ctx.restore();
              } else if (orientation === 2) {
                ctx.save();
                ctx.translate(0, y + blockSize);
                ctx.scale(1, -1);
                ctx.drawImage(image, screenX, 0, blockSize, blockSize);
                ctx.restore();
              } else {
                ctx.drawImage(image, screenX, y, blockSize, blockSize);
              }
              continue;
            }
          }
          drawFallbackBlock(ctx, effectiveType, screenX, y, blockSize, column, row);
        }
      }
      ctx.restore();
    }

    function drawDrops(ctx, view, textures) {
      const camX = Number(view.camX) || 0;
      const camY = Number(view.camY) || 0;
      const baseY = Number(view.baseY) || 0;
      const time = Number(view.time) || 0;
      const images = textures || {};
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drops.forEach((drop) => {
        const x = drop.x - camX;
        const y = baseY + drop.depth + Math.sin(time * 4 + drop.phase) * 1.5 - camY;
        if (x < -DROP_SIZE || x > Number(view.width) + DROP_SIZE || y < -DROP_SIZE || y > Number(view.height) + DROP_SIZE) return;
        const entry = images[drop.type];
        const image = Array.isArray(entry) ? entry[0] : entry;
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        ctx.rotate(Math.sin(time * 3 + drop.phase) * 0.08);
        ctx.globalAlpha = drop.pending ? 0.45 : 1;
        if (drawable(image)) {
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

    function drawTarget(ctx, block, progress, camX, camY) {
      if (!block) return;
      const x = Math.round(block.x - (Number(camX) || 0));
      const y = Math.round(block.y - (Number(camY) || 0));
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
      solidAt,
      standingOn: (x, y, w, h, baseY) => standingOn(Number(x), Number(y), Number(w), Number(h), baseY),
      moveEntity,
      canPlaceAt,
      placeBlock,
      removePlaced,
      spendBlock,
      refundBlock,
      surfaceBlockAt,
      surfaceAt,
      supportTop,
      landingTop,
      breakBlock,
      applyState,
      snapshot,
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
      isPlaced: (column, row) => placed.has(cellKey(Number(column), Number(row))),
      getPlaced: () => Array.from(placed.entries(), ([key, type]) => {
        const [column, row] = key.split(",").map(Number);
        return [column, row, type];
      }),
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
      MIN_ROW,
      BEDROCK_ROW,
      LAYER_TYPES,
      ROWS: LAYER_TYPES.length,
      TOTAL_HEIGHT: LAYER_TYPES.length * BLOCK_SIZE,
      STEP_HEIGHT: BLOCK_SIZE * 0.8,
    }),
  };
})();
