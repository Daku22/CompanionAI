import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRMHumanoid } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import {
  createVRMAnimator, baseYaw, isVRM0, createBlinker, createGaze, moodExpressions, MOOD_EXPRESSIONS, GENERATED,
} from './vrm-animation.js';
import { createClipLayer, applyLook, isLoopSlot } from './clip-layer.js';
import { prepareHumanoid, retargetClip, writeVRMA } from './motion-retarget.js';
import { kimodoClip } from './kimodo-raw.js';
import { repairFbxTextures, createFbxManager } from './fbx-textures.js';
import { GLTFSpecularGlossinessPlugin } from './gltf-specgloss.js';
import { createRoomScene } from './room-scene.js';
import { initRoomUI } from './room-ui.js';
import { initSceneAdjust } from './scene-adjust.js';


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
let controls = null;
let roomScene = null;
const PIVOT_Y = 1.45;

// Modalita' stanza (room.js nel main): la scena resta viva anche con un
// avatar 2D, disegnato sopra; chatInset e' lo spazio a destra della chat.
let roomMode = false;
let chatInset = 0;
const DRAG_LIFT = 0.06;

function ensureThree() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  threeMount.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  // 38 gradi e non 35: con 35 il pavimento cadeva sul bordo basso della
  // finestra, e l'ombra ai piedi (l'ancora per le finestre) restava tagliata.
  camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0.95, 2.7);
  camera.lookAt(0, CAMERA_LOOK_Y, 0);

  // Camera: il sinistro prende l'avatar (companion-input.js), destro o
  // centrale + trascina girano intorno, con Alt premuto spostano la camera,
  // la rotella zooma. OrbitControls sta sullo strato che riceve il mouse, non
  // sul canvas; il mouse arriva solo sopra il modello, e durante la rotazione
  // resta catturato.
  controls = new OrbitControls(camera, document.getElementById('drag-zone'));
  controls.target.set(0, CAMERA_LOOK_Y, 0);
  controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
  // OrbitControls sposta con Ctrl o Shift, non con Alt: il tasto giusto lo
  // sceglie questo ascoltatore, che arriva prima del suo (fase di cattura).
  controls.enablePan = true;
  controls.panSpeed = 0.8;
  window.addEventListener('pointerdown', (e) => {
    const mode = e.altKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = mode;
    controls.mouseButtons.RIGHT = mode;
    if (controls.mouseButtons.LEFT !== -1) controls.mouseButtons.LEFT = mode;
  }, true);
  // Quanto lontano dall'avatar puo' andare il punto guardato: poco sul
  // desktop, dove la finestra e' stretta intorno a lui (resetCamera).
  controls.cursor.set(0, CAMERA_LOOK_Y, 0);
  controls.maxTargetRadius = CAMERA_HOME.desktop.maxTarget;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // La rotazione si misura sull'altezza della finestra, che qui e' piccola:
  // a velocita' piena bastavano 260 px per un giro intero.
  controls.rotateSpeed = 0.5;
  controls.minDistance = 0.5;
  controls.maxDistance = 5.0;
  // Giro completo in orizzontale; in altezza poco sopra e poco sotto.
  controls.minPolarAngle = Math.PI / 2 - 0.45;
  controls.maxPolarAngle = Math.PI / 2 + 0.15;
  controls.update();
  controls.saveState();

  rig = new THREE.Group();
  rig.position.y = PIVOT_Y;
  body = new THREE.Group();
  body.position.y = -PIVOT_Y;
  rig.add(body);
  scene.add(rig);
  shadow = makeShadow();
  scene.add(shadow);

  // Environment & Lighting
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.4);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  roomScene = createRoomScene({ scene, renderer, hemiLight, dirLight, listScenes: api && api.listScenes, onModel: onSceneModel });

  loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  loader.register(parser => new GLTFSpecularGlossinessPlugin(parser));
}

