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
  a.socket.send(JSON.stringify({ t: "hello", name: "Alice", character: "ninja" }));
  b.socket.send(JSON.stringify({ t: "hello", name: "Bob", character: "mage" }));
  await until(a, (m) => m.t === "join" && m.player.name === "Bob");
  await until(b, (m) => m.t === "join" && m.player.name === "Alice");
  // Beyond the old 2600 px clamp: full world, attack counter, health and KO.
  a.socket.send(JSON.stringify({ t: "state", x: 7000, gap: 80, f: -1, n: 3, a: 0.5, hp: 0, d: true }));
  const snapshot = await until(b, (m) => m.t === "snapshot" && m.p.some((p) => p.id === aw.id && p.n === 3));
  const remote = snapshot.p.find((p) => p.id === aw.id);
  assert.equal(remote.x, 7000);
  assert.equal(remote.hp, 0);
  assert.equal(remote.d, true);
  assert.equal(remote.a, 0.5);
  a.socket.close();
  await until(b, (m) => m.t === "leave" && m.id === aw.id);
  console.log("server.test.js : deux connexions indépendantes, déplacements, attaques, vie, KO, départ : ok");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clients.forEach((client) => client.terminate());
  server.kill();
  clearTimeout(timeout);
});
