/**
 * PixWorld — effets visuels de combat.
 *
 * Un petit moteur de particules et d'effets d'écran, indépendant du reste du
 * jeu : étincelles d'impact, poussière, traînées de projectiles, anneaux
 * d'onde de choc, chiffres de dégâts flottants, secousses de caméra, flashs
 * et vignette rouge quand la vie est basse.
 *
 *   const fx = PixWorldEffects.create();
 *   fx.impact(x, y, "slash", "#ff6b73", facing);   // coordonnées monde
 *   fx.update(delta);
 *   fx.draw(ctx, camX);                           // particules + textes
 *   fx.drawOverlay(ctx, width, height);           // flashs, vignette
 */
window.PixWorldEffects = (() => {
  "use strict";

  const MAX_PARTICLES = 700;
  const MAX_TEXTS = 40;
  const MAX_RINGS = 40;
  const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const BLADE_COLORS = ["#5fae3f", "#8fd35a", "#3c7d36", "#c8e879"];

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  /** "#rrggbb" → "rgba(r, g, b, a)" (les couleurs d'accent sont en hexa). */
  function withAlpha(color, alpha) {
    if (typeof color === "string" && color[0] === "#" && (color.length === 7 || color.length === 4)) {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
      const n = parseInt(hex, 16);
      return "rgba(" + (n >> 16) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + alpha + ")";
    }
    return color;
  }

  function create() {
    const particles = [];
    const texts = [];
    const rings = [];
    const flashes = [];
    const shake = { time: 0, duration: 0, intensity: 0, x: 0, y: 0, seed: 0 };
    let vignetteLevel = 0;
    let vignettePulse = 0;

    // ───────────────────────── Particules ─────────────────────────
    function particle(p) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push({
        x: p.x,
        y: p.y,
        vx: p.vx || 0,
        vy: p.vy || 0,
        gravity: p.gravity == null ? 0 : p.gravity,
        drag: p.drag == null ? 0 : p.drag,
        life: p.life,
        maxLife: p.life,
        size: p.size == null ? 3 : p.size,
        color: p.color || "#ffffff",
        shape: p.shape || "square",
        rotation: p.rotation || 0,
        spin: p.spin || 0,
        glow: p.glow || 0,
        shrink: p.shrink !== false,
        fade: p.fade || "late",
        length: p.length || 0,
      });
    }

    /** Étincelles rapides et fines (impacts métalliques, coupe). */
    function sparks(x, y, options) {
      const o = options || {};
      const count = o.count == null ? 10 : o.count;
      const direction = o.direction == null ? 0 : o.direction; // -1, 0, 1
      const colors = o.colors || ["#ffffff", "#fff2b0", o.color || "#ffd166"];
      for (let i = 0; i < count; i++) {
        const spread = o.spread == null ? Math.PI * 0.9 : o.spread;
        const base = direction === 0 ? rand(0, Math.PI * 2) : (direction > 0 ? 0 : Math.PI) + rand(-spread / 2, spread / 2);
        const speed = rand(o.minSpeed == null ? 160 : o.minSpeed, o.maxSpeed == null ? 460 : o.maxSpeed);
        particle({
          x,
          y,
          vx: Math.cos(base) * speed,
          vy: Math.sin(base) * speed - rand(0, 60),
          gravity: o.gravity == null ? 900 : o.gravity,
          drag: 2.2,
          life: rand(0.18, 0.42),
          size: rand(1.6, 3),
          color: pick(colors),
          shape: "spark",
          length: rand(5, 11),
          glow: o.glow || 0,
          fade: "linear",
        });
      }
    }

    /** Éclats carrés (K.O., magie, débris). */
    function burst(x, y, options) {
      const o = options || {};
      const count = o.count == null ? 16 : o.count;
      const colors = o.colors || [o.color || "#ffffff"];
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(o.minSpeed == null ? 60 : o.minSpeed, o.maxSpeed == null ? 300 : o.maxSpeed);
        particle({
          x: x + rand(-(o.radius || 6), o.radius || 6),
          y: y + rand(-(o.radius || 6), o.radius || 6),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (o.lift || 80),
          gravity: o.gravity == null ? 700 : o.gravity,
          drag: o.drag == null ? 1.4 : o.drag,
          life: rand(o.minLife || 0.35, o.maxLife || 0.8),
          size: rand(o.minSize || 2.5, o.maxSize || 6),
          color: pick(colors),
          shape: o.shape || "square",
          rotation: rand(0, Math.PI),
          spin: rand(-9, 9),
          glow: o.glow || 0,
          fade: "late",
        });
      }
    }

    /** Petits nuages de poussière au sol (atterrissage, course, dérapage). */
    function dust(x, y, options) {
      const o = options || {};
      const count = o.count == null ? 6 : o.count;
      const direction = o.direction == null ? 0 : o.direction;
      for (let i = 0; i < count; i++) {
        const side = direction === 0 ? (i % 2 ? 1 : -1) : -direction;
        particle({
          x: x + rand(-8, 8),
          y: y + rand(-3, 1),
          vx: side * rand(30, 110) + rand(-20, 20),
          vy: -rand(20, 70),
          gravity: -60,
          drag: 3,
          life: rand(0.3, 0.55),
          size: rand(3, 6.5),
          color: pick(["rgba(255, 246, 225, 0.85)", "rgba(226, 214, 190, 0.8)", "rgba(255, 255, 255, 0.7)"]),
          shape: "circle",
          fade: "linear",
          shrink: false,
        });
      }
    }

    /** Anneau d'onde de choc qui s'élargit. */
    function ring(x, y, options) {
      const o = options || {};
      if (rings.length >= MAX_RINGS) rings.shift();
      rings.push({
        x,
        y,
        from: o.from == null ? 4 : o.from,
        to: o.to == null ? 40 : o.to,
        life: o.duration == null ? 0.35 : o.duration,
        maxLife: o.duration == null ? 0.35 : o.duration,
        color: o.color || "#ffffff",
        width: o.width == null ? 3 : o.width,
        squash: o.squash == null ? 1 : o.squash,
      });
    }

    /** Texte flottant (dégâts, « K.O. ! », « +12 »). */
    function text(x, y, value, options) {
      const o = options || {};
      if (texts.length >= MAX_TEXTS) texts.shift();
      texts.push({
        x: x + rand(-6, 6),
        y,
        text: String(value),
        color: o.color || "#ffffff",
        stroke: o.stroke || "rgba(10, 20, 40, 0.9)",
        size: o.size || 16,
        life: o.duration || 0.9,
        maxLife: o.duration || 0.9,
        vx: o.vx == null ? rand(-18, 18) : o.vx,
        vy: o.vy == null ? -70 : o.vy,
        weight: o.weight || 900,
      });
    }

    function flash(options) {
      const o = options || {};
      flashes.push({
        color: o.color || "#ffffff",
        alpha: o.alpha == null ? 0.3 : o.alpha,
        life: o.duration || 0.12,
        maxLife: o.duration || 0.12,
      });
      if (flashes.length > 6) flashes.shift();
    }

    function doShake(intensity, duration) {
      // La secousse la plus forte l'emporte, sans se cumuler à l'infini.
      if (intensity >= shake.intensity * (shake.time / Math.max(0.001, shake.duration))) {
        shake.intensity = Math.min(26, intensity);
        shake.duration = duration;
        shake.time = duration;
        shake.seed = Math.random() * 1000;
      }
    }

    // ───────────────────────── Compositions ─────────────────────────
    /** Traînée derrière un projectile en vol, selon son style. */
    function trail(x, y, style, color, facing) {
      if (style === "shuriken") {
        particle({
          x,
          y: y + rand(-2, 2),
          vx: -facing * rand(10, 40),
          vy: rand(-8, 8),
          life: rand(0.14, 0.26),
          size: rand(2, 3.5),
          color: pick(["rgba(255,255,255,0.8)", withAlpha(color, 0.8)]),
          shape: "circle",
          fade: "linear",
        });
      } else if (style === "arrow") {
        particle({
          x: x - facing * rand(6, 14),
          y: y + rand(-3, 3),
          vx: -facing * rand(20, 60),
          vy: rand(-12, 12),
          life: rand(0.12, 0.22),
          size: rand(1.2, 2),
          color: pick(["rgba(255,255,255,0.75)", withAlpha(color, 0.7)]),
          shape: "spark",
          length: rand(6, 14),
          rotation: facing > 0 ? 0 : Math.PI,
          fade: "linear",
        });
      } else if (style === "orb") {
        const angle = rand(0, Math.PI * 2);
        particle({
          x: x + Math.cos(angle) * 6,
          y: y + Math.sin(angle) * 6,
          vx: Math.cos(angle) * rand(10, 40) - facing * rand(20, 50),
          vy: Math.sin(angle) * rand(10, 40) - 20,
          gravity: -40,
          life: rand(0.3, 0.6),
          size: rand(1.5, 3.5),
          color: pick(["#ffffff", color, "#9b7bff"]),
          shape: "star",
          spin: rand(-6, 6),
          glow: 8,
          fade: "linear",
        });
      }
    }

    /** Impact d'une attaque sur un joueur, selon le style de l'arme. */
    function impact(x, y, style, color, facing) {
      const dir = facing || 1;
      if (style === "slash") {
        sparks(x, y, { count: 16, direction: dir, color, spread: Math.PI * 1.1, maxSpeed: 560, glow: 6 });
        ring(x, y, { from: 6, to: 46, duration: 0.28, color: "#ffffff", width: 3 });
        ring(x, y, { from: 2, to: 30, duration: 0.22, color, width: 2 });
        burst(x, y, { count: 6, colors: ["#ffffff", color], minSize: 2, maxSize: 4, maxSpeed: 220 });
      } else if (style === "arrow") {
        sparks(x, y, { count: 8, direction: -dir, color: "#f0e6c8", spread: Math.PI * 0.8, maxSpeed: 320 });
        burst(x, y, { count: 7, colors: ["#d7b27c", "#8d6a3b", color], minSize: 1.8, maxSize: 3.2, maxSpeed: 260 });
        ring(x, y, { from: 3, to: 26, duration: 0.2, color, width: 2 });
      } else if (style === "orb") {
        burst(x, y, { count: 18, colors: ["#ffffff", color, "#7a5cff", "#ffd4ff"], shape: "star", glow: 10, gravity: 120, maxSpeed: 260, minSize: 2, maxSize: 5 });
        ring(x, y, { from: 6, to: 54, duration: 0.4, color, width: 4 });
        ring(x, y, { from: 2, to: 32, duration: 0.3, color: "#ffffff", width: 2 });
      } else {
        sparks(x, y, { count: 10, direction: dir, color, spread: Math.PI * 1.3, maxSpeed: 420 });
        ring(x, y, { from: 3, to: 30, duration: 0.22, color: "#ffffff", width: 2 });
      }
    }

    /** Petit effet au départ d'une attaque (lancer, tir, incantation). */
    function muzzle(x, y, style, color, facing) {
      const dir = facing || 1;
      if (style === "orb") {
        burst(x, y, { count: 8, colors: ["#ffffff", color], shape: "star", glow: 8, gravity: -120, maxSpeed: 90, minSize: 1.5, maxSize: 3.5, radius: 10 });
        ring(x, y, { from: 18, to: 4, duration: 0.2, color, width: 2 });
      } else if (style === "arrow") {
        sparks(x, y, { count: 5, direction: dir, color: "#ffffff", spread: 0.5, minSpeed: 300, maxSpeed: 520, gravity: 0 });
      } else if (style === "shuriken") {
        dust(x, y + 4, { count: 3, direction: dir });
      }
    }

    /** Explosion de K.O. : éclats aux couleurs du héros, onde de choc, flash. */
    function knockout(x, y, color) {
      burst(x, y, { count: 34, colors: [color, "#ffffff", "#ffd166", "#2b2b2b"], minSpeed: 120, maxSpeed: 460, minSize: 2.5, maxSize: 7, lift: 160 });
      sparks(x, y, { count: 18, direction: 0, color, maxSpeed: 520, glow: 4 });
      ring(x, y, { from: 8, to: 96, duration: 0.5, color: "#ffffff", width: 4 });
      ring(x, y, { from: 4, to: 70, duration: 0.42, color, width: 3 });
      dust(x, y + 24, { count: 10 });
    }

    /** Réapparition : colonne d'étincelles montantes et anneau au sol (footY = niveau des pieds). */
    function respawn(x, footY, color) {
      for (let i = 0; i < 24; i++) {
        particle({
          x: x + rand(-18, 18),
          y: footY - rand(0, 56),
          vx: rand(-15, 15),
          vy: -rand(90, 260),
          gravity: -40,
          drag: 1.2,
          life: rand(0.5, 1),
          size: rand(1.8, 4),
          color: pick(["#ffffff", color, "#fff1b8"]),
          shape: "star",
          spin: rand(-5, 5),
          glow: 6,
          fade: "linear",
        });
      }
      ring(x, footY - 2, { from: 6, to: 58, duration: 0.5, color, width: 3, squash: 0.3 });
      ring(x, footY - 30, { from: 50, to: 6, duration: 0.4, color: "#ffffff", width: 2 });
    }

    /**
     * Brins d'herbe projetés par le passage d'un personnage : petites feuilles
     * effilées qui tournent, lancées dans le sens de la marche.
     */
    function blades(x, y, options) {
      const o = options || {};
      const count = o.count == null ? 3 : o.count;
      const direction = o.direction == null ? 0 : o.direction; // -1, 0, 1
      for (let i = 0; i < count; i++) {
        const side = direction === 0 ? (i % 2 ? 1 : -1) : direction;
        particle({
          x: x + rand(-8, 8),
          y: y + rand(-5, 3),
          vx: side * rand(35, 120),
          vy: -rand(60, 150),
          gravity: 480,
          drag: 1.2,
          life: rand(0.45, 0.8),
          size: rand(2.2, 3.4),
          color: pick(BLADE_COLORS),
          shape: "blade",
          rotation: rand(0, Math.PI * 2),
          spin: rand(-9, 9),
          fade: "late",
          shrink: false,
        });
      }
    }

    /** Étincelles de soin (régénération qui démarre). */
    function heal(x, y) {
      for (let i = 0; i < 7; i++) {
        particle({
          x: x + rand(-16, 16),
          y: y + rand(-6, 26),
          vx: rand(-8, 8),
          vy: -rand(30, 70),
          life: rand(0.6, 1),
          size: rand(1.6, 3),
          color: pick(["#8dffb0", "#e6ffe9", "#4cd97b"]),
          shape: "plus",
          fade: "linear",
          shrink: false,
        });
      }
    }

    // ───────────────────────── Mise à jour ─────────────────────────
    function update(delta) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= delta;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * delta;
        if (p.drag) {
          const k = Math.max(0, 1 - p.drag * delta);
          p.vx *= k;
          p.vy *= k;
        }
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.rotation += p.spin * delta;
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.life -= delta;
        if (t.life <= 0) {
          texts.splice(i, 1);
          continue;
        }
        t.x += t.vx * delta;
        t.y += t.vy * delta;
        t.vy *= Math.max(0, 1 - 2.6 * delta);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].life -= delta;
        if (rings[i].life <= 0) rings.splice(i, 1);
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].life -= delta;
        if (flashes[i].life <= 0) flashes.splice(i, 1);
      }
      if (shake.time > 0) {
        shake.time = Math.max(0, shake.time - delta);
        const k = shake.time / Math.max(0.001, shake.duration);
        const amplitude = shake.intensity * k * k;
        const t = (shake.duration - shake.time) * 60 + shake.seed;
        shake.x = Math.sin(t * 1.7) * amplitude * rand(0.6, 1);
        shake.y = Math.cos(t * 2.3) * amplitude * rand(0.6, 1) * 0.7;
        if (shake.time === 0) {
          shake.x = 0;
          shake.y = 0;
          shake.intensity = 0;
        }
      }
      vignettePulse += delta;
    }

    // ───────────────────────── Dessin ─────────────────────────
    function drawParticle(ctx, p, camX) {
      const k = p.life / p.maxLife;
      const alpha = p.fade === "linear" ? k : k < 0.35 ? k / 0.35 : 1;
      const size = p.shrink ? p.size * (0.35 + 0.65 * k) : p.size;
      const sx = p.x - camX;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.glow;
      } else {
        ctx.shadowBlur = 0;
      }
      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(sx, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "spark") {
        const angle = p.length ? Math.atan2(p.vy, p.vx) : p.rotation;
        ctx.lineCap = "round";
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(sx, p.y);
        ctx.lineTo(sx - Math.cos(angle) * p.length * (0.4 + 0.6 * k), p.y - Math.sin(angle) * p.length * (0.4 + 0.6 * k));
        ctx.stroke();
      } else if (p.shape === "star") {
        ctx.save();
        ctx.translate(sx, p.y);
        ctx.rotate(p.rotation);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8;
          const r = i % 2 === 0 ? size : size * 0.4;
          if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.shape === "blade") {
        // Brin d'herbe : petite feuille effilée, qui tourne sur elle-même.
        ctx.save();
        ctx.translate(sx, p.y);
        ctx.rotate(p.rotation);
        ctx.beginPath();
        ctx.moveTo(-size * 1.8, 0);
        ctx.quadraticCurveTo(0, -size * 0.9, size * 1.8, 0);
        ctx.quadraticCurveTo(0, size * 0.9, -size * 1.8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.shape === "plus") {
        ctx.fillRect(sx - size / 2, p.y - size * 1.5, size, size * 3);
        ctx.fillRect(sx - size * 1.5, p.y - size / 2, size * 3, size);
      } else {
        ctx.save();
        ctx.translate(sx, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }

    function draw(ctx, camX) {
      if (!particles.length && !rings.length && !texts.length) return;
      ctx.save();
      particles.forEach((p) => drawParticle(ctx, p, camX));
      ctx.shadowBlur = 0;
      ctx.lineCap = "butt";

      rings.forEach((r) => {
        const k = 1 - r.life / r.maxLife;
        const eased = 1 - (1 - k) * (1 - k);
        const radius = r.from + (r.to - r.from) * eased;
        ctx.globalAlpha = clamp(1 - k, 0, 1) * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = Math.max(0.5, r.width * (1 - k * 0.7));
        ctx.beginPath();
        ctx.ellipse(r.x - camX, r.y, Math.max(0.1, radius), Math.max(0.1, radius * r.squash), 0, 0, Math.PI * 2);
        ctx.stroke();
      });

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      texts.forEach((t) => {
        const age = t.maxLife - t.life;
        const pop = age < 0.12 ? 1.5 - (age / 0.12) * 0.5 : 1;
        const k = t.life / t.maxLife;
        ctx.globalAlpha = clamp(k < 0.3 ? k / 0.3 : 1, 0, 1);
        ctx.font = t.weight + " " + Math.round(t.size * pop) + "px " + FONT_STACK;
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(t.text, Math.round(t.x - camX), Math.round(t.y));
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, Math.round(t.x - camX), Math.round(t.y));
      });
      ctx.restore();
    }

    /** Flashs d'écran et vignette de vie basse (espace écran). */
    function drawOverlay(ctx, width, height) {
      if (!flashes.length && vignetteLevel <= 0) return;
      ctx.save();
      flashes.forEach((f) => {
        const k = f.life / f.maxLife;
        ctx.globalAlpha = clamp(f.alpha * k, 0, 1);
        ctx.fillStyle = f.color;
        ctx.fillRect(0, 0, width, height);
      });
      if (vignetteLevel > 0) {
        const pulse = 0.75 + 0.25 * Math.sin(vignettePulse * 6);
        const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.32, width / 2, height / 2, Math.max(width, height) * 0.72);
        gradient.addColorStop(0, "rgba(180, 0, 20, 0)");
        gradient.addColorStop(1, "rgba(180, 0, 20, " + (0.55 * vignetteLevel * pulse).toFixed(3) + ")");
        ctx.globalAlpha = 1;
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    return {
      update,
      draw,
      drawOverlay,
      particle,
      sparks,
      burst,
      dust,
      ring,
      text,
      flash,
      trail,
      impact,
      muzzle,
      knockout,
      respawn,
      heal,
      blades,
      shake: doShake,
      setVignette(level) {
        vignetteLevel = clamp(level, 0, 1);
      },
      get shakeX() {
        return shake.x;
      },
      get shakeY() {
        return shake.y;
      },
      get count() {
        return particles.length + texts.length + rings.length;
      },
      clear() {
        particles.length = 0;
        texts.length = 0;
        rings.length = 0;
        flashes.length = 0;
        shake.time = 0;
        shake.x = 0;
        shake.y = 0;
      },
    };
  }

  return { create, withAlpha };
})();
