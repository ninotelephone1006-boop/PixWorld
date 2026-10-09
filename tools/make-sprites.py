#!/usr/bin/env python3
"""
Génère les spritesheets originales de PixWorld (Raiden le samouraï et Sora
l'archère) : des personnages pixel art dessinés ici même, pixel par pixel,
dans le format des feuilles du pack ninja CC0 (256 × 128 px, cellules 32 × 32).

    python3 tools/make-sprites.py            # écrit assets/characters/*.png
    python3 tools/make-sprites.py --preview  # + aperçu agrandi dans /tmp

Disposition des cellules (identique au ninja, lue par src/game.js) :
    colonne 0 : idle (4 lignes)      colonne 3 : attaque (4 lignes)
    colonne 1 : course (4 lignes)    colonne 5 : blessé (ligne 0), K.O. (ligne 3)
    colonne 2 : saut montée / descente / atterrissage

Chaque image est composée de calques (corps, tête, premier plan) décrits en
ASCII : un caractère = un pixel, « . » = transparent. Les lettres renvoient à
la palette du héros. Les feuilles produites sont placées sous CC0 comme le
reste des ressources originales du projet.
"""
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover - message d'aide
    sys.exit("Pillow est nécessaire : pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "characters")
CELL = 32
COLS = 8
ROWS = 4

# ───────────────────────────── Palettes ─────────────────────────────

COMMON = {
    "#": (0, 0, 0, 255),          # contour noir
    "K": (25, 14, 14, 255),       # contour sombre (bas du corps, comme le ninja)
    "c": (255, 212, 168, 255),    # peau
    "C": (222, 168, 126, 255),    # peau ombrée
    "w": (255, 255, 235, 255),    # blanc chaud
    "W": (204, 190, 180, 255),    # blanc ombré
    "G": (255, 206, 21, 255),     # or
    "g": (224, 150, 40, 255),     # or ombré
    "R": (214, 48, 48, 255),      # rouge
    "S": (232, 238, 248, 255),    # acier clair (lame, pointe)
    "s": (150, 166, 196, 255),    # acier ombré
}

SAMURAI = dict(COMMON, **{
    "H": (40, 46, 90, 255),       # casque indigo
    "h": (78, 88, 148, 255),      # reflet du casque
    "r": (150, 24, 36, 255),      # armure ombrée
    "p": (240, 100, 88, 255),     # reflet des plaques
    "b": (40, 36, 52, 255),       # tissu sombre (manches, jambes)
    "T": (96, 64, 40, 255),       # poignée
})

ARCHER = dict(COMMON, **{
    "E": (46, 142, 78, 255),      # capuche verte
    "e": (92, 190, 118, 255),     # reflet de la capuche
    "F": (28, 92, 52, 255),       # vert sombre
    "L": (172, 112, 60, 255),     # tunique en cuir
    "l": (208, 152, 90, 255),     # cuir clair
    "B": (92, 56, 30, 255),       # ceinture, bottes, carquois
    "o": (196, 92, 44, 255),      # mèche de cheveux auburn
    "t": (150, 96, 46, 255),      # bois de l'arc / flèche
    "T": (104, 62, 30, 255),      # bois sombre
    "n": (236, 236, 224, 255),    # corde
})

# ───────────────────────────── Outils ─────────────────────────────


def blank_sheet():
    return Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))


def paint(cell, layer, palette):
    """Dessine un calque ASCII ((x, y), lignes) dans une cellule 32 × 32."""
    (ox, oy), rows = layer
    for dy, row in enumerate(rows):
        for dx, char in enumerate(row):
            if char == ".":
                continue
            color = palette[char]
            x, y = ox + dx, oy + dy
            if 0 <= x < CELL and 0 <= y < CELL:
                cell.putpixel((x, y), color)


def flip(layer):
    (ox, oy), rows = layer
    width = max(len(r) for r in rows)
    flipped = [row.ljust(width, ".")[::-1] for row in rows]
    return ((CELL - ox - width, oy), flipped)


