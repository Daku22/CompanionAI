// Texture dei modelli FBX.
//
// Un FBX cita le sue texture in tanti modi, e FBXLoader da solo ne trova solo
// una parte:
// - con un percorso del PC di chi l'ha esportato ("C:\Users\...\x.fbm\a.jpg"):
//   il loader tiene il solo nome del file e lo cerca accanto al modello, ma
//   l'import le copia dove stavano (Texture/, textures/, <nome>.fbm/). Qui un
//   LoadingManager ridirige ogni nome di file all'immagine importata giusta;
// - incorporate nel file: le estrae il loader, basta aspettarle;
// - in TGA: serve il TGALoader, i browser non le leggono;
// - senza nome di file (gli FBX convertiti da Sketchfab): il loader mette
//   texture vuote, che nello shader danno nero, e spesso il colore base e'
//   nero. Si tolgono i segnaposto e si ricollegano le immagini ai materiali
//   per nome ("Body_mt" -> "Shibahu_body_dif.png").
// Le immagini con trasparenza (capelli, ciglia) diventano ritagli: senza,
// le ciocche sarebbero rettangoli pieni.

import * as THREE from 'three';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';

// Parti del nome di un'immagine che non la rendono il colore del materiale.
const NOT_COLOR = new Set([
  'msk', 'mask', 'nrm', 'nor', 'normal', 'normals', 'rough', 'roughness', 'metal', 'metallic', 'metalness',
  'ao', 'occlusion', 'spec', 'specular', 'gloss', 'glossiness', 'emi', 'emission', 'emissive', 'height',
  'disp', 'displacement', 'bump', 'orm', 'rma', 'mra', 'sss', 'opacity', 'alpha',
]);
const MASK = new Set(['msk', 'mask', 'alpha', 'opacity']);

const tokens = (name) => String(name || '').toLowerCase().split(/[_\-. ]+/).filter(Boolean);
const baseName = (file) => String(file).split(/[\\/]/).pop();
const stem = (file) => baseName(file).replace(/\.[^.]+$/, '');

/** "Body_mt" -> ["body"]: il nome del materiale senza suffissi come _mt o _mat. */
export function materialTokens(name) {
  const key = String(name || '').toLowerCase().replace(/[_\-. ]*(mt|mat|mtl|material)\d*$/, '');
  const list = tokens(key);
  return list.join('').length >= 2 ? list : [];
}

const containsRun = (list, run) => {
  for (let i = 0; i + run.length <= list.length; i++) {
    if (run.every((t, j) => list[i + j] === t)) return true;
  }
  return false;
};

/**
 * Sceglie fra i nomi di file le immagini di un materiale: il colore (map) e,
 * se c'e' solo quella, una maschera da usare come trasparenza (alphaMap).
 * Le parole del nome del materiale devono comparire intere e in fila nel nome
 * del file, cosi' "hairA" non prende l'immagine di "hairB".
 */
export function pickTextures(materialName, fileNames) {
  const run = materialTokens(materialName);
  if (!run.length) return {};
  const found = fileNames.filter(file => containsRun(tokens(stem(file)), run));
  const parts = (file) => tokens(stem(file)).filter(t => !run.includes(t));
  const map = found.find(file => !parts(file).some(p => NOT_COLOR.has(p)));
  if (map) return { map };
  const mask = found.find(file => parts(file).some(p => MASK.has(p)));
  return mask ? { mask } : {};
}

/**
 * Indice nome di file -> URL importato. Minuscole, perche' un FBX fatto su
 * Windows puo' citare "Body.PNG" per un file "body.png".
 */
export function textureIndex(textureUrls) {
  const index = new Map();
  for (const url of textureUrls) {
    const key = decodeURIComponent(baseName(url)).toLowerCase();
    if (!index.has(key)) index.set(key, url);
  }
  return index;
}

/**
 * LoadingManager per un FBX importato: ridirige le texture alle immagini
 * copiate con il modello, legge le TGA e sa dire quando ha finito (idle()).
 */
