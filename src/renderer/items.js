// items.js — il pannello del cibo e degli oggetti (Blocchi 10b e 10c).
//
// Cibo: le card dei cibi e delle bevande (food.json e gli oggetti importati
// di tipo Cibo o Bevanda). Oggetti: gli inclusi (pallone, gomitolo, orsetto,
// cuscino) e quelli importati, con "Importa" e la scheda per scegliere nome,
// tipo e misura (con l'anteprima 3D, che scatta anche la miniatura della card).
//
// Premendo su una card il main apre il "fantasma" che segue il cursore; il
// rilascio lo segue il main (anche fuori da questa finestra), qui si dice solo
// inizio e fine.

import { createObjectView } from './object-view.js';

const api = window.companion;
const mode = new URLSearchParams(location.search).get('mode') === 'objects' ? 'objects' : 'food';
const grid = document.getElementById('grid');
const seg = document.getElementById('seg');
const desk = document.getElementById('desk');
const TYPES = [['throw', 'Da lanciare'], ['hug', 'Da abbracciare'], ['food', 'Cibo'], ['drink', 'Bevanda'], ['decor', 'Decorazione']];
let data = { food: [], objects: [], onDesk: 0, maxOnDesk: 5 };
let kind = '';

if (mode === 'objects') {
  document.title = 'Oggetti';
  document.getElementById('title').textContent = 'Oggetti';
  seg.hidden = true;
  grid.setAttribute('aria-label', 'Oggetti');
  document.getElementById('hint').textContent = 'Trascina un oggetto sul desktop o sul companion. Doppio clic su un oggetto per rimetterlo nella borsa.';
}

function icon(it) {
  if (it.icon) {
    const img = document.createElement('img');
    img.src = it.icon;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.textContent = (it.name || '?').slice(0, 1).toUpperCase();
  return ph;
}

function card(it, dragKind) {
  const el = document.createElement('div');
  el.className = 'item';
  el.tabIndex = 0;
  el.dataset.id = it.id;
  el.title = dragKind === 'object' ? 'Trascinalo sul desktop o sul companion' : 'Trascinalo sul companion';
  const name = document.createElement('span');
  name.textContent = it.name;
  el.append(icon(it), name);
  if (dragKind === 'object') {
    const type = document.createElement('small');
    type.textContent = it.typed ? it.typeLabel : 'Scegli il tipo';
    if (!it.typed) type.className = 'todo';
    el.append(type);
    if (!it.builtin) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit';
      edit.title = 'Nome, tipo e misura';
      edit.setAttribute('aria-label', 'Modifica ' + it.name);
      edit.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1-4 9.5-9.5 3 3L9 18z"/></svg>';
      edit.addEventListener('pointerdown', (e) => e.stopPropagation());
      edit.addEventListener('click', (e) => { e.stopPropagation(); openSheet(it.id, false); });
      el.append(edit);
    }
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    api.itemsDrag({ phase: 'start', id: it.id, kind: dragKind });
  });
  const end = (phase) => () => {
    if (!el.classList.contains('dragging')) return;
    el.classList.remove('dragging');
    api.itemsDrag({ phase });
  };
  el.addEventListener('pointerup', end('drop'));
  el.addEventListener('pointercancel', end('cancel'));
  el.addEventListener('lostpointercapture', end('drop'));
  return el;
}

function render() {
  if (mode === 'food') {
    grid.replaceChildren(...data.food.filter(it => !kind || it.kind === kind).map(it => card(it, 'food')));
    return;
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add';
  add.id = 'import';
  add.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Importa';
  add.title = 'Importa un modello 3D (glTF, GLB, FBX, OBJ)';
  add.addEventListener('click', importObject);
  grid.replaceChildren(...data.objects.map(it => card(it, 'object')), add);
  desk.replaceChildren();
  if (data.onDesk > 0) {
    const n = document.createElement('span');
    n.textContent = 'Sul desktop: ' + data.onDesk + ' di ' + data.maxOnDesk;
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'pf-link';
    all.textContent = 'Riponi tutti';
    all.addEventListener('click', () => api.objectsStoreAll());
    desk.append(n, all);
  }
}

for (const b of seg.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => {
    kind = b.dataset.kind;
    for (const o of seg.querySelectorAll('[data-kind]')) o.setAttribute('aria-pressed', String(o === b));
    render();
  });
}
document.getElementById('close').addEventListener('click', () => api.itemsClose());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.item.dragging')) api.itemsDrag({ phase: 'cancel' });
  else if (sheet.id) closeSheet(true);
  else api.itemsClose();
});