// ─── Ombra ai piedi ────────────────────────────────────────────────────────
// Un disco sfumato sul pavimento (y = 0), fuori da rig e body: quando l'avatar
// e' in braccio resta a terra e mostra dove si posera'. E' l'ancora per le
// finestre: se al rilascio cade sul bordo alto di una finestra, l'avatar ci
// sale (perch.js nel main). Seduto sul bordo sparisce, non c'e' pavimento.
let shadow = null;
const SHADOW_SIZE_M = 0.6;
let shadowOpacity = 0;
let perchPhase = null;   // null, 'stand' o 'sit'

function makeShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Scura al centro: e' un mirino, deve vedersi anche su uno sfondo chiaro.
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.9)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.65)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SHADOW_SIZE_M, SHADOW_SIZE_M), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  mesh.renderOrder = -1;
  return mesh;
}

const shadowHips = new THREE.Vector3();
function updateShadow(vrm, delta) {
  if (!shadow) return;
  const hips = vrm && vrm.humanoid && vrm.humanoid.getRawBoneNode('hips');
  if (hips) {
    hips.getWorldPosition(shadowHips);
    shadow.position.x = shadowHips.x;
    shadow.position.z = shadowHips.z;
  }
  // Sempre ben visibile: in braccio e' il mirino per posarlo su una finestra.
  const target = !hips || perchPhase === 'sit' ? 0 : dragging ? 1 : 0.9;
  shadowOpacity += (target - shadowOpacity) * Math.min(1, delta * 8);
  shadow.material.opacity = shadowOpacity;
  shadow.visible = shadowOpacity > 0.01;
}

