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
  // La banque de fichiers est chargée avant le moteur, comme dans index.html.
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "sfx-library.js"), "utf8"),
    sandbox,
  );
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

// Banque de fichiers : les événements sont connus, aucun n'est encore décodé
// (il n'y a ni AudioContext ni fetch sous Node).
const bank = audio.bank;
assert(bank.events.length >= 35, "La banque déclare tous les événements (" + bank.events.length + ")");
assert(bank.files >= 150, "La banque déclare au moins 150 fichiers (" + bank.files + ")");
assert.strictEqual(bank.path, "assets/sfx/", "Les fichiers sont servis depuis assets/sfx/");
assert.strictEqual(bank.loaded, 0, "Rien n'est décodé sans AudioContext");
bank.events.forEach((name) => assert(names.includes(name), "« " + name + " » a un preset de secours"));
console.log("  ok   " + bank.files + " fichiers déclarés pour " + bank.events.length + " événements");

// Pas adaptés à la matière : l'herbe a des fichiers dédiés et toutes les
// matières gardent plusieurs variantes de secours synthétisées.
const materials = audio.footstepMaterials;
assert(materials.length >= 3, "Au moins trois matières de pas");
materials.forEach((material) => {
  for (let variant = 1; variant <= 6; variant++) {
    const name = "step" + material[0].toUpperCase() + material.slice(1) + variant;
    assert(names.includes(name), "Le pas « " + name + " » existe");
    const samples = audio.build(name);
    assert(samples.length > 200, "Le pas « " + name + " » produit du son");
    const duration = samples.length / SAMPLE_RATE;
    assert(duration < 0.25, "Le pas « " + name + " » reste bref (" + duration.toFixed(3) + " s)");
  }
});
// Deux variantes d'une même matière ne doivent pas être identiques.
const first = audio.build("stepGrass1");
const second = audio.build("stepGrass2");
let difference = 0;
for (let i = 0; i < Math.min(first.length, second.length); i++) difference += Math.abs(first[i] - second[i]);
assert(difference > 0.5, "Les variantes de pas diffèrent");
assert.strictEqual(audio.footstepMaterial, "grass", "Matière de pas par défaut");
assert.strictEqual(audio.setFootstepMaterial("snow"), "snow", "Changement de matière de pas");
assert.strictEqual(audio.setFootstepMaterial("inconnu"), "snow", "Une matière inconnue est ignorée");
audio.setFootstepMaterial("grass");
assert.doesNotThrow(() => audio.play("step", { volume: 0.8 }), "Jouer un pas ne plante pas");
assert.doesNotThrow(() => audio.playAt("step", 900, { volume: 0.5 }), "Jouer un pas lointain ne plante pas");
console.log("  ok   Pas d'herbe échantillonnés, " + materials.length + " matières × 6 variantes de secours");

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

// ───────────── Avec un faux navigateur : lecture des fichiers ─────────────
// On simule AudioContext et fetch pour vérifier que les sons de la banque
// sont bien décodés puis joués, et que la synthèse prend le relais sinon.
function createBrowserSandbox(fetchImpl) {
  const storage = new Map();
  const started = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    fetch: fetchImpl,
  };
  sandbox.window = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    AudioContext: class {
      constructor() {
        this.state = "running";
        this.currentTime = 0;
        this.destination = { connect() {} };
      }
      createGain() {
        return { gain: { value: 1, setTargetAtTime() {} }, connect() {}, disconnect() {} };
      }
      createBuffer(channels, length, rate) {
        const data = new Float32Array(length);
        return { length, duration: length / rate, sampleRate: rate, getChannelData: () => data, fromFile: false };
      }
      createBufferSource() {
        const context = this;
        const source = {
          buffer: null,
          playbackRate: { value: 1 },
          connect() {},
          disconnect() {},
          onended: null,
          start() {
            // Chaque lecture fait avancer l'horloge : les voix se libèrent.
            context.currentTime += (source.buffer ? source.buffer.duration : 0) + 0.05;
            started.push(source);
          },
        };
        return source;
      }
      createStereoPanner() {
        return { pan: { value: 0 }, connect() {}, disconnect() {} };
      }
      decodeAudioData(data, resolve) {
        const buffer = {
          length: Math.max(1, Math.floor(data.byteLength / 2)),
          duration: data.byteLength / 2 / 44100,
          sampleRate: 44100,
          getChannelData: () => new Float32Array(1),
          fromFile: true,
        };
        if (resolve) resolve(buffer);
        return Promise.resolve(buffer);
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
    },
  };
  sandbox.document = { addEventListener() {}, hidden: false };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "sfx-library.js"), "utf8"), sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, started };
}

