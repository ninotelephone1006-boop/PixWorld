"use strict";

/**
 * Caméra 2,5D : seule la vue de base (face sud, repère identité) est conservée,
 * les autres directions sont retirées. Occultation sous terre préservée.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "camera.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Camera = sandbox.window.PixWorldCamera;
assert(Camera && typeof Camera.create === "function", "Le module de caméra est chargé");
assert.equal(Camera.FACINGS.length, 1, "Seule la vue de base est conservée");
assert.equal(Camera.FACINGS[0].id, "south");

const view = { camX: 100, camY: 40, focusX: 300, focusY: 200, width: 800, height: 600, baseY: 120, blockSize: 48 };

const look = Camera.create();
assert.equal(look.facingId, "south");
assert.equal(look.isIdentity(), true, "La vue de base est l'identité");

const origin = look.project(180, 90, 0, view);
assert.equal(origin.x, 80, "x écran = monde - camX");
assert.equal(origin.y, 50, "y écran = monde - camY");

const back = look.unproject(origin.x, origin.y, view);
assert.ok(Math.abs(back.x - 180) < 1e-9, "unproject retrouve x");
assert.ok(Math.abs(back.y - 90) < 1e-9, "unproject retrouve y");

const lifted = look.project(180, 90, -48, view);
assert.notEqual(lifted.x, origin.x, "La profondeur décale le 3/4 en x");
assert.notEqual(lifted.y, origin.y, "La profondeur décale le 3/4 en y");

// Les autres vues sont retirées : les flèches ne changent plus la direction.
assert.equal(look.setFacingByArrow("ArrowRight"), false);
assert.equal(look.facingId, "south");
assert.equal(look.yaw, 0);
assert.equal(look.isIdentity(), true, "La caméra reste toujours sur la vue de base");

look.setFacingByArrow("ArrowUp");
assert.equal(look.facingId, "south");
look.setFacingByArrow("ArrowLeft");
assert.equal(look.facingId, "south");
look.setFacingByArrow("ArrowDown");
assert.equal(look.facingId, "south");

look.reset();
assert.equal(look.yaw, 0);
assert.equal(look.alpha(3, 0, 0), 1, "Sans occultation, les blocs sont opaques");

// Sous terre : le plafond au-dessus du joueur s'estompe.
look.updateOcclusion({ column: 3, row: 6, underground: true }, 1);
const ceiling = look.alpha(3, 2, 0);
assert.ok(ceiling < 0.5, "Un bloc au-dessus du joueur devient transparent (" + ceiling + ")");
assert.ok(look.alpha(3, 7, 0) > 0.9, "Le sol sous le joueur reste opaque");
assert.ok(look.alpha(20, 2, 0) > 0.9, "Un bloc loin du joueur reste opaque");

// En s'éloignant / en surface, l'opacité revient.
look.updateOcclusion({ column: 3, row: 0, underground: false }, 1);
assert.ok(look.alpha(3, 2, 0) > 0.95, "L'opacité revient quand le joueur s'éloigne");

const target = Camera.occlusionTarget(3, 1, 0, 3, 5, true);
assert.ok(target < 0.4, "La cible d'occultation est basse juste au-dessus");
assert.equal(Camera.occlusionTarget(3, 1, 0, 3, 0, false), 1, "En surface, rien ne s'estompe");

console.log("camera.test.js : vue de base conservée, autres directions retirées, occultation : ok");
