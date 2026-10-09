/**
 * PixWorld — transport direct entre joueurs (WebRTC).
 *
 * Ce module s'enregistre dans `window.PixWorldP2P` pour `src/net.js`.
 * Il n'y a aucun serveur de jeu à héberger : les joueurs qui ouvrent le même
 * lien se retrouvent dans la même salle et échangent en direct. La mise en
 * relation utilise les traceurs WebTorrent publics (signalisation uniquement,
 * librairie Trystero embarquée dans `src/vendor/trystero/`) ; ensuite, les
 * données de jeu circulent de pair à pair, chiffrées par WebRTC.
 *
 * C'est le module `type="module"` de index.html : il est chargé en parallèle
 * du jeu et se contente d'exposer une petite API utilisée seulement quand le
 * WebSocket du site n'est pas joignable (hébergement statique, réseau
 * d'entreprise…).
 */
import { joinRoom, selfId } from "./vendor/trystero/torrent.js";

window.PixWorldP2P = {
  /** Identifiant du navigateur dans la salle (unique par session). */
  selfId,

  /** Faux si le navigateur ne sait pas faire de WebRTC. */
  available: typeof RTCPeerConnection !== "undefined",

  /**
   * Rejoint la salle `roomId` et renvoie un transport :
   *   send(message, targetPeerId?) — envoie un objet JSON à tous les pairs
   *     (ou seulement à `targetPeerId`) ;
   *   peerCount() — nombre de pairs actuellement connectés ;
   *   close() — quitte la salle.
   * Les rappels : onPeerJoin / onPeerLeave / onMessage(message, peerId) / onError.
   */
  create(options) {
    const room = joinRoom(
      {
        appId: (options && options.appId) || "pixworld",
        maxReceiveBytes: 4096,
      },
      (options && options.roomId) || "pixworld",
      {
        onJoinError: (details) => {
          if (options && options.onError) options.onError(details);
        },
      },
    );

    const action = room.makeAction("msg", {
      onMessage: (data, context) => {
        if (!options || !options.onMessage) return;
        options.onMessage(data, context.peerId);
      },
    });

    room.onPeerJoin = (peerId) => {
      if (options && options.onPeerJoin) options.onPeerJoin(peerId);
    };
    room.onPeerLeave = (peerId) => {
      if (options && options.onPeerLeave) options.onPeerLeave(peerId);
    };

    return {
      selfId,
      send(message, targetPeerId) {
        try {
          const pending = action.send(message, targetPeerId ? { target: targetPeerId } : undefined);
          if (pending && pending.catch) pending.catch(() => {});
        } catch (error) {
          /* le pair est déjà parti : on ignore */
        }
      },
      peerCount() {
        return Object.keys(room.getPeers()).length;
      },
      close() {
        try {
          room.leave();
        } catch (error) {
          /* déjà fermée */
        }
      },
    };
  },
};
