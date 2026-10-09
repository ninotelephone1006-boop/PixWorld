# PixWorld

Jeu de plateforme 2D en HTML Canvas, **jouable à plusieurs dans le navigateur**. Choisis ton héros dans l'écran titre, puis explore un niveau pixel art animé.

Ouvre `index.html` dans un navigateur pour jouer seul, ou lance le serveur pour voir les autres joueurs en temps réel — depuis le même PC **ou depuis n'importe quel autre ordinateur du réseau** :

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

## Jouer à plusieurs depuis plusieurs PC

Le PC qui lance `npm start` **héberge** la partie. Au démarrage, le serveur affiche les adresses à partager :

```console
PixWorld — http://localhost:3000 (websocket sur /ws)
Pour rejoindre depuis un autre PC :
  http://192.168.1.24:3000
```

Ensuite, trois façons de rejoindre — à choisir selon ce qui est le plus simple :

| Depuis l'autre PC | Comment faire |
| --- | --- |
| **Ouvrir l'adresse du serveur** | Lance un navigateur sur `http://192.168.1.24:3000` : l'autre PC télécharge le jeu *et* se connecte. Rien à configurer. |
| **Entrer l'adresse dans le menu** | Ouvre PixWorld comme tu veux (`index.html`, hébergement statique…) puis, dans l'écran titre, champ **« Rejoindre une partie »**, entre `192.168.1.24:3000` et clique sur **Rejoindre**. L'adresse est mémorisée pour la prochaine fois. |
| **Suivre un lien tout prêt** | Ouvre `http://192.168.1.24:3000/?server=192.168.1.24:3000` : le paramètre `?server=` indique directement quel serveur rejoindre. |

L'adresse acceptée tous les formats : `192.168.1.24`, `192.168.1.24:8080`, `http://192.168.1.24:3000`, `ws://192.168.1.24:3000/ws`. Sans précision, le port est celui de la page (ou 3000).

Pendant la partie, l'écran titre affiche l'adresse à envoyer à tes amis (bouton **Copier**) : elle est fournie par le serveur lui-même (`GET /info`), qui liste ses adresses réseau.

Quelques rappels utiles :

- les deux PC doivent être sur le **même réseau** (même Wi-Fi, même box) ; au-delà, il faut ouvrir/rediriger le port (`3000` par défaut) sur la box ;
- un pare-feu peut bloquer la connexion : autorise Node.js sur le réseau privé ;
- pour héberger sur Internet, remplace l'adresse locale par l'adresse publique ou un tunnel (ngrok, Cloudflare Tunnel…) ;
- en https, le navigateur refuse de joindre un serveur en clair : ouvre le jeu depuis le serveur lui-même (`http://<IP>:3000`) plutôt que depuis une page https.

## Écran titre et héros

Le menu d'accueil apparaît dès l'ouverture du jeu. Choisis un personnage et un pseudo, puis sélectionne **Entrer dans l'arène**. Le champ **Rejoindre une partie** du même écran permet de viser le serveur hébergé par un autre PC (voir plus bas). Le nom et le héros choisi sont mémorisés dans le navigateur. En cours de partie, `Échap` ouvre le menu pause : tu peux reprendre, changer de héros ou revenir à l'écran titre.

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

## Monde procédural et biomes

Le niveau n'est plus un simple plat : il est **généré à partir d'une graine** (`src/world.js`). Tous les joueurs partagent la même graine, donc voient le même relief, les mêmes plateformes et le même décor, sans rien échanger de plus sur le réseau.

- **Quatre biomes**, disposés en bandes le long du monde (environ 8 300 px au total) : la **prairie** du départ, puis trois biomes dans un ordre propre à la graine :
  - **Dunes dorées** — sable, cactus, arbres morts, ruines de grès, soleil brûlant et particules de sable qui filent ;
  - **Taïga gelée** — pins enneigés, congères, stalactites de glace, neige qui tombe ;
  - **Terres de cendre** — roche basaltique aux fissures incandescentes, mares de lave, cheminées qui fument, braises qui montent.