function onWindowResize() {
  if (!renderer) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  // Nella stanza con la chat aperta l'avatar sta al centro dello spazio
  // libero a sinistra: la vista si sposta, la scena continua sotto la chat.
  const inset = roomMode ? Math.min(chatInset, width * 0.6) : 0;
  camera.aspect = (width + inset) / height;
  if (inset > 0) camera.setViewOffset(width + inset, height, inset, 0, width, height);
  else camera.clearViewOffset();
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
    // Labiale: la bocca segue il volume della voce (voice-player.js).
    em.setValue('aa', window.CompanionVoice ? window.CompanionVoice.mouth(delta) : 0);
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

if (api && api.onMoodChanged) api.onMoodChanged((mood) => { moodWeights = moodExpressions(mood); lastMood = mood; if (roomScene) roomScene.setMood(mood); });
let lastMood = null;

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
const toCamera = new THREE.Vector3();
const planePoint = new THREE.Vector3();
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
  /** Avvia un gesto per nome, e la posa di riposo (idle, perch), senza il main. */
  play: (name) => playClip(name),
  rest: (name) => animator.setRest(name),
  /** Camera: angoli e distanza da OrbitControls; resetCamera la rimette a posto. */
  camera: () => controls && {
    azimuth: controls.getAzimuthalAngle(), polar: controls.getPolarAngle(), distance: controls.getDistance(),
    target: controls.target.toArray(),
  },
  resetCamera: () => resetCamera(),
  /** Voce: se sta parlando e quanto e' aperta la bocca del VRM ("aa"). */
  voice: () => ({
    speaking: !!(window.CompanionVoice && window.CompanionVoice.isSpeaking()),
    aa: currentVrm && currentVrm.expressionManager ? currentVrm.expressionManager.getValue('aa') : null,
  }),
  /** Stanza: stato della scena; setTime forza un'ora (ISO) per le schermate. */
  room: () => ({ mode: roomMode, chatInset, ...(roomScene ? roomScene.debug() : {}) }),
  roomTime: (iso) => { if (roomScene) roomScene.setTime(iso ? new Date(iso) : null); },
  roomScene: (id) => { const chosen = roomScene ? roomScene.setScene(id) : null; roomUI.refreshScenes(); return chosen; },
  roomWeather: (w, place) => { if (roomScene) roomScene.setWeather(w, place); },
  /** Stato dell'ombra ai piedi. */
  shadow: () => shadow && { visible: shadow.visible, opacity: shadow.material.opacity, x: shadow.position.x, z: shadow.position.z },
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

// Posato su una finestra o sulla taskbar (perch.js nel main): prima in piedi
// sul bordo (phase 'stand'), poi seduto (phase 'sit'). Da seduto il riposo
// diventa la seduta, e ogni gesto torna li' invece che in piedi.
if (api && api.onPerchState) {
  api.onPerchState((data) => {
    perchPhase = data && data.perched ? (data.phase === 'sit' ? 'sit' : 'stand') : null;
    const sitting = perchPhase === 'sit';
    animator.setRest(sitting ? 'perch' : 'idle');
    if (window.__threeVisible && !dragging) playClip(sitting ? 'perch' : 'idle');
  });
}

// Ancora per il main, in px della finestra: l'ombra (feet, il pavimento sotto
// il bacino) e la seduta (seat, il bacino qualche centimetro piu' in basso,
// dove poggiano le cosce). Si misura a riposo e non in braccio; si manda
// quando cambia, e ogni 2 s perche' passando dal 2D al 3D il main tenga
// quella giusta. Posato su un bordo non si rimisura (la posa seduta abbassa
// il bacino), ma i punti misurati si riproiettano con la camera di adesso:
// girando la camera o zoomando, l'avatar resta sul bordo.
const SEAT_BELOW_HIPS_M = 0.07;
const seatPoint = new THREE.Vector3();
const feetPoint = new THREE.Vector3();
const projected = new THREE.Vector3();
let seatMeasured = false;
let seatSentAt = 0;
let seatKey = '';
function toWindowPx(point) {
  projected.copy(point).project(camera);
  return { x: Math.round((projected.x + 1) / 2 * window.innerWidth), y: Math.round((1 - projected.y) / 2 * window.innerHeight) };
}
function reportSeat(vrm) {
  const now = performance.now();
  if (dragging || roomMode || !api || !api.setSeatAnchor || now - seatSentAt < 500) return;
  if (!perchPhase) {
    const hips = vrm.humanoid && vrm.humanoid.getRawBoneNode('hips');
    if (!hips) return;
    hips.getWorldPosition(seatPoint);
    feetPoint.set(seatPoint.x, 0, seatPoint.z);
    seatPoint.y -= SEAT_BELOW_HIPS_M;
    seatMeasured = true;
  } else if (!seatMeasured) return;
  const feet = toWindowPx(feetPoint);
  const seat = toWindowPx(seatPoint);
  const key = feet.x + ',' + feet.y + ',' + seat.y;
  if (key === seatKey && now - seatSentAt < 2000) return;
  seatKey = key;
  seatSentAt = now;
  api.setSeatAnchor({ x: feet.x, feet: feet.y, seat: seat.y });
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
  // Il piano del cursore sta fra la testa e la camera, di fronte alla camera:
  // con la camera ruotata il cursore resta "davanti" a chi guarda.
  toCamera.copy(camera.position).sub(headPos).normalize();
  lookPlane.setFromNormalAndCoplanarPoint(toCamera, planePoint.copy(headPos).addScaledVector(toCamera, LOOK_PLANE_M));
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
if (api && api.getMood) api.getMood().then((mood) => { moodWeights = moodExpressions(mood); lastMood = mood; if (roomScene) roomScene.setMood(mood); }).catch(() => {});

// Il loop gira solo con il 3D visibile: tornando al 2D si ferma del tutto,
// invece di continuare a chiedere un frame al browser per poi non disegnarlo.
let looping = false;

function animate() {
  if (!window.__threeVisible && !roomMode) { looping = false; return; }
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  roomScene.update(delta);

  // Oscillazione in braccio, con il perno alla testa (rig), e sollevamento.
  const { side, forward } = sway.update(delta, dragging ? dragVel.vx : 0, dragging ? dragVel.vy : 0);
  rig.rotation.z = -side;
  rig.rotation.x = forward;
  const lift = dragging ? DRAG_LIFT : 0;
  body.position.y += (-PIVOT_Y + lift - body.position.y) * Math.min(1, delta * 10);

  if (currentVrm && window.__threeVisible) {
    const lookTarget = updateLook(currentVrm);
    updateAnimation(currentVrm, delta);
    updateFace(currentVrm, delta, lookTarget);
    updateWind(currentVrm);
    currentVrm.update(delta);
    frameSeated(currentVrm, delta);
    updateShadow(currentVrm, delta);
    reportSeat(currentVrm);
  }
  controls.update();
  renderer.render(scene, camera);
  readHit();
}

// Seduto a terra le gambe vengono verso la camera e uscivano dal fondo della
// finestra: la camera abbassa lo sguardo in proporzione a quanto e' sceso il
// bacino, e lo rialza quando l'avatar si rimette in piedi. Lo sguardo e' il
// punto intorno a cui gira OrbitControls.
const CAMERA_LOOK_Y = 0.85;
const SEATED_LOOK_DROP = 0.3;
let seated = 0;
let seatedDrop = 0;
function frameSeated(vrm, delta) {
  const hips = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
  const rest = hips && hips.userData.__baseY;
  const target = rest > 0 ? Math.max(0, Math.min(1, 1 - hips.position.y / rest)) : 0;
  seated += (target - seated) * Math.min(1, delta * 3);
  // Solo la differenza: lo spostamento fatto con Alt resta dov'e'.
  const drop = SEATED_LOOK_DROP * seated;
  controls.target.y -= drop - seatedDrop;
  seatedDrop = drop;
}

// Inquadratura di partenza: sul desktop la finestra e' stretta attorno
// all'avatar; nella stanza la camera sta piu' indietro, perche' si veda la
// scena e la testa non finisca sotto la barra del titolo.
// maxTarget: quanto puo' spostarsi (Alt + trascina) il punto guardato.
const CAMERA_HOME = {
  desktop: { position: [0, 0.95, 2.7], maxDistance: 5, maxTarget: 0.6 },
  room: { position: [0, 1.05, 3.9], maxDistance: 12, maxTarget: 25 },
};

/** Camera com'era all'avvio (o all'apertura della stanza): dal menu e con il doppio clic centrale. */
function resetCamera() {
  if (!controls) return;
  const home = CAMERA_HOME[roomMode ? 'room' : 'desktop'];
  controls.maxDistance = home.maxDistance;
  controls.maxTargetRadius = home.maxTarget;
  camera.position.set(...home.position);
  controls.target.set(0, CAMERA_LOOK_Y - seatedDrop, 0);
  controls.update();
  keepCameraInside();
}
window.addEventListener('companion-camera-reset', () => { if (window.__threeVisible) resetCamera(); });

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
// Ingombro massimo di un modello statico: quello di un VRM tipico.
const STATIC_HEIGHT_M = 1.6;

/**
 * Un glTF o FBX con scheletro umano diventa un "VRM" minimo: stesso umanoide
 * normalizzato, quindi stesse pose, clip, sguardo e oscillazione. null se lo
 * scheletro non e' umano.
 */
function humanoidFromObject(object) {
  // root raddrizza e scala il modello (0.01 per un FBX in centimetri); le ossa
  // normalizzate stanno accanto, in scene, che resta in metri: dentro root
  // erediterebbero la scala e il bacino finirebbe a terra.
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.add(object);
  scene.add(root);
  let nodes;
  try { nodes = prepareHumanoid(root); } catch (error) {
    console.warn('Modello senza scheletro umano:', error.message);
    return null;
  }
  const head = nodes.head.getWorldPosition(new THREE.Vector3()).y;
  if (head > 0.01) root.scale.multiplyScalar(HEAD_HEIGHT_M / head);
  root.updateMatrixWorld(true);
  removePedestals(root);
  const box = new THREE.Box3().setFromObject(root);
  if (Number.isFinite(box.min.y)) root.position.y -= box.min.y;
  const hips = nodes.hips.getWorldPosition(new THREE.Vector3());
  root.position.x -= hips.x;
  root.position.z -= hips.z;
  scene.updateMatrixWorld(true);
  const humanoid = new VRMHumanoid(/** @type {any} */ (Object.fromEntries(Object.entries(nodes).map(([k, node]) => [k, { node }]))));
  scene.add(humanoid.normalizedHumanBonesRoot);
  return {
    scene, humanoid, meta: { metaVersion: '1' },
    expressionManager: null, lookAt: null, springBoneManager: null,
    update() { humanoid.update(); },
  };
}

/**
 * Toglie i piedistalli dei modelli presi da Sketchfab e simili: una mesh
 * senza ossa, piatta e larga almeno mezzo personaggio. Sul desktop o nella
 * stanza sarebbe un disco sotto i piedi, e allargherebbe l'ingombro del modello
 * (Box3.setFromObject conta anche le mesh nascoste, quindi si rimuove).
 */
function removePedestals(root) {
  const size = new THREE.Vector3();
  const pedestals = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    new THREE.Box3().setFromObject(o).getSize(size);
    const wide = Math.max(size.x, size.z);
    if (wide > HEAD_HEIGHT_M * 0.5 && size.y < wide * 0.05) pedestals.push(o);
  });
  for (const o of pedestals) { o.removeFromParent(); VRMUtils.deepDispose(o); }
}

