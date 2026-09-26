import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimator, baseYaw } from './vrm-animation.js';


window.__threeVisible = false;
const threeMount = document.getElementById('three-mount');

// Il renderer 3D nasce alla prima scelta di un avatar VRM. Prima veniva creato
// comunque all'avvio: in modalita' 2D, quella predefinita, la pagina teneva
// aperto un secondo contesto WebGL e un loop che girava a vuoto a ogni frame.
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let loader = null;

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

  // OrbitControls per ruotare/inclinare l'avatar 3D con il mouse
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.85, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 5.0;

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
const playClip = (name) => animator.play(name);
const applyVRMIdlePose = (vrm) => animator.reset(vrm);
const updateAnimation = (vrm, delta) => animator.update(vrm, delta);
const setFacing = (dir) => animator.setFacing(dir);

// Il loop gira solo con il 3D visibile: tornando al 2D si ferma del tutto,
// invece di continuare a chiedere un frame al browser per poi non disegnarlo.
let looping = false;

function animate() {
  if (!window.__threeVisible) { looping = false; return; }
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  controls.update();

  if (currentVrm) {
    updateAnimation(currentVrm, delta);

    // Battito di ciglia procedurale (race-safe su switch rapido)
    if (Math.random() < 0.015 && currentVrm.expressionManager) {
      const ref = currentVrm;
      ref.expressionManager.setValue('blink', 1.0);
      setTimeout(() => {
        if (currentVrm === ref && currentVrm.expressionManager) {
          currentVrm.expressionManager.setValue('blink', 0.0);
        }
      }, 140);
    }

    currentVrm.update(delta);
  }
  renderer.render(scene, camera);
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

/** Carica un avatar 3D: VRM animato, oppure glTF come anteprima statica. */
async function loadVRMModel(avatar) {
  console.log("Caricamento modello 3D:", avatar.name);
  ensureThree();
  const seq = ++loadSeq;
  if (currentVrm) {
    scene.remove(currentVrm.scene);
    VRMUtils.deepDispose(currentVrm.scene);
    currentVrm = null;
  }
  if (currentGltf) { scene.remove(currentGltf); VRMUtils.deepDispose(currentGltf); currentGltf = null; }

  loader.load(
    avatar.url,
    (gltf) => {
      if (seq !== loadSeq) { VRMUtils.deepDispose(gltf.scene); return; }
      const vrm = gltf.userData.vrm;
      if (avatar.kind === 'gltf' || !vrm) {
        // GLB/GLTF senza rig VRM: anteprima statica, mai animazioni finte.
        currentGltf = gltf.scene;
        scene.add(currentGltf);
        showBubble('Modello statico: pose ed espressioni non disponibili', 3600);
        return;
      }
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      // combineSkeletons sostituisce removeUnnecessaryJoints, deprecato in three-vrm 3.
      VRMUtils.combineSkeletons(gltf.scene);

      // I VRM 0.x guardano verso -Z, i 1.0 gia' verso la fotocamera: baseYaw
      // sceglie in base alla versione. updateAnimation la riapplica a ogni
      // frame, insieme all'orientamento verso la direzione di marcia.
      vrm.scene.rotation.y = baseYaw(vrm);

      // La Y del bacino e' la base dei sobbalzi di camminata e corsa: va letta
      // una volta sola, prima che una clip la modifichi.
      const hipsNode = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
      if (hipsNode) hipsNode.userData.__baseY = hipsNode.position.y;

      // Posa iniziale a riposo: reset() riporta anche il player a idle,
      // altrimenti il modello nuovo erediterebbe la clip di quello vecchio.
      applyVRMIdlePose(vrm);

      // Tracciamento sguardo verso la fotocamera
      if (vrm.lookAt) vrm.lookAt.target = camera;

      currentVrm = vrm;
      scene.add(vrm.scene);
    },
    undefined,
    (err) => {
      console.error("Errore nel caricamento del modello 3D:", err);
      if (seq === loadSeq) showBubble('Modello 3D non caricato', 3000);
    }
  );
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
  const dragZone = document.getElementById('drag-zone');
  window.__threeVisible = false;
  document.body.classList.remove('mode-3d');
  if (window.app) window.app.ticker.start();
  pixi.style.display = 'block';
  three.style.display = 'none';
  three.style.pointerEvents = 'none';
  if (renderer) renderer.domElement.style.pointerEvents = 'none';
  // In 2D tutta la finestra si trascina.
  dragZone.style.display = 'block';
  dragZone.style.pointerEvents = 'auto';
  dragZone.style.webkitAppRegion = 'drag';
}

function show3D() {
  const pixi = document.getElementById('pixi-mount');
  const three = document.getElementById('three-mount');
  const dragZone = document.getElementById('drag-zone');
  window.unload2DAvatar();
  ensureThree();
  window.__threeVisible = true;
  document.body.classList.add('mode-3d');
  if (window.app) window.app.ticker.stop();
  onWindowResize();
  startLoop();
  pixi.style.display = 'none';
  three.style.display = 'block';
  three.style.zIndex = '15';
  three.style.pointerEvents = 'auto';
  three.style.webkitAppRegion = 'no-drag';
  renderer.domElement.style.pointerEvents = 'auto';
  renderer.domElement.style.touchAction = 'none';
  // Il mouse serve a OrbitControls: la finestra si sposta dalla maniglia (#drag-handle).
  dragZone.style.display = 'none';
  dragZone.style.webkitAppRegion = 'no-drag';
}

let currentAvatarId = null;

/**
 * Mostra un avatar dell'elenco. save=false al ripristino dell'avvio: salvare
 * solo le scelte dell'utente evita di sovrascrivere la configurazione con il
 * ripiego usato quando l'avatar salvato non esiste piu'.
 */
async function switchModel(avatarId, { save = true } = {}) {
  document.getElementById('model-menu').style.display = 'none';
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
    // Il corpo si muove sempre; le espressioni solo se il modello le espone.
    playClip(key);
    if (!currentVrm || !currentVrm.expressionManager) return;
    const ref = currentVrm;
    const reset = (name) => setTimeout(() => { if (currentVrm === ref && currentVrm.expressionManager) currentVrm.expressionManager.setValue(name, 0.0); }, 3000);
    if (key === 'wave' || key === 'happy') {
      ref.expressionManager.setValue('happy', 1.0); reset('happy');
    } else if (key === 'click') {
      ref.expressionManager.setValue('happy', 0.7); reset('happy');
    } else if (key === 'think' || key === 'search' || key === 'scroll' || key === 'relaxed') {
      ref.expressionManager.setValue('relaxed', 1.0); reset('relaxed');
    } else if (key === 'idle' || key === 'none') {
      try { ref.expressionManager.setValue('happy', 0.0); ref.expressionManager.setValue('relaxed', 0.0); } catch (_) {}
    }
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
  });
}

document.getElementById('btn-import-avatar').addEventListener('click', async () => {
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
});

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
