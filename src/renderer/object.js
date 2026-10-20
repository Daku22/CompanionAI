// object.js — un oggetto sul desktop (Blocco 10c), nella sua finestrella
// trasparente. Il main fa tutto il resto: la fisica, dove sta la finestra,
// chi lo insegue. Qui si disegna il modello, lo si fa rotolare quando il main
// lo dice, e si avvisa il main quando lo prendi (pointerdown) o lo rimetti
// nella borsa (doppio clic).

import { createObjectView } from './object-view.js';

const api = window.companion;
const canvas = document.getElementById('view');
const view = createObjectView(canvas, { width: window.innerWidth, height: window.innerHeight });
let roll = false;

async function load() {
  const info = await api.objectInfo();
  if (!info) return;
  roll = info.roll === true;
  document.body.title = info.name + ' · trascinalo o lancialo; doppio clic per rimetterlo nella borsa';
  try {
    await view.load(info, { fit: roll ? 'sphere' : 'tight' });
  } catch (error) {
    console.error('Oggetto non caricato:', error.message);
    return;
  }
  view.render();
  document.body.classList.add('ready');
}

api.onObjectPose((pose) => {
  if (roll && pose && Number.isFinite(pose.spin)) view.setSpin(pose.spin);
  view.render();
});
// Cambiati tipo o misura dal pannello: si ricarica (rotola o no, inquadratura).
api.onObjectInfo(() => { load(); });
window.addEventListener('resize', () => { view.resize(window.innerWidth, window.innerHeight); view.render(); });

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  api.objectGrab();
});
canvas.addEventListener('dblclick', () => api.objectStore());
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); api.objectStore(); });

load();