- **Relief** : des collines plus ou moins hautes selon le biome, qui se fondent doucement d'un biome à l'autre. Le relief est toujours franchissable à pied.
- **Plateformes flottantes** : on les atteint en sautant, on se pose dessus par le haut et on les traverse par-dessous.
- **Annonce** : entrer dans un nouveau biome affiche son nom et sa description.
- **Herbe interactive** : elle ne se trouve que dans la prairie ; ailleurs, personne ne la plie.

Le rendu est dans `src/scenery.js` : les textures de sol (corps de terre, sable, neige, basalte) sont **peintes à la volée** sur de petites toiles, sans image à télécharger ; le ciel est en dégradé avec soleil et halo ; des couches lointaines en silhouettes défilent en parallaxe ; le relief porte une surface propre à son biome (herbe, congères, cendre) ; des particules d'ambiance et un voile de couleur complètent l'ambiance. La prairie garde ses décors d'origine (Sunny Land) fondus avec le reste.

## Herbe interactive

Les touffes d'herbe posées sur le sol réagissent au passage des personnages, le tien comme celui des autres joueurs :

- **elles s'animent** : la touffe se courbe dans le sens de la marche, puis revient en oscillant légèrement ;
- **elles font du bruit** : un froissement court, plus discret à faible allure, et spatialisé pour les joueurs distants ;
- **parfois, quelques brins s'envolent** : environ un froissement sur trois s'accompagne de petites feuilles projetées dans le sens de la marche.

Les touffes sont posées sur le relief de la prairie. L'herbe du premier plan, au bas de l'écran, reste décorative. Sauter au-dessus d'une touffe ne la fait pas bouger, et une marche trop lente ne produit ni son ni brin. Au repos, le rendu est identique à celui du décor d'origine. La logique est dans `src/grass.js`, séparée du dessin et du son.

## Effets sonores

Le jeu mélange deux sources, derrière une seule API (`src/audio.js`) :

