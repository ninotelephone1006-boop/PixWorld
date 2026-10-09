/**
 * Petit serveur PixWorld : fichiers statiques + WebSocket, sans dépendance.
 *
 *   npm start            → http://localhost:3000
 *   PORT=8080 npm start  → autre port
 *
 * Chaque client envoie son état 20 fois par seconde. Le terrain et les items
 * (minage et inventaires lâchés à la mort) sont partagés en mémoire jusqu'au
 * redémarrage du serveur ; les joueurs disparaissent à la déconnexion.
 *
 * Il écoute sur toutes les interfaces : les autres PC du réseau (Wi-Fi,
 * Ethernet…) peuvent donc rejoindre la partie. En production, le service
 * public HTTPS héberge le jeu et relaie les WebSockets sur la même origine.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.resolve(__dirname, "..");

const TICK_MS = 50; // 20 snapshots par seconde
const MAX_PLAYERS = 24;
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 80;
const IDLE_TIMEOUT_MS = 20000;
const worldContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src/world.js"), "utf8"), worldContext);
const WORLD_WIDTH = worldContext.window.PixWorldWorld.create("pixworld").width;
const miningContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src/mining.js"), "utf8"), miningContext);
const MINING = miningContext.window.PixWorldMining.constants;
const MINING_COLUMNS = Math.ceil(WORLD_WIDTH / MINING.BLOCK_SIZE);
const MINED_BLOCKS = new Set();
const PLACED_BLOCKS = new Map(); // « col,row » -> type (blocs posés)
const MINING_DROPS = new Map();
const BLOCK_TYPES = new Set(["grass", "dirt", "stone"]);

/** Une cellule est-elle solide, vue du serveur (pour la règle d'adjacence) ? */
function serverSolidAt(column, row) {
  if (row >= MINING.ROWS) return true; // plancher du monde
  if (column < 0 || column >= MINING_COLUMNS || row < MINING.MIN_ROW) return false;
  const key = column + "," + row;
  if (PLACED_BLOCKS.has(key)) return true;
  return row >= 0 && !MINED_BLOCKS.has(key);
}
const CHARACTER_IDS = new Set(["ninja", "archer", "samurai", "mage"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

// ───────────────────────────── Fichiers statiques ─────────────────────────────

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch (error) {
    res.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/players") {
    const roster = Array.from(players.values())
      .filter((p) => p.joined)
      .map((p) => ({ name: p.name, character: p.character }));
    res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
    res.end(JSON.stringify({ online: roster.length, players: roster }));
    return;
  }

  if (pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  // Ne jamais exposer .git, les tests ou les fichiers de configuration.
  if (pathname !== "/index.html" && !/^\/(src|assets)\//.test(pathname)) {
    res.writeHead(404).end("Not found");
    return;
  }

  // On refuse toute sortie du dossier du projet (../ etc.).
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404 — introuvable");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(data);
  });
});

// ───────────────────────────── État des joueurs ─────────────────────────────

/** id -> { id, name, character, socket, state, lastSeen, rate } */
const players = new Map();
let nextId = 1;

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanName(raw) {
  const text = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14);
  return text || "Ninja";
}

function cleanCharacter(raw) {
  return CHARACTER_IDS.has(raw) ? raw : "ninja";
}

function send(socket, message) {
  if (socket.destroyed || !socket.writable) return;
  try {
    socket.write(encodeFrame(JSON.stringify(message)));
  } catch (error) {
    /* socket partie : on ignore */
  }
}

function broadcast(message, exceptId) {
  players.forEach((player) => {
    if (player.id !== exceptId) send(player.socket, message);
  });
}

function miningSnapshot() {
  return {
    mined: Array.from(MINED_BLOCKS, (key) => key.split(",").map(Number)),
    placed: Array.from(PLACED_BLOCKS.entries(), ([key, type]) => {
      const [column, row] = key.split(",").map(Number);
      return [column, row, type];
    }),
    drops: Array.from(MINING_DROPS.values(), (drop) => ({ ...drop })),
  };
}

// ───────────────────────── WebSocket : handshake (RFC 6455) ─────────────────────────

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

server.on("upgrade", (req, socket) => {
  let pathname = "";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (error) {
    socket.destroy();
    return;
  }

  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n",
  );
  socket.setNoDelay(true);
  registerPlayer(socket);
});

function registerPlayer(socket) {
  if (players.size >= MAX_PLAYERS) {
    send(socket, { t: "full" });
    socket.end();
    return;
  }

  const id = "p" + nextId++;
  const player = {
    id,
    name: "Ninja",
    character: "ninja",
    socket,
    lastSeen: Date.now(),
    joined: false, // devient vrai à la réception du "hello" (pseudo choisi)
    messages: 0,
    windowStart: Date.now(),
    lastDeathDropSerial: -1,
    state: { x: 112, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "ninja", n: 0, hp: 100, d: false },
  };
  players.set(id, player);

  const roster = [];
  players.forEach((other) => {
    if (other.id !== id && other.joined) {
      roster.push({ id: other.id, name: other.name, character: other.character });
    }
  });
  send(socket, { t: "welcome", id, players: roster, mining: miningSnapshot() });
  console.log("+ " + id + " connecté (" + players.size + " joueur(s))");

  const handleFrame = createFrameHandler(player);
  socket.on("data", (chunk) => {
    try {
      handleFrame(chunk);
    } catch (error) {
      socket.destroy();
    }
  });
  socket.on("error", () => removePlayer(id));
  socket.on("close", () => removePlayer(id));
  socket.on("end", () => removePlayer(id));
}

