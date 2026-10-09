"use strict";

/**
 * Vérifie l'herbe interactive hors navigateur : la pose des touffes reste celle
 * du décor, une touffe se courbe dans le sens de la marche puis revient au
 * repos, ne réagit ni au saut ni à la marche lente, et émet des froissements
 * espacés (et seulement parfois des brins), sans jamais s'emballer.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "grass.js"), "utf8");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const Grass = sandbox.window.PixWorldGrass;
assert(Grass && typeof Grass.create === "function" && typeof Grass.tuftFor === "function", "Le module d'herbe est chargé");
const { TILE, TUFT_WIDTH, MAX_LEAN, CONTACT_GAP } = Grass.constants;

/** Générateur déterministe : les tests restent reproductibles. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Moteur d'herbe avec ses événements horodatés (horloge pilotée par run()). */
function createHarness(random = seeded(7)) {
  const clock = { t: 0 };
  const rustles = [];
  const blades = [];
  const grass = Grass.create({
    random,
    onRustle: (event) => rustles.push(Object.assign({ at: clock.t }, event)),
    onBlades: (event) => blades.push(Object.assign({ at: clock.t }, event)),
  });
  return { grass, clock, rustles, blades };
}

/** Personnage qui avance à vitesse constante à partir de startX, pieds au sol. */
function straight(startX, speed, id = "self") {
  return (t) => ({ id, x: startX + speed * t, width: 42, vx: speed, gap: 0 });
}

/** Personnage immobile, pieds au sol. */
function standing(x) {
  return () => ({ id: "self", x, width: 42, vx: 0, gap: 0 });
}

/**
 * Fait tourner l'herbe pendant `seconds` à 60 images par seconde. `walkerAt(t)`
 * décrit le personnage à l'instant t (ou null). Renvoie la courbure et l'agitation
 * de la touffe `tile` à chaque image.
 */
function run(harness, seconds, walkerAt, tile) {
  const dt = 1 / 60;
  const leans = [];
  const waves = [];
  for (let t = 0; t < seconds; t += dt) {
    harness.clock.t = t;
    const walker = walkerAt(t);
    harness.grass.update(dt, walker ? [walker] : []);
    const pose = harness.grass.poseFor(tile);
    leans.push(pose ? pose.lean : 0);
    waves.push(pose ? pose.wave : 0);
  }
  return { leans, waves };
}

// 1. Placement : les touffes gardent exactement la pose du décor d'origine.
const placed = [];
for (let tile = 0; tile <= 40; tile++) if (Grass.tuftFor(tile)) placed.push(tile);
assert.deepStrictEqual(placed, [0, 3, 5, 20, 29, 39], "Les six touffes du niveau gardent leur place");
assert.deepStrictEqual(
  placed.map((tile) => Grass.tuftFor(tile).variant),
  [1, 1, 1, 0, 0, 0],
  "Chaque touffe garde sa variante de la feuille de tuiles",
);
const tuft = Grass.tuftFor(3);
assert.strictEqual(tuft.x0, 3 * TILE + 8, "La touffe commence 8 px après le bord de sa tuile");
assert.strictEqual(tuft.x1 - tuft.x0, TUFT_WIDTH, "La touffe occupe 48 px");
assert.strictEqual(Grass.tuftFor(1), null, "Une tuile sans touffe renvoie null");
console.log("  ok   Les six touffes du niveau gardent leur place et leur variante");

// 2. Au repos, rien ne bouge : ni courbure, ni son, ni brin, ni état conservé.
{
  const harness = createHarness();
  const { leans } = run(harness, 1, standing(210), 3);
  assert(leans.every((lean) => lean === 0), "Une touffe non touchée reste droite");
  assert.strictEqual(harness.rustles.length + harness.blades.length, 0, "Aucun son ni brin sans contact");
  assert.strictEqual(harness.grass.activeCount, 0, "Aucun état conservé pour les touffes au repos");
}
console.log("  ok   Au repos, la touffe reste droite et silencieuse");

// 3. Marche à pleine vitesse : la pointe se courbe dans le sens de la marche,
//    puis revient au repos en oscillant légèrement.
{
  const harness = createHarness();
  const { leans } = run(harness, 2.5, straight(112, 340), 3);
  const peak = Math.max(...leans);
  const rebound = Math.min(...leans);
  assert(peak > 0.9 * MAX_LEAN && peak < 1.4 * MAX_LEAN, "La pointe se courbe vers la droite (" + peak.toFixed(1) + " px)");
  assert(rebound < 0 && rebound > -0.5 * MAX_LEAN, "La pointe revient avec un léger rebond (" + rebound.toFixed(1) + " px)");
  assert(Math.abs(leans[leans.length - 1]) < 0.05, "La touffe finit au repos");
  assert.strictEqual(harness.grass.activeCount, 0, "Plus aucun état une fois revenue au repos");
  assert(harness.rustles.length >= 1, "La traversée produit un froissement");
}
{
  const harness = createHarness();
  const { leans } = run(harness, 2, straight(330, -340), 3);
  assert(Math.min(...leans) < -0.9 * MAX_LEAN, "En marche arrière, la pointe se courbe vers la gauche");
}
console.log("  ok   Marche vers la droite et vers la gauche, retour au repos");