- **une banque de 199 fichiers Wave**, répartis entre 41 événements dans `assets/sfx/` — des sons libres (**CC0**) repris sur GitHub (dépôt [Daarko/sparkstream-sounds](https://github.com/Daarko/sparkstream-sounds), extraits des packs de [Kenney](https://kenney.nl)), puis **adaptés** pour PixWorld par `tools/build-sfx.mjs` : passage en mono 44,1 kHz, suppression des silences, normalisation, coupure à 0,8 s maximum et renommage par événement. Les pas utilisent des prises d'herbe dédiées ; le lancement de l'orbe utilise un souffle de combustion et son impact une explosion, plutôt que des sons de laser ou de métal ;
- **jusqu'à 8 variantes par événement**, tirées au hasard (jamais deux fois la même de suite) : un enchaînement de coups ne sonne jamais deux fois pareil ;
- **les pas**, avec cinq samples enregistrés sur l'herbe du niveau ; les matières sans banque dédiée (terre, pierre, bois, neige) disposent de six variantes synthétisées en secours (`STEP_MATERIALS` dans `src/audio.js`) ;
- **le froissement de l'herbe** : le pack CC0 n'en contient pas, il est donc **synthétisé** dans `src/audio.js` (quatre variantes, jamais deux identiques de suite) ;
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
| **En ligne** | Le serveur Node répond (`npm start`) | Jouer à plusieurs depuis différentes machines / navigateurs (le serveur peut être sur un autre PC : voir plus haut) |
| **Onglets** | Pas de serveur (page ouverte directement, hébergement statique…) | Se voir entre onglets d'un même navigateur |
| **Solo** | Navigateur sans `BroadcastChannel` | Jouer seul |

Le mode est indiqué en haut à droite. Si le serveur redémarre, le jeu retente automatiquement de se reconnecter avec un délai croissant.

Quand la partie est hébergée ailleurs, le bandeau affiche l'adresse du serveur visé (`Connecté à 192.168.1.24:3000`) au lieu du simple « en ligne ».

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
- `src/game.js` — boucle de jeu, spritesheets, barres de vie, combat (recul, K.O., combo), effets d'attaque, interpolation des joueurs distants et touffes d'herbe du sol.
- `src/effects.js` — particules (dont les brins d'herbe), chiffres de dégâts, ondes de choc, secousses de caméra, flashs et vignette.
- `src/world.js` — monde procédural : graine, biomes en bandes, relief, plateformes, décor placé et collisions (atterrissage, appui sur le relief).
- `src/scenery.js` — rendu des biomes : textures de sol peintes à la volée, ciels, couches lointaines, surfaces (herbe, neige, cendre), décor, plateformes et particules d'ambiance.
- `src/grass.js` — herbe interactive : ressort de chaque touffe du sol, froissements et brins, calculés sans dessin ni son (`window.PixWorldGrass`).
- `src/audio.js` — lecture des effets sonores : banque de fichiers, pas d'herbe échantillonnés, froissement de l'herbe synthétisé, autres matières synthétisées en secours, spatialisation, volume et sourdine.
- `src/sfx-library.js` — catalogue généré des sons (événement → variantes, sources d'origine et gain), écrit par `tools/build-sfx.mjs`.
- `assets/sfx/` — les 199 Wave adaptés (CC0), 3 à 8 variantes par événement.
- `src/net.js` — adresse du serveur à rejoindre (`resolveServerUrl`), WebSocket, repli sur `BroadcastChannel` et reconnexion.
- `tools/make-sprites.py` — générateur (Pillow) des feuilles de sprites originales de Sora et Raiden.
- `tools/build-sfx.mjs` — récupère les sons CC0 sur GitHub, les adapte (mono, 44,1 kHz, silences coupés, 0,8 s max) et régénère `assets/sfx/` + `src/sfx-library.js`.
- `server/server.js` — serveur de fichiers statiques et WebSocket sans dépendance ; relaie les états à 20 Hz, sans conserver de données. Il écoute sur toutes les interfaces (les autres PC peuvent rejoindre), affiche ses adresses réseau au démarrage et les expose sur `GET /info`.

Chaque client envoie sa position, son animation, son personnage, ses points de vie, son état de K.O. et son compteur d'attaque 20 fois par seconde. Les positions distantes sont interpolées pour rester fluides. Le monde est généré à partir d'une graine commune (environ 8 300 px de large) et partagé par tous. Côté serveur, les pseudos sont nettoyés, les héros sont validés par liste autorisée, les nombres sont bornés, le débit est plafonné et un joueur muet pendant plus de 20 s est déconnecté.

## Tests

```bash
npm test
```

Les tests (sans dépendance) vérifient le catalogue des héros et leurs feuilles de sprites (`test/characters.test.js`), le moteur audio — synthèse de chaque preset, lecture des pas d'herbe dédiés, décodage des fichiers et repli synthèse avec un faux navigateur (`test/audio.test.js`), l'intégrité et la correspondance des sources de la banque de sons (`test/sfx-bank.test.js`), le moteur d'effets visuels, brins compris (`test/effects.test.js`), le monde procédural — graine, biomes, marchabilité du relief, plateformes atteignables et atterrissages (`test/world.test.js`), le rendu des biomes sur un contexte factice (`test/scenery.test.js`), l'herbe interactive — pose des touffes, courbure et retour au repos, froissements espacés, brins occasionnels (`test/grass.test.js`) — et rejouent les transports en ligne et local, la reconnexion, l'adresse du serveur à rejoindre (`192.168.1.24`, `?server=…`, adresse mémorisée, changement de serveur en cours de partie) et la synchronisation des héros / attaques à l'aide de faux WebSocket et `BroadcastChannel` (`test/net.test.js`).

## Sprites et décor

Kage et Yume utilisent des spritesheets pixel art CC0 (animations idle, course, saut, attaque, blessé et K.O.). Sora (archère à capuche verte, arc et carquois) et Raiden (samouraï au kabuto et à l'armure rouge) ont leurs **propres feuilles originales**, dessinées pour PixWorld dans le même format 256 × 128 et générées par `tools/make-sprites.py`. Aucune teinte n'est appliquée aux sprites ; la couleur d'accent de chaque héros ne sert plus qu'à l'interface (cartes du menu, pastille du pseudo, liste des joueurs). Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz. Le menu ajoute ses cadres, grilles, lueurs et rotations en CSS/canvas ; il n'intègre aucune texture tierce non créditée. Les sources et licences sont détaillées dans [`assets/CREDITS.md`](assets/CREDITS.md).
