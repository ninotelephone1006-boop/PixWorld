/**
 * PixWorld — barre de raccourcis de l'inventaire (au centre à droite de l'écran).
 *
 * Neuf emplacements façon Minecraft : chacun montre le bloc qu'il contient et
 * sa quantité. L'emplacement sélectionné est encadré. La molette, les touches 1
 * à 9 ou un clic sur un emplacement changent la sélection (src/game.js). Ce
 * module ne fait que l'affichage : l'état vient de src/inventory.js.
 *
 *   const hotbar = PixWorldHotbar.create({ root, wrap, label, onSelect });
 *   hotbar.render(inventory);     // après chaque changement d'inventaire
 *   hotbar.showName(inventory);   // étiquette du bloc sélectionné, qui s'estompe
 *   hotbar.show(true | false);
 */
window.PixWorldHotbar = (() => {
  "use strict";

  const NAMES = Object.freeze({ grass: "Herbe", dirt: "Terre", stone: "Pierre", bedrock: "Roche-mère" });
  const ICONS = Object.freeze({
    grass: "assets/blocks/grass.png",
    dirt: "assets/blocks/dirt.png",
    stone: "assets/blocks/stone.png",
    bedrock: "assets/blocks/bedrock.png",
  });
  const NAME_DURATION = 1600; // durée d'affichage de l'étiquette, en ms

  function create(options) {
    const settings = options || {};
    const root = settings.root;
    if (!root) throw new Error("PixWorldHotbar.create : un élément racine est requis");
    const wrap = settings.wrap || null;
    const label = settings.label || null;
    const onSelect = settings.onSelect || (() => {});
    const size = settings.size || 9;
    const slots = [];
    let nameTimer = null;

    for (let index = 0; index < size; index++) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hotbar-slot";
      button.dataset.slot = String(index);

      const key = document.createElement("span");
      key.className = "hotbar-key";
      key.textContent = String(index + 1);

      const icon = document.createElement("img");
      icon.className = "hotbar-icon";
      icon.alt = "";
      icon.draggable = false;
      icon.hidden = true;

      const count = document.createElement("span");
      count.className = "hotbar-count";

      button.append(key, icon, count);
      item.append(button);
      root.append(item);
      button.addEventListener("click", () => onSelect(index));
      slots.push({ button, icon, count, type: null });
    }

    /** Met à jour les emplacements : icône, quantité, sélection. */
    function render(inventory) {
      const contents = inventory.snapshot();
      slots.forEach((slot, index) => {
        const item = contents[index];
        const type = item ? item.type : null;
        if (type !== slot.type) {
          slot.type = type;
          if (type) {
            slot.icon.src = ICONS[type];
            slot.icon.hidden = false;
          } else {
            slot.icon.removeAttribute("src");
            slot.icon.hidden = true;
          }
        }
        slot.count.textContent = item ? String(item.count) : "";
        const selected = index === inventory.selected;
        slot.button.classList.toggle("is-selected", selected);
        slot.button.setAttribute("aria-pressed", String(selected));
        const name = item ? (NAMES[item.type] || item.type) + " : " + item.count : "vide";
        slot.button.setAttribute("aria-label", "Emplacement " + (index + 1) + ", " + name);
        slot.button.title = (NAMES[item && item.type] || "Emplacement vide") + (item ? " × " + item.count : "");
      });
    }

    /** Étiquette à côté de l'emplacement sélectionné : « Terre × 12 ». */
    function showName(inventory) {
      if (!label) return;
      const item = inventory.selectedItem;
      const slot = slots[inventory.selected];
      if (wrap && slot) {
        const y = slot.button.offsetTop + slot.button.offsetHeight / 2;
        label.style.setProperty("--name-y", y + "px");
      }
      label.textContent = item ? (NAMES[item.type] || item.type) + " × " + item.count : "Emplacement vide";
      label.classList.add("is-visible");
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => label.classList.remove("is-visible"), NAME_DURATION);
    }

    function show(visible) {
      if (wrap) wrap.hidden = !visible;
    }

    return { render, showName, show, get size() { return slots.length; } };
  }

  return {
    create,
    NAMES,
  };
})();
