import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMHumanoid } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import {
  createVRMAnimator, baseYaw, isVRM0, createBlinker, createGaze, moodExpressions, MOOD_EXPRESSIONS, GENERATED,
} from './vrm-animation.js';
import { createClipLayer, applyLook, isLoopSlot } from './clip-layer.js';
import { prepareHumanoid, retargetClip, writeVRMA } from './motion-retarget.js';
import { kimodoClip } from './kimodo-raw.js';


window.__threeVisible = false;
const threeMount = document.getElementById('three-mount');

// Il renderer 3D nasce alla prima scelta di un avatar VRM. Prima veniva creato
// comunque all'avvio: in modalita' 2D, quella predefinita, la pagina teneva
// aperto un secondo contesto WebGL e un loop che girava a vuoto a ogni frame.
let renderer = null;
let scene = null;
let camera = null;
let loader = null;
// Il modello sta dentro due gruppi: rig ha il perno all'altezza della testa,
// cosi' l'oscillazione in braccio lo fa penzolare invece di ribaltarlo sui
// piedi; body lo riporta a terra e lo solleva un poco mentre e' in mano.
let rig = null;
let body = null;
const PIVOT_Y = 1.45;
const DRAG_LIFT = 0.06;

function ensureThree() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  threeMount.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0.95, 2.7);
  camera.lookAt(0, 0.85, 0);

  // Camera fissa. Prima il mouse la ruotava (OrbitControls) e per spostare la
  // finestra serviva una maniglia: ora il mouse prende l'avatar, come in Mate
  // Engine (companion-input.js).
  rig = new THREE.Group();
  rig.position.y = PIVOT_Y;
  body = new THREE.Group();
  body.position.y = -PIVOT_Y;
  rig.add(body);
  scene.add(rig);

  // Environment & Lighting
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
}

