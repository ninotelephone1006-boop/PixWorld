/**
 * PixWorld — objets lâchés par les blocs cassés.
 *
 * Un bloc cassé laisse un objet du même type. L'objet jaillit un peu, retombe
 * et se pose sur le terrain (src/terrain.js). Un objet proche du héros est
 * attiré vers lui : un bloc tombé au fond d'un trou étroit, que le héros ne
 * peut pas descendre, remonte ainsi jusqu'à lui. Il est ramassé dès qu'il le
 * touche. Un très court délai évite de le ramasser à l'instant où il apparaît.
 *
 *   const drops = PixWorldDrops.create({ terrain });
 *   drops.spawn("stone", x, y);                       // centre de la case (px monde / profondeur)
 *   drops.update(delta, box | null);                  // box : boîte du héros, ou null (pas d'attraction)
 *   const taken = drops.collect(box, (type) => ok);   // ok : true si l'inventaire a accepté
 *   drops.list;                                       // objets présents (pour le rendu)
 */
window.PixWorldDrops = (() => {
  "use strict";

  const SIZE = 12; // taille de la boîte d'un objet (px)
  const GRAVITY = 1400; // px/s²
  const POP_SPEED = 170; // vitesse de jaillissement vers le haut (px/s)
  const SIDE_SPEED = 45; // dispersion horizontale au lancer (px/s)
  const BOUNCE = 0.3; // part de la vitesse conservée après un choc contre un mur
  const FRICTION = 12; // ralentissement au sol (1/s)
  const PICKUP_DELAY = 0.25; // secondes avant qu'un objet puisse être ramassé
  const REACH_X = 15; // contact élargi sur les côtés (px)
  const REACH_Y = 30; // contact élargi au-dessus et au-dessous (px)
  const MAX_ITEMS = 200;
  const MAX_DELTA = 0.05;
  const MAGNET_BLOCKS = 4; // rayon d'attraction vers le héros, en blocs
  const MAGNET_SPEED = 260; // vitesse de l'objet attiré (px/s)

  function create(options) {
    const settings = options || {};
    const terrain = settings.terrain;
    if (!terrain) throw new Error("PixWorldDrops.create : un terrain est requis");
    const random = typeof settings.random === "function" ? settings.random : Math.random;
    const items = [];

    /** Fait apparaître un objet au centre de la case (x monde, y profondeur). */
    function spawn(type, x, y) {
      items.push({
        type,
        x,
        feet: y + SIZE / 2,
        vx: (random() * 2 - 1) * SIDE_SPEED,
        vy: -POP_SPEED * (0.8 + random() * 0.2),
        age: 0,
        delay: PICKUP_DELAY,
        landed: false,
        seed: random() * Math.PI * 2,
      });
      if (items.length > MAX_ITEMS) items.shift();
    }

    /**
     * Chute, collisions avec le terrain et ralentissement au sol. Si `hero`
     * (boîte du héros) est proche, l'objet glisse vers son centre au lieu de
     * tomber ; le terrain l'arrête toujours aux murs.
     */
    function update(delta, hero) {
      const dt = Math.min(Math.max(Number(delta) || 0, 0), MAX_DELTA);
      const range = MAGNET_BLOCKS * terrain.block;
      items.forEach((item) => {
        item.age += dt;
        item.delay = Math.max(0, item.delay - dt);
        let pulled = false;
        if (hero && item.delay <= 0) {
          const dx = hero.x + hero.width / 2 - item.x;
          const dy = hero.feet - hero.height / 2 - (item.feet - SIZE / 2);
          const distance = Math.hypot(dx, dy);
          if (distance < range && distance > 0.5) {
            pulled = true;
            item.vx = (dx / distance) * MAGNET_SPEED;
            item.vy = (dy / distance) * MAGNET_SPEED;
          }
        }
        if (!pulled) {
          item.vy += GRAVITY * dt;
          item.vx *= Math.max(0, 1 - FRICTION * 0.25 * dt);
        }
        const result = terrain.move({ x: item.x - SIZE / 2, feet: item.feet, width: SIZE, height: SIZE }, item.vx * dt, item.vy * dt);
        item.x = result.x + SIZE / 2;
        item.feet = result.feet;
        if (result.hitX) item.vx = -item.vx * BOUNCE;
        if (result.hitY) {
          item.vy = 0;
          item.landed = true;
        } else {
          item.landed = false;
        }
        if (item.landed) {
          item.vx *= Math.max(0, 1 - FRICTION * dt);
          if (Math.abs(item.vx) < 0.5) item.vx = 0;
        }
      });
    }

    /**
     * Ramasse les objets touchés par la boîte du héros. accept(type) doit
     * renvoyer true si l'objet a pu entrer dans l'inventaire ; sinon il reste
     * au sol. Renvoie la liste des types ramassés.
     */
    function collect(box, accept) {
      const taken = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.delay > 0) continue;
        const left = item.x - SIZE / 2;
        const right = item.x + SIZE / 2;
        const top = item.feet - SIZE;
        const bottom = item.feet;
        const near =
          right > box.x - REACH_X &&
          left < box.x + box.width + REACH_X &&
          bottom > box.feet - box.height - REACH_Y &&
          top < box.feet + REACH_Y;
        if (!near) continue;
        if (accept(item.type)) {
          taken.push(item.type);
          items.splice(i, 1);
          i--;
        }
      }
      return taken;
    }

    return {
      spawn,
      update,
      collect,
      clear() {
        items.length = 0;
      },
      get list() {
        return items;
      },
    };
  }

  return {
    create,
    constants: Object.freeze({ SIZE, REACH_X, REACH_Y, PICKUP_DELAY, MAX_ITEMS }),
  };
})();