/** Un modello senza umanoide, alto quanto un VRM tipico, centrato e a terra. */
function staticPreview(object) {
  const root = new THREE.Group();
  root.add(object);
  removePedestals(root);
  const box = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(box.min.y)) return root;
  const size = box.getSize(new THREE.Vector3());
  const tallest = Math.max(size.x, size.y, size.z);
  if (tallest > 1e-6) root.scale.setScalar(STATIC_HEIGHT_M / tallest);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  return root;
}

/** Legge il file del modello: { vrm } per un VRM, { object } per il resto. */
async function readModel(avatar) {
  if (avatar.kind === 'fbx') {
    const textures = avatar.textures || [];
    const manager = createFbxManager(textures);
    const object = await new FBXLoader(manager).loadAsync(avatar.url);
    await manager.idle();
    repairFbxTextures(object, textures);
    return { vrm: null, object };
  }
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
  seatMeasured = false;
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
      // In scala e a terra come un umanoide, altrimenti un modello in
      // centimetri resta fuori dall'inquadratura.
      currentGltf = staticPreview(model.object);
      keepAvatarLook(currentGltf);
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
  keepAvatarLook(vrm.scene);
  body.add(vrm.scene);
}

// Nella stanza cielo e foto HDR usano il tone mapping; l'avatar deve restare
// com'e' sul desktop, quindi i suoi materiali ne restano fuori. Le luci della
// scena lo illuminano comunque.
function keepAvatarLook(object) {
  object.traverse((o) => {
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) m.toneMapped = false;
  });
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
  'sit-edge': 'Seduto sul bordo', perch: 'Seduto su una finestra', dangle: 'In braccio', stretch: 'Si stiracchia', yawn: 'Sbadiglio',
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
  // Nella stanza la scena resta dietro l'avatar 2D, e la camera gira ancora.
  if (controls) controls.enabled = roomMode;
  if (body) body.visible = false;
  window.CompanionInput.setProbe(window.hitTest2D);
  document.body.classList.remove('mode-3d');
  if (window.app) window.app.ticker.start();
  pixi.style.display = 'block';
  three.style.display = roomMode ? 'block' : 'none';
  three.style.pointerEvents = 'none';
  if (renderer) renderer.domElement.style.pointerEvents = 'none';
}