function onWindowResize() {
  if (!renderer) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener('resize', onWindowResize);

let currentVrm = null;
let currentGltf = null;
const clock = new THREE.Clock();

// ─── Livello di animazione VRM ─────────────────────────────────────────────
// La logica vive in vrm-animation.js: dentro questo HTML non sarebbe
// verificabile, e il player va tenuto separato dai numeri delle pose.
const animator = createVRMAnimator();
// Le clip .vrma (clip-layer.js) si sovrappongono alle pose procedurali: il
// player sa quanto dura la clip vera, e torna a idle quando finisce lei.
const clips = createClipLayer();
const playClip = (name) => animator.play(name, { duration: clips.prepare(animator.resolve(name)) });
const applyVRMIdlePose = (vrm) => animator.reset(vrm);
const setFacing = (dir) => animator.setFacing(dir);

function updateAnimation(vrm, delta) {
  const info = animator.update(vrm, delta, { applyLook: false });
  clips.update(delta, info.clip);
  // Lo sguardo va sopra la posa finale, clip compresa.
  applyLook(vrm, info.lookParts, isVRM0(vrm) ? 1 : -1);
}

// ─── Volto: ciglia, sguardo, umore e reazioni ──────────────────────────────
// Ogni frame il peso di un'espressione e' il massimo fra quello dell'umore
// (basso, di fondo) e quello di una reazione in corso. Prima le reazioni
// tornavano a 0 dopo tre secondi, cancellando qualunque stato di fondo.
const blinker = createBlinker();
const gaze = createGaze();
let gazeTarget = null;
let moodWeights = moodExpressions(null);
const reaction = {};
const reactionTimers = {};

function react(name, weight, ms = 3000) {
  reaction[name] = weight;
  clearTimeout(reactionTimers[name]);
  reactionTimers[name] = setTimeout(() => { reaction[name] = 0; }, ms);
}

function clearReactions() {
  for (const name of Object.keys(reaction)) { reaction[name] = 0; clearTimeout(reactionTimers[name]); }
}

function updateFace(vrm, delta, lookTarget) {
  const em = vrm.expressionManager;
  if (em) {
    for (const name of MOOD_EXPRESSIONS) em.setValue(name, Math.max(moodWeights[name] || 0, reaction[name] || 0));
    em.setValue('blink', blinker.update(delta));
  }
  if (vrm.lookAt && gazeTarget) {
    const offset = gaze.update(delta);
    // Con il mouse da seguire gli occhi guardano il cursore, altrimenti la camera.
    const target = lookTarget || camera.position;
    const jitter = lookTarget ? 0.3 : 1;
    gazeTarget.position.set(target.x + offset.x * jitter, target.y + offset.y * jitter, target.z);
    gazeTarget.updateMatrixWorld();
  }
}

if (api && api.onMoodChanged) api.onMoodChanged((mood) => { moodWeights = moodExpressions(mood); });

// ─── Mouse: sguardo, presa in braccio, pixel sotto il cursore ─────────────
const sway = window.CompanionSway.createSway();
let dragging = false;
let dragVel = { vx: 0, vy: 0 };
let windActive = false;
let cursorPos = null;
const LOOK_PLANE_M = 1.0;       // distanza davanti alla testa del piano del cursore
const WIND_PER_PX = 0.0006;     // forza sulle spring bone per px/s della finestra
const WIND_MAX = 1.5;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const lookPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const lookPoint = new THREE.Vector3();
const headPos = new THREE.Vector3();
const windForce = new THREE.Vector3();

function handleCursor(c) { cursorPos = c; }
if (api && api.onCursor) api.onCursor((c) => { if (!window.__companionTest) handleCursor(c); });
if (api && api.onDragMotion) api.onDragMotion((v) => { if (v) dragVel = { vx: +v.vx || 0, vy: +v.vy || 0 }; });
// Per audit.mjs: simula il cursore senza muovere quello vero (con
// window.__companionTest = true il cursore vero viene ignorato).
window.__companion3DTest = {
  cursor: handleCursor,
  animator: () => animator.debug(),
  clips: () => clips.debug(),
  humanoid: () => !!(currentVrm && currentVrm.humanoid),
  /** Altezza del bacino nel mondo, sulle ossa vere. */
  hipsY: () => {
    const hips = currentVrm && currentVrm.humanoid && currentVrm.humanoid.getRawBoneNode('hips');
    return hips ? hips.getWorldPosition(new THREE.Vector3()).y : null;
  },
  /** Riproduce un movimento generato come se arrivasse dal main. */
  generated: (data) => playGeneratedMotion(data),
  /** Converte in .vrma come l'import dal menu, senza la finestra di scelta. */
  convert: async (ext, data) => convertToVRMA(ext, data),
  /** Direzione nel mondo da un osso all'altro, sulle ossa vere del modello. */
  boneDir: (from, to) => {
    const h = currentVrm && currentVrm.humanoid;
    const a = h && h.getRawBoneNode(from);
    const b = h && h.getRawBoneNode(to);
    if (!a || !b) return null;
    return b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize().toArray();
  },
};

if (api && api.onWindowDragState) {
  api.onWindowDragState(({ dragging: on }) => {
    if (!window.__threeVisible) return;
    dragging = !!on;
    sway.reset();
    playClip(dragging ? 'drag' : 'idle');
    if (dragging) react('surprised', 0.6, 1200);
  });
}

// Un clic sull'avatar: sorride.
window.addEventListener('companion-poke', () => {
  if (!window.__threeVisible || dragging || !currentVrm) return;
  react('happy', 1.0, 1500);
});

/** Dove guarda: angoli dalla testa al punto del cursore, e bersaglio degli occhi. */
function updateLook(vrm) {
  const follow = !!(cursorPos && cursorPos.follow) && !dragging;
  animator.setLookEnabled(follow);
  if (!follow || !vrm.humanoid) return null;
  const head = vrm.humanoid.getRawBoneNode('head');
  if (!head) return null;
  head.getWorldPosition(headPos);
  ndc.set((cursorPos.x / window.innerWidth) * 2 - 1, -(cursorPos.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  lookPlane.constant = -(headPos.z + LOOK_PLANE_M);
  if (!raycaster.ray.intersectPlane(lookPlane, lookPoint)) return null;
  const dx = lookPoint.x - headPos.x;
  const dy = lookPoint.y - headPos.y;
  const dz = lookPoint.z - headPos.z;
  animator.setLook(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
  return lookPoint;
}

// Capelli e vestiti: la finestra si muove ma la scena no, quindi le spring
// bone non vedrebbero niente. Si aggiunge alla gravita' di ogni giunto una
// forza contraria al movimento, come fa Mate Engine (AvatarGravityController).
function updateWind(vrm) {
  const sbm = vrm.springBoneManager;
  if (!sbm) return;
  const moving = dragging && (dragVel.vx !== 0 || dragVel.vy !== 0);
  if (!moving && !windActive) return;
  windActive = moving;
  for (const joint of sbm.joints) {
    const st = joint.settings;
    if (!joint.userData) joint.userData = {};
    if (!joint.userData.baseGravity) {
      joint.userData.baseGravity = { dir: st.gravityDir.clone(), power: st.gravityPower };
    }
    const base = joint.userData.baseGravity;
    windForce.copy(base.dir).multiplyScalar(base.power);
    if (moving) windForce.add(new THREE.Vector3(-dragVel.vx * WIND_PER_PX, dragVel.vy * WIND_PER_PX, 0).clampLength(0, WIND_MAX));
    const len = windForce.length();
    st.gravityPower = len;
    if (len > 1e-6) st.gravityDir.copy(windForce).divideScalar(len);
    else st.gravityDir.copy(base.dir);
  }
}

// Pixel sotto il cursore: il 3D lo sa solo dopo aver disegnato, quindi la
// domanda resta in sospeso fino al frame successivo (vedi animate).
let hitQuery = null;
const hitPixel = new Uint8Array(4);
function probe3D(x, y) { hitQuery = { x, y }; return null; }

function readHit() {
  if (!hitQuery) return;
  const q = hitQuery;
  hitQuery = null;
  const gl = renderer.getContext();
  const ratio = renderer.getPixelRatio();
  const px = Math.floor(q.x * ratio);
  const py = Math.floor((window.innerHeight - q.y) * ratio);
  if (px < 0 || py < 0 || px >= gl.drawingBufferWidth || py >= gl.drawingBufferHeight) {
    window.CompanionInput.setOverModel(false);
    return;
  }
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, hitPixel);
  window.CompanionInput.setOverModel(hitPixel[3] > 20);
}
if (api && api.getMood) api.getMood().then((mood) => { moodWeights = moodExpressions(mood); }).catch(() => {});

// Il loop gira solo con il 3D visibile: tornando al 2D si ferma del tutto,
// invece di continuare a chiedere un frame al browser per poi non disegnarlo.
let looping = false;

function animate() {
  if (!window.__threeVisible) { looping = false; return; }
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  // Oscillazione in braccio, con il perno alla testa (rig), e sollevamento.
  const { side, forward } = sway.update(delta, dragging ? dragVel.vx : 0, dragging ? dragVel.vy : 0);
  rig.rotation.z = -side;
  rig.rotation.x = forward;
  const lift = dragging ? DRAG_LIFT : 0;
  body.position.y += (-PIVOT_Y + lift - body.position.y) * Math.min(1, delta * 10);

  if (currentVrm) {
    const lookTarget = updateLook(currentVrm);
    updateAnimation(currentVrm, delta);
    updateFace(currentVrm, delta, lookTarget);
    updateWind(currentVrm);
    currentVrm.update(delta);
    frameSeated(currentVrm, delta);
  }
  renderer.render(scene, camera);
  readHit();
}

// Seduto a terra le gambe vengono verso la camera e uscivano dal fondo della
// finestra: la camera abbassa lo sguardo in proporzione a quanto e' sceso il
// bacino, e lo rialza quando l'avatar si rimette in piedi.
const CAMERA_LOOK_Y = 0.85;
const SEATED_LOOK_DROP = 0.3;
let seated = 0;
function frameSeated(vrm, delta) {
  const hips = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
  const rest = hips && hips.userData.__baseY;
  const target = rest > 0 ? Math.max(0, Math.min(1, 1 - hips.position.y / rest)) : 0;
  seated += (target - seated) * Math.min(1, delta * 3);
  camera.lookAt(0, CAMERA_LOOK_Y - SEATED_LOOK_DROP * seated, 0);
}

function startLoop() {
  if (looping) return;
  looping = true;
  clock.getDelta(); // scarta il tempo passato in 2D, o la prima clip salterebbe avanti
  requestAnimationFrame(animate);
}

// Ogni caricamento ha un numero: cambiando avatar prima che il precedente
// abbia finito, il modello vecchio arrivava dopo e restava in scena accanto
// al nuovo, senza essere mai liberato.
let loadSeq = 0;

// Altezza della testa per i modelli senza VRM: quella di un VRM tipico, cosi'
// la camera li inquadra allo stesso modo.
const HEAD_HEIGHT_M = 1.42;

/**
 * Un glTF o FBX con scheletro umano diventa un "VRM" minimo: stesso umanoide
 * normalizzato, quindi stesse pose, clip, sguardo e oscillazione. null se lo
 * scheletro non e' umano.
 */
function humanoidFromObject(object) {
  const root = new THREE.Group();
  root.add(object);
  let nodes;
  try { nodes = prepareHumanoid(root); } catch (error) {
    console.warn('Modello senza scheletro umano:', error.message);
    return null;
  }
  const head = nodes.head.getWorldPosition(new THREE.Vector3()).y;
  if (head > 0.01) root.scale.multiplyScalar(HEAD_HEIGHT_M / head);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (Number.isFinite(box.min.y)) root.position.y -= box.min.y;
  const hips = nodes.hips.getWorldPosition(new THREE.Vector3());
  root.position.x -= hips.x;
  root.position.z -= hips.z;
  root.updateMatrixWorld(true);
  const humanoid = new VRMHumanoid(/** @type {any} */ (Object.fromEntries(Object.entries(nodes).map(([k, node]) => [k, { node }]))));
  root.add(humanoid.normalizedHumanBonesRoot);
  return {
    scene: root, humanoid, meta: { metaVersion: '1' },
    expressionManager: null, lookAt: null, springBoneManager: null,
    update() { humanoid.update(); },
  };
}

/** Legge il file del modello: { vrm } per un VRM, { object } per il resto. */
async function readModel(avatar) {
  if (avatar.kind === 'fbx') return { vrm: null, object: await new FBXLoader().loadAsync(avatar.url) };
  const gltf = await loader.loadAsync(avatar.url);
  return { vrm: gltf.userData.vrm || null, object: gltf.scene };
}

/** Carica un avatar 3D: VRM, glTF o FBX. Senza scheletro umano resta statico. */
async function loadVRMModel(avatar) {
  console.log("Caricamento modello 3D:", avatar.name);
  ensureThree();
  const seq = ++loadSeq;
  if (currentVrm) {
    body.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = null;
  }
  if (currentGltf) { body.remove(currentGltf); VRMUtils.deepDispose(currentGltf); currentGltf = null; }
  clips.attach(null);
  windActive = false;
  sway.reset();

  let model;
  try { model = await readModel(avatar); } catch (err) {
    console.error("Errore nel caricamento del modello 3D:", err);
    if (seq === loadSeq) showBubble('Modello 3D non caricato', 3000);
    return;
  }
  if (seq !== loadSeq) { VRMUtils.deepDispose(model.vrm ? model.vrm.scene : model.object); return; }

  let vrm = model.vrm;
  if (vrm) {
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    // combineSkeletons sostituisce removeUnnecessaryJoints, deprecato in three-vrm 3.
    VRMUtils.combineSkeletons(vrm.scene);
  } else {
    vrm = humanoidFromObject(model.object);
    if (!vrm) {
      // Nessuno scheletro umano: anteprima statica, mai animazioni finte.
      currentGltf = model.object;
      body.add(currentGltf);
      showBubble('Modello statico: nessuno scheletro umano da animare', 3600);
      return;
    }
  }

  // I VRM 0.x guardano verso -Z, i 1.0 (e i modelli ricostruiti) gia' verso
  // la fotocamera: baseYaw sceglie in base alla versione. updateAnimation la
  // riapplica a ogni frame, insieme all'orientamento verso la direzione di marcia.
  vrm.scene.rotation.y = baseYaw(vrm);

  // La Y del bacino e' la base dei sobbalzi di camminata e corsa: va letta
  // una volta sola, prima che una clip la modifichi.
  const hipsNode = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
  if (hipsNode) hipsNode.userData.__baseY = hipsNode.position.y;

  // Posa iniziale a riposo: reset() riporta anche il player a idle,
  // altrimenti il modello nuovo erediterebbe la clip di quello vecchio.
  applyVRMIdlePose(vrm);

  // Lo sguardo segue la fotocamera, con i piccoli salti di createGaze.
  if (!gazeTarget) gazeTarget = new THREE.Object3D();
  if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
  clearReactions();

  currentVrm = vrm;
  clips.attach(vrm);
  body.add(vrm.scene);
}

// ─── Animazioni .vrma ──────────────────────────────────────────────────────
// Le clip integrate e quelle importate, caricate una volta e date al livello
// delle clip. Il nome del file dice il gesto (AnimationLibrary.js nel main).

const vrmaLoader = new GLTFLoader();
vrmaLoader.register(parser => new VRMAnimationLoaderPlugin(parser));

async function loadAnimationLibrary() {
  if (!api || !api.listAnimations) return;
  const list = await api.listAnimations();
  const library = new Map();
  for (const item of list) {
    try {
      const gltf = await vrmaLoader.loadAsync(item.url);
      const animation = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
      if (!animation) throw new Error('nessuna animazione VRMA nel file');
      if (!library.has(item.slot)) library.set(item.slot, []);
      library.get(item.slot).push({ name: item.name, animation, phase: item.phase || 'loop' });
    } catch (error) {
      console.warn('Animazione ' + item.name + ' scartata:', error.message);
    }
  }
  clips.setLibrary(library);
}
loadAnimationLibrary().catch(e => console.warn('Animazioni non caricate:', e.message));

// Etichette dei gesti, nell'ordine in cui si propongono all'import.
const SLOT_LABELS = {
  idle: 'A riposo', wave: 'Saluto', happy: 'Contento', think: 'Pensa', sit: 'Seduto a terra',
  'sit-edge': 'Seduto sul bordo', dangle: 'In braccio', stretch: 'Si stiracchia', yawn: 'Sbadiglio',
  doze: 'Sonnecchia', dance: 'Balla', 'walk-to': 'Camminata', 'run-to': 'Corsa', search: 'Cerca',
  smoke: 'Fuma', click: 'Clic',
};
const SLOT_HINTS = [
  [/(ledge|edge|bordo|dangling legs)/, 'sit-edge'], [/(stretch|stiracch)/, 'stretch'],
  [/(yawn|sbadigl)/, 'yawn'], [/(doze|sleep|nap|dorm|sonn)/, 'doze'], [/(danc|ball)/, 'dance'],
  [/(wave|hello|greet|salut|ciao)/, 'wave'], [/(think|pens|ponder)/, 'think'],
  [/(walk|cammin)/, 'walk-to'], [/(run|jog|corr)/, 'run-to'], [/(sit|seat|sedu|sied)/, 'sit'],
  [/(hang|dangl|drag|carr|brac)/, 'dangle'], [/(happy|cheer|joy|clap|content)/, 'happy'],
  [/(search|look|cerc)/, 'search'], [/(smok|fum)/, 'smoke'], [/(click|type|typing)/, 'click'],
];
const guessSlot = (name) => (SLOT_HINTS.find(([re]) => re.test(name.toLowerCase())) || [null, 'idle'])[1];
// Fase di una clip per uno slot ciclico (seduto, a riposo, camminata).
const PHASE_LABELS = { loop: 'Ciclo (si ripete)', enter: 'Entrata (poi resta)', exit: 'Uscita' };
const guessPhase = (name) => {
  const n = name.toLowerCase();
  if (/(sit(ting)?[ _-]?down|enter|start|begin|siede|sedersi|entrata)/.test(n)) return 'enter';
  if (/(stand(ing)?[ _-]?up|get[ _-]?up|exit|end|rialz|alza|uscita)/.test(n)) return 'exit';
  return 'loop';
};

// Pixel trasparente al posto delle texture: una clip FBX le cita, ma per
// convertirla servono solo le ossa, e senza questo il loader le cercherebbe.
const NO_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Converte una clip glTF, FBX o BVH in .vrma. */
async function convertToVRMA(ext, data) {
  const root = new THREE.Group();
  let clip;
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    root.add(gltf.scene);
    clip = gltf.animations[0];
  } else if (ext === 'fbx') {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(() => NO_TEXTURE);
    const object = new FBXLoader(manager).parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
    root.add(object);
    clip = object.animations[0];
  } else if (ext === 'bvh') {
    const result = new BVHLoader().parse(new TextDecoder().decode(data));
    root.add(result.skeleton.bones[0]);
    clip = result.clip;
  }
  if (!clip) throw new Error('il file non contiene animazioni');
  return new Uint8Array(writeVRMA(retargetClip(root, clip)));
}

/** Una scelta nel menu della finestra: labels id -> testo, il suggerito in cima. */
function chooseFrom(question, labels, suggested) {
  const order = [suggested, ...Object.keys(labels).filter(k => k !== suggested)];
  return new Promise(resolve => {
    const menu = document.getElementById('model-menu');
    const host = document.getElementById('avatar-list');
    const title = document.createElement('div');
    title.className = 'menu-item menu-note';
    title.textContent = question;
    const items = order.map(id => {
      const item = document.createElement('div');
      item.className = 'menu-item' + (id === suggested ? ' active' : '');
      item.textContent = labels[id];
      item.addEventListener('click', () => resolve(id));
      return item;
    });
    const cancel = document.createElement('div');
    cancel.className = 'menu-item menu-note';
    cancel.textContent = 'Annulla';
    cancel.addEventListener('click', () => resolve(null));
    setMenuFooter(false, false);
    host.replaceChildren(title, ...items, cancel);
    menu.style.display = 'block';
    document.body.classList.add('menu-open');
  });
}

async function importAnimation() {
  let picked;
  try {
    picked = await api.pickAnimation();
    if (!picked || picked.canceled) return;
    const data = picked.data instanceof Uint8Array ? picked.data : new Uint8Array(picked.data);
    if (picked.ext !== 'vrma') showBubble('Converto l\'animazione…', 8000);
    const vrma = picked.ext === 'vrma' ? data : await convertToVRMA(picked.ext, data);
    // Prima di salvarla la si rilegge: un file che il player non capisce non
    // deve finire nella cartella.
    const check = await vrmaLoader.parseAsync(vrma.buffer.slice(vrma.byteOffset, vrma.byteOffset + vrma.byteLength), '');
    if (!check.userData.vrmAnimations || !check.userData.vrmAnimations[0]) throw new Error('nessuna animazione VRMA nel file');
    const slot = await chooseFrom('Usala per:', SLOT_LABELS, guessSlot(picked.name));
    // Solo gli slot che durano finche' non arriva altro hanno entrata e uscita.
    const phase = slot && isLoopSlot(slot) ? await chooseFrom('Che parte è?', PHASE_LABELS, guessPhase(picked.name)) : 'loop';
    renderAvatarMenu(await api.listAvatars());
    closeMenu();
    if (!slot || !phase) return;
    await api.saveAnimation({ slot, name: picked.name, data: vrma, phase });
    await loadAnimationLibrary();
    showBubble('Animazione aggiunta: ' + SLOT_LABELS[slot] + (phase === 'loop' ? '' : ' (' + PHASE_LABELS[phase].split(' ')[0].toLowerCase() + ')'), 3000);
    if (window.__threeVisible && currentVrm) playClip(slot);
  } catch (error) {
    console.error('Importazione animazione fallita:', error);
    showBubble('Animazione non importata: ' + error.message, 4500);
  }
}

/** Manifest del pacchetto 2D da mostrare, con la cartella dei suoi PNG. */
async function spriteSource(avatar) {
  // Il 2D integrato arriva gia' caricato da sprites.js; i pacchetti privati e
  // importati si leggono dal loro URL (vrm://private/ o avatar://).
  if (avatar.builtin && !avatar.url) return { manifest: window.COMPANION_SPRITES, baseUrl: './assets/strips/' };
  const baseUrl = avatar.url.slice(0, avatar.url.lastIndexOf('/') + 1);
  if (avatar.kind === 'sprite') {
    // Un'immagine singola: un pacchetto con la sola idle, a immagine intera.
    return { manifest: { animations: { idle: { file: avatar.url.slice(baseUrl.length), fps: 0 } } }, baseUrl };
  }
  const res = await fetch(avatar.url);
  if (!res.ok) throw new Error('pacchetto non leggibile (' + res.status + ')');
  return { manifest: await res.json(), baseUrl };
}

function show2D() {
  const pixi = document.getElementById('pixi-mount');
  const three = document.getElementById('three-mount');
  window.__threeVisible = false;
  window.CompanionInput.setProbe(window.hitTest2D);
  document.body.classList.remove('mode-3d');
  if (window.app) window.app.ticker.start();
  pixi.style.display = 'block';
  three.style.display = 'none';
  three.style.pointerEvents = 'none';
  if (renderer) renderer.domElement.style.pointerEvents = 'none';
}

function show3D() {
  const pixi = document.getElementById('pixi-mount');
  const three = document.getElementById('three-mount');
  window.unload2DAvatar();
  window.CompanionInput.setProbe(probe3D);
  ensureThree();
  window.__threeVisible = true;
  document.body.classList.add('mode-3d');
  if (window.app) window.app.ticker.stop();
  onWindowResize();
  startLoop();
  pixi.style.display = 'none';
  three.style.display = 'block';
  // Il mouse lo riceve #drag-zone, sopra il canvas, come nel 2D.
  three.style.pointerEvents = 'none';
  renderer.domElement.style.pointerEvents = 'none';
}

let currentAvatarId = null;

/**
 * Mostra un avatar dell'elenco. save=false al ripristino dell'avvio: salvare
 * solo le scelte dell'utente evita di sovrascrivere la configurazione con il
 * ripiego usato quando l'avatar salvato non esiste piu'.
 */
async function switchModel(avatarId, { save = true } = {}) {
  closeMenu();
  const avatars = await api.listAvatars();
  const avatar = avatars.find(a => a.id === avatarId);
  if (!avatar) { showBubble('Avatar non trovato', 3000); return; }
  currentAvatarId = avatar.id;
  if (save) api.setConfig({ avatarModel: avatar.id }).catch(() => {});
  renderAvatarMenu(avatars);

  if (avatar.kind === 'sprite-pack' || avatar.kind === 'sprite') {
    show2D();
    try {
      const { manifest, baseUrl } = await spriteSource(avatar);
      await window.load2DAvatar(manifest, baseUrl);
    } catch (error) {
      console.error('Avatar 2D non caricato:', error);
      window.show2DPlaceholder();
      showBubble('Avatar 2D non caricato: ' + error.message, 4000);
    }
  } else {
    show3D();
    loadVRMModel(avatar);
  }
}

// Integrazione espressioni con eventi IPC dall'AI (unificata type+animation)
if (api && api.onTriggerAnimation) {
  api.onTriggerAnimation((action) => {
    if (!window.__threeVisible) return;
    const key = (action && (action.animation || action.type)) || 'idle';
    // Il corpo si muove sempre; le espressioni le applica updateFace, se il
    // modello le espone.
    playClip(key);
    // I gesti a riposo portano il proprio fumetto; in 3D gli altri non ne hanno.
    if (action && typeof action.bubble === 'string' && action.bubble) showBubble(action.bubble, 3000);
    if (key === 'wave' || key === 'happy') react('happy', 1.0);
    else if (key === 'click') react('happy', 0.7);
    else if (key === 'think' || key === 'search' || key === 'scroll' || key === 'relaxed') react('relaxed', 1.0);
    else if (key === 'idle' || key === 'none') clearReactions();
  });
}

// ─── Movimenti generati da Kimodo ──────────────────────────────────────────
// Il main manda l'uscita grezza di Kimodo (o l'URL della cache, se la frase
// e' gia' stata generata). Qui si converte in .vrma come un import, si
// riproduce una volta e il file torna al main per la cache.

/** Uscita grezza di Kimodo -> .vrma. */
function generatedToVRMA(data) {
  const { root, clip } = kimodoClip(new Float32Array(data.rootPositions), new Float32Array(data.rotations), { name: String(data.prompt || '').slice(0, 60) });
  return new Uint8Array(writeVRMA(retargetClip(root, clip)));
}

async function playGeneratedMotion(data) {
  if (!data || typeof data.key !== 'string') return;
  let gltf;
  if (typeof data.url === 'string') {
    gltf = await vrmaLoader.loadAsync(data.url);
  } else {
    const vrma = generatedToVRMA(data);
    gltf = await vrmaLoader.parseAsync(vrma.buffer.slice(vrma.byteOffset, vrma.byteOffset + vrma.byteLength), '');
    if (api.storeGeneratedMotion) api.storeGeneratedMotion({ key: data.key, data: vrma }).catch(e => console.warn('Movimento non salvato:', e.message));
  }
  const animation = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
  if (!animation) throw new Error('nessuna animazione VRMA');
  if (!data.play || !window.__threeVisible || !currentVrm) return;
  clips.setGenerated({ name: data.key, animation, phase: 'loop' });
  animator.play(GENERATED, { duration: clips.prepare(GENERATED), restart: true });
  clearReactions();
}

if (api && api.onGeneratedMotion) {
  api.onGeneratedMotion((data) => {
    playGeneratedMotion(data).catch((error) => {
      console.error('Movimento generato non riprodotto:', error);
      showBubble('Questo movimento non mi riesce…', 3000);
    });
  });
}

// Il main sceglie la meta' della camminata conoscendo l'area di lavoro reale,
// e comunica qui il verso: l'avatar si gira invece di scivolare di lato.
if (api && api.onCompanionFacing) {
  api.onCompanionFacing((data) => {
    const dir = data && data.dir;
    if (dir === 1 || dir === -1) setFacing(dir);
  });
}

// Menu degli avatar: generato dall'elenco del main, cosi' un modello tolto dal
// pacchetto sparisce dal menu invece di lasciare un pulsante che non carica.
function renderAvatarMenu(avatars) {
  managing = false;
  setMenuFooter(true, avatars.some(a => !a.builtin));
  const host = document.getElementById('avatar-list');
  host.replaceChildren(...avatars.map(avatar => {
    const item = document.createElement('div');
    item.className = 'menu-item' + (avatar.id === currentAvatarId ? ' active' : '');
    item.textContent = avatar.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = (avatar.kind === 'sprite-pack' || avatar.kind === 'sprite') ? '2D' : '3D';
    item.appendChild(kind);
    item.addEventListener('click', () => switchModel(avatar.id));
    return item;
  }));
}

// Le voci fisse in fondo al menu: nascoste mentre si scelgono gli avatar da
// eliminare, e "Elimina" solo se c'e' almeno un avatar importato.
function setMenuFooter(visible, canManage) {
  document.getElementById('btn-import-avatar').style.display = visible ? '' : 'none';
  document.getElementById('btn-manage-avatars').style.display = visible && canManage ? '' : 'none';
}

// Eliminazione degli avatar importati: si spuntano nel menu e si conferma con
// "Elimina". Gli integrati non compaiono, e il main li rifiuterebbe comunque.
let managing = false;

function renderManageMenu(avatars) {
  managing = true;
  setMenuFooter(false, false);
  const host = document.getElementById('avatar-list');
  const imported = avatars.filter(a => !a.builtin);
  const selected = new Set();
  const title = document.createElement('div');
  title.className = 'menu-item menu-note';
  title.textContent = 'Seleziona da eliminare:';
  const removeBtn = document.createElement('div');
  removeBtn.className = 'menu-item danger disabled';
  const refresh = () => {
    removeBtn.textContent = 'Elimina (' + selected.size + ')';
    removeBtn.classList.toggle('disabled', selected.size === 0);
  };
  const items = imported.map(avatar => {
    const item = document.createElement('label');
    item.className = 'menu-item check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      if (box.checked) selected.add(avatar.id); else selected.delete(avatar.id);
      refresh();
    });
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = (avatar.kind === 'sprite-pack' || avatar.kind === 'sprite') ? '2D' : '3D';
    item.append(box, avatar.name, kind);
    return item;
  });
  removeBtn.addEventListener('click', async () => {
    // Un doppio clic non deve mandare due richieste.
    if (!selected.size || removeBtn.classList.contains('disabled')) return;
    removeBtn.classList.add('disabled');
    try {
      const removed = await api.removeAvatars([...selected]);
      const remaining = await api.listAvatars();
      showBubble(removed.length === 1 ? 'Avatar eliminato' : removed.length + ' avatar eliminati', 2400);
      if (removed.includes(currentAvatarId)) {
        // Quello in scena non esiste piu': si torna al predefinito.
        const pick = remaining.find(a => a.default) || remaining[0];
        if (pick) await switchModel(pick.id);
        else { currentAvatarId = null; renderAvatarMenu(remaining); window.show2DPlaceholder(); }
      } else {
        renderAvatarMenu(remaining);
      }
    } catch (error) { showBubble('Eliminazione fallita: ' + error.message, 3600); refresh(); }
  });
  const cancel = document.createElement('div');
  cancel.className = 'menu-item menu-note';
  cancel.textContent = 'Annulla';
  cancel.addEventListener('click', async () => renderAvatarMenu(await api.listAvatars()));
  refresh();
  host.replaceChildren(title, ...items, removeBtn, cancel);
}

