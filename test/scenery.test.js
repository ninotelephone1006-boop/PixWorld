"use strict";

/**
 * Vérifie le rendu du monde plat hors navigateur : chaque couche se dessine
 * sans erreur sur un contexte 2D factice, la texture d'herbe se crée, et
 * les particules d'ambiance de la prairie restent bornées.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "src");
const sandbox = { window: {}, console, Math };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "world.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "scenery.js"), "utf8"), sandbox);

const World = sandbox.window.PixWorldWorld;
const Scenery = sandbox.window.PixWorldScenery;
assert(Scenery && typeof Scenery.create === "function", "Le module de décor est chargé");

/** Contexte 2D factice : enregistre les appels de dessin sans rien afficher. */
function fakeContext() {
  const calls = { fillRect: 0, arc: 0, fill: 0, drawImage: 0, createPattern: 0 };
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: () => calls.arc++,
    ellipse: noop,
    fill: () => calls.fill++,
    stroke: noop,
    clip: noop,
    translate: noop,
    rect: noop,
    fillText: noop,
    clearRect: noop,
    fillRect: () => calls.fillRect++,
    drawImage: () => calls.drawImage++,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => {
      calls.createPattern++;
      return { setTransform: noop };
    },
    strokeRect: noop,
    scale: noop,
    rotate: noop,
    setTransform: noop,
    draw: noop,
  };
  return ctx;
}

// Document minimal : seule la création de toiles (textures) est nécessaire.
sandbox.document = {
  createElement: () => {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => fakeContext();
    return canvas;
  },
};
sandbox.DOMMatrix = function DOMMatrix() {
  this.translate = () => this;
};

const world = World.create("pixworld");
const images = {}; // images absentes : les couches de prairie sont simplement ignorées
const scenery = Scenery.create({ world, images });

const ctx = fakeContext();
const width = 1280;
const height = 720;
const baseY = height - 128;

scenery.ensurePatterns(ctx);
assert(ctx.calls.createPattern >= 1, "Au moins la texture d'herbe est créée");
scenery.ensurePatterns(ctx);
assert(scenery.patternsReady, "Toutes les textures sont prêtes");

// Parcours du monde par la caméra : aucune erreur (monde plat, prairie partout).
const step = 700;
for (let camX = 0; camX < Math.min(world.width, 5000); camX += step) {
  const view = { width, height, camX, baseY, time: 3.2 };
  scenery.drawSky(ctx, width, height, camX, view.time);
  scenery.drawFarLayers(ctx, width, height, camX);
  scenery.drawTerrain(ctx, view);
  scenery.drawProps(ctx, view);
  scenery.drawPlatforms(ctx, view);
  scenery.drawGrade(ctx, width, height, camX);
}
assert(ctx.calls.fillRect > 0 && ctx.calls.fill > 0, "Le monde est dessiné");

// Le terrain est dessiné (une seule bande = prairie sur tout le monde).
const terrainCtx = fakeContext();
scenery.drawTerrain(terrainCtx, { width, height, camX: 0, baseY });
assert(terrainCtx.calls.fill >= 1, "Le terrain plat est dessiné");

// Particules d'ambiance de la prairie : bornées.
for (let i = 0; i < 400; i++) scenery.updateAmbient(1 / 60, width, height, "prairie");
const drawn = fakeContext();
scenery.drawAmbient(drawn);
assert(drawn.calls.fillRect <= Scenery.constants.MAX_AMBIENT, "Les particules restent bornées");
assert(drawn.calls.fillRect > 20, "Des particules d'ambiance sont visibles");

// Palette de la prairie (herbe) : complète.
const prairie = Scenery.PALETTES.prairie;
assert(prairie && prairie.skyTop && prairie.skyBottom && prairie.surface, "Palette de la prairie complète");
assert.strictEqual(prairie.style, "grass", "Style herbe");

console.log("scenery.test.js : ok");
