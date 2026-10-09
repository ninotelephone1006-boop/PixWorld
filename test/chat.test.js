"use strict";

/**
 * Discussion, commandes /tp et /kill, curseurs partagés : `npm test`.
 *
 * Le serveur décide (il résout les pseudos, puis n'avertit que le client
 * concerné) et le client joue l'effet chez lui. Ces tests rejouent donc les
 * deux bouts sans navigateur : la touche T qui ouvre la discussion, l'envoi
 * d'une ligne, l'affichage des messages reçus, l'exécution de « teleport »
 * et de « kill », puis le relais du curseur de la souris.
 */

const assert = require("node:assert/strict");
const { createBrowser, StubEvent } = require("./game-boot.test.js");

const browsers = [];

function createGame(options) {
  const browser = createBrowser(options);
  browsers.push(browser);
  assert.equal(browser.load(), null);
  const socket = browser.sockets[0];
  if (socket) socket.open();
  const document = browser.document;
  const canvas = document.querySelector("#world");
  const game = {
    browser,
    socket,
    canvas,
    dbg: browser.sandbox.PixWorldDebug,
    el: (id) => document.querySelector(id),
    enterArena(name) {
      document.querySelector("#menu-name-input").value = name || "Kage";
      document.querySelector("#menu-form").dispatchEvent(new StubEvent("submit", { bubbles: true, cancelable: true }));
      browser.runFrames(1);
      return game;
    },
    fire(type, props) {
      browser.sandbox.dispatchEvent(Object.assign({
        type,
        target: canvas,
        repeat: false,
        preventDefault() {},
      }, props));
    },
    /** Touche enfoncée, en mémorisant si le jeu l'a avalée (preventDefault). */
    press(props) {
      const event = Object.assign({
        type: "keydown",
        target: canvas,
        repeat: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      }, props);
      browser.sandbox.dispatchEvent(event);
      return event;
    },
    point(x, y) {
      browser.sandbox.dispatchEvent({
        type: "pointermove",
        target: canvas,
        clientX: x,
        clientY: y === undefined ? 300 : y,
        pointerType: "mouse",
        preventDefault() {},
      });
    },
    write(text) {
      document.querySelector("#chat-input").value = text;
      // Entrée : le formulaire de la discussion prend la main.
      document.querySelector("#chat-form").dispatchEvent(new StubEvent("submit", { bubbles: true, cancelable: true }));
    },
    logText: () => document.querySelector("#chat-log").textContent,
    sentChat: () => (socket ? socket.sent.filter((message) => message.t === "chat") : []),
    lastState: () => socket.sent.filter((message) => message.t === "state").at(-1),
  };
  return game;
}

