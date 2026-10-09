/**
 * PixWorld — couche réseau.
 *
 * Deux transports, du plus complet au plus simple :
 *   1. "online" : WebSocket vers le petit serveur Node (server/server.js).
 *      Plusieurs machines / navigateurs se voient en temps réel.
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
 */
window.PixWorldNet = (() => {
  "use strict";

  const WS_OPEN_TIMEOUT = 4000; // au-delà, on bascule sur le mode local
  const STATE_INTERVAL = 50; // 20 envois de position par seconde
  const PEER_TIMEOUT = 6000; // un onglet muet si longtemps est considéré parti
  const CHARACTER_IDS = new Set(["ninja", "archer", "samurai", "mage"]);

  function cleanCharacter(raw) {
    return CHARACTER_IDS.has(raw) ? raw : "ninja";
  }

  function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
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
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      let url = options.url || scheme + "//" + location.host + "/ws";

      try {
        socket = new WebSocket(url);
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
    };
  }

  return { connect };
})();
