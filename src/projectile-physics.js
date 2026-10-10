/* Réglages de physique partagés entre le navigateur et le serveur WebSocket. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PixWorldProjectilePhysics = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    ninja: Object.freeze({ speed: 590, gravity: 300, gravityDelay: 0.2, life: 1.6, scale: 1 }),
    archer: Object.freeze({ speed: 820, gravity: 760, gravityDelay: 0.28, life: 2.2, scale: 0.9 }),
    mage: Object.freeze({ speed: 430, gravity: 100, gravityDelay: 0.1, life: 2.7, scale: 1.1 }),
  });

  const RANGES = Object.freeze({
    speed: Object.freeze({ min: 180, max: 1400 }),
    gravity: Object.freeze({ min: 0, max: 2200 }),
    gravityDelay: Object.freeze({ min: 0, max: 1.5 }),
    life: Object.freeze({ min: 0.4, max: 4 }),
    scale: Object.freeze({ min: 0.5, max: 1.75 }),
  });

  function normalize(characterId, raw) {
    const base = DEFAULTS[characterId] || DEFAULTS.ninja;
    const values = raw && typeof raw === "object" ? raw : {};
    const result = {};
    Object.keys(RANGES).forEach((key) => {
      const range = RANGES[key];
      const parsed = Number(values[key]);
      const value = values[key] == null || !Number.isFinite(parsed) ? base[key] : parsed;
      result[key] = Math.min(range.max, Math.max(range.min, value));
    });
    return Object.freeze(result);
  }

  return Object.freeze({ DEFAULTS, RANGES, normalize });
});