def shift(layer, dx, dy):
    (ox, oy), rows = layer
    return ((ox + dx, oy + dy), rows)


def build(frames, palette):
    """frames : {(col, row): [layer, ...]} → feuille complète."""
    sheet = blank_sheet()
    for (col, row), layers in frames.items():
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        for layer in layers:
            paint(cell, layer, palette)
        sheet.paste(cell, (col * CELL, row * CELL))
    return sheet


# ═════════════════════════ RAIDEN — samouraï ═════════════════════════
# Tête : kabuto indigo à cimier d'or (kuwagata), visage découvert.
# Le menton se trouve en (16, 16) dans la cellule ; le corps commence en y=17.

SAMURAI_HEAD = ((9, 5), [
    "..G.......G..",
    "..GG.....GG..",
    "...GG###GG...",
    "..#HHhhhhHH#.",
    ".#HHhhhhHHHH#",
    ".#HHHHHHHHHH#",
    "##HH#######H#",
    "#H#ccccccccc#",
    "#H#cc#ccc#cc#",
    ".##ccccccccc#",
    "..#cCcccccCc#",
    "...#########.",
])

# Variante blessée : yeux fermés.
SAMURAI_HEAD_HURT = ((9, 5), [
    "..G.......G..",
    "..GG.....GG..",
    "...GG###GG...",
    "..#HHhhhhHH#.",
    ".#HHhhhhHHHH#",
    ".#HHHHHHHHHH#",
    "##HH#######H#",
    "#H#ccccccccc#",
    "#H#c##ccc##c#",
    ".##ccccccccc#",
    "..#cCcc#ccCc#",
    "...#########.",
])

# Corps idle : armure cramoisie à épaulières, obi doré, fourreau à la hanche.
SAMURAI_IDLE = ((8, 16), [
    "...##RRRRRRR##..",
    "..#rrRpRRRRRrr#.",
    "..#ccRRRRRRRRcc#",
    "..#ccGGGGGGGGcc#",
    ".#T#bbbbbbbbb##.",
    "#s#.#bb#..#bb#..",
    "....KbbK..KbbK..",
    "....KKKK..KKKK..",
])

SAMURAI_IDLE_BREATH = ((8, 16), [
    "...##RRRRRRR##..",
    "..#rrRpRRRRRrr#.",
    "..#ccRRRRRRRRcc#",
    "..#ccGGGGGGGGcc#",
    ".#T#bbbbbbbbb##.",
    "#s#.#bb#..#bb#..",
    "....KbbK..KbbK..",
    "....KKKK..KKKK..",
])

# Course : quatre temps, le fourreau suit la hanche.
SAMURAI_RUN = [
    ((7, 16), [
        "....##RRRRRRR##.",
        "...#rrRpRRRRRrr#",
        "...#cRRRRRRRRRc#",
        "..#c#GGGGGGGGG#c",
        ".#T#bbbbbbbbb##.",
        "#s#Kbb#....#bbK.",
        "..KbbK......KbbK",
        "..KKK........KKK",
    ]),
    ((8, 16), [
        "...##RRRRRRR##..",
        "..#rrRpRRRRRrr#.",
        "..#ccRRRRRRRRcc#",
        "...#GGGGGGGGG#..",
        "..T#bbbbbbbbb#..",
        "#s#.#bbbbbb#....",
        "....KbbKKbbK....",
        "....KKK..KKK....",
    ]),
    ((7, 16), [
        "....##RRRRRRR##.",
        "...#rrRpRRRRRrr#",
        "...#cRRRRRRRRRc#",
        "..#c#GGGGGGGGG#c",
        ".#T#bbbbbbbbb##.",
        "#s#...#bbbbbK...",
        "....KbbK...KbbK.",
        "....KKK.....KKK.",
    ]),
    ((8, 16), [
        "...##RRRRRRR##..",
        "..#rrRpRRRRRrr#.",
        "..#ccRRRRRRRRcc#",
        "...#GGGGGGGGG#..",
        "..T#bbbbbbbbb#..",
        "#s#.#bbbbbb#....",
        "....KbbKKbbK....",
        "....KKK..KKK....",
    ]),
]

