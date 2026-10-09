/**
 * PixWorld — effets sonores procéduraux.
 *
 * Aucun fichier audio : chaque son est synthétisé à la volée avec un petit
 * moteur dérivé de ZzFX (Frank Force, licence MIT, voir assets/CREDITS.md).
 * Les presets ci-dessous décrivent une quarantaine d'effets : interface,
 * déplacements, attaques de chaque héros, impacts, K.O., réapparition,
 * réseau… Les sons des autres joueurs sont spatialisés (balance stéréo et
 * atténuation selon leur distance à la caméra).
 *
 *   PixWorldAudio.play("jump")                      → son local
 *   PixWorldAudio.playAt("slash", worldX)           → son d'un joueur distant
 *   PixWorldAudio.sequence([["uiConfirm", 0], ["uiSelect", 90]])
 *   PixWorldAudio.setVolume(0.8) / toggleMuted()     → réglages mémorisés
 *
 * Le contexte audio n'est créé qu'au premier geste de l'utilisateur, comme
 * l'exigent les navigateurs.
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
    castOrb: [0.65, 0.05, 420, 0.03, 0.1, 0.35, 0, 1, 2, 0, 210, 0.08, 0, 0, 7, 0, 0.06, 0.7],

    // Impacts
    hitShuriken: [0.75, 0.05, 1900, 0.001, 0.02, 0.11, 1, 1.6, -10, 0, 0, 0, 0, 0.3, 0, 0, 0, 0.6],
    hitArrow: [0.85, 0.05, 260, 0.001, 0.03, 0.15, 4, 1.8, -5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.6, 0, 0, -1600],
    hitSlash: [0.95, 0.05, 480, 0.001, 0.04, 0.26, 4, 1.5, -8, 0, 0, 0, 0, 0.7, 0, 0, 0.02, 0.6, 0, 0, -3000],
    hitOrb: [0.85, 0.05, 600, 0.005, 0.08, 0.3, 0, 1.2, -4, 0, -220, 0.1, 0, 0.1, 8, 0, 0.05, 0.6],
    impactSpark: [0.4, 0.1, 3200, 0.001, 0.01, 0.07, 1, 1.2, -20, 0, 0, 0, 0, 0.2, 0, 0, 0, 0.5],
    hurt: [0.85, 0.05, 520, 0.01, 0.02, 0.22, 2, 1.1, -12, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.7, 0.05],
    hurtCritical: [0.95, 0.05, 330, 0.01, 0.05, 0.3, 2, 1.3, -10, 0, -60, 0.06, 0, 0.15, 0, 0, 0, 0.7, 0.05],
    fizzle: [0.28, 0.1, 700, 0.001, 0.01, 0.06, 1, 1.5, -8, 0, 0, 0, 0, 0.2],

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
    // On gèle la part aléatoire à la construction : la variation se fait
    // ensuite via la vitesse de lecture, comme ZZFXSound.
    const params = preset.slice();
    params[1] = 0;
    const samples = buildSamples(...params);
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

  /** À appeler sur un geste utilisateur : débloque le contexte audio. */
  function unlock() {
    if (!ensureContext()) return;
    unlocked = true;
    // Pré-calcule les sons les plus fréquents pendant que le menu est ouvert.
    ["jump", "land", "step", "hurt", "uiSelect", "uiHover"].forEach(samplesFor);
  }

  function playSamples(samples, options) {
    if (!unlocked || !context || !samples || !samples.length) return null;
    if (muted) return null;
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

    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
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

    voices.push(now + samples.length / SAMPLE_RATE / Math.max(0.2, options.rate) + 0.05);
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

  /**
   * Joue un preset. options : { volume, pitch, pan, randomness, important }.
   */
  function play(name, options) {
    const samples = samplesFor(name);
    if (!samples) return null;
    const preset = PRESETS[name];
    const opts = options || {};
    const randomness = opts.randomness == null ? preset[1] || 0 : opts.randomness;
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
    setVolume,
    setMuted,
    toggleMuted,
    setListener(x, halfWidth) {
      listener.x = x;
      if (halfWidth > 0) listener.halfWidth = halfWidth;
    },
  };
})();
