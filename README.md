# PixWorld

Jeu de plateforme 2D en HTML Canvas, **jouable à plusieurs dans le navigateur**. Choisis ton héros dans l'écran titre, puis explore un niveau pixel art animé.

Ouvre `index.html` dans un navigateur pour jouer seul, ou lance le serveur pour voir les autres joueurs en temps réel :

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

## Écran titre et héros

Le menu d'accueil apparaît dès l'ouverture du jeu. Choisis un personnage et un pseudo, puis sélectionne **Entrer dans l'arène**. Le nom et le héros choisi sont mémorisés dans le navigateur. En cours de partie, `Échap` ouvre le menu pause : tu peux reprendre, changer de héros ou revenir à l'écran titre.

Quatre combattants ont chacun **leur propre feuille de sprite** (plus aucune teinte de couleur n'est appliquée : chaque héros garde ses vraies couleurs) et leur propre attaque :

| Héros | Style | Attaque | Dégâts | Recul |
| --- | --- | --- | --- | --- |
| **Kage — Ninja** | Éclaireur rapide | Shuriken tournoyant, lancé très vite | 8 | faible |
| **Sora — Archère** | Tir à distance | Flèche de vent, décochée après l'armement de l'arc | 12 | moyen |
| **Raiden — Samouraï** | Mêlée | Coupe du tonnerre : enchaînement de trois coupes, la 3e plus large | 20 (25 pour la 3e) | fort |
| **Yume — Arcaniste** | Magie à distance | Orbe astral, après une courte incantation | 16 | fort |

Le choix du héros est synchronisé entre joueurs : sprites, mouvements, déclenchements d'attaque, points de vie et K.O. sont visibles par les autres.

## Barre de vie

Chaque joueur porte une **barre de vie** au-dessus de son personnage (et une petite jauge dans la liste des joueurs). Les attaques font de vrais dégâts :

- un projectile (shuriken, flèche, orbe) enlève des points de vie à la personne touchée ;
- la coupe de Raiden blesse en mêlée, dans l'arc lumineux qu'elle dessine ;
- chaque coup **repousse** la victime, la fait clignoter en blanc et affiche les **dégâts en chiffres flottants** ;
- côté victime : flash rouge, secousse de caméra, image « blessé » et court étourdissement ;
- sous 35 points de vie, l'écran se teinte de rouge sur les bords et le cœur bat ;
- après 5 secondes sans dégâts, la vie remonte doucement (petites étincelles vertes) ;
- à 0 point de vie, le joueur est **K.O.** : explosion d'éclats, onde de choc, flash et courte pause au sol, puis réapparition au camp de départ en pleine forme (avec une courte invulnérabilité).

Chaque client gère ses propres points de vie et les transmet aux autres 20 fois par seconde, avec un drapeau de K.O. pour que tout le monde voie l'animation. Les impacts de tes attaques sur les autres sont affichés immédiatement (étincelles, anneaux, son) ; les points de vie qui en découlent arrivent par le réseau.

## Effets sonores

Le jeu mélange deux sources, derrière une seule API (`src/audio.js`) :

- **une banque de 199 fichiers Wave** dans `assets/sfx/` — des sons libres (**CC0**) repris sur GitHub (dépôt [Daarko/sparkstream-sounds](https://github.com/Daarko/sparkstream-sounds), extraits des packs de [Kenney](https://kenney.nl)), puis **adaptés** pour PixWorld par `tools/build-sfx.mjs` : passage en mono 44,1 kHz, suppression des silences, normalisation, coupure à 0,8 s maximum et renommage par événement. Ils couvrent l'interface (survol, sélection, saisie, erreur, pause…), les déplacements (saut, atterrissage), chaque attaque (shuriken, arc qui s'arme puis décoche, coupes de sabre, incantation puis orbe), les impacts, les blessures, le K.O., la réapparition, la régénération et les arrivées / départs de joueurs ;
- **jusqu'à 6 variantes par événement**, tirées au hasard (jamais deux fois la même de suite) : un enchaînement de coups ne sonne jamais deux fois pareil ;
- **les pas, générés en code** : aucune sample, une famille de bruits par matière (herbe, terre, pierre, bois, neige) × 6 variantes, synthétisées à la volée avec des paramètres figés par hachage (`STEP_MATERIALS` dans `src/audio.js`) ;
- **une synthèse de secours** (ZzFX, [MIT](https://github.com/KilledByAPixel/ZzFX)) qui prend le relais si un fichier n'est pas encore décodé ou n'a pas pu être chargé (page ouverte en `file://`, hors ligne…) : le jeu n'est jamais silencieux.

Les fichiers sont téléchargés **à la demande**, les sons les plus fréquents d'abord, puis décodés en arrière-plan après le premier geste de l'utilisateur. Le curseur de volume du menu est mémorisé, et le bouton 🔊 du HUD (ou la touche `M`) coupe le son.

Pour régénérer la banque (ou changer la sélection de sons) :

```bash
npm run build:sfx        # télécharge le pack CC0, adapte les sons, régénère src/sfx-library.js
```

La liste des événements et de leurs variantes est décrite dans `src/sfx-library.js` (fichier généré). Provenance et licences : [`assets/CREDITS.md`](assets/CREDITS.md).

## Multijoueur

- Chaque joueur apparaît avec son personnage ; son **pseudo flotte au-dessus de lui**, avec sa **barre de vie**.
- La **liste des joueurs** en haut à droite rappelle qui est là (`Alice (vous)`, `Bob`, …), leur classe et leur vie.
- Un message s'affiche brièvement quand quelqu'un arrive ou part, ou quand tu es K.O.
- Si un joueur sort de l'écran, une **flèche à son nom** indique de quel côté il se trouve.
- Le crayon `✎` de la liste rouvre le menu pour changer de pseudo ou de héros.

### Trois modes, automatiques

| Mode | Quand ? | Ce que ça permet |
| --- | --- | --- |
| **En ligne** | Le serveur Node répond (`npm start`) | Jouer à plusieurs depuis différentes machines / navigateurs |
| **Onglets** | Pas de serveur (page ouverte directement, hébergement statique…) | Se voir entre onglets d'un même navigateur |
| **Solo** | Navigateur sans `BroadcastChannel` | Jouer seul |

Le mode est indiqué en haut à droite. Si le serveur redémarre, le jeu retente automatiquement de se reconnecter avec un délai croissant.

## Commandes

- `A` (AZERTY) ou `Q` (QWERTY), ou flèche gauche : aller à gauche
- `D` ou flèche droite : aller à droite
- `Espace` : sauter
- `X` ou clic gauche : lancer l'attaque du héros (le clic choisit aussi la direction)
- `Échap` : ouvrir le menu pause / reprendre
- `M` : couper / rétablir le son

## Structure du projet

- `index.html` — canvas, HUD et structure de l'écran titre.
- `assets/menu.css` — menu animé et responsive, sélection des héros et écran pause.
- `src/characters.js` — catalogue des combattants : feuille de sprite, réglages de combat (dégâts, recul, délai du projectile) et sons de chaque héros.
- `src/game.js` — boucle de jeu, spritesheets, barres de vie, combat (recul, K.O., combo), effets d'attaque et interpolation des joueurs distants.
- `src/effects.js` — particules, chiffres de dégâts, ondes de choc, secousses de caméra, flashs et vignette.
- `src/audio.js` — lecture des effets sonores : banque de fichiers, pas générés en code, synthèse ZzFX de secours, spatialisation, volume et sourdine.
- `src/sfx-library.js` — catalogue généré des sons (événement → variantes + gain), écrit par `tools/build-sfx.mjs`.
- `assets/sfx/` — les 199 Wave adaptés (CC0), 3 à 6 variantes par événement.
- `src/net.js` — WebSocket, repli sur `BroadcastChannel` et reconnexion.
- `tools/make-sprites.py` — générateur (Pillow) des feuilles de sprites originales de Sora et Raiden.
- `tools/build-sfx.mjs` — récupère les sons CC0 sur GitHub, les adapte (mono, 44,1 kHz, silences coupés, 0,8 s max) et régénère `assets/sfx/` + `src/sfx-library.js`.
- `server/server.js` — serveur de fichiers statiques et WebSocket sans dépendance ; relaie les états à 20 Hz, sans conserver de données.

Chaque client envoie sa position, son animation, son personnage, ses points de vie, son état de K.O. et son compteur d'attaque 20 fois par seconde. Les positions distantes sont interpolées pour rester fluides. Le monde fait 2600 px de large et est partagé par tous. Côté serveur, les pseudos sont nettoyés, les héros sont validés par liste autorisée, les nombres sont bornés, le débit est plafonné et un joueur muet pendant plus de 20 s est déconnecté.

## Tests

```bash
npm test
```

Les tests (sans dépendance) vérifient le catalogue des héros et leurs feuilles de sprites (`test/characters.test.js`), le moteur audio — synthèse de chaque preset, pas générés en code, décodage des fichiers et repli sur la synthèse avec un faux navigateur (`test/audio.test.js`), l'intégrité de la banque de sons (`test/sfx-bank.test.js`), le moteur d'effets visuels (`test/effects.test.js`) et rejouent les transports en ligne et local, la reconnexion et la synchronisation des héros / attaques à l'aide de faux WebSocket et `BroadcastChannel` (`test/net.test.js`).

## Sprites et décor

Kage et Yume utilisent des spritesheets pixel art CC0 (animations idle, course, saut, attaque, blessé et K.O.). Sora (archère à capuche verte, arc et carquois) et Raiden (samouraï au kabuto et à l'armure rouge) ont leurs **propres feuilles originales**, dessinées pour PixWorld dans le même format 256 × 128 et générées par `tools/make-sprites.py`. Aucune teinte n'est appliquée aux sprites ; la couleur d'accent de chaque héros ne sert plus qu'à l'interface (cartes du menu, pastille du pseudo, liste des joueurs). Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz. Le menu ajoute ses cadres, grilles, lueurs et rotations en CSS/canvas ; il n'intègre aucune texture tierce non créditée. Les sources et licences sont détaillées dans [`assets/CREDITS.md`](assets/CREDITS.md).