document.getElementById('btn-manage-avatars').addEventListener('click', async () => {
  renderManageMenu(await api.listAvatars());
});

// Chiudere il menu a meta' selezione non deve riaprirlo li': alla riapertura
// torna l'elenco normale.
document.getElementById('switch-zone').addEventListener('click', async () => {
  if (managing) renderAvatarMenu(await api.listAvatars());
});

// Scelta fra piu' modelli trovati nella stessa cartella. Dentro il menu:
// window.prompt() in Electron non esiste, e con la vecchia finestra di scelta
// l'importazione di una cartella con piu' modelli non andava mai avanti.
function chooseCandidate(choices) {
  return new Promise(resolve => {
    const menu = document.getElementById('model-menu');
    const host = document.getElementById('avatar-list');
    const title = document.createElement('div');
    title.className = 'menu-item';
    title.style.opacity = '0.6';
    title.textContent = 'Scegli il modello:';
    const items = choices.map(choice => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.textContent = choice.name + ' (' + choice.kind + ')';
      item.addEventListener('click', () => resolve(choice));
      return item;
    });
    const cancel = document.createElement('div');
    cancel.className = 'menu-item';
    cancel.style.opacity = '0.6';
    cancel.textContent = 'Annulla';
    cancel.addEventListener('click', () => resolve(null));
    host.replaceChildren(title, ...items, cancel);
    menu.style.display = 'block';
    document.body.classList.add('menu-open');
  });
}

