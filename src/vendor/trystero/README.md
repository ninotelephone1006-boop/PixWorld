# Trystero (vendored)

Mise en relation pair à pair pour le mode **direct entre joueurs** de PixWorld
(`src/p2p.js`), sans serveur de jeu.

- Source : paquets npm [`@trystero-p2p/core`](https://www.npmjs.com/package/@trystero-p2p/core)
  et [`@trystero-p2p/torrent`](https://www.npmjs.com/package/@trystero-p2p/torrent)
  version **0.26.0** (auteur : Dan Motzenbecker), licence **MIT** — voir `LICENSE`.
- Contenu : `core/` = `dist/*.mjs` de `@trystero-p2p/core`, `torrent.js` =
  `dist/index.mjs` de `@trystero-p2p/torrent`.
- Adaptations minimales, uniquement pour un chargement statique :
  - extensions renommées `.mjs` → `.js` (MIME correct sur GitHub Pages) ;
  - import nu `@trystero-p2p/core` → `./core/index.js` dans `torrent.js` ;
  - commentaires `sourceMappingURL` retirés (les `.map` ne sont pas vendus).

Aucune autre modification. Pour mettre à jour : télécharger les deux paquets
(`npm pack @trystero-p2p/core @trystero-p2p/torrent`), refaire ces trois
adaptations, et relancer `npm test`.

La stratégie `torrent` annonce la salle sur les traceurs WebTorrent publics
(`wss://open.ftorrent.com`, `wss://tracker.webtorrent.dev`,
`wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`,
`wss://tracker.files.fm:7073/announce`) — **signalisation uniquement**. Les
données de jeu circulent ensuite en WebRTC (STUN par défaut), de pair à pair.
