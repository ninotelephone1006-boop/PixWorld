/**
 * PixWorld — jeu de plateforme 2D multijoueur.
 *
 * Chaque visiteur choisit son héros et son pseudo dans un menu titre dédié.
 * Les quatre combattants ont leur propre animation et leur attaque visuelle ;
 * Échap rouvre le menu en pause pendant la partie.
 * En multijoueur, héros, attaques, points de vie et positions sont synchronisés
 * en temps réel. Chaque joueur porte une barre de vie : les attaques des
 * autres (projectiles et coups de mêlée) nous enlèvent des points, et on
 * réapparaît en pleine forme après un K.O.
 *
 * Le script reste utilisable sans serveur (solo, ou entre onglets d'un même
 * navigateur) : voir src/net.js pour les détails des transports.
 */
(() => {
  "use strict";

  const canvas = document.querySelector("#world");
  const ctx = canvas.getContext("2d");
  const keys = new Set();

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
  const toasts = document.querySelector("#toasts");

  const STORAGE_NAME = "pixworld.name";
  const STORAGE_CHARACTER = "pixworld.character";
  const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

  // Points de vie : barre au-dessus de chaque joueur, dégâts des attaques.
  const MAX_HP = 100;
  const REGEN_DELAY = 5; // secondes sans dégâts avant de se soigner
  const REGEN_RATE = 9; // points de vie par seconde
  const RESPAWN_INVULNERABILITY = 1.6;

  // ─────────────────────────── Sprites et décor ───────────────────────────
  // Chaque héros a un corps (`sprite`) et, pour Sora et Raiden, une surcouche
  // d'arme (`weaponSprite`) dessinée par-dessus : les feuilles d'arc et de
  // sabre du pack CC0 ne contiennent que l'arme, pas le personnage.
  const characterSheets = Object.create(null);
  CHARACTERS.list.forEach((character) => {
    const body = new Image();
    body.src = character.sprite;
    const entry = { body, weapon: null };
    if (character.weaponSprite) {
      const weapon = new Image();
      weapon.src = character.weaponSprite;
      entry.weapon = weapon;
    }
    characterSheets[character.id] = entry;
  });

  // Décor pixel art « Sunny Land » (Ansimuz, CC0) : ciel, collines et
  // tuiles de sol, dessinées en parallaxe derrière le ninja.
  const skyLayer = new Image();
  skyLayer.src = "assets/background/sky-back.png";
  const hillsLayer = new Image();
  hillsLayer.src = "assets/background/hills-middle.png";
  const tileset = new Image();
  tileset.src = "assets/background/tileset.png";

  const tileSize = 16;
  const tileScale = 4;
  const tileDraw = tileSize * tileScale;
  const groundHeight = tileDraw * 2;
  // Réglages des couches de parallaxe (facteur de défilement caméra).
  const skyFactor = 0.1;
  const hillsFactor = 0.32;
  const foregroundFactor = 1.3;
  // Tuiles de terre (variants) et touffes d'herbe dans la feuille.
  const dirtTiles = [
    [16, 48],
    [80, 48],
    [16, 80],
    [48, 80],
  ];
  const grassTopTile = [48, 16];
  const tuftTiles = [
    [16, 115],
    [48, 115],
  ];
  const frameSize = 32;
  const spriteScale = 4;
  const spriteDrawSize = frameSize * spriteScale;
  const spriteTopPadding = 9 * spriteScale;

  // Le monde est maintenant partagé : tout le monde parcourt exactement le
  // même niveau, quelle que soit la taille de son écran.
  const WORLD_WIDTH = 2600;
  const SEND_INTERVAL = 0.05; // 20 envois de position par seconde
  const SPAWN_X = 112;

  const player = {
    x: SPAWN_X,
    y: 0,
    width: 42,
    height: 60,
    velocityX: 0,
    velocityY: 0,
    speed: 340,
    jumpStrength: 700,
    grounded: true,
    facing: 1,
    animationTime: 0,
    attackTime: 0,
    attackSerial: 0,
    landingTime: 0,
    hp: MAX_HP,
    invulnerable: 0,
    timeSinceDamage: 99,
  };

  let width = 0;
  let height = 0;
  let groundY = 0;
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

  /** Couleur d'identification : toujours l'accent du héros choisi. */
  function accentFor(id) {
    return characterFor(id).accent;
  }

  // Petit hash déterministe pour varier terre et herbe sans aléatoire.
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
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
      card.addEventListener("click", () => selectCharacter(character.id));

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

  function selectCharacter(id) {
    selectedCharacter = cleanCharacter(id);
    updateCharacterCards();
  }

  function setStatus(text, tone) {
    menuStatus.textContent = text;
    menuStatus.dataset.tone = tone;
  }

  function describeMode(mode) {
    if (mode === "online") return { label: "en ligne", tone: "online", text: "Connecté au serveur : joue avec tes amis." };
    if (mode === "local") return { label: "onglets", tone: "local", text: "Mode local : ouvre un autre onglet pour jouer à plusieurs." };
    if (mode === "reconnect") return { label: "reconnexion", tone: "local", text: "Connexion perdue, nouvelle tentative…" };
    return { label: "solo", tone: "solo", text: "Mode solo : lance npm start pour jouer en ligne." };
  }

  function applyMode(mode) {
    const info = describeMode(mode);
    playersPanel.dataset.mode = mode;
    playersMode.textContent = info.label;
    if (!playing) setStatus(info.text, info.tone);
    panelDirty = true;
  }

  function toast(text) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = text;
    toasts.append(item);
    while (toasts.children.length > 4) toasts.firstElementChild.remove();
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
      { name: identity.name, character: identity.character, hp: player.hp, self: true },
    ];
    Array.from(others.values())
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .forEach((peer) => rows.push({ name: peer.name, character: peer.character, hp: peer.hp, self: false }));

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
      meter.title = "Vie " + Math.round(row.hp) + " / " + MAX_HP;
      const fill = document.createElement("i");
      const ratio = clamp(row.hp / MAX_HP, 0, 1);
      fill.style.width = Math.round(ratio * 100) + "%";
      fill.style.background = hpColor(ratio);
      meter.append(fill);

      const role = document.createElement("span");
      role.className = "player-class";
      role.textContent = characterFor(row.character).role;
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
  }

  function resumeGame() {
    if (menuMode !== "pause") return;
    syncMenuFromIdentity();
    hideMenu();
    playing = true;
    keys.clear();
    panelDirty = true;
  }

  function returnToTitle() {
    playing = false;
    if (net) net.close();
    net = null;
    others.clear();
    myId = null;
    hasJoined = false;
    player.x = SPAWN_X;
    player.y = groundY - player.height;
    player.velocityX = 0;
    player.velocityY = 0;
    player.grounded = true;
    player.attackTime = 0;
    player.attackSerial = 0;
    player.hp = MAX_HP;
    player.invulnerable = 0;
    player.timeSinceDamage = 99;
    projectiles.length = 0;
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
    } else {
      beginGame();
    }
  });

  menuClose.addEventListener("click", resumeGame);
  menuHome.addEventListener("click", returnToTitle);
  playersRename.addEventListener("click", () => openMenu("pause"));

  // ───────────────────────────── Réseau ─────────────────────────────
  function handleNetworkMessage(message) {
    switch (message.t) {
      case "welcome": {
        myId = message.id;
        (message.players || []).forEach(addPeer);
        panelDirty = true;
        break;
      }
      case "join": {
        const isNew = addPeer(message.player);
        if (isNew && message.player) {
          const peer = others.get(message.player.id);
          toast((peer ? peer.name : "Quelqu'un") + " a rejoint la partie");
        }
        panelDirty = true;
        break;
      }
      case "leave": {
        const peer = others.get(message.id);
        if (peer) {
          others.delete(message.id);
          toast(peer.name + " a quitté la partie");
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
        toast("Connexion perdue");
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
      x: player.x,
      gap: 0,
      f: 1,
      vx: 0,
      vy: 0,
      g: true,
      a: 0,
      attackSerial: 0,
      lastMeleeHitSerial: 0,
      rx: player.x,
      ry: groundY - player.height,
      animTime: 0,
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
      peer.ry = groundY - player.height - (Number(state.gap) || 0);
    }
    peer.x = clamp(Number(state.x) || 0, 0, WORLD_WIDTH - player.width);
    peer.gap = Math.max(0, Number(state.gap) || 0);
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
    const nextHp = Number(state.hp);
    if (Number.isFinite(nextHp) && clamp(nextHp, 0, MAX_HP) !== peer.hp) {
      peer.hp = clamp(nextHp, 0, MAX_HP);
      panelDirty = true;
    }
    // Le compteur évite de rejouer les effets d'attaque reçus dans chaque snapshot.
    const attackSerial = Math.max(0, Math.floor(Number(state.n) || 0));
    if (attackSerial > peer.attackSerial) {
      peer.attackSerial = attackSerial;
      spawnPeerAttack(peer);
    }
    // Une attaque relancée prend le pas sur celle en cours.
    peer.a = Math.max(peer.a, Number(state.a) || 0);
    peer.seen = performance.now();
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
    groundY = Math.max(0, height - groundHeight);
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);
    if (player.grounded) player.y = groundY - player.height;
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

  /** Enlève des points de vie au joueur local ; K.O. → réapparition. */
  function applyDamage(amount) {
    if (!playing || player.invulnerable > 0) return;
    player.hp = Math.max(0, player.hp - amount);
    player.timeSinceDamage = 0;
    panelDirty = true;
    if (player.hp <= 0) {
      player.hp = MAX_HP;
      player.x = SPAWN_X;
      player.y = groundY - player.height;
      player.velocityX = 0;
      player.velocityY = 0;
      player.grounded = true;
      player.invulnerable = RESPAWN_INVULNERABILITY;
      player.timeSinceDamage = 0;
      toast("Tu as été mis K.O. · réapparition au camp de départ");
    }
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

  /** Les coups de mêlée des autres (arc de coupe) peuvent nous atteindre. */
  function checkMeleeHits() {
    others.forEach((peer) => {
      const character = characterFor(peer.character);
      if (character.attackStyle !== "slash" || peer.a <= 0) return;
      if (peer.lastMeleeHitSerial >= peer.attackSerial) return;
      const progress = 1 - Math.min(peer.a, character.attackDuration) / character.attackDuration;
      if (progress < 0.12 || progress > 0.78) return;
      const peerX = peer.rx + player.width / 2;
      const localX = player.x + player.width / 2;
      const dx = (localX - peerX) * peer.f;
      const dy = Math.abs(player.y + player.height / 2 - (peer.ry + player.height / 2));
      if (dx > -28 && dx < 112 && dy < 82) {
        peer.lastMeleeHitSerial = peer.attackSerial;
        applyDamage(character.attackDamage);
      }
    });
  }

  function update(delta) {
    if (playing) {
      player.animationTime += delta;
      player.attackTime = Math.max(0, player.attackTime - delta);
      player.landingTime = Math.max(0, player.landingTime - delta);
      player.invulnerable = Math.max(0, player.invulnerable - delta);
      player.timeSinceDamage += delta;
      if (player.timeSinceDamage >= REGEN_DELAY && player.hp < MAX_HP) {
        player.hp = Math.min(MAX_HP, player.hp + REGEN_RATE * delta);
      }

      const direction = Number(isRightPressed()) - Number(isLeftPressed());
      player.velocityX = direction * player.speed;
      if (direction !== 0) player.facing = direction;
      player.x += player.velocityX * delta;
      player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);

      // Caméra qui suit le joueur, bornée au monde : parallaxe du décor.
      const target = clamp(player.x + player.width / 2 - width / 2, 0, WORLD_WIDTH - width);
      camX += (target - camX) * Math.min(1, delta * 10);

      if (!player.grounded) {
        player.velocityY += 1900 * delta;
        player.y += player.velocityY * delta;

        if (player.y + player.height >= groundY) {
          player.y = groundY - player.height;
          player.velocityY = 0;
          player.grounded = true;
          player.landingTime = 0.12;
        }
      }
    }

    updateOthers(delta);
    updateProjectiles(delta);
    checkMeleeHits();

    // La barre de vie du panneau suit les régénérations et les dégâts.
    const hpShown = Math.round(player.hp);
    if (hpShown !== lastPanelHp) {
      lastPanelHp = hpShown;
      panelDirty = true;
    }

    // On garde le joueur annoncé pendant une pause, avec sa position gelée.
    sendTimer += delta;
    if (net && hasJoined && sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      net.sendState({
        x: Math.round(player.x),
        gap: Math.round(groundY - (player.y + player.height)),
        f: player.facing,
        vx: Math.round(player.velocityX),
        vy: Math.round(player.velocityY),
        g: player.grounded,
        a: Number(player.attackTime.toFixed(2)),
        c: identity.character,
        n: player.attackSerial,
        hp: Math.round(player.hp),
      });
    }
  }

  /** Interpole les joueurs distants pour lisser les 20 messages/seconde. */
  function updateOthers(delta) {
    others.forEach((peer) => {
      peer.animTime += delta;
      peer.a = Math.max(0, peer.a - delta);
      peer.rx += (peer.x - peer.rx) * Math.min(1, delta * 14);
      const targetY = groundY - player.height - peer.gap;
      peer.ry += (targetY - peer.ry) * Math.min(1, delta * 14);
    });
  }

  function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      projectile.x += projectile.speed * projectile.facing * delta;
      projectile.age += delta;
      projectile.life -= delta;
      // Chaque client ne blesse que lui-même : la victime fait ses comptes.
      if (!projectile.hitPlayer && projectile.owner !== "self") {
        if (hitsLocalPlayer(projectile.x, projectile.y)) {
          projectile.hitPlayer = true;
          applyDamage(projectile.damage);
        }
      }
      if (projectile.life <= 0 || projectile.x < -80 || projectile.x > WORLD_WIDTH + 80) {
        projectiles.splice(i, 1);
      }
    }
  }

  function getSpriteFrame() {
    const character = characterFor(identity.character);
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
    if (peer.a > 0) {
      const elapsed = character.attackDuration - Math.min(peer.a, character.attackDuration);
      return { column: 3, row: Math.min(3, Math.floor(elapsed / (character.attackDuration / 4))) };
    }
    if (!peer.g) return { column: 2, row: peer.vy < 0 ? 0 : 1 };
    if (Math.abs(peer.vx) > 0.5) return { column: 1, row: Math.floor(peer.animTime * 10) % 4 };
    return { column: 0, row: Math.floor(peer.animTime * 5) % 4 };
  }

  function startAttack() {
    if (!playing || player.attackTime > 0) return;
    const character = characterFor(identity.character);
    player.attackTime = character.attackDuration;
    player.attackSerial += 1;
    if (character.attackStyle !== "slash") {
      spawnProjectile(
        character,
        player.x + player.width / 2 + player.facing * 18,
        player.y + player.height * 0.46,
        player.facing,
        character.accent,
        "self",
      );
    }
  }

  function spawnPeerAttack(peer) {
    const character = characterFor(peer.character);
    if (character.attackStyle === "slash") return;
    spawnProjectile(
      character,
      peer.rx + player.width / 2 + peer.f * 18,
      peer.ry + player.height * 0.46,
      peer.f,
      character.accent,
      peer.id,
    );
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
      hitPlayer: false,
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
    drawNinja(identity.character, column, row, player.facing, centerX, drawY, character.accent, 0.34);
    ctx.restore();
    drawCharacterAttack(character, player.attackTime, player.facing, centerX, player.y + player.height * 0.47, character.accent);
  }

  // Chaque héros garde son sprite CC0 d'origine ; son accent teinte
  // légèrement sa silhouette pour le distinguer en multijoueur.
  const tintCanvas = document.createElement("canvas");
  tintCanvas.width = frameSize;
  tintCanvas.height = frameSize;
  const tintCtx = tintCanvas.getContext("2d");
  tintCtx.imageSmoothingEnabled = false;

  /** Feuilles d'un héros réellement prêtes : corps + éventuelle surcouche d'arme. */
  function loadedLayers(characterId) {
    const sheets = characterSheets[cleanCharacter(characterId)];
    if (!sheets) return [];
    const layers = [];
    [sheets.body, sheets.weapon].forEach((sheet) => {
      if (sheet && sheet.complete && sheet.naturalWidth > 0) layers.push(sheet);
    });
    return layers;
  }

  function drawNinja(characterId, column, row, facing, centerX, drawY, color, tintAlpha) {
    const layers = loadedLayers(characterId);
    if (!layers.length) return;
    const sourceX = column * frameSize;
    const sourceY = row * frameSize;

    ctx.save();
    ctx.translate(Math.round(centerX), 0);
    ctx.scale(facing, 1);
    layers.forEach((sheet) => {
      ctx.drawImage(
        sheet,
        sourceX,
        sourceY,
        frameSize,
        frameSize,
        -spriteDrawSize / 2,
        Math.round(drawY),
        spriteDrawSize,
        spriteDrawSize,
      );
    });

    if (color && tintAlpha > 0) {
      tintCtx.clearRect(0, 0, frameSize, frameSize);
      layers.forEach((sheet) => {
        tintCtx.drawImage(sheet, sourceX, sourceY, frameSize, frameSize, 0, 0, frameSize, frameSize);
      });
      tintCtx.globalCompositeOperation = "source-in";
      tintCtx.fillStyle = color;
      tintCtx.fillRect(0, 0, frameSize, frameSize);
      tintCtx.globalCompositeOperation = "source-over";

      ctx.globalAlpha = tintAlpha;
      ctx.drawImage(
        tintCanvas,
        0,
        0,
        frameSize,
        frameSize,
        -spriteDrawSize / 2,
        Math.round(drawY),
        spriteDrawSize,
        spriteDrawSize,
      );
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawCharacterAttack(character, timeLeft, facing, centerX, centerY, color) {
    if (character.attackStyle !== "slash" || timeLeft <= 0) return;
    const progress = clamp(1 - timeLeft / character.attackDuration, 0, 1);
    const alpha = Math.sin(progress * Math.PI) * 0.9;
    if (alpha <= 0.02) return;

    ctx.save();
    ctx.translate(Math.round(centerX + facing * 12), Math.round(centerY));
    ctx.scale(facing, 1);
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 17;
    ctx.beginPath();
    ctx.arc(0, 0, 31 + progress * 17, -1.13, 1.18);
    ctx.strokeStyle = "#fff2d4";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 37 + progress * 17, -1.12, 1.18);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectiles() {
    projectiles.forEach((projectile) => {
      const screenX = projectile.x - camX;
      if (screenX < -55 || screenX > width + 55) return;
      const fade = clamp(projectile.life / Math.min(0.35, projectile.initialLife), 0, 1);
      ctx.save();
      ctx.translate(Math.round(screenX), Math.round(projectile.y));
      ctx.rotate(projectile.facing < 0 ? Math.PI : 0);
      ctx.globalAlpha = fade;

      if (projectile.style === "arrow") {
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 8;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#f5f4e9";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.lineTo(12, 0);
        ctx.stroke();
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(7, -4.5);
        ctx.lineTo(8, 0);
        ctx.lineTo(7, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = projectile.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(-16, -4);
        ctx.moveTo(-11, 0);
        ctx.lineTo(-16, 4);
        ctx.stroke();
      } else if (projectile.style === "shuriken") {
        ctx.rotate(projectile.age * 13);
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 11;
        ctx.beginPath();
        for (let point = 0; point < 8; point++) {
          const angle = (Math.PI * 2 * point) / 8 - Math.PI / 2;
          const radius = point % 2 === 0 ? 11 : 3.2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = "#e8f2fb";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = projectile.color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = projectile.color;
        ctx.fill();
      } else if (projectile.style === "orb") {
        for (let trail = 3; trail >= 1; trail--) {
          ctx.globalAlpha = fade * (0.08 + (4 - trail) * 0.055);
          ctx.beginPath();
          ctx.arc(-trail * 8, Math.sin(projectile.age * 9 - trail) * 2, 3 + (4 - trail), 0, Math.PI * 2);
          ctx.fillStyle = projectile.color;
          ctx.fill();
        }
        ctx.globalAlpha = fade;
        ctx.shadowColor = projectile.color;
        ctx.shadowBlur = 20;
        const orb = ctx.createRadialGradient(-2, -3, 1, 0, 0, 12);
        orb.addColorStop(0, "#ffffff");
        orb.addColorStop(0.25, projectile.color);
        orb.addColorStop(1, "rgba(110, 86, 255, 0.08)");
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, projectile.age * 4, projectile.age * 4 + Math.PI * 1.45);
        ctx.stroke();
      }
      ctx.restore();
    });
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

    const layers = loadedLayers(character.id);
    if (!layers.length) return;

    const phase = (time + offset) % 4.8;
    const attacking = isFeature && phase > 4.05;
    const column = attacking ? 3 : isFeature ? 0 : 1;
    const row = attacking
      ? Math.min(3, Math.floor(((phase - 4.05) / Math.max(0.12, character.attackDuration)) * 4))
      : Math.floor((time + offset) * (isFeature ? 4 : 9)) % 4;
    const drawSize = Math.min(previewWidth, previewHeight) * (isFeature ? 0.73 : 0.76);
    const drawX = (previewWidth - drawSize) / 2;
    const drawY = (previewHeight - drawSize) / 2 + previewHeight * 0.035;
    layers.forEach((sheet) => {
      target.drawImage(
        sheet,
        column * frameSize,
        row * frameSize,
        frameSize,
        frameSize,
        drawX,
        drawY,
        drawSize,
        drawSize,
      );
    });
  }

  function drawMenuPreviews(time) {
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
      ctx.ellipse(centerX, groundY + 7, player.width * (peer.g ? 0.58 : 0.42), 5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (centerX < -spriteDrawSize || centerX > width + spriteDrawSize) {
        drawOffscreenMarker(peer);
        return;
      }

      const accent = accentFor(peer.character);
      const { column, row } = getRemoteFrame(peer);
      drawNinja(peer.character, column, row, peer.f, centerX, drawY, accent, 0.34);
      drawCharacterAttack(
        characterFor(peer.character),
        peer.a,
        peer.f,
        centerX,
        peer.ry + player.height * 0.47,
        accent,
      );
      drawNameplate(peer.name, accent, peer.hp, centerX, drawY + 6, false);
    });
  }

  // Répète horizontalement une image de décor, décalée par la caméra
  // multipliée par le facteur de parallaxe de la couche.
  function drawTiledLayer(img, factor, drawH, bottomY) {
    const scale = drawH / img.height;
    const drawW = img.width * scale;
    if (!(drawW > 0)) return;
    let off = (camX * factor) % drawW;
    if (off < 0) off += drawW;
    for (let x = -off; x < width; x += drawW) {
      ctx.drawImage(img, x, bottomY - drawH, drawW, drawH);
    }
  }

  function drawBackground() {
    // Ciel de secours tant que les images ne sont pas chargées.
    ctx.fillStyle = "#58a6e8";
    ctx.fillRect(0, 0, width, height);

    if (skyLayer.complete && skyLayer.naturalWidth > 0) {
      drawTiledLayer(skyLayer, skyFactor, height, height);
    }
    if (hillsLayer.complete && hillsLayer.naturalWidth > 0) {
      drawTiledLayer(hillsLayer, hillsFactor, height * 0.85, height);
    }
  }

  function drawGround() {
    if (!(tileset.complete && tileset.naturalWidth > 0)) {
      // Sol gris de secours avant chargement de la feuille de tuiles.
      ctx.fillStyle = "#858c94";
      ctx.fillRect(0, groundY, width, height - groundY);
      return;
    }

    const firstTile = Math.floor(camX / tileDraw);
    const startX = -(camX % tileDraw);
    const rows = Math.ceil((height - groundY) / tileDraw);
    const tuftW = tileSize * 3;
    const tuftH = 13 * 3;

    for (let c = 0; startX + c * tileDraw < width; c++) {
      const worldTile = firstTile + c;
      const x = startX + c * tileDraw;

      ctx.drawImage(
        tileset,
        grassTopTile[0],
        grassTopTile[1],
        tileSize,
        tileSize,
        x,
        groundY,
        tileDraw,
        tileDraw,
      );
      for (let r = 1; r <= rows; r++) {
        const dirt = dirtTiles[Math.floor(hash(worldTile * 7 + r * 131) * dirtTiles.length)];
        ctx.drawImage(
          tileset,
          dirt[0],
          dirt[1],
          tileSize,
          tileSize,
          x,
          groundY + r * tileDraw,
          tileDraw,
          tileDraw,
        );
      }

      // Touffes d'herbe décoratives, posées de façon déterministe.
      if (hash(worldTile + 999) < 0.2) {
        const tuft = tuftTiles[Math.floor(hash(worldTile + 777) * tuftTiles.length)];
        ctx.drawImage(
          tileset,
          tuft[0],
          tuft[1],
          tileSize,
          13,
          x + (tileDraw - tuftW) / 2,
          groundY - tuftH + 4,
          tuftW,
          tuftH,
        );
      }
    }
  }

  // Herbes au premier plan, défilant plus vite que le sol : renforce
  // l'effet de profondeur de la parallaxe.
  function drawForeground() {
    if (!(tileset.complete && tileset.naturalWidth > 0)) return;
    const tuftW = tileSize * 3;
    const tuftH = 13 * 3;
    const scroll = camX * foregroundFactor;
    const firstTile = Math.floor(scroll / tuftW);
    const startX = -(scroll % tuftW);

    for (let c = 0; startX + c * tuftW < width; c++) {
      const worldTile = firstTile + c;
      if (hash(worldTile + 555) < 0.45) {
        const tuft = tuftTiles[Math.floor(hash(worldTile + 313) * tuftTiles.length)];
        ctx.drawImage(
          tileset,
          tuft[0],
          tuft[1],
          tileSize,
          13,
          startX + c * tuftW,
          height - tuftH + 8,
          tuftW,
          tuftH,
        );
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    drawBackground();
    drawGround();

    drawOthers();

    // Ombre discrète pour ancrer le sprite au sol pendant le saut.
    ctx.fillStyle = "rgba(23, 59, 91, 0.18)";
    ctx.beginPath();
    ctx.ellipse(
      player.x + player.width / 2 - camX,
      groundY + 7,
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

    drawForeground();
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
      if (playing) openMenu("pause");
      else if (!gameMenu.hidden && menuMode === "pause") resumeGame();
      return;
    }
    if (!playing) return;

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

    if (event.code === "Space" && !event.repeat && player.grounded) {
      player.velocityY = -player.jumpStrength;
      player.grounded = false;
    }

    if ((event.code === "KeyX" || keyLabel === "x") && !event.repeat) {
      startAttack();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    keys.delete(event.key.toLowerCase());
  });
  window.addEventListener("blur", () => keys.clear());

  // Clic gauche : attaque dans la direction du curseur.
  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !playing || event.target !== canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const playerScreenX = player.x + player.width / 2 - camX;
    if (Math.abs(clickX - playerScreenX) > 4) {
      player.facing = clickX > playerScreenX ? 1 : -1;
    }
    startAttack();
  });

  window.addEventListener("resize", resize);

  // ─────────────────────────── Démarrage ───────────────────────────
  const savedName = stored(STORAGE_NAME, "");
  identity.name = savedName ? cleanName(savedName) : "";
  identity.character = cleanCharacter(stored(STORAGE_CHARACTER, "ninja"));
  player.speed = characterFor(identity.character).speed;
  player.jumpStrength = characterFor(identity.character).jumpStrength;
  selectedCharacter = identity.character;

  buildCharacterCards();
  resize();
  connect();
  openMenu("start");
  requestAnimationFrame(frame);
})();