// 4. Saut au-dessus de la touffe : aucun contact. Marche lente : l'herbe plie à peine, sans son.
{
  const harness = createHarness();
  const airborne = () => ({ id: "self", x: 170, width: 42, vx: 340, gap: CONTACT_GAP + 20 });
  const { leans } = run(harness, 1, airborne, 3);
  assert(leans.every((lean) => lean === 0), "En l'air, la touffe ne bouge pas");
  assert.strictEqual(harness.rustles.length, 0, "En l'air, aucun froissement");
}
{
  const harness = createHarness();
  const { leans } = run(harness, 2, straight(112, 60), 3);
  const peak = Math.max(...leans);
  assert(peak > 0.5 && peak < 0.3 * MAX_LEAN, "Une marche lente plie à peine la touffe (" + peak.toFixed(1) + " px)");
  assert.strictEqual(harness.rustles.length, 0, "Une marche lente ne fait pas de bruit");
}
console.log("  ok   Pas de réaction en l'air, à peine une courbure à marche lente");

// 5. Froissements : au plus un par touffe toutes les 0,16 s, avec les bonnes données.
{
  const harness = createHarness(seeded(3));
  // Un personnage piétine dans la touffe en changeant de sens toutes les 0,12 s.
  const stomping = (t) => ({ id: "self", x: 215, width: 42, vx: Math.floor(t / 0.12) % 2 ? -340 : 340, gap: 0 });
  run(harness, 6, stomping, 3);
  const times = harness.rustles.map((event) => event.at);
  assert(times.length >= 10, "Un piétinement prolongé produit plusieurs froissements (" + times.length + ")");
  for (let i = 1; i < times.length; i++) {
    assert(times[i] - times[i - 1] >= 0.16 - 1e-6, "Deux froissements sont espacés d'au moins 0,16 s");
  }
  assert(times.length <= 6 / 0.16 + 1, "Le nombre de froissements reste borné");
  const first = harness.rustles[0];
  assert.strictEqual(first.tile, 3, "Le froissement désigne la bonne touffe");
  assert.strictEqual(first.x, 3 * TILE + 32, "Il est situé au centre de la touffe");
  assert.strictEqual(first.walkerId, "self", "Il est attribué au joueur local");
  assert.strictEqual(first.dir, 1, "Il indique le sens de la marche");
  assert.strictEqual(first.strength, 1, "Il est à pleine force à vitesse de marche");
}
console.log("  ok   Froissements espacés, bornés et décrits");

// 6. Parfois seulement : des brins accompagnent une part des froissements.
{
  const harness = createHarness(seeded(11));
  run(harness, 60, (t) => ({ id: "self", x: 215, width: 42, vx: Math.floor(t / 0.12) % 2 ? -340 : 340, gap: 0 }), 3);
  const ratio = harness.blades.length / harness.rustles.length;
  assert(harness.rustles.length > 200, "Une minute de piétinement produit beaucoup de froissements");
  assert(ratio > 0.25 && ratio < 0.45, "Des brins ne partent que parfois (" + Math.round(ratio * 100) + " % des froissements)");
}
console.log("  ok   Des brins ne partent que parfois");

// 7. Personnages distants : pris en compte avec leur identifiant ; les touffes lointaines restent immobiles.
{
  const harness = createHarness();
  run(harness, 1, straight(150, 340, "p7"), 3);
  assert(harness.rustles.length > 0, "Un joueur distant déclenche le froissement");
  assert(harness.rustles.every((event) => event.walkerId === "p7"), "Le froissement garde l'identifiant du joueur distant");
}
{
  // Depuis x = 900, le personnage n'atteint ni la touffe 3 ni la touffe 20 (x ≈ 1288) en 0,5 s.
  const harness = createHarness();
  const { leans } = run(harness, 0.5, straight(900, 340), 3);
  assert(leans.every((lean) => lean === 0) && harness.rustles.length === 0, "Une touffe éloignée ne réagit pas");
  // En traversant la touffe 20, seule celle-ci réagit.
  const other = createHarness();
  const passing = run(other, 1, straight(1100, 340), 3);
  assert(passing.leans.every((lean) => lean === 0), "La touffe 3 reste immobile quand on passe plus loin");
  assert(other.rustles.length > 0 && other.rustles.every((event) => event.tile === 20), "Seule la touffe traversée sonne");
}
console.log("  ok   Joueurs distants identifiés, touffes lointaines immobiles");

// 8. Stabilité : fort recul, grand pas de temps, valeurs toujours finies et bornées.
{
  const harness = createHarness();
  const { leans, waves } = run(harness, 3, straight(112, 1000), 3);
  assert(leans.every(Number.isFinite) && waves.every(Number.isFinite), "Valeurs finies même avec un fort recul");
  assert(Math.max(...leans.map(Math.abs)) <= 2 * MAX_LEAN, "La courbure reste bornée");
  assert(waves.every((wave) => wave >= 0 && wave <= 1), "L'agitation reste entre 0 et 1");
  assert.doesNotThrow(() => harness.grass.update(5, [straight(150, 340)(0)]), "Un pas de temps énorme ne casse rien");
  const big = harness.grass.poseFor(3);
  assert(!big || Math.abs(big.lean) <= 2 * MAX_LEAN, "Un pas de temps énorme reste borné");
}
console.log("  ok   Valeurs finies et bornées, même avec un fort recul");

// 9. Remise à zéro et entrées incomplètes.
{
  const harness = createHarness();
  run(harness, 0.5, straight(150, 340), 3);
  assert(harness.grass.activeCount > 0, "La touffe est en mouvement avant la remise à zéro");
  harness.grass.clear();
  assert.strictEqual(harness.grass.poseFor(3), null, "clear() remet toutes les touffes au repos");
  assert.strictEqual(harness.grass.activeCount, 0, "clear() vide l'état");
  assert.doesNotThrow(() => harness.grass.update(undefined, [{}]), "Un personnage incomplet est ignoré");
  assert.doesNotThrow(() => Grass.create().update(1 / 60, [straight(150, 340)(0)]), "Sans options, le module fonctionne");
}
console.log("  ok   Remise à zéro et entrées incomplètes");
console.log("Herbe interactive valide");
