# PixWorld

Prototype de jeu de plateforme 2D en HTML Canvas, **jouable à plusieurs dans le navigateur**.

Ouvre `index.html` dans un navigateur pour jouer seul, ou lance le serveur pour voir les autres joueurs en temps réel :

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

## Multijoueur

Avant de commencer, un petit écran demande un **pseudo** (14 caractères max) et une **couleur**. Ensuite :

- chaque joueur apparaît dans le monde avec son ninja teinté de sa couleur ;
- son **pseudo flotte au-dessus de lui** dans une petite étiquette ;
- la **liste des joueurs** en haut à droite rappelle qui est là (`Alice (vous)`, `Bob`, …) ;
- un message s'affiche brièvement quand quelqu'un arrive ou part ;
- si un joueur sort de l'écran, une **flèche à son nom** indique de quel côté il se trouve.

Le petit crayon `✎` de la liste permet de changer de pseudo en cours de partie. Le pseudo et la couleur sont mémorisés dans le navigateur.

### Trois modes, automatiques

| Mode        | Quand ?                                                          | Ce que ça permet |
| ----------- | ---------------------------------------------------------------- | ---------------- |
| **En ligne** | le serveur Node répond (`npm start`)                             | jouer à plusieurs depuis plusieurs machines / navigateurs |
| **Onglets**  | pas de serveur (page ouverte en direct, hébergement statique…)   | se voir entre onglets d'un même navigateur, sans serveur |
| **Solo**     | navigateur sans `BroadcastChannel`                               | jouer seul |

Le mode est indiqué en haut à droite (pastille « en ligne », « onglets », « solo »). Si le serveur redémarre, le jeu retente de se reconnecter tout seul avec un délai croissant.

## Comment ça marche

- `index.html` — mise en page, HUD et styles de l'interface (écran de pseudo, liste des joueurs, notifications).
- `src/game.js` — boucle de jeu, animations, dessin des joueurs distants (interpolation des positions, teinte par joueur, étiquettes de pseudo).
- `src/net.js` — couche réseau : WebSocket vers le serveur, repli sur `BroadcastChannel`, reconnexion.
- `server/server.js` — serveur de fichiers statiques **+ WebSocket sans aucune dépendance** : il relaie 20 fois par seconde la position de chacun. Aucune donnée n'est conservée.

Chaque client envoie son état (`x`, hauteur au-dessus du sol, direction, vitesse, attaque…) 20 fois par seconde, et reçoit celui de tous les autres. Les positions des autres joueurs sont interpolées pour rester fluides entre deux messages. Le monde fait désormais une largeur fixe (2600 px) partagée par tous : tout le monde parcourt le même niveau, quelle que soit la taille de son écran.

Côté serveur, les pseudos sont nettoyés et limités à 14 caractères, les nombres sont bornés, le débit est plafonné et un joueur muet pendant plus de 20 s est déconnecté.

## Commandes

- `A` (AZERTY) ou `Q` (QWERTY) : aller à gauche
- `D` : aller à droite
- Flèches gauche/droite : se déplacer aussi
- `Espace` : sauter
- `X` : attaquer
- Clic gauche : attaquer (dans la direction du curseur)

## Tests

```bash
npm test
```

Les tests (`test/net.test.js`, sans dépendance) rejouent la couche réseau avec un faux WebSocket et un faux `BroadcastChannel` : partie en ligne, absence de serveur, reconnexion, mode onglets.

## Sprite et décor

Le rectangle de test a été remplacé par un ninja pixel art CC0. Ses animations idle, run (utilisée pendant le déplacement), saut et attaque sont jouées selon les commandes. Le décor en parallaxe vient du pack « Sunny Land » d'Ansimuz (ciel/nuages, collines, sol en tuiles et herbes au premier plan), chaque couche défilant à une vitesse différente selon la caméra. Les crédits et la licence sont dans [`assets/CREDITS.md`](assets/CREDITS.md).