function removePlayer(id) {
  const player = players.get(id);
  if (!player) return;
  players.delete(id);
  broadcast({ t: "leave", id });
  console.log("- " + id + " déconnecté (" + players.size + " joueur(s))");
}

// ───────────────────────────── Messages entrants ─────────────────────────────

function handleMessage(player, message) {
  player.lastSeen = Date.now();

  // Anti-flood : on compte les messages reçus dans la seconde écoulée.
  const now = Date.now();
  if (now - player.windowStart > 1000) {
    player.windowStart = now;
    player.messages = 0;
  }
  if (++player.messages > MAX_MESSAGES_PER_SECOND) return;

  if (!message || typeof message !== "object") return;

  if (message.t === "hello" || message.t === "rename") {
    player.name = cleanName(message.name);
    player.character = cleanCharacter(message.character);
    const info = { id: player.id, name: player.name, character: player.character };
    if (message.t === "hello") {
      player.joined = true;
      broadcast({ t: "join", player: info }, player.id);
    } else {
      broadcast({ t: "renamed", id: player.id, player: info }, player.id);
    }
    return;
  }

  if (message.t === "state") {
    player.state = {
      x: Math.round(clampNumber(message.x, 0, WORLD_WIDTH, player.state.x)),
      gap: Math.round(clampNumber(message.gap, -MINING.TOTAL_HEIGHT - 600, 4000, 0)),
      f: Number(message.f) < 0 ? -1 : 1,
      vx: Math.round(clampNumber(message.vx, -4000, 4000, 0)),
      vy: Math.round(clampNumber(message.vy, -4000, 4000, 0)),
      g: Boolean(message.g),
      a: clampNumber(message.a, 0, 1, 0),
      c: cleanCharacter(message.c || player.character),
      n: Math.floor(clampNumber(message.n, 0, 2147483647, player.state.n || 0)),
      hp: Math.round(clampNumber(message.hp, 0, 100, player.state.hp == null ? 100 : player.state.hp)),
      d: Boolean(message.d), // K.O. en cours : les autres jouent l'animation
    };
    return;
  }

  if (message.t === "mineBlock") {
    if (!player.joined) return;
    const column = Number(message.column);
    const row = Number(message.row);
    const serial = Number(message.serial);
    if (!Number.isInteger(column) || column < 0 || column >= MINING_COLUMNS ||
        !Number.isInteger(row) || row < MINING.MIN_ROW || row >= MINING.ROWS ||
        !Number.isSafeInteger(serial) || serial < 0 || serial > 2147483647) return;

    const key = column + "," + row;
    const dropId = player.id + ":" + serial;
    // Un bloc posé prime sur l'historique du terrain naturel : une case
    // creusée puis rebouchée doit pouvoir être cassée de nouveau.
    const placedType = PLACED_BLOCKS.get(key);
    const naturalType = row >= 0 && !MINED_BLOCKS.has(key) ? MINING.LAYER_TYPES[row] : null;
    const type = placedType || naturalType;
    // La roche mère reste incassable ; une cellule vide ne donne aucun drop.
    if (row === MINING.ROWS - 1 || !type || MINING_DROPS.has(dropId)) {
      send(player.socket, { t: "mineRejected", column, row, serial });
      return;
    }
    if (placedType) PLACED_BLOCKS.delete(key);
    else MINED_BLOCKS.add(key);
    const drop = { id: dropId, column, row, type, ownerId: player.id };
    MINING_DROPS.set(dropId, drop);
    broadcast({ t: "mineBlock", ...drop, dropId, serial });
    return;
  }

  if (message.t === "placeBlock") {
    if (!player.joined) return;
    const column = Number(message.column);
    const row = Number(message.row);
    const type = String(message.type || "");
    const serial = Number(message.serial);
    const reject = () => send(player.socket, { t: "placeRejected", column, row, serial });
    if (!Number.isInteger(column) || column < 0 || column >= MINING_COLUMNS ||
        !Number.isInteger(row) || row < MINING.MIN_ROW || row >= MINING.ROWS ||
        !Number.isSafeInteger(serial) || serial < 0 || serial > 2147483647 ||
        !BLOCK_TYPES.has(type)) {
      reject();
      return;
    }
    const key = column + "," + row;
    // Cellule vide + collée à au moins un bloc existant (jamais en l'air).
    const empty = !PLACED_BLOCKS.has(key) && (row < 0 || MINED_BLOCKS.has(key));
    const adjacent =
      serverSolidAt(column - 1, row) || serverSolidAt(column + 1, row) ||
      serverSolidAt(column, row - 1) || serverSolidAt(column, row + 1);
    if (!empty || !adjacent) {
      reject();
      return;
    }
    PLACED_BLOCKS.set(key, type);
    broadcast({ t: "placeBlock", column, row, type, ownerId: player.id, serial });
    return;
  }

  if (message.t === "deathDrop") {
    if (!player.joined) return;
    const { x, depth, inventory, serial } = message;
    if (!Number.isFinite(x) || x < 0 || x > WORLD_WIDTH ||
        !Number.isFinite(depth) || depth < MINING.MIN_ROW * MINING.BLOCK_SIZE - 4000 || depth > MINING.TOTAL_HEIGHT + 600 ||
        !Number.isSafeInteger(serial) || serial < 0 || serial > 2147483647 ||
        !inventory || typeof inventory !== "object" || Array.isArray(inventory) ||
        Object.keys(inventory).some((type) => !BLOCK_TYPES.has(type))) return;
    const items = [];
    for (const type of BLOCK_TYPES) {
      const quantity = inventory[type] == null ? 0 : inventory[type];
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) return;
      if (quantity > 0) items.push({ type, quantity });
    }
    // Ne jamais recréer un butin confirmé, même si ses piles sont déjà ramassées.
    if (!items.length || serial <= player.lastDeathDropSerial) return;
    player.lastDeathDropSerial = serial;
    const drops = items.map(({ type, quantity }) => ({
      id: player.id + ":death:" + serial + ":" + type,
      kind: "death", type, quantity, x, depth,
      column: Math.floor(x / MINING.BLOCK_SIZE),
      row: Math.floor(depth / MINING.BLOCK_SIZE),
      ownerId: player.id,
    }));
    drops.forEach((drop) => MINING_DROPS.set(drop.id, drop));
    broadcast({ t: "deathDrop", ownerId: player.id, serial, drops });
    return;
  }

  if (message.t === "minePickup") {
    if (!player.joined) return;
    const dropId = typeof message.dropId === "string" ? message.dropId.slice(0, 80) : "";
    if (!dropId || !MINING_DROPS.has(dropId)) return;
    MINING_DROPS.delete(dropId);
    broadcast({ t: "minePickup", dropId, collectorId: player.id });
  }
}

