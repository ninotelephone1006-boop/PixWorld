# PixWorld

Prototype de jeu de plateforme 2D en HTML Canvas.

Ouvre `index.html` dans un navigateur pour jouer.

## Commandes

- `A` (AZERTY) ou `Q` (QWERTY) : aller à gauche
- `D` : aller à droite
- Flèches gauche/droite : se déplacer aussi
- `Espace` : sauter
- `X` : attaquer
- Clic gauche : attaquer (dans la direction du curseur)

## Sprite

Le rectangle de test a été remplacé par un ninja pixel art CC0. Ses animations idle, run (utilisée pendant le déplacement), saut et attaque sont jouées selon les commandes. Les crédits et la licence sont dans [`assets/CREDITS.md`](assets/CREDITS.md).

## Décor en parallaxe

Le fond uni a été remplacé par un décor pixel art en plusieurs couches issues du pack « Sunny Land » d'Ansimuz (trouvé sur GitHub) : ciel/nuages, collines, sol en tuiles et herbes au premier plan. Chaque couche défile à une vitesse différente selon la caméra, qui suit le joueur dans un monde plus large que l'écran. L'attaque se déclenche aussi au clic gauche, en direction du curseur.

Cette première version est une base locale ; le multijoueur réseau pourra être ajouté ensuite.
