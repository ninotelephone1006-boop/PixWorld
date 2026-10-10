"use strict";

/**
 * Caméra en jeu : seule la vue de base est conservée.
 * Les flèches déplacent le personnage et la vue sud reste fixe.
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
browser.runFrames(20);
fire("keyup", { code: "ArrowRight", key: "ArrowRight" });
assert.ok(dbg.player.x > startX, "La flèche droite déplace le personnage vers la droite (" + dbg.player.x + ")");
assert.equal(dbg.camera.facing, "south", "La caméra reste sur la vue de base");
assert.equal(dbg.camera.yaw, 0);
assert.equal(dbg.camera.identity, true);

const beforeLeft = dbg.player.x;
fire("keydown", { code: "ArrowLeft", key: "ArrowLeft", repeat: false });
browser.runFrames(20);
fire("keyup", { code: "ArrowLeft", key: "ArrowLeft" });
assert.ok(dbg.player.x < beforeLeft, "La flèche gauche déplace le personnage vers la gauche (" + dbg.player.x + ")");
assert.equal(dbg.camera.facing, "south");

fire("keydown", { code: "ArrowUp", key: "ArrowUp", repeat: false });
browser.runFrames(10);
fire("keyup", { code: "ArrowUp", key: "ArrowUp" });
assert.equal(dbg.camera.facing, "south");

fire("keydown", { code: "ArrowDown", key: "ArrowDown", repeat: false });
browser.runFrames(10);
fire("keyup", { code: "ArrowDown", key: "ArrowDown" });
assert.equal(dbg.camera.facing, "south");
assert.equal(dbg.camera.identity, true);

const beforeD = dbg.player.x;
fire("keydown", { code: "KeyD", key: "d", repeat: false });
browser.runFrames(12);
fire("keyup", { code: "KeyD", key: "d" });
assert.ok(dbg.player.x > beforeD, "A/D déplacent toujours le personnage (" + dbg.player.x + ")");

console.log("game-camera.test.js : vue de base conservée, flèches = marche, caméra fixe : ok");