# Saut : montée (jambes repliées, bras levés), descente, atterrissage.
SAMURAI_JUMP_UP = ((7, 15), [
    "..c#.........#c.",
    "..#c##RRRRRRR#c#",
    "...##rRpRRRRRr##",
    "....#RRRRRRRRR#.",
    "....#GGGGGGGGG#.",
    "..T#bbbbbbbbbb#.",
    "#s#.KbbbbbbbbK..",
    "....KKbKKKKbKK..",
    ".....KK....KK...",
])

SAMURAI_JUMP_DOWN = ((7, 15), [
    "#c.............c#",
    ".#c##RRRRRRR##c#.",
    "..##rrRpRRRRRr##.",
    "....#RRRRRRRRR#..",
    "....#GGGGGGGGG#..",
    "..T#bbbbbbbbbb#..",
    "#s#Kbb#......#bbK",
    "..KbbK........KbK",
    "..KKK..........KK",
])

SAMURAI_LAND = ((7, 17), [
    "...##RRRRRRR##..",
    "..#crrRpRRRRRrc#",
    "..#cRRRRRRRRRRc#",
    "..##GGGGGGGGGG##",
    ".T#bbbbbbbbbbbb#",
    "#s#bbK......Kbbb#",
    ".KKKK........KKKK",
])

# Attaque : armé, fente, coupe horizontale, garde basse.
SAMURAI_ATTACK = [
    # 0 — armé : lame dressée derrière la tête, garde haute
    ((5, 5), [
        "..#S............",
        "..#S............",
        "..#sS...........",
        "...#S...........",
        "...#sS..........",
        "....#S..........",
        "....#sS.........",
        ".....GG.........",
        ".....T..........",
        ".....T..........",
        ".....c..........",
        ".....c.##RRRRRRR##",
        ".....c#rrRpRRRRRrr#",
        ".....##RRRRRRRRRc#",
        "......#GGGGGGGGGc#",
        ".....#bbbbbbbbbb#.",
        ".....#bb#...#bb#..",
        ".....KbbK...KbbK..",
        ".....KKKK...KKKK..",
    ]),
    # 1 — fente : bras avant levé, la lame est dessinée en premier plan
    ((7, 15), [
        ".............cc..",
        "...##RRRRRRR#c...",
        "..#rrRpRRRRRr#...",
        "..#cRRRRRRRRR#...",
        "..#cGGGGGGGGG#...",
        "...#bbbbbbbbbb#..",
        "..KbbK......Kbb#.",
        ".KbbK........Kbb#",
        ".KKK..........KKK",
    ]),
    # 2 — coupe horizontale : lame tendue devant, pleine extension
    ((6, 16), [
        "...##RRRRRRR##...",
        "..#rrRpRRRRRrr#..",
        "..#cRRRRRRRRRccTGSSSSSSSSS",
        "..#cGGGGGGGGGGcc.#ssssssss#",
        "...#bbbbbbbbbbb#.",
        "..KbbK......Kbbb#",
        ".KbbK........KbbK",
        ".KKK..........KKK",
    ]),
    # 3 — garde basse : lame pointée vers le sol devant
    ((8, 16), [
        "...##RRRRRRR##....",
        "..#rrRpRRRRRrr#...",
        "..#ccRRRRRRRRcc...",
        "..#ccGGGGGGGGTG...",
        ".#.#bbbbbbbbb#S...",
        "....#bb#..#bb##S..",
        "....KbbK..KbbK.#S.",
        "....KKKK..KKKK..#S",
    ]),
]

# Lame en diagonale (premier plan de la fente) : du poing vers le haut-avant.
SAMURAI_SWORD_DIAG = ((19, 6), [
    ".......#S",
    "......#S.",
    ".....#sS.",
    "....#S...",
    "...#sS...",
    "...#S....",
    "..GG.....",
    "..T......",
])

