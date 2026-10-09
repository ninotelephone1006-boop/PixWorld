/**
 * Tests de la couche réseau (src/net.js), sans dépendance : `npm test`.
 *
 * On exécute net.js dans un bac à sable avec un faux WebSocket
 * pour rejouer les cas : partie en ligne,
 * absence de serveur, reconnexion, URL commune et arène pleine.
 */
"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const NET_SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "net.js"), "utf8");

let failures = 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(label, condition, detail) {
  if (condition) {
    console.log("  ok   " + label);
  } else {
    failures++;
    console.log("  ÉCHEC " + label + (detail ? " → " + detail : ""));
  }
}

/** Crée un environnement navigateur minimal avec un faux WebSocket. */
function makeBrowser(options) {
  options = options || {};
  const sockets = [];
  const timers = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({});
    }
    /** Simule l'ouverture côté navigateur. */
    open() {
      this.readyState = 1;
      if (this.onopen) this.onopen({});
      this.onmessage({ data: JSON.stringify({ t: "welcome", id: "p1", players: [] }) });
    }
    /** Simule un échec de connexion (serveur absent). */
    fail() {
      this.readyState = 3;
      if (this.onerror) this.onerror(new Error("connexion refusée"));
      if (this.onclose) this.onclose({});
    }
  }

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    navigator: {},
    localStorage: options.storage || createStorage(),
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    },
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      timers.push(id);
      return id;
    },
    clearInterval: (id) => clearInterval(id),
    location: { protocol: "http:", host: "localhost:3000", search: "" },
    WebSocket: options.noServer ? undefined : FakeWebSocket,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(NET_SOURCE, sandbox);

  return { sandbox, sockets, timers };
}

/** Faux localStorage, pour rejouer la mémorisation de l'adresse. */
function createStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

async function testOnlineGame() {
  console.log("Partie en ligne (serveur disponible)");
  const events = [];
  const browser = makeBrowser();
  const net = browser.sandbox.PixWorldNet.connect({
    name: "Ninja",
    character: "archer",
    onEvent: (message) => events.push(message),
  });

  const socket = browser.sockets[0];
  check("une connexion WebSocket est ouverte", Boolean(socket));
  check("aucun pseudo envoyé avant d'avoir rejoint", socket.sent.length === 0, JSON.stringify(socket.sent));

  socket.open();
  check("le mode passe à « online »", net.mode === "online", net.mode);

  net.join("Alice", "archer");
  const hello = socket.sent[0];
  check("le pseudo et le personnage sont annoncés", hello && hello.t === "hello" && hello.name === "Alice" && hello.character === "archer", JSON.stringify(hello));
  check("aucune couleur envoyée dans le protocole", hello && !("color" in hello));

  net.sendState({ x: 120, gap: 0, f: 1, vx: 340, vy: 0, g: true, a: 0, c: "archer", n: 2, hp: 86 });
  check("la position et l'attaque sont envoyées", socket.sent[1] && socket.sent[1].t === "state" && socket.sent[1].x === 120 && socket.sent[1].c === "archer" && socket.sent[1].n === 2);
  check("les points de vie sont envoyés", socket.sent[1] && socket.sent[1].hp === 86, JSON.stringify(socket.sent[1]));

  net.rename("Alice", "mage");
  check("le changement de héros est transmis", socket.sent[2] && socket.sent[2].t === "rename" && socket.sent[2].character === "mage");

  socket.onmessage({ data: JSON.stringify({ t: "welcome", id: "p1", players: [{ id: "p2", name: "Bob", character: "mage" }] }) });
  socket.onmessage({ data: JSON.stringify({ t: "snapshot", p: [{ id: "p2", x: 400, gap: 30, f: -1, vx: 0, vy: 0, g: false, a: 0, hp: 55 }] }) });
  socket.onmessage({ data: JSON.stringify({ t: "leave", id: "p2" }) });

  events.shift(); // premier welcome simulé à l’ouverture
  const types = events.map((m) => m.t).join(",");
  check("les joueurs déjà présents sont annoncés", types === "welcome,snapshot,leave", types);
  check("le joueur distant garde son personnage", events[0].players[0].name === "Bob" && events[0].players[0].character === "mage");
  check("les points de vie distants sont relayés", events[1].p[0].hp === 55, JSON.stringify(events[1]));

  net.close();
}

async function testNoServer() {
  const browser = makeBrowser();
  const net = browser.sandbox.PixWorldNet.connect({ onEvent: () => {} });
  net.join("Alice", "mage");
  browser.sockets[0].fail();
  check("pas de faux multijoueur local", net.mode === "reconnect");
  await wait(1700);
  check("reconnexion même si la première connexion échoue", browser.sockets.length === 2);
  browser.sockets[1].open();
  check("rejoint automatiquement après le premier échec", browser.sockets[1].sent[0].name === "Alice");
  net.close();
  await wait(1700);
  check("close annule les tentatives", browser.sockets.length === 2);
}

async function testReconnect() {
  console.log("Reconnexion après une coupure du serveur");
  const events = [];
  const modes = [];
  const browser = makeBrowser();
  const net = browser.sandbox.PixWorldNet.connect({
    name: "Alice",
    character: "samurai",
    onEvent: (message) => events.push(message),
    onMode: (mode) => modes.push(mode),
  });

  browser.sockets[0].open();
  net.join("Alice", "samurai");
  browser.sockets[0].fail(); // le serveur tombe
  check("le jeu est prévenu de la coupure", events.some((m) => m.t === "disconnected"));
  check("le mode devient « reconnect »", net.mode === "reconnect", net.mode);

  await wait(1700);
  check("une nouvelle tentative est lancée", browser.sockets.length === 2, "nb sockets = " + browser.sockets.length);
  browser.sockets[1].fail();

  await wait(3200);
  check("la tentative suivante attend plus longtemps", browser.sockets.length === 3, "nb sockets = " + browser.sockets.length);

  browser.sockets[2].open();
  check("le mode repasse à « online »", net.mode === "online", net.mode);
  const last = browser.sockets[2].sent[0];
  check("le joueur se représente avec son pseudo et son héros", last && last.t === "hello" && last.name === "Alice" && last.character === "samurai", JSON.stringify(last));
  net.close();
}

async function testAddressAndFull() {
  const browser = makeBrowser({ storage: createStorage({ "pixworld.server": "192.168.1.8" }) });
  browser.sandbox.location = { protocol: "https:", host: "jeu.example", search: "?server=other.example" };
  const api = browser.sandbox.PixWorldNet;
  check("HTTPS et ancienne adresse ignorée", api.resolveServerUrl().url === "wss://jeu.example/ws");
  const net = api.connect({ onEvent: () => {} });
  browser.sockets[0].readyState = 1;
  browser.sockets[0].onmessage({ data: '{"t":"full"}' });
  check("arène pleine sans fausse connexion", net.mode === "full");
  net.close();
  browser.sandbox.location = { protocol: "file:", host: "" };
  const local = api.connect({ onEvent: () => {} });
  check("fichier local explicitement indisponible", local.mode === "unavailable");
  local.close();
}
(async () => {
  await testOnlineGame();
  await testNoServer();
  await testReconnect();
  await testAddressAndFull();
  process.exitCode = failures ? 1 : 0;
})();
