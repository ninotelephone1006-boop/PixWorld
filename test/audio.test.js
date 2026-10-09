"use strict";

/**
 * Vérifie le moteur d'effets sonores sans navigateur : chaque preset doit
 * se synthétiser en un signal court et borné, l'API doit rester utilisable
 * même sans AudioContext (le jeu ne doit jamais planter à cause du son).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "audio.js"), "utf8");

function createSandbox() {
  const storage = new Map();
  const windowStub = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout(fn, delay) {
      return setTimeout(fn, delay);
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  const sandbox = { window: windowStub, console, setTimeout, clearTimeout };
  sandbox.document = { addEventListener() {}, hidden: false };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

const sandbox = createSandbox();
const audio = sandbox.window.PixWorldAudio;
assert(audio, "Le moteur audio est chargé");
assert.strictEqual(audio.supported, false, "Sans AudioContext, le moteur se déclare non supporté");

const names = audio.names;
assert(names.length >= 40, "Au moins 40 effets sonores différents sont définis (" + names.length + ")");

const expected = [
  "uiHover", "uiSelect", "uiConfirm", "uiBack", "uiPause", "uiType", "toast",
  "jump", "land", "step",
  "throwShuriken", "bowDraw", "bowRelease", "slash", "slashHeavy", "chargeOrb", "castOrb",
  "hitShuriken", "hitArrow", "hitSlash", "hitOrb", "hurt", "hurtCritical",
  "ko", "koBoom", "koEnemy", "respawn", "heartbeat", "regen",
  "playerJoin", "playerLeave", "connectionLost", "connected",
];
for (const name of expected) {
  assert(names.includes(name), "Le preset « " + name + " » existe");
}

const SAMPLE_RATE = 44100;
for (const name of names) {
  const samples = audio.build(name);
  assert(samples && samples.length > 0, "Le preset « " + name + " » produit des échantillons");
  const duration = samples.length / SAMPLE_RATE;
  assert(duration < 2.5, "Le preset « " + name + " » dure moins de 2,5 s (" + duration.toFixed(2) + " s)");
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    assert(Number.isFinite(value), "Échantillons finis pour « " + name + " »");
    if (value > peak) peak = value;
  }
  assert(peak > 0.01, "Le preset « " + name + " » n'est pas silencieux");
  assert(peak <= 1.2, "Le preset « " + name + " » ne sature pas (pic " + peak.toFixed(2) + ")");
  assert.strictEqual(audio.build(name), samples, "Le preset « " + name + " » est mis en cache");
}
console.log("  ok   " + names.length + " effets sonores synthétisés, courts et bornés");

// L'API ne doit jamais lever d'erreur, même sans son.
assert.strictEqual(audio.play("jump"), null, "play() sans AudioContext renvoie null sans planter");
assert.strictEqual(audio.playAt("land", 1200, { volume: 0.5 }), null, "playAt() sans AudioContext renvoie null");
assert.doesNotThrow(() => audio.sequence([["uiSelect", 0], ["uiSelect", 1, { pitch: 1.2 }]]), "sequence() ne plante pas");
assert.doesNotThrow(() => audio.setListener(400, 640), "setListener() ne plante pas");
assert.strictEqual(audio.play("preset-inconnu"), null, "Un nom inconnu est ignoré");

// Volume et sourdine persistés.
audio.setVolume(0.4);
assert.strictEqual(audio.volume, 0.4);
assert.strictEqual(sandbox.window.localStorage.getItem("pixworld.volume"), "0.40");
audio.setVolume(5);
assert.strictEqual(audio.volume, 1, "Le volume est borné à 1");
assert.strictEqual(audio.toggleMuted(), true, "toggleMuted() coupe le son");
assert.strictEqual(audio.muted, true);
assert.strictEqual(sandbox.window.localStorage.getItem("pixworld.muted"), "1");
assert.strictEqual(audio.toggleMuted(), false, "toggleMuted() rétablit le son");
console.log("  ok   Volume et sourdine fonctionnent et sont mémorisés");

// buildSamples accepte les paramètres ZzFX bruts.
const custom = audio.buildSamples(1, 0, 440, 0.01, 0.05, 0.05);
assert(custom.length > 1000 && custom.length < SAMPLE_RATE, "buildSamples() produit un son de la durée demandée");
console.log("Moteur audio valide");