# Blessé : rejeté en arrière, bras ouverts.
SAMURAI_HURT = ((6, 14), [
    "...............c#",
    "..............#c.",
    ".....##RRRRRRR##.",
    "..c#.#rrRpRRRRRr#",
    "...c#RRRRRRRRRRc#",
    "....#GGGGGGGGGc#.",
    "..T#bbbbbbbbbbb#.",
    "#s#Kbb#.....#bbK.",
    "..KbbK.......KbbK",
    "..KKK.........KKK",
])

# K.O. : allongé au sol.
SAMURAI_DEAD = ((3, 16), [
    "......................G...",
    "......................GG..",
    "...............#######HhH#",
    ".......####..##RRRRRRRHHHH#",
    ".....##bbbb##cRpRRRRRR#cc##",
    "....#bbbbbbbb#cGGGGGGG#ccc#",
    "...#KbbbbbbbbbccRRRRRRc#cc#",
    "....KKKKKKKKKKKKKKKKKKKKKK.",
])

SAMURAI_FRAMES = {
    (0, 0): [SAMURAI_IDLE, SAMURAI_HEAD],
    (0, 1): [SAMURAI_IDLE, shift(SAMURAI_HEAD, 0, 1)],
    (0, 2): [SAMURAI_IDLE_BREATH, shift(SAMURAI_HEAD, 0, 1)],
    (0, 3): [SAMURAI_IDLE, SAMURAI_HEAD],
    (1, 0): [SAMURAI_RUN[0], shift(SAMURAI_HEAD, 0, 0)],
    (1, 1): [SAMURAI_RUN[1], shift(SAMURAI_HEAD, 0, -1)],
    (1, 2): [SAMURAI_RUN[2], shift(SAMURAI_HEAD, 0, 0)],
    (1, 3): [SAMURAI_RUN[3], shift(SAMURAI_HEAD, 0, -1)],
    (2, 0): [SAMURAI_JUMP_UP, shift(SAMURAI_HEAD, 0, -1)],
    (2, 1): [SAMURAI_JUMP_DOWN, shift(SAMURAI_HEAD, 0, -1)],
    (2, 2): [SAMURAI_LAND, shift(SAMURAI_HEAD, 0, 1)],
    (3, 0): [SAMURAI_ATTACK[0], shift(SAMURAI_HEAD, 0, 0)],
    (3, 1): [SAMURAI_ATTACK[1], shift(SAMURAI_HEAD, 1, 0), SAMURAI_SWORD_DIAG],
    (3, 2): [SAMURAI_ATTACK[2], shift(SAMURAI_HEAD, 1, 0)],
    (3, 3): [SAMURAI_ATTACK[3], shift(SAMURAI_HEAD, 0, 0)],
    (5, 0): [SAMURAI_HURT, shift(SAMURAI_HEAD_HURT, -1, 0)],
    (5, 3): [SAMURAI_DEAD],
}

# ═════════════════════════ SORA — archère ═════════════════════════
# Tête : capuche verte en cagoule, pointe vers l'arrière, mèche auburn.
# Menton en (16, 16) ; le corps commence en y=17.

ARCHER_HEAD = ((8, 7), [
    ".....#####.....",
    "...##EeeeEE#...",
    ".##EEEeeEEEE#..",
    "#EEEEEEEEEEEE#.",
    "#EEEEE#######E#",
    ".#EE#ooccccccE#",
    "..#E#cc#ccc#cE#",
    "...#Eccccccccc#",
    "...#EcCcccccC#.",
    "....#########..",
])

ARCHER_HEAD_HURT = ((8, 7), [
    ".....#####.....",
    "...##EeeeEE#...",
    ".##EEEeeEEEE#..",
    "#EEEEEEEEEEEE#.",
    "#EEEEE#######E#",
    ".#EE#ooccccccE#",
    "..#E#c##ccc##E#",
    "...#Eccccccccc#",
    "...#EcCcc#ccC#.",
    "....#########..",
])

