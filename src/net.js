/**
 * PixWorld — couche réseau.
 *
 * Deux transports, du plus complet au plus simple :
 *   1. "online" : WebSocket vers le petit serveur Node (server/server.js).
 *      Plusieurs machines / navigateurs se voient en temps réel. L'adresse du
 *      serveur est celle de la page par défaut, mais on peut viser un autre
 *      PC (voir resolveServerUrl) : c'est ce qui permet de rejoindre une
 *      partie hébergée sur une autre machine du réseau, ou sur Internet.
 *   2. "local"  : BroadcastChannel, qui relie les onglets d'un même
 *      navigateur sans aucun serveur (pratique pour tester à plusieurs).
 *   3. "solo"   : rien de disponible, on joue seul.
 *
 * Dans tous les cas, le jeu reçoit exactement les mêmes évènements, ce qui
 * évite de dupliquer la logique multijoueur :
 *   { t: "welcome", id, players }  → notre identifiant + joueurs déjà là
 *   { t: "join", player }          → une nouvelle personne arrive
 *   { t: "leave", id }             → une personne part
 *   { t: "snapshot", p: [...] }    → positions/états/vie de tout le monde
 *   { t: "renamed", id, player }   → quelqu'un change de pseudo ou de héros
 *   { t: "disconnected" }          → le serveur ne répond plus
 *   { t: "reset" }                 → on change de serveur : les pairs sont oubliés
 */
