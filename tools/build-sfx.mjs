#!/usr/bin/env node
/**
 * PixWorld — construction de la banque d'effets sonores.
 *
 * Les sons du jeu ne sont pas tous synthétisés : la plupart sont repris de
 * packs libres (CC0) publiés sur GitHub, puis *adaptés* pour PixWorld :
 *   - conversion en mono 16 bits / 44,1 kHz (les Wave d'origine sont parfois
 *     stéréo, parfois mono) ;
 *   - suppression des silences en début et en fin de fichier ;
 *   - normalisation du volume et petite coupure progressive (anti-clic) ;
 *   - raccourcissement à 0,8 s maximum (un jeu n'a pas besoin de plus) ;
 *   - renommage en `<événement>-<n>.wav`, un fichier par variante.
 *
 * Les pas, eux, sont générés en code (voir STEP_MATERIALS dans src/audio.js) :
 * ce script ne produit donc aucun fichier pour l'événement « step ».
 *
 * Utilisation :
 *   node tools/build-sfx.mjs                 # télécharge puis convertit
 *   node tools/build-sfx.mjs --source /tmp/pack   # convertit un pack déjà là
 *   node tools/build-sfx.mjs --dry-run       # liste ce qui serait produit
 *
 * Le script réécrit `assets/sfx/` et régénère `src/sfx-library.js`, la liste
 * lue par src/audio.js. Voir assets/CREDITS.md pour la provenance.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "sfx");
const LIBRARY = path.join(ROOT, "src", "sfx-library.js");
const CACHE = path.join(ROOT, "tools", ".cache");

const SOURCE = {
  repo: "Daarko/sparkstream-sounds",
  ref: "refs/heads/master",
  url: "https://codeload.github.com/Daarko/sparkstream-sounds/tar.gz/refs/heads/master",
  // Chaque son est un extrait d'un pack Kenney (CC0 1.0), converti en .wav
  // par le dépôt ci-dessus. Voir assets/CREDITS.md.
  packs: {
    "ui-clicks": { pack: "UI Audio / Interface Sounds", url: "https://kenney.nl/assets/ui-audio" },
    "digital-beeps": { pack: "Digital Audio / Sci-Fi Sounds", url: "https://kenney.nl/assets/digital-audio" },
    impacts: { pack: "Impact Sounds", url: "https://kenney.nl/assets/impact-sounds" },
    "rpg-quest": { pack: "RPG Audio", url: "https://kenney.nl/assets/rpg-audio" },
  },
};

const MAX_SECONDS = 0.8; // durée maximale d'un son après adaptation
const TARGET_PEAK = 0.9;
const SAMPLE_RATE = 44100;

const UI = "ui-clicks/";
const DIG = "digital-beeps/";
const IMP = "impacts/";
const RPG = "rpg-quest/";

/** family("ui-clicks/ui-audio-switch", 1, 4) → 4 chemins numérotés. */
const family = (base, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${base}${from + i}.wav`);

/** padded("…/interface-sounds-click", 0, 3) → …_000.wav …_003.wav. */
const padded = (base, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${base}_${String(from + i).padStart(3, "0")}.wav`);

/**
 * Table de sélection : un événement du jeu → les sons repris sur GitHub.
 * `gain` compense les niveaux très différents d'un pack à l'autre ; il est
 * appliqué au moment de la lecture (src/audio.js), pas à la conversion.
 */