# Carquois dans le dos (derrière l'épaule gauche), avec deux empennages.
ARCHER_QUIVER = ((5, 11), [
    "wR.",
    "Rw.",
    "#B#",
    "#B#",
    "#B#",
    ".#.",
])

# Arc tenu verticalement dans la main avant (idle, course, saut).
ARCHER_BOW = ((21, 13), [
    ".T.",
    "..T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "..T",
    ".T.",
])

# Corps idle : tunique de cuir, ceinture, épaulières vertes.
ARCHER_IDLE = ((8, 16), [
    "...#LLLLLLL#....",
    "..#ELlLLLLLE#...",
    "..#cLLLLLLLLc#..",
    "..#cBBBBBBBBc#..",
    "...#LLLLLLLL#...",
    "...#BB#...#BB#..",
    "...KBBK...KBBK..",
    "...KKKK...KKKK..",
])

ARCHER_IDLE_BREATH = ((8, 16), [
    "...#LLLLLLL#....",
    "..#ELlLLLLLE#...",
    "..#cLLLLLLLLc#..",
    "..#cBBBBBBBBc#..",
    "...#LLLLLLLL#...",
    "...#BB#...#BB#..",
    "...KBBK...KBBK..",
    "...KKKK...KKKK..",
])

ARCHER_RUN = [
    ((7, 16), [
        "....#LLLLLLL#...",
        "...#ELlLLLLLE#..",
        "...#LLLLLLLLLc#.",
        "..#c#BBBBBBBB#..",
        "....#LLLLLLLL#..",
        "...KBB#....#BBK.",
        "..KBBK......KBBK",
        "..KKK........KKK",
    ]),
    ((8, 16), [
        "...#LLLLLLL#....",
        "..#ELlLLLLLE#...",
        "..#cLLLLLLLLc#..",
        "...#BBBBBBBB#...",
        "...#LLLLLLLL#...",
        "....KBBBBBBK....",
        "....KBBKKBBK....",
        "....KKK..KKK....",
    ]),
    ((7, 16), [
        "....#LLLLLLL#...",
        "...#ELlLLLLLE#..",
        "...#LLLLLLLLLc#.",
        "..#c#BBBBBBBB#..",
        "....#LLLLLLLL#..",
        "......#BBBBBK...",
        "....KBBK...KBBK.",
        "....KKK.....KKK.",
    ]),
    ((8, 16), [
        "...#LLLLLLL#....",
        "..#ELlLLLLLE#...",
        "..#cLLLLLLLLc#..",
        "...#BBBBBBBB#...",
        "...#LLLLLLLL#...",
        "....KBBBBBBK....",
        "....KBBKKBBK....",
        "....KKK..KKK....",
    ]),
]

ARCHER_JUMP_UP = ((7, 15), [
    "..c#.........#c.",
    "..#c#LLLLLLL#c#.",
    "...##ELlLLLLE##.",
    "....#LLLLLLLL#..",
    "....#BBBBBBBB#..",
    "...#LLLLLLLLL#..",
    "...KBBBBBBBBBK..",
    "...KKBKKKKKBKK..",
    "....KK.....KK...",
])

ARCHER_JUMP_DOWN = ((7, 15), [
    "#c.............c#",
    ".#c#LLLLLLL#..#c.",
    "..##ELlLLLLE##...",
    "....#LLLLLLLL#...",
    "....#BBBBBBBB#...",
    "...#LLLLLLLLL#...",
    "..KBB#......#BBK.",
    ".KBBK........KBBK",
    ".KKK..........KKK",
])

ARCHER_LAND = ((7, 17), [
    "...#LLLLLLL#....",
    "..#cELlLLLLLEc#.",
    "..#cLLLLLLLLLc#.",
    "..##BBBBBBBBB##.",
    ".#LLLLLLLLLLLLL#",
    "#BBK........KBBB#",
    "KKKK........KKKK.",
])

