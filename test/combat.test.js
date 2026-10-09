"use strict";

/** Vraie boucle de jeu : attaques bloquées, butin et réapparition. */
const assert = require("node:assert/strict");
const { createBrowser, StubEvent } = require("./game-boot.test.js");
const games = [];

function createGame(character = "ninja", offline = false) {
  let onEvent;
  const browser = createBrowser({
    noServer: offline,
    storage: { "pixworld.character": character },
    beforeScript(src, sandbox) {
      if (src !== "src/game.js") return;
      const connect = sandbox.PixWorldNet.connect;
      sandbox.PixWorldNet.connect = (options) => {
        onEvent = options.onEvent; // injecter des adversaires même dans le test hors ligne
        return connect(options);
      };
    },
  });
  games.push(browser);
  assert.equal(browser.load(), null, "Le jeu démarre sans erreur");
  const socket = browser.sockets[0];
  if (socket) socket.open();
  else onEvent({ t: "welcome", id: "offline", players: [], mining: { mined: [], placed: [], drops: [] } });
  const document = browser.document;
  document.querySelector("#menu-name-input").value = "Test";
  document.querySelector("#menu-form").dispatchEvent(new StubEvent("submit", { bubbles: true, cancelable: true }));
  browser.runFrames(1);
  return {
    browser, socket,
    dbg: browser.sandbox.PixWorldDebug,
    emit: (message) => socket ? socket.receive(message) : onEvent(message),
    fire(type, props) {
      browser.sandbox.dispatchEvent({ type, target: document.querySelector("#world"), preventDefault() {}, ...props });
    },
  };
}

function moveRight(game, frames) {
  game.fire("keydown", { code: "KeyD", key: "d", repeat: false });
  game.browser.runFrames(frames);
  game.fire("keyup", { code: "KeyD", key: "d" });
}

function peerAttack(game, id, character, serial, x, facing, gap = 0, cursor) {
  const hero = game.browser.sandbox.PixWorldCharacters.get(character);
  const state = {
    id, name: id, character, c: character, x, gap, f: facing,
    vx: 0, vy: 0, g: gap === 0, a: hero.attackDuration, n: serial, hp: 100, d: false,
  };
  // Curseur partagé (repère monde) : c'est lui qui donne la direction du tir.
  if (cursor) {
    state.cx = cursor.x;
    state.cy = cursor.y;
  }
  game.emit({ t: "snapshot", p: [state] });
}

function wall(game) {
  game.emit({ t: "placeBlock", column: 4, row: -1, type: "stone", ownerId: "builder", serial: 1 });
}

function breakWall(game) {
  game.emit({ t: "mineBlock", column: 4, row: -1, dropId: "builder:2", ownerId: "builder", serial: 2 });
}

function attack(game) {
  game.fire("keydown", { code: "KeyX", key: "x", repeat: false });
  game.fire("keyup", { code: "KeyX", key: "x" });
}

function inventory(game) {
  return JSON.parse(JSON.stringify(game.dbg.inventory()));
}

function strike(game, number) {
  const { x, y } = game.dbg.player;
  const id = "samurai-" + number;
  peerAttack(game, id, "samurai", 1, x - 50, 1, game.dbg.groundY - y - 60);
  game.browser.runFrames(8);
  game.emit({ t: "leave", id });
}

function kill(game) {
  for (let n = 1; n <= 6 && !game.dbg.player.dead; n++) strike(game, n);
  assert.equal(game.dbg.player.dead, true, "Les coups fatals déclenchent le K.O.");
}

function stack(id, type, quantity, x, depth, ownerId = "donor") {
  return { id, kind: "death", type, quantity, x, depth, ownerId };
}

function grant(game, items, prefix) {
  const { x, y } = game.dbg.player;
  const drops = Object.entries(items).map(([type, quantity]) =>
    stack(prefix + ":" + type, type, quantity, x + 21, y + 30 - game.dbg.groundY));
  game.emit({ t: "deathDrop", drops });
  game.browser.runFrames(1);
  drops.forEach((drop) => game.emit({ t: "minePickup", dropId: drop.id, collectorId: "p1" }));
}

function echoDeath(game, request) {
  const drops = Object.entries(request.inventory).map(([type, quantity]) =>
    stack("p1:death:" + request.serial + ":" + type, type, quantity, request.x, request.depth, "p1"));
  game.emit({ t: "deathDrop", ownerId: "p1", serial: request.serial, drops });
}

