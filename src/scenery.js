/**
 * PixWorld — rendu du monde procédural (biomes).
 *
 * Ce module dessine tout ce qui n'est pas un personnage ni un effet de
 * combat : textures de sol générées à la volée (aucune image à charger),
 * ciels en dégradé avec soleil et halo, couches lointaines en silhouettes,
 * relief rempli de texture avec herbe, neige ou cendre sur la surface,
 * décor (arbres, cactus, pins, roches, cristaux, lave…), plateformes et
 * particules d'ambiance (pollen, sable, neige, braises).
 *
 * La logique (relief, plateformes, décor placé) vient de src/world.js ; ce
 * module ne fait que la dessiner. Il ne touche ni au réseau ni aux collisions.
 *
 *   const scenery = PixWorldScenery.create({ world, images: { sky, hills } });
 *   scenery.ensurePatterns(ctx);                       // une fois, après l'ouverture du canvas
 *   scenery.drawSky(ctx, width, height, camX, time);
 *   scenery.drawFarLayers(ctx, width, height, camX);
 *   scenery.drawTerrain(ctx, { width, height, camX, baseY });
 *   scenery.drawProps(ctx, { width, camX, baseY, time });
 *   scenery.drawPlatforms(ctx, { width, camX, baseY });
 *   scenery.updateAmbient(delta, width, height, biomeId);
 *   scenery.drawAmbient(ctx);
 *   scenery.drawGrade(ctx, width, height, camX);
 */
