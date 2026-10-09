#!/usr/bin/env python3
"""PixWorld — génère les textures de blocs sans couture (32×32).

Source : la feuille de tuiles CC0 « Pixel Platformer » de Kenney, incluse dans
le dépôt sous ``assets/blocks/kenney-pixel-platformer-tiles.png`` (miroir
GitHub : https://github.com/uheartbeast/Pixel-Platformer, fichier
``tiles_packed.png``, lui-même repris de https://kenney.nl/assets/pixel-platformer).

La feuille est « packed » (tuiles de tailles variables) : on y prélève deux
motifs 14×14 utiles — le bruit de terre et la calotte d'herbe à brins
dégoulinants — puis on étend chacun en un *plan miroir* (le motif répété avec
ses retournements horizontaux et verticaux). Un plan miroir est continu
partout : n'importe quelle fenêtre rectangulaire qu'on y découpe se recolle
donc parfaitement avec la fenêtre voisine, ce qui supprime toute délimitation
visible entre les blocs du terrain.

  - ``dirt.png``  : fenêtre 32×32 du plan de terre.
  - ``stone.png`` : même plan, reteint en gris bleuté (roche).
  - ``grass.png`` : la même fenêtre de terre + la calotte d'herbe Kenney sur le
    haut, pour la couche de surface.

Lancer :  python3 tools/make-blocks.py
"""

import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SOURCE = os.path.join(ROOT, "assets", "blocks", "kenney-pixel-platformer-tiles.png")
OUT = os.path.join(ROOT, "assets", "blocks")

SIZE = 32       # texture finale (bloc du jeu : 32 px)
PLANE = 128     # taille du plan miroir (multiple de la période)
GRASS_CAP = 7   # hauteur de la calotte d'herbe conservée sur le bloc d'herbe

# Fenêtres (packed sheet) : herbe à brins dégoulinants, puis terre nue.
CAP_BOX = (2, 20, 16, 36)
DIRT_BOX = (2, 109, 16, 123)


def clamp8(value):
    return max(0, min(255, int(value)))


def plane(inner, size=PLANE):
    """Plan miroir : le motif répété, retourné à chaque période (continu)."""
    w, h = inner.size
    src = inner.load()
    out = Image.new("RGBA", (size, size))
    dst = out.load()

    def folded(value, period):
        value %= 2 * period
        return value if value < period else (2 * period - 1) - value

    for y in range(size):
        sy = folded(y, h)
        for x in range(size):
            dst[x, y] = src[folded(x, w), sy]
    return out


def recolor_stone(inner):
    """Reteint le bruit de terre en gris bleuté pour la roche."""
    out = inner.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            lum = 0.30 * r + 0.59 * g + 0.11 * b
            t = max(0.0, min(1.0, (lum - 95) / 110))
            px[x, y] = (
                clamp8(74 + t * 58),
                clamp8(88 + t * 62),
                clamp8(96 + t * 62),
                a,
            )
    return out


def window(plane_image, ox, oy, size=SIZE):
    return plane_image.crop((ox, oy, ox + size, oy + size))


def main():
    sheet = Image.open(SOURCE).convert("RGBA")
    cap_inner = sheet.crop(CAP_BOX)
    dirt_inner = sheet.crop(DIRT_BOX)

    dirt_plane = plane(dirt_inner)
    stone_plane = plane(recolor_stone(dirt_inner))
    cap_plane = plane(cap_inner)

    ox, oy = 4, 4  # fenêtre choisie dans le plan (loin des plis du motif)
    dirt = window(dirt_plane, ox, oy)
    stone = window(stone_plane, ox, oy)

    # Herbe : corps de terre identique à dirt.png (raccords exacts) + calotte.
    grass = dirt.copy()
    gpx = grass.load()
    cpx = cap_plane.load()
    for y in range(GRASS_CAP):
        for x in range(SIZE):
            gpx[x, y] = cpx[ox + x, oy + y]

    for name, image in (("grass", grass), ("dirt", dirt), ("stone", stone)):
        image.save(os.path.join(OUT, name + ".png"))

    # Aperçu de contrôle : chaque texture répétée 4×3, comme dans le terrain.
    preview = Image.new("RGBA", (SIZE * 4 * 3 + 16, SIZE * 3), (24, 26, 30, 255))
    for i, image in enumerate((grass, dirt, stone)):
        for cx in range(4):
            for cy in range(3):
                preview.paste(image, (i * (SIZE * 4 + 8) + cx * SIZE, cy * SIZE))
    preview.save("/tmp/blocks-preview.png")
    print("textures 32x32 generees : grass, dirt, stone (apercu dans /tmp/blocks-preview.png)")


if __name__ == "__main__":
    main()