const PICKS = {
  // ── Interface ─────────────────────────────────────────────────────────
  uiHover: { gain: 0.5, files: family(`${UI}ui-audio-rollover`, 1, 5) },
  uiSelect: { gain: 0.6, files: [...family(`${UI}ui-audio-click`, 1, 4), ...padded(`${UI}interface-sounds-click`, 1, 4)] },
  uiConfirm: { gain: 0.75, files: padded(`${UI}interface-sounds-confirmation`, 1, 4) },
  uiBack: { gain: 0.6, files: padded(`${UI}interface-sounds-back`, 1, 4) },
  uiPause: { gain: 0.6, files: padded(`${UI}interface-sounds-minimize`, 1, 4) },
  uiType: { gain: 0.35, files: [`${UI}interface-sounds-tick_001.wav`, `${UI}interface-sounds-tick_002.wav`, `${UI}interface-sounds-tick_004.wav`] },
  uiError: { gain: 0.6, files: padded(`${UI}interface-sounds-error`, 1, 4) },
  uiToggleOn: { gain: 0.55, files: family(`${UI}ui-audio-switch`, 1, 5) },
  uiToggleOff: { gain: 0.55, files: family(`${UI}ui-audio-switch`, 6, 10) },
  toast: { gain: 0.4, files: [...padded(`${UI}interface-sounds-question`, 1, 3), `${UI}interface-sounds-pluck_001.wav`, `${UI}interface-sounds-pluck_002.wav`] },

  // ── Déplacements (les pas sont générés en code) ───────────────────────
  jump: { gain: 0.65, files: family(`${DIG}digital-audio-phaseJump`, 1, 5) },
  land: { gain: 0.7, files: padded(`${IMP}impact-sounds-impactSoft_medium`, 0, 4) },

  // ── Attaques ──────────────────────────────────────────────────────────
  throwShuriken: { gain: 0.55, files: [`${RPG}rpg-audio-knifeSlice.wav`, `${RPG}rpg-audio-knifeSlice2.wav`, ...family(`${RPG}rpg-audio-drawKnife`, 1, 3)] },
  shurikenRing: { gain: 0.45, files: padded(`${IMP}impact-sounds-impactTin_medium`, 0, 4) },
  bowDraw: { gain: 0.5, files: [...family(`${RPG}rpg-audio-creak`, 1, 3), ...family(`${RPG}rpg-audio-cloth`, 1, 3)] },
  bowRelease: { gain: 0.7, files: [`${RPG}rpg-audio-knifeSlice.wav`, `${RPG}rpg-audio-knifeSlice2.wav`, `${RPG}rpg-audio-chop.wav`] },
  arrowSwish: { gain: 0.5, files: [`${DIG}digital-audio-zap1.wav`, `${DIG}digital-audio-zap2.wav`, `${DIG}digital-audio-zapTwoTone.wav`] },
  slash: { gain: 0.7, files: [`${RPG}rpg-audio-knifeSlice.wav`, `${RPG}rpg-audio-knifeSlice2.wav`, `${RPG}rpg-audio-chop.wav`, ...family(`${RPG}rpg-audio-cloth`, 1, 3)] },
  slashRing: { gain: 0.45, files: padded(`${IMP}impact-sounds-impactPlate_light`, 0, 4) },
  slashHeavy: { gain: 0.9, files: padded(`${IMP}impact-sounds-impactMetal_heavy`, 0, 4) },
  chargeOrb: { gain: 0.5, files: family(`${DIG}digital-audio-powerUp`, 1, 5) },
  castOrb: { gain: 0.7, files: [...padded(`${DIG}sci-fi-sounds-laserLarge`, 0, 4), ...padded(`${DIG}sci-fi-sounds-laserRetro`, 0, 4)] },

  // ── Impacts et blessures ──────────────────────────────────────────────
  hitShuriken: { gain: 0.7, files: padded(`${IMP}impact-sounds-impactMetal_light`, 0, 4) },
  hitArrow: { gain: 0.8, files: padded(`${IMP}impact-sounds-impactWood_medium`, 0, 4) },
  hitSlash: { gain: 0.9, files: padded(`${IMP}impact-sounds-impactMetal_medium`, 0, 4) },
  hitOrb: { gain: 0.85, files: padded(`${DIG}sci-fi-sounds-impactMetal`, 0, 4) },
  impactSpark: { gain: 0.4, files: padded(`${IMP}impact-sounds-impactGlass_light`, 0, 4) },
  hurt: { gain: 0.8, files: padded(`${IMP}impact-sounds-impactPunch_medium`, 0, 4) },
  hurtCritical: { gain: 0.95, files: padded(`${IMP}impact-sounds-impactPunch_heavy`, 0, 4) },
  fizzle: { gain: 0.35, files: [`${DIG}digital-audio-lowDown.wav`, `${DIG}digital-audio-lowRandom.wav`, ...padded(`${DIG}sci-fi-sounds-slime`, 0, 1)] },

  // ── K.O., réapparition, vie ───────────────────────────────────────────
  ko: { gain: 0.95, files: [...padded(`${DIG}sci-fi-sounds-lowFrequency_explosion`, 0, 1), ...padded(`${DIG}sci-fi-sounds-explosionCrunch`, 2, 4)] },
  koBoom: { gain: 0.85, files: padded(`${DIG}sci-fi-sounds-explosionCrunch`, 0, 4) },
  koEnemy: { gain: 0.65, files: family(`${DIG}digital-audio-powerUp`, 7, 12) },
  respawn: { gain: 0.6, files: [`${DIG}digital-audio-highUp.wav`, `${DIG}digital-audio-threeTone1.wav`, `${DIG}digital-audio-threeTone2.wav`, `${DIG}digital-audio-phaseJump4.wav`, `${DIG}digital-audio-phaseJump5.wav`] },
  regen: { gain: 0.35, files: [`${DIG}digital-audio-tone1.wav`, `${DIG}digital-audio-twoTone1.wav`, `${DIG}digital-audio-twoTone2.wav`, ...family(`${DIG}digital-audio-pepSound`, 1, 3)] },
  shieldOff: { gain: 0.45, files: [`${DIG}digital-audio-highDown.wav`, ...family(`${DIG}digital-audio-phaserDown`, 1, 3)] },

  // ── Réseau ───────────────────────────────────────────────────────────
  playerJoin: { gain: 0.5, files: [...padded(`${UI}interface-sounds-open`, 1, 4), `${DIG}digital-audio-highUp.wav`] },
  playerLeave: { gain: 0.5, files: [...padded(`${UI}interface-sounds-close`, 1, 4), `${DIG}digital-audio-lowDown.wav`] },
  connectionLost: { gain: 0.6, files: padded(`${UI}interface-sounds-glitch`, 1, 4) },
  connected: { gain: 0.5, files: [`${DIG}digital-audio-threeTone1.wav`, `${DIG}digital-audio-threeTone2.wav`, ...family(`${DIG}digital-audio-powerUp`, 1, 3)] },
};

