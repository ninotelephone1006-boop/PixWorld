/**
 * PixWorld — jeu de plateforme 2D multijoueur.
 *
 * Chaque visiteur choisit son héros et son pseudo dans un menu titre dédié.
 * Les quatre combattants ont leur propre feuille de sprite et leur attaque ;
 * Échap rouvre le menu en pause pendant la partie.
 *
 * Combat : chaque joueur porte une barre de vie. Les attaques des autres
 * (projectiles et coups de mêlée) nous enlèvent des points, nous repoussent
 * et déclenchent flash, secousse de caméra, étincelles et chiffres de dégâts.
 * À 0, une courte séquence de K.O. précède la réapparition au camp de départ.
 * Tout est accompagné d'effets sonores synthétisés (src/audio.js) et
 * d'effets visuels (src/effects.js).
 *
 * Le monde est une prairie plate (src/world.js) dont le sol est fait de blocs
 * (src/terrain.js) : une couche d'herbe, quatre de terre, dix de pierre. Tenir
 * le clic gauche sur un bloc à portée le mine en deux secondes (src/mining.js) ;
 * il laisse un objet à ramasser, rangé dans la barre d'inventaire à droite de
 * l'écran (src/inventory.js, src/hotbar.js). Le rendu des blocs est dans
 * src/block-view.js, celui du décor dans src/scenery.js.
 *
 * Tous les joueurs rejoignent le serveur WebSocket du site : voir src/net.js.
 */
