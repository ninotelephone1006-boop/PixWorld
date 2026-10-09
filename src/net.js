/** PixWorld — une seule arène, sur le même hébergement que le jeu. */
window.PixWorldNet = (() => {
  "use strict";
  const CHARACTER_IDS = new Set(["ninja", "archer", "samurai", "mage"]);
  const cleanCharacter = (value) => CHARACTER_IDS.has(value) ? value : "ninja";

  // Par défaut, la page et l'arène sont servies par le même site (Render, par
  // exemple). Si l'interface est hébergée ailleurs, le propriétaire peut
  // définir window.PixWorldConfig.serverUrl avant de charger ce script afin
  // que tous les clients rejoignent exactement le même serveur public.
  function resolveServerUrl() {
    const loc = window.location;
    if (!loc || !/^https?:$/.test(loc.protocol) || !loc.host) return null;

    const pageUrl = loc.protocol + "//" + loc.host + (loc.pathname || "/");
    const configured = window.PixWorldConfig && window.PixWorldConfig.serverUrl;
    let url;
    let display = loc.host;

    if (configured != null && String(configured).trim()) {
      try {
        url = new URL(String(configured).trim());
      } catch (_) {
        return null;
      }
      if (!url.host || url.username || url.password || url.search || url.hash ||
          (url.pathname !== "/" && url.pathname !== "/ws")) return null;

      // Accepte l'URL HTTPS du service ou son URL WSS. Une page HTTPS ne doit
      // jamais tenter une connexion WebSocket non chiffrée (bloquée par le navigateur).
      if (url.protocol === "https:") url.protocol = "wss:";
      else if (url.protocol === "http:") url.protocol = loc.protocol === "https:" ? "wss:" : "ws:";
      else if (url.protocol === "ws:" && loc.protocol === "https:") url.protocol = "wss:";
      if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
      url.pathname = "/ws";
      display = url.host;
    } else {
      url = new URL(pageUrl);
      url.protocol = loc.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws";
      url.search = "";
      url.hash = "";
    }

    // Partager l'adresse du jeu, pas celle du WebSocket si l'interface et le
    // serveur sont hébergés sur deux domaines différents.
    return { url: url.href, httpUrl: pageUrl, display };
  }

  function connect(options) {
    const target = resolveServerUrl();
    const identity = { name: options.name, character: cleanCharacter(options.character) };
    let socket = null, timer = null, retry = null;
    let closed = false, joined = false, mode = "connecting", id = null;
    let delay = 1500;
    const emit = options.onEvent;
    function setMode(value) {
      mode = value;
      if (options.onMode) options.onMode(value);
    }
    function send(message) {
      if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
    }
    function hello() {
      if (joined && mode === "online") send({ t: "hello", ...identity });
    }
    function detach() {
      clearTimeout(timer);
      timer = null;
      if (!socket) return;
      const previous = socket;
      socket = null;
      previous.onopen = previous.onmessage = previous.onerror = previous.onclose = null;
      previous.close();
    }
    function failed() {
      if (closed) return;
      const wasOnline = mode === "online";
      detach();
      id = null;
      if (wasOnline) emit({ t: "disconnected" });
      setMode("reconnect");
      if (retry !== null) return;
      retry = setTimeout(() => { retry = null; start(); }, delay);
      delay = Math.min(delay * 2, 15000);
    }
    function start() {
      if (closed) return;
      if (!target || typeof WebSocket === "undefined") { setMode("unavailable"); return; }
      try { socket = new WebSocket(target.url); } catch (_) { failed(); return; }
      // Attendre welcome, pas seulement le handshake : l'arène peut être pleine.
      timer = setTimeout(failed, 8000);
      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (!message || typeof message !== "object") return;
        if (message.t === "full") {
          detach();
          setMode("full");
          emit(message);
          retry = setTimeout(() => { retry = null; start(); }, 15000);
          return;
        }
        if (message.t === "welcome") {
          clearTimeout(timer);
          delay = 1500;
          id = message.id;
          setMode("online");
          emit(message);
          hello();
          return;
        }
        emit(message);
      };
      socket.onerror = failed;
      socket.onclose = failed;
    }
    setMode("connecting");
    start();
    return {
      get mode() { return mode; },
      get id() { return id; },
      get serverInfo() { return target; },
      join(name, character) {
        identity.name = name;
        identity.character = cleanCharacter(character);
        joined = true;
        hello();
      },
      rename(name, character) {
        identity.name = name;
        identity.character = cleanCharacter(character);
        if (joined && mode === "online") send({ t: "rename", ...identity });
      },
      sendState(state) {
        if (joined && mode === "online") send({ ...state, t: "state" });
      },
      mineBlock(column, row, serial) {
        if (joined && mode === "online") send({ t: "mineBlock", column, row, serial });
      },
      placeBlock(column, row, type, serial) {
        if (joined && mode === "online") send({ t: "placeBlock", column, row, type, serial });
      },
      pickupDrop(dropId) {
        if (joined && mode === "online") send({ t: "minePickup", dropId: String(dropId) });
      },
      close() { closed = true; clearTimeout(retry); detach(); },
    };
  }
  return { connect, resolveServerUrl };
})();
