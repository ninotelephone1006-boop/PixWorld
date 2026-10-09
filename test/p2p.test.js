"use strict";

/**
 * Tests du transport direct entre joueurs (src/p2p.js + Trystero vendue) :
 * la page charge le module, tous les fichiers vendus sont des modules ES
 * syntaxiquement valides, et le module s'enregistre sur window.PixWorldP2P
 * avec une API utilisable par src/net.js.
 */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const P2P = path.join(ROOT, "src", "p2p.js");
const VENDOR = path.join(ROOT, "src", "vendor", "trystero");

// 1. La page charge le transport direct comme module ES.
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
assert.match(html, /<script type="module" src="src\/p2p\.js"><\/script>/,
  "index.html charge src/p2p.js en module");

// 2. Le module et la librairie vendue existent, et chaque fichier est un
//    module ES syntaxiquement valide (`node --check` sur une copie .mjs :
//    l'extension .mjs force le mode module, sans toucher au dépôt).
function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJs(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}
const files = [P2P, ...listJs(VENDOR)];
assert.ok(files.length >= 15, "la librairie vendue est présente (" + files.length + " fichiers)");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pixworld-p2p-"));
try {
  files.forEach((file, index) => {
    const copy = path.join(tmp, "check-" + index + ".mjs");
    fs.copyFileSync(file, copy);
    const result = spawnSync(process.execPath, ["--check", copy], { encoding: "utf8" });
    assert.equal(result.status, 0, file + " est un module ES valide : " + result.stderr);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. Le module s'importe sans navigateur (la chaîne d'imports embarque toute
//    la librairie vendue) et s'enregistre pour src/net.js.
(async () => {
  globalThis.window = {};
  await import(pathToFileURL(P2P).href);
  const api = globalThis.window.PixWorldP2P;
  assert.ok(api, "window.PixWorldP2P est enregistré");
  assert.equal(typeof api.create, "function", "l'API expose create()");
  assert.equal(typeof api.selfId, "string", "selfId est exposé");
  assert.ok(api.selfId.length > 0, "selfId n'est pas vide");
  assert.equal(api.available, false, "sans RTCPeerConnection, le direct est indisponible");
  console.log("p2p.test.js : module chargé, " + files.length + " fichiers ES valides, API enregistrée : ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