/** fetch() qui sert les vrais fichiers de assets/sfx/. */
function fileFetch(url) {
  const file = path.join(__dirname, "..", String(url).replace(/^\/+/, ""));
  return Promise.resolve({
    ok: fs.existsSync(file),
    arrayBuffer: () => {
      const buffer = fs.readFileSync(file);
      return Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    },
  });
}

(async () => {
  const { sandbox, started } = createBrowserSandbox(fileFetch);
  const engine = sandbox.window.PixWorldAudio;
  assert.strictEqual(engine.supported, true, "Le moteur se déclare supporté avec un AudioContext");
  assert.strictEqual(engine.ready, false, "Pas prêt avant le déverrouillage");
  engine.unlock();
  assert.strictEqual(engine.ready, true, "Déverrouillé : le contexte tourne");

  // Le déverrouillage lance le décodage en arrière-plan, par petits groupes.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert(engine.bank.loaded >= 5, "Les sons les plus utiles sont préchargés (" + engine.bank.loaded + ")");
  await engine.loadEvent("jump");
  assert(engine.bank.loaded >= 1, "L'événement « jump » est décodé");
  const source = engine.play("jump");
  assert(source, "Un fichier de la banque est joué");
  assert.strictEqual(source.buffer.fromFile, true, "C'est bien le fichier, pas la synthèse");

  // Plusieurs variantes sont utilisées au fil des lectures.
  const variants = new Set();
  for (let i = 0; i < 40; i++) {
    const voice = engine.play("jump");
    if (voice) variants.add(voice.buffer);
  }
  assert(variants.size >= 3, "Les variantes alternent (" + variants.size + " sur 5)");

  // Un événement dont les fichiers sont inaccessibles retombe sur la synthèse.
  const offline = createBrowserSandbox(() => Promise.reject(new Error("hors ligne")));
  const fallback = offline.sandbox.window.PixWorldAudio;
  fallback.unlock();
  await fallback.loadEvent("slash");
  assert.strictEqual(fallback.bank.loaded, 0, "Rien n'est décodé hors ligne");
  const synth = fallback.play("slash");
  assert(synth, "La synthèse assure le relais");
  assert.strictEqual(synth.buffer.fromFile, false, "C'est bien la synthèse");
  const offlineStep = fallback.play("step", { material: "grass" });
  assert(offlineStep, "Le pas d'herbe garde un secours hors ligne");
  assert.strictEqual(offlineStep.buffer.fromFile, false, "Le pas d'herbe hors ligne est synthétisé");

  // Le pas par défaut utilise les samples d'herbe de la banque dès qu'ils
  // sont décodés, et non un preset de bruit générique.
  await engine.loadEvent("stepGrass");
  const grassStep = engine.play("step", { volume: 0.8, material: "grass" });
  assert(grassStep, "Un pas d'herbe est joué");
  assert.strictEqual(grassStep.buffer.fromFile, true, "Le pas d'herbe utilise son fichier dédié");
  const steps = new Set();
  for (let i = 0; i < 40; i++) {
    const voice = engine.play("step", { volume: 0.8 });
    if (voice) steps.add(voice.buffer);
  }
  assert(steps.size >= 3, "Les variantes de pas d'herbe alternent (" + steps.size + ")");
  assert(started.length > 40, "Les voix démarrées sont comptées");
  console.log("  ok   Fichiers décodés, variantes alternées, repli synthèse et pas d'herbe");
  console.log("Moteur audio valide");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
