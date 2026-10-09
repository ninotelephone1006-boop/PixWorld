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
  // Le transport direct (WebRTC) et sa librairie vendue sont servis au client,
  // avec un type MIME accepté pour les modules ES.
  const p2pResponse = await fetch(base + "/src/p2p.js");
  assert.equal(p2pResponse.status, 200);
  assert.match(p2pResponse.headers.get("content-type") || "", /javascript/);
  const trysteroResponse = await fetch(base + "/src/vendor/trystero/torrent.js");
  assert.equal(trysteroResponse.status, 200);
  assert.match(trysteroResponse.headers.get("content-type") || "", /javascript/);
  assert.equal((await fetch(base + "/src/vendor/trystero/core/index.js")).status, 200);
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

  a.socket.close();
  await until(b, (m) => m.t === "leave" && m.id === aw.id);
  console.log("server.test.js : connexions, états verticaux, minage partagé, collecte, vie, KO, départ : ok");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clients.forEach((client) => client.terminate());
  server.kill();
  clearTimeout(timeout);
});
