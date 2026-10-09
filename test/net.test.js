/**
 * Tests de la couche réseau (src/net.js), sans dépendance : `npm test`.
 *
 * On exécute net.js dans un bac à sable avec un faux WebSocket et un faux
 * transport direct (WebRTC) partagé entre deux « navigateurs » pour rejouer :
 * partie en ligne, absence de serveur, bascule en direct entre joueurs,
 * reconnexion, migration vers le serveur, URL commune et arène pleine.
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

/** Accélère les délais de net.js pour les tests (chaque bac a les siens). */
function tune(browser, values) {
  Object.assign(browser.sandbox.PixWorldNet.tuning, {
    welcome: 500,
    fallback: 60,
    retryMin: 10000,
    retryMax: 10000,
    full: 10000,
    probe: 120,
    modulePoll: 20,
    moduleGiveUp: 60,
  }, values || {});
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
      this.onmessage({ data: JSON.stringify({ t: "welcome", id: "p" + (sockets.indexOf(this) + 1), players: [] }) });
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
    location: options.location || { protocol: "http:", host: "localhost:3000", search: "" },
    WebSocket: options.noServer ? undefined : FakeWebSocket,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  if (options.p2p) sandbox.PixWorldP2P = options.p2p;
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

/**
 * Faux réseau « direct » (WebRTC) : les transports d'une même salle se
 * voient, échangent des objets JSON et se signalent les départs.
 * Partagé entre plusieurs bac-à-sable pour simuler plusieurs PC.
 */
function makeFakeP2P() {
  const rooms = new Map(); // roomId -> Map(selfId -> entrée)
  let seq = 0;
  const created = [];

  const api = {
    available: true,
    selfId: "module",
    created,
    create(options) {
      const selfId = "peer" + ++seq;
      const peers = new Map(); // peerId -> entrée distante
      const entry = { selfId, options, peers, closed: false };
      const handle = {
        selfId,
        send(message, targetPeerId) {
          if (entry.closed) return;
          const targets = targetPeerId ? (peers.has(targetPeerId) ? [targetPeerId] : []) : [...peers.keys()];
          targets.forEach((peerId) => {
            const other = peers.get(peerId);
            if (!other || other.closed) return;
            setTimeout(() => {
              if (entry.closed || other.closed) return;
              other.options.onMessage(JSON.parse(JSON.stringify(message)), selfId);
            }, 0);
          });
        },
        peerCount() {
          return [...peers.values()].filter((other) => !other.closed).length;
        },
        close() {
          if (entry.closed) return;
          entry.closed = true;
          handle.closed = true;
          const room = rooms.get(options.roomId);
          if (room) room.delete(selfId);
          [...peers].forEach(([peerId, other]) => {
            other.peers.delete(selfId);
            setTimeout(() => {
              if (!other.closed) other.options.onPeerLeave(selfId);
            }, 0);
          });
          peers.clear();
        },
      };
      entry.handle = handle;
      created.push(handle);

      const room = rooms.get(options.roomId) || new Map();
      rooms.set(options.roomId, room);
      [...room].forEach(([otherId, other]) => {
        if (other.closed) return;
        peers.set(otherId, other);
        other.peers.set(selfId, entry);
      });
      room.set(selfId, entry);

      // L'ouverture des canaux est asynchrone, comme en WebRTC.
      setTimeout(() => {
        if (entry.closed) return;
        [...peers].forEach(([peerId, other]) => {
          if (!other.closed) other.options.onPeerJoin(selfId);
        });
        [...peers.keys()].forEach((peerId) => options.onPeerJoin(peerId));
      }, 0);
      return handle;
    },
  };
  return api;
}

async function testOnlineGame() {
  console.log("Partie en ligne (serveur disponible)");
  const events = [];
  const browser = makeBrowser();
  tune(browser);
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

async function testNoServerNoModule() {
  console.log("Ni serveur ni module direct (repli honnête)");
  const browser = makeBrowser();
  tune(browser, { retryMin: 80, retryMax: 200 });
  const net = browser.sandbox.PixWorldNet.connect({ onEvent: () => {} });
  net.join("Alice", "mage");
  browser.sockets[0].fail();
  await wait(120); // la bascule en direct essaie, puis renonce
  check("pas de faux multijoueur local", net.mode === "reconnect", net.mode);
  check("reconnexion même si la première connexion échoue", browser.sockets.length === 2);
  browser.sockets[1].open();
  check("rejoint automatiquement après le premier échec", browser.sockets[1].sent[0].name === "Alice");
  net.close();
  await wait(200);
  check("close annule les tentatives", browser.sockets.length === 2);
}

async function testFallbackToP2P() {
  console.log("Sans serveur : bascule en direct (WebRTC)");
  const events = [];
  const modes = [];
  const p2p = makeFakeP2P();
  const browser = makeBrowser({ p2p });
  tune(browser);
  const net = browser.sandbox.PixWorldNet.connect({
    name: "Alice",
    character: "ninja",
    onEvent: (message) => events.push(message),
    onMode: (mode) => modes.push(mode),
  });

  browser.sockets[0].fail();
  check("le mode reste « connecting » pendant la dernière chance", net.mode === "connecting", net.mode);
  await wait(120);
  check("le mode passe à « p2p »", net.mode === "p2p", net.mode);
  check("un transport direct est ouvert", p2p.created.length === 1 && !p2p.created[0].closed);
  check("un welcome annonce notre identité", events.some((m) => m.t === "welcome" && m.id === p2p.created[0].selfId));

  net.join("Alice", "ninja");
  net.sendState({ x: 640, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "ninja", n: 0, hp: 100 });
  await wait(20);
  check("les messages partent par le direct, pas par un faux WebSocket", browser.sockets.length === 1);

  net.close();
  check("close quitte la salle directe", p2p.created[0].closed);
  await wait(200);
  check("close annule aussi les sondes serveur", browser.sockets.length === 1);
}

async function testP2PPlay() {
  console.log("Deux joueurs en direct : arrivée, états, changements, départ");
  const eventsA = [];
  const eventsB = [];
  const p2p = makeFakeP2P();
  const a = makeBrowser({ p2p, location: { protocol: "https:", host: "jeu.example", search: "" } });
  const b = makeBrowser({ p2p, location: { protocol: "https:", host: "jeu.example", search: "" } });
  tune(a);
  tune(b);
  const netA = a.sandbox.PixWorldNet.connect({
    name: "Alice",
    character: "archer",
    onEvent: (message) => eventsA.push(message),
  });
  const netB = b.sandbox.PixWorldNet.connect({
    name: "Bob",
    character: "mage",
    onEvent: (message) => eventsB.push(message),
  });

  a.sockets[0].fail();
  b.sockets[0].fail();
  await wait(140);
  check("les deux joueurs sont en direct", netA.mode === "p2p" && netB.mode === "p2p", netA.mode + "/" + netB.mode);
  check("invisible tant que le pseudo n'est pas choisi", !eventsA.some((m) => m.t === "join") && !eventsB.some((m) => m.t === "join"));

  netB.join("Bob", "mage");
  await wait(20);
  netA.join("Alice", "archer");
  await wait(20);
  const joinAtB = eventsB.find((m) => m.t === "join");
  const joinAtA = eventsA.find((m) => m.t === "join");
  check("chacun voit l'autre arriver", Boolean(joinAtB && joinAtA));
  check("le héros annoncé est respecté", joinAtB && joinAtB.player.name === "Alice" && joinAtB.player.character === "archer", JSON.stringify(joinAtB));
  check("chaque joueur a son propre identifiant", netA.id !== netB.id && joinAtB.player.id === netA.id);

  netA.sendState({ x: 7000, gap: 80, f: -1, vx: 12, vy: 0, g: false, a: 0.4, c: "archer", n: 3, hp: 42, d: true });
  await wait(20);
  const snapshot = eventsB.filter((m) => m.t === "snapshot").pop();
  check("la position lointaine est relayée", snapshot && snapshot.p[0].x === 7000, JSON.stringify(snapshot));
  check("vie, attaque et K.O. suivent", snapshot && snapshot.p[0].hp === 42 && snapshot.p[0].n === 3 && snapshot.p[0].d === true);
  check("le snapshot porte le nom et le héros", snapshot && snapshot.p[0].name === "Alice" && snapshot.p[0].character === "archer");

  netA.rename("Alice", "samurai");
  await wait(20);
  const renamed = eventsB.filter((m) => m.t === "renamed").pop();
  check("le changement de héros est relayé", renamed && renamed.player.character === "samurai", JSON.stringify(renamed));

  netA.close();
  await wait(20);
  check("le départ est annoncé à l'autre", eventsB.some((m) => m.t === "leave" && m.id === netA.id));
  check("aucun évènement réseau n'est perdu côté premier arrivé", eventsA.some((m) => m.t === "join" && m.player.name === "Bob"));
  netB.close();
}

async function testProbeMigratesWhenAlone() {
  console.log("Seul en direct : migration vers le serveur dès qu'il répond");
  const events = [];
  const p2p = makeFakeP2P();
  const browser = makeBrowser({ p2p });
  tune(browser, { probe: 90 });
  const net = browser.sandbox.PixWorldNet.connect({ onEvent: (message) => events.push(message) });

  browser.sockets[0].fail();
  await wait(120);
  check("bascule en direct", net.mode === "p2p", net.mode);
  net.join("Alice", "ninja");

  await wait(120); // laisse la sonde serveur s'ouvrir
  const probe = browser.sockets[1];
  check("une sonde serveur est tentée", Boolean(probe));
  probe.open();
  check("le serveur reprend la main", net.mode === "online", net.mode);
  check("l'arène directe est refermée", p2p.created[0].closed);
  const types = events.map((m) => m.t).join(",");
  check("les joueurs du direct sont purgés avant le welcome serveur", types.endsWith("reset,welcome"), types);
  check("le joueur se présente au serveur", probe.sent[0] && probe.sent[0].t === "hello", JSON.stringify(probe.sent));
  net.close();
}

async function testStaysOnP2PWithPeers() {
  console.log("Le direct reste maître dès qu'un pair est là");
  const p2p = makeFakeP2P();
  const a = makeBrowser({ p2p, location: { protocol: "https:", host: "jeu.example", search: "" } });
  const b = makeBrowser({ p2p, location: { protocol: "https:", host: "jeu.example", search: "" } });
  tune(a, { probe: 250 });
  tune(b);
  const netA = a.sandbox.PixWorldNet.connect({ onEvent: () => {} });
  const netB = b.sandbox.PixWorldNet.connect({ onEvent: () => {} });

  a.sockets[0].fail();
  b.sockets[0].fail();
  await wait(140);
  netA.join("Alice", "ninja");
  netB.join("Bob", "mage");
  await wait(30);
  check("les deux joueurs sont appareillés", netA.mode === "p2p" && netB.mode === "p2p");

  await wait(200); // la sonde serveur de A s'ouvre après l'arrivée de B
  const probe = a.sockets[1];
  check("la sonde serveur a quand même eu lieu", Boolean(probe));
  probe.open();
  check("A reste en direct malgré le serveur", netA.mode === "p2p", netA.mode);
  check("le socket de sonde est jeté", probe.readyState === 3);
  check("personne n'est migré", netB.mode === "p2p");
  netA.close();
  netB.close();
}

async function testReconnect() {
  console.log("Reconnexion après une coupure du serveur");
  const events = [];
  const modes = [];
  const p2p = makeFakeP2P();
  const browser = makeBrowser({ p2p });
  tune(browser, { retryMin: 120, retryMax: 300 });
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

  await wait(160);
  check("une nouvelle tentative est lancée", browser.sockets.length === 2, "nb sockets = " + browser.sockets.length);
  browser.sockets[1].fail();

  await wait(320);
  check("la tentative suivante attend plus longtemps", browser.sockets.length === 3, "nb sockets = " + browser.sockets.length);

  browser.sockets[2].open();
  check("le mode repasse à « online »", net.mode === "online", net.mode);
  const last = browser.sockets[2].sent[0];
  check("le joueur se représente avec son pseudo et son héros", last && last.t === "hello" && last.name === "Alice" && last.character === "samurai", JSON.stringify(last));
  check("jamais de bascule en direct après un serveur connu", p2p.created.length === 0);
  net.close();
}

async function testAddressAndFull() {
  console.log("Adresse partagée, salle privée et arène pleine");
  const browser = makeBrowser({
    p2p: makeFakeP2P(),
    storage: createStorage({ "pixworld.server": "192.168.1.8" }),
    location: { protocol: "https:", host: "jeu.example", search: "?room=famille&server=other.example" },
  });
  tune(browser);
  const api = browser.sandbox.PixWorldNet;
  check("HTTPS et ancienne adresse ignorée", api.resolveServerUrl().url === "wss://jeu.example/ws");

  const net = api.connect({ onEvent: () => {} });
  check("le lien partagé pointe la page et la salle", net.serverInfo && net.serverInfo.shareUrl === "https://jeu.example/?room=famille", net.serverInfo && net.serverInfo.shareUrl);

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
  await testNoServerNoModule();
  await testFallbackToP2P();
  await testP2PPlay();
  await testProbeMigratesWhenAlone();
  await testStaysOnP2PWithPeers();
  await testReconnect();
  await testAddressAndFull();
  process.exitCode = failures ? 1 : 0;
})();
