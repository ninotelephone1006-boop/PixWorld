/**
 * PixWorld — effets sonores, fichiers adaptés + synthèse de secours.
 *
 * Deux sources, une seule API :
 *
 *   1. une banque de près de 200 fichiers Wave (assets/sfx/), repris de packs
 *      libres CC0 publiés sur GitHub puis adaptés par tools/build-sfx.mjs ;
 *      chaque événement possède plusieurs variantes, tirées au hasard pour
 *      qu'un enchaînement de coups ne sonne jamais deux fois pareil ; les pas
 *      du niveau utilisent les prises d'herbe dédiées du pack CC0 ;
 *   2. une synthèse maison, dérivée de ZzFX (Frank Force, licence MIT, voir
 *      assets/CREDITS.md), qui prend le relais quand un fichier n'est pas
 *      encore chargé ou n'a pas pu l'être (page ouverte en file://, hors
 *      ligne…). Elle génère aussi des pas de secours, adaptés à chaque matière,
 *      et le froissement de l'herbe (« grassRustle », sans fichier dédié).
 *
 *   PixWorldAudio.play("jump")                      → son local
 *   PixWorldAudio.playAt("slash", worldX)           → son d'un joueur distant
 *   PixWorldAudio.sequence([["uiConfirm", 0], ["uiSelect", 90]])
 *   PixWorldAudio.setVolume(0.8) / toggleMuted()     → réglages mémorisés
 *
 * Le contexte audio n'est créé qu'au premier geste de l'utilisateur, comme
 * l'exigent les navigateurs ; les fichiers sont alors décodés en tâche de
 * fond, les plus utiles d'abord.
 */