(() => {
  "use strict";

  const canvas = document.querySelector("#world");
  const ctx = canvas.getContext("2d");
  const keys = new Set();
  // Souris : position dans le canevas, présence sur le jeu, clic gauche enfoncé.
  const mouse = { x: 0, y: 0, inside: false, down: false };

  const gameMenu = document.querySelector("#game-menu");
  const menuForm = document.querySelector("#menu-form");
  const menuNameInput = document.querySelector("#menu-name-input");
  const menuTitle = document.querySelector("#menu-title");
  const menuKicker = document.querySelector("#menu-kicker");
  const menuCopy = document.querySelector("#menu-copy");
  const menuPlayLabel = document.querySelector("#menu-play-label");
  const menuClose = document.querySelector("#menu-close");
  const menuHome = document.querySelector("#menu-home");
  const menuStatus = document.querySelector("#menu-status");
  const menuHint = document.querySelector("#menu-hint");
  const menuWorldCharacter = document.querySelector("#menu-world-character");
  const menuVolume = document.querySelector("#menu-volume");
  const menuVolumeValue = document.querySelector("#menu-volume-value");
  const menuMute = document.querySelector("#menu-mute");
  const menuServerShare = document.querySelector("#menu-server-share");
  const menuServerAddress = document.querySelector("#menu-server-address");
  const menuServerCopy = document.querySelector("#menu-server-copy");
  const menuServerHint = document.querySelector("#menu-server-hint");
  const characterRoster = document.querySelector("#character-roster");
  const featuredPreview = document.querySelector("#menu-featured-preview");
  const featuredPreviewContext = featuredPreview.getContext("2d");
  const CHARACTERS = window.PixWorldCharacters;
  const characterPreviews = [];

  const playersPanel = document.querySelector("#players");
  const playersList = document.querySelector("#players-list");
  const playersTitle = document.querySelector(".players-title");
  const playersMode = document.querySelector("#players-mode");
  const playersRename = document.querySelector("#players-rename");
  const soundToggle = document.querySelector("#sound-toggle");
  const toasts = document.querySelector("#toasts");
  const hotbarWrap = document.querySelector("#hotbar-wrap");
  const hotbarList = document.querySelector("#hotbar");
  const hotbarName = document.querySelector("#hotbar-name");

  const audio = window.PixWorldAudio;
  const fx = window.PixWorldEffects.create();
  // Herbe interactive : les touffes du sol plient, font un froissement et
  // projettent parfois des brins quand un personnage les traverse (src/grass.js).
  const grass = window.PixWorldGrass.create({
    onRustle: handleGrassRustle,
    onBlades: handleGrassBlades,
    canTouch: (tile) => tuftVisible(tile),
  });

  const STORAGE_NAME = "pixworld.name";
  const STORAGE_CHARACTER = "pixworld.character";
  const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const GRAVITY = 1900; // accélération de la chute, px/s²

  // Points de vie : barre au-dessus de chaque joueur, dégâts des attaques.
  const MAX_HP = 100;
  const REGEN_DELAY = 5; // secondes sans dégâts avant de se soigner
  const REGEN_RATE = 9; // points de vie par seconde
  const RESPAWN_INVULNERABILITY = 1.6;
  const KO_DURATION = 1.15; // séquence de K.O. avant la réapparition
  const HURT_DURATION = 0.28; // image « blessé » après un coup
  const FLASH_DURATION = 0.09; // silhouette blanche après un coup
  const LOW_HP = 35; // en dessous : vignette rouge et battements de cœur
  const COMBO_FINISHER_BONUS = 5; // la 3e coupe de Raiden frappe plus fort
  const WHEEL_STEP = 60; // delta de molette (px) pour changer d'emplacement d'un cran

  // ─────────────────────────── Sprites et décor ───────────────────────────
  // Chaque héros possède sa feuille complète : les ninjas CC0 pour Kage et
  // Yume, et des sprites originaux pour Sora (archère) et Raiden (samouraï).
  const characterSheets = Object.create(null);
  CHARACTERS.list.forEach((character) => {
    const sheet = new Image();
    sheet.src = character.sprite;
    characterSheets[character.id] = sheet;
  });

  // Décor de la prairie « Sunny Land » (Ansimuz, CC0) : ciel, collines et
  // touffes d'herbe. Les autres biomes sont dessinés par src/scenery.js.
  const skyLayer = new Image();
  skyLayer.src = "assets/background/sky-back.png";
  const hillsLayer = new Image();
  hillsLayer.src = "assets/background/hills-middle.png";
  const tileset = new Image();
  tileset.src = "assets/background/tileset.png";

  const tileSize = 16;
  const tileScale = 4;
  const tileDraw = tileSize * tileScale;
  // Terrain en blocs (src/terrain.js) : deux blocs font la hauteur du héros.
  const BLOCK = window.PixWorldTerrain.BLOCK;
  const TERRAIN_DEPTH = window.PixWorldTerrain.DEPTH;
  // Tuiles de la feuille : touffes d'herbe de la prairie.
  const tuftTiles = [
    [16, 115],
    [48, 115],
  ];
  const tuftScale = 3; // touffes de 16 × 13 px de la feuille, à l'échelle 3
  const tuftW = tileSize * tuftScale;
  const tuftH = 13 * tuftScale;
  const frameSize = 32;
  const spriteScale = 4;
  const spriteDrawSize = frameSize * spriteScale;
  const spriteTopPadding = 9 * spriteScale;
  // Cellules spéciales des feuilles : blessé et K.O. (colonne 5).
  const HURT_FRAME = { column: 5, row: 0 };
  const DEAD_FRAME = { column: 5, row: 3 };

  // Le monde est partagé : même graine, donc le même relief, les mêmes
  // plateformes et le même décor pour tous les joueurs.
  const WORLD_SEED = "pixworld";
  const world = window.PixWorldWorld.create(WORLD_SEED);
  const WORLD_WIDTH = world.width;
  const scenery = window.PixWorldScenery.create({
    world,
    images: { sky: skyLayer, hills: hillsLayer },
  });
  const STEP_HEIGHT = window.PixWorldWorld.constants.STEP;
  const SEND_INTERVAL = 0.05; // 20 envois de position par seconde
  const SPAWN_X = 112;

  // Le sol est fait de blocs (src/terrain.js) ; seuls les blocs minés sont stockés.
  const terrain = window.PixWorldTerrain.create({ width: WORLD_WIDTH });
  const blockView = window.PixWorldBlockView.create({ terrain });
  const inventory = window.PixWorldInventory.create();
  const drops = window.PixWorldDrops.create({ terrain });
  const miner = window.PixWorldMining.create({
    terrain,
    onBreak: handleBlockBroken,
    onHit: handleBlockHit,
  });
  const hotbar = window.PixWorldHotbar.create({
    root: hotbarList,
    wrap: hotbarWrap,
    label: hotbarName,
    onSelect: selectSlot,
  });
  // Mêmes noms de matière pour les pas et les particules.
  const STEP_OF_BLOCK = { grass: "grass", dirt: "dirt", stone: "stone", bedrock: "stone" };
  const BLOCK_COLORS = {
    grass: ["#6ccf45", "#5fbf3a", "#7a4a2b", "#8c5734"],
    dirt: ["#7a4a2b", "#8c5734", "#6b3f24", "#a86d43"],
    stone: ["#9a9ea6", "#7d828a", "#c4c8ce", "#b0b5bd"],
    bedrock: ["#2f2f36", "#44444e", "#1c1c22"],
  };
  let lastFullNotice = -Infinity; // dernier avertissement « inventaire plein »

  const player = {
    x: SPAWN_X,
    y: 0,
    // Profondeur des pieds sous la surface : 0 posé sur le sol, négatif en l'air,
    // positif dans un trou. La hauteur du héros vaut deux blocs.
    feet: 0,
    width: 42,
    height: BLOCK * 2,
    velocityX: 0,
    velocityY: 0,
    knockback: 0,
    speed: 340,
    jumpStrength: 700,
    grounded: true,
    facing: 1,
    animationTime: 0,
    attackTime: 0,
    attackSerial: 0,
    shotTimer: -1, // délai avant le départ du projectile (-1 : rien en attente)
    meleeSerial: 0,
    meleeHits: null,
    landingTime: 0,
    hurtTime: 0,
    flashTime: 0,
    deadTime: 0,
    hp: MAX_HP,
    invulnerable: 0,
    timeSinceDamage: 99,
    regenAnnounced: true,
    stepTimer: 0,
    stepCount: 0,
    heartbeatTimer: 0,
    airTime: 0,
  };

  let width = 0;
  let height = 0;
  let groundY = 0; // ligne de base de l'écran ; le sol réel est groundAt(x)
  let currentBiome = null; // biome où se trouve le joueur (pour l'annonce)
  let lastTime = 0;
  let camX = 0;
  let sendTimer = 0;
  let menuMode = "start";
  let selectedCharacter = "ninja";
  let lastPanelHp = MAX_HP;
  const projectiles = [];

  // ───────────────────────── État multijoueur ─────────────────────────
  /** Autres joueurs : id -> { id, name, character, hp, x, gap, rx, ry, ... } */
  const others = new Map();
  const identity = {
    name: "Ninja",
    character: "ninja",
  };
  let net = null;
  let myId = null;
  let playing = false;
  let hasJoined = false;
  let panelDirty = true;

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
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* stockage indisponible : ce n'est pas grave */
    }
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Hauteur du sol (écran) sous l'abscisse monde x : le relief varie avec le monde. */
  function groundAt(x) {
    return groundY - world.offsetAt(x);
  }

  /** Centre horizontal d'un personnage dont le bord gauche est en x. */
  function centerOf(x) {
    return x + player.width / 2;
  }

  // ─────────────────────────── Terrain en blocs ───────────────────────────
  /**
   * Ligne de la surface à l'écran. Le sol en blocs (480 px de profondeur) reste
   * visible en entier dès que la fenêtre le permet. Sur une fenêtre basse, la
   * surface ne descend pas sous 30 % de la hauteur, pour que le héros reste
   * sous la barre de commandes ; le fond du monde déborde alors un peu.
   */
  function surfaceY(viewHeight) {
    return Math.round(clamp(viewHeight - TERRAIN_DEPTH, viewHeight * 0.3, viewHeight * 0.5));
  }

  /** Boîte de collision du héros, en profondeur. */
  function playerBox() {
    return { x: player.x, feet: player.feet, width: player.width, height: player.height };
  }

  /** Recalcule la position à l'écran à partir de la profondeur des pieds. */
  function syncPlayerY() {
    player.y = groundY + player.feet - player.height;
  }

  /** Déplace le héros dans le terrain, avec collisions. Renvoie le résultat (hitX, hitY, landed…). */
  function moveBody(dx, dy) {
    const result = terrain.move(playerBox(), dx, dy);
    player.x = result.x;
    player.feet = result.feet;
    return result;
  }

  /** Matière des pas sous des pieds à la profondeur `feet`, pour src/audio.js. */
  function materialUnder(worldX, feet) {
    const type = terrain.typeAt(Math.floor(worldX / BLOCK), Math.floor((feet + 1) / BLOCK));
    return STEP_OF_BLOCK[type] || "dirt";
  }

  /** Une touffe pousse sur l'herbe : si son bloc de surface a été miné, elle disparaît. */
  function tuftVisible(tile) {
    const tuft = window.PixWorldGrass.tuftFor(tile);
    if (!tuft) return false;
    const first = Math.floor(tuft.x0 / BLOCK);
    const last = Math.floor((tuft.x1 - 0.01) / BLOCK);
    for (let col = first; col <= last; col++) {
      if (terrain.typeAt(col, 0) !== "grass") return false;
    }
    return true;
  }

  /** Nettoie un pseudo venu du réseau ou du champ de saisie. */
  function cleanName(raw) {
    const text = String(raw == null ? "" : raw)
      // On retire les caractères de contrôle et les espaces superflus.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 14);
    return text || "Ninja";
  }

  function cleanCharacter(raw) {
    return CHARACTERS.isValid(raw) ? raw : "ninja";
  }

  function characterFor(id) {
    return CHARACTERS.get(cleanCharacter(id));
  }

  /** Couleur d'identification dans l'interface : l'accent du héros choisi. */
  function accentFor(id) {
    return characterFor(id).accent;
  }

  /** Centre horizontal (monde) et vertical d'un joueur, pour les effets. */
  function playerCenter() {
    return { x: player.x + player.width / 2, y: player.y + player.height / 2 };
  }

  function peerCenter(peer) {
    return { x: peer.rx + player.width / 2, y: peer.ry + player.height / 2 };
  }

  // ───────────────────────────── Son ─────────────────────────────
  function sfx(name, options) {
    audio.play(name, options);
  }

  /** Son d'un autre joueur : balance et volume selon sa position. */
  function sfxAt(name, worldX, options) {
    audio.playAt(name, worldX, options);
  }

  function updateSoundButtons() {
    const muted = audio.muted;
    const label = muted ? "Activer le son (M)" : "Couper le son (M)";
    [soundToggle, menuMute].forEach((button) => {
      if (!button) return;
      button.textContent = muted ? "🔇" : "🔊";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(muted));
    });
    if (menuVolume) {
      menuVolume.value = String(Math.round(audio.volume * 100));
      menuVolume.style.setProperty("--volume", Math.round(audio.volume * 100) + "%");
      menuVolume.disabled = muted;
    }
    if (menuVolumeValue) menuVolumeValue.textContent = muted ? "muet" : Math.round(audio.volume * 100) + " %";
  }

  function toggleMute() {
    audio.unlock();
    const muted = audio.toggleMuted();
    updateSoundButtons();
    if (!muted) sfx("uiToggleOn");
    toast(muted ? "Son coupé" : "Son activé", true);
  }

  // ──────────────────────────── Interface ────────────────────────────
  function buildCharacterCards() {
    CHARACTERS.list.forEach((character, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "character-card";
      card.dataset.character = character.id;
      card.style.setProperty("--hero-accent", character.accent);
      card.setAttribute("aria-label", character.name + ", " + character.role + " : " + character.attackName);
      card.setAttribute("aria-pressed", String(character.id === selectedCharacter));
      card.addEventListener("click", () => selectCharacter(character.id, true));
      card.addEventListener("pointerenter", () => {
        if (card.getAttribute("aria-pressed") !== "true") sfx("uiHover", { volume: 0.6 });
      });

      const artWrap = document.createElement("span");
      artWrap.className = "character-art-wrap";
      artWrap.setAttribute("aria-hidden", "true");
      const art = document.createElement("canvas");
      art.className = "character-art";
      art.width = 96;
      art.height = 96;
      art.dataset.character = character.id;
      artWrap.append(art);

      const copy = document.createElement("span");
      copy.className = "character-card-copy";
      const role = document.createElement("span");
      role.className = "character-role";
      role.textContent = String(index + 1).padStart(2, "0") + " · " + character.role;
      const name = document.createElement("span");
      name.className = "character-name";
      name.textContent = character.name;
      const attack = document.createElement("span");
      attack.className = "character-attack";
      attack.textContent = character.attackName + " · " + character.attackDescription;
      copy.append(role, name, attack);
      card.append(artWrap, copy);
      characterRoster.append(card);
      characterPreviews.push({ canvas: art, context: art.getContext("2d"), character });
    });
  }

  function updateCharacterCards() {
    characterRoster.querySelectorAll(".character-card").forEach((card) => {
      card.setAttribute("aria-pressed", String(card.dataset.character === selectedCharacter));
    });
    const character = characterFor(selectedCharacter);
    featuredPreview.style.setProperty("--hero-accent", character.accent);
    menuWorldCharacter.textContent = character.name + " · " + character.role;
  }

  function selectCharacter(id, byUser) {
    const next = cleanCharacter(id);
    if (byUser && next !== selectedCharacter) {
      sfx("uiSelect");
      // Petit aperçu sonore de l'attaque du héros choisi.
      const character = characterFor(next);
      if (character.attackSound) audio.sequence([[character.attackSound, 120, { volume: 0.45 }]]);
    }
    selectedCharacter = next;
    updateCharacterCards();
  }

  function setStatus(text, tone) {
    menuStatus.textContent = text;
    menuStatus.dataset.tone = tone;
  }

  function describeMode(mode) {
    if (mode === "online") return { label: "en ligne", tone: "online", text: "Tu es dans l’arène commune. Invite tes amis avec le lien du jeu !" };
    if (mode === "reconnect") return { label: "reconnexion", tone: "local", text: "Arène indisponible, nouvelle tentative automatique…" };
    if (mode === "full") return { label: "arène pleine", tone: "local", text: "L’arène est pleine. Nouvelle tentative automatique…" };
    if (mode === "unavailable") return { label: "hors ligne", tone: "solo", text: "Ouvre le lien du jeu hébergé pour rejoindre les autres joueurs." };
    return { label: "connexion…", tone: "local", text: "Connexion à l’arène commune…" };
  }

  function refreshServerShare() {
    const target = net && net.serverInfo;
    if (!menuServerShare) return;
    menuServerShare.hidden = !target;
    if (target) menuServerAddress.textContent = target.httpUrl + "/";
    if (menuServerHint) menuServerHint.textContent = "Partage le lien du jeu : tes amis rejoignent la même arène, sans configuration. Le site doit être accessible sur Internet pour jouer depuis des réseaux différents.";
  }

  /** Copie l'adresse à partager dans le presse-papiers. */
  function copyServerAddress() {
    const value = menuServerAddress ? menuServerAddress.textContent.trim() : "";
    if (!value) return;
    const done = () => {
      toast("Adresse copiée", true);
      sfx("uiSelect", { volume: 0.6 });
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, () => copyFallback(value, done));
        return;
      }
    } catch (error) {
      /* presse-papiers indisponible : on tente la méthode de secours */
    }
    copyFallback(value, done);
  }

  function copyFallback(text, done) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      done();
    } catch (error) {
      toast("Adresse : " + text, true);
    }
  }

  let lastMode = null;
  function applyMode(mode) {
    const info = describeMode(mode);
    const target = net ? net.serverInfo : null;
    playersPanel.dataset.mode = mode;
    playersMode.textContent = info.label;
    playersMode.title = target ? "Serveur : " + target.display : "";
    if (!playing) setStatus(info.text, info.tone);

    if (lastMode === "reconnect" && mode === "online") {
      sfx("connected");
      toast("Connexion rétablie", true);
    }
    lastMode = mode;
    panelDirty = true;
  }

  function toast(text, silent) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = text;
    toasts.append(item);
    while (toasts.children.length > 4) toasts.firstElementChild.remove();
    if (!silent) sfx("toast", { volume: 0.7 });
    setTimeout(() => {
      item.classList.add("fade");
      setTimeout(() => item.remove(), 400);
    }, 2800);
  }

  /** Couleur de la barre de vie : vert plein → orange → rouge critique. */
  function hpColor(ratio) {
    const t = clamp(ratio, 0, 1);
    if (t > 0.5) {
      const k = (t - 0.5) / 0.5;
      return "rgb(" + Math.round(255 - 128 * k) + ", " + Math.round(123 + 101 * k) + ", " + Math.round(64 + 62 * k) + ")";
    }
    const k = t / 0.5;
    return "rgb(255, " + Math.round(77 + 46 * k) + ", " + Math.round(77 - 13 * k) + ")";
  }

  function renderPanel() {
    if (!net) return;
    playersTitle.textContent = "Joueurs · " + (others.size + 1);
    playersList.textContent = "";

    const rows = [
      { name: identity.name, character: identity.character, hp: player.hp, self: true, dead: player.deadTime > 0 },
    ];
    Array.from(others.values())
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .forEach((peer) => rows.push({ name: peer.name, character: peer.character, hp: peer.hp, self: false, dead: peer.dead }));

    rows.forEach((row) => {
      const li = document.createElement("li");
      if (row.self) li.className = "is-self";

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = accentFor(row.character);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.name + (row.self ? " (vous)" : "");

      const meter = document.createElement("span");
      meter.className = "hp-meter";
      meter.title = row.dead ? "K.O." : "Vie " + Math.round(row.hp) + " / " + MAX_HP;
      const fill = document.createElement("i");
      const ratio = clamp(row.hp / MAX_HP, 0, 1);
      fill.style.width = Math.round(ratio * 100) + "%";
      fill.style.background = hpColor(ratio);
      meter.append(fill);

      const role = document.createElement("span");
      role.className = "player-class";
      role.textContent = row.dead ? "K.O." : characterFor(row.character).role;
      role.title = characterFor(row.character).attackName;

      li.append(swatch, name, meter, role);
      playersList.append(li);
    });
  }

  function syncMenuFromIdentity() {
    menuNameInput.value = identity.name;
    selectedCharacter = cleanCharacter(identity.character);
    updateCharacterCards();
  }

  function openMenu(mode) {
    menuMode = mode === "pause" ? "pause" : "start";
    playing = false;
    player.velocityX = 0;
    keys.clear();
    mouse.down = false;
    miner.reset();
    hotbar.show(false);
    syncMenuFromIdentity();
    gameMenu.dataset.mode = menuMode;
    menuClose.hidden = menuMode !== "pause";
    menuHome.hidden = menuMode !== "pause";

    if (menuMode === "pause") {
      menuKicker.textContent = "PARTIE EN COURS · PAUSE";
      menuTitle.textContent = "La partie est en pause";
      menuCopy.textContent = "Change de héros ou de pseudo, puis reprends exactement où tu en étais.";
      menuPlayLabel.textContent = "Reprendre la partie";
      menuHint.textContent = "ÉCHAP · REPRENDRE LA PARTIE";
    } else {
      menuKicker.textContent = "AVANT DE PARTIR · ÉTAPE 01";
      menuTitle.textContent = "Choisis ton combattant";
      menuCopy.textContent = "Chaque héros a son propre style d'attaque. Choisis ton préféré avant d'entrer dans le monde.";
      menuPlayLabel.textContent = "Entrer dans l'arène";
      menuHint.textContent = "CHOISIS TON HÉROS · PUIS ENTRE DANS L'ARÈNE";
    }

    gameMenu.hidden = false;
    gameMenu.classList.remove("is-opening");
    void gameMenu.offsetWidth;
    gameMenu.classList.add("is-opening");
    if (net) applyMode(net.mode);
    updateSoundButtons();
    if (menuMode === "pause") {
      menuPlayLabel.parentElement.focus({ preventScroll: true });
    } else {
      const selectedCard = characterRoster.querySelector('.character-card[aria-pressed="true"]');
      if (selectedCard) selectedCard.focus({ preventScroll: true });
    }
  }

  function hideMenu() {
    gameMenu.hidden = true;
    gameMenu.classList.remove("is-opening");
    // La barre d'inventaire ne réapparaît qu'une fois la partie reprise.
    hotbar.show(true);
  }

  function applyMenuSelection() {
    const name = cleanName(menuNameInput.value);
    const character = characterFor(selectedCharacter);
    identity.name = name;
    identity.character = character.id;
    player.speed = character.speed;
    player.jumpStrength = character.jumpStrength;
    remember(STORAGE_NAME, name);
    remember(STORAGE_CHARACTER, identity.character);

    if (net) {
      if (!hasJoined) {
        hasJoined = true;
        net.join(name, identity.character);
      } else {
        net.rename(name, identity.character);
      }
    }
    panelDirty = true;
    renderPanel();
  }

  function beginGame() {
    applyMenuSelection();
    hideMenu();
    playing = true;
    keys.clear();
    panelDirty = true;
    audio.sequence([
      ["uiConfirm", 0],
      ["uiSelect", 140, { pitch: 1.25, volume: 0.6 }],
      ["uiSelect", 260, { pitch: 1.5, volume: 0.6 }],
    ]);
  }

  function resumeGame() {
    if (menuMode !== "pause") return;
    syncMenuFromIdentity();
    hideMenu();
    playing = true;
    keys.clear();
    panelDirty = true;
    sfx("uiBack");
  }

  function returnToTitle() {
    playing = false;
    if (net) net.close();
    net = null;
    others.clear();
    myId = null;
    hasJoined = false;
    player.x = SPAWN_X;
    player.feet = 0;
    syncPlayerY();
    player.velocityX = 0;
    player.velocityY = 0;
    player.knockback = 0;
    player.grounded = true;
    currentBiome = null;
    player.attackTime = 0;
    player.attackSerial = 0;
    player.shotTimer = -1;
    player.hp = MAX_HP;
    player.invulnerable = 0;
    player.hurtTime = 0;
    player.flashTime = 0;
    player.deadTime = 0;
    player.timeSinceDamage = 99;
    player.regenAnnounced = true;
    projectiles.length = 0;
    fx.clear();
    grass.clear();
    camX = 0;
    sfx("uiPause");
    connect();
    openMenu("start");
    panelDirty = true;
  }

  menuForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (menuMode === "pause") {
      applyMenuSelection();
      hideMenu();
      playing = true;
      keys.clear();
      panelDirty = true;
      sfx("uiConfirm", { volume: 0.8 });
    } else {
      beginGame();
    }
  });

  menuClose.addEventListener("click", resumeGame);
  menuHome.addEventListener("click", returnToTitle);
  playersRename.addEventListener("click", () => {
    sfx("uiPause");
    openMenu("pause");
  });
  menuNameInput.addEventListener("input", () => sfx("uiType", { volume: 0.8 }));
  if (menuServerCopy) menuServerCopy.addEventListener("click", copyServerAddress);
  [menuClose, menuHome, playersRename, menuForm.querySelector(".menu-primary")].forEach((button) => {
    if (button) button.addEventListener("pointerenter", () => sfx("uiHover", { volume: 0.5 }));
  });
  if (soundToggle) soundToggle.addEventListener("click", toggleMute);
  if (menuMute) menuMute.addEventListener("click", toggleMute);
  if (menuVolume) {
    menuVolume.addEventListener("input", () => {
      audio.unlock();
      audio.setVolume(Number(menuVolume.value) / 100);
      menuVolume.style.setProperty("--volume", Math.round(audio.volume * 100) + "%");
      if (menuVolumeValue) menuVolumeValue.textContent = Math.round(audio.volume * 100) + " %";
    });
    menuVolume.addEventListener("change", () => sfx("uiSelect", { volume: 0.7 }));
  }

  // ───────────────────────────── Réseau ─────────────────────────────
  function handleNetworkMessage(message) {
    switch (message.t) {
      case "welcome": {
        // Nouvelle connexion (ou nouveau serveur) : on repart d'une liste
        // propre, le serveur nous renvoie ceux qui sont déjà là.
        others.clear();
        myId = message.id;
        (message.players || []).forEach(addPeer);
        panelDirty = true;
        break;
      }
      case "join": {
        const isNew = addPeer(message.player);
        if (isNew && message.player) {
          const peer = others.get(message.player.id);
          toast((peer ? peer.name : "Quelqu'un") + " a rejoint la partie", true);
          sfx("playerJoin");
        }
        panelDirty = true;
        break;
      }
      case "leave": {
        const peer = others.get(message.id);
        if (peer) {
          others.delete(message.id);
          toast(peer.name + " a quitté la partie", true);
          sfx("playerLeave");
          panelDirty = true;
        }
        break;
      }
      case "renamed": {
        const peer = others.get(message.id);
        if (peer && message.player) {
          peer.name = cleanName(message.player.name);
          peer.character = cleanCharacter(message.player.character);
          panelDirty = true;
        }
        break;
      }
      case "snapshot": {
        (message.p || []).forEach(updatePeerState);
        break;
      }
      case "disconnected": {
        others.clear();
        toast("Connexion perdue", true);
        sfx("connectionLost");
        panelDirty = true;
        break;
      }
      case "reset": {
        // On vise un autre serveur : les joueurs de l'ancienne partie
        // disparaissent, ceux du nouveau arriveront avec le « welcome ».
        others.clear();
        panelDirty = true;
        break;
      }
      default:
        break;
    }
  }

  function addPeer(data) {
    if (!data || !data.id || data.id === myId) return false;
    const existing = others.get(data.id);
    if (existing) {
      existing.name = cleanName(data.name);
      existing.character = cleanCharacter(data.character || data.c || existing.character);
      return false;
    }
    others.set(data.id, {
      id: data.id,
      name: cleanName(data.name),
      character: cleanCharacter(data.character || data.c),
      hp: MAX_HP,
      hpKnown: false,
      dead: false,
      x: player.x,
      gap: 0,
      f: 1,
      vx: 0,
      vy: 0,
      g: true,
      a: 0,
      attackSerial: 0,
      meleeSerial: 0,
      meleeHits: null,
      shotTimer: -1,
      shotStyle: null,
      rx: player.x,
      ry: groundAt(centerOf(player.x)) - player.height,
      animTime: 0,
      hurtTime: 0,
      flashTime: 0,
      stepTimer: 0,
      lastHitByUsAt: -99,
      seen: performance.now(),
    });
    return true;
  }

  function updatePeerState(state) {
    if (!state || !state.id || state.id === myId) return;
    let peer = others.get(state.id);
    if (!peer) {
      addPeer(state);
      peer = others.get(state.id);
      if (!peer) return;
      // Première position connue : on place le joueur directement dessus.
      peer.rx = clamp(Number(state.x) || 0, 0, WORLD_WIDTH - player.width);
      peer.ry = groundAt(centerOf(peer.rx)) - player.height - (Number(state.gap) || 0);
    }
    const wasGrounded = peer.g;
    peer.x = clamp(Number(state.x) || 0, 0, WORLD_WIDTH - player.width);
    // gap négatif : le joueur distant a creusé sous la surface.
    peer.gap = clamp(Number(state.gap) || 0, -TERRAIN_DEPTH, 4000);
    peer.f = Number(state.f) >= 0 ? 1 : -1;
    peer.vx = Number(state.vx) || 0;
    peer.vy = Number(state.vy) || 0;
    peer.g = Boolean(state.g);
    const nextCharacter = cleanCharacter(state.c || state.character || peer.character);
    if (nextCharacter !== peer.character) {
      peer.character = nextCharacter;
      panelDirty = true;
    }
    if (state.name && cleanName(state.name) !== peer.name) {
      peer.name = cleanName(state.name);
      panelDirty = true;
    }

    // Saut et atterrissage des autres joueurs : son spatialisé + poussière.
    const center = peerCenter(peer);
    if (peer.hpKnown && !peer.dead) {
      if (wasGrounded && !peer.g && peer.vy < -100) sfxAt("jump", center.x, { volume: 0.5 });
      if (!wasGrounded && peer.g) {
        sfxAt("land", center.x, { volume: 0.6 });
        fx.dust(center.x, groundY + Math.max(0, -peer.gap), { count: 5 });
      }
    }

    const nextHp = Number(state.hp);
    if (Number.isFinite(nextHp)) {
      const hp = clamp(nextHp, 0, MAX_HP);
      if (hp !== peer.hp) {
        if (peer.hpKnown && hp < peer.hp && !peer.dead) onPeerDamaged(peer, peer.hp - hp);
        peer.hp = hp;
        panelDirty = true;
      }
      peer.hpKnown = true;
    }

    // Séquence de K.O. du joueur distant, puis réapparition.
    const dead = Boolean(state.d);
    if (dead !== peer.dead) {
      peer.dead = dead;
      if (dead) onPeerKnockedOut(peer);
      else onPeerRespawned(peer);
      panelDirty = true;
    }

    // Le compteur évite de rejouer les effets d'attaque reçus dans chaque snapshot.
    const attackSerial = Math.max(0, Math.floor(Number(state.n) || 0));
    if (attackSerial > peer.attackSerial) {
      peer.attackSerial = attackSerial;
      onPeerAttack(peer);
    }
    // Une attaque relancée prend le pas sur celle en cours.
    peer.a = Math.max(peer.a, Number(state.a) || 0);
    peer.seen = performance.now();
  }

  function onPeerDamaged(peer, amount) {
    const center = peerCenter(peer);
    peer.hurtTime = HURT_DURATION;
    peer.flashTime = FLASH_DURATION;
    fx.text(center.x, peer.ry - 6, "-" + Math.round(amount), {
      color: amount >= 20 ? "#ffb347" : "#ffffff",
      size: amount >= 20 ? 19 : 15,
    });
    // Si c'est nous qui venons de le toucher, petite secousse de confirmation.
    if (performance.now() - peer.lastHitByUsAt < 400) fx.shake(2.5, 0.12);
  }

  function onPeerKnockedOut(peer) {
    const center = peerCenter(peer);
    const color = accentFor(peer.character);
    fx.knockout(center.x, center.y, color);
    fx.text(center.x, peer.ry - 18, "K.O. !", { color: "#ffd166", size: 22, vy: -40, duration: 1.2 });
    sfxAt("ko", center.x, { volume: 0.8 });
    sfxAt("koBoom", center.x, { volume: 0.7 });
    const onScreen = Math.abs(center.x - (camX + width / 2)) < width;
    if (onScreen) fx.shake(6, 0.35);
    if (performance.now() - peer.lastHitByUsAt < 1500) {
      const me = playerCenter();
      fx.text(me.x, player.y - 30, "K.O. sur " + peer.name + " !", { color: "#ffe08a", size: 18, vy: -45, duration: 1.4 });
      audio.sequence([["koEnemy", 150, { important: true }]]);
      toast("Tu as mis " + peer.name + " K.O. !", true);
    }
    peer.a = 0;
  }

  function onPeerRespawned(peer) {
    // Le joueur réapparaît au camp : on saute directement à sa position.
    peer.rx = peer.x;
    peer.ry = groundAt(centerOf(peer.rx)) - player.height - peer.gap;
    const center = peerCenter(peer);
    fx.respawn(center.x, peer.ry + player.height, accentFor(peer.character));
    sfxAt("respawn", center.x, { volume: 0.6 });
  }

  function onPeerAttack(peer) {
    const character = characterFor(peer.character);
    const center = peerCenter(peer);
    if (character.windupSound) sfxAt(character.windupSound, center.x, { volume: 0.7 });
    if (character.attackStyle === "slash") {
      const step = comboStep(peer.attackSerial);
      sfxAt(step === 2 ? "slashHeavy" : "slash", center.x);
      sfxAt("slashRing", center.x, { volume: 0.5, pitch: 1 + step * 0.08 });
      return;
    }
    peer.shotTimer = character.projectileDelay || 0;
    peer.shotStyle = character.attackStyle;
  }

  function connect() {
    net = window.PixWorldNet.connect({
      name: identity.name,
      character: identity.character,
      onEvent: handleNetworkMessage,
      onMode: applyMode,
    });
    playersPanel.hidden = false;
    renderPanel();
    refreshServerShare();
  }

  // ─────────────────────────── Herbe interactive ───────────────────────────
  /** Personnages qui peuvent plier l'herbe : le joueur local et les autres. */
  function grassWalkers() {
    const walkers = [];
    if (playing && player.deadTime === 0) {
      walkers.push({
        id: "self",
        x: player.x,
        width: player.width,
        vx: player.velocityX,
        gap: groundAt(centerOf(player.x)) - (player.y + player.height),
      });
    }
    others.forEach((peer) => {
      if (!peer.dead) walkers.push({ id: peer.id, x: peer.rx, width: player.width, vx: peer.vx, gap: peer.gap });
    });
    // L'herbe ne se trouve que dans la prairie : ailleurs, personne ne la plie.
    return walkers.filter((walker) => world.biomeAt(centerOf(walker.x)).id === "prairie");
  }

  /**
   * Froissement d'une touffe : centré pour nous, spatialisé pour les autres.
   * Calé sur un pas d'herbe (environ 0,8 × 0,5 de la banque) : il accompagne la
   * marche sans la couvrir.
   */
  function handleGrassRustle(event) {
    const volume = 0.15 + 0.2 * event.strength;
    if (event.walkerId === "self") sfx("grassRustle", { volume });
    else sfxAt("grassRustle", event.x, { volume: volume * 0.9 });
  }

  /** Quelques brins projetés dans le sens de la marche, parfois seulement. */
  function handleGrassBlades(event) {
    fx.blades(event.x, groundAt(event.x) - 24, { count: 2 + Math.floor(Math.random() * 3), direction: event.dir });
  }

  // ─────────────────────────── Minage et inventaire ───────────────────────────
  /** Case de bloc survolée par la souris (null hors du jeu, hors du terrain ou dans l'air). */
  function hoveredCell() {
    if (!playing || !mouse.inside || player.deadTime > 0) return null;
    const cell = terrain.cellAt(mouse.x + camX, mouse.y - groundY);
    return terrain.typeAt(cell.col, cell.row) ? cell : null;
  }

  /** Minage : la case visée, le clic maintenu et la portée du héros. */
  function updateMining(delta) {
    const alive = playing && player.deadTime === 0;
    miner.setHover(hoveredCell());
    miner.setHolding(mouse.down && alive);
    const state = miner.update(delta, {
      x: player.x + player.width / 2,
      y: player.feet - player.height / 2,
      enabled: alive,
    });
    // Sans direction tenue au clavier, le héros se tourne vers le bloc qu'il mine.
    if (miner.holding && state.col !== null && !isLeftPressed() && !isRightPressed()) {
      const dx = (state.col + 0.5) * BLOCK - (player.x + player.width / 2);
      if (Math.abs(dx) > 6) player.facing = dx > 0 ? 1 : -1;
    }
  }

  /** Objets lâchés : physique, puis ramassage au contact (si l'inventaire peut les accueillir). */
  function updateDrops(delta) {
    const alive = playing && player.deadTime === 0;
    drops.update(delta, alive ? playerBox() : null);
    if (!alive) return;
    let refused = false;
    const taken = drops.collect(playerBox(), (type) => {
      const left = inventory.add(type, 1);
      if (left > 0) refused = true;
      return left === 0;
    });
    if (taken.length) {
      const counts = {};
      taken.forEach((type) => {
        counts[type] = (counts[type] || 0) + 1;
      });
      const me = playerCenter();
      Object.keys(counts).forEach((type, index) => {
        const name = window.PixWorldHotbar.NAMES[type] || type;
        fx.text(me.x, player.y - 14 - index * 16, "+" + counts[type] + " " + name, { color: "#fff6dc", size: 13, duration: 1.1 });
      });
      sfx("itemPickup", { volume: 0.7 });
      hotbar.render(inventory);
    }
    if (refused && performance.now() - lastFullNotice > 2500) {
      lastFullNotice = performance.now();
      toast("Inventaire plein", true);
      sfx("uiError", { volume: 0.5 });
    }
  }

  /** Change d'emplacement : molette, touches 1 à 9 ou clic sur la barre. */
  function selectSlot(index) {
    const before = inventory.selected;
    inventory.select(index);
    hotbar.render(inventory);
    hotbar.showName(inventory);
    if (inventory.selected !== before) sfx("uiHover", { volume: 0.5 });
  }

  /** Un bloc vient de se briser : il laisse son objet, des éclats et un bruit sec. */
  function handleBlockBroken(event) {
    const cx = (event.col + 0.5) * BLOCK;
    const cy = (event.row + 0.5) * BLOCK;
    drops.spawn(event.type, cx, cy);
    fx.burst(cx, groundY + cy, {
      count: 14,
      colors: BLOCK_COLORS[event.type] || BLOCK_COLORS.dirt,
      minSize: 2,
      maxSize: 4.5,
      minSpeed: 70,
      maxSpeed: 230,
      lift: 90,
      gravity: 700,
    });
    sfxAt("blockBreak", cx, { volume: 0.9 });
    fx.shake(1.5, 0.08);
  }

  /** Coup de pioche pendant le minage : bruit de la matière et quelques éclats. */
  function handleBlockHit(event) {
    const cx = (event.col + 0.5) * BLOCK;
    const cy = (event.row + 0.5) * BLOCK;
    sfxAt("step", cx, { material: STEP_OF_BLOCK[event.type] || "dirt", volume: 0.5, pitch: 1.4 });
    fx.burst(cx, groundY + cy, {
      count: 3,
      colors: BLOCK_COLORS[event.type] || BLOCK_COLORS.dirt,
      minSize: 1.5,
      maxSize: 3,
      minSpeed: 40,
      maxSpeed: 120,
      lift: 40,
      gravity: 500,
    });
  }

  /** Contour de la case visée (rouge si hors de portée ou incassable) et fissures pendant le minage. */
  function drawMiningTarget() {
    const state = miner.state;
    if (state.col === null) return;
    const valid = state.inReach && state.breakable;
    const target = { col: state.col, row: state.row, camX, top: groundY };
    blockView.drawOutline(ctx, Object.assign({ valid }, target));
    if (valid) blockView.drawCrack(ctx, Object.assign({ progress: state.progress }, target));
  }

  /** Met à jour la position de la souris dans le canevas, et si elle survole le jeu (pas la barre ni les menus). */
  function updateMouse(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    mouse.inside = event.target === canvas;
  }

  // ─────────────────────────── Boucle de jeu ───────────────────────────
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    groundY = surfaceY(height);
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);
    // La profondeur des pieds ne change pas : le héros reste dans son trou ou sur le sol.
    syncPlayerY();
    draw();
  }

  function isLeftPressed() {
    return (
      keys.has("KeyQ") ||
      keys.has("KeyA") ||
      keys.has("q") ||
      keys.has("a") ||
      keys.has("ArrowLeft")
    );
  }

  function isRightPressed() {
    return keys.has("KeyD") || keys.has("d") || keys.has("ArrowRight");
  }

  // ──────────────────────── Barre de vie / dégâts ────────────────────────

  /** Index de la coupe dans l'enchaînement de Raiden (0, 1, 2), partagé via le compteur d'attaque. */
  function comboStep(serial) {
    return Math.max(0, serial - 1) % 3;
  }

  function slashDamage(character, serial) {
    return character.attackDamage + (comboStep(serial) === 2 ? COMBO_FINISHER_BONUS : 0);
  }

  /**
   * Enlève des points de vie au joueur local.
   * source : { x, facing, style, color } décrit le coup pour le recul et les effets.
   */
  function applyDamage(amount, source) {
    if (!playing || player.invulnerable > 0 || player.deadTime > 0) return;
    const character = characterFor(identity.character);
    player.hp = Math.max(0, player.hp - amount);
    player.timeSinceDamage = 0;
    player.regenAnnounced = false;
    player.hurtTime = HURT_DURATION;
    player.flashTime = FLASH_DURATION;
    panelDirty = true;

    const me = playerCenter();
    const style = source ? source.style : "shuriken";
    const color = source ? source.color : "#ffffff";
    const direction = source ? (source.facing != null ? source.facing : Math.sign(me.x - source.x) || 1) : 1;
    const strength = source && source.knockback != null ? source.knockback : 200;
    player.knockback = direction * strength;
    if (player.grounded && strength >= 300) {
      player.velocityY = -220;
      player.grounded = false;
    }

    fx.impact(me.x - direction * 10, me.y - 4, style, color, direction);
    fx.text(me.x, player.y - 8, "-" + Math.round(amount), { color: "#ff6b6b", size: amount >= 20 ? 20 : 16 });
    fx.flash({ color: "#ff3b3b", alpha: Math.min(0.32, 0.1 + amount / 90), duration: 0.16 });
    fx.shake(Math.min(10, 3 + amount * 0.3), 0.26);
    sfx(player.hp > 0 && player.hp < LOW_HP ? "hurtCritical" : "hurt", { important: true });
    if (source && source.hitSound) sfx(source.hitSound, { volume: 0.8 });

    if (player.hp <= 0) startDeath(character);
  }

  function startDeath(character) {
    const me = playerCenter();
    player.hp = 0;
    player.deadTime = KO_DURATION;
    player.attackTime = 0;
    player.shotTimer = -1;
    // Le corps garde l'élan du coup fatal (recul, petit bond) et retombe.
    player.knockback *= 1.4;
    if (player.grounded) {
      player.velocityY = -260;
      player.grounded = false;
    }
    fx.knockout(me.x, me.y, character.accent);
    fx.flash({ color: "#ffffff", alpha: 0.5, duration: 0.25 });
    fx.shake(14, 0.5);
    fx.text(me.x, player.y - 24, "K.O. !", { color: "#ffd166", size: 24, vy: -40, duration: 1.3 });
    sfx("ko", { important: true });
    sfx("koBoom", { important: true });
    toast("Tu as été mis K.O. · réapparition au camp de départ", true);
    panelDirty = true;
  }

  function respawn() {
    const character = characterFor(identity.character);
    player.hp = MAX_HP;
    player.deadTime = 0;
    player.x = SPAWN_X;
    player.feet = 0;
    syncPlayerY();
    player.velocityX = 0;
    player.velocityY = 0;
    player.knockback = 0;
    player.grounded = true;
    player.hurtTime = 0;
    player.invulnerable = RESPAWN_INVULNERABILITY;
    player.timeSinceDamage = 0;
    player.regenAnnounced = true;
    camX = clamp(player.x + player.width / 2 - width / 2, 0, Math.max(0, WORLD_WIDTH - width));
    const me = playerCenter();
    fx.respawn(me.x, player.y + player.height, character.accent);
    fx.flash({ color: character.accent, alpha: 0.18, duration: 0.3 });
    sfx("respawn", { important: true });
    panelDirty = true;
  }

  function hitsLocalPlayer(x, y, margin) {
    const m = margin == null ? 8 : margin;
    return (
      x > player.x - m &&
      x < player.x + player.width + m &&
      y > player.y - m &&
      y < player.y + player.height + m
    );
  }

  function hitsPeer(peer, x, y, margin) {
    const m = margin == null ? 8 : margin;
    return (
      x > peer.rx - m &&
      x < peer.rx + player.width + m &&
      y > peer.ry - m &&
      y < peer.ry + player.height + m
    );
  }

  /** Zone frappée par une coupe : devant l'attaquant, sur toute sa hauteur. */
  function inSlashReach(attackerX, attackerY, facing, serial, targetX, targetY) {
    const reach = comboStep(serial) === 2 ? 128 : 112;
    const dx = (targetX - attackerX) * facing;
    const dy = Math.abs(targetY - attackerY);
    return dx > -28 && dx < reach && dy < 82;
  }

  function slashWindow(character, timeLeft) {
    const progress = 1 - Math.min(timeLeft, character.attackDuration) / character.attackDuration;
    return progress >= 0.12 && progress <= 0.78;
  }

  /** Cibles déjà touchées par la coupe en cours d'un attaquant (une touche par cible et par coup). */
  function meleeTargets(attacker, serial) {
    if (attacker.meleeSerial !== serial) {
      attacker.meleeSerial = serial;
      attacker.meleeHits = new Set();
    }
    return attacker.meleeHits;
  }

  /** Les coups de mêlée des autres (arc de coupe) peuvent nous atteindre, et toucher d'autres joueurs. */
  function checkMeleeHits() {
    others.forEach((peer) => {
      const character = characterFor(peer.character);
      if (character.attackStyle !== "slash" || peer.a <= 0 || peer.dead) return;
      if (!slashWindow(character, peer.a)) return;
      const hits = meleeTargets(peer, peer.attackSerial);
      const attacker = peerCenter(peer);
      const me = playerCenter();
      if (!hits.has("self") && inSlashReach(attacker.x, attacker.y, peer.f, peer.attackSerial, me.x, me.y)) {
        hits.add("self");
        applyDamage(slashDamage(character, peer.attackSerial), {
          x: attacker.x,
          facing: peer.f,
          style: "slash",
          color: character.accent,
          knockback: character.knockback,
          hitSound: character.hitSound,
        });
      }
      // Coup porté à un autre joueur : on montre l'impact, lui fera ses comptes.
      others.forEach((target) => {
        if (target === peer || target.dead || hits.has(target.id)) return;
        const victim = peerCenter(target);
        if (inSlashReach(attacker.x, attacker.y, peer.f, peer.attackSerial, victim.x, victim.y)) {
          hits.add(target.id);
          fx.impact(victim.x, victim.y - 4, "slash", character.accent, peer.f);
          sfxAt(character.hitSound, victim.x, { volume: 0.7 });
        }
      });
    });

    // Notre propre coupe : impact visuel immédiat sur les joueurs à portée.
    const mine = characterFor(identity.character);
    if (mine.attackStyle === "slash" && player.attackTime > 0 && player.deadTime === 0 && slashWindow(mine, player.attackTime)) {
      const hits = meleeTargets(player, player.attackSerial);
      const me = playerCenter();
      others.forEach((target) => {
        if (target.dead || hits.has(target.id)) return;
        const victim = peerCenter(target);
        if (inSlashReach(me.x, me.y, player.facing, player.attackSerial, victim.x, victim.y)) {
          hits.add(target.id);
          target.lastHitByUsAt = performance.now();
          fx.impact(victim.x, victim.y - 4, "slash", mine.accent, player.facing);
          fx.shake(3, 0.14);
          sfx(mine.hitSound);
          sfx("impactSpark", { volume: 0.6 });
        }
      });
    }
  }

  function update(delta) {
    if (playing) {
      player.animationTime += delta;
      player.attackTime = Math.max(0, player.attackTime - delta);
      player.landingTime = Math.max(0, player.landingTime - delta);
      player.hurtTime = Math.max(0, player.hurtTime - delta);
      player.flashTime = Math.max(0, player.flashTime - delta);
      if (player.invulnerable > 0) {
        player.invulnerable = Math.max(0, player.invulnerable - delta);
        if (player.invulnerable === 0) sfx("shieldOff", { volume: 0.6 });
      }
      player.timeSinceDamage += delta;

      if (player.deadTime > 0) {
        player.deadTime = Math.max(0, player.deadTime - delta);
        updateDeadBody(delta);
        if (player.deadTime === 0) respawn();
      } else {
        updateLocalCombatTimers(delta);
        updateLocalMovement(delta);
      }
    }

    updateOthers(delta);
    grass.update(delta, grassWalkers());
    updateMining(delta);
    updateDrops(delta);
    scenery.updateAmbient(delta, width, height, world.biomeAt(camX + width / 2).id);
    updateProjectiles(delta);
    checkMeleeHits();
    fx.update(delta);

    // Vignette rouge et battements quand la vie est basse.
    const lowRatio = player.deadTime > 0 ? 0 : clamp(1 - player.hp / LOW_HP, 0, 1);
    fx.setVignette(playing ? lowRatio : 0);
    if (playing && lowRatio > 0 && player.deadTime === 0) {
      player.heartbeatTimer -= delta;
      if (player.heartbeatTimer <= 0) {
        player.heartbeatTimer = 1.05 - lowRatio * 0.35;
        audio.sequence([
          ["heartbeat", 0, { volume: 0.5 + lowRatio * 0.5 }],
          ["heartbeat", 150, { volume: 0.35 + lowRatio * 0.4, pitch: 0.9 }],
        ]);
      }
    } else {
      player.heartbeatTimer = 0;
    }

    // La barre de vie du panneau suit les régénérations et les dégâts.
    const hpShown = Math.round(player.hp);
    if (hpShown !== lastPanelHp) {
      lastPanelHp = hpShown;
      panelDirty = true;
    }

    audio.setListener(camX + width / 2, width / 2);

    // On garde le joueur annoncé pendant une pause, avec sa position gelée.
    sendTimer += delta;
    if (net && hasJoined && sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      net.sendState({
        x: Math.round(player.x),
        gap: Math.round(groundAt(centerOf(player.x)) - (player.y + player.height)),
        f: player.facing,
        vx: Math.round(player.velocityX),
        vy: Math.round(player.velocityY),
        g: player.grounded,
        a: Number(player.attackTime.toFixed(2)),
        c: identity.character,
        n: player.attackSerial,
        hp: Math.round(player.hp),
        d: player.deadTime > 0,
      });
    }
  }

  function updateLocalCombatTimers(delta) {
    const character = characterFor(identity.character);

    // Régénération : annonce et étincelles quand elle démarre.
    if (player.timeSinceDamage >= REGEN_DELAY && player.hp < MAX_HP) {
      if (!player.regenAnnounced) {
        player.regenAnnounced = true;
        const me = playerCenter();
        fx.heal(me.x, player.y);
        sfx("regen", { volume: 0.7 });
      }
      player.hp = Math.min(MAX_HP, player.hp + REGEN_RATE * delta);
    }

    // Projectile différé : le shuriken part après le geste, la flèche à la
    // décoche, l'orbe à la fin de l'incantation.
    if (player.shotTimer >= 0) {
      player.shotTimer -= delta;
      if (player.shotTimer <= 0) {
        player.shotTimer = -1;
        const origin = projectileOrigin(player.x, player.y, player.facing);
        spawnProjectile(character, origin.x, origin.y, player.facing, character.accent, "self");
        fx.muzzle(origin.x, origin.y, character.attackStyle, character.accent, player.facing);
        if (character.attackSound) sfx(character.attackSound);
        if (character.attackStyle === "arrow") sfx("arrowSwish", { volume: 0.6 });
        if (character.attackStyle === "shuriken") sfx("shurikenRing", { volume: 0.5 });
      }
    }

    // Étincelles le long de la coupe pendant la fenêtre active.
    if (character.attackStyle === "slash" && player.attackTime > 0 && slashWindow(character, player.attackTime)) {
      emitSlashSparks(playerCenter(), player.facing, character.accent, delta);
    }
  }

  /** Pendant le K.O. : plus de contrôle, mais le recul s'amortit et la gravité s'applique. */
  function updateDeadBody(delta) {
    player.knockback *= Math.max(0, 1 - delta * 6);
    if (Math.abs(player.knockback) < 4) player.knockback = 0;
    player.velocityX = player.knockback;
    if (moveBody(player.velocityX * delta, 0).hitX) player.knockback = 0;
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);
    if (!player.grounded) {
      player.velocityY += GRAVITY * delta;
      const fall = moveBody(0, player.velocityY * delta);
      if (fall.landed) {
        player.velocityY = 0;
        player.grounded = true;
        fx.dust(centerOf(player.x), groundY + player.feet, { count: 8 });
        sfx("land", { volume: 0.6, pitch: 0.85 });
      } else if (fall.hitY) {
        player.velocityY = 0;
      }
    } else if (!terrain.isSupported(playerBox())) {
      // Le bloc sous le corps a été miné : il tombe dans le trou.
      player.grounded = false;
      player.velocityY = 0;
    }
    syncPlayerY();
  }

  function updateLocalMovement(delta) {
    const direction = Number(isRightPressed()) - Number(isLeftPressed());
    const stunned = player.hurtTime > HURT_DURATION * 0.55;
    const walk = stunned ? 0 : direction * player.speed;
    // Le recul s'ajoute à la marche puis s'amortit vite.
    player.knockback *= Math.max(0, 1 - delta * 9);
    if (Math.abs(player.knockback) < 4) player.knockback = 0;
    player.velocityX = walk + player.knockback;
    if (direction !== 0 && !stunned) player.facing = direction;
    // Contre le terrain : un bloc arrête le héros et annule son élan.
    if (moveBody(player.velocityX * delta, 0).hitX) {
      player.velocityX = 0;
      player.knockback = 0;
    }
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);

    // Caméra qui suit le joueur, bornée au monde : parallaxe du décor.
    const target = clamp(player.x + player.width / 2 - width / 2, 0, Math.max(0, WORLD_WIDTH - width));
    camX += (target - camX) * Math.min(1, delta * 10);

    const cx = centerOf(player.x);
    if (!player.grounded) {
      player.airTime += delta;
      player.velocityY += GRAVITY * delta;
      const fall = moveBody(0, player.velocityY * delta);
      if (fall.landed) {
        // Atterrissage : on se pose sur la face supérieure du bloc touché.
        const impact = player.velocityY;
        player.velocityY = 0;
        player.grounded = true;
        player.landingTime = 0.12;
        const me = playerCenter();
        const heavy = impact > 900;
        fx.dust(me.x, groundY + player.feet, { count: heavy ? 10 : 6 });
        sfx("land", { volume: heavy ? 1 : 0.7, pitch: heavy ? 0.9 : 1 });
        if (heavy) fx.shake(2, 0.1);
        player.airTime = 0;
      } else if (fall.hitY) {
        player.velocityY = 0; // plafond : la tête a heurté un bloc
      }
    } else if (!terrain.isSupported(playerBox())) {
      // Le bloc sous les pieds a été miné : le personnage tombe.
      player.grounded = false;
      player.velocityY = 0;
      player.airTime = 0;
    }
    syncPlayerY();

    if (player.grounded && Math.abs(walk) > 0.5) {
      // Bruits de pas réguliers et petits nuages de poussière.
      player.stepTimer -= delta;
      if (player.stepTimer <= 0) {
        player.stepTimer = 0.24;
        player.stepCount++;
        // Les pas sont générés en code : une variante différente à chaque fois.
        sfx("step", { volume: 0.8, material: materialUnder(cx, player.feet) });
        if (player.stepCount % 2 === 0) {
          fx.dust(cx - player.facing * 10, groundY + player.feet, { count: 2, direction: player.facing });
        }
      }
    } else if (player.grounded) {
      player.stepTimer = 0.05;
    }

    // Annonce quand on entre dans un nouveau biome.
    const biome = world.biomeAt(cx);
    if (currentBiome === null) {
      currentBiome = biome.id;
    } else if (currentBiome !== biome.id) {
      currentBiome = biome.id;
      toast(biome.name + " · " + biome.blurb, false);
    }
  }

  /** Interpole les joueurs distants pour lisser les 20 messages/seconde. */
  function updateOthers(delta) {
    others.forEach((peer) => {
      peer.animTime += delta;
      peer.a = Math.max(0, peer.a - delta);
      peer.hurtTime = Math.max(0, peer.hurtTime - delta);
      peer.flashTime = Math.max(0, peer.flashTime - delta);
      peer.rx += (peer.x - peer.rx) * Math.min(1, delta * 14);
      const targetY = groundAt(centerOf(peer.x)) - player.height - peer.gap;
      peer.ry += (targetY - peer.ry) * Math.min(1, delta * 14);

      const character = characterFor(peer.character);
      const center = peerCenter(peer);

      // Projectile différé des autres joueurs (même délai que chez eux).
      if (peer.shotTimer >= 0) {
        peer.shotTimer -= delta;
        if (peer.shotTimer <= 0) {
          peer.shotTimer = -1;
          if (!peer.dead) {
            const origin = projectileOrigin(peer.rx, peer.ry, peer.f);
            spawnProjectile(character, origin.x, origin.y, peer.f, character.accent, peer.id);
            fx.muzzle(origin.x, origin.y, character.attackStyle, character.accent, peer.f);
            if (character.attackSound) sfxAt(character.attackSound, center.x);
            if (character.attackStyle === "arrow") sfxAt("arrowSwish", center.x, { volume: 0.5 });
          }
        }
      }

      if (character.attackStyle === "slash" && peer.a > 0 && !peer.dead && slashWindow(character, peer.a)) {
        emitSlashSparks(center, peer.f, character.accent, delta);
      }

      // Pas des autres joueurs, discrets et spatialisés.
      if (peer.g && !peer.dead && Math.abs(peer.vx) > 0.5) {
        peer.stepTimer -= delta;
        if (peer.stepTimer <= 0) {
          peer.stepTimer = 0.24;
          sfxAt("step", center.x, { volume: 0.5, material: materialUnder(center.x, -peer.gap) });
        }
      }
    });
  }

  function emitSlashSparks(center, facing, color, delta) {
    // Environ 60 étincelles par seconde, indépendamment du framerate.
    if (Math.random() > delta * 60) return;
    const angle = (Math.random() - 0.5) * 1.6;
    const radius = 40 + Math.random() * 18;
    fx.sparks(center.x + facing * Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, {
      count: 1,
      direction: facing,
      color,
      spread: 1.2,
      minSpeed: 120,
      maxSpeed: 320,
    });
  }

  function projectileOrigin(x, y, facing) {
    return { x: x + player.width / 2 + facing * 18, y: y + player.height * 0.46 };
  }

  function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      projectile.x += projectile.speed * projectile.facing * delta;
      projectile.age += delta;
      projectile.life -= delta;

      // Traînée : quelques particules par image selon le style.
      projectile.trailTimer -= delta;
      if (projectile.trailTimer <= 0) {
        projectile.trailTimer = projectile.style === "orb" ? 0.03 : 0.022;
        fx.trail(projectile.x, projectile.y, projectile.style, projectile.color, projectile.facing);
      }

      let remove = false;
      // Chaque client ne blesse que lui-même : la victime fait ses comptes.
      if (projectile.owner !== "self" && player.deadTime === 0 && hitsLocalPlayer(projectile.x, projectile.y)) {
        applyDamage(projectile.damage, {
          x: projectile.x,
          facing: projectile.facing,
          style: projectile.style,
          color: projectile.color,
          knockback: projectile.knockback,
          hitSound: projectile.hitSound,
        });
        remove = true;
      }
      if (!remove) {
        // Impact visuel sur les autres joueurs (leurs dégâts arrivent par le réseau).
        others.forEach((peer) => {
          if (remove || peer.dead || peer.id === projectile.owner) return;
          if (hitsPeer(peer, projectile.x, projectile.y)) {
            remove = true;
            const center = peerCenter(peer);
            fx.impact(projectile.x, projectile.y, projectile.style, projectile.color, projectile.facing);
            if (projectile.owner === "self") {
              peer.lastHitByUsAt = performance.now();
              fx.shake(2, 0.1);
              sfx(projectile.hitSound);
              sfx("impactSpark", { volume: 0.5 });
            } else {
              sfxAt(projectile.hitSound, center.x, { volume: 0.7 });
            }
          }
        });
      }
      if (!remove && (projectile.life <= 0 || projectile.x < -80 || projectile.x > WORLD_WIDTH + 80)) {
        remove = true;
        if (projectile.life <= 0) {
          fx.burst(projectile.x, projectile.y, { count: 5, colors: ["#ffffff", projectile.color], minSize: 1.5, maxSize: 3, maxSpeed: 90, gravity: 200 });
          sfxAt("fizzle", projectile.x, { volume: 0.5 });
        }
      }
      if (remove) projectiles.splice(i, 1);
    }
  }

  function getSpriteFrame() {
    const character = characterFor(identity.character);
    if (player.deadTime > 0) return DEAD_FRAME;
    if (player.hurtTime > 0) return HURT_FRAME;
    if (player.attackTime > 0) {
      const elapsed = character.attackDuration - player.attackTime;
      const frame = Math.min(3, Math.floor(elapsed / (character.attackDuration / 4)));
      return { column: 3, row: frame };
    }

    if (!player.grounded) {
      return { column: 2, row: player.velocityY < 0 ? 0 : 1 };
    }

    if (player.landingTime > 0) {
      return { column: 2, row: 2 };
    }

    if (Math.abs(player.velocityX) > 0.5) {
      return { column: 1, row: Math.floor(player.animationTime * 10) % 4 };
    }

    return { column: 0, row: Math.floor(player.animationTime * 5) % 4 };
  }

  /** Même logique d'animation que le joueur local, à partir de son état. */
  function getRemoteFrame(peer) {
    const character = characterFor(peer.character);
    if (peer.dead) return DEAD_FRAME;
    if (peer.hurtTime > 0) return HURT_FRAME;
    if (peer.a > 0) {
      const elapsed = character.attackDuration - Math.min(peer.a, character.attackDuration);
      return { column: 3, row: Math.min(3, Math.floor(elapsed / (character.attackDuration / 4))) };
    }
    if (!peer.g) return { column: 2, row: peer.vy < 0 ? 0 : 1 };
    if (Math.abs(peer.vx) > 0.5) return { column: 1, row: Math.floor(peer.animTime * 10) % 4 };
    return { column: 0, row: Math.floor(peer.animTime * 5) % 4 };
  }

  function startAttack() {
    if (!playing || player.attackTime > 0 || player.deadTime > 0) return;
    if (player.hurtTime > HURT_DURATION * 0.55) return;
    const character = characterFor(identity.character);
    player.attackTime = character.attackDuration;
    player.attackSerial += 1;
    if (character.windupSound) sfx(character.windupSound, { volume: 0.8 });
    if (character.attackStyle === "slash") {
      const step = comboStep(player.attackSerial);
      sfx(step === 2 ? "slashHeavy" : "slash");
      sfx("slashRing", { volume: 0.55, pitch: 1 + step * 0.08 });
      if (step === 2) fx.shake(1.5, 0.1);
      return;
    }
    player.shotTimer = character.projectileDelay || 0;
  }

  function spawnProjectile(character, x, y, facing, color, owner) {
    projectiles.push({
      style: character.attackStyle,
      x,
      y,
      facing,
      speed: character.projectileSpeed,
      age: 0,
      life: character.projectileLife,
      initialLife: character.projectileLife,
      color,
      owner,
      damage: character.attackDamage,
      knockback: character.knockback,
      hitSound: character.hitSound,
      trailTimer: 0,
    });
    if (projectiles.length > 64) projectiles.splice(0, projectiles.length - 64);
  }

  function drawPlayer() {
    const character = characterFor(identity.character);
    const { column, row } = getSpriteFrame();
    const centerX = player.x + player.width / 2 - camX;
    const drawY = player.y - spriteTopPadding;
    // Clignotement pendant l'invulnérabilité qui suit une réapparition.
    const flicker = player.invulnerable > 0 && Math.floor(player.invulnerable * 14) % 2 === 0;
    ctx.save();
    if (flicker) ctx.globalAlpha = 0.35;
    drawSprite(identity.character, column, row, player.facing, centerX, drawY, player.flashTime / FLASH_DURATION);
    ctx.restore();
    if (player.deadTime === 0) {
      drawCharacterAttack(character, player.attackTime, player.facing, centerX, player.y + player.height * 0.47, character.accent, player.attackSerial);
    }
  }

  // Silhouette blanche dessinée par-dessus le sprite pendant quelques
  // centièmes de seconde après un coup : c'est le seul « filtre » appliqué
  // aux héros, chacun garde ses vraies couleurs.
  const flashCanvas = document.createElement("canvas");
  flashCanvas.width = frameSize;
  flashCanvas.height = frameSize;
  const flashCtx = flashCanvas.getContext("2d");
  flashCtx.imageSmoothingEnabled = false;

  /** Feuille d'un héros réellement chargée, ou null. */
  function sheetFor(characterId) {
    const sheet = characterSheets[cleanCharacter(characterId)];
    return sheet && sheet.complete && sheet.naturalWidth > 0 ? sheet : null;
  }

  function drawSprite(characterId, column, row, facing, centerX, drawY, flashAlpha) {
    const sheet = sheetFor(characterId);
    if (!sheet) return;
    const sourceX = column * frameSize;
    const sourceY = row * frameSize;

    ctx.save();
    ctx.translate(Math.round(centerX), 0);
    ctx.scale(facing, 1);
    ctx.drawImage(sheet, sourceX, sourceY, frameSize, frameSize, -spriteDrawSize / 2, Math.round(drawY), spriteDrawSize, spriteDrawSize);

    if (flashAlpha > 0.02) {
      flashCtx.clearRect(0, 0, frameSize, frameSize);
      flashCtx.drawImage(sheet, sourceX, sourceY, frameSize, frameSize, 0, 0, frameSize, frameSize);
      flashCtx.globalCompositeOperation = "source-in";
      flashCtx.fillStyle = "#ffffff";
      flashCtx.fillRect(0, 0, frameSize, frameSize);
      flashCtx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = clamp(flashAlpha, 0, 1) * 0.95;
      ctx.drawImage(flashCanvas, 0, 0, frameSize, frameSize, -spriteDrawSize / 2, Math.round(drawY), spriteDrawSize, spriteDrawSize);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Effets attachés au geste d'attaque : la coupe de Raiden (trois arcs
   * différents qui s'enchaînent) et le cercle d'incantation de Yume.
   */
  function drawCharacterAttack(character, timeLeft, facing, centerX, centerY, color, serial) {
    if (timeLeft <= 0) return;
    const progress = clamp(1 - timeLeft / character.attackDuration, 0, 1);

    if (character.attackStyle === "orb") {
      const windup = character.projectileDelay / character.attackDuration;
      if (progress >= windup) return;
      const k = progress / windup;
      ctx.save();
      ctx.translate(Math.round(centerX + facing * 24), Math.round(centerY - 4));
      ctx.globalAlpha = 0.25 + 0.75 * k;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      const radius = 22 - 12 * k;
      ctx.rotate(k * 5);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = k;
      ctx.beginPath();
      ctx.arc(0, 0, 3 + 4 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (character.attackStyle !== "slash") return;
    const step = comboStep(serial);
    const p = clamp((progress - 0.06) / 0.76, 0, 1);
    const alpha = Math.sin(p * Math.PI);
    if (alpha <= 0.02) return;

    // Trois coupes : descendante, remontante, puis grand tour final.
    let start = -1.45;
    let end = 1.25;
    let innerRadius = 26;
    let outerRadius = 56;
    if (step === 1) {
      start = 1.3;
      end = -1.4;
    } else if (step === 2) {
      start = -2.35;
      end = 1.8;
      innerRadius = 30;
      outerRadius = 64;
    }
    const sweep = end - start;
    const head = start + sweep * easeOutCubic(p);
    const tailLength = sweep * (0.42 + 0.2 * (1 - p));
    const tail = head - tailLength;
    const growth = 1 + p * 0.22;

    ctx.save();
    ctx.translate(Math.round(centerX + facing * 10), Math.round(centerY));
    ctx.scale(facing, 1);
    ctx.globalAlpha = alpha;

    // Croissant lumineux : dégradé du blanc (bord) vers la couleur (intérieur).
    const gradient = ctx.createRadialGradient(0, 0, innerRadius * growth, 0, 0, outerRadius * growth);
    gradient.addColorStop(0, window.PixWorldEffects.withAlpha(color, 0));
    gradient.addColorStop(0.55, window.PixWorldEffects.withAlpha(color, 0.45));
    gradient.addColorStop(0.88, "rgba(255, 250, 235, 0.9)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    const a0 = Math.min(tail, head);
    const a1 = Math.max(tail, head);
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius * growth, a0, a1);
    ctx.arc(0, 0, innerRadius * growth, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fill();

    // Bord de lame net, puis fantômes de la position précédente (flou de mouvement).
    ctx.shadowBlur = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fff6dc";
    ctx.lineWidth = step === 2 ? 5 : 4;
    ctx.beginPath();
    ctx.arc(0, 0, (outerRadius - 4) * growth, a0, a1);
    ctx.stroke();
    for (let ghost = 1; ghost <= 2; ghost++) {
      const back = head - Math.sign(sweep) * ghost * 0.22;
      ctx.globalAlpha = alpha * (0.35 - ghost * 0.12);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, (outerRadius - 2) * growth, Math.min(back, head), Math.max(back, head));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawProjectiles() {
    projectiles.forEach((projectile) => {
      const screenX = projectile.x - camX;
      if (screenX < -70 || screenX > width + 70) return;
      const fade = clamp(projectile.life / Math.min(0.35, projectile.initialLife), 0, 1);
      ctx.save();
      ctx.translate(Math.round(screenX), Math.round(projectile.y));
      ctx.rotate(projectile.facing < 0 ? Math.PI : 0);
      ctx.globalAlpha = fade;

      if (projectile.style === "arrow") {
        // Lignes de vitesse derrière la flèche.
        ctx.globalAlpha = fade * 0.5;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-22, -5);
        ctx.lineTo(-40, -5);
        ctx.moveTo(-26, 4);
        ctx.lineTo(-48, 4);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 8;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#d9b27a";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(12, 0);
        ctx.stroke();
        ctx.fillStyle = "#eef2f7";
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(9, -4.5);
        ctx.lineTo(10, 0);
        ctx.lineTo(9, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(-19, -5);
        ctx.lineTo(-16, 0);
        ctx.lineTo(-19, 5);
        ctx.closePath();
        ctx.fill();
      } else if (projectile.style === "shuriken") {
        // Fantômes de rotation derrière l'étoile.
        for (let ghost = 2; ghost >= 1; ghost--) {
          ctx.save();
          ctx.translate(-ghost * 9, 0);
          ctx.rotate(projectile.age * 15 - ghost * 0.6);
          ctx.globalAlpha = fade * (0.28 - ghost * 0.09);
          drawShuriken(projectile.color, 10);
          ctx.restore();
        }
        ctx.rotate(projectile.age * 15);
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 11;
        drawShuriken(projectile.color, 11);
        // Reflet qui tourne avec la lame.
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(0, -4);
        ctx.stroke();
      } else if (projectile.style === "orb") {
        const pulse = 1 + Math.sin(projectile.age * 18) * 0.1;
        for (let trail = 4; trail >= 1; trail--) {
          ctx.globalAlpha = fade * (0.06 + (5 - trail) * 0.05);
          ctx.beginPath();
          ctx.arc(-trail * 9, Math.sin(projectile.age * 9 - trail) * 2.5, (3 + (5 - trail)) * pulse, 0, Math.PI * 2);
          ctx.fillStyle = projectile.color;
          ctx.fill();
        }
        ctx.globalAlpha = fade;
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 22;
        const orb = ctx.createRadialGradient(-2, -3, 1, 0, 0, 13 * pulse);
        orb.addColorStop(0, "#ffffff");
        orb.addColorStop(0.3, projectile.color);
        orb.addColorStop(1, "rgba(110, 86, 255, 0.05)");
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Deux petites étoiles en orbite.
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 2; i++) {
          const angle = projectile.age * 7 + i * Math.PI;
          ctx.beginPath();
          ctx.arc(Math.cos(angle) * 15, Math.sin(angle) * 8, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 6, projectile.age * 4, projectile.age * 4 + Math.PI * 1.45);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawShuriken(color, radius) {
    ctx.beginPath();
    for (let point = 0; point < 8; point++) {
      const angle = (Math.PI * 2 * point) / 8 - Math.PI / 2;
      const r = point % 2 === 0 ? radius : radius * 0.3;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (point === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#e8f2fb";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawCharacterPreview(target, character, time, isFeature, offset) {
    const previewWidth = target.canvas.width;
    const previewHeight = target.canvas.height;
    target.clearRect(0, 0, previewWidth, previewHeight);
    target.imageSmoothingEnabled = false;

    const accent = target.createRadialGradient(
      previewWidth / 2,
      previewHeight * 0.68,
      2,
      previewWidth / 2,
      previewHeight * 0.68,
      previewWidth * 0.43,
    );
    accent.addColorStop(0, character.accent + "24");
    accent.addColorStop(1, character.accent + "00");
    target.fillStyle = accent;
    target.fillRect(0, 0, previewWidth, previewHeight);

    target.fillStyle = "rgba(4, 10, 22, 0.28)";
    target.beginPath();
    target.ellipse(previewWidth / 2, previewHeight * 0.83, previewWidth * 0.22, previewHeight * 0.035, 0, 0, Math.PI * 2);
    target.fill();

    const sheet = sheetFor(character.id);
    if (!sheet) return;

    const phase = (time + offset) % 4.8;
    const attacking = isFeature && phase > 4.05;
    const column = attacking ? 3 : isFeature ? 0 : 1;
    const row = attacking
      ? Math.min(3, Math.floor(((phase - 4.05) / Math.max(0.12, character.attackDuration)) * 4))
      : Math.floor((time + offset) * (isFeature ? 4 : 9)) % 4;
    const drawSize = Math.min(previewWidth, previewHeight) * (isFeature ? 0.73 : 0.76);
    const drawX = (previewWidth - drawSize) / 2;
    const drawY = (previewHeight - drawSize) / 2 + previewHeight * 0.035;
    target.drawImage(sheet, column * frameSize, row * frameSize, frameSize, frameSize, drawX, drawY, drawSize, drawSize);
  }

  function drawMenuPreviews(time) {
    if (gameMenu.hidden) return;
    characterPreviews.forEach((preview, index) => {
      drawCharacterPreview(preview.context, preview.character, time, false, index * 0.28);
    });
    drawCharacterPreview(featuredPreviewContext, characterFor(selectedCharacter), time, true, 0);
  }

  function roundRectPath(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** Petite étiquette avec le pseudo et la barre de vie, au-dessus du héros. */
  function drawNameplate(text, color, hp, centerX, spriteTop, isSelf) {
    ctx.font = "700 11px " + FONT_STACK;
    const paddingX = 7;
    const dotRadius = 3.5;
    const dotGap = 6;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = Math.round(paddingX * 2 + dotRadius * 2 + dotGap + textWidth);
    const boxHeight = 18;
    const x = clamp(Math.round(centerX - boxWidth / 2), 6, Math.max(6, width - boxWidth - 6));
    const y = Math.round(spriteTop - boxHeight - 6);

    roundRectPath(x, y, boxWidth, boxHeight, 9);
    ctx.fillStyle = isSelf ? "rgba(255, 191, 103, 0.24)" : "rgba(9, 30, 53, 0.74)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + paddingX + dotRadius, y + boxHeight / 2, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x + paddingX + dotRadius * 2 + dotGap, y + boxHeight / 2 + 0.5);

    // Barre de vie sous le pseudo, pour chaque joueur.
    const ratio = clamp((hp == null ? MAX_HP : hp) / MAX_HP, 0, 1);
    const barHeight = 5;
    const barY = y + boxHeight + 3;
    roundRectPath(x, barY, boxWidth, barHeight, 2.5);
    ctx.fillStyle = "rgba(6, 18, 34, 0.72)";
    ctx.fill();
    if (ratio > 0) {
      roundRectPath(x + 1, barY + 1, Math.max(1, (boxWidth - 2) * ratio), barHeight - 2, 1.5);
      ctx.fillStyle = hpColor(ratio);
      ctx.fill();
    }
  }

  /** Flèche au bord de l'écran pour les joueurs hors du champ de la caméra. */
  function drawOffscreenMarker(peer) {
    const centerX = peer.rx + player.width / 2 - camX;
    const toRight = centerX > width / 2;
    const x = toRight ? width - 24 : 24;
    const y = clamp(peer.ry + player.height / 2, 96, Math.max(96, height - 96));

    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(toRight ? 9 : -9, 0);
    ctx.lineTo(toRight ? -6 : 6, -9);
    ctx.lineTo(toRight ? -6 : 6, 9);
    ctx.closePath();
    ctx.fillStyle = accentFor(peer.character);
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.restore();

    ctx.font = "700 10px " + FONT_STACK;
    const label = peer.name;
    const textWidth = ctx.measureText(label).width;
    const boxWidth = Math.round(textWidth + 14);
    const boxHeight = 16;
    const boxX = clamp(x - boxWidth / 2, 6, Math.max(6, width - boxWidth - 6));
    const boxY = Math.round(y + (toRight ? -26 : 14));

    roundRectPath(boxX, boxY, boxWidth, boxHeight, 8);
    ctx.fillStyle = "rgba(9, 30, 53, 0.68)";
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.5);
  }

  function drawOthers() {
    others.forEach((peer) => {
      const centerX = peer.rx + player.width / 2 - camX;
      const drawY = peer.ry - spriteTopPadding;

      // Ombre au sol, comme pour le joueur local.
      ctx.fillStyle = "rgba(23, 59, 91, 0.16)";
      ctx.beginPath();
      ctx.ellipse(centerX, groundY + Math.max(0, -peer.gap) + 7, player.width * (peer.g ? 0.58 : 0.42), 5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (centerX < -spriteDrawSize || centerX > width + spriteDrawSize) {
        drawOffscreenMarker(peer);
        return;
      }

      const accent = accentFor(peer.character);
      const { column, row } = getRemoteFrame(peer);
      drawSprite(peer.character, column, row, peer.f, centerX, drawY, peer.flashTime / FLASH_DURATION);
      if (!peer.dead) {
        drawCharacterAttack(characterFor(peer.character), peer.a, peer.f, centerX, peer.ry + player.height * 0.47, accent, peer.attackSerial);
      }
      drawNameplate(peer.name, accent, peer.hp, centerX, drawY + 6, false);
    });
  }

  /**
   * Touffe posée sur le sol (tileX : bord gauche de sa tuile à l'écran).
   * Au repos, elle est dessinée d'un seul tenant. Quand un personnage vient
   * de la traverser, elle est dessinée ligne par ligne : la pointe se décale
   * davantage que la base, par pas entiers (pixel art préservé), avec une
   * ondulation qui remonte les brins.
   */
  function drawGroundTuft(tuft, tileX) {
    const [sourceX, sourceY] = tuftTiles[tuft.variant];
    const drawX = tileX + (tileDraw - tuftW) / 2;
    const drawY = groundAt(tuft.tile * tileDraw + tileDraw / 2) - tuftH + 4;
    const pose = grass.poseFor(tuft.tile);
    if (!pose) {
      ctx.drawImage(tileset, sourceX, sourceY, tileSize, 13, drawX, drawY, tuftW, tuftH);
      return;
    }

    const lean = clamp(pose.lean / tuftScale, -6, 6); // déviation de la pointe, en pixels d'image
    for (let row = 0; row < 13; row++) {
      const height = (12 - row) / 12; // 0 à la base, 1 à la pointe
      const ripple = pose.wave * 1.4 * height * Math.sin(pose.phase - height * 2.6);
      const shift = Math.round(lean * height * height + ripple) * tuftScale;
      ctx.drawImage(
        tileset,
        sourceX,
        sourceY + row,
        tileSize,
        1,
        drawX + shift,
        drawY + row * tuftScale,
        tuftW,
        tuftScale,
      );
    }
  }

  /** Touffes d'herbe décoratives de la prairie, posées sur le relief. */
  function drawTufts() {
    if (!(tileset.complete && tileset.naturalWidth > 0)) return;
    const firstTile = Math.floor(camX / tileDraw) - 1;
    const startX = -(camX % tileDraw) - tileDraw;
    for (let c = 0; startX + c * tileDraw < width + tileDraw; c++) {
      const worldTile = firstTile + c;
      const x = startX + c * tileDraw;
      if (world.biomeAt(worldTile * tileDraw + tileDraw / 2).id !== "prairie") continue;
      const tuft = window.PixWorldGrass.tuftFor(worldTile);
      if (tuft && tuftVisible(worldTile)) drawGroundTuft(tuft, x);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Secousse de caméra : tout le monde (décor, héros, effets) bouge ensemble.
    ctx.save();
    ctx.translate(Math.round(fx.shakeX), Math.round(fx.shakeY));

    // Ciel et lointains, puis le sol en blocs : fond de grotte, blocs, herbes
    // de surface, objets lâchés et contour du bloc visé.
    const view = { width, height, camX, baseY: groundY, time: lastTime / 1000 };
    scenery.ensurePatterns(ctx);
    scenery.drawSky(ctx, width, height, camX, view.time);
    scenery.drawFarLayers(ctx, width, height, camX);
    blockView.drawBackdrop(ctx, { width, height, top: groundY });
    blockView.drawBlocks(ctx, { camX, top: groundY, width, height });
    drawTufts();
    scenery.drawProps(ctx, view);
    scenery.drawPlatforms(ctx, view);
    blockView.drawDrops(ctx, { items: drops.list, camX, top: groundY, width });
    drawMiningTarget();

    drawOthers();

    // Ombre discrète pour ancrer le sprite au sol pendant le saut.
    const meX = player.x + player.width / 2;
    ctx.fillStyle = "rgba(23, 59, 91, 0.18)";
    ctx.beginPath();
    ctx.ellipse(
      meX - camX,
      groundY + Math.max(0, player.feet) + 7,
      player.width * (player.grounded ? 0.58 : 0.42),
      5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    drawPlayer();
    // Notre propre pseudo et notre barre de vie, pour vérifier d'un coup d'œil.
    drawNameplate(
      identity.name,
      accentFor(identity.character),
      player.hp,
      player.x + player.width / 2 - camX,
      player.y - spriteTopPadding + 6,
      true,
    );
    drawProjectiles();
    fx.draw(ctx, camX);

    scenery.drawAmbient(ctx);
    ctx.restore();

    scenery.drawGrade(ctx, width, height, camX);
    fx.drawOverlay(ctx, width, height);
  }

  function frame(time) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.04) : 0;
    lastTime = time;
    update(delta);
    draw();
    drawMenuPreviews(time / 1000);
    if (panelDirty) {
      panelDirty = false;
      renderPanel();
    }
    requestAnimationFrame(frame);
  }

  // ───────────────────────────── Entrées ─────────────────────────────
  function isTypingTarget(target) {
    return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  }

  window.addEventListener("keydown", (event) => {
    const keyLabel = event.key.toLowerCase();
    if (event.key === "Tab" && !gameMenu.hidden) {
      const focusable = Array.from(gameMenu.querySelectorAll("button:not([hidden]), input:not([disabled])"));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!focusable.includes(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (event.code === "Escape" || keyLabel === "escape") {
      event.preventDefault();
      if (playing) {
        sfx("uiPause");
        openMenu("pause");
      } else if (!gameMenu.hidden && menuMode === "pause") {
        resumeGame();
      }
      return;
    }
    if ((event.code === "KeyM" || keyLabel === "m") && !event.repeat && !isTypingTarget(event.target)) {
      event.preventDefault();
      toggleMute();
      return;
    }
    if (!playing) return;

    // Touches 1 à 9 : choisir directement un emplacement de la barre.
    if (/^Digit[1-9]$/.test(event.code)) {
      selectSlot(Number(event.code.slice(5)) - 1);
      return;
    }

    const controlCode = [
      "KeyQ",
      "KeyA",
      "KeyD",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "KeyX",
    ].includes(event.code);
    const controlLabel = ["a", "q", "d", "x"].includes(keyLabel);
    if (controlCode || controlLabel) event.preventDefault();

    keys.add(event.code);
    if (keyLabel.length === 1) keys.add(keyLabel);

    if (event.code === "Space" && !event.repeat && player.grounded && player.deadTime === 0) {
      player.velocityY = -player.jumpStrength;
      player.grounded = false;
      player.airTime = 0;
      sfx("jump");
      fx.dust(player.x + player.width / 2, groundAt(player.x + player.width / 2), { count: 4 });
    }

    if ((event.code === "KeyX" || keyLabel === "x") && !event.repeat) {
      startAttack();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    keys.delete(event.key.toLowerCase());
  });
  window.addEventListener("blur", () => {
    keys.clear();
    mouse.down = false;
  });

  // Clic gauche maintenu sur le jeu : miner le bloc visé (la souris le désigne).
  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !playing || event.target !== canvas) return;
    event.preventDefault();
    updateMouse(event);
    mouse.down = true;
  });
  window.addEventListener("pointermove", updateMouse);
  window.addEventListener("pointerup", (event) => {
    if (event.button === 0) mouse.down = false;
  });
  window.addEventListener("pointercancel", () => {
    mouse.down = false;
  });
  document.documentElement.addEventListener("mouseleave", () => {
    mouse.inside = false;
  });

  // Molette : un cran fait passer à l'emplacement suivant ou précédent de la barre.
  let wheelAccumulator = 0;
  window.addEventListener(
    "wheel",
    (event) => {
      if (!playing || event.ctrlKey) return; // Ctrl + molette reste le zoom du navigateur
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
      wheelAccumulator += event.deltaY * unit;
      while (Math.abs(wheelAccumulator) >= WHEEL_STEP) {
        const direction = wheelAccumulator > 0 ? 1 : -1;
        wheelAccumulator -= direction * WHEEL_STEP;
        selectSlot(inventory.selected + direction);
      }
    },
    { passive: false },
  );

  window.addEventListener("resize", resize);

  // ─────────────────────────── Démarrage ───────────────────────────
  const savedName = stored(STORAGE_NAME, "");
  identity.name = savedName ? cleanName(savedName) : "";
  identity.character = cleanCharacter(stored(STORAGE_CHARACTER, "ninja"));
  player.speed = characterFor(identity.character).speed;
  player.jumpStrength = characterFor(identity.character).jumpStrength;
  selectedCharacter = identity.character;

  // Adresse du serveur saisie lors d'une partie précédente (vide = ce PC).

  buildCharacterCards();
  updateSoundButtons();
  hotbar.render(inventory);
  resize();
  connect();
  openMenu("start");
  requestAnimationFrame(frame);
})();