function show3D() {
  const pixi = document.getElementById('pixi-mount');
  const three = document.getElementById('three-mount');
  window.unload2DAvatar();
  window.CompanionInput.setProbe(probe3D);
  ensureThree();
  controls.enabled = true;
  body.visible = true;
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

// "Prova" nel menu col tasto destro: proprio quel file, una volta, con il
// nome nel fumetto; poi si torna a riposo. Passa dallo slot dei movimenti
// generati, che riproduce la clip che gli si da' invece di sceglierne una.
async function previewClip(url, name) {
  if (!window.__threeVisible || !currentVrm) { showBubble('Le animazioni si provano con un avatar 3D', 3000); return }
  const gltf = await vrmaLoader.loadAsync(url);
  const animation = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
  if (!animation) throw new Error('nessuna animazione VRMA nel file');
  clips.setGenerated({ name, animation, phase: 'loop' });
  const duration = clips.prepare(GENERATED);
  animator.play(GENERATED, { duration, restart: true });
  clearReactions();
  showBubble(name.replace(/\.vrma$/i, ''), Math.max(2500, (duration || 3) * 1000));
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
    if (data.cmd === 'scene' && typeof data.id === 'string') selectScene(data.id);
    else if (data.cmd === 'scene-adjust') openSceneAdjust();
    else if (data.cmd === 'avatar' && typeof data.id === 'string') switchModel(data.id);
    else if (data.cmd === 'import') importAvatar();
    else if (data.cmd === 'import-animation') importAnimation();
    else if (data.cmd === 'camera-reset') resetCamera();
    else if (data.cmd === 'preview-clip' && typeof data.url === 'string' && data.url.startsWith('motion://')) {
      previewClip(data.url, String(data.name || 'clip')).catch((error) => {
        console.error('Prova non riuscita:', error);
        showBubble('Clip non riprodotta: ' + error.message, 3600);
      });
    } else if (data.cmd === 'preview-slot' && typeof data.slot === 'string') {
      if (!window.__threeVisible || !currentVrm) showBubble('Le animazioni si provano con un avatar 3D', 3000);
      else { clearReactions(); playClip(data.slot); showBubble(SLOT_LABELS[data.slot] || data.slot, 2500); }
    }
  });
}

