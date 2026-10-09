# PixWorld

Jeu de plateforme 2D en HTML Canvas, **jouable à plusieurs dans le navigateur**. Choisis ton héros dans l'écran titre, puis explore un niveau pixel art animé.

## Jouer ensemble par le lien

Ouvre le **lien public du jeu**, choisis ton héros et entre dans l’arène.
Tous les joueurs de ce site se retrouvent automatiquement : autres PC, autres
Wi-Fi, autres villes. Le bouton **Copier** partage ce même lien. Aucun champ IP,
aucun choix de serveur, aucun repli trompeur limité aux onglets.

### Mise en ligne (une fois, par le propriétaire du site)

Un serveur public est indispensable, mais les joueurs n’ont rien à configurer.
GitHub Pages et les autres hébergements purement statiques ne peuvent pas faire
tourner ce serveur WebSocket.

1. Dans Render, créer un **Blueprint** depuis ce dépôt et utiliser `render.yaml`.
2. Valider le service Node (le plan `starter` indiqué est payant et évite la mise
   en veille ; vérifier le tarif avant validation).
3. Partager l’URL **HTTPS du service web**, pas l’URL GitHub Pages.

Le service sert à la fois la page et `/ws` ; HTTPS devient automatiquement WSS.
Render fournit le port via `PORT` et termine TLS. `/healthz` sert de sonde.
Sur un autre hébergeur Node, lancer `npm ci && npm start`, avec un proxy HTTPS
qui relaie aussi l’upgrade WebSocket `/ws`.
**Garder une seule instance** : les 24 places de l’arène sont en mémoire.
Plusieurs instances nécessiteraient un état partagé, non implémenté ici.
Un redémarrage remet les connexions à zéro ; les clients se reconnectent.

Cette configuration ne déploie rien à elle seule : la création du service reste
à effectuer par le propriétaire du compte d’hébergement.

### Développement local

```sh
npm ci
npm start
# http://localhost:3000
npm test
```

Un lien localhost ou privé n’est pas accessible depuis une autre ville.

## Écran titre et héros

Le menu d'accueil apparaît dès l'ouverture du jeu. Choisis un personnage et un pseudo, puis sélectionne **Entrer dans l'arène**. Le bouton **Copier** permet de partager le lien du jeu. Le nom et le héros choisi sont mémorisés dans le navigateur. En cours de partie, `Échap` ouvre le menu pause : tu peux reprendre, changer de héros ou revenir à l'écran titre.

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

## Monde : prairie plate et terrain en blocs

Le monde est une **prairie plate** de 100 000 px de large (`src/world.js`), identique pour tous les joueurs. Son sol est un **terrain en blocs carrés** (`src/terrain.js`), que l'on peut creuser : voir la section suivante.

Le rendu est dans `src/block-view.js` pour le sol (blocs, fond de grotte, contour, fissures, objets) et dans `src/scenery.js` pour le ciel, les couches lointaines et les particules d'ambiance. Les nuages et les collines en parallaxe viennent du décor « Sunny Land » (Ansimuz) ; le dégradé du ciel, le soleil, le halo et les particules de pollen sont dessinés en code.

## Minage et inventaire

Le sol est fait de **blocs carrés de 30 px**, alignés sur la surface, du haut vers le bas :

- **1 couche d'herbe** (la surface), **4 couches de terre**, **10 couches de pierre** ;
- une **roche-mère** incassable tout en bas : sans elle, un personnage qui creuse jusqu'au bout tomberait dans le vide.

Un bloc mesure la moitié de la hauteur du héros : **deux blocs font 60 px**, la taille du personnage. Le héros fait aussi 42 px de large : il faut donc creuser un passage de **deux blocs** de large pour entrer dans un trou ou descendre.

