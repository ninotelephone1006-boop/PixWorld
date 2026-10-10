"use strict";

/**
 * Vérifie que la page démarre vraiment, sans navigateur : `npm test`.
 *
 * index.html et les scripts src/ sont exécutés dans un DOM minimal. Si un seul
 * script plante au chargement — par exemple une variable utilisée avant sa
 * déclaration — plus rien ne s'initialise : le menu reste bloqué sur son texte
 * « Connexion à la partie… » et la sélection des héros reste vide. Ce test
 * rejoue donc le démarrage complet (menu, connexion à l'arène, entrée en jeu,
 * arrivée d'un autre joueur, quelques images de jeu) et vérifie que tout se
 * déroule sans erreur.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const SCRIPTS = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);
// Texte d'attente affiché tant que le JS n'a pas pris la main.
const PLACEHOLDER_STATUS = (/id="menu-status"[^>]*>([^<]*)</.exec(HTML) || [, ""])[1].trim();

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log("  ok   " + label);
  else {
    failures++;
    console.log("  ÉCHEC " + label + (detail ? " → " + detail : ""));
  }
}

// ─────────────────────────────── DOM minimal ───────────────────────────────

const camelToDash = (name) => String(name).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

function createStyle() {
  const values = new Map();
  return {
    setProperty(name, value) { values.set(String(name), String(value)); },
    removeProperty(name) { values.delete(String(name)); },
    getPropertyValue(name) { return values.get(String(name)) || ""; },
  };
}

/** Sélecteurs utilisés par le jeu : « #id », « .classe », « [attr] », « :not(…) ». */
function parseSelector(selector) {
  const spec = { tag: null, id: null, classes: [], attrs: [], not: [] };
  let rest = selector.trim();
  const tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) {
    spec.tag = tag[0].toUpperCase();
    rest = rest.slice(tag[0].length);
  }
  const token = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:\s*=\s*"?([^\]"]*)"?)?\]|:not\(([^)]*)\)/g;
  let match;
  while ((match = token.exec(rest))) {
    if (match[1]) spec.id = match[1];
    else if (match[2]) spec.classes.push(match[2]);
    else if (match[3]) spec.attrs.push([match[3], match[4] === undefined ? null : match[4]]);
    else if (match[5]) spec.not.push(parseSelector(match[5]));
  }
  return spec;
}

function matches(element, spec) {
  if (spec.tag && element.tagName !== spec.tag) return false;
  if (spec.id && element.getAttribute("id") !== spec.id) return false;
  if (!spec.classes.every((name) => element.classList.contains(name))) return false;
  if (!spec.attrs.every(([name, value]) => {
    if (!element.hasAttribute(name)) return false;
    return value === null || element.getAttribute(name) === value;
  })) return false;
  return spec.not.every((inner) => !matches(element, inner));
}

function matchesSelectorList(element, selector) {
  return String(selector).split(",").some((part) => matches(element, parseSelector(part)));
}

class StubEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = Boolean(options && options.bubbles);
    this.cancelable = Boolean(options && options.cancelable);
    this.defaultPrevented = false;
    this.target = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