// ─── Stanza ────────────────────────────────────────────────────────────────
// Il main dice la modalita' (view-mode). Nella stanza la scena gira sempre,
// il sinistro ruota la camera, e la barra del titolo e i bordi li gestisce
// room-ui.js.
const roomUI = initRoomUI({
  api,
  scenes: () => (roomScene ? roomScene.list() : []),
  currentScene: () => (roomScene ? roomScene.current() : null),
  onScene: (id) => selectScene(id),
  onAdjust: () => openSceneAdjust(),
});

/** Mostra una scena e la ricorda; un id sparito torna alla prima. */
function selectScene(id) {
  if (!roomScene) return;
  const chosen = roomScene.setScene(id);
  if (api && api.setConfig) api.setConfig({ roomScene: chosen }).catch(() => {});
  roomUI.refreshScenes();
  if (sceneAdjust) sceneAdjust.sceneChanged(chosen);
}

// "Sistema la scena": nasce con il renderer, che serve per i clic sul pavimento.
let sceneAdjust = null;
function openSceneAdjust() {
  if (!roomMode || !roomScene) return;
  const id = roomScene.current();
  const def = roomScene.list().find(s => s.id === id);
  if (!def || !def.imported) { showBubble('Si sistemano solo le scene importate', 2600); return; }
  if (!sceneAdjust) {
    sceneAdjust = initSceneAdjust({
      api, room: roomScene, camera, showBubble, onChange: () => keepCameraInside(),
      currentLabel: () => { const s = roomScene.list().find(x => x.id === roomScene.current()); return s ? s.label : ''; },
    });
  }
  sceneAdjust.open(id);
}