try {
  // ─────────────────────────── La discussion s'ouvre avec T ───────────────────────────
  console.log("Discussion : ouverture, envoi et affichage");
  const boot = createGame();
  assert.equal(boot.el("#chat").hidden, true, "la discussion reste masquée sur l'écran titre");
  const game = boot.enterArena("Kage");
  assert.equal(game.el("#chat").hidden, false, "la discussion apparaît en entrant dans l'arène");
  assert.equal(game.dbg.chat.open, false);

  game.fire("keydown", { code: "KeyT", key: "t" });
  assert.equal(game.dbg.chat.open, true, "T ouvre la discussion");
  assert.equal(game.el("#chat").hidden, false);
  assert.ok(game.el("#chat-input").focusCount > 0, "le champ de saisie prend le focus");

  // Pendant la saisie, le clavier appartient à la discussion : le personnage
  // ne doit pas courir, sauter ni attaquer parce qu'on tape « d » ou « x ».
  const beforeTyping = game.dbg.player.x;
  game.fire("keydown", { code: "KeyD", key: "d" });
  game.fire("keydown", { code: "Space", key: " " });
  game.browser.runFrames(20);
  assert.equal(game.dbg.player.x, beforeTyping, "on n'avance pas en écrivant un message");
  assert.equal(game.dbg.player.grounded, true, "on ne saute pas en écrivant un message");

  // La barre d'espace doit arriver jusqu'au champ de saisie : sans ça, aucune
  // commande à arguments n'est tapable (« /tp "Nom Joueur" "Autre Joueur" »).
  game.fire("keydown", { code: "KeyT", key: "t" });
  const typed = game.press({ code: "Space", key: " ", target: game.el("#chat-input") });
  assert.equal(typed.defaultPrevented, false, "l'espace tapé dans le champ de saisie n'est pas avalé");
  const swallowed = game.press({ code: "Space", key: " " });
  assert.equal(swallowed.defaultPrevented, true, "l'espace hors du champ reste neutralisé (ni saut ni défilement)");
  game.browser.runFrames(6);
  assert.equal(game.dbg.player.grounded, true, "écrire un message ne fait toujours pas sauter");

  game.write("Salut tout le monde");
  const sent = game.sentChat();
  assert.equal(sent.length, 1, "Entrée envoie une seule ligne");
  assert.equal(sent[0].text, "Salut tout le monde");
  assert.equal(game.dbg.chat.open, false, "la discussion se referme après l'envoi");

  // Une commande garde ses espaces et ses guillemets jusqu'au serveur.
  game.fire("keydown", { code: "KeyT", key: "t" });
  game.write('/tp "Le Bricoleur" "Ami Joueur"');
  assert.equal(game.sentChat().at(-1).text, '/tp "Le Bricoleur" "Ami Joueur"',
    "une commande garde ses espaces et ses guillemets");

  // Une ligne vide ne part pas, et une ligne trop longue est coupée.
  const beforeEmpty = game.sentChat().length;
  game.fire("keydown", { code: "KeyT", key: "t" });
  game.write("   ");
  assert.equal(game.sentChat().length, beforeEmpty, "une ligne vide n'est pas envoyée");
  game.fire("keydown", { code: "KeyT", key: "t" });
  game.write("a".repeat(200));
  assert.equal(game.sentChat().at(-1).text.length, 140, "une ligne est limitée à 140 caractères");

  // ─────────────────────────── Messages reçus ───────────────────────────
  game.socket.receive({ t: "chat", id: "p2", name: "Ami", c: "mage", text: "Coucou Kage" });
  assert.ok(game.logText().includes("Ami"), "le pseudo de l'auteur est affiché");
  assert.ok(game.logText().includes("Coucou Kage"), "le message reçu est affiché");
  let last = game.dbg.chat.messages.at(-1);
  assert.equal(last.name, "Ami");
  assert.equal(last.self, false);
  assert.equal(last.color, "#c792ea", "le message prend la couleur du héros de son auteur");

  game.socket.receive({ t: "chat", system: true, text: "Kage a téléporté Ami sur Bob." });
  last = game.dbg.chat.messages.at(-1);
  assert.equal(last.system, true, "les retours du serveur arrivent en information système");
  assert.ok(game.logText().includes("téléporté"));

  game.socket.receive({ t: "chat", id: game.socket.sent.find((m) => m.t === "hello") ? "p1" : "p1", name: "Kage", c: "ninja", text: "Moi-même" });
  last = game.dbg.chat.messages.at(-1);
  assert.equal(last.self, true, "notre propre message est marqué comme tel");

  // Le journal ne grandit pas sans fin : 60 lignes, 40 conservées.
  for (let index = 0; index < 60; index++) {
    game.socket.receive({ t: "chat", id: "p2", name: "Ami", c: "mage", text: "ligne " + index });
  }
  assert.equal(game.browser.document.querySelector("#chat-log").children.length, 40,
    "le journal conserve les 40 dernières lignes");
  assert.equal(game.dbg.chat.messages.length, 40);
  assert.ok(game.logText().includes("ligne 59"), "la dernière ligne reste visible");
  assert.ok(!game.logText().includes("ligne 0 "), "les plus anciennes lignes sont oubliées");

  // ─────────────────────────── Échap referme sans mettre en pause ───────────────────────────
  game.fire("keydown", { code: "KeyT", key: "t" });
  assert.equal(game.dbg.chat.open, true);
  game.fire("keydown", { code: "Escape", key: "Escape" });
  assert.equal(game.dbg.chat.open, false, "Échap referme la discussion");
  assert.equal(game.el("#game-menu").hidden, true, "Échap sur la discussion n'ouvre pas le menu pause");
  game.browser.runFrames(2);

  // Un clic dans le monde referme la discussion ; un clic dedans la garde.
  game.fire("keydown", { code: "KeyT", key: "t" });
  game.fire("pointerdown", { button: 0, clientX: 600, clientY: 300, pointerType: "mouse", target: game.el("#chat-input") });
  assert.equal(game.dbg.chat.open, true, "un clic dans la discussion ne la referme pas");
  game.fire("pointerdown", { button: 0, clientX: 600, clientY: 300, pointerType: "mouse" });
  assert.equal(game.dbg.chat.open, false, "un clic dans le monde referme la discussion");
  // Et ce clic-là n'attaque pas : il ne fait que rendre la main au jeu.
  game.browser.runFrames(12);
  assert.equal(game.dbg.projectiles().length, 0, "le clic qui referme la discussion ne lance pas d'attaque");

  // ─────────────────────────── Commande /tp : on rejoint la destination ───────────────────────────
  console.log("Commandes : /tp et /kill");
  const beforeTp = game.dbg.player.x;
  game.socket.receive({ t: "teleport", x: 5200, gap: 0, byId: "p2", byName: "Ami", toName: "Bob" });
  assert.equal(game.dbg.player.x, 5200, "le joueur rejoint la position envoyée par le serveur");
  assert.notEqual(game.dbg.player.x, beforeTp);
  assert.equal(game.dbg.camX, 5200 + 42 / 2 - 1280 / 2, "la caméra recadre aussitôt, sans travelling");
  game.browser.runFrames(3);
  assert.equal(Math.round(game.dbg.player.x), 5200, "on reste sur place après la téléportation");

  // Une destination en l'air : la hauteur est rejouée (gap = hauteur au-dessus du sol).
  game.socket.receive({ t: "teleport", x: 100, gap: 240, byId: "p2", byName: "Ami", toName: "Bob" });
  assert.ok(game.dbg.player.y < game.dbg.groundY - 60, "on réapparaît en hauteur, pas dans le sol");
  game.browser.runFrames(2);

  // ─────────────────────────── Commande /kill : K.O. puis réapparition ───────────────────────────
  game.socket.receive({ t: "kill", byId: "p2", byName: "Ami" });
  assert.equal(game.dbg.player.dead, true, "/kill met le joueur K.O.");
  assert.equal(game.dbg.player.hp, 0, "la vie tombe à zéro");
  game.browser.runFrames(140);
  assert.equal(game.dbg.player.dead, false, "le joueur réapparaît après le K.O.");
  assert.equal(game.dbg.player.hp, 100, "il réapparaît en pleine forme");
  // Un second ordre pendant l'invulnérabilité de réapparition est ignoré.
  game.socket.receive({ t: "kill", byId: "p2", byName: "Ami" });
  assert.equal(game.dbg.player.dead, true, "une commande /kill n'est pas bloquée par la protection");

  // ─────────────────────────── Curseurs des autres joueurs ───────────────────────────
  console.log("Curseurs partagés");
  const cursors = createGame().enterArena("Kage");
  cursors.point(420, 260);
  cursors.browser.runFrames(6);
  const state = cursors.lastState();
  assert.equal(state.cx, 420 + cursors.dbg.camX, "le curseur est envoyé en repère monde (x)");
  assert.equal(state.cy, 260 + cursors.dbg.camY, "le curseur est envoyé en repère monde (y)");

  cursors.fire("blur");
  cursors.browser.runFrames(6);
  assert.equal(cursors.lastState().cx, null, "sans curseur (fenêtre quittée), rien n'est annoncé");

  cursors.point(420, 260);
  cursors.socket.receive({ t: "join", player: { id: "p2", name: "Ami", character: "archer" } });
  cursors.socket.receive({
    t: "snapshot",
    p: [{ id: "p2", name: "Ami", character: "archer", x: 300, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "archer", n: 0, hp: 100, d: false, cx: 900, cy: 200 }],
  });
  const remoteCursor = cursors.dbg.cursors().find((entry) => entry.id === "p2").cursor;
  assert.equal(remoteCursor.x, 900, "le curseur d'un autre joueur est mémorisé pour être dessiné (x)");
  assert.equal(remoteCursor.y, 200, "le curseur d'un autre joueur est mémorisé pour être dessiné (y)");
  cursors.socket.receive({
    t: "snapshot",
    p: [{ id: "p2", name: "Ami", character: "archer", x: 300, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "archer", n: 0, hp: 100, d: false, cx: null, cy: null }],
  });
  assert.equal(cursors.dbg.cursors().find((entry) => entry.id === "p2").cursor, null,
    "le curseur disparaît quand l'autre joueur quitte la fenêtre");

  // Une partie se joue sans erreur avec un curseur distant affiché.
  cursors.socket.receive({
    t: "snapshot",
    p: [{ id: "p2", name: "Ami", character: "archer", x: 300, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "archer", n: 0, hp: 100, d: false, cx: 640, cy: 360 }],
  });
  cursors.browser.runFrames(20);

  // ─────────────────────────── Hors ligne : pas de faux multijoueur ───────────────────────────
  console.log("Discussion hors ligne");
  const solo = createGame({ noServer: true }).enterArena("Kage");
  solo.write("/kill Ami");
  assert.equal(solo.dbg.chat.messages.at(-1).system, true,
    "une commande hors ligne prévient au lieu de faire croire à une arène");
  solo.write("Bonjour tout seul");
  const echo = solo.dbg.chat.messages.at(-1);
  assert.equal(echo.name, "Kage", "hors ligne, la ligne est simplement affichée");
  assert.equal(echo.offline, true);
  solo.browser.runFrames(4);

  console.log("chat.test.js : discussion, /tp, /kill et curseurs partagés : ok");
} finally {
  browsers.forEach((browser) => browser.dispose());
}
