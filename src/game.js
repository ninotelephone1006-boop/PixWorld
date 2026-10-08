/**
 * PixWorld — jeu de plateforme 2D multijoueur.
 *
 * Le principe : chaque visiteur choisit un pseudo (et une couleur) avant de
 * commencer. Ensuite, tous les joueurs présents sur la page se voient en temps
 * réel : leur ninja est dessiné dans le monde, leur pseudo flotte au-dessus
 * d'eux et la petite liste en haut à droite rappelle qui est connecté.
 *
 * Le script reste utilisable sans serveur (solo, ou entre onglets d'un même
 * navigateur) : voir src/net.js pour les détails des transports.
 */
(() => {
  "use strict";

  const canvas = document.querySelector("#world");
  const ctx = canvas.getContext("2d");
  const keys = new Set();

  const joinScreen = document.querySelector("#join");
  const joinForm = document.querySelector("#join-form");
  const joinInput = document.querySelector("#join-input");
  const joinTitle = document.querySelector("#join-title");
  const joinSubmit = document.querySelector("#join-submit");
  const joinColors = document.querySelector("#join-colors");
  const joinStatus = document.querySelector("#join-status");

  const playersPanel = document.querySelector("#players");
  const playersList = document.querySelector("#players-list");
  const playersTitle = document.querySelector(".players-title");
  const playersMode = document.querySelector("#players-mode");
  const playersRename = document.querySelector("#players-rename");
  const toasts = document.querySelector("#toasts");

  const COLORS = ["#ff8a5c", "#ffd166", "#7ee39a", "#5cc8ff", "#c792ea", "#ff7ab8", "#f4f7fb"];
  const STORAGE_NAME = "pixworld.name";
  const STORAGE_COLOR = "pixworld.color";
  const FONT_STACK = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

  // ─────────────────────────── Sprite et décor ───────────────────────────
  const spriteSheet = new Image();
  spriteSheet.src = "assets/ninja-black-32x32.png";

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
  const attackDuration = 0.36;

  // Le monde est maintenant partagé : tout le monde parcourt exactement le
  // même niveau, quelle que soit la taille de son écran.
  const WORLD_WIDTH = 2600;
  const SEND_INTERVAL = 0.05; // 20 envois de position par seconde

  const player = {
    x: 112,
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
    landingTime: 0,
  };

  let width = 0;
  let height = 0;
  let groundY = 0;
  let lastTime = 0;
  let camX = 0;
  let sendTimer = 0;

  // ───────────────────────── État multijoueur ─────────────────────────
  /** Autres joueurs : id -> { id, name, color, x, gap, rx, ry, ... } */
  const others = new Map();
  const identity = {
    name: "Ninja",
    color: COLORS[0],
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

  function cleanColor(raw) {
    return COLORS.indexOf(raw) >= 0 ? raw : COLORS[0];
  }

  // Petit hash déterministe pour varier terre et herbe sans aléatoire.
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // ──────────────────────────── Interface ────────────────────────────
  function buildColorSwatches() {
    COLORS.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "join-color";
      button.style.background = color;
      button.dataset.color = color;
      button.setAttribute("aria-label", "Couleur " + color);
      button.setAttribute("aria-pressed", String(color === identity.color));
      button.addEventListener("click", () => selectColor(color));
      joinColors.append(button);
    });
  }

  function selectColor(color) {
    identity.color = color;
    joinColors.querySelectorAll(".join-color").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.color === color));
    });
  }

  function setStatus(text, tone) {
    joinStatus.textContent = text;
    joinStatus.dataset.tone = tone;
  }

  function describeMode(mode) {
    if (mode === "online") return { label: "en ligne", tone: "online", text: "Connecté au serveur : joue avec tes amis." };
    if (mode === "local") return { label: "onglets", tone: "local", text: "Mode local : ouvre la page dans un autre onglet pour te voir à plusieurs." };
    if (mode === "reconnect") return { label: "reconnexion", tone: "local", text: "Connexion perdue, nouvelle tentative…" };
    return { label: "solo", tone: "solo", text: "Mode solo : lance `npm start` pour jouer en ligne." };
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

  function renderPanel() {
    if (!net) return;
    playersTitle.textContent = "Joueurs · " + (others.size + 1);
    playersList.textContent = "";

    const rows = [{ name: identity.name, color: identity.color, self: true }];
    Array.from(others.values())
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .forEach((peer) => rows.push({ name: peer.name, color: peer.color, self: false }));

    rows.forEach((row) => {
      const li = document.createElement("li");
      if (row.self) li.className = "is-self";

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = row.color;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.name + (row.self ? " (vous)" : "");

      li.append(swatch, name);
      playersList.append(li);
    });
  }

  function openJoinScreen(editing) {
    playing = false;
    joinScreen.hidden = false;
    joinTitle.textContent = editing ? "Changer de pseudo" : "Choisir un pseudo";
    joinSubmit.textContent = editing ? "Valider" : "Commencer";
    joinInput.value = identity.name;
    selectColor(identity.color);
    if (net) applyMode(net.mode);
    joinInput.focus();
    joinInput.select();
  }

  function closeJoinScreen() {
    joinScreen.hidden = true;
    playing = true;
    keys.clear();
    panelDirty = true;
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanName(joinInput.value);
    identity.name = name;
    remember(STORAGE_NAME, name);
    remember(STORAGE_COLOR, identity.color);
    if (net) {
      // Première fois : on annonce notre pseudo, ensuite c'est un renommage.
      if (!hasJoined) {
        hasJoined = true;
        net.join(name, identity.color);
      } else {
        net.rename(name, identity.color);
      }
    }
    closeJoinScreen();
    renderPanel();
  });

  playersRename.addEventListener("click", () => openJoinScreen(true));

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
          peer.color = cleanColor(message.player.color);
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
      existing.color = cleanColor(data.color);
      return false;
    }
    others.set(data.id, {
      id: data.id,
      name: cleanName(data.name),
      color: cleanColor(data.color),
      x: player.x,
      gap: 0,
      f: 1,
      vx: 0,
      vy: 0,
      g: true,
      a: 0,
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
    // Une attaque relancée prend le pas sur celle en cours.
    peer.a = Math.max(peer.a, Number(state.a) || 0);
    peer.seen = performance.now();
  }

  function connect() {
    net = window.PixWorldNet.connect({
      name: identity.name,
      color: identity.color,
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

  function update(delta) {
    player.animationTime += delta;
    player.attackTime = Math.max(0, player.attackTime - delta);
    player.landingTime = Math.max(0, player.landingTime - delta);

    const direction = playing ? Number(isRightPressed()) - Number(isLeftPressed()) : 0;
    player.velocityX = direction * player.speed;
    if (direction !== 0) player.facing = direction;
    player.x += player.velocityX * delta;
    player.x = clamp(player.x, 0, WORLD_WIDTH - player.width);

    // Caméra qui suit le joueur, bornée au monde : c'est elle qui fait
    // défiler les couches de parallaxe à des vitesses différentes.
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

    updateOthers(delta);

    sendTimer += delta;
    if (net && playing && sendTimer >= SEND_INTERVAL) {
      sendTimer = 0;
      net.sendState({
        x: Math.round(player.x),
        gap: Math.round(groundY - (player.y + player.height)),
        f: player.facing,
        vx: Math.round(player.velocityX),
        vy: Math.round(player.velocityY),
        g: player.grounded,
        a: Number(player.attackTime.toFixed(2)),
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

  function getSpriteFrame() {
    if (player.attackTime > 0) {
      const elapsed = attackDuration - player.attackTime;
      const frame = Math.min(3, Math.floor(elapsed / (attackDuration / 4)));
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
    if (peer.a > 0) {
      const elapsed = attackDuration - Math.min(peer.a, attackDuration);
      return { column: 3, row: Math.min(3, Math.floor(elapsed / (attackDuration / 4))) };
    }
    if (!peer.g) return { column: 2, row: peer.vy < 0 ? 0 : 1 };
    if (Math.abs(peer.vx) > 0.5) return { column: 1, row: Math.floor(peer.animTime * 10) % 4 };
    return { column: 0, row: Math.floor(peer.animTime * 5) % 4 };
  }

  function drawPlayer() {
    if (!spriteSheet.complete || spriteSheet.naturalWidth === 0) return;

    const { column, row } = getSpriteFrame();
    drawNinja(column, row, player.facing, player.x + player.width / 2 - camX, player.y - spriteTopPadding, identity.color, 0.42);
  }

  // Les ninjas des autres joueurs sont teintés de leur couleur : on dessine
  // d'abord le sprite d'origine, puis sa silhouette colorée par-dessus.
  const tintCanvas = document.createElement("canvas");
  tintCanvas.width = frameSize;
  tintCanvas.height = frameSize;
  const tintCtx = tintCanvas.getContext("2d");

  function drawNinja(column, row, facing, centerX, drawY, color, tintAlpha) {
    if (!spriteSheet.complete || spriteSheet.naturalWidth === 0) return;
    const sourceX = column * frameSize;
    const sourceY = row * frameSize;

    ctx.save();
    ctx.translate(Math.round(centerX), 0);
    ctx.scale(facing, 1);
    ctx.drawImage(
      spriteSheet,
      sourceX,
      sourceY,
      frameSize,
      frameSize,
      -spriteDrawSize / 2,
      Math.round(drawY),
      spriteDrawSize,
      spriteDrawSize,
    );

    if (color && tintAlpha > 0) {
      tintCtx.clearRect(0, 0, frameSize, frameSize);
      tintCtx.drawImage(spriteSheet, sourceX, sourceY, frameSize, frameSize, 0, 0, frameSize, frameSize);
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

  /** Petite étiquette avec le pseudo, flottant au-dessus du ninja. */
  function drawNameplate(text, color, centerX, spriteTop, isSelf) {
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
    ctx.fillStyle = peer.color;
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

      const { column, row } = getRemoteFrame(peer);
      drawNinja(column, row, peer.f, centerX, drawY, peer.color, 0.6);
      drawNameplate(peer.name, peer.color, centerX, drawY + 6, false);
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
    // Notre propre pseudo, pour vérifier d'un coup d'œil comment on apparaît.
    drawNameplate(
      identity.name,
      identity.color,
      player.x + player.width / 2 - camX,
      player.y - spriteTopPadding + 6,
      true,
    );

    drawForeground();
  }

  function frame(time) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.04) : 0;
    lastTime = time;
    update(delta);
    draw();
    if (panelDirty) {
      panelDirty = false;
      renderPanel();
    }
    requestAnimationFrame(frame);
  }

  // ───────────────────────────── Entrées ─────────────────────────────
  window.addEventListener("keydown", (event) => {
    if (!playing) return; // l'écran de pseudo garde le clavier pour lui

    const keyLabel = event.key.toLowerCase();
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

    if (
      (event.code === "KeyX" || keyLabel === "x") &&
      !event.repeat &&
      player.attackTime === 0
    ) {
      player.attackTime = attackDuration;
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    keys.delete(event.key.toLowerCase());
  });
  window.addEventListener("blur", () => keys.clear());

  // Clic gauche : attaque dans la direction du curseur.
  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !playing) return;
    if (joinScreen.contains(event.target)) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const playerScreenX = player.x + player.width / 2 - camX;
    if (Math.abs(clickX - playerScreenX) > 4) {
      player.facing = clickX > playerScreenX ? 1 : -1;
    }
    if (player.attackTime === 0) player.attackTime = attackDuration;
  });

  window.addEventListener("resize", resize);

  // ─────────────────────────── Démarrage ───────────────────────────
  const savedName = stored(STORAGE_NAME, "");
  identity.name = savedName ? cleanName(savedName) : "";
  identity.color = cleanColor(stored(STORAGE_COLOR, COLORS[0]));

  buildColorSwatches();
  resize();
  connect();
  openJoinScreen(false);
  requestAnimationFrame(frame);
})();