export function createFbxManager(textureUrls = []) {
  const index = textureIndex(textureUrls);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob|data):/.test(url)) return url;
    let name;
    try { name = decodeURIComponent(baseName(url.split(/[?#]/)[0])).toLowerCase(); } catch (_) { return url; }
    return index.get(name) || url;
  });
  manager.addHandler(/\.tga$/i, new TGALoader(manager));

  // Le texture arrivano dopo il modello: la riparazione deve aspettarle,
  // altrimenti una texture ancora in caricamento sembra vuota.
  let active = 0;
  let waiters = [];
  const start = manager.itemStart.bind(manager);
  const end = manager.itemEnd.bind(manager);
  manager.itemStart = (url) => { active++; start(url); };
  manager.itemEnd = (url) => {
    active = Math.max(0, active - 1);
    end(url);
    if (!active) { const list = waiters; waiters = []; list.forEach(fn => fn()); }
  };
  manager.idle = (timeoutMs = 30000) => active ? new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(resolve, timeoutMs);
  }) : Promise.resolve();
  return manager;
}

const SLOTS = ['map', 'emissiveMap', 'specularMap', 'normalMap', 'bumpMap', 'alphaMap', 'aoMap', 'lightMap', 'displacementMap'];

const isBlack = (color) => color && color.r < 0.01 && color.g < 0.01 && color.b < 0.01;

// Un'immagine ha pixel trasparenti? Basta una copia piccola: le ciocche di
// capelli e le ciglia hanno ampie zone vuote.
const alphaCache = new WeakMap();
function hasAlpha(image) {
  if (!image || typeof document === 'undefined') return false;
  if (alphaCache.has(image)) return alphaCache.get(image);
  let result = false;
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (image instanceof ImageData) ctx.putImageData(image, 0, 0);
    else if (image.data && image.width) {
      // TGA: dati grezzi RGBA, non un'immagine disegnabile.
      const data = image.data;
      for (let i = 3; i < data.length; i += 4 * 64) if (data[i] < 250) { result = true; break; }
      alphaCache.set(image, result);
      return result;
    } else ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { result = true; break; }
  } catch (_) { result = false; }
  alphaCache.set(image, result);
  return result;
}

/**
 * Ripara i materiali di un FBX caricato, a texture arrivate. textureUrls sono
 * gli URL avatar:// delle immagini importate col modello.
 */
export function repairFbxTextures(object, textureUrls = []) {
  const loader = new THREE.TextureLoader();
  const cache = new Map();
  const load = (url, srgb) => {
    if (!cache.has(url)) {
      const texture = url.toLowerCase().endsWith('.tga') ? new TGALoader().load(url) : loader.load(url);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
      cache.set(url, texture);
    }
    return cache.get(url);
  };
  // Il confronto avviene sul percorso decodificato, l'URL resta com'e'.
  const names = textureUrls.map(url => decodeURIComponent(url));
  const urlOf = (name) => textureUrls[names.indexOf(name)];

  const seen = new Set();
  object.traverse((o) => {
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      if (seen.has(m)) continue;
      seen.add(m);
      let changed = false;
      // Texture senza immagine: segnaposto del loader o file non trovato.
      for (const slot of SLOTS) {
        if (m[slot] && m[slot].isTexture && !m[slot].image) { m[slot] = null; changed = true; }
      }
      if (!m.map) {
        const picked = pickTextures(m.name, names);
        if (picked.map) {
          m.map = load(urlOf(picked.map), true);
          if (m.color) m.color.set(0xffffff);
          if (m.emissive) m.emissive.set(0x000000);
          changed = true;
        } else if (picked.mask && !m.alphaMap) {
          m.alphaMap = load(urlOf(picked.mask), false);
          m.transparent = true;
          m.depthWrite = false;
          changed = true;
        }
      } else {
        // Una texture moltiplicata per il nero resta nera: e' un difetto
        // d'esportazione, non una scelta.
        if (isBlack(m.color)) { m.color.set(0xffffff); changed = true; }
        if (!m.transparent && !m.alphaTest && hasAlpha(m.map.image)) {
          m.alphaTest = 0.5;
          m.side = THREE.DoubleSide;
          changed = true;
        }
      }
      if (changed) m.needsUpdate = true;
    }
  });
}