# Attaque : arc levé devant, corde tirée jusqu'à la joue, décoche, garde.
# L'arc d'attaque est plus avancé ; la main arrière et la flèche passent
# devant le visage (calque de premier plan).
ARCHER_ATTACK_BODY = [
    # 0 — l'arc se lève, flèche encochée
    ((8, 16), [
        "...#LLLLLLL#cc..",
        "..#ELlLLLLLE#...",
        "..#cLLLLLLLLL#..",
        "..#cBBBBBBBB#...",
        "...#LLLLLLLL#...",
        "...#BB#...#BB#..",
        "...KBBK...KBBK..",
        "...KKKK...KKKK..",
    ]),
    # 1 — corde tirée : bras avant tendu, bras arrière replié
    ((8, 16), [
        "...#LLLLLLL#cccc",
        "..#ELlLLLLLE#...",
        "..##LLLLLLLLL#..",
        "...#BBBBBBBB#...",
        "...#LLLLLLLL#...",
        "...#BB#...#BB#..",
        "...KBBK...KBBK..",
        "...KKKK...KKKK..",
    ]),
    # 2 — décoche : bras arrière ouvert
    ((8, 16), [
        "...#LLLLLLL#cccc",
        "..#ELlLLLLLE#...",
        "..##LLLLLLLLL#..",
        "...#BBBBBBBB#...",
        "...#LLLLLLLL#...",
        "...#BB#...#BB#..",
        "...KBBK...KBBK..",
        "...KKKK...KKKK..",
    ]),
    # 3 — garde : arc redescendu
    ((8, 16), [
        "...#LLLLLLL#....",
        "..#ELlLLLLLE#...",
        "..#cLLLLLLLLcc..",
        "..#cBBBBBBBB#...",
        "...#LLLLLLLL#...",
        "...#BB#...#BB#..",
        "...KBBK...KBBK..",
        "...KKKK...KKKK..",
    ]),
]

# Arc présenté devant (frames 0, 2) : corde droite.
ARCHER_BOW_AIM = ((23, 10), [
    ".T.",
    "..T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "n.T",
    "..T",
    ".T.",
])

# Arc bandé (frame 1) : corde tirée en « < » jusqu'à la main arrière.
ARCHER_BOW_DRAWN = ((18, 10), [
    "......T.",
    ".....n.T",
    "....n..T",
    "...n...T",
    "..n....T",
    ".n.....T",
    "n......T",
    ".n.....T",
    "..n....T",
    "...n...T",
    "....n..T",
    ".....n.T",
    "......T.",
])

# Premier plan : flèche encochée (frame 0), flèche tirée en arrière + main
# arrière (frame 1), main arrière ouverte après la décoche (frame 2).
ARCHER_FRONT_NOCK = ((19, 16), [
    "Rtttttt#S",
])

ARCHER_FRONT_DRAW = ((16, 15), [
    "..cc.....",
    "RRttttttt#S",
    "..cc.....",
])

ARCHER_FRONT_RELEASE = ((16, 15), [
    ".c#......",
    "..c......",
    ".c#......",
])

ARCHER_HURT = ((5, 14), [
    ".................c#",
    "................#c.",
    "......#LLLLLLL#....",
    "..c#.#ELlLLLLLE#...",
    "...c#LLLLLLLLLc#...",
    "....#BBBBBBBBBc#...",
    "....#LLLLLLLLLL#...",
    "...KBB#.....#BBK...",
    "..KBBK.......KBBK..",
    "..KKK.........KKK..",
])

ARCHER_DEAD = ((3, 18), [
    "...............#####......",
    "....####..###E#EEEEEE#....",
    "..##BBBB##LLLLEEEEEEEE#...",
    ".#BBBBBBB#LlLLE#ooccccE#..",
    "#KBBBBBBBB#BBBBE#ccccc#...",
    ".KKKKKKKKKKKKKKKKKKKKKK...",
])

