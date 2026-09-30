// scene-fit.js — come mettere una scena 3D importata intorno all'avatar.
//
// L'avatar sta nell'origine, in piedi su y = 0, e guarda verso +Z (la
// camera). Una scena si adatta con tre numeri, che room-scene.js applica a un
// contenitore e SceneLibrary salva: scale, rotation (gradi intorno a Y) e
// offset (dove finisce l'origine del modello, in metri).
//
// Alla prima apertura i numeri si stimano:
// - scala: un glTF dovrebbe essere in metri, ma gli altri formati e molti
//   glTF di Sketchfab non lo sono. La mesh col box piu' grande (di solito
//   pareti o terreno) da' l'altezza della stanza: se non e' credibile in
//   metri (fra 2 e 6 m; l'aula di Sketchfab e' alta 10 "metri"), la stanza
//   diventa alta ROOM_HEIGHT_M;
// - pavimento: la quota con piu' area di facce orizzontali nella meta' bassa;
// - posto: il centro del pavimento, o il punto libero piu' vicino se li'
//   c'e' un mobile.
// La stima puo' sbagliare: il pannello "Sistema la scena" corregge a mano.

import * as THREE from 'three';

const ROOM_HEIGHT_M = 4;
const METRIC_ROOM = { min: 2, max: 6 };  // altezze credibili di una stanza in metri
const FLOOR_BINS = 200;
const PROBE_HEIGHT_M = 1.8;       // quanto sopra il pavimento conta come ostacolo
const GRID_M = 0.1;               // celle della mappa del pavimento
const GRID_MAX = 600;
const CLEARANCE_M = 0.3;          // spazio libero intorno ai piedi
const SPOT_RINGS = 12;            // anelli di ricerca di un punto libero
const SPOT_RING_M = 0.3;
const VIEW_M = [0.7, 1.4, 2.1];     // pavimento libero davanti, verso la camera

const DEG = Math.PI / 180;

/** La mesh con il box di volume maggiore, e il suo box (coordinate del modello). */
export function mainMesh(object) {
  object.updateMatrixWorld(true);
  let best = null;
  let bestVolume = -1;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  object.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o).getSize(size);
    const volume = Math.max(size.x, 1e-6) * Math.max(size.y, 1e-6) * Math.max(size.z, 1e-6);
    if (volume > bestVolume) { bestVolume = volume; best = { mesh: o, box: box.clone() }; }
  });
  return best;
}

/**
 * Scala in metri per unita' del modello.
 * @param {THREE.Object3D} object
 * @param {string} format 'gltf', 'fbx' o 'obj'
 */
export function guessScale(object, format) {
  const main = mainMesh(object);
  if (!main) return 1;
  const height = main.box.max.y - main.box.min.y;
  if (!(height > 0)) return 1;
  if (format === 'gltf' && height >= METRIC_ROOM.min && height <= METRIC_ROOM.max) return 1;
  return ROOM_HEIGHT_M / height;
}

/** Ogni triangolo del modello, in coordinate del modello: fn(a, b, c). */
function eachTriangle(object, fn) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      fn(a, b, c);
    }
  });
}

/**
 * Il pavimento: la quota con piu' area di facce orizzontali nella meta' bassa
 * della stanza (la mesh principale: un fondale o un cielo lontano
 * allungherebbero il box del modello intero, e il soffitto finirebbe sotto la
 * meta'), e il centro di quelle facce. Le normali si guardano senza segno:
 * molti modelli hanno il pavimento girato al contrario.
 * @returns {{ y: number, center: THREE.Vector3 } | null}
 */
