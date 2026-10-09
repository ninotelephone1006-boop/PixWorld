/**
 * PixWorld — banque d'effets sonores (fichiers adaptés, licence CC0).
 *
 * ATTENTION : ce fichier est généré par tools/build-sfx.mjs, ne l'éditez pas
 * à la main. Il décrit, pour chaque événement du jeu, les variantes sonores
 * disponibles dans assets/sfx/ et le gain à leur appliquer.
 *
 * Provenance : dépôt Daarko/sparkstream-sounds (extraits des packs Kenney, CC0 1.0).
 * Les pas (« step ») sont absents de cette liste : ils sont synthétisés en
 * code par src/audio.js. Quand un événement n'a pas de fichier (ou que le
 * navigateur n'a pas pu les charger), src/audio.js retombe sur la synthèse.
 */
window.PixWorldSfxLibrary = {
  "source": {
    "repo": "Daarko/sparkstream-sounds",
    "ref": "refs/heads/master",
    "url": "https://codeload.github.com/Daarko/sparkstream-sounds/tar.gz/refs/heads/master",
    "packs": {
      "ui-clicks": {
        "pack": "UI Audio / Interface Sounds",
        "url": "https://kenney.nl/assets/ui-audio"
      },
      "digital-beeps": {
        "pack": "Digital Audio / Sci-Fi Sounds",
        "url": "https://kenney.nl/assets/digital-audio"
      },
      "impacts": {
        "pack": "Impact Sounds",
        "url": "https://kenney.nl/assets/impact-sounds"
      },
      "rpg-quest": {
        "pack": "RPG Audio",
        "url": "https://kenney.nl/assets/rpg-audio"
      }
    }
  },
  "events": {
    "uiHover": {
      "gain": 0.5,
      "files": [
        "uiHover-1.wav",
        "uiHover-2.wav",
        "uiHover-3.wav",
        "uiHover-4.wav",
        "uiHover-5.wav"
      ]
    },
    "uiSelect": {
      "gain": 0.6,
      "files": [
        "uiSelect-1.wav",
        "uiSelect-2.wav",
        "uiSelect-3.wav",
        "uiSelect-4.wav",
        "uiSelect-5.wav",
        "uiSelect-6.wav",
        "uiSelect-7.wav",
        "uiSelect-8.wav"
      ]
    },
    "uiConfirm": {
      "gain": 0.75,
      "files": [
        "uiConfirm-1.wav",
        "uiConfirm-2.wav",
        "uiConfirm-3.wav",
        "uiConfirm-4.wav"
      ]
    },
    "uiBack": {
      "gain": 0.6,
      "files": [
        "uiBack-1.wav",
        "uiBack-2.wav",
        "uiBack-3.wav",
        "uiBack-4.wav"
      ]
    },
    "uiPause": {
      "gain": 0.6,
      "files": [
        "uiPause-1.wav",
        "uiPause-2.wav",
        "uiPause-3.wav",
        "uiPause-4.wav"
      ]
    },
    "uiType": {
      "gain": 0.35,
      "files": [
        "uiType-1.wav",
        "uiType-2.wav",
        "uiType-3.wav"
      ]
    },
    "uiError": {
      "gain": 0.6,
      "files": [
        "uiError-1.wav",
        "uiError-2.wav",
        "uiError-3.wav",
        "uiError-4.wav"
      ]
    },
    "uiToggleOn": {
      "gain": 0.55,
      "files": [
        "uiToggleOn-1.wav",
        "uiToggleOn-2.wav",
        "uiToggleOn-3.wav",
        "uiToggleOn-4.wav",
        "uiToggleOn-5.wav"
      ]
    },
    "uiToggleOff": {
      "gain": 0.55,
      "files": [
        "uiToggleOff-1.wav",
        "uiToggleOff-2.wav",
        "uiToggleOff-3.wav",
        "uiToggleOff-4.wav",
        "uiToggleOff-5.wav"
      ]
    },
    "toast": {
      "gain": 0.4,
      "files": [
        "toast-1.wav",
        "toast-2.wav",
        "toast-3.wav",
        "toast-4.wav",
        "toast-5.wav"
      ]
    },
    "jump": {
      "gain": 0.65,
      "files": [
        "jump-1.wav",
        "jump-2.wav",
        "jump-3.wav",
        "jump-4.wav",
        "jump-5.wav"
      ]
    },
    "land": {
      "gain": 0.7,
      "files": [
        "land-1.wav",
        "land-2.wav",
        "land-3.wav",
        "land-4.wav",
        "land-5.wav"
      ]
    },
    "throwShuriken": {
      "gain": 0.55,
      "files": [
        "throwShuriken-1.wav",
        "throwShuriken-2.wav",
        "throwShuriken-3.wav",
        "throwShuriken-4.wav",
        "throwShuriken-5.wav"
      ]
    },
    "shurikenRing": {
      "gain": 0.45,
      "files": [
        "shurikenRing-1.wav",
        "shurikenRing-2.wav",
        "shurikenRing-3.wav",
        "shurikenRing-4.wav",
        "shurikenRing-5.wav"
      ]
    },
    "bowDraw": {
      "gain": 0.5,
      "files": [
        "bowDraw-1.wav",
        "bowDraw-2.wav",
        "bowDraw-3.wav",
        "bowDraw-4.wav",
        "bowDraw-5.wav",
        "bowDraw-6.wav"
      ]
    },
    "bowRelease": {
      "gain": 0.7,
      "files": [
        "bowRelease-1.wav",
        "bowRelease-2.wav",
        "bowRelease-3.wav"
      ]
    },
    "arrowSwish": {
      "gain": 0.5,
      "files": [
        "arrowSwish-1.wav",
        "arrowSwish-2.wav",
        "arrowSwish-3.wav"
      ]
    },
    "slash": {
      "gain": 0.7,
      "files": [
        "slash-1.wav",
        "slash-2.wav",
        "slash-3.wav",
        "slash-4.wav",
        "slash-5.wav",
        "slash-6.wav"
      ]
    },
    "slashRing": {
      "gain": 0.45,
      "files": [
        "slashRing-1.wav",
        "slashRing-2.wav",
        "slashRing-3.wav",
        "slashRing-4.wav",
        "slashRing-5.wav"
      ]
    },
    "slashHeavy": {
      "gain": 0.9,
      "files": [
        "slashHeavy-1.wav",
        "slashHeavy-2.wav",
        "slashHeavy-3.wav",
        "slashHeavy-4.wav",
        "slashHeavy-5.wav"
      ]
    },
    "chargeOrb": {
      "gain": 0.5,
      "files": [
        "chargeOrb-1.wav",
        "chargeOrb-2.wav",
        "chargeOrb-3.wav",
        "chargeOrb-4.wav",
        "chargeOrb-5.wav"
      ]
    },
    "castOrb": {
      "gain": 0.7,
      "files": [
        "castOrb-1.wav",
        "castOrb-2.wav",
        "castOrb-3.wav",
        "castOrb-4.wav",
        "castOrb-5.wav",
        "castOrb-6.wav",
        "castOrb-7.wav",
        "castOrb-8.wav",
        "castOrb-9.wav",
        "castOrb-10.wav"
      ]
    },
    "hitShuriken": {
      "gain": 0.7,
      "files": [
        "hitShuriken-1.wav",
        "hitShuriken-2.wav",
        "hitShuriken-3.wav",
        "hitShuriken-4.wav",
        "hitShuriken-5.wav"
      ]
    },
    "hitArrow": {
      "gain": 0.8,
      "files": [
        "hitArrow-1.wav",
        "hitArrow-2.wav",
        "hitArrow-3.wav",
        "hitArrow-4.wav",
        "hitArrow-5.wav"
      ]
    },
    "hitSlash": {
      "gain": 0.9,
      "files": [
        "hitSlash-1.wav",
        "hitSlash-2.wav",
        "hitSlash-3.wav",
        "hitSlash-4.wav",
        "hitSlash-5.wav"
      ]
    },
    "hitOrb": {
      "gain": 0.85,
      "files": [
        "hitOrb-1.wav",
        "hitOrb-2.wav",
        "hitOrb-3.wav",
        "hitOrb-4.wav",
        "hitOrb-5.wav"
      ]
    },
    "impactSpark": {
      "gain": 0.4,
      "files": [
        "impactSpark-1.wav",
        "impactSpark-2.wav",
        "impactSpark-3.wav",
        "impactSpark-4.wav",
        "impactSpark-5.wav"
      ]
    },
    "hurt": {
      "gain": 0.8,
      "files": [
        "hurt-1.wav",
        "hurt-2.wav",
        "hurt-3.wav",
        "hurt-4.wav",
        "hurt-5.wav"
      ]
    },
    "hurtCritical": {
      "gain": 0.95,
      "files": [
        "hurtCritical-1.wav",
        "hurtCritical-2.wav",
        "hurtCritical-3.wav",
        "hurtCritical-4.wav",
        "hurtCritical-5.wav"
      ]
    },
    "fizzle": {
      "gain": 0.35,
      "files": [
        "fizzle-1.wav",
        "fizzle-2.wav",
        "fizzle-3.wav",
        "fizzle-4.wav"
      ]
    },
    "ko": {
      "gain": 0.95,
      "files": [
        "ko-1.wav",
        "ko-2.wav",
        "ko-3.wav",
        "ko-4.wav",
        "ko-5.wav"
      ]
    },
    "koBoom": {
      "gain": 0.85,
      "files": [
        "koBoom-1.wav",
        "koBoom-2.wav",
        "koBoom-3.wav",
        "koBoom-4.wav",
        "koBoom-5.wav"
      ]
    },
    "koEnemy": {
      "gain": 0.65,
      "files": [
        "koEnemy-1.wav",
        "koEnemy-2.wav",
        "koEnemy-3.wav",
        "koEnemy-4.wav",
        "koEnemy-5.wav",
        "koEnemy-6.wav"
      ]
    },
    "respawn": {
      "gain": 0.6,
      "files": [
        "respawn-1.wav",
        "respawn-2.wav",
        "respawn-3.wav",
        "respawn-4.wav",
        "respawn-5.wav"
      ]
    },
    "regen": {
      "gain": 0.35,
      "files": [
        "regen-1.wav",
        "regen-2.wav",
        "regen-3.wav",
        "regen-4.wav",
        "regen-5.wav",
        "regen-6.wav"
      ]
    },
    "shieldOff": {
      "gain": 0.45,
      "files": [
        "shieldOff-1.wav",
        "shieldOff-2.wav",
        "shieldOff-3.wav",
        "shieldOff-4.wav"
      ]
    },
    "playerJoin": {
      "gain": 0.5,
      "files": [
        "playerJoin-1.wav",
        "playerJoin-2.wav",
        "playerJoin-3.wav",
        "playerJoin-4.wav",
        "playerJoin-5.wav"
      ]
    },
    "playerLeave": {
      "gain": 0.5,
      "files": [
        "playerLeave-1.wav",
        "playerLeave-2.wav",
        "playerLeave-3.wav",
        "playerLeave-4.wav",
        "playerLeave-5.wav"
      ]
    },
    "connectionLost": {
      "gain": 0.6,
      "files": [
        "connectionLost-1.wav",
        "connectionLost-2.wav",
        "connectionLost-3.wav",
        "connectionLost-4.wav"
      ]
    },
    "connected": {
      "gain": 0.5,
      "files": [
        "connected-1.wav",
        "connected-2.wav",
        "connected-3.wav",
        "connected-4.wav",
        "connected-5.wav"
      ]
    }
  }
};