- **Viser** : un contour blanc entoure le bloc sous la souris. Il devient rouge s'il est hors de portée (4,5 blocs autour du héros) ou incassable.
- **Miner** : maintenir le **clic gauche** sur le bloc. Des fissures apparaissent par étapes ; au bout de **deux secondes**, le bloc se casse. Relâcher le bouton, viser un autre bloc ou s'éloigner remet la progression à zéro.
- **Objets** : le bloc laisse un objet du même type, qui jaillit, retombe et se pose sur le terrain. Un objet proche est attiré vers le héros, qui le ramasse dès qu'il le touche (après un très court délai) : un bloc tombé au fond d'un trou étroit remonte donc jusqu'à lui.
- **Inventaire** : une barre de **neuf emplacements**, au centre à droite de l'écran (`src/inventory.js`, `src/hotbar.js`). Chaque emplacement affiche le bloc et sa quantité, en piles de 64. La **molette** ou les touches `1` à `9` changent l'emplacement sélectionné. Quand l'inventaire est plein, l'objet reste au sol.
- **Sons** : coups de pioche, cassure et ramassage sont synthétisés (`src/audio.js`).
- **Textures** : herbe, terre, pierre et roche-mère sont des pixel art de 16 × 16 px, tirés du dépôt GitHub [malcolmriley/unused-textures](https://github.com/malcolmriley/unused-textures) (CC BY 4.0) ; voir [`assets/CREDITS.md`](assets/CREDITS.md).

Le minage et l'inventaire sont **locaux** à chaque navigateur : un bloc miné n'est pas modifié chez les autres joueurs, et l'état repart de zéro au rechargement de la page. Un joueur qui creuse reste en revanche visible **sous la surface** pour les autres : sa profondeur est relayée par le serveur.

## Herbe interactive

Les touffes d'herbe posées sur le sol réagissent au passage des personnages, le tien comme celui des autres joueurs :

- **elles s'animent** : la touffe se courbe dans le sens de la marche, puis revient en oscillant légèrement ;
- **elles font du bruit** : un froissement court, plus discret à faible allure, et spatialisé pour les joueurs distants ;
- **parfois, quelques brins s'envolent** : environ un froissement sur trois s'accompagne de petites feuilles projetées dans le sens de la marche.

Les touffes sont posées sur la surface de la prairie, sur les blocs d'herbe : miner le bloc de surface fait disparaître sa touffe, et un personnage enfoncé sous la surface ne la fait pas plier. Sauter au-dessus d'une touffe ne la fait pas bouger, et une marche trop lente ne produit ni son ni brin. Au repos, le rendu est identique à celui du décor d'origine. La logique est dans `src/grass.js`, séparée du dessin et du son.

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

### Connexion automatique

Le statut indique connexion, en ligne, reconnexion, arène pleine ou hors ligne.
Les tentatives reprennent automatiquement, même si le service était indisponible
à l’ouverture. Une coupure retire les anciens joueurs de l’écran. Aucun autre
transport ne crée une arène séparée en silence.

Le combat actuel reste simulé côté client : les attaques, la vie et les K.O.
sont synchronisés, mais ce prototype n’est pas un serveur de combat anti-triche.

## Commandes

- `A` (AZERTY) ou `Q` (QWERTY), ou flèche gauche : aller à gauche
- `D` ou flèche droite : aller à droite
- `Espace` : sauter
- `X` : lancer l'attaque du héros
- clic gauche maintenu sur un bloc à portée : miner (deux secondes)
- molette ou touches `1` à `9` : choisir un emplacement de la barre d'inventaire
- `Échap` : ouvrir le menu pause / reprendre
- `M` : couper / rétablir le son

## Structure du projet

- `index.html` — canvas, HUD et structure de l'écran titre.
- `assets/menu.css` — menu animé et responsive, sélection des héros et écran pause.
- `src/characters.js` — catalogue des combattants : feuille de sprite, réglages de combat (dégâts, recul, délai du projectile) et sons de chaque héros.
- `src/game.js` — boucle de jeu, spritesheets, barres de vie, combat (recul, K.O., combo), effets d'attaque, interpolation des joueurs distants et touffes d'herbe du sol.
- `src/effects.js` — particules (dont les brins d'herbe), chiffres de dégâts, ondes de choc, secousses de caméra, flashs et vignette.
- `src/world.js` — monde : prairie plate, sur 100 000 px de large.
- `src/scenery.js` — ciel, couches lointaines, particules d'ambiance et voile de couleur.
- `src/terrain.js` — terrain en blocs : couches herbe, terre, pierre et roche-mère, casse des blocs, collisions (sol, murs, plafond) au pas de 2 px.
- `src/mining.js` — minage au clic maintenu : case visée, progression de 2 s, portée, coups sonores.
- `src/drops.js` — objets lâchés par les blocs : chute, attraction vers le héros, ramassage au contact.
- `src/inventory.js` — inventaire de neuf emplacements, piles de 64, sélection en boucle.
- `src/block-view.js` — rendu des blocs : textures agrandies une fois, fond de grotte, contour, fissures, objets lâchés.
- `src/hotbar.js` — barre d'inventaire à l'écran, au centre à droite, avec quantités et étiquette du bloc choisi.
- `assets/blocks/` — textures pixel art 16 × 16 : herbe, terre, pierre, roche-mère (CC BY 4.0).
- `src/grass.js` — herbe interactive : ressort de chaque touffe du sol, froissements et brins, calculés sans dessin ni son (`window.PixWorldGrass`).
- `src/audio.js` — lecture des effets sonores : banque de fichiers, pas d'herbe échantillonnés, froissement de l'herbe synthétisé, autres matières synthétisées en secours, spatialisation, volume et sourdine.
- `src/sfx-library.js` — catalogue généré des sons (événement → variantes, sources d'origine et gain), écrit par `tools/build-sfx.mjs`.
- `assets/sfx/` — les 199 Wave adaptés (CC0), 3 à 8 variantes par événement.
- `src/net.js` — WebSocket sur la même origine et reconnexion automatique.
- `tools/make-sprites.py` — générateur (Pillow) des feuilles de sprites originales de Sora et Raiden.
- `tools/build-sfx.mjs` — récupère les sons CC0 sur GitHub, les adapte (mono, 44,1 kHz, silences coupés, 0,8 s max) et régénère `assets/sfx/` + `src/sfx-library.js`.
- `server/server.js` — serveur de fichiers statiques et WebSocket sans dépendance ; relaie les états à 20 Hz, sans conserver de données. Il écoute sur toutes les interfaces et fournit `/healthz` pour le déploiement.

Chaque client envoie sa position (y compris sa profondeur sous la surface), son animation, son personnage, ses points de vie, son état de K.O. et son compteur d'attaque 20 fois par seconde. Les positions distantes sont interpolées pour rester fluides. Le monde est une prairie plate de 100 000 px de large, identique pour tous ; seuls les blocs minés restent locaux. Côté serveur, les pseudos sont nettoyés, les héros sont validés par liste autorisée, les nombres sont bornés, le débit est plafonné et un joueur muet pendant plus de 20 s est déconnecté.

## Tests

```bash
npm test
```

Les tests (sans dépendance) vérifient le catalogue des héros et leurs feuilles de sprites (`test/characters.test.js`), le moteur audio — synthèse de chaque preset, lecture des pas d'herbe dédiés, décodage des fichiers et repli synthèse avec un faux navigateur (`test/audio.test.js`), l'intégrité et la correspondance des sources de la banque de sons (`test/sfx-bank.test.js`), le moteur d'effets visuels, brins compris (`test/effects.test.js`), le monde plat — prairie unique, sol sans relief, déplacements sans chute (`test/world.test.js`), le rendu du ciel et du décor sur un contexte factice (`test/scenery.test.js`), l'herbe interactive — pose des touffes, courbure et retour au repos, froissements espacés, brins occasionnels (`test/grass.test.js`) — et vérifient la connexion automatique, la reconnexion, les erreurs et la synchronisation des héros / attaques (`test/net.test.js`). Le minage est couvert par `test/terrain.test.js` (couches, collisions, puits et tunnels de deux blocs), `test/mining.test.js` (clic maintenu, portée, roche-mère), `test/drops.test.js` (chute, attraction, ramassage), `test/inventory.test.js` (piles, défilement), `test/block-view.test.js` (rendu sur contexte factice et textures présentes) et `test/hotbar.test.js` (barre sur faux DOM).

## Sprites et décor

Kage et Yume utilisent des spritesheets pixel art CC0 (animations idle, course, saut, attaque, blessé et K.O.). Sora (archère à capuche verte, arc et carquois) et Raiden (samouraï au kabuto et à l'armure rouge) ont leurs **propres feuilles originales**, dessinées pour PixWorld dans le même format 256 × 128 et générées par `tools/make-sprites.py`. Aucune teinte n'est appliquée aux sprites ; la couleur d'accent de chaque héros ne sert plus qu'à l'interface (cartes du menu, pastille du pseudo, liste des joueurs). Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz. Le menu ajoute ses cadres, grilles, lueurs et rotations en CSS/canvas ; il n'intègre aucune texture tierce non créditée. Les sources et licences sont détaillées dans [`assets/CREDITS.md`](assets/CREDITS.md).
