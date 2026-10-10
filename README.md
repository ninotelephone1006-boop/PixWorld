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

Par défaut, la page et le WebSocket utilisent la même adresse publique. Si
l’interface et le serveur sont hébergés séparément, configure **une seule URL
publique de serveur pour tous les joueurs**, avant le chargement de `src/net.js` :

```html
<script>
  window.PixWorldConfig = { serverUrl: "https://pixworld-server.onrender.com" };
</script>
<script src="src/net.js"></script>
```

L’URL HTTPS est automatiquement convertie en WSS ; une URL WSS finissant par
`/ws` fonctionne aussi. Les joueurs partagent alors le lien de la page du jeu,
mais chaque navigateur rejoint le même WebSocket central. Ne configure pas
`localhost`, `127.0.0.1` ou une IP privée pour une partie entre villes : ces
adresses ne sont visibles que sur l’appareil ou le réseau local qui les héberge.

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

Le choix du héros est synchronisé entre joueurs : sprites, mouvements, déclenchements d'attaque, points de vie et K.O. sont visibles par les autres. Le sprite se tourne vers le curseur (gauche / droite), même en marchant dans l'autre sens ; le regard suit aussi le défilement de la caméra. Sans curseur actif, notamment au toucher, il garde le sens de la marche.

**Les projectiles visent le curseur et retombent.** Shuriken, flèche et orbe partent dans la direction du pointeur, pas seulement à gauche ou à droite : tu peux tirer en l'air, en diagonale ou vers le sol. Une gravité propre à chaque attaque courbe ensuite leur vol : le shuriken retombe doucement, la flèche plus franchement et l'orbe reste léger. Le projectile pivote dans son sens de vol (sa traînée aussi). Les tirs des autres joueurs suivent leur curseur partagé, avec la même physique que chez eux : rien n'est négocié sur le réseau. Sans curseur connu (souris hors de la fenêtre, toucher), le tir file droit devant le personnage. Les blocs arrêtent toujours le projectile au premier contact, quelle que soit la trajectoire.

**Paramètres d'affichage du tir.** Le bouton **⚙ Paramètres** du HUD (ou `P`) ouvre le panneau. La physique des projectiles n'y figure **pas** : vitesse, gravité, début de la chute, durée du vol, taille et zone de collision sont fixés par le jeu (`src/projectile-physics.js`) et sont les mêmes pour tous les joueurs. Personne ne peut les modifier dans l'interface ni les envoyer par le réseau — le serveur ne lit aucun champ `projectile`, et un ancien `pixworld.projectile-settings` retrouvé dans le navigateur est supprimé sans être relu.

