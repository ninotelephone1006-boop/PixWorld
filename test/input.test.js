"use strict";

/** Orientation du sprite : curseur, marche inverse, caméra et contrôles sans souris. */
const assert = require("node:assert/strict");
const { createBrowser, StubEvent } = require("./game-boot.test.js");
const browsers = [];

function createGame() {
  const browser = createBrowser();
  browsers.push(browser);
  assert.equal(browser.load(), null);
  const socket = browser.sockets[0];
  socket.open();
  browser.document.querySelector("#menu-name-input").value = "Test";
  browser.document.querySelector("#menu-form").dispatchEvent(new StubEvent("submit", { bubbles: true, cancelable: true }));
  browser.runFrames(1);
  const canvas = browser.document.querySelector("#world");
  return {
    browser, socket,
    dbg: browser.sandbox.PixWorldDebug,
    fire(type, props = {}) {
      browser.sandbox.dispatchEvent({ type, target: canvas, preventDefault() {}, ...props });
    },
  };
}

function point(game, x, target, pointerType = "mouse") {
  game.fire("pointermove", { clientX: x, clientY: 300, pointerType, ...(target ? { target } : {}) });
}

function move(game, code, key, frames) {
  game.fire("keydown", { code, key, repeat: false });
  game.browser.runFrames(frames);
  game.fire("keyup", { code, key });
}

try {
  const game = createGame();
  point(game, 20);
  game.browser.runFrames(4);
  assert.equal(game.socket.sent.filter((m) => m.t === "state").at(-1).f, -1,
    "Le sprite regarde le curseur à gauche, sans avoir à cliquer, et l'orientation est synchronisée");
  point(game, 1000);
  assert.equal(game.dbg.player.facing, 1, "Le regard suit immédiatement un mouvement de souris à droite");
  point(game, 20);
  const beforeRight = game.dbg.player.x;
  move(game, "KeyD", "d", 10);
  assert.ok(game.dbg.player.x > beforeRight, "On peut marcher vers la droite");
  assert.equal(game.dbg.player.facing, -1, "La marche ne remplace pas le regard vers le curseur à gauche");
  point(game, 1000);
  const beforeLeft = game.dbg.player.x;
  move(game, "KeyA", "a", 10);
  assert.ok(game.dbg.player.x < beforeLeft, "On peut marcher vers la gauche");
  assert.equal(game.dbg.player.facing, 1, "On peut regarder à droite tout en marchant à gauche");

  point(game, 20);
  point(game, game.dbg.player.x + 21 - game.dbg.camX + 2);
  game.browser.runFrames(4);
  assert.equal(game.dbg.player.facing, -1, "Une petite zone neutre au-dessus du sprite évite les retournements incessants");
  point(game, game.dbg.player.x + 21 - game.dbg.camX + 65);
  assert.equal(game.dbg.player.facing, 1);
  move(game, "KeyD", "d", 18);
  assert.equal(game.dbg.player.facing, -1, "Passer devant un curseur immobile retourne aussi le sprite");

  const camera = createGame();
  point(camera, 900);
  move(camera, "KeyD", "d", 180);
  assert.ok(camera.dbg.camX > 0, "La caméra a commencé à défiler");
  assert.ok(camera.dbg.player.x > 900, "Le joueur est plus loin dans le monde que l'abscisse écran du curseur");
  assert.equal(camera.dbg.player.facing, 1, "La visée utilise le repère écran avec le décalage de caméra");
  point(camera, 650);
  assert.equal(camera.dbg.player.facing, -1, "Le curseur est juste à gauche du joueur pendant le suivi de caméra");
  camera.browser.runFrames(50);
  assert.equal(camera.dbg.player.facing, 1, "Le regard suit aussi le rattrapage de la caméra avec une souris immobile");

  const fallback = createGame();
  move(fallback, "KeyA", "a", 6);
  assert.equal(fallback.dbg.player.facing, -1, "Sans curseur connu, le clavier garde son orientation normale");
  move(fallback, "KeyD", "d", 6);
  assert.equal(fallback.dbg.player.facing, 1);
  point(fallback, 20);
  point(fallback, 20, null, "touch");
  move(fallback, "KeyD", "d", 6);
  assert.equal(fallback.dbg.player.facing, 1, "Un toucher ne verrouille pas le regard sur une ancienne position");
  point(fallback, 20);
  fallback.fire("blur");
  move(fallback, "KeyD", "d", 6);
  assert.equal(fallback.dbg.player.facing, 1, "Quitter la fenêtre libère la visée à la souris");

  const hotbar = fallback.browser.document.querySelector("#hotbar");
  point(fallback, 1200, hotbar);
  move(fallback, "KeyA", "a", 6);
  assert.equal(fallback.dbg.player.facing, 1, "Le regard continue de suivre le curseur au-dessus du HUD");
  fallback.fire("pointerdown", { button: 0, clientX: 20, clientY: 300, pointerType: "mouse", target: hotbar });
  assert.equal(fallback.dbg.player.facing, -1, "La position du clic met aussi le regard à jour");
  fallback.browser.runFrames(10);
  assert.equal(fallback.dbg.projectiles().length, 0, "Viser au-dessus du HUD ne déclenche aucune attaque");

  const pause = createGame();
  point(pause, 20);
  pause.fire("keydown", { code: "Escape", key: "Escape", repeat: false });
  point(pause, 1000, pause.browser.document.querySelector("#game-menu"));
  pause.browser.runFrames(8);
  assert.equal(pause.dbg.player.facing, -1, "Le menu pause ne retourne pas le personnage");
  pause.fire("keydown", { code: "Escape", key: "Escape", repeat: false });
  pause.browser.runFrames(4);
  assert.equal(pause.dbg.player.facing, 1, "À la reprise, le personnage regarde la position actuelle du curseur");

  const shooting = createGame();
  point(shooting, 20);
  shooting.fire("keydown", { code: "KeyD", key: "d", repeat: false });
  shooting.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  shooting.browser.runFrames(8);
  shooting.fire("keyup", { code: "KeyD", key: "d" });
  assert.equal(shooting.dbg.player.facing, -1);
  const projectile = shooting.dbg.projectiles().find((p) => p.owner === "self");
  assert.ok(projectile && projectile.x < shooting.dbg.player.x + 21,
    "Une attaque différée part vers le curseur, même en marchant dans l'autre sens");

  console.log("input.test.js : regard vers le curseur, marche inverse, caméra, pause, HUD, toucher et attaques : ok");
} finally {
  browsers.forEach((browser) => browser.dispose());
}