window.PixWorldAudio = (() => {
  "use strict";

  const SAMPLE_RATE = 44100;
  const STORAGE_VOLUME = "pixworld.volume";
  const STORAGE_MUTED = "pixworld.muted";
  const MAX_VOICES = 24; // sons simultanés avant d'ignorer les moins importants

  // ───────────────────── Presets (paramètres ZzFX) ─────────────────────
  // [volume, randomness, frequency, attack, sustain, release, shape,
  //  shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
  //  noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter]
  // shape : 0 sinus, 1 triangle, 2 dent de scie, 3 tangente, 4 bruit, 5 carré.
  // filter : négatif = passe-bas (Hz), positif = passe-haut (Hz).
  const PRESETS = {
    // Interface
    uiHover: [0.3, 0.02, 1400, 0.001, 0.012, 0.035, 1, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6],
    uiSelect: [0.55, 0.02, 740, 0.004, 0.04, 0.09, 1, 1.2, 0, 0, 185, 0.045, 0, 0, 0, 0, 0, 0.7],
    uiConfirm: [0.7, 0.02, 523, 0.01, 0.1, 0.26, 1, 1.4, 0, 0, 262, 0.09, 0, 0, 0, 0, 0.04, 0.7],
    uiBack: [0.5, 0.02, 620, 0.004, 0.04, 0.1, 1, 1.2, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0.7],
    uiPause: [0.55, 0.02, 660, 0.01, 0.06, 0.14, 0, 1, 0, 0, -165, 0.07, 0, 0, 0, 0, 0.02, 0.7],
    uiType: [0.18, 0.12, 2200, 0.001, 0.006, 0.025, 4, 1, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 1500],
    uiError: [0.55, 0.05, 160, 0.01, 0.12, 0.16, 2, 1.6, 0, 0, 0, 0, 0.06, 0, 0, 0, 0, 0.7],
    uiToggleOn: [0.5, 0.02, 880, 0.004, 0.03, 0.1, 1, 1.3, 0, 0, 220, 0.04, 0, 0, 0, 0, 0, 0.7],
    uiToggleOff: [0.5, 0.02, 880, 0.004, 0.03, 0.1, 1, 1.3, 0, 0, -220, 0.04, 0, 0, 0, 0, 0, 0.7],
    toast: [0.28, 0.02, 1050, 0.001, 0.02, 0.09, 1, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6],

    // Déplacements
    jump: [0.6, 0.05, 250, 0.01, 0.06, 0.17, 1, 1.4, 7.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.03],
    land: [0.5, 0.1, 150, 0.002, 0.03, 0.13, 4, 1.4, -5, 0, 0, 0, 0, 0.7, 0, 0, 0, 0.6, 0.02, 0, -900],
    step: [0.22, 0.2, 220, 0.001, 0.01, 0.045, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, -1300],

    // Attaques (préparation + lancement)
    throwShuriken: [0.55, 0.1, 1100, 0.005, 0.05, 0.15, 4, 1.2, -7, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.6, 0, 0, 1400],
    shurikenRing: [0.3, 0.03, 2400, 0.001, 0.02, 0.18, 1, 1, 0, 0, 0, 0, 0, 0, 22, 0, 0.02, 0.5, 0.04],
    bowDraw: [0.35, 0.1, 170, 0.03, 0.15, 0.08, 2, 2, 1.8, 0, 0, 0, 0.022, 0.1, 0, 0, 0, 0.6],
    bowRelease: [0.75, 0.05, 330, 0.001, 0.03, 0.2, 1, 1.5, -2, 0, 0, 0, 0, 0.1, 16, 0, 0.02, 0.6],
    arrowSwish: [0.4, 0.1, 1500, 0.01, 0.07, 0.18, 4, 1, -3, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.5, 0, 0, 2400],
    slash: [0.7, 0.1, 1200, 0.004, 0.04, 0.17, 4, 1.4, -9, 0, 0, 0, 0, 0.9, 0, 0, 0, 0.5, 0, 0, 900],
    slashRing: [0.32, 0.02, 2600, 0.001, 0.02, 0.22, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.4, 0.05],
    slashHeavy: [0.95, 0.1, 800, 0.004, 0.08, 0.3, 4, 1.5, -6, 0, 0, 0, 0, 0.9, 0, 0, 0.03, 0.6, 0, 0, 500],
    chargeOrb: [0.35, 0.05, 300, 0.05, 0.12, 0.1, 1, 1, 5, 0, 0, 0, 0.03, 0, 0, 0, 0, 0.6],
    // Secours bruité et descendant : un souffle de flamme, pas un bip laser.
    castOrb: [0.7, 0.02, 320, 0.006, 0.06, 0.24, 4, 1.4, -8, 0, -120, 0.06, 0, 0.9, 0, 0, 0.02, 0.6, 0, 0, -1500],

    // Impacts
    hitShuriken: [0.75, 0.05, 1900, 0.001, 0.02, 0.11, 1, 1.6, -10, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.6],
    hitArrow: [0.85, 0.05, 260, 0.001, 0.03, 0.15, 4, 1.8, -5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.6, 0, 0, -1600],
    hitSlash: [0.95, 0.05, 480, 0.001, 0.04, 0.26, 4, 1.5, -8, 0, 0, 0, 0, 0.7, 0, 0, 0.02, 0.6, 0, 0, -3000],
    // Éclat grave et granuleux pour l'impact du projectile enflammé.
    hitOrb: [0.8, 0.02, 190, 0.001, 0.04, 0.25, 4, 1.3, -12, 0, -90, 0.04, 0, 0.85, 0, 0, 0.01, 0.55, 0.03, 0, -1200],
    impactSpark: [0.4, 0.1, 3200, 0.001, 0.01, 0.07, 1, 1.2, -20, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.5],
    hurt: [0.85, 0.05, 520, 0.01, 0.02, 0.22, 2, 1.1, -12, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.7, 0.05],
    hurtCritical: [0.95, 0.05, 330, 0.01, 0.05, 0.3, 2, 1.3, -10, 0, -60, 0.06, 0, 0.15, 0, 0, 0, 0.7, 0.05],
    fizzle: [0.28, 0.1, 700, 0.001, 0.01, 0.06, 1, 1.5, -8, 0, 0, 0, 0, 0.2],

    // Minage : bloc qui se brise (bruit grave et court), objet ramassé (petit trille)
    blockBreak: [0.9, 0.08, 240, 0.001, 0.02, 0.14, 4, 1.3, -6, 0, 0, 0, 0, 0.8, 0, 0, 0, 0.6, 0, 0, -1600],
    itemPickup: [0.45, 0.02, 1320, 0.002, 0.03, 0.09, 1, 1.5, 0, 0, 660, 0.05, 0, 0, 0, 0, 0, 0.6],

    // K.O., réapparition, vie
    ko: [1, 0.05, 240, 0.01, 0.1, 0.85, 4, 1.9, -1, 0, 0, 0, 0, 0.8, 0, 0.3, 0.1, 0.5, 0.1, 0, -2500],
    koBoom: [0.9, 0.02, 90, 0.005, 0.1, 0.5, 0, 1, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.1],
    koEnemy: [0.7, 0.02, 523, 0.01, 0.08, 0.3, 1, 1.4, 0, 0, 262, 0.09, 0, 0, 0, 0, 0.04, 0.7],
    respawn: [0.6, 0.02, 440, 0.05, 0.2, 0.4, 0, 1, 4, 0, 440, 0.15, 0, 0, 10, 0, 0.1, 0.6],
    heartbeat: [0.6, 0.02, 62, 0.005, 0.05, 0.13, 0, 1, -0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02],
    regen: [0.32, 0.02, 880, 0.02, 0.1, 0.3, 0, 1, 0, 0, 440, 0.12, 0, 0, 0, 0, 0.08, 0.5],
    shieldOff: [0.35, 0.02, 1200, 0.001, 0.02, 0.07, 1, 1, 0, 0, 300, 0.025, 0, 0, 0, 0, 0, 0.6],

    // Réseau
    playerJoin: [0.55, 0.02, 660, 0.01, 0.05, 0.16, 1, 1.2, 0, 0, 220, 0.065, 0, 0, 0, 0, 0.03, 0.7],
    playerLeave: [0.55, 0.02, 660, 0.01, 0.05, 0.18, 1, 1.2, 0, 0, -220, 0.08, 0, 0, 0, 0, 0.03, 0.7],
    connectionLost: [0.65, 0.02, 220, 0.02, 0.2, 0.25, 2, 1.5, -3, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.6],
    connected: [0.55, 0.02, 523, 0.01, 0.08, 0.3, 0, 1, 0, 0, 262, 0.1, 0, 0, 0, 0, 0.05, 0.6],
  };

  // ─────────────────────── Pas par matière ──────────────────────────────
  // L'herbe dispose de véritables prises CC0 dans la banque ; les autres
  // matières (et le mode hors ligne) ont une synthèse dédiée de secours.
  // Les variantes synthétisées sont figées par hachage pour rester stables.
  const STEP_MATERIALS = {
    grass: { frequency: 230, noise: 1, release: 0.05, filter: -1400, volume: 0.2, spread: 0.14 },
    dirt: { frequency: 185, noise: 1, release: 0.045, filter: -1100, volume: 0.22, spread: 0.12 },
    stone: { frequency: 330, noise: 0.65, release: 0.035, filter: 1200, volume: 0.2, spread: 0.16 },
    wood: { frequency: 150, noise: 0.5, release: 0.075, filter: -650, volume: 0.24, spread: 0.1 },
    snow: { frequency: 420, noise: 1, release: 0.055, filter: 1800, volume: 0.18, spread: 0.18 },
  };
  const STEP_VARIANTS = 6;
  let footstepMaterial = "grass";

  const stepEventName = (material) => `step${material[0].toUpperCase()}${material.slice(1)}`;
  const stepName = (material, variant) => `${stepEventName(material)}${variant}`;
  const STEP_PATTERN = /^step([A-Z][a-z]+)(\d+)$/;

  /** Hachage déterministe (FNV-1a) → valeur dans [-1, 1]. */
  function jitter(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash = (hash ^ text.charCodeAt(i)) * 16777619;
      hash >>>= 0;
    }
    return (hash / 2147483647.5) - 1;
  }

  /** Générateur pseudo-aléatoire stable pour les sons de secours. */
  function seededNoise(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state / 2147483647.5) - 1;
    };
  }

  /** Bruit bref, filtré et granuleux : secours plus proche d'un pas d'herbe. */
  function buildGrassStepSamples(variant) {
    const length = Math.round(SAMPLE_RATE * 0.14);
    const samples = new Float32Array(length);
    const random = seededNoise((0x9e3779b9 ^ Math.imul(variant, 0x45d9f3b)) >>> 0);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / (length - 1);
      const noise = random();
      low += (noise - low) * 0.1;
      const envelope = (1 - Math.exp(-t * 180)) * Math.pow(1 - t, 2.8);
      const thud = Math.sin(Math.PI * 2 * (82 + variant * 7) * t) * Math.exp(-t * 25);
      const crackle = random() > 0.996 ? random() * 0.4 : 0;
      samples[i] = (noise * 0.36 + (noise - low) * 0.28 + low * 0.12 + thud * 0.22 + crackle * 0.12) * envelope * 0.8;
    }
    return samples;
  }

  /**
   * Froissement d'herbe, synthétisé (le pack CC0 n'en contient pas) : bruit
   * filtré dans la bande 1,5 à 6 kHz, enveloppe de frottement et une quinzaine
   * de rafales brèves (des brins qui se frôlent). Court et déterministe : chaque
   * variante garde son propre grain, et le son est normalisé à la construction.
   */
  function buildGrassRustleSamples(variant) {
    const length = Math.round(SAMPLE_RATE * 0.3);
    const samples = new Float32Array(length);
    const random = seededNoise((0x3c6ef372 ^ Math.imul(variant, 0x9e3779b1)) >>> 0);
    const unit = () => (random() + 1) / 2; // valeur dans [0, 1]
    const grains = [];
    for (let g = 0; g < 16; g++) {
      grains.push({
        start: Math.floor(unit() * length * 0.85),
        span: Math.round(SAMPLE_RATE * (0.003 + unit() * 0.006)),
        gain: 0.4 + unit() * 0.6,
      });
    }
    // Passe-haut (1,5 kHz) puis deux passes passe-bas (5 kHz) : des aigus
    // adoucis, pour un froissement et non un souffle.
    const highCoef = Math.exp((-2 * Math.PI * 1500) / SAMPLE_RATE);
    const lowCoef = 1 - Math.exp((-2 * Math.PI * 5000) / SAMPLE_RATE);
    let lastInput = 0;
    let highOut = 0;
    let lowOut = 0;
    let lowOut2 = 0;
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const white = random();
      highOut = highCoef * (highOut + white - lastInput);
      lastInput = white;
      lowOut += (highOut - lowOut) * lowCoef;
      lowOut2 += (lowOut - lowOut2) * lowCoef;
      const envelope = (1 - Math.exp(-t / 0.012)) * Math.exp(-t / 0.09);
      let flutter = 0;
      for (let g = 0; g < grains.length; g++) {
        const grain = grains[g];
        const k = i - grain.start;
        if (k >= 0 && k < grain.span) flutter += grain.gain * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / grain.span));
      }
      const sample = lowOut2 * (0.3 + 0.7 * Math.min(1, flutter)) * envelope;
      samples[i] = sample;
      if (Math.abs(sample) > peak) peak = Math.abs(sample);
    }
    const gain = peak > 0 ? 0.75 / peak : 0;
    for (let i = 0; i < length; i++) samples[i] *= gain;
    return samples;
  }

  /** Souffle et crépitement déterministes pour lancement / impact de flamme. */
  function buildFireballSamples(kind) {
    const impact = kind === "impact";
    const length = Math.round(SAMPLE_RATE * (impact ? 0.32 : 0.48));
    const samples = new Float32Array(length);
    const random = seededNoise(impact ? 0x4f1bbcdc : 0x7f4a7c15);
    let low = 0;
    let mid = 0;
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / (length - 1);
      const noise = random();
      low += (noise - low) * 0.03;
      mid += (noise - mid) * 0.16;
      const frequency = impact ? 150 - 75 * t : 360 - 250 * t;
      phase += (Math.PI * 2 * frequency) / SAMPLE_RATE;
      const rumble = Math.sin(phase);
      const envelope = (1 - Math.exp(-t * (impact ? 280 : 110))) * Math.exp(-t * (impact ? 8 : 4.6));
      const flutter = 0.82 + 0.18 * Math.sin(Math.PI * 2 * (impact ? 23 : 13) * t);
      const crackle = random() > (impact ? 0.985 : 0.993) ? random() * 0.9 : 0;
      const texture = noise - mid;
      samples[i] = (texture * 0.32 + (mid - low) * 0.45 + low * 0.38 + rumble * (impact ? 0.24 : 0.34) + crackle * 0.22) * envelope * 0.7 * flutter;
    }
    return samples;
  }

  /** Paramètres ZzFX d'un pas : bruit filtré, très court. */
  function stepPreset(material, variant) {
    const base = STEP_MATERIALS[material];
    const seed = `${material}${variant}`;
    const wobble = (salt, amount) => 1 + jitter(seed + salt) * amount;
    const params = new Array(21).fill(0);
    params[0] = base.volume * wobble("vol", 0.25); // volume
    params[2] = base.frequency * wobble("freq", base.spread); // fréquence
    params[3] = 0.001; // attaque
    params[4] = 0.004; // tenue
    params[5] = base.release * wobble("rel", 0.3); // extinction
    params[6] = 4; // forme : bruit
    params[7] = 1; // courbe
    params[13] = base.noise; // part de bruit
    params[17] = 0.5; // niveau de la tenue
    params[20] = base.filter * wobble("filter", 0.08); // filtre
    return params;
  }

  // Enregistre une entrée de secours pour chaque famille et ses variantes.
  Object.keys(STEP_MATERIALS).forEach((material) => {
    PRESETS[stepEventName(material)] = stepPreset(material, 1);
    for (let variant = 1; variant <= STEP_VARIANTS; variant++) {
      PRESETS[stepName(material, variant)] = stepPreset(material, variant);
    }
  });

  // Froissement de l'herbe : quatre variantes construites par buildGrassRustleSamples.
  // Seuls le volume (index 0) et la variation de hauteur (index 1) sont lus ici.
  const GRASS_RUSTLE_VARIANTS = 4;
  const GRASS_RUSTLE_PATTERN = /^grassRustle(\d+)$/;
  const grassRustleName = (variant) => `grassRustle${variant}`;
  for (let variant = 1; variant <= GRASS_RUSTLE_VARIANTS; variant++) {
    const params = new Array(21).fill(0);
    params[0] = 0.5; // volume de référence
    params[1] = 0.08; // variation de hauteur à la lecture, ±8 %
    PRESETS[grassRustleName(variant)] = params;
  }
  let lastGrassRustle = 0;

  // ───────────────────────── Synthèse (ZzFX) ─────────────────────────
  /**
   * Construit les échantillons d'un son. Portage fidèle de ZzFX v1.4
   * (MIT © 2019 Frank Force) : vingt paramètres, un seul tableau en sortie.
   */
  function buildSamples(
    volume = 1,
    randomness = 0.05,
    frequency = 220,
    attack = 0,
    sustain = 0,
    release = 0.1,
    shape = 0,
    shapeCurve = 1,
    slide = 0,
    deltaSlide = 0,
    pitchJump = 0,
    pitchJumpTime = 0,
    repeatTime = 0,
    noise = 0,
    modulation = 0,
    bitCrush = 0,
    delay = 0,
    sustainVolume = 1,
    decay = 0,
    tremolo = 0,
    filter = 0,
  ) {
    const sampleRate = SAMPLE_RATE;
    const PI2 = Math.PI * 2;
    const sign = (v) => (v < 0 ? -1 : 1);
    let startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
    let startFrequency = (frequency *= ((1 + randomness * 2 * Math.random() - randomness) * PI2) / sampleRate);
    let modOffset = 0;
    let repeat = 0;
    let crush = 0;
    let jump = 1;
    let t = 0;
    let i = 0;
    let s = 0;
    let f;

    // Filtre biquad passe-bas / passe-haut.
    const quality = 2;
    const w = (PI2 * Math.abs(filter) * 2) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / 2 / quality;
    const a0 = 1 + alpha;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    const b0 = (1 + sign(filter) * cos) / 2 / a0;
    const b1 = -(sign(filter) + cos) / a0;
    const b2 = b0;
    let x2 = 0;
    let x1 = 0;
    let y2 = 0;
    let y1 = 0;

    const minAttack = 9;
    attack = attack * sampleRate || minAttack;
    decay *= sampleRate;
    sustain *= sampleRate;
    release *= sampleRate;
    delay *= sampleRate;
    deltaSlide *= (500 * PI2) / sampleRate ** 3;
    modulation *= PI2 / sampleRate;
    pitchJump *= PI2 / sampleRate;
    pitchJumpTime *= sampleRate;
    repeatTime = (repeatTime * sampleRate) | 0;

    const length = (attack + decay + sustain + release + delay) | 0;
    const b = new Float32Array(length > 0 ? length : 0);

    for (; i < length; b[i++] = s * volume) {
      if (!(++crush % ((bitCrush * 100) | 0))) {
        s = shape
          ? shape > 1
            ? shape > 2
              ? shape > 3
                ? shape > 4
                  ? (t / PI2) % 1 < shapeCurve / 2
                    ? 1
                    : -1
                  : Math.sin(t ** 3)
                : Math.max(Math.min(Math.tan(t), 1), -1)
              : 1 - (((((2 * t) / PI2) % 2) + 2) % 2)
            : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
          : Math.sin(t);

        s =
          (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
          (shape > 4 ? s : sign(s) * Math.abs(s) ** shapeCurve) *
          (i < attack
            ? i / attack
            : i < attack + decay
              ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
              : i < attack + decay + sustain
                ? sustainVolume
                : i < length - delay
                  ? ((length - i - delay) / release) * sustainVolume
                  : 0);

        s = delay
          ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2 / volume)
          : s;

        if (filter) {
          s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
        }
      }

      f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
      t += f + f * noise * (((i * i * PI2) % 2) - 1);

      if (jump && ++jump > pitchJumpTime) {
        frequency += pitchJump;
        startFrequency += pitchJump;
        jump = 0;
      }

      if (repeatTime && !(++repeat % repeatTime)) {
        frequency = startFrequency;
        slide = startSlide;
        jump = jump || 1;
      }
    }

    return b;
  }

  // ─────────────────── Banque de fichiers (assets/sfx) ───────────────────
  // Chaque événement → plusieurs variantes Wave + un gain d'équilibrage.
  // Le chargement est paresseux : on ne télécharge que ce qu'on entend, en
  // commençant par les sons les plus fréquents (voir preloadBank).
  const BANK =
    typeof window !== "undefined" && window.PixWorldSfxLibrary ? window.PixWorldSfxLibrary.events || {} : {};
  const BANK_PATH = "assets/sfx/";
  const BANK_EVENTS = Object.keys(BANK);
  const bankBuffers = Object.create(null); // événement → [AudioBuffer]
  const bankPending = Object.create(null); // événement → promesse en cours
  const bankCursor = Object.create(null); // dernière variante jouée
  const preloaded = new Set();

  // Sons entendus dès les premières secondes : interface, sauts et coups.
  const PRELOAD_FIRST = [
    "uiHover", "uiSelect", "uiConfirm", "uiBack", "uiType", "uiError", "uiToggleOn", "uiToggleOff", "toast",
    "jump", "land", "stepGrass", "hurt", "hurtCritical", "impactSpark",
    "throwShuriken", "bowDraw", "bowRelease", "slash", "slashHeavy", "chargeOrb", "castOrb",
    "hitShuriken", "hitArrow", "hitSlash", "hitOrb", "fizzle",
    "ko", "koBoom", "koEnemy", "respawn", "regen", "playerJoin", "playerLeave", "connected",
  ];

  // ───────────────────────── Lecture ─────────────────────────
  const supported = typeof window !== "undefined" && typeof (window.AudioContext || window.webkitAudioContext) === "function";
  let context = null;
  let master = null;
  let unlocked = false;
  const voices = []; // instants de fin des sons en cours (en temps du contexte)
  const cache = Object.create(null);
  const listener = { x: 0, halfWidth: 640 };

  function stored(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function remember(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      /* stockage indisponible */
    }
  }

  let volume = Math.min(1, Math.max(0, Number(stored(STORAGE_VOLUME, "0.8")) || 0));
  let muted = stored(STORAGE_MUTED, "0") === "1";

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function samplesFor(name) {
    if (cache[name]) return cache[name];
    const preset = PRESETS[name];
    if (!preset) return null;

    let samples;
    const stepMatch = STEP_PATTERN.exec(name);
    const rustleMatch = GRASS_RUSTLE_PATTERN.exec(name);
    if (name === "castOrb") {
      samples = buildFireballSamples("launch");
    } else if (name === "hitOrb") {
      samples = buildFireballSamples("impact");
    } else if (stepMatch && stepMatch[1] === "Grass") {
      samples = buildGrassStepSamples(Number(stepMatch[2]));
    } else if (rustleMatch) {
      samples = buildGrassRustleSamples(Number(rustleMatch[1]));
    } else {
      // On gèle la part aléatoire à la construction : la variation se fait
      // ensuite via la vitesse de lecture, comme ZZFXSound.
      const params = preset.slice();
      params[1] = 0;
      samples = buildSamples(...params);
    }

    cache[name] = samples;
    return samples;
  }

  function applyMasterGain() {
    if (!master || !context) return;
    const target = muted ? 0 : volume * volume; // courbe douce pour le curseur
    master.gain.setTargetAtTime(target, context.currentTime, 0.02);
  }

  function ensureContext() {
    if (!supported) return false;
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      try {
        context = new Ctor({ latencyHint: "interactive" });
      } catch (error) {
        return false;
      }
      master = context.createGain();
      master.gain.value = muted ? 0 : volume * volume;
      master.connect(context.destination);
    }
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    return true;
  }

  // ─────────────────── Chargement des fichiers de la banque ───────────────────
  function decodeAudio(data) {
    return new Promise((resolve) => {
      const done = (buffer) => resolve(buffer || null);
      try {
        const result = context.decodeAudioData(data, done, () => done(null));
        if (result && typeof result.then === "function") result.then(done, () => done(null));
      } catch (error) {
        done(null);
      }
    });
  }

  /** Télécharge et décode une variante. Renvoie null en cas d'échec. */
  function fetchVariant(file) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch(BANK_PATH + file)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(file))))
      .then((data) => (context ? decodeAudio(data) : null))
      .catch(() => null);
  }

  /** Décode toutes les variantes d'un événement (une seule fois). */
  function loadEvent(name) {
    if (!BANK[name] || bankBuffers[name] || !context) return bankPending[name] || Promise.resolve(null);
    if (bankPending[name]) return bankPending[name];
    const promise = Promise.all(BANK[name].files.map(fetchVariant))
      .then((list) => {
        const buffers = list.filter(Boolean);
        if (buffers.length) bankBuffers[name] = buffers;
        bankPending[name] = null;
        return buffers;
      })
      .catch(() => {
        bankPending[name] = null;
        return [];
      });
    bankPending[name] = promise;
    return promise;
  }

  /**
   * Précharge une liste d'événements, par petits groupes pour ne pas saturer
   * le réseau. Le reste de la banque se charge ensuite à la demande.
   */
  function preloadBank(names) {
    const queue = (names || BANK_EVENTS).filter((name) => BANK[name] && !preloaded.has(name));
    queue.forEach((name) => preloaded.add(name));
    let index = 0;
    const worker = () => {
      if (index >= queue.length) return Promise.resolve();
      const batch = queue.slice(index, index + 6);
      index += batch.length;
      return Promise.all(batch.map(loadEvent)).then(worker);
    };
    return worker();
  }

  /** À appeler sur un geste utilisateur : débloque le contexte audio. */
  function unlock() {
    if (!ensureContext()) return;
    unlocked = true;
    // Pré-calcule les sons les plus fréquents pendant que le menu est ouvert.
    ["jump", "land", "stepGrass1", "grassRustle1", "hurt", "uiSelect", "uiHover"].forEach(samplesFor);
    // Puis décode les fichiers : les sons courants d'abord, le reste ensuite.
    if (BANK_EVENTS.length) {
      preloadBank(PRELOAD_FIRST).then(() => {
        if (typeof window !== "undefined" && window.setTimeout) {
          window.setTimeout(() => preloadBank(BANK_EVENTS), 1500);
        }
      });
    }
  }

  /** Branche une source déjà prête (buffer décodé ou échantillons maison). */
  function startVoice(source, seconds, options) {
    if (!unlocked || !context || muted) return null;
    if (context.state !== "running") {
      context.resume().catch(() => {});
      if (context.state !== "running") return null;
    }
    // Voix actives : on ne compte que celles qui ne sont pas encore finies,
    // sans dépendre de l'événement « ended » du navigateur.
    const now = context.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i] <= now) voices.splice(i, 1);
    }
    if (voices.length >= MAX_VOICES && !(options && options.important)) return null;

    source.playbackRate.value = options.rate;

    const gain = context.createGain();
    gain.gain.value = options.gain;
    let node = source;
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = options.pan;
      node.connect(panner);
      node = panner;
    }
    node.connect(gain);
    gain.connect(master);

    voices.push(now + seconds / Math.max(0.2, options.rate) + 0.05);
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch (error) {
        /* déjà déconnecté */
      }
    };
    source.start();
    return source;
  }

  function playSamples(samples, options) {
    if (!unlocked || !context || !samples || !samples.length) return null;
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    return startVoice(source, samples.length / SAMPLE_RATE, options);
  }

  /** Joue un buffer déjà décodé (variante de la banque). */
  function playBuffer(buffer, options) {
    if (!unlocked || !context || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    return startVoice(source, buffer.duration, options);
  }

  /** Variante aléatoire, jamais deux fois la même de suite. */
  function pickVariant(name, buffers) {
    if (buffers.length === 1) return buffers[0];
    let index = Math.floor(Math.random() * buffers.length);
    if (index === bankCursor[name]) index = (index + 1) % buffers.length;
    bankCursor[name] = index;
    return buffers[index];
  }

  /** Variante de froissement au hasard, jamais deux fois la même de suite. */
  function pickGrassRustleVariant() {
    let variant = 1 + Math.floor(Math.random() * GRASS_RUSTLE_VARIANTS);
    if (variant === lastGrassRustle) variant = (variant % GRASS_RUSTLE_VARIANTS) + 1;
    lastGrassRustle = variant;
    return variant;
  }

  /**
   * Résout le nom d'un son : « step » devient une variante par matière ;
   * « grassRustle » devient une variante de froissement ; l'herbe est lue
   * depuis sa banque CC0, les autres matières gardent leur synthèse de secours.
   */
  function resolveName(name, opts) {
    if (name === "grassRustle") return grassRustleName(pickGrassRustleVariant());
    if (name !== "step") return name;
    const wanted = opts && opts.material;
    const material = (wanted && STEP_MATERIALS[wanted] ? wanted : STEP_MATERIALS[footstepMaterial] ? footstepMaterial : "grass");
    return stepName(material, 1 + Math.floor(Math.random() * STEP_VARIANTS));
  }

  /** Associe une variante synthétisée à sa banque, quand elle existe. */
  function bankEventFor(resolved) {
    const stepMatch = STEP_PATTERN.exec(resolved);
    if (!stepMatch) return resolved;
    const material = stepMatch[1][0].toLowerCase() + stepMatch[1].slice(1);
    return stepEventName(material);
  }

  /**
   * Joue un son. options : { volume, pitch, pan, randomness, material,
   * important }. Les fichiers de la banque sont prioritaires ; tant qu'ils
   * ne sont pas décodés (ou s'ils sont inaccessibles), la synthèse prend le
   * relais — le jeu n'est jamais silencieux.
   */
  function play(name, options) {
    const opts = options || {};
    const resolved = resolveName(name, opts);
    const event = bankEventFor(resolved);

    const buffers = bankBuffers[event];
    if (buffers && buffers.length) {
      const entry = BANK[event];
      const pitch = opts.pitch == null ? 1 : opts.pitch;
      const rate = pitch * (0.97 + Math.random() * 0.06);
      return playBuffer(pickVariant(event, buffers), {
        rate: clamp(rate, 0.2, 4),
        gain: clamp((opts.volume == null ? 1 : opts.volume) * (entry ? entry.gain : 1), 0, 2),
        pan: clamp(opts.pan || 0, -1, 1),
        important: Boolean(opts.important),
      });
    }
    // Pas encore chargé : on lance le téléchargement et on joue la synthèse.
    if (BANK[event] && !preloaded.has(event)) {
      preloaded.add(event);
      loadEvent(event);
    }

    const samples = samplesFor(resolved);
    if (!samples) return null;
    const preset = PRESETS[resolved];
    const randomness = STEP_PATTERN.test(resolved) || preset[1] == null ? 0.06 : preset[1] || 0;
    const pitch = opts.pitch == null ? 1 : opts.pitch;
    const rate = pitch + pitch * randomness * (Math.random() * 2 - 1);
    return playSamples(samples, {
      rate: clamp(rate, 0.2, 4),
      gain: clamp(opts.volume == null ? 1 : opts.volume, 0, 2),
      pan: clamp(opts.pan || 0, -1, 1),
      important: Boolean(opts.important),
    });
  }

  /** Spatialisation simple : pan et volume selon la distance horizontale. */
  function spatial(worldX) {
    const dx = worldX - listener.x;
    const pan = clamp(dx / Math.max(200, listener.halfWidth * 1.4), -0.85, 0.85);
    const distance = Math.abs(dx);
    const falloff = clamp(1 - (distance - listener.halfWidth) / 1500, 0.08, 1);
    return { pan, gain: falloff };
  }

  function playAt(name, worldX, options) {
    const opts = Object.assign({}, options || {});
    const position = spatial(worldX);
    opts.pan = position.pan;
    opts.volume = (opts.volume == null ? 1 : opts.volume) * position.gain;
    if (opts.volume < 0.02) return null;
    return play(name, opts);
  }

  /** Enchaîne plusieurs presets : [[nom, délaiMs, options], ...]. */
  function sequence(steps, worldX) {
    steps.forEach((step) => {
      const [name, delayMs, options] = step;
      const run = () => (worldX == null ? play(name, options) : playAt(name, worldX, options));
      if (delayMs > 0) window.setTimeout(run, delayMs);
      else run();
    });
  }

  function setVolume(next) {
    volume = clamp(Number(next) || 0, 0, 1);
    remember(STORAGE_VOLUME, volume.toFixed(2));
    applyMasterGain();
  }

  function setMuted(next) {
    muted = Boolean(next);
    remember(STORAGE_MUTED, muted ? "1" : "0");
    applyMasterGain();
  }

  function toggleMuted() {
    setMuted(!muted);
    return muted;
  }

  // Débloque le son au premier geste, même si le jeu oublie de le faire.
  if (typeof window !== "undefined" && window.addEventListener) {
    const onGesture = () => {
      unlock();
      if (unlocked) {
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
        window.removeEventListener("touchend", onGesture, true);
      }
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("touchend", onGesture, true);
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && context && context.state === "suspended") context.resume().catch(() => {});
      });
    }
  }

  return {
    get supported() {
      return supported;
    },
    get ready() {
      return unlocked && Boolean(context) && context.state === "running";
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    get names() {
      return Object.keys(PRESETS);
    },
    presets: PRESETS,
    buildSamples,
    build: samplesFor,
    unlock,
    play,
    playAt,
    sequence,
    /** Événements disposant de fichiers, et combien ont déjà été décodés. */
    get bank() {
      return {
        events: BANK_EVENTS.slice(),
        path: BANK_PATH,
        files: BANK_EVENTS.reduce((total, name) => total + BANK[name].files.length, 0),
        loaded: Object.keys(bankBuffers).length,
      };
    },
    /** Matière des pas : grass (samples dédiés), dirt, stone, wood ou snow. */
    get footstepMaterial() {
      return footstepMaterial;
    },
    setFootstepMaterial(material) {
      if (STEP_MATERIALS[material]) footstepMaterial = material;
      return footstepMaterial;
    },
    footstepMaterials: Object.keys(STEP_MATERIALS),
    preload: preloadBank,
    loadEvent,
    setVolume,
    setMuted,
    toggleMuted,
    setListener(x, halfWidth) {
      listener.x = x;
      if (halfWidth > 0) listener.halfWidth = halfWidth;
    },
  };
})();