window.PixWorldNet = (() => {
  "use strict";

  const WS_OPEN_TIMEOUT = 4000; // au-delà, on bascule sur le mode local
  const STATE_INTERVAL = 50; // 20 envois de position par seconde
  const PEER_TIMEOUT = 6000; // un onglet muet si longtemps est considéré parti
  const CHARACTER_IDS = new Set(["ninja", "archer", "samurai", "mage"]);
  const DEFAULT_SERVER_PORT = 3000; // port du serveur quand on ne le précise pas
  const STORAGE_SERVER = "pixworld.server"; // adresse mémorisée dans le navigateur

  function cleanCharacter(raw) {
    return CHARACTER_IDS.has(raw) ? raw : "ninja";
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ─────────────────── Adresse du serveur à rejoindre ───────────────────

  /** Récupère `window.location` (ou `location`), même hors navigateur. */
  function currentLocation() {
    try {
      if (typeof window !== "undefined" && window.location) return window.location;
    } catch (error) {
      /* fenêtre indisponible */
    }
    try {
      if (typeof location !== "undefined") return location;
    } catch (error) {
      /* environnement sans location */
    }
    return null;
  }

  function readStore(key) {
    try {
      const store = typeof window !== "undefined" ? window.localStorage : null;
      return store ? store.getItem(key) : null;
    } catch (error) {
      return null; // stockage désactivé (navigation privée, file://…)
    }
  }

  function writeStore(key, value) {
    try {
      const store = typeof window !== "undefined" ? window.localStorage : null;
      if (!store) return;
      if (value === null || value === "") store.removeItem(key);
      else store.setItem(key, value);
    } catch (error) {
      /* stockage désactivé : on continue sans mémoriser */
    }
  }

  /** Lit un paramètre d'URL (?server=…) sans dépendre d'URLSearchParams. */
  function queryValue(name) {
    const loc = currentLocation();
    const search = loc && typeof loc.search === "string" ? loc.search : "";
    if (search.charAt(0) !== "?") return null;
    const parts = search.slice(1).split("&");
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      const pair = parts[i].split("=");
      if (decodeURIComponent(pair[0]) !== name) continue;
      const value = decodeURIComponent((pair[1] || "").replace(/\+/g, " "));
      return value.trim();
    }
    return null;
  }

  /** Vrai pour notre propre machine : le navigateur y autorise le non chiffré. */
  function isLoopbackHost(host) {
    const value = String(host || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (!value) return false;
    if (value === "localhost" || value.endsWith(".localhost")) return true;
    if (value === "::1" || value === "0.0.0.0") return true;
    return /^127\./.test(value);
  }

  /** Vrai pour une machine du réseau local (le chiffrage n'y est pas utile). */
  function isPrivateHost(host) {
    const value = String(host || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (!value) return true;
    if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return true;
    if (value === "::1" || value === "0.0.0.0") return true;
    if (/^127\./.test(value)) return true;
    if (/^10\./.test(value)) return true;
    if (/^192\.168\./.test(value)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(value)) return true;
    if (/^169\.254\./.test(value)) return true;
    return false;
  }

  /**
   * Construit l'adresse WebSocket du serveur à rejoindre.
   *
   * L'adresse vient, par ordre de priorité :
   *   1. `raw` (celle que le joueur a saisie dans le menu, ou options.server) ;
   *   2. le paramètre d'URL `?server=192.168.1.24:3000` (pratique pour
   *      partager un lien tout prêt) ;
   *   3. l'adresse mémorisée dans le navigateur ;
   *   4. sinon celle de la page elle-même (le serveur qui héberge le jeu).
   *
   * Tous les formats sont acceptés : `192.168.1.24`, `192.168.1.24:8080`,
   * `http://192.168.1.24:3000`, `ws://…`, `wss://…`. Sans précision, le port
   * est celui de la page (ou 3000) et le chemin `/ws`.
   *
   * @returns {null|{url: string, httpUrl: string, scheme: string, host: string,
   *   port: number, path: string, display: string, remote: boolean,
   *   mixedContent: boolean}} null si aucune adresse n'est devinable
   *   (page ouverte en file:// sans serveur indiqué).
   */
  function resolveServerUrl(raw) {
    const loc = currentLocation();
    const pageHost = loc && loc.host ? String(loc.host) : "";
    const pageHttps = !!loc && loc.protocol === "https:";
    const pagePort = pageHost.lastIndexOf(":") > pageHost.indexOf("]") ? pageHost.slice(pageHost.lastIndexOf(":") + 1) : "";

    let input = raw == null ? "" : String(raw).trim();
    if (!input) {
      const fromQuery = queryValue("server");
      input = fromQuery || readStore(STORAGE_SERVER) || "";
    }
    input = String(input).trim();

    // Adresse de la page : le serveur qui héberge le jeu fait aussi relais.
    if (!input) {
      if (!pageHost) return null; // fichier ouvert en file:// : pas de serveur
      return buildTarget(pageHttps ? "wss:" : "ws:", pageHost, "/ws", false);
    }

    let scheme = "";
    let rest = input;
    const lower = input.toLowerCase();
    if (lower.slice(0, 5) === "ws://") {
      scheme = "ws:";
      rest = input.slice(5);
    } else if (lower.slice(0, 6) === "wss://") {
      scheme = "wss:";
      rest = input.slice(6);
    } else if (lower.slice(0, 7) === "http://") {
      scheme = "ws:";
      rest = input.slice(7);
    } else if (lower.slice(0, 8) === "https://") {
      scheme = "wss:";
      rest = input.slice(8);
    }

    // Un chemin (/ws ou un sous-dossier) peut suivre l'adresse.
    let path = "";
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      path = rest.slice(slash);
      rest = rest.slice(0, slash);
    }
    if (!path || path === "/") path = "/ws";

    // Port : celui de la page s'il y en a un, sinon 3000.
    let host = rest;
    let port = "";
    const colon = host.lastIndexOf(":");
    if (colon >= 0 && host.indexOf("]") < colon) {
      port = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
    if (!port) port = pagePort || String(DEFAULT_SERVER_PORT);
    port = String(Number(port) || DEFAULT_SERVER_PORT);

    // En https, on chiffre aussi la connexion — sauf vers le réseau local,
    // où le serveur PixWorld reste en clair (ws://).
    if (!scheme) scheme = pageHttps && !isPrivateHost(host) ? "wss:" : "ws:";

    const hostPort = host + ":" + port;
    const remote = hostPort.toLowerCase() !== pageHost.toLowerCase();
    return buildTarget(scheme, hostPort, path, remote);
  }

  function buildTarget(scheme, hostPort, path, remote) {
    const cut = hostPort.lastIndexOf(":");
    const port = Number(hostPort.slice(cut + 1)) || DEFAULT_SERVER_PORT;
    return {
      url: scheme + "//" + hostPort + path,
      // Adresse à copier-coller dans un navigateur pour rejoindre la partie.
      httpUrl: (scheme === "wss:" ? "https://" : "http://") + hostPort,
      scheme,
      host: hostPort.slice(0, cut),
      port,
      path,
      display: hostPort,
      // Adresse différente de celle de la page : on vise un autre PC.
      remote: Boolean(remote),
      // Une page en https ne peut pas ouvrir de WebSocket en clair : le
      // navigateur bloque le « contenu mixte » (sauf vers localhost).
      mixedContent: isMixedContent(scheme, hostPort.slice(0, cut)),
    };
  }

  function isMixedContent(scheme, host) {
    const loc = currentLocation();
    if (!loc || loc.protocol !== "https:") return false;
    if (scheme !== "ws:") return false;
    return !isLoopbackHost(host);
  }

  /**
   * @param {object} options
   * @param {(message: object) => void} options.onEvent
   */
  function connect(options) {
    const emit = options.onEvent;
    const identity = {
      name: options.name,
      character: cleanCharacter(options.character),
    };
    const selfId = randomId();

    // Adresse du serveur : celle de la page, sauf si le joueur vise un autre
    // PC (menu, ?server=… ou adresse mémorisée). null = aucun serveur connu.
    let serverInput = options.server != null ? options.server : options.url != null ? options.url : null;
    let target = resolveServerUrl(serverInput);

    let mode = "solo";
    let socket = null;
    let channel = null;
    let opened = false;
    // On ne se présente aux autres qu'une fois le pseudo validé.
    let wantsHello = false;
    let closed = false;
    let openTimer = null;
    let stateTimer = null;
    let pruneTimer = null;
    let reconnectTimer = null;
    let reconnectDelay = 1500;
    let everConnected = false; // a déjà réussi à parler au serveur au moins une fois

    /** Onglets voisins vus en mode local : id -> { name, character, state, seen }. */
    const peers = new Map();
    let latestState = {};

    function setMode(next) {
      mode = next;
      if (options.onMode) options.onMode(next);
    }

    function localSnapshot() {
      const list = [];
      peers.forEach((peer) => {
        list.push(Object.assign({
          id: peer.id,
          name: peer.name,
          character: peer.character,
        }, peer.state));
      });
      if (list.length) emit({ t: "snapshot", p: list });
    }

    function broadcast(message) {
      if (!channel) return;
      try {
        channel.postMessage(Object.assign({ from: selfId }, message));
      } catch (error) {
        /* canal indisponible : on ignore */
      }
    }

    function dropPeer(id, silent) {
      const peer = peers.get(id);
      if (!peer) return;
      peers.delete(id);
      if (!silent) emit({ t: "leave", id });
      if (options.onCount) options.onCount(peers.size + 1);
    }

    function handleLocalMessage(message) {
      if (!message || message.from === selfId) return;
      // Tant que le pseudo n'est pas validé, on reste invisible et on
      // n'annonce personne : pas de faux joueur « Ninja » chez les autres.
      if (!wantsHello) return;

      if (message.t === "hello") {
        const known = peers.has(message.from);
        const player = {
          id: message.from,
          name: message.name,
          character: cleanCharacter(message.character),
        };
        if (!known) {
          peers.set(message.from, {
            id: message.from,
            name: player.name,
            character: player.character,
            state: {},
            seen: Date.now(),
          });
          emit({ t: "join", player });
          if (options.onCount) options.onCount(peers.size + 1);
        } else {
          const peer = peers.get(message.from);
          peer.name = player.name;
          peer.character = player.character;
          peer.seen = Date.now();
        }
        // On se présente en retour, sans relancer de boucle de réponses.
        if (!message.reply) {
          broadcast({
            t: "hello",
            name: identity.name,
            character: identity.character,
            reply: true,
          });
        }
        return;
      }

      if (message.t === "bye") {
        dropPeer(message.from);
        return;
      }

      if (message.t === "renamed") {
        const peer = peers.get(message.from);
        if (peer) {
          peer.name = message.name;
          peer.character = cleanCharacter(message.character);
          peer.seen = Date.now();
          emit({
            t: "renamed",
            id: message.from,
            player: {
              id: message.from,
              name: message.name,
              character: peer.character,
            },
          });
        }
        return;
      }

      if (message.t === "state") {
        let peer = peers.get(message.from);
        if (!peer) {
          // Un onglet dont on a raté le "hello" : on lui demande de se présenter.
          peer = {
            id: message.from,
            name: "Ninja",
            character: cleanCharacter(message.c),
            state: {},
            seen: Date.now(),
          };
          peers.set(message.from, peer);
          broadcast({
            t: "hello",
            name: identity.name,
            character: identity.character,
            reply: true,
          });
          if (options.onCount) options.onCount(peers.size + 1);
        }
        peer.seen = Date.now();
        peer.character = cleanCharacter(message.c || peer.character);
        peer.state = {
          x: message.x,
          gap: message.gap,
          f: message.f,
          vx: message.vx,
          g: message.g,
          vy: message.vy,
          a: message.a,
          c: peer.character,
          n: message.n,
          hp: message.hp,
          d: message.d,
        };
      }
    }

    /** Présente le joueur aux autres, dès que le transport est prêt. */
    function sendHelloIfPossible() {
      if (!wantsHello || closed) return;
      if (mode === "online" && socket && socket.readyState === 1) {
        socket.send(JSON.stringify({
          t: "hello",
          name: identity.name,
          character: identity.character,
        }));
      } else if (mode === "local") {
        broadcast({
          t: "hello",
          name: identity.name,
          character: identity.character,
        });
      }
    }

    function fallbackToLocal() {
      if (closed || opened) return;
      if (typeof BroadcastChannel === "undefined") {
        setMode("solo");
        emit({ t: "welcome", id: selfId, players: [] });
        return;
      }

      setMode("local");
      channel = new BroadcastChannel("pixworld");
      channel.onmessage = (event) => handleLocalMessage(event.data);

      emit({ t: "welcome", id: selfId, players: [] });
      sendHelloIfPossible();

      stateTimer = setInterval(localSnapshot, STATE_INTERVAL);
      pruneTimer = setInterval(() => {
        const now = Date.now();
        peers.forEach((peer, id) => {
          if (now - peer.seen > PEER_TIMEOUT) dropPeer(id);
        });
      }, 1200);

      window.addEventListener("pagehide", sayGoodbye);
    }

    function sayGoodbye() {
      broadcast({ t: "bye" });
    }

    /**
     * Échec de connexion : si le serveur n'a jamais répondu, c'est qu'il
     * n'existe pas (page ouverte en local, hébergement statique…) et on
     * bascule sur le mode « onglets ». Sinon on continue d'espérer son retour.
     */
    function onConnectFailure() {
      if (closed) return;
      if (everConnected) {
        setMode("reconnect");
        scheduleReconnect();
      } else {
        fallbackToLocal();
      }
    }

    /**
     * Change de serveur (ou d'adresse) : on coupe tout proprement, on oublie
     * les pairs connus et on repart sur la nouvelle adresse. Le jeu reçoit
     * { t: "reset" } pour vider sa liste de joueurs avant de re-recevoir
     * ceux du nouveau serveur.
     */
    function restart() {
      clearTimeout(openTimer);
      clearTimeout(reconnectTimer);
      clearInterval(stateTimer);
      clearInterval(pruneTimer);
      openTimer = null;
      reconnectTimer = null;
      stateTimer = null;
      pruneTimer = null;

      if (channel) {
        try {
          channel.close();
        } catch (error) {
          /* canal déjà fermé */
        }
        channel = null;
      }
      if (socket) {
        const previous = socket;
        socket = null;
        previous.onopen = null;
        previous.onmessage = null;
        previous.onclose = null;
        previous.onerror = null;
        try {
          previous.close();
        } catch (error) {
          /* déjà fermée */
        }
      }

      const hadPeers = peers.size > 0;
      peers.clear();
      opened = false;
      reconnectDelay = 1500;
      if (hadPeers) emit({ t: "reset" });
      startOnline();
    }

    /** Si le serveur redémarre, on retente avec un délai qui grandit. */
    function scheduleReconnect() {
      if (closed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (closed || mode === "local") return;
        startOnline();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    }

    function startOnline() {
      target = resolveServerUrl(serverInput);
      // Aucune adresse disponible (page ouverte en file:// et rien de saisi) :
      // on ne peut pas parler à un serveur, on reste entre onglets / en solo.
      if (!target) {
        fallbackToLocal();
        return;
      }

      try {
        socket = new WebSocket(target.url);
      } catch (error) {
        fallbackToLocal();
        return;
      }

      openTimer = setTimeout(() => {
        if (!opened) {
          try {
            socket.close();
          } catch (error) {
            /* déjà fermée */
          }
          onConnectFailure();
        }
      }, WS_OPEN_TIMEOUT);

      socket.onopen = () => {
        opened = true;
        everConnected = true;
        reconnectDelay = 1500;
        clearTimeout(openTimer);
        setMode("online");
        sendHelloIfPossible();
      };

      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        if (message && typeof message === "object") emit(message);
      };

      socket.onclose = () => {
        clearTimeout(openTimer);
        if (opened) {
          // Partie en cours : on prévient le jeu puis on retente.
          opened = false;
          socket = null;
          setMode("reconnect");
          emit({ t: "disconnected" });
          scheduleReconnect();
          return;
        }
        onConnectFailure();
      };

      socket.onerror = () => {
        // Le navigateur n'a rien trouvé à l'adresse demandée.
        if (!opened) onConnectFailure();
      };
    }

    startOnline();

    return {
      get mode() {
        return mode;
      },
      get id() {
        return selfId;
      },
      /**
       * Rejoint la partie : c'est ici que le pseudo devient visible par les
       * autres joueurs (appelé quand on valide l'écran de pseudo).
       */
      join(name, character) {
        if (name !== undefined) identity.name = name;
        if (character !== undefined) identity.character = cleanCharacter(character);
        wantsHello = true;
        sendHelloIfPossible();
      },
      /** Envoie notre état (position, animation, vie) aux autres joueurs. */
      sendState(state) {
        latestState = state;
        if (mode === "online" && socket && socket.readyState === 1) {
          socket.send(JSON.stringify(Object.assign({ t: "state" }, state)));
        } else if (mode === "local") {
          broadcast(Object.assign({ t: "state" }, state));
        }
      },
      /** Change de pseudo / héros sans quitter la partie. */
      rename(name, character) {
        identity.name = name;
        if (character !== undefined) identity.character = cleanCharacter(character);
        if (!wantsHello) return; // pas encore en jeu : le "hello" suffira
        if (mode === "online" && socket && socket.readyState === 1) {
          socket.send(JSON.stringify({ t: "rename", name, character: identity.character }));
        } else if (mode === "local") {
          broadcast({ t: "renamed", name, character: identity.character });
        }
      },
      close() {
        closed = true;
        clearTimeout(openTimer);
        clearTimeout(reconnectTimer);
        clearInterval(stateTimer);
        clearInterval(pruneTimer);
        sayGoodbye();
        if (channel) channel.close();
        if (socket) {
          try {
            socket.close();
          } catch (error) {
            /* déjà fermée */
          }
        }
      },
      /** Adresse WebSocket visée (null si aucun serveur n'est connu). */
      get server() {
        return target ? target.url : null;
      },
      /** Détails de l'adresse visée : hôte, port, adresse http à partager… */
      get serverInfo() {
        return target;
      },
      /**
       * Rejoint le serveur d'un autre PC : on mémorise l'adresse (vide =
       * revenir à celle de la page) et on se reconnecte aussitôt.
       * @param {string} raw ex. "192.168.1.24", "http://192.168.1.24:8080"
       */
      useServer(raw) {
        serverInput = raw == null ? "" : String(raw).trim();
        writeStore(STORAGE_SERVER, serverInput);
        restart();
      },
    };
  }

  return { connect, resolveServerUrl, DEFAULT_SERVER_PORT, STORAGE_SERVER };
})();