class StubElement {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.attributes = Object.create(null);
    this.childNodes = [];
    this.parentElement = null;
    this.listeners = Object.create(null);
    this.style = createStyle();
    this.value = "";
    this.width = 0;
    this.height = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.focusCount = 0;
    this._text = "";
    this._classes = new Set();
    this._context = null;
    const element = this;
    this.dataset = new Proxy(Object.create(null), {
      get: (_, key) => element.getAttribute("data-" + camelToDash(key)),
      set: (_, key, value) => {
        element.setAttribute("data-" + camelToDash(key), value);
        return true;
      },
    });
  }

  get className() { return Array.from(this._classes).join(" "); }
  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const classes = this._classes;
    return {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
  }

  // Les propriétés reflètent l'attribut, comme dans le navigateur, pour que
  // les sélecteurs « :not([hidden]) » fonctionnent.
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value) { this.toggleAttribute("hidden", value); }
  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(value) { this.toggleAttribute("disabled", value); }

  get textContent() {
    return this._text + this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this._text = String(value);
    this.childNodes.forEach((child) => { child.parentElement = null; });
    this.childNodes = [];
  }

  get children() { return this.childNodes; }
  get firstElementChild() { return this.childNodes[0] || null; }
  get parentNode() { return this.parentElement; }

  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (on) this.attributes[name] = "";
    else delete this.attributes[name];
    return on;
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes[name] = text;
    if (name === "class") this.className = text;
  }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }

  append(...nodes) {
    nodes.forEach((node) => {
      if (typeof node !== "object" || node === null) {
        this._text += String(node);
        return;
      }
      node.parentElement = this;
      this.childNodes.push(node);
    });
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.childNodes = parent.childNodes.filter((child) => child !== this);
    this.parentElement = null;
  }
  focus() { this.focusCount++; }
  blur() {}
  addEventListener(type, handler) {
    (this.listeners[type] || (this.listeners[type] = [])).push(handler);
  }
  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    let node = this;
    while (node) {
      (node.listeners[event.type] || []).slice().forEach((handler) => handler.call(node, event));
      if (!event.bubbles) break;
      // Remontée : élément parent, puis document, puis window.
      node = node.parentElement || node._document || node._window || null;
    }
    return !event.defaultPrevented;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => node.childNodes.forEach((child) => {
      if (matchesSelectorList(child, selector)) found.push(child);
      walk(child);
    });
    walk(this);
    return found;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
  }
  getContext(kind) {
    if (kind !== "2d") return null;
    if (!this._context) this._context = createContext(this);
    return this._context;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

/** Contexte 2D factice : toute méthode inconnue est sans effet. */
function createContext(canvas) {
  const gradient = { addColorStop() {} };
  const base = {
    canvas,
    _trajectoryDashCalls: 0,
    setLineDash(pattern) {
      if (canvas && canvas.getAttribute("id") === "world" && pattern && pattern.length) this._trajectoryDashCalls++;
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    measureText: () => ({ width: 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }),
    putImageData() {},
    isPointInPath: () => false,
  };
  return new Proxy(base, {
    get: (target, key) => {
      if (key in target) return target[key];
      target[key] = () => {};
      return target[key];
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
}

class StubImage {
  constructor() {
    this.src = "";
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
}

// ──────────────────── Structure de la page (reflet d'index.html) ────────────────────

function element(tag, attributes, children) {
  const node = new StubElement(tag);
  Object.entries(attributes || {}).forEach(([name, value]) => node.setAttribute(name, value));
  (children || []).forEach((child) => {
    if (typeof child === "string") node.textContent = child;
    else node.append(child);
  });
  return node;
}

function buildDocument() {
  const body = element("body");
  const document = {
    body,
    hidden: false,
    activeElement: null,
    listeners: Object.create(null),
    createElement: (tag) => new StubElement(tag),
    addEventListener(type, handler) { (this.listeners[type] || (this.listeners[type] = [])).push(handler); },
    removeEventListener() {},
    dispatchEvent(event) { (this.listeners[event.type] || []).slice().forEach((fn) => fn.call(this, event)); return true; },
    querySelector(selector) { return body.querySelector(selector); },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
  };

  const canvas = element("canvas", { id: "world" });
  const players = element("aside", { id: "players", class: "players", "data-mode": "solo", hidden: "" }, [
    element("div", { class: "players-head" }, [
      element("h2", { class: "players-title" }, ["Joueurs"]),
      element("span", { id: "players-mode" }, ["solo"]),
      element("button", { id: "players-rename" }),
    ]),
    element("ul", { id: "players-list" }),
  ]);
  const hotbar = element("aside", { id: "hotbar", hidden: "" }, [
    element("div", { class: "hotbar-slots" }, [
      element("button", { class: "hotbar-slot is-selected", "data-slot": "0", "data-block": "grass" }),
      element("button", { class: "hotbar-slot", "data-slot": "1", "data-block": "dirt" }),
      element("button", { class: "hotbar-slot", "data-slot": "2", "data-block": "stone" }),
    ]),
  ]);
  // Panneau d'affichage : la physique des tirs y est seulement affichée.
  const projectileSettings = element("section", { id: "projectile-settings", hidden: "" }, [
    element("button", { id: "settings-close" }),
    element("button", { id: "settings-done" }),
    element("section", { id: "settings-projectile-locked" }, [
      element("span", { id: "settings-locked-hero" }, ["Kage · Shuriken"]),
      element("dd", { id: "settings-locked-speed" }),
      element("dd", { id: "settings-locked-gravity" }),
      element("dd", { id: "settings-locked-delay" }),
      element("dd", { id: "settings-locked-life" }),
      element("dd", { id: "settings-locked-scale" }),
    ]),
    element("p", { id: "settings-melee-note", hidden: "" }),
    element("input", { id: "settings-trajectory-preview", type: "checkbox" }),
    element("input", { id: "settings-projectile-trails", type: "checkbox" }),
    element("input", { id: "settings-preview-duration", type: "range", value: "2" }),
    element("output", { id: "settings-preview-duration-value" }),
  ]);
  const chat = element("section", { id: "chat", class: "chat", hidden: "" }, [
    element("ul", { id: "chat-log", class: "chat-log" }),
    element("form", { id: "chat-form", class: "chat-form" }, [
      element("input", { id: "chat-input", class: "chat-input", type: "text" }),
      element("button", { id: "chat-send", class: "chat-send", type: "submit" }),
    ]),
  ]);
  const menu = element("section", { id: "game-menu", class: "game-menu" }, [
    element("form", { id: "menu-form" }, [
      element("section", { class: "menu-world" }, [
        element("p", { id: "menu-world-character" }, ["Kage · Ninja"]),
        element("canvas", { id: "menu-featured-preview", width: "192", height: "192" }),
      ]),
      element("section", { class: "menu-console" }, [
        element("p", { id: "menu-kicker" }),
        element("h2", { id: "menu-title" }, ["Choisis ton combattant"]),
        element("p", { id: "menu-copy" }),
        element("button", { id: "menu-close", hidden: "" }),
        element("div", { id: "character-roster", class: "character-roster" }),
        element("input", { id: "menu-name-input", type: "text" }),
        element("button", { id: "menu-mute" }),
        element("input", { id: "menu-volume", type: "range" }),
        element("output", { id: "menu-volume-value" }),
        element("div", { id: "menu-server-share", hidden: "" }, [
          element("code", { id: "menu-server-address" }),
          element("button", { id: "menu-server-copy" }),
        ]),
        element("p", { id: "menu-server-hint" }),
        element("button", { class: "menu-primary" }, [element("span", { id: "menu-play-label" }, ["Entrer dans l'arène"])]),
        element("button", { id: "menu-home", hidden: "" }),
        element("p", { id: "menu-status", class: "menu-status", "data-tone": "wait" }, [PLACEHOLDER_STATUS]),
      ]),
    ]),
    element("p", { id: "menu-hint" }),
  ]);

  body.append(element("main", { class: "game" }, [
    canvas,
    element("section", { class: "hud" }, [
      element("button", { id: "sound-toggle" }),
      element("button", { id: "settings-toggle" }),
    ]),
    players,
    element("div", { id: "toasts", class: "toasts" }),
    chat,
    hotbar,
    projectileSettings,
    menu,
  ]));

  // Chaque nœud connaît son document pour que les événements remontent.
  const attach = (node) => {
    node._document = document;
    node.childNodes.forEach(attach);
  };
  attach(body);
  return document;
}

// ─────────────────────── Audio et réseau simulés ───────────────────────

function createAudioParam() {
  const param = {
    value: 0,
    setValueAtTime() { return param; },
    linearRampToValueAtTime() { return param; },
    exponentialRampToValueAtTime() { return param; },
    setTargetAtTime() { return param; },
    cancelScheduledValues() { return param; },
  };
  return param;
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  resume() { return Promise.resolve(); }
  createGain() { return { gain: createAudioParam(), connect() {}, disconnect() {} }; }
  createStereoPanner() { return { pan: createAudioParam(), connect() {}, disconnect() {} }; }
  createBufferSource() {
    return { buffer: null, playbackRate: createAudioParam(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
  }
  createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (index) => data[index] };
  }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, 1, this.sampleRate)); }
}

function createStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

/** Navigateur complet : DOM, timers, audio, WebSocket et boucle d'animation. */
function createBrowser(options) {
  const settings = options || {};
  const document = buildDocument();
  const sockets = [];
  const timers = [];
  const frames = [];
  let clock = 0;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({});
    }
    open() {
      this.readyState = 1;
      if (this.onopen) this.onopen({});
      this.receive({ t: "welcome", id: "p1", players: [], mining: { mined: [], drops: [] } });
    }
    receive(message) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(message) });
    }
  }

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    Promise,
    URL,
    Uint8ClampedArray,
    Float32Array,
    ArrayBuffer,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    localStorage: createStorage(settings.storage),
    location: { protocol: "http:", host: "localhost:3000", href: "http://localhost:3000/" },
    devicePixelRatio: 1,
    performance: { now: () => clock },
    document,
    Event: StubEvent,
    Image: StubImage,
    AudioContext: FakeAudioContext,
    WebSocket: settings.noServer ? undefined : FakeWebSocket,
    fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
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
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    listeners: Object.create(null),
    addEventListener(type, handler) { (this.listeners[type] || (this.listeners[type] = [])).push(handler); },
    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler);
    },
    dispatchEvent(event) { (this.listeners[event.type] || []).slice().forEach((fn) => fn.call(sandbox, event)); return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  document._window = sandbox;
  vm.createContext(sandbox);

  return {
    sandbox,
    sockets,
    frames,
    document,
    /** Exécute les scripts dans l'ordre de index.html ; renvoie la première erreur. */
    load() {
      for (const src of SCRIPTS) {
        try {
          if (settings.beforeScript) settings.beforeScript(src, sandbox);
          vm.runInContext(fs.readFileSync(path.join(ROOT, src), "utf8"), sandbox, { filename: src });
        } catch (error) {
          return src + " : " + (error && error.stack ? error.stack : error);
        }
      }
      return null;
    },
    /** Joue quelques images de la boucle de jeu. */
    runFrames(count) {
      for (let i = 0; i < count; i++) {
        clock += 16;
        const pending = frames.splice(0, frames.length);
        if (!pending.length) return i;
        pending.forEach((callback) => callback(clock));
      }
      return count;
    },
    dispose() {
      timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
      frames.length = 0;
    },
  };
}

