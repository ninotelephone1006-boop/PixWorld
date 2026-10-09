# Crédits et licences des ressources

## Personnages — spritesheets CC0 (Kage et Yume)

- **Kage :** `ninja-black-32x32.png`.
- **Yume :** `characters/ninja-purple-32x32.png`.
- **Création / adaptation :** Morgan McGuire (2018), d'après l'illustration de DezrasDragons.
- **Sources GitHub :** [ninja noir](https://github.com/morgan3d/quadplay/blob/main/sprites/ninja-black-32x32.png), [ninja violet](https://github.com/morgan3d/quadplay/blob/main/sprites/ninja-purple-32x32.png).
- **Licence :** [CC0 1.0 / domaine public](https://creativecommons.org/publicdomain/zero/1.0/) — attribution non obligatoire ; crédit conservé par courtoisie. Les fichiers de métadonnées source dans le dépôt quadplay précisent explicitement la licence CC0 pour chaque sprite.
- **Animations :** feuilles de 256 × 128 px, cellules de 32 × 32 px ; idle, course, saut, attaque, blessé et K.O. Les effets de shuriken, flèche, coupe et orbe sont dessinés dans PixWorld.

Le ninja original provient de [OpenGameArt — Ninja Animated](https://opengameart.org/content/ninja-animated-0).

## Personnages — sprites originaux PixWorld (Sora et Raiden)

- **Fichiers :** `characters/archer-32x32.png` (Sora, archère) et `characters/samurai-32x32.png` (Raiden, samouraï).
- **Création :** dessinés pour PixWorld (pixel art original, même grille et même disposition d'animations que les feuilles ci-dessus : idle, course, saut, attaque, blessé, K.O.). Ils sont générés depuis des calques ASCII par `tools/make-sprites.py` (Pillow), ce qui permet de les retoucher facilement.
- **Licence :** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), comme le reste des sprites du jeu.

## Effets sonores — banque CC0 (fichiers adaptés)

- **Fichiers :** `assets/sfx/*.wav` — 199 sons courts (mono, 44,1 kHz, 16 bits, 0,8 s maximum), 3 à 8 variantes pour chacun des 41 événements de la banque.
- **Source GitHub :** dépôt [Daarko/sparkstream-sounds](https://github.com/Daarko/sparkstream-sounds) (branche `master`), qui redistribue des packs de sons déjà convertis en Wave.
- **Créateur d'origine :** [Kenney](https://kenney.nl) — packs « [UI Audio](https://kenney.nl/assets/ui-audio) », « [Interface Sounds](https://kenney.nl/assets/interface-sounds) », « [Digital Audio](https://kenney.nl/assets/digital-audio) », « [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) », « [Impact Sounds](https://kenney.nl/assets/impact-sounds) » et « [RPG Audio](https://kenney.nl/assets/rpg-audio) ».
- **Licence :** [CC0 1.0 / domaine public](https://creativecommons.org/publicdomain/zero/1.0/) — utilisation libre, y compris commerciale, attribution non obligatoire ; crédit conservé par courtoisie. Les textes de licence d'origine sont archivés dans le dépôt source (`credits/`, un fichier par pack).
- **Adaptations faites pour PixWorld** par `tools/build-sfx.mjs` : conversion en mono (les Wave d'origine sont parfois stéréo), suppression des silences en début et en fin, normalisation du volume, fondu anti-clic de 4 ms, raccourcissement à 0,8 s et renommage `<événement>-<n>.wav`. Les sources de chaque événement sont conservées dans le catalogue généré pour faciliter l'audit ; les pas d'herbe pointent vers `footstep_grass`, le lancement de l'orbe vers `thrusterFire` et son impact vers `explosionCrunch`. Le dépôt d'origine n'héberge que des créations CC0 de Kenney, sans tiers redistributeur.
- **Catalogue :** `src/sfx-library.js` (généré) associe chaque événement du jeu à ses variantes, à la source d'origine et à un gain d'équilibrage.

## Effets sonores — pas d'herbe et synthèse de secours (ZzFX)

- **Pas sur l'herbe :** cinq fichiers dédiés (`assets/sfx/stepGrass-*.wav`), adaptés des enregistrements `impact-sounds-footstep_grass_000` à `_004` du pack Kenney « Impact Sounds » (CC0).
- **Autres matières / secours :** les pas sur terre, pierre, bois et neige gardent six variantes synthétisées par `src/audio.js` (`STEP_MATERIALS`), également utilisées si les fichiers ne sont pas chargés ou accessibles (page ouverte en `file://`, hors ligne…). Les sons de lancement et d'impact de l'orbe ont aussi un rendu de flamme bruité en secours.
- **Moteur :** adaptation de [ZzFX](https://github.com/KilledByAPixel/ZzFX) (« Zuper Zmall Zound Zynth ») de Frank Force, licence [MIT](https://github.com/KilledByAPixel/ZzFX/blob/master/LICENSE), © 2019 Frank Force. Les presets (paramètres de chaque son) sont propres à PixWorld.

## Blocs minables — Pixel Platformer de Kenney (CC0)

- **Atlas source inclus :** `blocks/kenney-pixel-platformer-atlas.png`, repris du fichier `Art/Platformer-assets-pixel/spritesheet.png` dans le dépôt GitHub [romance-ii/kenneydonation](https://github.com/romance-ii/kenneydonation/blob/master/Art/Platformer-assets-pixel/spritesheet.png), miroir des ressources de Kenney.
- **Textures PixWorld :** `blocks/grass.png`, `blocks/dirt.png` et `blocks/stone.png` sont des recadrages pixel art mis à l'échelle et adaptés (teintes de terre et de pierre) depuis cet atlas.
- **Auteur et licence :** [Kenney](https://kenney.nl), pack « Pixel Platformer » ; licence [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), indiquée dans le fichier `LICENSE` du dépôt source. Utilisation libre ; attribution conservée par courtoisie.

## Décor « Sunny Land » (parallaxe)

- **Fichiers :** `background/sky-back.png` (ciel et nuages), `background/hills-middle.png` (collines), `background/tileset.png` (sol en tuiles et touffes d'herbe).
- **Créateur :** Luis Zuno, alias [Ansimuz](https://ansimuz.com), pack « Sunny Land » (2017).
- **Source GitHub :** récupéré depuis [gnaigsolo/thelostfox](https://github.com/gnaigsolo/thelostfox) et [Kevin1321/DA_Module_12_SunnyLand](https://github.com/Kevin1321/DA_Module_12_SunnyLand), dépôts qui redistribuent le pack gratuit de l'auteur.
- **Utilisation :** ciel lent, collines moyennes, sol et herbes de premier plan défilent à différentes vitesses.

## Menu

Le menu n'embarque pas de texture externe : ses panneaux, grilles, lueurs, anneaux et animations sont générés en CSS et Canvas. Il utilise les spritesheets CC0 ci-dessus pour les aperçus animés des héros.

## Monde procédural et biomes (v1.4)

- **Aucune image tierce ajoutée.** Les textures de sol (corps de terre, sable, neige, basalte), les ciels, les silhouettes lointaines, les arbres, cactus, pins, roches, cristaux et mares de lave sont dessinés en code par `src/scenery.js` ; le relief, les plateformes et la disposition du décor viennent de `src/world.js`.
- La prairie conserve les fichiers « Sunny Land » décrits plus haut.
