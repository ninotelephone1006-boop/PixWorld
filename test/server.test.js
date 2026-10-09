"use strict";
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");
const server = spawn(process.execPath, ["server/server.js"], {
  cwd: require("node:path").join(__dirname, ".."),
  env: { ...process.env, PORT: "31987", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "inherit"],
});
const clients = [];
const timeout = setTimeout(() => { server.kill(); process.exit(1); }, 20000);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function connect() {
  const socket = new WebSocket("ws://127.0.0.1:31987/ws");
  clients.push(socket);
  socket.on("error", () => {});
  const messages = [];
  socket.on("message", (text) => messages.push(JSON.parse(text)));
  return { socket, messages };
}
async function until(client, predicate) {
  const existing = client.messages.find(predicate);
  if (existing) return existing;
  await once(client.socket, "message");
  return until(client, predicate);
}
(async () => {
  await once(server.stdout, "data");
  const base = "http://127.0.0.1:31987";
  assert.equal((await fetch(base + "/healthz")).status, 200);
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/.git/HEAD")).status, 404);
  assert.equal((await fetch(base + "/server/server.js")).status, 404);
  const a = connect(), b = connect();
  const aw = await until(a, (m) => m.t === "welcome");
  const bw = await until(b, (m) => m.t === "welcome");
  assert.notEqual(aw.id, bw.id);
  assert.deepEqual(aw.mining, { mined: [], placed: [], drops: [] });
  a.socket.send(JSON.stringify({ t: "hello", name: "Alice", character: "ninja" }));
  b.socket.send(JSON.stringify({ t: "hello", name: "Bob", character: "mage" }));
  await until(a, (m) => m.t === "join" && m.player.name === "Bob");
  await until(b, (m) => m.t === "join" && m.player.name === "Alice");
  // Beyond the old 2600 px clamp: full world, attack counter, health and KO.
  a.socket.send(JSON.stringify({ t: "state", x: 7000, gap: -30, f: -1, n: 3, a: 0.5, hp: 0, d: true }));
  const snapshot = await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 3));
  const remote = snapshot.p.find((p) => p.id === aw.id);
  assert.equal(remote.x, 7000);
  assert.equal(remote.gap, -30);
  assert.equal(remote.hp, 0);
  assert.equal(remote.d, true);
  assert.equal(remote.a, 0.5);

  a.socket.send(JSON.stringify({ t: "mineBlock", column: 12, row: 0, serial: 1 }));
  const minedByA = await until(a, (m) => m.t === "mineBlock" && m.dropId === aw.id + ":1");
  const minedByB = await until(b, (m) => m.t === "mineBlock" && m.dropId === aw.id + ":1");
  assert.equal(minedByA.ownerId, aw.id);
  assert.equal(minedByB.column, 12);
  assert.equal(minedByB.row, 0);

  // Pose de blocs : contre la surface oui, en plein air non (placeRejected).
  a.socket.send(JSON.stringify({ t: "placeBlock", column: 13, row: -1, type: "dirt", serial: 7 }));
  const placedByA = await until(b, (m) => m.t === "placeBlock" && m.serial === 7);
  assert.equal(placedByA.type, "dirt");
  assert.equal(placedByA.ownerId, aw.id);
  a.socket.send(JSON.stringify({ t: "placeBlock", column: 60, row: -4, type: "stone", serial: 8 }));
  const rejected = await until(a, (m) => m.t === "placeRejected" && m.serial === 8);
  assert.equal(rejected.serial, 8);
  // La roche mère (dernière rangée) est incassable : personne ne tombe dans le vide.
  a.socket.send(JSON.stringify({ t: "mineBlock", column: 12, row: 14, serial: 9 }));
  await until(a, (m) => m.t === "mineRejected" && m.serial === 9);
  // Casser un bloc posé ne fait rien d'autre : le drop porte le type posé.
  a.socket.send(JSON.stringify({ t: "mineBlock", column: 13, row: -1, serial: 10 }));
  const brokenPlaced = await until(b, (m) => m.t === "mineBlock" && m.dropId === aw.id + ":10");
  assert.equal(brokenPlaced.type, "dirt");

  // Le premier joueur à toucher le drop le réclame : le serveur confirme à tous.
  b.socket.send(JSON.stringify({ t: "minePickup", dropId: aw.id + ":1" }));
  const pickedByA = await until(a, (m) => m.t === "minePickup" && m.dropId === aw.id + ":1");
  const pickedByB = await until(b, (m) => m.t === "minePickup" && m.dropId === aw.id + ":1");
  assert.equal(pickedByA.collectorId, bw.id);
  assert.equal(pickedByB.collectorId, bw.id);

  // Reboucher un trou ne rend pas le bloc incassable : l'historique du
  // terrain naturel reste miné, mais le bloc posé doit avoir la priorité.
  for (const [index, type] of ["dirt", "stone", "grass", "stone"].entries()) {
    const placeSerial = 30 + index * 2;
    const mineSerial = placeSerial + 1;
    a.socket.send(JSON.stringify({ t: "placeBlock", column: 12, row: 0, type, serial: placeSerial }));
    const rebuilt = await until(a, (m) => ["placeBlock", "placeRejected"].includes(m.t) && m.serial === placeSerial);
    assert.equal(rebuilt.t, "placeBlock", "Le trou peut être rebouché plusieurs fois");
    const miner = index % 2 === 0 ? a : b;
    miner.socket.send(JSON.stringify({ t: "mineBlock", column: 12, row: 0, serial: mineSerial }));
    const brokenAgain = await until(miner, (m) => ["mineBlock", "mineRejected"].includes(m.t) && m.serial === mineSerial);
    assert.equal(brokenAgain.t, "mineBlock", "Un bloc posé dans une cellule déjà minée doit rester cassable");
    assert.equal(brokenAgain.type, type, "Le drop conserve le type du bloc posé");
    assert.equal(brokenAgain.ownerId, index % 2 === 0 ? aw.id : bw.id, "Les autres joueurs peuvent aussi casser le bloc reposé");
    await until(miner === a ? b : a, (m) => m.t === "mineBlock" && m.serial === mineSerial);
  }
  // On ne peut pas casser du vide, ni recréer le bloc naturel sous un bloc posé.
  a.socket.send(JSON.stringify({ t: "mineBlock", column: 12, row: 0, serial: 38 }));
  await until(a, (m) => m.t === "mineRejected" && m.serial === 38);
  a.socket.send(JSON.stringify({ t: "mineBlock", column: 60, row: -4, serial: 39 }));
  await until(a, (m) => m.t === "mineRejected" && m.serial === 39);

  // Un troisième joueur rejoint plus tard : il récupère le même terrain et les
  // mêmes blocs posés, sans dépendre de l'origine ou du réseau de l'interface.
  a.socket.send(JSON.stringify({ t: "placeBlock", column: 14, row: -1, type: "dirt", serial: 11 }));
  await until(b, (m) => m.t === "placeBlock" && m.serial === 11);
  // Le butin de mort est partagé sans casser de bloc, une pile par type.
  const deathRequest = { t: "deathDrop", x: 7012, depth: -30, inventory: { grass: 4, dirt: 9, stone: 512 }, serial: 12 };
  a.socket.send(JSON.stringify(deathRequest));
  const deathByA = await until(a, (m) => m.t === "deathDrop" && m.serial === 12);
  const deathByB = await until(b, (m) => m.t === "deathDrop" && m.serial === 12);
  assert.deepEqual(deathByA, deathByB);
  assert.equal(deathByB.ownerId, aw.id);
  assert.equal(deathByB.drops.length, 3);
  deathByB.drops.forEach((drop) => {
    assert.equal(drop.kind, "death");
    assert.equal(drop.quantity, deathRequest.inventory[drop.type]);
    assert.equal(drop.x, 7012);
    assert.equal(drop.depth, -30);
    assert.equal(drop.ownerId, aw.id);
    assert.equal(drop.id, aw.id + ":death:12:" + drop.type);
  });
  // Réémission, nombres invalides, faux types, quantités vides : rien ne se duplique.
  a.socket.send(JSON.stringify(deathRequest));
  const invalidInventories = [{ grass: -1 }, { dirt: 1.5 }, { stone: 2147483648 }, { sword: 1 }, [], null, {}];
  invalidInventories.forEach((inventory, index) => {
    a.socket.send(JSON.stringify({ ...deathRequest, inventory, serial: 13 + index }));
  });
  a.socket.send(JSON.stringify({ ...deathRequest, x: "non fini", serial: 20 }));
  a.socket.send(JSON.stringify({ ...deathRequest, depth: 1e20, serial: 21 }));
  a.socket.send(JSON.stringify({ t: "state", x: 7012, n: 4, hp: 0, d: true }));
  await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 4));
  assert.equal(b.messages.filter((m) => m.t === "deathDrop" && m.ownerId === aw.id).length, 1);

  const c = connect();
  const cw = await until(c, (m) => m.t === "welcome");
  assert.ok(cw.players.some((player) => player.id === aw.id));
  assert.ok(cw.players.some((player) => player.id === bw.id));
  assert.ok(cw.mining.mined.some(([column, row]) => column === 12 && row === 0));
  assert.ok(!cw.mining.placed.some(([column]) => column === 13));
  assert.ok(cw.mining.placed.some(([column, row, type]) => column === 14 && row === -1 && type === "dirt"));
  assert.ok(cw.mining.drops.some((drop) => drop.id === aw.id + ":10"));
  assert.ok(!cw.mining.drops.some((drop) => drop.id === aw.id + ":1"));

  assert.equal(cw.mining.mined.length, 1, "Le butin de mort ne mine pas sa cellule");
  deathByA.drops.forEach((drop) => {
    assert.deepEqual(cw.mining.drops.find((item) => item.id === drop.id), drop, "Un arrivant reçoit les quantités et la position du butin");
  });

  // Pas de drop tant que le joueur n'a pas rejoint l'arène.
  c.socket.send(JSON.stringify({ ...deathRequest, serial: 1 }));
  c.socket.send(JSON.stringify({ t: "hello", name: "Chloé", character: "archer" }));
  await until(b, (m) => m.t === "join" && m.player.id === cw.id);
  assert.equal(b.messages.filter((m) => m.t === "deathDrop" && m.ownerId === cw.id).length, 0);

  // Une pile entière n'a qu'un gagnant, même avec deux demandes de ramassage.
  const stackId = aw.id + ":death:12:grass";
  b.socket.send(JSON.stringify({ t: "minePickup", dropId: stackId }));
  c.socket.send(JSON.stringify({ t: "minePickup", dropId: stackId }));
  const stackPickup = await until(a, (m) => m.t === "minePickup" && m.dropId === stackId);
  assert.ok([bw.id, cw.id].includes(stackPickup.collectorId));
  await until(b, (m) => m.t === "minePickup" && m.dropId === stackId);
  await until(c, (m) => m.t === "minePickup" && m.dropId === stackId);
  // Les messages sur chaque socket sont traités avant ce snapshot de contrôle.
  c.socket.send(JSON.stringify({ t: "state", n: 1 }));
  a.socket.send(JSON.stringify({ ...deathRequest })); // retry après collecte
  a.socket.send(JSON.stringify({ t: "state", n: 5 }));
  await until(b, (m) => m.t === "snapshot" &&
    m.p.some((p) => p.id === aw.id && p.n === 5) && m.p.some((p) => p.id === cw.id && p.n === 1));
  assert.equal(a.messages.filter((m) => m.t === "minePickup" && m.dropId === stackId).length, 1);
  assert.equal(b.messages.filter((m) => m.t === "deathDrop" && m.ownerId === aw.id).length, 1);
  const d = connect();
  const dw = await until(d, (m) => m.t === "welcome");
  assert.ok(!dw.mining.drops.some((drop) => drop.id === stackId), "Une réémission ne recrée pas la pile déjà ramassée");
  assert.equal(dw.mining.drops.find((drop) => drop.id === aw.id + ":death:12:stone").quantity, 512);
  assert.equal(dw.mining.drops.find((drop) => drop.id === aw.id + ":death:12:dirt").quantity, 9);

  // ── Discussion : diffusion, nettoyage et commandes (/tp, /kill) ──
  const chatOf = (client) => client.messages.filter((m) => m.t === "chat");

  a.socket.send(JSON.stringify({ t: "chat", text: "  Salut   la compagnie  " }));
  const greetingA = await until(a, (m) => m.t === "chat" && m.text === "Salut la compagnie");
  const greetingB = await until(b, (m) => m.t === "chat" && m.text === "Salut la compagnie");
  assert.equal(greetingA.name, "Alice");
  assert.equal(greetingA.id, aw.id);
  assert.equal(greetingA.c, "ninja");
  assert.deepEqual(greetingA, greetingB, "la ligne est diffusée à tout le monde, y compris son auteur");

  // Ligne vide ignorée, ligne trop longue coupée à 140 caractères.
  const beforeEmpty = chatOf(b).length;
  a.socket.send(JSON.stringify({ t: "chat", text: "   " }));
  a.socket.send(JSON.stringify({ t: "chat", text: "x".repeat(400) }));
  const longLine = await until(b, (m) => m.t === "chat" && m.text.startsWith("xxx"));
  assert.equal(longLine.text.length, 140, "une ligne est limitée à 140 caractères");
  assert.equal(chatOf(b).length, beforeEmpty + 1, "une ligne vide n'est pas diffusée");

  // /aide ne répond qu'à celle ou celui qui l'a demandé.
  const beforeHelp = chatOf(b).length;
  a.socket.send(JSON.stringify({ t: "chat", text: "/aide" }));
  const help = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("/kill"));
  assert.equal(help.system, true);
  await wait(120);
  assert.equal(chatOf(b).length, beforeHelp, "une demande d'aide n'encombre pas les autres");

  // Pseudo inconnu : message d'erreur pour l'émetteur seulement.
  const beforeMissing = chatOf(b).length;
  a.socket.send(JSON.stringify({ t: "chat", text: '/kill "Personne Du Tout"' }));
  const missing = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("Personne Du Tout"));
  assert.ok(missing.text.includes("Aucun joueur"));
  await wait(120);
  assert.equal(chatOf(b).length, beforeMissing, "une commande en échec ne parle qu'à son auteur");

  // /kill : l'ordre ne part que chez la personne visée, l'annonce partout.
  a.socket.send(JSON.stringify({ t: "chat", text: "/kill Bob" }));
  const killOrder = await until(b, (m) => m.t === "kill");
  assert.equal(killOrder.byId, aw.id);
  assert.equal(killOrder.byName, "Alice");
  await wait(120);
  assert.equal(a.messages.filter((m) => m.t === "kill").length, 0, "les autres joueurs ne reçoivent aucun ordre");
  assert.equal(c.messages.filter((m) => m.t === "kill").length, 0);
  const killNews = await until(c, (m) => m.t === "chat" && m.system && m.text.includes("éliminé"));
  assert.ok(killNews.text.includes("Bob"), "l'annonce nomme la cible");

  // /tp : le client déplacé reçoit la position de la destination.
  a.socket.send(JSON.stringify({ t: "state", x: 4321, gap: -12, n: 6 }));
  await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 6));
  c.socket.send(JSON.stringify({ t: "chat", text: '/tp "Chloé" "Alice"' }));
  const tpOrder = await until(c, (m) => m.t === "teleport");
  assert.equal(tpOrder.x, 4321);
  assert.equal(tpOrder.gap, -12);
  assert.equal(tpOrder.toName, "Alice");
  assert.equal(tpOrder.byName, "Chloé");
  await wait(120);
  assert.equal(a.messages.filter((m) => m.t === "teleport").length, 0, "personne d'autre n'est déplacé");
  const tpNews = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("téléporté"));
  assert.ok(tpNews.text.includes("Chloé") && tpNews.text.includes("Alice"));

  // Envoyer quelqu'un sur lui-même ne déclenche rien.
  const beforeSelf = c.messages.filter((m) => m.t === "teleport").length;
  a.socket.send(JSON.stringify({ t: "chat", text: '/tp "Chloé" "Chloé"' }));
  const selfTp = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("déjà sur place"));
  assert.ok(selfTp);
  await wait(120);
  assert.equal(c.messages.filter((m) => m.t === "teleport").length, beforeSelf);

  // Pseudos à espaces : avec ou sans guillemets.
  const e = connect();
  const ew = await until(e, (m) => m.t === "welcome");
  e.socket.send(JSON.stringify({ t: "hello", name: "Le Bricoleur", character: "samurai" }));
  await until(a, (m) => m.t === "join" && m.player.id === ew.id);
  a.socket.send(JSON.stringify({ t: "chat", text: '/kill "Le Bricoleur"' }));
  const quotedKill = await until(e, (m) => m.t === "kill");
  assert.equal(quotedKill.byName, "Alice", "un pseudo à espaces entre guillemets est reconnu");
  a.socket.send(JSON.stringify({ t: "chat", text: "/kill Le Bricoleur" }));
  const bareKill = await until(e, (m) => m.t === "kill" && m !== quotedKill);
  assert.equal(bareKill.byName, "Alice", "un pseudo à espaces reste reconnu sans guillemets");

  // Correspondance exacte d'abord ; un fragment trop vague est signalé.
  e.socket.send(JSON.stringify({ t: "rename", name: "Bobby", character: "samurai" }));
  await until(a, (m) => m.t === "renamed" && m.id === ew.id);
  a.socket.send(JSON.stringify({ t: "chat", text: "/kill ob" }));
  const ambiguous = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("Plusieurs"));
  assert.ok(ambiguous.text.includes("Bobby") && ambiguous.text.includes("Bob"), ambiguous.text);
  a.socket.send(JSON.stringify({ t: "chat", text: "/kill bob" }));
  const exactKill = await until(b, (m) => m.t === "kill" && m !== killOrder);
  assert.equal(exactKill.byName, "Alice", "la correspondance exacte l'emporte sur les voisins");
  await wait(120); // l'annonce publique de l'élimination finit d'arriver

  // Commande inconnue : seule la personne qui l'a tapée est prévenue.
  const beforeUnknown = chatOf(b).length;
  a.socket.send(JSON.stringify({ t: "chat", text: "/voler" }));
  const unknown = await until(a, (m) => m.t === "chat" && m.system && m.text.includes("Commande inconnue"));
  assert.ok(unknown.text.includes("voler"));
  await wait(120);
  assert.equal(chatOf(b).length, beforeUnknown);

  // Anti-flood : huit lignes par fenêtre de 5 secondes, pas plus
  // (on utilise un joueur frais pour ne pas compter les lignes déjà envoyées).
  const beforeFlood = chatOf(b).filter((m) => !m.system && m.text === "flood").length;
  for (let index = 0; index < 12; index++) e.socket.send(JSON.stringify({ t: "chat", text: "flood" }));
  await wait(250);
  const flooded = chatOf(b).filter((m) => !m.system && m.text === "flood").length;
  assert.equal(flooded - beforeFlood, 8, "les lignes surnuméraires sont ignorées");

  // Curseur relayé : envoyé en repère monde, effacé quand la souris sort.
  a.socket.send(JSON.stringify({ t: "state", cx: 4600, cy: 240, n: 7 }));
  const withCursor = await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 7));
  assert.equal(withCursor.p.find((p) => p.id === aw.id).cx, 4600);
  assert.equal(withCursor.p.find((p) => p.id === aw.id).cy, 240);
  a.socket.send(JSON.stringify({ t: "state", cx: null, cy: null, n: 8 }));
  const withoutCursor = await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 8));
  assert.equal(withoutCursor.p.find((p) => p.id === aw.id).cx, null, "sans curseur, rien n'est annoncé");

  a.socket.close();
  await until(b, (m) => m.t === "leave" && m.id === aw.id);
  console.log("server.test.js : arène, blocs reposés cassables, butin, arrivées tardives, ramassage unique, discussion, /tp, /kill et curseurs : ok");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clients.forEach((client) => client.terminate());
  server.kill();
  clearTimeout(timeout);
});