// ───────────────────────── Lecture / écriture WAV ─────────────────────────

/** Lit un Wave PCM 16 bits (mono ou stéréo) et renvoie des flottants mono. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file} n'est pas un Wave`);
  }
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
      if (buf.readUInt16LE(body) !== 1 || bits !== 16) {
        throw new Error(`${file} : format non géré (${buf.readUInt16LE(body)} bits ${bits})`);
      }
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!data || !channels || !rate) throw new Error(`${file} : en-tête incomplet`);
  const frames = Math.floor(data.length / 2 / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((i * channels + c) * 2) / 32768;
    mono[i] = sum / channels;
  }
  return { samples: mono, rate, channels };
}

function writeWav(file, samples, rate = SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// ───────────────────────────── Adaptation ─────────────────────────────

/** Coupe les silences, normalise, ajoute un fondu et limite la durée. */
function adapt(samples, rate) {
  const max = MAX_SECONDS * rate;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak < 0.01) throw new Error("presque silencieux");
  const threshold = peak * 0.01;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
  start = Math.max(0, start - Math.round(rate * 0.002));
  end = Math.min(samples.length, end + Math.round(rate * 0.004));
  let out = samples.subarray(start, Math.min(end, start + max));

  const gain = TARGET_PEAK / peak;
  const fade = Math.max(1, Math.round(rate * 0.004));
  const result = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let envelope = 1;
    if (i < fade) envelope = i / fade;
    else if (i > out.length - fade) envelope = Math.max(0, (out.length - i) / fade);
    result[i] = out[i] * gain * envelope;
  }
  return { samples: result, rate };
}

// ───────────────────────────── Téléchargement ─────────────────────────────

function downloadSource() {
  fs.mkdirSync(CACHE, { recursive: true });
  const archive = path.join(CACHE, "sparkstream-sounds.tar.gz");
  const dir = path.join(CACHE, "sparkstream-sounds");
  if (!fs.existsSync(archive)) {
    console.log(`  ↓  ${SOURCE.url}`);
    execFileSync("curl", ["-sSL", "--fail", "-o", archive, SOURCE.url], { stdio: "inherit" });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", dir, "--strip-components=1"], { stdio: "inherit" });
  return dir;
}

// ──────────────────────────────── Programme ────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceFlag = args.indexOf("--source");
const sourceDir = sourceFlag >= 0 ? args[sourceFlag + 1] : downloadSource();
const soundRoot = fs.existsSync(path.join(sourceDir, "sounds"))
  ? path.join(sourceDir, "sounds")
  : sourceDir;

if (!dryRun) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const library = { source: SOURCE, events: {} };
let written = 0;
let bytes = 0;
let seconds = 0;
const missing = [];

for (const [event, pick] of Object.entries(PICKS)) {
  const files = [];
  pick.files.forEach((relative, index) => {
    const input = path.join(soundRoot, relative);
    if (!fs.existsSync(input)) {
      missing.push(relative);
      return;
    }
    const name = `${event}-${index + 1}.wav`;
    const { samples: raw, rate } = readWav(input);
    const { samples } = adapt(raw, rate);
    if (!dryRun) writeWav(path.join(OUT_DIR, name), samples, rate);
    written++;
    bytes += samples.length * 2 + 44;
    seconds += samples.length / rate;
    files.push(name);
  });
  library.events[event] = { gain: pick.gain, files };
}

const header = `/**
 * PixWorld — banque d'effets sonores (fichiers adaptés, licence CC0).
 *
 * ATTENTION : ce fichier est généré par tools/build-sfx.mjs, ne l'éditez pas
 * à la main. Il décrit, pour chaque événement du jeu, les variantes sonores
 * disponibles dans assets/sfx/ et le gain à leur appliquer.
 *
 * Provenance : dépôt ${SOURCE.repo} (extraits des packs Kenney, CC0 1.0).
 * Les pas (« step ») sont absents de cette liste : ils sont synthétisés en
 * code par src/audio.js. Quand un événement n'a pas de fichier (ou que le
 * navigateur n'a pas pu les charger), src/audio.js retombe sur la synthèse.
 */
`;

if (!dryRun) {
  fs.writeFileSync(
    LIBRARY,
    `${header}window.PixWorldSfxLibrary = ${JSON.stringify(library, null, 2)};\n`,
  );
}

const events = Object.keys(library.events);
console.log(
  `  ✓  ${written} sons adaptés → assets/sfx (${(bytes / 1024 / 1024).toFixed(1)} Mo, ` +
    `${seconds.toFixed(1)} s de son) pour ${events.length} événements`,
);
console.log(`  ✓  ${path.relative(ROOT, LIBRARY)} régénéré`);
if (missing.length) {
  console.error(`  !  ${missing.length} fichier(s) introuvable(s) :`);
  missing.forEach((m) => console.error(`     ${m}`));
  process.exitCode = 1;
}