ARCHER_FRAMES = {
    (0, 0): [ARCHER_QUIVER, ARCHER_IDLE, ARCHER_HEAD, ARCHER_BOW],
    (0, 1): [shift(ARCHER_QUIVER, 0, 1), ARCHER_IDLE, shift(ARCHER_HEAD, 0, 1), ARCHER_BOW],
    (0, 2): [shift(ARCHER_QUIVER, 0, 1), ARCHER_IDLE_BREATH, shift(ARCHER_HEAD, 0, 1), ARCHER_BOW],
    (0, 3): [ARCHER_QUIVER, ARCHER_IDLE, ARCHER_HEAD, ARCHER_BOW],
    (1, 0): [ARCHER_QUIVER, ARCHER_RUN[0], ARCHER_HEAD, shift(ARCHER_BOW, 0, 0)],
    (1, 1): [shift(ARCHER_QUIVER, 0, -1), ARCHER_RUN[1], shift(ARCHER_HEAD, 0, -1), shift(ARCHER_BOW, 0, -1)],
    (1, 2): [ARCHER_QUIVER, ARCHER_RUN[2], ARCHER_HEAD, shift(ARCHER_BOW, 0, 0)],
    (1, 3): [shift(ARCHER_QUIVER, 0, -1), ARCHER_RUN[3], shift(ARCHER_HEAD, 0, -1), shift(ARCHER_BOW, 0, -1)],
    (2, 0): [shift(ARCHER_QUIVER, 0, -1), ARCHER_JUMP_UP, shift(ARCHER_HEAD, 0, -1), shift(ARCHER_BOW, 1, -3)],
    (2, 1): [shift(ARCHER_QUIVER, 0, -1), ARCHER_JUMP_DOWN, shift(ARCHER_HEAD, 0, -1), shift(ARCHER_BOW, 2, -2)],
    (2, 2): [shift(ARCHER_QUIVER, 0, 1), ARCHER_LAND, shift(ARCHER_HEAD, 0, 1), shift(ARCHER_BOW, 1, 0)],
    (3, 0): [ARCHER_QUIVER, ARCHER_ATTACK_BODY[0], ARCHER_HEAD, ARCHER_BOW_AIM, ARCHER_FRONT_NOCK],
    (3, 1): [ARCHER_QUIVER, ARCHER_ATTACK_BODY[1], ARCHER_HEAD, ARCHER_BOW_DRAWN, ARCHER_FRONT_DRAW],
    (3, 2): [ARCHER_QUIVER, ARCHER_ATTACK_BODY[2], shift(ARCHER_HEAD, 1, 0), ARCHER_BOW_AIM, ARCHER_FRONT_RELEASE],
    (3, 3): [ARCHER_QUIVER, ARCHER_ATTACK_BODY[3], ARCHER_HEAD, shift(ARCHER_BOW, 1, 0)],
    (5, 0): [shift(ARCHER_QUIVER, -1, 0), ARCHER_HURT, shift(ARCHER_HEAD_HURT, -1, 0), shift(ARCHER_BOW, 1, 0)],
    (5, 3): [ARCHER_DEAD],
}

SHEETS = [
    ("samurai-32x32.png", SAMURAI_FRAMES, SAMURAI),
    ("archer-32x32.png", ARCHER_FRAMES, ARCHER),
]


def main():
    preview = "--preview" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)
    for filename, frames, palette in SHEETS:
        sheet = build(frames, palette)
        target = os.path.join(OUT_DIR, filename)
        sheet.save(target)
        print("écrit", os.path.relpath(target, ROOT), sheet.size)
        if preview:
            big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
            backdrop = Image.new("RGBA", big.size, (88, 166, 232, 255))
            backdrop.paste(big, (0, 0), big)
            path = os.path.join("/tmp", "preview-" + filename)
            backdrop.save(path)
            print("aperçu", path)


if __name__ == "__main__":
    main()