// ─────────────────────────────── Les tests ───────────────────────────────

/** index.html et les scripts doivent toujours se comprendre. */
function testMarkupStaysInSync() {
  console.log("Cohérence de index.html et des scripts");
  const sources = SCRIPTS.map((src) => fs.readFileSync(path.join(ROOT, src), "utf8")).join("\n");
  const ids = new Set([...sources.matchAll(/querySelector(?:All)?\("#([\w-]+)"\)/g)].map((m) => m[1]));
  const classes = new Set([...sources.matchAll(/querySelector(?:All)?\("\.([\w-]+)/g)].map((m) => m[1]));

  ids.forEach((id) => {
    check("index.html définit l'élément #" + id, new RegExp('id="' + id + '"').test(HTML));
  });
  classes.forEach((name) => {
    const inMarkup = new RegExp('class="[^"]*\\b' + name + '\\b').test(HTML);
    const createdByScript = sources.includes('"' + name + '"');
    check("la classe ." + name + " existe dans index.html ou est créée par un script", inMarkup || createdByScript);
  });
  check("le texte d'attente du menu est présent", PLACEHOLDER_STATUS.length > 0, PLACEHOLDER_STATUS);

  // La physique des tirs est fixée par le jeu : le panneau du HUD ne doit
  // proposer aucun champ pour la changer, seulement l'affichage de l'aperçu.
  const settingsBlock = HTML.slice(
    HTML.indexOf('<section class="projectile-settings-overlay"'),
    HTML.indexOf('<p class="hint">'),
  );
  const tuningFields = ["settings-projectile-speed", "settings-projectile-gravity", "settings-projectile-delay",
    "settings-projectile-life", "settings-projectile-scale", "settings-projectile-speed-value",
    "settings-character-tabs", "settings-reset"]
    .filter((id) => new RegExp('id="' + id + '"').test(HTML));
  check("aucun champ de réglage de tir dans index.html", tuningFields.length === 0, tuningFields.join(", "));
  const rangeInputs = [...settingsBlock.matchAll(/<input[^>]*type="range"[^>]*>/g)].map((m) => m[0]);
  check("le seul curseur du panneau règle la longueur de l'aperçu",
    rangeInputs.length === 1 && rangeInputs[0].includes("settings-preview-duration"),
    rangeInputs.join("\n"));
  check("l'aperçu du tir reste activable", /id="settings-trajectory-preview" type="checkbox"/.test(settingsBlock));
  check("le récapitulatif du tir est en lecture seule", /id="settings-locked-speed"/.test(settingsBlock));
  // Ni le réseau ni le navigateur ne peuvent injecter une physique de tir.
  check("le jeu ne lit aucune physique envoyée par un joueur ou le serveur",
    !/\b(?:message|data|state|peer|saved)\.projectile\b/.test(sources));
}

/** Le scénario qui a déjà cassé : plus aucun héros affiché, statut figé. */
function testPageBoots() {
  console.log("Démarrage de la page");
  const browser = createBrowser();
  const failure = browser.load();
  check("tous les scripts se chargent sans erreur", failure === null, failure);
  if (failure) {
    browser.dispose();
    return;
  }

  const document = browser.document;
  const status = document.querySelector("#menu-status");
  const roster = document.querySelector("#character-roster");

  check("les quatre héros sont affichés dans le menu", roster.querySelectorAll(".character-card").length === 4,
    String(roster.querySelectorAll(".character-card").length));
  check("une carte de héros porte le personnage sélectionné",
    Boolean(roster.querySelector('.character-card[aria-pressed="true"]')));

  // Le serveur répond : le statut ne doit plus être le texte d'attente.
  check("une connexion WebSocket est ouverte", browser.sockets.length === 1);
  browser.sockets[0].open();
  check("le statut du menu n'est plus figé sur « " + PLACEHOLDER_STATUS + " »",
    status.textContent !== PLACEHOLDER_STATUS, status.textContent);
  check("le mode annonce l'arène commune", document.querySelector("#players-mode").textContent === "en ligne",
    document.querySelector("#players-mode").textContent);
  check("le panneau des joueurs est visible", document.querySelector("#players").hidden === false);
  check("l'adresse à partager est proposée", document.querySelector("#menu-server-share").hidden === false);

  // Entrée dans l'arène, puis quelques images de jeu.
  document.querySelector("#menu-name-input").value = "Kage";
  document.querySelector("#menu-form").dispatchEvent(new StubEvent("submit", { bubbles: true, cancelable: true }));
  check("le menu se referme quand on entre dans l'arène", document.querySelector("#game-menu").hidden === true);
  check("le pseudo est envoyé au serveur",
    browser.sockets[0].sent.some((message) => message.t === "hello" && message.name === "Kage"),
    JSON.stringify(browser.sockets[0].sent));

  // Un autre joueur arrive et son état est relayé.
  browser.sockets[0].receive({ t: "join", player: { id: "p2", name: "Ami", character: "archer" } });
  browser.sockets[0].receive({ t: "snapshot", p: [{ id: "p2", name: "Ami", character: "archer", x: 300, gap: 0, f: 1, vx: 0, vy: 0, g: true, a: 0, c: "archer", n: 0, hp: 100, d: false }] });

  const playedFrames = browser.runFrames(20);
  check("la boucle de jeu tourne sans erreur", playedFrames === 20, playedFrames + " image(s) rendue(s)");
  check("l'autre joueur apparaît dans la liste",
    document.querySelector("#players-list").textContent.includes("Ami"),
    document.querySelector("#players-list").textContent);
  check("le titre compte deux joueurs",
    document.querySelector(".players-title").textContent.includes("2"),
    document.querySelector(".players-title").textContent);
  check("la barre de blocs est visible pendant la partie", document.querySelector("#hotbar").hidden === false);

  browser.dispose();
}

/** Sans serveur, le jeu reste jouable en solo au lieu de rester figé. */
function testOfflineBoot() {
  console.log("Démarrage sans serveur");
  const browser = createBrowser({ noServer: true });
  const failure = browser.load();
  check("tous les scripts se chargent sans erreur", failure === null, failure);
  if (failure) {
    browser.dispose();
    return;
  }
  const status = browser.document.querySelector("#menu-status");
  check("le statut bascule sur « hors ligne »", status.textContent !== PLACEHOLDER_STATUS, status.textContent);
  check("le mode est annoncé hors ligne", browser.document.querySelector("#players-mode").textContent === "hors ligne",
    browser.document.querySelector("#players-mode").textContent);
  browser.runFrames(5);
  browser.dispose();
}

module.exports = { createBrowser, StubEvent };

if (require.main === module) {
  testMarkupStaysInSync();
  testPageBoots();
  testOfflineBoot();

  if (failures) {
    console.log("\n" + failures + " vérification(s) en échec.");
    process.exitCode = 1;
  }
}
