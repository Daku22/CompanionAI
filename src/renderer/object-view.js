// object-view.js — un oggetto della borsa disegnato in un canvas (Blocco 10c):
// la finestrella sul desktop (object.js) e l'anteprima del pannello (items.js).
//
// Camera ortografica un po' dall'alto e di tre quarti, con le stesse luci delle
// icone (scripts/food-icons.html): sul desktop l'oggetto somiglia alla sua card.
// L'inquadratura:
// - 'tight': il modello riempie il riquadro e poggia sul bordo basso (sta a
//   terra come la finestra, che per la fisica e' un cerchio inscritto);
// - 'sphere': la sfera che lo contiene, centrata. Per cio' che rotola (il
//   rotolamento gira il modello attorno all'asse della camera) e per
//   l'anteprima che ruota su se stessa.

import * as THREE from 'three';
import { readModel } from './model-read.js';

// Dal centro dell'oggetto verso la camera.
const VIEW = new THREE.Vector3(0.55, 0.5, 1.4).normalize();
const MARGIN = 1.06;
// Oltre questi vertici l'inquadratura usa gli spigoli della scatola.
const MAX_VERTICES = 200000;

/** Ogni vertice del modello in coordinate del mondo (o gli 8 spigoli, se sono troppi). */
function eachPoint(object, fn) {
  object.updateMatrixWorld(true);
  let count = 0;
  object.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) count += o.geometry.attributes.position.count; });
  const v = new THREE.Vector3();
  if (count > MAX_VERTICES || !count) {
    const box = new THREE.Box3().setFromObject(object);
    for (let i = 0; i < 8; i++) fn(v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    return;
  }
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

function dispose(object) {
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const value of Object.values(m)) if (value && value.isTexture) value.dispose();
      m.dispose();
    }
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number }} size in pixel CSS
 */
export function createObjectView(canvas, size) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(2, 3, 2);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  // roll gira attorno all'asse della camera (rotola), turn attorno al verticale (anteprima).
  const roll = new THREE.Group();
  const turn = new THREE.Group();
  roll.add(turn);
  scene.add(roll);
  let model = null;
  let dims = null;
  let seq = 0;
  let fitMode = 'tight';

  function resize(w, h) {
    size = { width: w, height: h };
    renderer.setSize(w, h, false);
  }
  resize(size.width, size.height);

  /** Inquadra il modello (gia' centrato nell'origine) secondo fit. */
  function frame(fit) {
    const aspect = size.width / Math.max(1, size.height);
    camera.position.copy(VIEW).multiplyScalar(10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    if (fit === 'sphere') {
      let r = 0;
      eachPoint(model, (p) => { r = Math.max(r, p.length()); });
      r = (r || 1) * MARGIN;
      camera.left = -r * Math.max(1, aspect); camera.right = r * Math.max(1, aspect);
      camera.top = r / Math.min(1, aspect); camera.bottom = -r / Math.min(1, aspect);
    } else {
      // Il riquadro del modello visto dalla camera: largo quanto serve,
      // centrato in orizzontale, poggiato in basso.
      const inv = camera.matrixWorldInverse;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      eachPoint(model, (p) => {
        p.applyMatrix4(inv);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
      const w = Math.max(maxX - minX, (maxY - minY) * aspect) * MARGIN;
      const h = w / aspect;
      const cx = (minX + maxX) / 2;
      camera.left = cx - w / 2; camera.right = cx + w / 2;
      camera.bottom = minY - (h - (maxY - minY)) * 0.04; camera.top = camera.bottom + h;
    }
    camera.near = 0.01; camera.far = 20 + 10;
    camera.updateProjectionMatrix();
  }

  return {
    /**
     * Carica un modello (url vrm:// o object://, format gltf/fbx/obj). Le
     * misure restano quelle del file: per un glTF, metri.
     * @returns {Promise<{ width: number, height: number, depth: number }>}
     */
    async load(def, { fit = 'tight' } = {}) {
      const mine = ++seq;
      const object = await readModel({ url: def.url, format: def.format || 'gltf', textures: def.textures || [], label: def.name || 'oggetto' });
      if (mine !== seq) { dispose(object); return dims; }
      if (model) { turn.remove(model); dispose(model); }
      const box = new THREE.Box3().setFromObject(object);
      const s = box.getSize(new THREE.Vector3());
      // Modelli enormi o minuscoli (in centimetri, in chilometri): la scala
      // la decide la finestra, qui basta che stiano nei limiti della camera.
      const big = Math.max(s.x, s.y, s.z) || 1;
      const k = 1 / big;
      object.scale.multiplyScalar(k);
      object.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-k);
      turn.add(object);
      model = object;
      dims = { width: s.x, height: s.y, depth: s.z };
      roll.quaternion.identity();
      turn.rotation.set(0, 0, 0);
      fitMode = fit;
      frame(fit);
      return dims;
    },
    /** Rotolamento, in radianti (positivo: verso destra). */
    setSpin(a) { roll.quaternion.setFromAxisAngle(VIEW, -a); },
    /** Giro su se stesso, per l'anteprima. */
    setTurn(a) { turn.rotation.y = a; },
    resize(w, h) { resize(w, h); if (model) frame(fitMode); },
    render() { renderer.render(scene, camera); },
    /** PNG quadrato di px lato, sfondo trasparente (la miniatura della card). */
    snapshot(px = 256) {
      const before = { ...size };
      const ratio = renderer.getPixelRatio();
      const q = roll.quaternion.clone();
      const yaw = turn.rotation.y;
      roll.quaternion.identity();
      turn.rotation.y = 0;
      renderer.setPixelRatio(1);
      resize(px, px);
      if (model) frame('tight');
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/png');
      renderer.setPixelRatio(ratio);
      resize(before.width, before.height);
      if (model) frame(fitMode);
      roll.quaternion.copy(q);
      turn.rotation.y = yaw;
      return url;
    },
    get dims() { return dims; },
    get ready() { return !!model; },
  };
}