try {
  // Tous les tirs, locaux ou distants, s'arrêtent sur les blocs posés.
  for (const character of ["ninja", "archer", "mage"]) {
    const game = createGame(character);
    const hero = game.browser.sandbox.PixWorldCharacters.get(character);
    wall(game);
    peerAttack(game, "enemy", character, 1, 250, -1);
    game.browser.runFrames(90);
    assert.equal(game.dbg.player.hp, 100, hero.attackName + " ne blesse pas à travers le mur");
    assert.equal(game.dbg.projectiles().length, 0, "Le tir disparaît au contact du mur");

    attack(game);
    for (let frame = 0; frame < 45; frame++) {
      game.browser.runFrames(1);
      game.dbg.projectiles().filter((p) => p.owner === "self").forEach((p) => {
        assert.ok(p.x < 192, "Notre " + hero.attackName + " ne traverse jamais la paroi");
      });
    }
    assert.equal(game.dbg.projectiles().length, 0, "Notre tir est aussi arrêté");

    breakWall(game);
    peerAttack(game, "enemy", character, 2, 250, -1);
    game.browser.runFrames(75);
    assert.equal(game.dbg.player.hp, 100 - hero.attackDamage, "Le tir reprend ses dégâts après destruction du mur");
    game.browser.dispose();
  }

  // Un tir distant vise le curseur partagé de son auteur : un archer perché,
  // de dos (f = -1), descend quand même son projectile sur nous.
  const aimed = createGame();
  const me = aimed.dbg.player;
  peerAttack(aimed, "sniper", "archer", 1, me.x + 260, -1, 220, { x: me.x + 21, y: me.y + 30 });
  aimed.browser.runFrames(90);
  assert.equal(aimed.dbg.player.hp, 100 - aimed.browser.sandbox.PixWorldCharacters.get("archer").attackDamage,
    "le projectile d'un autre joueur part vers son curseur, pas vers son orientation");
  aimed.browser.dispose();

  // Sans curseur partagé, ce même tir de dos passe à côté de nous.
  const blindShot = createGame();
  peerAttack(blindShot, "sniper", "archer", 1, blindShot.dbg.player.x + 260, -1, 220);
  blindShot.browser.runFrames(90);
  assert.equal(blindShot.dbg.player.hp, 100, "sans curseur, le tir garde le sens du corps de son auteur");
  blindShot.browser.dispose();

  // La ligne de vue de la coupe s'applique aux dégâts et aux confirmations locales.
  const melee = createGame();
  wall(melee);
  moveRight(melee, 15); // juste contre le mur, dans la portée du samouraï d'en face
  peerAttack(melee, "enemy", "samurai", 1, 242, -1);
  melee.browser.runFrames(30);
  assert.equal(melee.dbg.player.hp, 100, "La mêlée distante est bloquée par le mur");
  breakWall(melee);
  peerAttack(melee, "enemy", "samurai", 2, 242, -1);
  melee.browser.runFrames(16);
  assert.equal(melee.dbg.player.hp, 80, "La mêlée atteint de nouveau une cible sans mur");
  melee.browser.dispose();

  const localMelee = createGame("samurai");
  wall(localMelee);
  moveRight(localMelee, 15);
  localMelee.emit({ t: "snapshot", p: [{ id: "target", character: "ninja", x: 242, gap: 0, hp: 100 }] });
  attack(localMelee);
  localMelee.browser.runFrames(40);
  assert.equal(localMelee.dbg.peers()[0].lastHitByUsAt, -99, "Aucun faux impact de notre coupe derrière le mur");
  breakWall(localMelee);
  attack(localMelee);
  localMelee.browser.runFrames(12);
  assert.ok(localMelee.dbg.peers()[0].lastHitByUsAt > 0, "Notre coupe touche une cible dégagée");
  localMelee.browser.dispose();

  // Mort en ligne : quantités complètes, pas de récupération par le corps,
  // pas de double création quand le serveur confirme notre butin optimiste.
  const online = createGame();
  grant(online, { grass: 8, dirt: 4, stone: 6 }, "initial");
  assert.deepEqual(inventory(online), { grass: 8, dirt: 4, stone: 6 }, "Une pile récupérée donne toute sa quantité");
  moveRight(online, 40);
  // Une pose et un ramassage attendent encore le serveur lors du coup fatal.
  online.fire("keydown", { code: "Digit2", key: "2", repeat: false });
  online.fire("pointerdown", { button: 2, clientX: 216, clientY: online.dbg.groundY - 24 });
  const placement = online.socket.sent.find((m) => m.t === "placeBlock");
  assert.ok(placement, "La pose est en attente de confirmation");
  const beforeDeath = online.dbg.player;
  const pending = stack("pending:grass", "grass", 7, beforeDeath.x + 21, beforeDeath.y + 30 - online.dbg.groundY);
  online.emit({ t: "deathDrop", drops: [pending] });
  online.browser.runFrames(1);
  assert.ok(online.socket.sent.some((m) => m.t === "minePickup" && m.dropId === pending.id));

  kill(online);
  const death = online.socket.sent.find((m) => m.t === "deathDrop");
  assert.ok(death, "Le butin de mort est envoyé au serveur");
  const deadFacing = online.dbg.player.facing;
  online.fire("pointermove", { clientX: deadFacing < 0 ? 1000 : 20, clientY: 300, pointerType: "mouse" });
  assert.equal(online.dbg.player.facing, deadFacing, "Déplacer le curseur ne retourne pas le corps K.O.");
  assert.deepEqual(death.inventory, { grass: 8, dirt: 3, stone: 6 });
  assert.deepEqual(inventory(online), { grass: 0, dirt: 0, stone: 0 });
  assert.ok(death.x > 280, "Le butin apparaît à la mort, pas au camp de départ");
  let ownDrops = online.dbg.drops().filter((d) => d.ownerId === "p1");
  assert.equal(ownDrops.length, 3);
  ownDrops.forEach((drop) => {
    assert.equal(drop.networked, true);
    assert.equal(drop.quantity, death.inventory[drop.type]);
  });
  echoDeath(online, death);
  echoDeath(online, death);
  assert.equal(online.dbg.drops().filter((d) => d.ownerId === "p1").length, 3, "Les confirmations ne dupliquent pas les piles");
  const requestsAtDeath = online.socket.sent.filter((m) => m.t === "minePickup").length;
  online.browser.runFrames(30);
  assert.equal(online.dbg.player.dead, true);
  assert.equal(online.socket.sent.filter((m) => m.t === "minePickup").length, requestsAtDeath, "Un corps K.O. ne ramasse rien");
  online.browser.runFrames(80);
  assert.equal(online.dbg.player.dead, false);
  assert.equal(online.dbg.player.x, 112);
  assert.equal(online.dbg.player.hp, 100);
  assert.deepEqual(inventory(online), { grass: 0, dirt: 0, stone: 0 }, "La réapparition ne restaure pas le stuff perdu");

  // Même après réapparition, les confirmations anciennes vont dans l'ancien
  // butin sans faire tomber des items du nouvel inventaire.
  grant(online, { grass: 2 }, "new-life");
  online.emit({ t: "minePickup", dropId: pending.id, collectorId: "p1" });
  const latePickup = online.socket.sent.filter((m) => m.t === "deathDrop").at(-1);
  assert.deepEqual(latePickup.inventory, { grass: 7 });
  assert.equal(latePickup.x, death.x);
  assert.equal(latePickup.depth, death.depth);
  assert.deepEqual(inventory(online), { grass: 2, dirt: 0, stone: 0 });
  online.emit({ t: "placeRejected", serial: placement.serial });
  const lateRefund = online.socket.sent.filter((m) => m.t === "deathDrop").at(-1);
  assert.deepEqual(lateRefund.inventory, { dirt: 1 });
  assert.equal(lateRefund.x, death.x);
  assert.equal(lateRefund.depth, death.depth);
  assert.deepEqual(inventory(online), { grass: 2, dirt: 0, stone: 0 });
  ownDrops = online.dbg.drops().filter((d) => d.ownerId === "p1");
  ownDrops.forEach((drop) => online.emit({ t: "minePickup", dropId: drop.id, collectorId: "p2" }));
  assert.equal(online.dbg.drops().filter((d) => d.ownerId === "p1").length, 0, "Un autre joueur peut prendre le butin");
  assert.deepEqual(inventory(online), { grass: 2, dirt: 0, stone: 0 }, "Son ramassage ne crédite pas notre inventaire");
  online.browser.dispose();

  const empty = createGame();
  kill(empty);
  assert.equal(empty.socket.sent.filter((m) => m.t === "deathDrop").length, 0, "Une mort sans stuff ne crée aucun item");
  empty.browser.dispose();

  // Hors ligne : vrai minage, mort, puis retour à pied pour récupérer la pile.
  const offline = createGame("ninja", true);
  wall(offline);
  offline.fire("pointerdown", { button: 0, clientX: 216, clientY: offline.dbg.groundY - 24, pointerId: 1 });
  offline.browser.runFrames(14);
  offline.fire("pointerup", { button: 0 });
  offline.browser.runFrames(70); // le bloc cassé retombe sur le sol intact
  moveRight(offline, 40);
  const offlineStuff = inventory(offline);
  assert.ok(offlineStuff.stone > 0, "Le minage local fournit le stuff du test");
  kill(offline);
  const localLoot = offline.dbg.drops().filter((d) => d.kind === "death");
  assert.equal(localLoot.length, 1);
  assert.equal(localLoot[0].networked, false);
  assert.equal(localLoot[0].quantity, offlineStuff.stone);
  assert.deepEqual(inventory(offline), { grass: 0, dirt: 0, stone: 0 });
  offline.browser.runFrames(90);
  moveRight(offline, 100);
  assert.deepEqual(inventory(offline), offlineStuff, "Le stuff lâché se récupère aussi hors ligne");

  console.log("combat.test.js : tirs et mêlée bloqués, stuff lâché, réapparition, confirmations tardives et récupération hors ligne : ok");
} finally {
  games.forEach((browser) => browser.dispose());
}