// ───────────────────────────── Envoi des positions ─────────────────────────────

setInterval(() => {
  if (!players.size) return;
  const snapshot = [];
  const stale = [];
  const now = Date.now();

  players.forEach((player) => {
    if (now - player.lastSeen > IDLE_TIMEOUT_MS) {
      stale.push(player.id);
      return;
    }
    // Tant que le pseudo n'est pas choisi, le joueur reste invisible.
    if (player.joined) {
      snapshot.push(Object.assign({
        id: player.id,
        name: player.name,
        character: player.character,
      }, player.state));
    }
  });

  stale.forEach((id) => {
    const player = players.get(id);
    if (player) {
      players.delete(id);
      try {
        player.socket.destroy();
      } catch (error) {
        /* déjà fermée */
      }
      broadcast({ t: "leave", id });
    }
  });

  if (snapshot.length) broadcast({ t: "snapshot", p: snapshot });
}, TICK_MS);

// ───────────────────────── WebSocket : décodage des trames ─────────────────────────

function encodeFrame(text, opcode) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;
  const code = opcode === undefined ? 0x1 : opcode;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | code;
  return Buffer.concat([header, payload]);
}

/**
 * Décode les trames envoyées par le navigateur (toujours masquées).
 * Renvoie une fonction à alimenter avec les paquets TCP reçus.
 */
function createFrameHandler(player) {
  let buffer = Buffer.alloc(0);

  return function feed(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      if (buffer.length < 2) return;
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) throw new Error("trame trop grande");
        length = Number(big);
        offset = 10;
      }

      if (length > MAX_MESSAGE_BYTES) throw new Error("trame trop grande");
      const maskLength = masked ? 4 : 0;
      const frameEnd = offset + maskLength + length;
      if (buffer.length < frameEnd) return;

      let payload = Buffer.from(buffer.subarray(offset + maskLength, frameEnd));
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buffer = buffer.subarray(frameEnd);

      if (opcode === 0x8) {
        // Demande de fermeture : on renvoie un acquittement et on coupe.
        try {
          player.socket.end(encodeFrame(Buffer.alloc(0), 0x8));
        } catch (error) {
          /* déjà fermée */
        }
        removePlayer(player.id);
        return;
      }
      if (opcode === 0x9) {
        // Ping : on répond pong avec le même contenu.
        try {
          player.socket.write(encodeFrame(payload, 0xa));
        } catch (error) {
          /* déjà fermée */
        }
        continue;
      }
      if (opcode !== 0x1) continue; // on ignore le binaire et les continuations

      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch (error) {
        continue;
      }
      handleMessage(player, message);
    }
  };
}

server.listen(PORT, HOST, () => {
  console.log("PixWorld — http://localhost:" + PORT + " (websocket sur /ws)");
});