/** Caricamento di una scena importata: la prima volta la stima si salva. */
function onSceneModel(event) {
  if (event.state === 'loading') showBubble('Carico la scena…', 2400);
  else if (event.state === 'error') showBubble('Scena non caricata: ' + event.error, 4200);
  else if (event.state === 'ready') {
    keepCameraInside();
    if (!event.estimated) return;
    if (api && api.updateScene) api.updateScene(event.id, event.settings).catch(() => {});
    showBubble('Se la scena non torna: ⚙ in alto, "Sistema la scena"', 4200);
  }
}

// Una scena importata puo' essere piu' stretta della distanza della camera:
// dietro una parete o una tenda si vedrebbe solo quella. Se fra l'avatar e
// la camera c'e' una parete, la camera viene avanti fino a starci davanti.
// E' una parete se blocca anche un raggio piu' in alto: un banco o una
// sedia no, e sopra quelli la camera guarda benissimo.
const CAMERA_WALL_GAP = 0.25;
const CAMERA_MIN_DISTANCE = 0.8;
const WALL_PROBE_UP = 0.8;
function keepCameraInside() {
  if (!roomMode || !roomScene || !controls) return;
  const offset = camera.position.clone().sub(controls.target);
  const distance = offset.length();
  if (!(distance > 0)) return;
  offset.divideScalar(distance);
  const low = roomScene.obstacle(controls.target, offset, distance);
  if (low === null) return;
  const high = roomScene.obstacle(controls.target.clone().setY(controls.target.y + WALL_PROBE_UP), offset, distance);
  if (high === null) return;
  camera.position.copy(controls.target).addScaledVector(offset, Math.max(CAMERA_MIN_DISTANCE, Math.min(low, high) - CAMERA_WALL_GAP));
  controls.update();
}

// Scena importata (il main la fa gia' scegliere) o eliminata dal menu.
if (api && api.onRoomScenes) {
  api.onRoomScenes(async (data) => {
    if (!roomScene) return;
    await roomScene.reload();
    if (data && typeof data.select === 'string') {
      selectScene(data.select);
      if (data.imported) showBubble('Scena importata: ' + data.imported, 3000);
    } else if (data && data.removed) {
      if (sceneAdjust) sceneAdjust.close();
      if (roomScene.current() === data.removed) selectScene(data.removed);
      else roomUI.refreshScenes();
      showBubble('Scena eliminata', 2400);
    } else roomUI.refreshScenes();
  });
}

async function applyViewMode(data) {
  const next = !!data && data.mode === 'room';
  chatInset = next ? Math.max(0, Number(data.chatInset) || 0) : 0;
  window.__roomInset = chatInset;
  roomUI.setState({ room: next, maximized: !!(data && data.maximized) });
  if (next !== roomMode) {
    roomMode = next;
    window.CompanionInput.setRoom(roomMode);
    document.body.classList.toggle('mode-room', roomMode);
    if (roomMode) {
      ensureThree();
      await roomScene.ready;
      const cfg = api && api.getConfig ? await api.getConfig().catch(() => ({})) : {};
      roomScene.setScene(cfg.roomScene);
      roomScene.setMood(lastMood);
      roomScene.setActive(true);
      roomUI.refreshScenes();
      controls.enabled = true;
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      resetCamera();
      document.getElementById('three-mount').style.display = 'block';
      if (body) body.visible = window.__threeVisible;
      startLoop();
    } else if (roomScene) {
      if (sceneAdjust) sceneAdjust.close();
      roomScene.setActive(false);
      controls.mouseButtons.LEFT = -1;
      controls.enabled = window.__threeVisible;
      resetCamera();
      if (!window.__threeVisible) document.getElementById('three-mount').style.display = 'none';
    }
  }
  onWindowResize();
}
if (api && api.onViewMode) api.onViewMode((data) => { applyViewMode(data).catch(e => console.error('Stanza non aperta:', e)); });
if (api && api.onRoomWeather) api.onRoomWeather((data) => { if (roomScene) roomScene.setWeather(data && data.weather, data && data.place); });

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
