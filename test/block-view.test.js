"use strict";

/**
 * Vérifie le rendu du terrain en blocs sur un contexte 2D factice : seuls les
 * blocs visibles sont dessinés, un bloc miné laisse voir le fond de grotte, le
 * contour et les fissures se dessinent, les objets lâchés aussi, et les quatre
 * textures pixel art sont bien présentes dans assets/blocks/.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const src = path.join(root, "src");

/** Contexte 2D qui compte les appels de dessin sans rien afficher. */
function fakeContext() {
  const calls = { fillRect: 0, strokeRect: 0, drawImage: 0, fill: 0, ellipse: 0, gradient: 0 };
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: () => calls.fill++,
    ellipse: () => calls.ellipse++,
    fillRect: () => calls.fillRect++,
    strokeRect: () => calls.strokeRect++,
    drawImage: () => calls.drawImage++,
    clearRect: noop,
    createLinearGradient: () => {
      calls.gradient++;
      return gradient;
    },
    translate: noop,
    scale: noop,
    setTransform: noop,
  };
}

const sandbox = {
  window: {},
  console,
  document: {
    createElement: () => {
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => fakeContext();
      return canvas;
    },
  },
  // Pas d'images décodées sous Node : la vue dessine ses couleurs de secours.
  Image: function Image() {
    this.complete = false;
    this.naturalWidth = 0;
  },
};
vm.createContext(sandbox);
["terrain.js", "block-view.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(src, file), "utf8"), sandbox));

const Terrain = sandbox.window.PixWorldTerrain;
const View = sandbox.window.PixWorldBlockView;
assert(View && typeof View.create === "function", "La vue des blocs est chargée");
assert.throws(() => View.create({}), /terrain/, "Une vue sans terrain est refusée");

// Les quatre textures existent et sont des pixel art 16 × 16 (PNG).
["grass", "dirt", "stone", "bedrock"].forEach((type) => {
  const file = path.join(root, View.TEXTURES[type]);
  assert(fs.existsSync(file), "La texture « " + type + " » est présente (" + View.TEXTURES[type] + ")");
  const header = fs.readFileSync(file).subarray(0, 24);
  assert.strictEqual(header.subarray(1, 4).toString("ascii"), "PNG", "Fichier PNG : " + View.TEXTURES[type]);
  assert.strictEqual(header.readUInt32BE(16), 16, "Largeur 16 px : " + View.TEXTURES[type]);
  assert.strictEqual(header.readUInt32BE(20), 16, "Hauteur 16 px : " + View.TEXTURES[type]);
});

const terrain = Terrain.create({ width: 3000 });
const view = View.create({ terrain });
const width = 300;
const height = 600;
const top = 100;

// Fond de grotte : un seul dégradé, une seule zone remplie.
{
  const ctx = fakeContext();
  view.drawBackdrop(ctx, { width, height, top });
  assert.strictEqual(ctx.calls.gradient, 1, "Le fond de grotte est un dégradé");
  assert.strictEqual(ctx.calls.fillRect, 1, "Le fond de grotte couvre le dessous de la surface");
  const hidden = fakeContext();
  view.drawBackdrop(hidden, { width, height, top: height + 10 });
  assert.strictEqual(hidden.calls.fillRect, 0, "Au-dessus du bas de l'écran : rien à dessiner");
}

// Blocs visibles : 12 colonnes (0 à 11) × 16 lignes, sans air.
{
  const ctx = fakeContext();
  view.drawBlocks(ctx, { camX: 0, top, width, height });
  assert.strictEqual(ctx.calls.fillRect, 12 * 16, "Douze colonnes visibles, seize lignes de blocs chacune");
  const minedCtx = fakeContext();
  terrain.breakAt(3, 0);
  view.drawBlocks(minedCtx, { camX: 0, top, width, height });
  assert.strictEqual(minedCtx.calls.fillRect, 12 * 16 - 1, "Un bloc miné n'est plus dessiné : on voit la grotte");
}

// Défilement : les colonnes hors de l'écran ne sont pas dessinées.
{
  const ctx = fakeContext();
  view.drawBlocks(ctx, { camX: 1500, top, width, height });
  assert(ctx.calls.fillRect <= (width / 30 + 3) * 16, "Seules les colonnes de l'écran sont dessinées");
  assert(ctx.calls.fillRect >= (width / 30) * 16, "Les colonnes visibles sont bien dessinées");
}

// Contour : toujours un rectangle plein et deux tracés ; cassé en rouge si invalide.
{
  const ctx = fakeContext();
  view.drawOutline(ctx, { col: 2, row: 1, camX: 0, top, valid: true });
  assert.strictEqual(ctx.calls.fillRect, 1, "Le bloc visé est légèrement éclairci");
  assert.strictEqual(ctx.calls.strokeRect, 2, "Contour : une ombre et un trait net");
  assert.strictEqual(ctx.strokeStyle, "#ffffff", "Contour blanc à portée");
  const bad = fakeContext();
  view.drawOutline(bad, { col: 2, row: 1, camX: 0, top, valid: false });
  assert.strictEqual(bad.strokeStyle, "#ff6b6b", "Contour rouge hors de portée ou incassable");
}

// Fissures : rien au début, puis une étape de plus à mesure du minage.
{
  const none = fakeContext();
  view.drawCrack(none, { col: 2, row: 1, camX: 0, top, progress: 0 });
  assert.strictEqual(none.calls.drawImage, 0, "Pas de fissure au premier instant");
  const half = fakeContext();
  view.drawCrack(half, { col: 2, row: 1, camX: 0, top, progress: 0.5 });
  assert.strictEqual(half.calls.drawImage, 1, "Une fissure à mi-minage");
  assert.strictEqual(view.crackStages, 10, "Dix étapes de fissures");
}

// Objets lâchés : une ombre et une icône, hors de l'écran ignorés.
{
  const ctx = fakeContext();
  view.drawDrops(ctx, {
    items: [
      { type: "stone", x: 100, feet: 40, age: 0.3, seed: 1 },
      { type: "dirt", x: 5000, feet: 40, age: 0.3, seed: 2 },
    ],
    camX: 0,
    top,
    width,
  });
  assert.strictEqual(ctx.calls.ellipse, 1, "Seul l'objet visible a une ombre");
  assert.strictEqual(ctx.calls.fillRect, 1, "Son icône est dessinée (couleur de secours sans image)");
}

console.log("block-view.test.js : ok");
