"use strict";

/**
 * Vérifie le moteur d'effets visuels hors navigateur : les émetteurs ne
 * dépassent jamais leurs plafonds, les effets s'éteignent avec le temps et
 * le dessin s'exécute sans erreur sur un contexte 2D factice.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "effects.js"), "utf8");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Effects = sandbox.window.PixWorldEffects;
assert(Effects && typeof Effects.create === "function", "Le moteur d'effets est chargé");
assert.strictEqual(Effects.withAlpha("#ff8800", 0.5), "rgba(255, 136, 0, 0.5)", "withAlpha convertit l'hexa en rgba");
assert.strictEqual(Effects.withAlpha("#f80", 1), "rgba(255, 136, 0, 1)", "withAlpha accepte l'hexa court");
assert.strictEqual(Effects.withAlpha("red", 0.3), "red", "withAlpha laisse passer les autres couleurs");

/** Contexte 2D factice : accepte n'importe quel appel et compte les tracés. */
function fakeContext() {
  const calls = { fill: 0, stroke: 0, fillText: 0, drawImage: 0 };
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(target, property) {
        if (property === "calls") return calls;
        if (property === "createRadialGradient" || property === "createLinearGradient") return () => gradient;
        if (property === "measureText") return () => ({ width: 10 });
        return (...args) => {
          if (property in calls) calls[property] += 1;
          return undefined;
        };
      },
      set() {
        return true;
      },
    },
  );
}

const fx = Effects.create();
assert.strictEqual(fx.count, 0, "Aucun effet au départ");

// Les plafonds tiennent même quand on spamme les émetteurs.
for (let i = 0; i < 200; i++) {
  fx.knockout(100 + i, 200, "#ff6b73");
  fx.impact(100 + i, 180, i % 2 ? "slash" : "orb", "#8ecbff", 1);
  fx.text(100, 100, "-12");
  fx.ring(100, 100, {});
}
assert(fx.count <= 700 + 40 + 40, "Particules, textes et anneaux restent plafonnés (" + fx.count + ")");
assert(fx.count > 500, "Les émetteurs produisent bien des effets");

// Secousse : amplitude bornée, puis retour à zéro.
fx.shake(999, 0.3);
fx.update(1 / 60);
assert(Math.abs(fx.shakeX) <= 26 && Math.abs(fx.shakeY) <= 26, "La secousse de caméra est bornée");
for (let i = 0; i < 60; i++) fx.update(1 / 60);
assert.strictEqual(fx.shakeX, 0, "La secousse s'arrête d'elle-même");

// Dessin sans erreur sur le contexte factice.
const ctx = fakeContext();
fx.knockout(300, 200, "#ff6b73");
fx.text(300, 180, "K.O. !");
fx.update(1 / 60);
assert(fx.count > 0, "Des effets sont actifs avant le dessin");
fx.flash({ color: "#ff0000", alpha: 0.3, duration: 0.2 });
fx.setVignette(0.8);
assert.doesNotThrow(() => fx.draw(ctx, 0), "draw() s'exécute");
assert.doesNotThrow(() => fx.drawOverlay(ctx, 800, 600), "drawOverlay() s'exécute");
assert(ctx.calls.fill > 0 && ctx.calls.stroke > 0, "Le dessin trace bien des formes");

// Tout s'éteint au bout de quelques secondes.
for (let i = 0; i < 240; i++) fx.update(1 / 60);
assert.strictEqual(fx.count, 0, "Toutes les particules, textes et anneaux ont disparu");

// Les émetteurs unitaires existent et fonctionnent.
["sparks", "burst", "dust", "trail", "muzzle", "respawn", "heal"].forEach((name) => {
  assert.strictEqual(typeof fx[name], "function", "Émetteur " + name + " disponible");
});
fx.trail(10, 10, "arrow", "#ffffff", 1);
fx.muzzle(10, 10, "orb", "#ffffff", -1);
fx.respawn(10, 10, "#ffffff");
fx.heal(10, 10);
assert(fx.count > 0, "Les émetteurs unitaires produisent des effets");
fx.clear();
assert.strictEqual(fx.count, 0, "clear() vide tout");
console.log("  ok   Plafonds, secousse, dessin et extinction des effets");
console.log("Moteur d'effets valide");