export function findFloor(object) {
  object.updateMatrixWorld(true);
  const main = mainMesh(object);
  const box = main ? main.box : new THREE.Box3().setFromObject(object);
  const height = box.max.y - box.min.y;
  if (!(height > 0)) return box.isEmpty() ? null : { y: box.min.y, center: box.getCenter(new THREE.Vector3()).setY(box.min.y) };
  const bin = height / FLOOR_BINS;
  const area = new Float64Array(FLOOR_BINS + 1);
  const sumX = new Float64Array(FLOOR_BINS + 1);
  const sumY = new Float64Array(FLOOR_BINS + 1);
  const sumZ = new Float64Array(FLOOR_BINS + 1);
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  eachTriangle(object, (a, b, c) => {
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const len = n.length();
    if (!(len > 0) || Math.abs(n.y) < 0.95 * len) return;
    const y = (a.y + b.y + c.y) / 3;
    if (y < box.min.y || y > box.min.y + height / 2) return;
    const k = Math.min(FLOOR_BINS, Math.max(0, Math.round((y - box.min.y) / bin)));
    const w = len / 2;
    area[k] += w;
    sumX[k] += w * (a.x + b.x + c.x) / 3;
    sumY[k] += w * y;
    sumZ[k] += w * (a.z + b.z + c.z) / 3;
  });
  let best = -1;
  for (let k = 0; k <= FLOOR_BINS; k++) if (area[k] > 0 && (best < 0 || area[k] > area[best])) best = k;
  if (best < 0) return { y: box.min.y, center: box.getCenter(new THREE.Vector3()).setY(box.min.y) };
  return { y: sumY[best] / area[best], center: new THREE.Vector3(sumX[best] / area[best], sumY[best] / area[best], sumZ[best] / area[best]) };
}

/**
 * Mappa vista dall'alto intorno al pavimento, in celle di GRID_M: per ogni
 * cella se c'e' pavimento e se qualcosa ci sta sopra (fino a PROBE_HEIGHT_M).
 * Un solo passaggio sui triangoli: con un raggio per punto, una scena di
 * 300 mila triangoli bloccava la finestra per secondi.
 * @returns {(x: number, z: number) => boolean} pavimento libero in (x, z)
 */
function floorMap(object, floor, scale) {
  // Tutto il modello: la mesh principale puo' essere una sola parete.
  const box = new THREE.Box3().setFromObject(object);
  let cell = GRID_M / scale;
  const width = box.max.x - box.min.x, depth = box.max.z - box.min.z;
  // Mai piu' di GRID_MAX celle per lato: una scena enorme usa celle piu' grandi.
  cell = Math.max(cell, width / GRID_MAX, depth / GRID_MAX);
  const nx = Math.max(1, Math.ceil(width / cell) + 1), nz = Math.max(1, Math.ceil(depth / cell) + 1);
  const ground = new Uint8Array(nx * nz);
  const blocked = new Uint8Array(nx * nz);
  const tolerance = 0.06 / scale;
  const top = floor.y + PROBE_HEIGHT_M / scale;
  const ix = (x) => Math.floor((x - box.min.x) / cell), iz = (z) => Math.floor((z - box.min.z) / cell);
  const mark = (map, i, k) => { if (i >= 0 && k >= 0 && i < nx && k < nz) map[k * nx + i] = 1; };
  // Le celle toccate dal triangolo visto dall'alto: i lati (le pareti
  // verticali, viste dall'alto, sono solo linee) e le celle col centro dentro.
  const cover = (map, a, b, c) => {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (cell / 2)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        mark(map, ix(p.x + (q.x - p.x) * t), iz(p.z + (q.z - p.z) * t));
      }
    }
    const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
    if (Math.abs(area) < 1e-12) return;
    const i0 = Math.max(0, ix(Math.min(a.x, b.x, c.x))), i1 = Math.min(nx - 1, ix(Math.max(a.x, b.x, c.x)));
    const k0 = Math.max(0, iz(Math.min(a.z, b.z, c.z))), k1 = Math.min(nz - 1, iz(Math.max(a.z, b.z, c.z)));
    for (let k = k0; k <= k1; k++) {
      const z = box.min.z + (k + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = box.min.x + (i + 0.5) * cell;
        const w0 = (b.x - x) * (c.z - z) - (c.x - x) * (b.z - z);
        const w1 = (c.x - x) * (a.z - z) - (a.x - x) * (c.z - z);
        const w2 = (a.x - x) * (b.z - z) - (b.x - x) * (a.z - z);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) map[k * nx + i] = 1;
      }
    }
  };
  eachTriangle(object, (a, b, c) => {
    const low = Math.min(a.y, b.y, c.y), high = Math.max(a.y, b.y, c.y);
    if (high < floor.y - tolerance || low > top) return;
    if (low >= floor.y - tolerance && high <= floor.y + tolerance) cover(ground, a, b, c);
    else if (high > floor.y + tolerance) cover(blocked, a, b, c);
  });
  return (x, z) => {
    const i = ix(x), k = iz(z);
    if (i < 0 || k < 0 || i >= nx || k >= nz) return false;
    return ground[k * nx + i] === 1 && blocked[k * nx + i] === 0;
  };
}

