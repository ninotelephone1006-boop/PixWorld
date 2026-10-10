"use strict";

/**
 * Caméra en jeu : les flèches tournent la vue sans déplacer le personnage,
 * A/D continuent de marcher, et la projection sud reste l'identité.
 */
const assert = require("node:assert/strict");
const { createBrowser } = require("./game-boot.test.js");

const browser = createBrowser({ noServer: true });
const failure = browser.load();
assert.equal(failure, null, "les scripts se chargent sans erreur : " + failure);

const document = browser.document;
const sandbox = browser.sandbox;
const canvas = document.querySelector("#world");

document.querySelector("#menu-name-input").value = "Kage";
document.querySelector("#menu-form").dispatchEvent({
  type: "submit", bubbles: true, cancelable: true,
  target: document.querySelector("#menu-form"), preventDefault() {},
});

const dbg = sandbox.PixWorldDebug;
assert(dbg && dbg.camera, "l'accroche caméra est exposée");
assert.equal(dbg.camera.facing, "south");
assert.equal(dbg.camera.identity, true);

function fire(type, props) {
  sandbox.dispatchEvent(Object.assign({ type, target: canvas, preventDefault() {} }, props));
}

const startX = dbg.player.x;
fire("keydown", { code: "ArrowRight", key: "ArrowRight", repeat: false });
browser.runFrames(40);
fire("keyup", { code: "ArrowRight", key: "ArrowRight" });
assert.equal(dbg.player.x, startX, "La flèche droite ne marche plus : elle tourne la caméra");
assert.equal(dbg.camera.facing, "east", "Flèche droite : on regarde l'est");
assert.ok(dbg.camera.yaw > 0.8, "L'azimut a tourné en douceur vers π/2 (" + dbg.camera.yaw + ")");
assert.equal(dbg.camera.identity, false);

fire("keydown", { code: "ArrowUp", key: "ArrowUp", repeat: false });
browser.runFrames(40);
fire("keyup", { code: "ArrowUp", key: "ArrowUp" });
assert.equal(dbg.camera.facing, "north");

fire("keydown", { code: "ArrowLeft", key: "ArrowLeft", repeat: false });
browser.runFrames(40);
fire("keyup", { code: "ArrowLeft", key: "ArrowLeft" });
assert.equal(dbg.camera.facing, "west");

fire("keydown", { code: "ArrowDown", key: "ArrowDown", repeat: false });
browser.runFrames(40);
fire("keyup", { code: "ArrowDown", key: "ArrowDown" });
assert.equal(dbg.camera.facing, "south");
assert.equal(dbg.camera.identity, true, "Flèche bas : retour à la vue sud, projection identité");

const before = dbg.player.x;
fire("keydown", { code: "KeyD", key: "d", repeat: false });
browser.runFrames(12);
fire("keyup", { code: "KeyD", key: "d" });
assert.ok(dbg.player.x > before, "A/D déplacent toujours le personnage (" + dbg.player.x + ")");

console.log("game-camera.test.js : flèches = caméra, A/D = marche, vue sud inchangée : ok");