async function load() {
  try { data = await api.itemsList(); } catch (_) { /* resta l'ultimo elenco */ }
  render();
}
api.onItemsChanged(() => load());
load();

// ─── Import e scheda di un oggetto ─────────────────────────────────────────
const sheetEl = document.getElementById('sheet');
const nameEl = document.getElementById('name');
const sizeEl = document.getElementById('size');
const sizeOut = document.getElementById('size-out');
const errorEl = document.getElementById('sheet-error');
const removeEl = document.getElementById('remove');
const typesEl = document.getElementById('types');
const sheet = { id: null, isNew: false, type: 'throw', confirm: false };
let view = null;
let spinRaf = 0;

for (const [value, label] of TYPES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.dataset.type = value;
  chip.setAttribute('role', 'radio');
  chip.textContent = label;
  chip.addEventListener('click', () => setType(value));
  typesEl.append(chip);
}
function setType(value) {
  sheet.type = value;
  for (const c of typesEl.children) c.setAttribute('aria-checked', String(c.dataset.type === value));
}
const showSize = () => { sizeOut.value = sizeEl.value + ' cm'; };
sizeEl.addEventListener('input', showSize);

async function importObject(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await api.objectsImport();
    if (r && r.ok && r.object) openSheet(r.object.id, true);
    else if (r && r.error) alertInline(r.error);
  } finally { btn.disabled = false; }
}

/** Un errore di import senza la scheda aperta: nel piede del pannello. */
function alertInline(text) {
  const hint = document.getElementById('hint');
  hint.textContent = 'Importazione non riuscita: ' + text;
  hint.style.color = 'var(--danger)';
}

async function openSheet(id, isNew) {
  const model = await api.objectsModel(id);
  if (!model) return;
  sheet.id = id;
  sheet.isNew = isNew;
  sheet.confirm = false;
  removeEl.textContent = 'Elimina';
  errorEl.textContent = '';
  document.getElementById('sheet-title').textContent = isNew ? 'Nuovo oggetto' : model.name;
  nameEl.value = model.name;
  setType(model.typed ? model.type : 'throw');
  sizeEl.value = String(Math.round(model.size * 100));
  showSize();
  sheetEl.classList.add('open');
  sheetEl.setAttribute('aria-hidden', 'false');
  nameEl.focus();
  if (!view) view = createObjectView(document.getElementById('preview'), { width: 132, height: 132 });
  try {
    const dims = await view.load(model, { fit: 'sphere' });
    // Le misure del modello come punto di partenza (un glTF e' in metri).
    if (isNew && dims && dims.height >= 0.03 && dims.height <= 1.5) { sizeEl.value = String(Math.round(dims.height * 100)); showSize(); }
  } catch (err) {
    errorEl.textContent = 'Anteprima non disponibile: ' + err.message;
  }
  cancelAnimationFrame(spinRaf);
  const t0 = performance.now();
  const spin = (t) => {
    if (!sheet.id) return;
    view.setTurn((t - t0) / 2200);
    view.render();
    spinRaf = requestAnimationFrame(spin);
  };
  spinRaf = requestAnimationFrame(spin);
}

async function closeSheet(canceled) {
  const { id, isNew } = sheet;
  sheet.id = null;
  cancelAnimationFrame(spinRaf);
  sheetEl.classList.remove('open');
  sheetEl.setAttribute('aria-hidden', 'true');
  // Annullato appena importato: l'import non e' mai successo.
  if (canceled && isNew && id) await api.objectsRemove(id);
}

document.getElementById('cancel').addEventListener('click', () => closeSheet(true));
removeEl.addEventListener('click', async () => {
  if (!sheet.confirm) { sheet.confirm = true; removeEl.textContent = 'Conferma eliminazione'; return; }
  const id = sheet.id;
  await closeSheet(false);
  await api.objectsRemove(id);
});
document.getElementById('save').addEventListener('click', async () => {
  const id = sheet.id;
  const meta = { type: sheet.type, name: nameEl.value.trim() || 'Oggetto', size: Number(sizeEl.value) / 100 };
  const r = await api.objectsUpdate(id, meta);
  if (!r || !r.ok) { errorEl.textContent = 'Non salvato: controlla nome e misura.'; return; }
  if (view && view.ready) {
    try { await api.objectsThumb(id, view.snapshot(256)); } catch (_) { /* la card resta con l'iniziale */ }
  }
  await closeSheet(false);
  load();
});
