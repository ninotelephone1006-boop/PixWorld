/**
 * Tests de la couche réseau (src/net.js), sans dépendance : `npm test`.
 *
 * On exécute net.js dans un bac à sable avec un faux WebSocket et un faux
 * BroadcastChannel, ce qui permet de rejouer tous les cas : partie en ligne,
 * absence de serveur, reconnexion et mode « onglets ».
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
    location: { protocol: "http:", host: "localhost:3000" },
    WebSocket: options.noServer ? undefined : FakeWebSocket,
    BroadcastChannel: options.channelClass,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(NET_SOURCE, sandbox);

  return { sandbox, sockets, timers };
}

/** Faux BroadcastChannel partagé entre plusieurs « onglets » du test. */
function createChannelBus() {
  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      channels.push(this);
    }
    postMessage(data) {
      channels.forEach((other) => {
        if (other !== this && other.name === this.name && other.onmessage) {
          // Copie profonde : le vrai canal clone les données.
          other.onmessage({ data: JSON.parse(JSON.stringify(data)) });
        }
      });
    }
    close() {
      const index = channels.indexOf(this);
      if (index >= 0) channels.splice(index, 1);
    }
  }
  return FakeBroadcastChannel;
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

  const types = events.map((m) => m.t).join(",");
  check("les joueurs déjà présents sont annoncés", types === "welcome,snapshot,leave", types);
  check("le joueur distant garde son personnage", events[0].players[0].name === "Bob" && events[0].players[0].character === "mage");
  check("les points de vie distants sont relayés", events[1].p[0].hp === 55, JSON.stringify(events[1]));

  net.close();
}

async function testNoServer() {
  console.log("Sans serveur, repli sur les onglets du navigateur");
  const browser = makeBrowser({ channelClass: createChannelBus() });
  const net = browser.sandbox.PixWorldNet.connect({ name: "Alice", onEvent: () => {} });
  browser.sockets[0].fail();
  check("le mode bascule sur « local »", net.mode === "local", net.mode);
  net.join("Alice");
  net.close();
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

async function testLocalTabs() {
  console.log("Mode local : deux onglets se voient");
  const bus = createChannelBus();
  const eventsA = [];
  const eventsB = [];
  const a = makeBrowser({ noServer: true, channelClass: bus });
  const b = makeBrowser({ noServer: true, channelClass: bus });

  const netA = a.sandbox.PixWorldNet.connect({ name: "Alice", character: "archer", onEvent: (m) => eventsA.push(m) });
  const netB = b.sandbox.PixWorldNet.connect({ name: "Bob", character: "mage", onEvent: (m) => eventsB.push(m) });

  netA.join("Alice", "archer");
  netB.join("Bob", "mage");

  netB.sendState({ x: 500, gap: 12, f: -1, vx: -340, vy: 0, g: true, a: 0.3, c: "mage", n: 1, hp: 42 });
  await wait(120);

  const joinOnA = eventsA.filter((m) => m.t === "join");
  check("Alice voit Bob avec son personnage", joinOnA.length === 1 && joinOnA[0].player.name === "Bob" && joinOnA[0].player.character === "mage", JSON.stringify(joinOnA));

  const snapshotOnA = eventsA.filter((m) => m.t === "snapshot").pop();
  check("Alice reçoit la position et l'attaque de Bob", snapshotOnA && snapshotOnA.p[0].x === 500 && snapshotOnA.p[0].gap === 12 && snapshotOnA.p[0].c === "mage" && snapshotOnA.p[0].n === 1, JSON.stringify(snapshotOnA));
  check("Alice reçoit la vie de Bob", snapshotOnA && snapshotOnA.p[0].hp === 42, JSON.stringify(snapshotOnA));

  const joinOnB = eventsB.filter((m) => m.t === "join");
  check("Bob voit Alice", joinOnB.length === 1 && joinOnB[0].player.name === "Alice" && joinOnB[0].player.character === "archer", JSON.stringify(joinOnB));

  netA.close();
  netB.close();
}

(async () => {
  await testOnlineGame();
  await testNoServer();
  await testReconnect();
  await testLocalTabs();
  console.log(failures ? "\n" + failures + " test(s) en échec" : "\nTous les tests passent");
  process.exit(failures ? 1 : 0);
})();
