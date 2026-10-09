"use strict";

/**
 * Vérifie l'inventaire en barre de raccourcis hors navigateur : neuf
 * emplacements, piles de 64 maximum, complément des piles existantes, refus
 * quand tout est plein, sélection et défilement en boucle (molette).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "inventory.js"), "utf8");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Inventory = sandbox.window.PixWorldInventory;
assert(Inventory && typeof Inventory.create === "function", "Le module d'inventaire est chargé");
const { SLOTS, MAX_STACK } = Inventory.constants;
assert.strictEqual(SLOTS, 9, "Neuf emplacements, comme la barre de Minecraft");
assert.strictEqual(MAX_STACK, 64, "Piles de 64 blocs");

const inventory = Inventory.create();
assert.strictEqual(inventory.size, 9, "La barre a neuf emplacements");
assert.strictEqual(inventory.selected, 0, "Le premier emplacement est sélectionné au départ");
assert.strictEqual(inventory.selectedItem, null, "Au départ, l'emplacement sélectionné est vide");

// ── Ajout et empilement ─────────────────────────────────────────────────────
assert.strictEqual(inventory.add("dirt"), 0, "Un bloc de terre entre");
assert.strictEqual(inventory.countOf("dirt"), 1, "Une terre dans l'inventaire");
assert.strictEqual(inventory.snapshot()[0].type, "dirt", "La terre occupe le premier emplacement");
inventory.add("dirt");
inventory.add("stone");
assert.strictEqual(inventory.countOf("dirt"), 2, "Deux terres");
assert.strictEqual(inventory.snapshot()[1].type, "stone", "La pierre est dans le deuxième emplacement");
assert.strictEqual(inventory.snapshot()[1].count, 1, "Une pierre");
assert.strictEqual(inventory.snapshot()[0].count, 2, "Les deux terres sont empilées");

// Les quantités restent exactes après de nombreux ajouts.
for (let i = 0; i < 10; i++) inventory.add("grass");
assert.strictEqual(inventory.countOf("grass"), 10, "Dix herbes");
assert.strictEqual(inventory.add("grass", 5), 0, "Ajout de plusieurs blocs d'un coup");
assert.strictEqual(inventory.countOf("grass"), 15, "Quinze herbes");

// ── Pile maximale et débordement ────────────────────────────────────────────
const full = Inventory.create({ slots: 2 });
assert.strictEqual(full.add("stone", 64), 0, "Une pile complète tient");
assert.strictEqual(full.snapshot()[0].count, 64, "Pile de 64");
assert.strictEqual(full.add("stone", 64), 0, "La deuxième pile tient dans le deuxième emplacement");
assert.strictEqual(full.countOf("stone"), 128, "128 pierres en deux piles");
assert.strictEqual(full.add("stone", 1), 1, "Plus de place : le bloc reste dehors");
assert.strictEqual(full.add("dirt", 1), 1, "Aucune place pour un nouveau type non plus");
assert.strictEqual(full.countOf("dirt"), 0, "Rien n'est ajouté quand l'inventaire est plein");
assert.strictEqual(full.canAdd("stone", 1), false, "canAdd ne voit pas de place");
assert.strictEqual(full.canAdd("grass", 1), false, "canAdd : pas de place pour un nouveau type");

const partial = Inventory.create({ slots: 1 });
partial.add("dirt", 60);
assert.strictEqual(partial.add("dirt", 10), 6, "Seules 4 terres complètent la pile, 6 restent dehors");
assert.strictEqual(partial.countOf("dirt"), 64, "La pile ne dépasse jamais 64");
assert.strictEqual(partial.canAdd("dirt", 1), false, "Pile pleine : canAdd est faux");

// ── Sélection et défilement en boucle ───────────────────────────────────────
const bar = Inventory.create();
assert.strictEqual(bar.scroll(1), 1, "La molette vers le bas passe à l'emplacement suivant");
assert.strictEqual(bar.scroll(-1), 0, "La molette vers le haut revient");
assert.strictEqual(bar.scroll(-1), 8, "Depuis le premier, on boucle sur le dernier");
assert.strictEqual(bar.scroll(1), 0, "Depuis le dernier, on boucle sur le premier");
assert.strictEqual(bar.select(4), 4, "Choix direct de l'emplacement 5 (touche 5)");
assert.strictEqual(bar.select(12), 3, "Un index hors barre reste dans la barre");
assert.strictEqual(bar.select(-1), 8, "Un index négatif boucle aussi");
assert.strictEqual(bar.selected, 8, "La sélection est bien mémorisée");

// selectedItem suit la sélection : pierre en 1, terre en 2, vide en 3.
bar.add("stone", 3); // emplacement 1 (index 0)
bar.add("dirt"); // emplacement 2 (index 1)
bar.select(0);
assert.strictEqual(JSON.stringify(bar.selectedItem), '{"type":"stone","count":3}', "L'emplacement 1 contient la pierre");
bar.scroll(1);
assert.strictEqual(JSON.stringify(bar.selectedItem), '{"type":"dirt","count":1}', "Le défilement passe à la terre");
bar.scroll(1);
assert.strictEqual(bar.selectedItem, null, "Un emplacement vide n'a pas de contenu");
bar.scroll(-2);
assert.strictEqual(bar.selected, 0, "Deux crans en arrière ramènent au premier emplacement");

// snapshot est une copie : la modifier n'altère pas l'inventaire.
const copy = bar.snapshot();
copy[0].count = 999;
assert.strictEqual(bar.countOf("dirt"), 1, "snapshot renvoie une copie");

console.log("inventory.test.js : ok");
