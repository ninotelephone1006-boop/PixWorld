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
const timeout = setTimeout(() => { server.kill(); process.exit(1); }, 10000);
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

  a.socket.close();
  await until(b, (m) => m.t === "leave" && m.id === aw.id);
  console.log("server.test.js : arène, blocs reposés cassables, butin, arrivées tardives et ramassage unique : ok");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clients.forEach((client) => client.terminate());
  server.kill();
  clearTimeout(timeout);
});