Le panneau montre ces valeurs en lecture seule pour le héros courant (une note remplace le récapitulatif de Raiden, qui combat à l'épée) et ne propose que trois réglages personnels, purement visuels et sauvegardés sur l'appareil :

- **Tracer la trajectoire avant le tir** : affiche l'arc prévu, en pointillés, jusqu'au sol, au premier mur ou à la fin du vol ;
- **Longueur de l'aperçu** : borne la partie d'arc affichée, sans jamais dépasser la durée de vie du tir ;
- **Afficher les traînées** : masque ou montre les effets de vitesse derrière les tirs.

## Barre de vie

Chaque joueur porte une **barre de vie** au-dessus de son personnage (et une petite jauge dans la liste des joueurs). Les attaques font de vrais dégâts :

- un projectile (shuriken, flèche, orbe) enlève des points de vie à la personne touchée ;
- la coupe de Raiden blesse en mêlée, dans l'arc lumineux qu'elle dessine ;
- les **blocs naturels et posés bloquent les attaques** : les tirs disparaissent avec un impact sur la paroi et la mêlée ne peut pas blesser à travers un mur ;
- chaque coup **repousse** la victime, la fait clignoter en blanc et affiche les **dégâts en chiffres flottants** ;
- côté victime : flash rouge, secousse de caméra, image « blessé » et court étourdissement ;
- sous 35 points de vie, l'écran se teinte de rouge sur les bords et le cœur bat ;
- après 5 secondes sans dégâts, la vie remonte doucement (petites étincelles vertes) ;
- à 0 point de vie, le joueur est **K.O.** : son **inventaire tombe sur place**, avec explosion d'éclats, onde de choc, flash et courte pause au sol, puis réapparition au camp de départ en pleine forme, sans restauration du stuff perdu (avec une courte invulnérabilité).

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

## Minage 2D et inventaire

Le terrain de chaque colonne est une grille de blocs carrés de **32 × 32 px** : **1 couche d'herbe**, **4 couches de terre**, puis **10 couches de pierre** — la dernière est de la **roche mère incassable**, le plancher du monde : personne ne tombe dans le vide, et les blocs forment de vraies parois solides (collisions complètes, on ne traverse ni les murs ni les tours). Les textures pixel art de l'herbe, de la terre et de la pierre sont générées par `tools/make-blocks.py` depuis la feuille de tuiles CC0 « Pixel Platformer » de Kenney (source GitHub et licence dans `assets/CREDITS.md`) : chaque texture est **sans couture** (miroitée), donc les blocs se prolongent **sans aucune délimitation visible** entre eux.

- Le bloc visé par la souris reçoit un contour lumineux. Maintiens le clic gauche sur le même bloc pendant **2 secondes** : les fissures progressent, puis le bloc casse et laisse tomber un petit item.
- **Clic droit : poser le bloc sélectionné**, façon Minecraft — uniquement contre un bloc existant (jamais en plein air), à portée de main et jamais à l'intérieur d'un joueur. Casser un bloc d'une tour ne fait rien d'autre : rien ne s'effondre. Les blocs posés dans un trou déjà miné restent cassables, même après plusieurs cycles de pose / casse ou une reconnexion.
- Touche un item pour l'ajouter automatiquement à ton inventaire. Les quantités sont personnelles ; dans l'arène en ligne, le terrain cassé, les blocs posés et les drops sont synchronisés, et le premier joueur qui touche un drop le récupère.
- **Butin de mort** : tout le stock d'herbe, de terre et de pierre est lâché à la position exacte du K.O., en une pile par type avec sa quantité. Le corps ne ramasse rien ; après réapparition, toi ou un autre joueur pouvez récupérer les piles entières. Elles restent disponibles jusqu'au ramassage (ou au redémarrage du serveur / à la fermeture de l'onglet hors ligne), sans casser les blocs autour.
- La barre verticale de raccourcis, au **milieu du bord droit**, affiche les trois blocs et leurs quantités. Fais défiler la molette (ou utilise `1`, `2`, `3`) pour changer d'emplacement ; tu peux aussi cliquer sur un emplacement.
- **Caméra verticale** : en surface, seules **deux rangées de blocs** sont visibles sous le sol (herbe + terre) — la roche n'apparaît que lorsqu'on creuse, la caméra descendant alors avec le joueur.
- Les modifications du terrain sont gardées en mémoire par le serveur de l'arène ; elles sont partagées par les joueurs connectés et disparaissent lors d'un redémarrage du serveur. Sans connexion, le minage et la pose fonctionnent localement dans l'onglet.

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
- Tu vois le **curseur des autres joueurs** en direct : une flèche à leur couleur, avec leur pseudo, exactement là où ils visent à l'écran.

### Discussion et commandes

`T` ouvre la discussion en bas à gauche. `Entrée` envoie, `Échap` (ou un clic
dans le monde) referme et rend la main au jeu ; le journal reste affiché
quelques secondes après le dernier message. Le clavier appartient alors au
champ de saisie : on ne court pas, on ne saute pas et on n'attaque pas en
écrivant, mais **la barre d'espace s'écrit normalement** — les commandes à
plusieurs arguments sont donc tapables sans rien avaler.

| Commande | Effet |
| --- | --- |
| `/tp "joueur" "destination"` | téléporte le premier joueur sur le second |
| `/tp "destination"` | t'y téléporte toi-même |
| `/kill "joueur"` | met le joueur K.O. (il lâche son inventaire et réapparaît au camp) |
| `/aide` | rappelle la liste des commandes |

Les pseudos avec des espaces s'écrivent entre guillemets (`/kill "Le Bricoleur"`) ;
à défaut, la recherche accepte un début ou un fragment de pseudo, et signale
les homonymes. C'est le serveur qui résout les noms : il n'avertit que le
client concerné, qui joue l'effet chez lui — comme le reste du combat.

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
- `P` : ouvrir / fermer les paramètres d'affichage (aperçu de trajectoire, longueur de l'aperçu, traînées)
- `T` : ouvrir la discussion (`Entrée` envoie, `Échap` referme, `/tp` et `/kill` commandent l'arène)
- Clic gauche sur un bloc : miner (maintenir 2 secondes) ; clic dans le vide : attaque du héros
- Clic droit : poser le bloc sélectionné (contre un bloc existant, à portée)
- Molette (ou `1` / `2` / `3`) : sélectionner l'emplacement de raccourci
- `Échap` : ouvrir le menu pause / reprendre
- `M` : couper / rétablir le son

## Structure du projet

- `index.html` — canvas, HUD et structure de l'écran titre.
- `assets/menu.css` — menu animé et responsive, sélection des héros et écran pause.
- `src/characters.js` — catalogue des combattants : feuille de sprite, réglages de combat (dégâts, recul, délai du projectile) et sons de chaque héros.
- `src/projectile-physics.js` — table figée des projectiles (vitesse, gravité, chute, durée, taille) : identique pour tous les joueurs, aucune valeur réglable ni relayée.
- `src/game.js` — boucle de jeu, spritesheets, barres de vie, combat (recul, K.O., combo), physique des projectiles et aperçu, préférences d'affichage, minage, drops et joueurs distants.
- `src/mining.js` — grille de blocs (herbe, terre, pierre), temps de minage, collisions de surface, drops physiques et inventaire (`window.PixWorldMining`).
- `assets/blocks/` — textures pixel art CC0 des blocs minables et atlas source Kenney.
- `src/effects.js` — particules (dont les brins d'herbe), chiffres de dégâts, ondes de choc, secousses de caméra, flashs et vignette.
- `src/world.js` — monde procédural : graine, biomes en bandes, relief, plateformes, décor placé et collisions (atterrissage, appui sur le relief).
- `src/scenery.js` — rendu des biomes : textures de sol peintes à la volée, ciels, couches lointaines, surfaces (herbe, neige, cendre), décor, plateformes et particules d'ambiance.
- `src/grass.js` — herbe interactive : ressort de chaque touffe du sol, froissements et brins, calculés sans dessin ni son (`window.PixWorldGrass`).
- `src/audio.js` — lecture des effets sonores : banque de fichiers, pas d'herbe échantillonnés, froissement de l'herbe synthétisé, autres matières synthétisées en secours, spatialisation, volume et sourdine.
- `src/sfx-library.js` — catalogue généré des sons (événement → variantes, sources d'origine et gain), écrit par `tools/build-sfx.mjs`.
- `assets/sfx/` — les 199 Wave adaptés (CC0), 3 à 8 variantes par événement.
- `src/net.js` — WebSocket sur la même origine, reconnexion automatique et envoi des lignes de discussion.
- `tools/make-sprites.py` — générateur (Pillow) des feuilles de sprites originales de Sora et Raiden.
- `tools/build-sfx.mjs` — récupère les sons CC0 sur GitHub, les adapte (mono, 44,1 kHz, silences coupés, 0,8 s max) et régénère `assets/sfx/` + `src/sfx-library.js`.
- `server/server.js` — serveur de fichiers statiques et WebSocket sans dépendance ; relaie les états à 20 Hz et synchronise les blocs minés / les drops dans l'arène (état en mémoire). Il diffuse aussi la discussion, résout les pseudos des commandes `/tp` et `/kill` et n'avertit que le client concerné. Il écoute sur toutes les interfaces et fournit `/healthz` pour le déploiement.

Chaque client envoie sa position, son animation, son personnage, ses points de vie, son état de K.O., son compteur d'attaque et la position de son curseur 20 fois par seconde. Les positions distantes (joueurs comme curseurs) sont interpolées pour rester fluides. Le monde est généré à partir d'une graine commune. Côté serveur, les pseudos sont nettoyés, les héros sont validés par liste autorisée, les nombres sont bornés, le débit est plafonné, la discussion est limitée à huit lignes par tranche de 5 s, le terrain miné et les drops actifs restent en mémoire, et un joueur muet pendant plus de 20 s est déconnecté.

## Tests

```bash
npm test
```

Le démarrage complet de la page est rejoué sans navigateur (`test/game-boot.test.js`) : chargement des scripts, quatre héros affichés, connexion à l'arène, entrée en jeu et arrivée d'un autre joueur — de quoi repérer immédiatement un script qui planterait au chargement.

Les tests vérifient aussi le catalogue des héros et leurs feuilles de sprites (`test/characters.test.js`), le moteur audio et la banque de sons (`test/audio.test.js`, `test/sfx-bank.test.js`), les effets visuels (`test/effects.test.js`), le monde et son rendu (`test/world.test.js`, `test/scenery.test.js`), l'herbe interactive (`test/grass.test.js`), le système de minage — couches, temps, collisions, drops, quantités et état partagé (`test/mining.test.js`) — ainsi que le réseau : reconnexion, états verticaux, rejet du champ `projectile` qu'un client enverrait, minage partagé et ramassage unique du butin (`test/net.test.js`, `test/server.test.js`). Les scénarios de combat (`test/combat.test.js`) rejouent les quatre styles d'attaque face à un mur, la mort avec inventaire, la réapparition, les confirmations réseau tardives et la récupération du stuff hors ligne. Les entrées (`test/input.test.js`) couvrent la visée au curseur en marchant dans l'autre sens, le déplacement de caméra, le HUD, la pause et le toucher, les préférences d'affichage sauvegardées, la courbure par gravité, l'aperçu en pointillés avant le lancement et l'ignorance des physiques de tir trafiquées. La discussion (`test/chat.test.js`) rejoue la touche `T`, l'envoi d'une ligne - espaces et guillemets compris -, l'affichage des messages reçus, l'exécution des commandes `/tp` et `/kill`, le relais des curseurs et le repli hors ligne. Les tests de minage et de serveur vérifient aussi les trous rebouchés plusieurs fois et le minage maintenu lorsqu'un bloc est reposé entre deux images.

## Sprites et décor

Kage et Yume utilisent des spritesheets pixel art CC0 (animations idle, course, saut, attaque, blessé et K.O.). Sora (archère à capuche verte, arc et carquois) et Raiden (samouraï au kabuto et à l'armure rouge) ont leurs **propres feuilles originales**, dessinées pour PixWorld dans le même format 256 × 128 et générées par `tools/make-sprites.py`. Aucune teinte n'est appliquée aux sprites ; la couleur d'accent de chaque héros ne sert plus qu'à l'interface (cartes du menu, pastille du pseudo, liste des joueurs). Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz. Le menu ajoute ses cadres, grilles, lueurs et rotations en CSS/canvas ; il n'intègre aucune texture tierce non créditée. Les sources et licences sont détaillées dans [`assets/CREDITS.md`](assets/CREDITS.md).
