"use strict";

/** Orientation du sprite : curseur, marche inverse, caméra et contrôles sans souris. */
const assert = require("node:assert/strict");
const { createBrowser, StubEvent } = require("./game-boot.test.js");
const browsers = [];

function createGame(character = "ninja", extraStorage = {}) {
  const browser = createBrowser({ storage: { "pixworld.character": character, ...extraStorage } });
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

/** Curseur placé n'importe où sur l'écran (pas seulement à 300 px du haut). */
function pointAt(game, x, y) {
  game.fire("pointermove", { clientX: x, clientY: y, pointerType: "mouse" });
}

/** Tous les projectiles que nous avons lancés, image par image. */
function collectShots(game, frames) {
  const shots = [];
  for (let frame = 0; frame < frames; frame++) {
    game.browser.runFrames(1);
    game.dbg.projectiles().filter((shot) => shot.owner === "self").forEach((shot) => shots.push(shot));
  }
  return shots;
}

/** Origine d'un projectile : devant le torse, là où sort le shuriken. */
function shotOrigin(game) {
  const hero = game.dbg.player;
  return {
    x: hero.x + hero.width / 2 - game.dbg.camX,
    y: hero.y + hero.height * 0.46 - game.dbg.camY,
  };
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

  // ─────────────────────────── Les projectiles visent le curseur ───────────────────────────
  console.log("Projectiles lancés dans la direction du curseur");
  const aiming = createGame();
  const origin = shotOrigin(aiming);
  pointAt(aiming, origin.x - 110, origin.y - 230); // en l'air, en haut à gauche
  aiming.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  aiming.fire("keyup", { code: "KeyX", key: "x" });
  const upward = collectShots(aiming, 26);
  assert.ok(upward.length >= 3, "le tir reste en vol le temps d'être suivi (" + upward.length + " images)");
  assert.ok(upward.every((shot) => shot.dirX < -0.3 && shot.dirY < -0.8),
    "le projectile part en diagonale vers le haut, pas à l'horizontale (" +
      upward[0].dirX.toFixed(2) + " ; " + upward[0].dirY.toFixed(2) + ")");
  assert.ok(upward.at(-1).x < upward[0].x - 40 && upward.at(-1).y < upward[0].y - 40,
    "il recule et monte bien vers le curseur");
  assert.ok(Math.abs(upward[0].angle - Math.atan2(upward[0].dirY, upward[0].dirX)) < 1e-6,
    "l'angle de dessin suit la direction du vol");
  assert.equal(Math.hypot(upward[0].dirX, upward[0].dirY).toFixed(6), "1.000000",
    "la direction est unitaire : la vitesse du projectile ne change pas");

  // Un curseur plus bas que le tireur envoie le projectile vers le sol.
  const downward = createGame();
  const low = shotOrigin(downward);
  pointAt(downward, low.x + 130, low.y + 110);
  downward.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  downward.fire("keyup", { code: "KeyX", key: "x" });
  const falling = collectShots(downward, 20);
  assert.ok(falling.length > 0, "un tir vers le bas part bien");
  assert.ok(falling.every((shot) => shot.dirX > 0.3 && shot.dirY > 0.5),
    "le projectile descend vers le curseur (" + falling[0].dirY.toFixed(2) + ")");

  // Sans curseur connu (souris hors de la fenêtre), le tir garde le sens du corps.
  const blind = createGame();
  const straight = shotOrigin(blind);
  pointAt(blind, straight.x - 100, straight.y);
  blind.fire("blur");
  blind.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  blind.fire("keyup", { code: "KeyX", key: "x" });
  const ahead = collectShots(blind, 14);
  assert.ok(ahead.length > 0, "le tir sans curseur part quand même");
  assert.ok(ahead.every((shot) => shot.dirX === -1 && shot.dirY === 0),
    "sans visée à la souris, il file droit devant le personnage");

  // Panneau d'affichage : la physique des tirs est fixée par le jeu, seul
  // l'aperçu du tir se choisit — et il ne change rien au vol du projectile.
  const settingsGame = createGame("archer");
  const settingsDocument = settingsGame.browser.document;
  const settingsToggle = settingsDocument.querySelector("#settings-toggle");
  settingsToggle.dispatchEvent(new StubEvent("click", { bubbles: true }));
  assert.equal(settingsGame.dbg.settingsOpen, true, "Le bouton ⚙ du HUD ouvre les paramètres");
  assert.equal(settingsDocument.querySelector("#projectile-settings").hidden, false);

  assert.deepEqual({ ...settingsGame.dbg.lockedProjectile },
    { speed: 820, gravity: 760, gravityDelay: 0.28, life: 2.2, scale: 0.9 },
    "L'archère garde le tir fixé par le jeu, même panneau ouvert");
  assert.equal(settingsDocument.querySelector("#settings-locked-gravity").textContent, "760 px/s²",
    "Le panneau affiche les valeurs du jeu, en lecture seule");
  assert.equal(settingsDocument.querySelector("#settings-locked-hero").textContent, "Sora · Flèche de vent",
    "Le récapitulatif suit le héros du joueur");

  const trajectoryToggle = settingsDocument.querySelector("#settings-trajectory-preview");
  trajectoryToggle.checked = true;
  trajectoryToggle.dispatchEvent(new StubEvent("change", { bubbles: true }));
  assert.equal(settingsGame.dbg.displaySettings.trajectoryPreview, true,
    "L'aperçu de trajectoire peut être activé");
  const trailsToggle = settingsDocument.querySelector("#settings-projectile-trails");
  trailsToggle.checked = false;
  trailsToggle.dispatchEvent(new StubEvent("change", { bubbles: true }));
  assert.equal(settingsGame.dbg.displaySettings.showTrails, false,
    "Les traînées peuvent être masquées");
  const previewLength = settingsDocument.querySelector("#settings-preview-duration");
  previewLength.value = "0.5";
  previewLength.dispatchEvent(new StubEvent("input", { bubbles: true }));
  assert.equal(settingsGame.dbg.displaySettings.previewDuration, 0.5,
    "La longueur de l'aperçu se règle");
  previewLength.value = "99";
  previewLength.dispatchEvent(new StubEvent("input", { bubbles: true }));
  assert.equal(settingsGame.dbg.displaySettings.previewDuration, 4,
    "La longueur de l'aperçu reste bornée, sans jamais toucher au tir");
  assert.ok(settingsGame.browser.sandbox.localStorage.getItem("pixworld.display-settings"),
    "Les préférences d'affichage sont conservées dans le navigateur");

  settingsGame.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  assert.equal(settingsGame.dbg.projectiles().length, 0, "Le panneau de réglages neutralise les attaques");
  settingsGame.fire("keydown", { code: "Escape", key: "Escape", repeat: false });
  assert.equal(settingsGame.dbg.settingsOpen, false, "Échap ferme les paramètres sans ouvrir le menu pause");
  settingsGame.browser.runFrames(1);
  assert.ok(settingsGame.browser.document.querySelector("#world").getContext("2d")._trajectoryDashCalls > 0,
    "L'aperçu actif dessine bien une ligne en pointillés avant le lancement");

  const archerOrigin = shotOrigin(settingsGame);
  pointAt(settingsGame, archerOrigin.x + 420, archerOrigin.y);
  settingsGame.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  settingsGame.fire("keyup", { code: "KeyX", key: "x" });
  const archerFlight = collectShots(settingsGame, 42);
  assert.ok(archerFlight.length > 0, "L'archère tire bien");
  assert.equal(archerFlight[0].gravity, 760,
    "Le tir suit la gravité du jeu : aucun réglage personnel n'est mélangé");
  assert.ok(archerFlight.some((shot) => shot.age > 0.32 && shot.dirY > 0.1),
    "Après le délai, la gravité courbe la flèche vers le bas");

  // Les réglages de tir enregistrés par d'anciennes versions du jeu sont
  // jetés sans être lus : ils ne peuvent plus fausser une partie.
  const legacyGame = createGame("archer", {
    "pixworld.projectile-settings": JSON.stringify({
      projectiles: { archer: { gravity: 9999, speed: 4000, scale: 9 } },
      trajectoryPreview: true,
    }),
  });
  assert.equal(legacyGame.browser.sandbox.localStorage.getItem("pixworld.projectile-settings"), null,
    "L'ancienne clé de réglages est supprimée au chargement");
  assert.deepEqual({ ...legacyGame.dbg.lockedProjectile },
    { speed: 820, gravity: 760, gravityDelay: 0.28, life: 2.2, scale: 0.9 },
    "Un gravité héritée de 9999 n'a aucun effet sur le tir");
  assert.equal(legacyGame.dbg.displaySettings.trajectoryPreview, false,
    "Une préférence de tir héritée n'active plus rien : seul l'affichage se recharge");
  legacyGame.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  legacyGame.fire("keyup", { code: "KeyX", key: "x" });
  const legacyFlight = collectShots(legacyGame, 20);
  assert.ok(legacyFlight.length === 0 || legacyFlight.every((shot) => shot.gravity === 760 && shot.speed === 820),
    "Le projectile d'une ancienne partie réglée redevient normal");

  // Un pair qui enverrait une physique inventée n'est pas écouté : son tir
  // est rejoué chez nous avec les valeurs fixées par le jeu.
  const spoofGame = createGame("ninja");
  spoofGame.socket.receive({
    t: "snapshot",
    p: [{
      id: "p9", name: "Tricheur", character: "ninja", x: 300, gap: 0, f: 1, vx: 0, vy: 0,
      g: true, a: 1, n: 1, c: "ninja", hp: 100, d: false,
      projectile: { speed: 4000, gravity: 0, gravityDelay: 0, life: 9, scale: 1.75 },
    }],
  });
  const peerShots = [];
  for (let frame = 0; frame < 30; frame++) {
    spoofGame.browser.runFrames(1);
    spoofGame.dbg.projectiles()
      .filter((shot) => shot.owner === "p9")
      .forEach((shot) => peerShots.push(shot));
  }
  assert.ok(peerShots.length > 0, "le tir du pair est bien rejoué chez nous");
  assert.ok(peerShots.every((shot) => shot.speed === 590 && shot.gravity === 300 && shot.scale === 1),
    "la physique annoncée par le pair est ignorée : " + JSON.stringify(peerShots[0]));
  assert.ok(spoofGame.dbg.peers().some((peer) => peer.id === "p9"), "le pair reste dans la partie");

  console.log("input.test.js : visée, aperçu du tir, trajectoire, gravité et attaques : ok");
} finally {
  browsers.forEach((browser) => browser.dispose());
}
