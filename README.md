# PixWorld

Jeu de plateforme 2D en HTML Canvas, **jouable à plusieurs dans le navigateur**. Choisis ton héros dans l'écran titre, puis explore un niveau pixel art animé.

Ouvre `index.html` dans un navigateur pour jouer seul, ou lance le serveur pour voir les autres joueurs en temps réel :

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

## Écran titre et héros

Le menu d'accueil apparaît dès l'ouverture du jeu. Choisis un personnage, un pseudo et une couleur d'aura, puis sélectionne **Entrer dans l'arène**. Le nom, la couleur et le héros choisi sont mémorisés dans le navigateur. En cours de partie, `Échap` ouvre le menu pause : tu peux reprendre, changer de héros ou revenir à l'écran titre.

Quatre combattants ont chacun leur sprite animé et leur propre attaque visuelle :

| Héros | Style | Attaque |
| --- | --- | --- |
| **Kage — Ninja** | Éclaireur rapide | Shuriken tournoyant |
| **Sora — Archère** | Tir à distance rapide | Flèche de vent |
| **Raiden — Samouraï** | Mêlée | Coupe du tonnerre en arc |
| **Yume — Arcaniste** | Magie à distance | Orbe astral lumineux |

Le choix du héros est synchronisé entre joueurs : sprites, mouvements et déclenchements d'attaque sont visibles par les autres. Les attaques sont des effets de combat visuels ; le prototype n'a pas encore de système de points de vie ou de dégâts.

## Multijoueur

- Chaque joueur apparaît avec son personnage et son aura ; son **pseudo flotte au-dessus de lui**.
- La **liste des joueurs** en haut à droite rappelle qui est là (`Alice (vous)`, `Bob`, …) et indique leur classe.
- Un message s'affiche brièvement quand quelqu'un arrive ou part.
- Si un joueur sort de l'écran, une **flèche à son nom** indique de quel côté il se trouve.
- Le crayon `✎` de la liste rouvre le menu pour changer de pseudo, de couleur ou de héros.

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

## Structure du projet

- `index.html` — canvas, HUD et structure de l'écran titre.
- `assets/menu.css` — menu animé et responsive, sélection des héros et écran pause.
- `src/characters.js` — catalogue des combattants et réglages de leurs attaques.
- `src/game.js` — boucle de jeu, spritesheets, effets d'attaque et interpolation des joueurs distants.
- `src/net.js` — WebSocket, repli sur `BroadcastChannel` et reconnexion.
- `server/server.js` — serveur de fichiers statiques et WebSocket sans dépendance ; relaie les états à 20 Hz, sans conserver de données.

Chaque client envoie sa position, son animation, son personnage et son compteur d'attaque 20 fois par seconde. Les positions distantes sont interpolées pour rester fluides. Le monde fait 2600 px de large et est partagé par tous. Côté serveur, les pseudos sont nettoyés, les héros sont validés par liste autorisée, les nombres sont bornés, le débit est plafonné et un joueur muet pendant plus de 20 s est déconnecté.

## Tests

```bash
npm test
```

Les tests (`test/net.test.js`, sans dépendance) rejouent les transports en ligne et local, la reconnexion et la synchronisation des héros / attaques à l'aide de faux WebSocket et `BroadcastChannel`.

## Sprites et décor

Les personnages utilisent des spritesheets pixel art CC0 (animations idle, course, saut et attaque). Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz. Le menu ajoute ses cadres, grilles, lueurs et rotations en CSS/canvas ; il n'intègre aucune texture tierce non créditée. Les sources et licences sont détaillées dans [`assets/CREDITS.md`](assets/CREDITS.md).