window.PixWorldScenery = (() => {
  "use strict";

  const GRID = 32; // résolution d'une texture de sol (cellules)
  const CELL = 4; // taille d'une cellule à l'écran (px)
  const PATTERN = GRID * CELL;
  const MAX_AMBIENT = 140;
  const TILE_UNIT = 64; // largeur d'une tuile de plateforme

  // Palettes : couleurs du ciel, du relief et de la surface de chaque biome.
  const PALETTES = Object.freeze({
    prairie: {
      skyTop: "#3d8fd6",
      skyBottom: "#bfe9ff",
      glow: "#fff4c4",
      glowAt: [0.82, 0.22],
      haze: "#ffffff",
      ambient: "#ffe9a8",
      ambientParticle: "#e7f58a",
      surface: "#6ccf45",
      fringe: ["#5fbf3a", "#7fd65a", "#3c8a2c", "#a6e86b"],
      body: ["#7a4a2b", "#8c5734", "#6b3f24", "#7f5030"],
      dark: "#4a2a18",
      light: "#b9784a",
      style: "grass",
    },
    desert: {
      skyTop: "#3f9de6",
      skyBottom: "#ffe2a8",
      glow: "#fff6cf",
      glowAt: [0.78, 0.2],
      haze: "#ffe7b0",
      ambient: "#ffb866",
      ambientParticle: "#f3d28e",
      surface: "#f3d28a",
      fringe: ["#f0cd86", "#e7b96d", "#fbe2a6"],
      body: ["#d9a35c", "#c98f4b", "#e8b86e", "#d39a55"],
      dark: "#9a6532",
      light: "#f6dc9c",
      style: "sand",
      far: "#d9a062",
      mid: "#c48a4e",
    },
    snow: {
      skyTop: "#6486b4",
      skyBottom: "#e3eff9",
      glow: "#ffffff",
      glowAt: [0.2, 0.18],
      haze: "#ffffff",
      ambient: "#cfe8ff",
      ambientParticle: "#ffffff",
      surface: "#ffffff",
      fringe: ["#ffffff", "#e6f2ff", "#cfe6ff"],
      body: ["#5d6f86", "#4d5d72", "#6e8098", "#56677d"],
      dark: "#34404f",
      light: "#a9c4dd",
      style: "snow",
      far: "#9fbad8",
      mid: "#dce9f5",
    },
    volcano: {
      skyTop: "#1d0f25",
      skyBottom: "#a24030",
      glow: "#ff8a3a",
      glowAt: [0.5, 0.86],
      haze: "#ff6b3a",
      ambient: "#ff7a3a",
      ambientParticle: "#ffb24a",
      surface: "#3f323e",
      fringe: ["#4a3b47", "#3a2d39", "#ff7a2a"],
      body: ["#2e2630", "#3a2e3a", "#241d27", "#33283a"],
      dark: "#171218",
      light: "#ff6a1f",
      style: "ash",
      far: "#3a1d2e",
      mid: "#55242f",
    },
  });

  // ───────────────────────────── Couleurs ─────────────────────────────

  function hexToRgb(hex) {
    const v = hex.replace("#", "");
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }

  function mixColor(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    const k = Math.max(0, Math.min(1, t));
    return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * k)}, ${Math.round(ca[1] + (cb[1] - ca[1]) * k)}, ${Math.round(
      ca[2] + (cb[2] - ca[2]) * k,
    )})`;
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Bruit de valeur figé (ne dépend que de la graine) : pour les silhouettes. */
  function lattice(salt, i) {
    let h = Math.imul(i ^ salt, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2d, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }

  function valueNoise(salt, t) {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return lattice(salt, i) + (lattice(salt, i + 1) - lattice(salt, i)) * u;
  }

  /** Générateur seedé pour peindre les textures (résultat identique à chaque fois). */
  function painter(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  // ─────────────────────────── Textures de sol ───────────────────────────

  /** Peint une texture de 32 × 32 cellules répétable : corps de terre/roche. */
  function paintBody(palette, seed) {
    const canvas = document.createElement("canvas");
    canvas.width = PATTERN;
    canvas.height = PATTERN;
    const g = canvas.getContext("2d");
    const rnd = painter(seed);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const r = rnd();
        let color = palette.body[Math.floor(rnd() * palette.body.length)];
        if (palette.style === "sand") {
          // Strates de dunes : bandes horizontales qui ondulent.
          const band = (y + Math.floor(Math.sin(x * 0.4) * 1.5)) % 6;
          if (band === 0) color = palette.light;
          else if (band === 3) color = palette.dark;
        } else if (r < 0.12) {
          color = palette.dark;
        } else if (r > 0.94) {
          color = palette.light;
        }
        if (palette.style === "ash" && rnd() < 0.012) color = palette.light; // veines de lave
        g.fillStyle = color;
        g.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // Petites fissures sombres pour casser l'uniformité.
    g.fillStyle = palette.dark;
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd() * GRID);
      const y = Math.floor(rnd() * GRID);
      g.fillRect(x * CELL, y * CELL, CELL, CELL);
      if (rnd() < 0.5) g.fillRect((x + 1) * CELL, y * CELL, CELL, CELL);
    }
    return canvas;
  }

  /** Motif de sol : le corps peint, ou un fond de secours si la toile est indisponible. */
  function bodyPattern(ctx, palette, seed) {
    return ctx.createPattern(paintBody(palette, seed), "repeat");
  }

  // ─────────────────────────────── Décor ───────────────────────────────

  /** Dessine une forme de pierre irrégulière (roche, basalte…). */
  function rockShape(ctx, x, y, w, h, color, light, dark, seedKey) {
    const pts = [
      [-0.5, 0],
      [-0.42, -0.55],
      [-0.12, -0.92],
      [0.2, -0.78],
      [0.5, -0.4],
      [0.52, 0],
    ];
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const jitter = 1 + (lattice(seedKey, i) - 0.5) * 0.18;
      const X = x + px * w;
      const Y = y + py * h * jitter;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.beginPath();
    pts.slice(0, 4).forEach(([px, py], i) => {
      const X = x + px * w * 0.9;
      const Y = y + py * h * 0.9;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.lineTo(x - 0.1 * w, y - 0.5 * h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = light;
    ctx.fillRect(x - 0.2 * w, y - 0.85 * h, 0.14 * w, 0.14 * h);
  }

  function drawTree(ctx, x, y, s, flip) {
    // Tronc puis canopée en trois boules pixel art.
    ctx.fillStyle = "#6b4226";
    ctx.fillRect(x - 5 * s, y - 40 * s, 10 * s, 40 * s);
    const tints = ["#2f7a2f", "#3d9a3a", "#58b847"];
    const blobs = [
      [0, -62, 34],
      [-18, -48, 24],
      [18, -50, 26],
    ];
    blobs.forEach(([bx, by, r], i) => {
      ctx.fillStyle = tints[i];
      ctx.beginPath();
      ctx.arc(x + bx * s * flip, y + by * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(x - 8 * s * flip, y - 74 * s, 10 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBush(ctx, x, y, s) {
    const tints = ["#2f7a2f", "#4aa83c"];
    [
      [-12, -14, 16],
      [8, -12, 18],
      [-2, -22, 14],
    ].forEach(([bx, by, r], i) => {
      ctx.fillStyle = tints[i % 2];
      ctx.beginPath();
      ctx.arc(x + bx * s, y + by * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawCactus(ctx, x, y, s, flip, variant) {
    const green = "#3f8a3a";
    const dark = "#2a6026";
    const light = "#7fc16a";
    const bodyW = 14 * s;
    const bodyH = (60 + variant * 10) * s;
    ctx.fillStyle = dark;
    ctx.fillRect(x - bodyW / 2 - 1, y - bodyH - 1, bodyW + 2, bodyH + 2);
    ctx.fillStyle = green;
    ctx.fillRect(x - bodyW / 2, y - bodyH, bodyW, bodyH);
    ctx.fillStyle = light;
    ctx.fillRect(x - bodyW / 2 + 2 * s, y - bodyH + 4 * s, 3 * s, bodyH - 8 * s);
    // Bras : horizontal puis vertical.
    const armY = y - bodyH * 0.55;
    const armX = x + flip * (bodyW / 2);
    ctx.fillStyle = green;
    ctx.fillRect(Math.min(armX, armX + flip * 16 * s), armY - 6 * s, 16 * s, 8 * s);
    ctx.fillRect(armX + flip * 10 * s - (flip < 0 ? 8 * s : 0), armY - 26 * s, 8 * s, 26 * s);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 3 * s, y - bodyH + 4 * s, 1.5 * s, bodyH - 8 * s);
  }

  function drawDeadBush(ctx, x, y, s) {
    ctx.strokeStyle = "#7a5230";
    ctx.lineWidth = 3 * s;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6 * s, y - 26 * s);
    ctx.moveTo(x - 2 * s, y - 14 * s);
    ctx.lineTo(x + 12 * s, y - 28 * s);
    ctx.moveTo(x - 6 * s, y - 26 * s);
    ctx.lineTo(x - 18 * s, y - 34 * s);
    ctx.stroke();
  }

  function drawRuin(ctx, x, y, s, variant) {
    const h = (34 + variant * 12) * s;
    const w = 26 * s;
    ctx.fillStyle = "#b8783d";
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = "#8f5a2a";
    ctx.fillRect(x - w / 2 + 4 * s, y - h + 6 * s, w - 8 * s, 4 * s);
    ctx.fillRect(x - w / 2, y - 6 * s, w, 6 * s);
    ctx.fillStyle = "#e7b87a";
    ctx.fillRect(x - w / 2 - 3 * s, y - h - 4 * s, w + 6 * s, 6 * s);
    // Gravats au pied.
    ctx.fillStyle = "#c98f4b";
    ctx.fillRect(x + w / 2 + 2 * s, y - 7 * s, 8 * s, 7 * s);
    ctx.fillRect(x - w / 2 - 10 * s, y - 5 * s, 7 * s, 5 * s);
  }

  function drawPine(ctx, x, y, s, variant) {
    const h = (110 + variant * 12) * s;
    ctx.fillStyle = "#4a3324";
    ctx.fillRect(x - 3 * s, y - 16 * s, 6 * s, 16 * s);
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const top = y - h + i * (h * 0.28);
      const w = (44 - i * 9) * s;
      const bottom = top + h * 0.5;
      ctx.fillStyle = i % 2 ? "#1f5a3f" : "#2a6e4b";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + w / 2, bottom);
      ctx.lineTo(x - w / 2, bottom);
      ctx.closePath();
      ctx.fill();
      // Neige sur les branches.
      ctx.fillStyle = "#eef6ff";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + w / 4, top + (bottom - top) * 0.35);
      ctx.lineTo(x - w / 4, top + (bottom - top) * 0.35);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSnowRock(ctx, x, y, s, variant) {
    const w = (40 + variant * 6) * s;
    const h = 34 * s;
    rockShape(ctx, x, y, w, h, "#e9f3fb", "#ffffff", "#5b6b80", variant + 3);
  }

  function drawIceSpire(ctx, x, y, s) {
    const h = 110 * s;
    const w = 26 * s;
    const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    grad.addColorStop(0, "#a8d8f5");
    grad.addColorStop(0.5, "#e7f8ff");
    grad.addColorStop(1, "#6aaed9");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w * 0.22, y - h * 0.6);
    ctx.lineTo(x, y - h);
    ctx.lineTo(x + w * 0.25, y - h * 0.55);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawBasalt(ctx, x, y, s, variant, time) {
    const w = (60 + variant * 10) * s;
    const h = (48 + variant * 8) * s;
    rockShape(ctx, x, y, w, h, "#3a2e3a", "#5a4a5c", "#1f1822", variant + 7);
    // Fissures incandescentes qui pulsent doucement.
    const glow = 0.6 + 0.4 * Math.sin(time * 2 + variant);
    ctx.strokeStyle = `rgba(255, 120, 40, ${0.55 + glow * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.1, y - h * 0.3);
    ctx.lineTo(x + w * 0.12, y - h * 0.62);
    ctx.lineTo(x + w * 0.04, y - h * 0.9);
    ctx.stroke();
  }

  function drawLavaPool(ctx, x, y, s, time) {
    const w = 96 * s;
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.6 + x * 0.01);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y, 4, x, y, w * 0.9);
    halo.addColorStop(0, `rgba(255, 120, 40, ${0.35 + 0.15 * pulse})`);
    halo.addColorStop(1, "rgba(255, 80, 20, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - w, y - w * 0.5, w * 2, w);
    ctx.restore();
    ctx.fillStyle = "#3a1408";
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2 + 2, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pulse > 0.5 ? "#ff7a2a" : "#ff9a3c";
    ctx.beginPath();
    ctx.ellipse(x, y - 1, w / 2 - 4, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd27a";
    ctx.fillRect(x - w * 0.2 + pulse * 8, y - 3, w * 0.18, 3);
  }

  function drawVent(ctx, x, y, s, time) {
    ctx.fillStyle = "#2b2230";
    ctx.beginPath();
    ctx.moveTo(x - 16 * s, y);
    ctx.lineTo(x - 8 * s, y - 26 * s);
    ctx.lineTo(x + 8 * s, y - 26 * s);
    ctx.lineTo(x + 16 * s, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ff7a2a";
    ctx.beginPath();
    ctx.ellipse(x, y - 26 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // Panache de fumée qui monte et s'efface.
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.35 + i / 4) % 1;
      ctx.fillStyle = `rgba(90, 70, 90, ${0.35 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(t * 6 + i) * 6 * s, y - 30 * s - t * 90 * s, (6 + t * 14) * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCrystal(ctx, x, y, s, variant, time) {
    const colors = ["#7ee8ff", "#b58cff", "#ff8fd0"];
    const color = colors[variant % colors.length];
    const h = (70 + variant * 10) * s;
    const glow = 0.5 + 0.5 * Math.sin(time * 2.2 + variant);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y - h * 0.4, 2, x, y - h * 0.4, h * 0.9);
    halo.addColorStop(0, rgba(color, 0.35 + 0.2 * glow));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - h, y - h * 1.4, h * 2, h * 1.6);
    ctx.restore();
    [
      [-12, 0.45, 0.6],
      [0, 1, 0.5],
      [12, 0.6, 0.55],
    ].forEach(([dx, hk, wk], i) => {
      const cx = x + dx * s;
      const top = y - h * hk;
      ctx.fillStyle = i === 1 ? color : rgba(color, 0.85);
      ctx.beginPath();
      ctx.moveTo(cx - 7 * s * wk, y);
      ctx.lineTo(cx, top);
      ctx.lineTo(cx + 7 * s * wk, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(cx - 1.5 * s, top + 4 * s, 2 * s, 6 * s);
    });
  }

  /** Dessine un élément de décor placé par src/world.js (x monde, posé au sol). */
  function drawProp(ctx, prop, sx, gy, time) {
    const s = prop.scale;
    const flip = prop.flip;
    switch (prop.kind) {
      case "tree":
        drawTree(ctx, sx, gy, s, flip);
        break;
      case "bush":
        drawBush(ctx, sx, gy, s);
        break;
      case "rock":
        rockShape(ctx, sx, gy, 46 * s, 28 * s, "#9aa0a8", "#d6dbe2", "#5d636b", prop.id);
        break;
      case "cactus":
        drawCactus(ctx, sx, gy, s, flip, prop.variant);
        break;
      case "deadbush":
        drawDeadBush(ctx, sx, gy, s);
        break;
      case "ruin":
        drawRuin(ctx, sx, gy, s, prop.variant);
        break;
      case "pine":
        drawPine(ctx, sx, gy, s, prop.variant);
        break;
      case "snowrock":
        drawSnowRock(ctx, sx, gy, s, prop.variant);
        break;
      case "icespire":
        drawIceSpire(ctx, sx, gy, s);
        break;
      case "basalt":
        drawBasalt(ctx, sx, gy, s, prop.variant, time);
        break;
      case "lava":
        drawLavaPool(ctx, sx, gy, s, time);
        break;
      case "vent":
        drawVent(ctx, sx, gy, s, time);
        break;
      case "crystal":
        drawCrystal(ctx, sx, gy, s, prop.variant, time);
        break;
      default:
        break;
    }
  }

  // ───────────────────────────── Particules ─────────────────────────────

  const AMBIENT_STYLE = Object.freeze({
    prairie: { color: "#e7f58a", speedX: 18, speedY: 12, size: 2, life: 9, wobble: 26 },
    desert: { color: "#f3d28e", speedX: 240, speedY: 26, size: 1.5, life: 3.5, wobble: 4 },
    snow: { color: "#ffffff", speedX: 14, speedY: 46, size: 2.4, life: 9, wobble: 22 },
    volcano: { color: "#ffb24a", speedX: 6, speedY: -58, size: 2, life: 4.5, wobble: 14 },
  });

  // ─────────────────────────────── Moteur ───────────────────────────────

  function create(options) {
    const settings = options || {};
    const world = settings.world;
    const images = settings.images || {};
    if (!world) throw new Error("PixWorldScenery.create : un monde est requis");

    const patterns = Object.create(null);
    const palettes = PALETTES;
    let ambient = [];
    let ambientBiome = null;
    let skyGradientCache = null;
    let skyGradientKey = "";

    /** Motifs de sol, créés une fois par biome (le canvas doit exister). */
    function ensurePatterns(ctx) {
      Object.keys(palettes).forEach((id, index) => {
        if (!patterns[id]) patterns[id] = bodyPattern(ctx, palettes[id], 1000 + index * 97);
      });
    }

    function drawTiledLayer(ctx, img, factor, camX, width, drawH, bottomY, alpha) {
      if (!(img && img.complete && img.naturalWidth > 0) || alpha <= 0) return;
      const scale = drawH / img.height;
      const drawW = img.width * scale;
      if (!(drawW > 0)) return;
      let off = (camX * factor) % drawW;
      if (off < 0) off += drawW;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let x = -off - drawW; x < width + drawW; x += drawW) {
        ctx.drawImage(img, x, bottomY - drawH, drawW, drawH);
      }
      ctx.restore();
    }

    /** Ciel : dégradé, soleil, halo, puis les couches de la prairie si elle est visible. */
    function drawSky(ctx, width, height, camX, time) {
      const blend = world.blendAt(camX + width / 2);
      const a = palettes[blend.from];
      const b = palettes[blend.to];
      const t = blend.t;
      const top = mixColor(a.skyTop, b.skyTop, t);
      const bottom = mixColor(a.skyBottom, b.skyBottom, t);
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, top);
      grad.addColorStop(0.62, bottom);
      grad.addColorStop(1, bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(-40, -40, width + 80, height + 80);

      // Prairie : ciel et nuages d'origine (Sunny Land), fondus avec le reste.
      const prairieWeight = (blend.from === "prairie" ? 1 - t : 0) + (blend.to === "prairie" ? t : 0);
      drawTiledLayer(ctx, images.sky, 0.1, camX, width, height + 40, height + 20, prairieWeight);

      // Soleil et halo : position propre à chaque biome.
      const sunColor = t < 0.5 ? a.glow : b.glow;
      const at = t < 0.5 ? a.glowAt : b.glowAt;
      const sx = width * at[0];
      const sy = height * at[1];
      const pulse = 0.94 + 0.06 * Math.sin(time * 0.7);
      const halo = ctx.createRadialGradient(sx, sy, 6, sx, sy, Math.max(width, height) * 0.4 * pulse);
      halo.addColorStop(0, rgba(sunColor, 0.55));
      halo.addColorStop(0.35, rgba(sunColor, 0.14));
      halo.addColorStop(1, rgba(sunColor, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-40, -40, width + 80, height + 80);
      ctx.fillStyle = rgba(sunColor, 0.95);
      ctx.beginPath();
      ctx.arc(sx, sy, 22 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Brume lointaine (voile horizontal qui défile lentement).
      const hazeY = height * 0.7;
      const haze = ctx.createLinearGradient(0, hazeY - 60, 0, hazeY + 60);
      const hazeColor = t < 0.5 ? a.haze : b.haze;
      haze.addColorStop(0, rgba(hazeColor, 0));
      haze.addColorStop(0.5, rgba(hazeColor, 0.18));
      haze.addColorStop(1, rgba(hazeColor, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(-40, hazeY - 60, width + 80, 120);
    }

    /** Silhouette lointaine : une ligne de crêtes qui défile à `factor`. */
    function drawFar(ctx, width, height, camX, alpha, factor, base, amp, salt, period, color) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-20, height);
      for (let sx = -20; sx <= width + 20; sx += 12) {
        const wx = (sx + camX * factor) / period;
        const n = valueNoise(salt, wx) * 0.7 + valueNoise(salt + 11, wx * 2.3) * 0.3;
        ctx.lineTo(sx, base - amp * n);
      }
      ctx.lineTo(width + 20, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawBiomeFar(ctx, width, height, camX, id, alpha) {
      const p = palettes[id];
      if (!p.far || alpha <= 0) return;
      const salt = id === "desert" ? 3001 : id === "snow" ? 4001 : 5001;
      const amp = id === "snow" ? 240 : id === "volcano" ? 300 : 150;
      const period = id === "snow" ? 520 : id === "volcano" ? 600 : 420;
      drawFar(ctx, width, height, camX, alpha, 0.2, height * 0.72, amp, salt, period, p.far);
      drawFar(ctx, width, height, camX, alpha, 0.36, height * 0.8, amp * 0.6, salt + 7, period * 0.7, p.mid);
    }

    function drawFarLayers(ctx, width, height, camX) {
      const blend = world.blendAt(camX + width / 2);
      const t = blend.t;
      if (blend.from !== "prairie") drawBiomeFar(ctx, width, height, camX, blend.from, 1 - t);
      if (blend.to !== "prairie") drawBiomeFar(ctx, width, height, camX, blend.to, t);
      // Collines de la prairie, défilant en parallaxe comme avant.
      const prairieWeight = (blend.from === "prairie" ? 1 - t : 0) + (blend.to === "prairie" ? t : 0);
      drawTiledLayer(ctx, images.hills, 0.32, camX, width, height * 0.85, height, prairieWeight);
    }

    /** Relief : remplissage texturé par biome, puis surface (herbe, neige, cendre…). */
    function drawTerrain(ctx, view) {
      const { width, height, camX, baseY } = view;
      const left = camX - 40;
      const right = camX + width + 40;
      world.bands.forEach((band) => {
        const xa = Math.max(band.start, left);
        const xb = Math.min(band.end, right);
        if (xb <= xa) return;
        const palette = palettes[band.biome];
        const pattern = patterns[band.biome];
        if (!pattern) return;

        // Corps du relief, texturé et défilant avec la caméra.
        pattern.setTransform(new DOMMatrix().translate(-mod(camX, PATTERN), 0));
        ctx.beginPath();
        ctx.moveTo(xa - camX, height + 40);
        for (let x = xa; x <= xb + 8; x += 8) {
          ctx.lineTo(x - camX, baseY - world.offsetAt(Math.min(x, xb)));
        }
        ctx.lineTo(xb - camX, height + 40);
        ctx.closePath();
        ctx.fillStyle = pattern;
        ctx.fill();

        // Ombre douce sous la surface, pour donner du volume.
        const shade = ctx.createLinearGradient(0, baseY - 140, 0, baseY + 40);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, rgba(palette.dark, 0.35));
        ctx.fillStyle = shade;
        ctx.fill();

        drawSurface(ctx, palette, xa, xb, camX, baseY);
      });
    }

    function drawSurface(ctx, palette, xa, xb, camX, baseY) {
      const step = 8;
      const topY = (x) => baseY - world.offsetAt(x);
      // Liseré clair le long du bord supérieur.
      ctx.beginPath();
      for (let x = xa; x <= xb; x += step) {
        const sx = x - camX;
        if (x === xa) ctx.moveTo(sx, topY(x));
        else ctx.lineTo(sx, topY(x));
      }
      ctx.lineWidth = palette.style === "snow" ? 9 : 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = palette.style === "snow" ? "#ffffff" : palette.surface;
      ctx.stroke();

      if (palette.style === "grass" || palette.style === "sand") {
        // Brins d'herbe (ou touffes de sable sec) qui dépassent du bord.
        for (let x = xa; x <= xb; x += 6) {
          const r = lattice(77, Math.floor(x / 6));
          if (r < 0.35) continue;
          const sx = x - camX;
          const y = topY(x);
          const h = 5 + r * 9;
          ctx.fillStyle = palette.fringe[Math.floor(r * 97) % palette.fringe.length];
          ctx.beginPath();
          ctx.moveTo(sx - 3, y + 2);
          ctx.lineTo(sx + 3, y + 2);
          ctx.lineTo(sx + (r - 0.5) * 6, y - h);
          ctx.closePath();
          ctx.fill();
        }
      } else if (palette.style === "snow") {
        // Congères : petites bosses blanches et stalactites de glace.
        for (let x = xa; x <= xb; x += 14) {
          const r = lattice(91, Math.floor(x / 14));
          const sx = x - camX;
          const y = topY(x);
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.ellipse(sx, y + 1, 7 + r * 6, 4 + r * 3, 0, 0, Math.PI * 2);
          ctx.fill();
          if (r > 0.7) {
            ctx.fillStyle = "rgba(190, 225, 255, 0.9)";
            ctx.beginPath();
            ctx.moveTo(sx - 3, y + 6);
            ctx.lineTo(sx + 3, y + 6);
            ctx.lineTo(sx, y + 6 + 8 + r * 8);
            ctx.closePath();
            ctx.fill();
          }
        }
      } else if (palette.style === "ash") {
        // Croûte de cendre sombre, fissures de braise qui luisent.
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 110, 40, 0.85)";
        ctx.beginPath();
        for (let x = xa; x <= xb; x += 26) {
          const r = lattice(131, Math.floor(x / 26));
          if (r < 0.55) continue;
          const sx = x - camX;
          const y = topY(x);
          ctx.moveTo(sx, y + 3);
          ctx.lineTo(sx + 8 + r * 10, y + 9 + r * 6);
        }
        ctx.stroke();
      }
    }

    function mod(value, m) {
      return ((value % m) + m) % m;
    }

    /** Décor (arbres, cactus, pins, roches…) des segments visibles. */
    function drawProps(ctx, view) {
      const { width, camX, baseY, time } = view;
      world.propsIn(camX - 80, camX + width + 80).forEach((prop) => {
        const sx = prop.x - camX;
        const gy = baseY - prop.offset;
        drawProp(ctx, prop, sx, gy, time);
      });
    }

    /** Plateformes flottantes : blocs texturés à la couleur de leur biome. */
    function drawPlatforms(ctx, view) {
      const { width, camX, baseY } = view;
      world.platformsIn(camX - 40, camX + width + 40).forEach((platform) => {
        const palette = palettes[platform.biome];
        const pattern = patterns[platform.biome];
        const sx = platform.x - camX;
        const top = baseY - platform.offset;
        const h = 26;
        const w = platform.w;
        ctx.save();
        if (pattern) {
          pattern.setTransform(new DOMMatrix().translate(-mod(camX, PATTERN), 0));
          ctx.fillStyle = pattern;
        } else {
          ctx.fillStyle = palette.body[0];
        }
        ctx.fillRect(sx, top, w, h);
        ctx.fillStyle = palette.surface;
        ctx.fillRect(sx - 2, top - 3, w + 4, 6);
        ctx.fillStyle = rgba(palette.dark, 0.6);
        ctx.fillRect(sx, top + h - 4, w, 4);
        // Ombre portée sur le sol en dessous, pour lire la hauteur.
        const shadowY = baseY - world.offsetAt(platform.x + w / 2);
        ctx.fillStyle = "rgba(20, 20, 40, 0.14)";
        ctx.beginPath();
        ctx.ellipse(sx + w / 2, shadowY + 6, w * 0.35, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // ───────────────────────── Ambiance (particules) ─────────────────────────

    function spawnAmbient(width, height, id) {
      const style = AMBIENT_STYLE[id] || AMBIENT_STYLE.prairie;
      return {
        x: Math.random() * (width + 120) - 60,
        y: id === "volcano" ? height + 10 : Math.random() * height * 0.8,
        vx: style.speedX * (0.7 + Math.random() * 0.6),
        vy: style.speedY * (0.7 + Math.random() * 0.6),
        wobble: style.wobble * (0.5 + Math.random()),
        phase: Math.random() * Math.PI * 2,
        life: style.life * (0.6 + Math.random() * 0.8),
        age: 0,
        size: style.size * (0.7 + Math.random() * 0.8),
        color: style.color,
        biome: id,
      };
    }

    function updateAmbient(delta, width, height, biomeId) {
      const dt = clamp(Number(delta) || 0, 0, 0.05);
      if (ambientBiome !== biomeId) {
        ambientBiome = biomeId;
        ambient = [];
      }
      ambient.forEach((p) => {
        p.age += dt;
        p.phase += dt * 1.4;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      });
      ambient = ambient.filter((p) => p.age < p.life && p.y > -40 && p.y < height + 40 && p.x > -120 && p.x < width + 120);
      const target = Math.round((width / 1920) * (biomeId === "desert" ? 60 : 90));
      while (ambient.length < Math.min(MAX_AMBIENT, target)) {
        ambient.push(spawnAmbient(width, height, biomeId));
      }
    }

    function drawAmbient(ctx) {
      ambient.forEach((p) => {
        const alpha = clamp(Math.min(p.age, p.life - p.age) * 1.2, 0, 0.85);
        const x = p.x + Math.sin(p.phase) * p.wobble;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(x), Math.round(p.y), p.size, p.size);
      });
      ctx.globalAlpha = 1;
    }

    /** Lueur d'ambiance et vignettage colorés, par-dessus le monde. */
    function drawGrade(ctx, width, height, camX) {
      const blend = world.blendAt(camX + width / 2);
      const t = blend.t;
      const color = mixColor(palettes[blend.from].ambient, palettes[blend.to].ambient, t);
      const tint = ctx.createLinearGradient(0, 0, 0, height);
      tint.addColorStop(0, "rgba(0,0,0,0)");
      tint.addColorStop(0.7, "rgba(0,0,0,0)");
      tint.addColorStop(1, rgba("#1a1020", 0.28));
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    return {
      ensurePatterns,
      drawSky,
      drawFarLayers,
      drawTerrain,
      drawProps,
      drawPlatforms,
      updateAmbient,
      drawAmbient,
      drawGrade,
      get patternsReady() {
        return Object.keys(patterns).length === Object.keys(palettes).length;
      },
    };
  }

  return {
    create,
    PALETTES,
    constants: Object.freeze({ GRID, CELL, PATTERN, TILE_UNIT, MAX_AMBIENT }),
  };
})();
