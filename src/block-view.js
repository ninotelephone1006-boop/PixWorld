/**
 * PixWorld — rendu du terrain en blocs (minage 2D).
 *
 * Ce module dessine ce que voit le joueur autour de src/terrain.js : le fond
 * de grotte visible à travers les blocs minés, les blocs visibles, le contour
 * et les fissures du bloc visé, et les objets lâchés. Les textures sont des
 * pixel art de 16 × 16 (assets/blocks/). Elles sont agrandies une seule fois à
 * la taille d'un bloc, avec des pixels nets. Avant leur chargement, une couleur
 * unie les remplace.
 *
 *   const view = PixWorldBlockView.create({ terrain, onLoad });
 *   view.drawBackdrop(ctx, { width, height, top });
 *   view.drawBlocks(ctx, { camX, top, width, height });
 *   view.drawOutline(ctx, { col, row, camX, top, valid });
 *   view.drawCrack(ctx, { col, row, camX, top, progress });   // progress : 0 à 1
 *   view.drawDrops(ctx, { items, camX, top, width });
 *
 * `top` est la ligne de la surface à l'écran ; la profondeur s'y ajoute.
 */
window.PixWorldBlockView = (() => {
  "use strict";

  const TEXTURES = Object.freeze({
    grass: "assets/blocks/grass.png",
    dirt: "assets/blocks/dirt.png",
    stone: "assets/blocks/stone.png",
    bedrock: "assets/blocks/bedrock.png",
  });
  const FALLBACK = Object.freeze({ grass: "#6ccf45", dirt: "#7a4a2b", stone: "#9a9ea6", bedrock: "#2f2f36" });
  const CRACK_STAGES = 10; // étapes visibles pendant le minage
  const ICON = 16; // taille d'un objet lâché à l'écran (px)
  const DIRECTIONS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  /** Générateur pseudo-aléatoire stable : les fissures ne changent jamais d'une session à l'autre. */
  function seeded(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /** Ordre de tracé des fissures : quelques branches qui partent du centre de la texture, pixel par pixel. */
  function crackOrder() {
    const random = seeded(4242);
    const order = [];
    for (let branch = 0; branch < 7; branch++) {
      let x = 3 + Math.floor(random() * 10);
      let y = 3 + Math.floor(random() * 10);
      let dir = Math.floor(random() * 8);
      for (let step = 0; step < 8; step++) {
        if (x < 0 || y < 0 || x > 15 || y > 15) break;
        order.push([x, y]);
        if (random() < 0.4) dir = (dir + (random() < 0.5 ? 1 : 7)) % 8;
        x += DIRECTIONS[dir][0];
        y += DIRECTIONS[dir][1];
      }
    }
    return order;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** Étapes de fissures : chaque étape ajoute des pixels à la précédente. */
  function paintCracks(size) {
    const order = crackOrder();
    const stages = [];
    for (let stage = 0; stage < CRACK_STAGES; stage++) {
      const source = makeCanvas(16, 16);
      const g = source.getContext("2d");
      const count = Math.ceil((order.length * (stage + 1)) / CRACK_STAGES);
      g.fillStyle = "rgba(18, 12, 8, 0.85)";
      for (let i = 0; i < count; i++) g.fillRect(order[i][0], order[i][1], 1, 1);
      stages.push(scale(source, 16, 16, size));
    }
    return stages;
  }

  /** Agrandit une image carrée à `size` px, sans lissage (pixel art). */
  function scale(source, sourceWidth, sourceHeight, size) {
    const canvas = makeCanvas(size, size);
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, size, size);
    return canvas;
  }

  function create(options) {
    const settings = options || {};
    const terrain = settings.terrain;
    if (!terrain) throw new Error("PixWorldBlockView.create : un terrain est requis");
    const block = terrain.block;
    const onLoad = settings.onLoad || (() => {});
    const sprites = Object.create(null); // type -> toile à la taille d'un bloc
    const images = Object.create(null); // type -> image source (16 × 16)
    const cracks = paintCracks(block);

    Object.keys(TEXTURES).forEach((type) => {
      const image = new Image();
      image.onload = () => {
        sprites[type] = scale(image, image.naturalWidth, image.naturalHeight, block);
        onLoad(type);
      };
      image.src = TEXTURES[type];
      images[type] = image;
    });

    function drawBlock(ctx, type, x, y) {
      const sprite = sprites[type];
      if (sprite) {
        ctx.drawImage(sprite, x, y);
      } else {
        ctx.fillStyle = FALLBACK[type] || "#000000";
        ctx.fillRect(x, y, block, block);
      }
    }

    /** Fond de grotte : visible à travers les blocs minés, et sous le monde. */
    function drawBackdrop(ctx, view) {
      const { width, height, top } = view;
      if (top >= height) return;
      const grad = ctx.createLinearGradient(0, top, 0, height);
      grad.addColorStop(0, "#4a3426");
      grad.addColorStop(0.45, "#2b1e16");
      grad.addColorStop(1, "#130e0b");
      ctx.fillStyle = grad;
      ctx.fillRect(-40, top, width + 80, height - top + 40);
    }

    /** Blocs visibles seulement : colonnes et lignes hors de l'écran ignorées. */
    function drawBlocks(ctx, view) {
      const { camX, top, width, height } = view;
      const first = Math.max(0, Math.floor(camX / block) - 1);
      const last = Math.min(terrain.columns - 1, Math.floor((camX + width) / block) + 1);
      for (let col = first; col <= last; col++) {
        const x = Math.round(col * block - camX);
        for (let row = 0; row < terrain.rows; row++) {
          const type = terrain.typeAt(col, row);
          if (!type) continue;
          const y = Math.round(top + row * block);
          if (y >= height) break;
          drawBlock(ctx, type, x, y);
        }
      }
    }

    /** Contour du bloc visé : blanc à portée, rouge s'il est hors de portée ou incassable. */
    function drawOutline(ctx, target) {
      const x = Math.round(target.col * block - target.camX);
      const y = Math.round(target.top + target.row * block);
      const valid = target.valid !== false;
      ctx.save();
      ctx.fillStyle = valid ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 90, 90, 0.16)";
      ctx.fillRect(x, y, block, block);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(8, 14, 26, 0.7)";
      ctx.strokeRect(x - 1, y - 1, block + 2, block + 2);
      ctx.strokeStyle = valid ? "#ffffff" : "#ff6b6b";
      ctx.strokeRect(x + 1, y + 1, block - 2, block - 2);
      ctx.restore();
    }

    /** Fissures qui s'allongent pendant le minage (progress de 0 à 1). */
    function drawCrack(ctx, target) {
      const progress = Math.min(Math.max(Number(target.progress) || 0, 0), 1);
      if (progress < 0.02) return;
      const stage = Math.min(CRACK_STAGES - 1, Math.floor(progress * CRACK_STAGES));
      const x = Math.round(target.col * block - target.camX);
      const y = Math.round(target.top + target.row * block);
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(cracks[stage], x, y);
      ctx.restore();
    }

    function drawIcon(ctx, type, x, y) {
      const image = images[type];
      if (image && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, ICON, ICON);
      } else {
        ctx.fillStyle = FALLBACK[type] || "#000000";
        ctx.fillRect(x, y, ICON, ICON);
      }
    }

    /** Objets lâchés : une petite icône qui flotte légèrement, avec son ombre au sol. */
    function drawDrops(ctx, view) {
      const { items, camX, top, width } = view;
      items.forEach((item) => {
        const sx = item.x - camX;
        if (sx < -ICON || sx > width + ICON) return;
        const footY = top + item.feet;
        const lift = 2 + Math.sin(item.age * 3 + item.seed) * 1.5;
        ctx.fillStyle = "rgba(10, 8, 6, 0.28)";
        ctx.beginPath();
        ctx.ellipse(Math.round(sx), Math.round(footY), 6, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        drawIcon(ctx, item.type, Math.round(sx - ICON / 2), Math.round(footY - ICON + 2 - lift));
      });
    }

    return {
      drawBackdrop,
      drawBlocks,
      drawOutline,
      drawCrack,
      drawDrops,
      get crackStages() {
        return cracks.length;
      },
    };
  }

  return {
    create,
    TEXTURES,
    constants: Object.freeze({ CRACK_STAGES, ICON }),
  };
})();