/**
 * Un punto del pavimento senza niente sopra, il piu' vicino a floor.center,
 * con spazio intorno ai piedi.
 * @param {THREE.Object3D} object
 * @param {{ y: number, center: THREE.Vector3 }} floor
 * @param {number} scale metri per unita'
 */
export function freeSpot(object, floor, scale) {
  const onFloor = floorMap(object, floor, scale);
  const clearance = CLEARANCE_M / scale;
  const free = (x, z) => onFloor(x, z)
    && onFloor(x + clearance, z) && onFloor(x - clearance, z) && onFloor(x, z + clearance) && onFloor(x, z - clearance);
  // Meglio ancora se e' libero anche verso la camera (+Z): un banco davanti
  // coprirebbe le gambe.
  const view = (x, z) => free(x, z)
    && VIEW_M.every(m => onFloor(x, z + m / scale) && onFloor(x - clearance, z + m / scale) && onFloor(x + clearance, z + m / scale));
  const { x: cx, z: cz } = floor.center;
  const search = (test) => {
    if (test(cx, cz)) return new THREE.Vector3(cx, floor.y, cz);
    for (let ring = 1; ring <= SPOT_RINGS; ring++) {
      const r = ring * SPOT_RING_M / scale;
      const steps = ring * 8;
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const x = cx + Math.sin(t) * r, z = cz + Math.cos(t) * r;
        if (test(x, z)) return new THREE.Vector3(x, floor.y, z);
      }
    }
    return null;
  };
  return search(view) || search(free) || new THREE.Vector3(cx, floor.y, cz);
}

/**
 * Impostazioni stimate per un modello appena caricato (in coordinate sue,
 * non ancora in un contenitore trasformato).
 * @returns {{ scale: number, rotation: number, offset: number[] }}
 */
export function autoFit(object, format) {
  const scale = guessScale(object, format);
  const floor = findFloor(object);
  if (!floor) return { scale, rotation: 0, offset: [0, 0, 0] };
  const spot = freeSpot(object, floor, scale);
  return { scale, rotation: 0, offset: spot.multiplyScalar(-scale).toArray() };
}

/** Applica le impostazioni al contenitore della scena. */
export function applyFit(holder, settings) {
  holder.scale.setScalar(settings.scale);
  holder.rotation.set(0, settings.rotation * DEG, 0);
  holder.position.fromArray(settings.offset);
  holder.updateMatrixWorld(true);
}

/** Nuova scala; il punto sotto l'avatar resta sotto l'avatar. */
export function withScale(settings, scale) {
  const k = scale / settings.scale;
  return { ...settings, scale, offset: settings.offset.map(v => v * k) };
}

/** Nuova rotazione intorno all'avatar. */
export function withRotation(settings, rotation) {
  const delta = (rotation - settings.rotation) * DEG;
  const [x, y, z] = settings.offset;
  const cos = Math.cos(delta), sin = Math.sin(delta);
  return { ...settings, rotation: ((rotation % 360) + 360) % 360, offset: [x * cos + z * sin, y, -x * sin + z * cos] };
}

/** L'avatar va nel punto point (coordinate del mondo, sul pavimento cliccato). */
export function withSpot(settings, point) {
  const [x, y, z] = settings.offset;
  return { ...settings, offset: [x - point.x, y - point.y, z - point.z] };
}
