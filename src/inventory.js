/**
 * PixWorld — inventaire de blocs, en barre de raccourcis.
 *
 * Neuf emplacements, comme la barre de raccourcis de Minecraft. Chaque
 * emplacement contient un type de bloc et une quantité (pile de 64 au
 * maximum). Un bloc ramassé complète d'abord une pile existante du même type,
 * puis occupe le premier emplacement vide. La sélection tourne en boucle.
 *
 *   const inventory = PixWorldInventory.create();
 *   inventory.add("stone");          // renvoie ce qui n'a pas pu entrer (0 = tout est rangé)
 *   inventory.scroll(1);             // emplacement suivant (-1 : précédent), en boucle
 *   inventory.select(4);             // emplacement 5
 *   inventory.selectedItem;          // { type, count } ou null
 *   inventory.countOf("dirt");       // quantité totale de ce bloc
 */
window.PixWorldInventory = (() => {
  "use strict";

  const SLOTS = 9;
  const MAX_STACK = 64;

  function create(options) {
    const settings = options || {};
    const size = Math.max(1, Math.floor(Number(settings.slots) || SLOTS));
    const maxStack = Math.max(1, Math.floor(Number(settings.maxStack) || MAX_STACK));
    const slots = Array.from({ length: size }, () => null);
    let selected = 0;

    function wrap(index) {
      return ((index % size) + size) % size;
    }

    /** Range `amount` blocs de ce type. Renvoie le nombre qui n'a pas trouvé de place. */
    function add(type, amount) {
      let left = Math.max(0, Math.floor(Number(amount) || 1));
      for (let i = 0; i < size && left > 0; i++) {
        const slot = slots[i];
        if (slot && slot.type === type && slot.count < maxStack) {
          const moved = Math.min(left, maxStack - slot.count);
          slot.count += moved;
          left -= moved;
        }
      }
      for (let i = 0; i < size && left > 0; i++) {
        if (!slots[i]) {
          const moved = Math.min(left, maxStack);
          slots[i] = { type, count: moved };
          left -= moved;
        }
      }
      return left;
    }

    /** Vrai si `amount` blocs de ce type tiendraient, sans rien modifier. */
    function canAdd(type, amount) {
      let room = 0;
      slots.forEach((slot) => {
        if (!slot) room += maxStack;
        else if (slot.type === type) room += maxStack - slot.count;
      });
      return room >= Math.max(0, Math.floor(Number(amount) || 1));
    }

    /** Sélectionne un emplacement (index 0 à size - 1, en boucle). */
    function select(index) {
      selected = wrap(Math.floor(Number(index) || 0));
      return selected;
    }

    /** Fait défiler la sélection : +1 vers la droite, -1 vers la gauche. */
    function scroll(steps) {
      selected = wrap(selected + Math.trunc(Number(steps) || 0));
      return selected;
    }

    function countOf(type) {
      return slots.reduce((total, slot) => total + (slot && slot.type === type ? slot.count : 0), 0);
    }

    /** Copie des emplacements : { type, count } ou null pour chacun. */
    function snapshot() {
      return slots.map((slot) => (slot ? { type: slot.type, count: slot.count } : null));
    }

    return {
      size,
      maxStack,
      add,
      canAdd,
      select,
      scroll,
      countOf,
      snapshot,
      get selected() {
        return selected;
      },
      get selectedItem() {
        const slot = slots[selected];
        return slot ? { type: slot.type, count: slot.count } : null;
      },
    };
  }

  return {
    create,
    constants: Object.freeze({ SLOTS, MAX_STACK }),
  };
})();
