/**
 * PixWorld — une seule arène, sur le même hébergement que le jeu.
 *
 * Deux transports, jamais deux arènes en même temps :
 *
 *   1. le WebSocket du site (`wss://…/ws`) quand le jeu est hébergé avec son
 *      serveur (`npm start`, Render…) — c'est alors le relais de référence ;
 *   2. le **direct entre joueurs** (WebRTC, `src/p2p.js`) dès que ce serveur
 *      n'est pas joignable — hébergement statique (GitHub Pages), réseau
 *      verrouillé… Les joueurs ouvrent le même lien et se retrouvent quand
 *      même, même depuis d'autres Wi-Fi, d'autres villes.
 *
 * Le choix se fait automatiquement, sans IP ni réglage : on tente d'abord le
 * WebSocket ; s'il ne répond pas, on bascule en direct. Tant qu'aucun pair
 * n'est trouvé en direct, une sonde WebSocket périodique reste active pour
 * migrer vers le serveur s'il finit par répondre. Dès qu'un pair est là, on
 * ne change plus de transport (l'arène directe est lancée).
 */
window.PixWorldNet = (() => {
  "use strict";
  const CHARACTER_IDS = new Set(["ninja", "archer", "samurai", "mage"]);
  const cleanCharacter = (value) => CHARACTER_IDS.has(value) ? value : "ninja";

  /** Délais exposés pour les tests (voir test/net.test.js). */
  const tuning = {
    welcome: 8000, // temps max pour recevoir le « welcome » du serveur
    fallback: 2500, // dernière chance au WebSocket avant la bascule en direct
    retryMin: 1500, // première relance du WebSocket
    retryMax: 15000, // relances espacées au maximum de 15 s
    full: 15000, // arène pleine : nouvelle tentative
    probe: 15000, // sonde serveur quand on est seul en direct
    modulePoll: 400, // scrutation du module p2p encore en chargement
    moduleGiveUp: 8000, // au-delà, le module p2p ne viendra pas
  };

  // Aucune IP saisie, URL d'invitation spéciale ou ancienne préférence locale.
  function resolveServerUrl() {
    const loc = window.location;
    if (!loc || !/^https?:$/.test(loc.protocol) || !loc.host) return null;
    return { url: (loc.protocol === "https:" ? "wss://" : "ws://") + loc.host + "/ws",
      httpUrl: loc.protocol + "//" + loc.host, display: loc.host };
  }

  /** Paramètre de l'URL (`?room=famille` pour une salle privée). */
  function queryParam(name) {
    const search = (window.location && window.location.search) || "";
    for (const part of search.replace(/^\?/, "").split("&")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      let key = part.slice(0, eq);
      try { key = decodeURIComponent(key); } catch (error) { /* tel quel */ }
      if (key !== name) continue;
      try {
        return decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
      } catch (error) {
        return part.slice(eq + 1);
      }
    }
    return "";
  }

  /** Salle WebRTC : même lien → même salle ; `?room=` crée une salle privée. */
  function p2pRoomId() {
    const loc = window.location;
    const room = queryParam("room").trim().slice(0, 40);
    const page = (loc.host || "") + (loc.pathname || "/");
    return "pixworld@" + (room ? room + "@" + page : page);
  }

  /** Lien à partager : la page du jeu, salle privée comprise. */
  function shareInfo(mode, wsTarget) {
    const loc = window.location;
    if (!loc || !/^https?:$/.test(loc.protocol) || !loc.host) return null;
    const room = queryParam("room").trim().slice(0, 40);
    return {
      transport: mode === "p2p" ? "p2p" : wsTarget ? "ws" : null,
      display: loc.host,
      shareUrl: loc.protocol + "//" + loc.host + (loc.pathname || "/") +
        (room ? "?room=" + encodeURIComponent(room) : ""),
    };
  }

  /**
   * Le module p2p (`src/p2p.js`, type="module") est chargé en parallèle par la
   * page : il peut ne pas être encore prêt au moment de la bascule. Dans un
   * environnement sans DOM (tests, outils), rien ne le chargera jamais.
   */
  function p2pApi() {
    const api = window.PixWorldP2P;
    return api && typeof api.create === "function" ? api : null;
  }
  function p2pCanBeLate() {
    return !p2pApi() && typeof document !== "undefined" && typeof RTCPeerConnection !== "undefined";
  }

  function connect(options) {
    const target = resolveServerUrl();
    const identity = { name: options.name, character: cleanCharacter(options.character) };
    let socket = null, timer = null, retry = null, fallbackTimer = null, pollTimer = null;
    let closed = false, joined = false, mode = "connecting", id = null;
    let delay = tuning.retryMin;
    let everOnline = false; // le WebSocket a déjà servi : pas de bascule en direct
    let p2p = null; // transport direct actif
    let pollDeadline = 0;
    /** peerId -> { name, character } : pairs vus en direct (annoncés par « hello »). */
    const p2pPeers = new Map();
    const emit = options.onEvent;

    function setMode(value) {
      mode = value;
      if (options.onMode) options.onMode(value);
    }

    function clearTimer(name) {
      if (name === "welcome" && timer !== null) { clearTimeout(timer); timer = null; }
      if (name === "retry" && retry !== null) { clearTimeout(retry); retry = null; }
      if (name === "fallback" && fallbackTimer !== null) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      if (name === "poll" && pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    }

    /** Envoie sur le transport actif (jamais sur les deux à la fois). */
    function send(message, targetPeerId) {
      if (p2p) {
        p2p.send(message, targetPeerId);
        return;
      }
      if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
    }

    function hello(targetPeerId) {
      if (joined && (mode === "online" || mode === "p2p")) {
        send({ t: "hello", ...identity }, targetPeerId);
      }
    }

    function detach() {
      clearTimer("welcome");
      if (!socket) return;
      const previous = socket;
      socket = null;
      previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
      try { previous.close(); } catch (error) { /* déjà fermée */ }
    }

    // ───────────────────────────── Transport WebSocket ─────────────────────────────

    function start() {
      if (closed) return;
      if (!target || typeof WebSocket === "undefined") {
        if (!p2p) setMode("unavailable");
        return;
      }
      try { socket = new WebSocket(target.url); } catch (_) { wsFailed(); return; }
      // Attendre welcome, pas seulement le handshake : l'arène peut être pleine.
      timer = setTimeout(wsFailed, tuning.welcome);
      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (!message || typeof message !== "object") return;
        if (message.t === "full") {
          if (p2p) { detach(); scheduleProbe(); return; }
          detach();
          setMode("full");
          emit(message);
          clearTimer("retry");
          retry = setTimeout(() => { retry = null; start(); }, tuning.full);
          return;
        }
        if (message.t === "welcome") {
          wsWelcome(message);
          return;
        }
        emit(message);
      };
      socket.onerror = wsFailed;
      socket.onclose = wsFailed;
    }

    function wsWelcome(message) {
      clearTimer("welcome");
      if (p2p) {
        if (p2pPeers.size > 0) {
          // L'arène directe a déjà des joueurs : on y reste, la sonde s'arrête.
          detach();
          return;
        }
        // Seul en direct : le serveur redevient le meilleur choix.
        stopP2P();
        emit({ t: "reset" });
      }
      delay = tuning.retryMin;
      everOnline = true;
      id = message.id;
      setMode("online");
      emit(message);
      hello();
    }

    function wsFailed() {
      if (closed) return;
      const wasOnline = mode === "online";
      detach();
      if (!p2p) id = null;
      if (wasOnline) emit({ t: "disconnected" });

      if (p2p) {
        // Sonde serveur ratée : l'arène directe continue.
        scheduleProbe();
        return;
      }

      if (!everOnline) {
        // Jamais atteint le serveur : bascule en direct après une dernière chance.
        setMode("connecting");
        if (fallbackTimer === null) {
          pollDeadline = 0; // nouvelle fenêtre d'attente du module p2p
          fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            if (closed || everOnline || p2p) return;
            startP2P();
          }, tuning.fallback);
        }
      } else {
        setMode("reconnect");
      }

      if (retry === null) {
        retry = setTimeout(() => { retry = null; start(); }, delay);
        delay = Math.min(delay * 2, tuning.retryMax);
      }
    }

    function scheduleProbe() {
      if (closed || !p2p || p2pPeers.size > 0) return;
      if (retry === null) retry = setTimeout(() => { retry = null; start(); }, tuning.probe);
    }

    // ───────────────────────────── Transport direct (WebRTC) ─────────────────────────────

    function stopP2P() {
      clearTimer("poll");
      pollDeadline = 0;
      const previous = p2p;
      p2p = null;
      p2pPeers.clear();
      if (previous && previous.close) {
        try { previous.close(); } catch (error) { /* déjà fermée */ }
      }
    }

    function startP2P() {
      if (closed || p2p || everOnline) return;
      const api = p2pApi();
      if (!api) {
        // Le module p2p se charge peut-être encore avec la page.
        if (p2pCanBeLate()) {
          if (pollDeadline === 0) pollDeadline = Date.now() + tuning.moduleGiveUp;
          if (Date.now() < pollDeadline) {
            pollTimer = setTimeout(() => { pollTimer = null; startP2P(); }, tuning.modulePoll);
            return;
          }
        }
        setMode("reconnect");
        return;
      }
      if (api.available === false) {
        setMode("reconnect");
        return;
      }

      let transport = null;
      try {
        transport = api.create({
          appId: "pixworld",
          roomId: p2pRoomId(),
          onPeerJoin: (peerId) => {
            // Chaque pair se présente : les autres ne nous voient qu'après « hello ».
            hello(peerId);
          },
          onPeerLeave: (peerId) => {
            p2pPeers.delete(peerId);
            emit({ t: "leave", id: peerId });
          },
          onMessage: (message, peerId) => handleP2PMessage(message, peerId),
          onError: () => {
            /* la salle est inaccessible : la sonde serveur reste la seule issue */
          },
        });
      } catch (error) {
        transport = null;
      }
      if (!transport) {
        setMode("reconnect");
        return;
      }

      p2p = transport;
      id = transport.selfId || api.selfId || "anon";
      setMode("p2p");
      emit({ t: "welcome", id, players: [] });
      hello();
      // Les tentatives WebSocket deviennent des sondes espacées.
      clearTimer("retry");
      scheduleProbe();
    }

    function handleP2PMessage(message, peerId) {
      if (closed || !message || typeof message !== "object") return;
      if (!peerId || peerId === id) return;

      if (message.t === "hello" || message.t === "rename") {
        const known = p2pPeers.has(peerId);
        const info = {
          id: peerId,
          name: message.name,
          character: cleanCharacter(message.character),
        };
        p2pPeers.set(peerId, { name: info.name, character: info.character });
        if (message.t === "hello" && !known) emit({ t: "join", player: info });
        else emit({ t: "renamed", id: peerId, player: info });
        return;
      }

      if (message.t === "state") {
        const known = p2pPeers.get(peerId);
        if (!known) return; // invisible tant que le pseudo n'est pas annoncé
        emit({
          t: "snapshot",
          p: [{
            id: peerId,
            name: known.name,
            character: known.character,
            x: message.x,
            gap: message.gap,
            f: message.f,
            vx: message.vx,
            vy: message.vy,
            g: message.g,
            a: message.a,
            c: message.c,
            n: message.n,
            hp: message.hp,
            d: message.d,
          }],
        });
      }
    }

    // ───────────────────────────── API publique ─────────────────────────────

    setMode("connecting");
    start();
    return {
      get mode() { return mode; },
      get id() { return id; },
      get serverInfo() { return shareInfo(mode, target); },
      join(name, character) {
        identity.name = name;
        identity.character = cleanCharacter(character);
        joined = true;
        hello();
      },
      rename(name, character) {
        identity.name = name;
        identity.character = cleanCharacter(character);
        if (joined && (mode === "online" || mode === "p2p")) send({ t: "rename", ...identity });
      },
      sendState(state) {
        if (joined && (mode === "online" || mode === "p2p")) send({ ...state, t: "state" });
      },
      close() {
        closed = true;
        clearTimer("retry");
        clearTimer("fallback");
        clearTimer("poll");
        detach();
        stopP2P();
      },
    };
  }

  return { connect, resolveServerUrl, tuning };
})();
