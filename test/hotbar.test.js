"use strict";

/**
 * Vérifie la barre de raccourcis hors navigateur, sur un faux DOM minimal :
 * neuf emplacements créés, icône et quantité mises à jour, emplacement
 * sélectionné encadré, étiquette « Terre × 12 », clics qui sélectionnent.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = path.join(__dirname, "..", "src");

function fakeClassList() {
  const names = new Set();
  return {
    add: (name) => names.add(name),
    remove: (name) => names.delete(name),
    contains: (name) => names.has(name),
    toggle(name, force) {
      const on = force === undefined ? !names.has(name) : Boolean(force);
      if (on) names.add(name);
      else names.delete(name);
      return on;
    },
  };
}

function fakeElement(tag) {
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    listeners: {},
    classList: fakeClassList(),
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    textContent: "",
    className: "",
    title: "",
    hidden: false,
    offsetTop: 0,
    offsetHeight: 40,
    append(...nodes) {
      element.children.push(...nodes);
    },
    addEventListener(type, handler) {
      (element.listeners[type] = element.listeners[type] || []).push(handler);
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete element.attributes[name];
      if (name === "src") delete element.src;
    },
  };
  return element;
}

const sandbox = {
  window: {},
  console,
  document: { createElement: fakeElement },
  setTimeout: () => 0,
  clearTimeout: () => {},
};
vm.createContext(sandbox);
["inventory.js", "hotbar.js"].forEach((file) => vm.runInContext(fs.readFileSync(path.join(src, file), "utf8"), sandbox));

const Hotbar = sandbox.window.PixWorldHotbar;
const Inventory = sandbox.window.PixWorldInventory;
assert(Hotbar && typeof Hotbar.create === "function", "La barre de raccourcis est chargée");

const list = fakeElement("ol");
const wrap = fakeElement("div");
const label = fakeElement("p");
const clicks = [];
const hotbar = Hotbar.create({ root: list, wrap, label, onSelect: (index) => clicks.push(index) });

assert.strictEqual(hotbar.size, 9, "Neuf emplacements");
assert.strictEqual(list.children.length, 9, "Neuf éléments de liste dans la barre");
const button = (index) => list.children[index].children[0];
assert.strictEqual(button(0).dataset.slot, "0", "Chaque emplacement connaît son index");
assert.strictEqual(button(8).children[0].textContent, "9", "Les touches 1 à 9 sont affichées");

const inventory = Inventory.create();
inventory.add("grass", 5);
inventory.add("stone", 2);
hotbar.render(inventory);
assert.strictEqual(button(0).children[1].src, "assets/blocks/grass.png", "L'herbe a son icône");
assert.strictEqual(button(0).children[1].hidden, false, "L'icône est visible");
assert.strictEqual(button(0).children[2].textContent, "5", "La quantité de l'herbe est affichée");
assert.strictEqual(button(1).children[2].textContent, "2", "La quantité de pierre est affichée");
assert.strictEqual(button(2).children[1].hidden, true, "Un emplacement vide n'a pas d'icône");
assert.strictEqual(button(2).children[2].textContent, "", "Ni de quantité");
assert.strictEqual(button(0).classList.contains("is-selected"), true, "Le premier emplacement est encadré");
assert.strictEqual(button(0).attributes["aria-pressed"], "true", "Accessibilité : emplacement sélectionné");

// La molette change la sélection : la mise en forme suit.
inventory.scroll(2);
hotbar.render(inventory);
assert.strictEqual(button(0).classList.contains("is-selected"), false, "L'ancien emplacement n'est plus encadré");
assert.strictEqual(button(2).classList.contains("is-selected"), true, "Le nouvel emplacement est encadré");

// Étiquette : le nom du bloc et sa quantité, à côté de l'emplacement choisi.
inventory.select(0);
hotbar.showName(inventory);
assert.strictEqual(label.textContent, "Herbe × 5", "L'étiquette donne le nom et la quantité");
assert.strictEqual(label.classList.contains("is-visible"), true, "L'étiquette s'affiche");
assert.strictEqual(label.style["--name-y"], "20px", "L'étiquette s'aligne sur l'emplacement sélectionné");

// La barre se masque hors partie.
hotbar.show(false);
assert.strictEqual(wrap.hidden, true, "Masquée au menu");
hotbar.show(true);
assert.strictEqual(wrap.hidden, false, "Visible en partie");

// Un clic sur un emplacement demande sa sélection.
button(4).listeners.click[0]();
assert.deepStrictEqual(clicks, [4], "Le clic transmet l'index de l'emplacement");

console.log("hotbar.test.js : ok");