function closeMenu() {
  document.getElementById('model-menu').style.display = 'none';
  document.body.classList.remove('menu-open');
}

async function importAvatar() {
  try {
    const scan = await api.scanAvatarImport();
    if (scan?.canceled) return;
    const choices = scan.candidates || [];
    const candidate = choices.length > 1 ? await chooseCandidate(choices) : choices[0];
    if (!candidate) { renderAvatarMenu(await api.listAvatars()); return; }
    const avatar = await api.commitAvatarImport({ token: scan.token, candidateId: candidate.id });
    if (avatar) switchModel(avatar.id);
  }
  catch (error) { showBubble('Importazione fallita: ' + error.message, 3600); }
}
document.getElementById('btn-import-avatar').addEventListener('click', importAvatar);

// Voci del menu col tasto destro (main.js, showCompanionMenu) che toccano la pagina.
if (api && api.onMenuCommand) {
  api.onMenuCommand((data) => {
    if (!data) return;
    if (data.cmd === 'avatar' && typeof data.id === 'string') switchModel(data.id);
    else if (data.cmd === 'import') importAvatar();
    else if (data.cmd === 'import-animation') importAnimation();
  });
}

// All'avvio: l'avatar salvato se esiste ancora, altrimenti il predefinito.
(async () => {
  try {
    const [cfg, avatars] = await Promise.all([api.getConfig(), api.listAvatars()]);
    const pick = avatars.find(a => a.id === cfg.avatarModel) || avatars.find(a => a.default) || avatars[0];
    if (pick) await switchModel(pick.id, { save: false });
    else { renderAvatarMenu(avatars); window.show2DPlaceholder(); }
  } catch (error) {
    console.error('Avvio avatar fallito:', error);
    window.show2DPlaceholder();
  }
})();
