"use strict";

/**
 * Vérifie la banque de sons reprise de GitHub et adaptée par
 * tools/build-sfx.mjs : le catalogue (src/sfx-library.js) doit coller aux
 * fichiers réellement présents dans assets/sfx/, et chaque fichier doit être
 * un Wave mono court, audible et de taille raisonnable.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SFX_DIR = path.join(ROOT, "assets", "sfx");

/** Lit src/sfx-library.js comme le ferait le navigateur. */
function loadLibrary() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src", "sfx-library.js"), "utf8"), sandbox);
  return sandbox.window.PixWorldSfxLibrary;
}

/** Analyse minimale d'un Wave PCM 16 bits. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF", `${file} : en-tête RIFF`);
  assert.strictEqual(buf.toString("ascii", 8, 12), "WAVE", `${file} : en-tête WAVE`);
  let offset = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      assert.strictEqual(buf.readUInt16LE(body), 1, `${file} : PCM attendu`);
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  assert(data && data.length, `${file} : données absentes`);
  let peak = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    const value = Math.abs(data.readInt16LE(i)) / 32768;
    if (value > peak) peak = value;
  }
  return { channels, rate, bits, peak, duration: data.length / 2 / channels / rate };
}

const library = loadLibrary();
assert(library, "La banque de sons est exposée dans window.PixWorldSfxLibrary");
assert(library.source && /github/.test(library.source.url), "La provenance GitHub est documentée");
assert.strictEqual(library.source.repo, "Daarko/sparkstream-sounds");

const events = Object.keys(library.events);
assert(events.length >= 35, `Au moins 35 événements sonores (« ${events.length} »)`);

let files = 0;
let bytes = 0;
for (const name of events) {
  const entry = library.events[name];
  assert(entry.files.length >= 3, `« ${name} » possède au moins 3 variantes`);
  assert(entry.gain > 0 && entry.gain <= 1, `« ${name} » a un gain d'équilibrage`);
  for (const file of entry.files) {
    const target = path.join(SFX_DIR, file);
    assert(fs.existsSync(target), `Le fichier ${file} existe`);
    const info = readWav(target);
    assert.strictEqual(info.channels, 1, `${file} est en mono`);
    assert.strictEqual(info.rate, 44100, `${file} est échantillonné à 44,1 kHz`);
    assert.strictEqual(info.bits, 16, `${file} est en 16 bits`);
    assert(info.duration <= 0.85, `${file} dure moins de 0,85 s (${info.duration.toFixed(2)} s)`);
    assert(info.peak > 0.05, `${file} n'est pas silencieux`);
    assert(info.peak <= 1, `${file} ne sature pas`);
    files++;
    bytes += fs.statSync(target).size;
  }
}

assert(files >= 150, `Au moins 150 sons adaptés (« ${files} »)`);
assert(bytes < 8 * 1024 * 1024, `La banque reste légère (${(bytes / 1024 / 1024).toFixed(1)} Mo)`);
console.log(`  ok   ${files} sons adaptés (${events.length} événements, ${(bytes / 1024 / 1024).toFixed(1)} Mo)`);

// Aucun fichier orphelin : tout ce qui est dans assets/sfx est référencé.
const referenced = new Set();
events.forEach((name) => library.events[name].files.forEach((file) => referenced.add(file)));
const onDisk = fs.readdirSync(SFX_DIR).filter((file) => file.endsWith(".wav"));
onDisk.forEach((file) => assert(referenced.has(file), `${file} est référencé par la banque`));
assert.strictEqual(referenced.size, onDisk.length, "Aucun fichier manquant ni orphelin");

// Les pas du niveau sont associés à de vraies prises d'herbe CC0 ; leurs
// six variantes synthétisées restent disponibles hors ligne.
assert(!events.includes("step"), "Le nom générique step est résolu par matière");
assert(library.events.stepGrass, "Les pas de l'herbe ont un événement dans la banque");
assert.strictEqual(library.events.stepGrass.files.length, 5, "Cinq variantes d'herbe sont incluses");
assert(
  library.events.stepGrass.sourceFiles.every((file) => file.includes("footstep_grass")),
  "Les pas proviennent d'enregistrements d'herbe, pas d'un preset générique",
);
assert(
  library.events.castOrb.sourceFiles.every((file) => file.includes("thrusterFire")),
  "Le lancement de l'orbe utilise une source de combustion",
);
assert(
  library.events.hitOrb.sourceFiles.every((file) => file.includes("explosionCrunch")),
  "L'impact de l'orbe utilise une source d'explosion",
);
console.log("  ok   Correspondance thématique des pas d'herbe et des effets de feu");

// Chaque événement doit aussi exister côté moteur audio (repli synthèse).
const audioSource = fs.readFileSync(path.join(ROOT, "src", "audio.js"), "utf8");
const audioSandbox = { window: {}, console };
vm.createContext(audioSandbox);
vm.runInContext(audioSource, audioSandbox);
const presets = new Set(audioSandbox.window.PixWorldAudio.names);
events.forEach((name) => {
  assert(presets.has(name), `« ${name} » a bien un preset de secours dans src/audio.js`);
});
console.log("  ok   Chaque événement garde un preset de synthèse de secours");

console.log("Banque de sons valide");
