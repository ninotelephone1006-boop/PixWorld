"use strict";

/**
 * Partie complète « tête nue » : on pilote le vrai jeu (menu, boucle, entrées
 * souris/clavier) sans navigateur, grâce au harnachement de game-boot.test.js.
 *
 * Scénario joué :
 *  1. en surface, la caméra ne montre que deux rangées de blocs (camY = 0) ;
 *  2. on mine sous ses pieds jusqu'au fond : la caméra descend avec le joueur
 *     et la chute s'arrête sur la roche mère — jamais dans le vide ;
 *  3. la roche mère ne casse pas ;
 *  4. marcher vers la paroi d'un trou creusé bloque (collisions réelles) ;
 *  5. clic droit : un bloc est posé contre la paroi (jamais en l'air), puis
 *     cassé sans rien faire tomber d'autre ;
 *  6. en ligne, une case rebouchée entre deux images peut être minée de
 *     nouveau sans relâcher le bouton de la souris.
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
document.querySelector("#menu-form").dispatchEvent({ type: "submit", bubbles: true, cancelable: true, target: document.querySelector("#menu-form"), preventDefault() {} });

const dbg = sandbox.PixWorldDebug;
assert(dbg, "l'accroche de test est exposée");

function fire(type, props) {
  sandbox.dispatchEvent(Object.assign({ type, target: canvas, preventDefault() {} }, props));
}
function holdMine(x, y, frames) {
  fire("pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 7 });
  browser.runFrames(frames);
  fire("pointerup", { button: 0 });
}

// 1. Surface : deux rangées visibles, caméra verticale au repos.
assert.equal(dbg.groundY, 720 - 96, "La surface est à deux blocs du bas de l'écran");
assert.equal(dbg.camY, 0, "En surface, la caméra verticale est au repos");
assert.equal(dbg.player.grounded, true);

// 2. On mine sous ses pieds, couche par couche, jusqu'au fond du monde.
// Le joueur chevauche deux colonnes : on creuse les deux pour qu'il descende.
for (let row = 0; row < 14; row++) {
  holdMine(168, 648, 14); // ~0,23 s de maintien : le bloc sous le curseur casse (colonne 3)
  holdMine(120, 648, 14); // seconde colonne sous les pieds (colonne 2)
  browser.runFrames(40);  // chute d'une couche + la caméra suit
}
const collected = dbg.inventory();
assert.ok(
  collected.grass + collected.dirt + collected.stone >= 14,
  "Les 14 blocs minés sont ramassés (" + JSON.stringify(collected) + ")",
);
assert.equal(dbg.player.grounded, true, "Au fond, le joueur est posé, pas dans le vide");
assert.ok(
  dbg.player.y + 60 <= dbg.groundY + 720 + 1,
  "La chute s'arrête sur la roche mère (pieds à " + (dbg.player.y + 60) + ")",
);
assert.ok(dbg.camY > 500, "La caméra est descendue avec le joueur (" + dbg.camY + ")");

// 3. La roche mère ne casse pas, même en insistant.
const stoneBefore = dbg.inventory().stone;
holdMine(168, 648, 18);
assert.equal(dbg.inventory().stone, stoneBefore, "La roche mère ne donne rien");
assert.equal(dbg.player.grounded, true);

// 4. Marcher vers la paroi intacte : on est bloqué, pas de traverse-muraille.
fire("keydown", { code: "KeyD", key: "d", repeat: false });
browser.runFrames(90);
fire("keyup", { code: "KeyD", key: "d" });
assert.ok(dbg.player.x <= 150.5, "La paroi bloque l'avancée (x = " + dbg.player.x + ")");
assert.ok(dbg.player.x >= 111, "Le joueur n'a pas été aspiré dans le mur");

// 5. Clic droit : poser un bloc contre la paroi (colonne 3, rangée 11),
//    hors du corps du joueur.
fire("keydown", { code: "Digit2", key: "2", repeat: false }); // terre sélectionnée
const dirtBefore = dbg.inventory().dirt;
fire("pointerdown", { button: 2, clientX: 168, clientY: 456 });
assert.equal(dbg.placed().length, 1, "Un bloc est posé contre la paroi");
assert.equal(dbg.inventory().dirt, dirtBefore - 1, "Le bloc posé sort de l'inventaire");

// En plein air, plus haut, la pose est refusée.
fire("pointerdown", { button: 2, clientX: 168, clientY: 200 });
assert.equal(dbg.placed().length, 1, "Pas de bloc posé en plein air");

// Casser le bloc posé : il disparaît, rien d'autre ne bouge.
holdMine(168, 456, 14);
assert.equal(dbg.placed().length, 0, "Le bloc posé se casse");
assert.equal(dbg.player.grounded, true, "Le joueur n'a pas bougé pendant ce temps");

browser.dispose();

// 6. Un autre joueur rebouche la case pendant qu'on maintient le clic :
// les deux confirmations peuvent arriver avant la prochaine image.
const online = createBrowser();
try {
  assert.equal(online.load(), null);
  const socket = online.sockets[0];
  socket.open();
  const form = online.document.querySelector("#menu-form");
  online.document.querySelector("#menu-name-input").value = "Mineur";
  form.dispatchEvent({ type: "submit", target: form, preventDefault() {} });
  online.runFrames(1);
  const onlineDbg = online.sandbox.PixWorldDebug;
  const onlineCanvas = online.document.querySelector("#world");
  online.sandbox.dispatchEvent({
    type: "pointerdown", target: onlineCanvas, button: 0, pointerId: 2,
    clientX: 216, clientY: onlineDbg.groundY + 24, preventDefault() {},
  });
  const requests = () => socket.sent.filter((m) => m.t === "mineBlock");
  const confirm = (request) => socket.receive({
    t: "mineBlock", column: 4, row: 0,
    dropId: "p1:" + request.serial, ownerId: "p1", serial: request.serial,
  });
  online.runFrames(14);
  assert.equal(requests().length, 1);
  let request = requests().at(-1);
  let previousType = "grass";
  for (const [index, type] of ["stone", "dirt", "grass"].entries()) {
    confirm(request);
    assert.equal(onlineDbg.drops().find((drop) => drop.id === "p1:" + request.serial).type, previousType);
    socket.receive({ t: "placeBlock", column: 4, row: 0, type, ownerId: "builder", serial: index + 1 });
    assert.equal(onlineDbg.placed().length, 1);
    const count = requests().length;
    online.runFrames(1);
    assert.equal(requests().length, count, "La nouvelle pose exige un maintien complet, pas une casse immédiate");
    online.runFrames(13);
    assert.equal(requests().length, count + 1, "La case reposée ne reste pas bloquée sur l'ancienne demande de minage");
    request = requests().at(-1);
    assert.equal(request.column, 4);
    assert.equal(request.row, 0);
    previousType = type;
  }
  confirm(request);
  assert.equal(onlineDbg.drops().find((drop) => drop.id === "p1:" + request.serial).type, previousType);
  assert.equal(onlineDbg.placed().length, 0);
  const lastCount = requests().length;
  online.runFrames(14);
  assert.equal(requests().length, lastCount, "Le bloc naturel cassé ne réapparaît pas sous les blocs posés");
} finally {
  online.dispose();
}
console.log("gameplay.test.js : caméra, minage, roche mère, parois, pose et minage répété sans relâcher : ok");
