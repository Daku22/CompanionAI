// scene-adjust.js — il pannello "Sistema la scena", per le scene importate.
//
// Una scena importata si stima da sola (scene-fit.js), ma le unita' dei file
// spesso non tornano: qui si corregge a mano, e si vede subito.
// - Grandezza: da 1/8 a 8 volte quella di quando si e' aperto il pannello;
// - Rotazione: intorno all'avatar;
// - Pavimento: lo alza o lo abbassa sotto i piedi, di un metro al massimo;
// - "Metti l'avatar qui": il prossimo clic sulla scena sceglie il posto.
// Ogni modifica si salva nel main (SceneLibrary) poco dopo.

import * as THREE from 'three';
import { withScale, withRotation, withSpot } from './scene-fit.js';

const SAVE_DELAY_MS = 400;

/**
 * @param {{ api: any, room: any, camera: THREE.Camera, currentLabel: () => string,
 *   showBubble: (text: string, ms?: number) => void, onChange?: () => void }} opts
 */
export function initSceneAdjust({ api, room, camera, currentLabel, showBubble, onChange }) {
  const panel = document.getElementById('scene-adjust');
  const $ = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
  const scaleIn = $('adj-scale'), rotIn = $('adj-rot'), liftIn = $('adj-lift');
  const scaleOut = document.getElementById('adj-scale-out');
  const rotOut = document.getElementById('adj-rot-out');
  const liftOut = document.getElementById('adj-lift-out');
  const placeBtn = document.getElementById('adj-place');
  const hint = document.getElementById('adj-hint');

  let sceneId = null;
  let baseScale = 1;
  let lift = 0;
  let placing = false;
  let saveTimer = null;

  function save() {
    clearTimeout(saveTimer);
    const id = sceneId;
    saveTimer = setTimeout(() => {
      const settings = room.fit();
      if (id && settings && api && api.updateScene) api.updateScene(id, settings).catch(() => {});
    }, SAVE_DELAY_MS);
  }

  /** Cursori allineati alle impostazioni: la grandezza riparte da x1. */
  function sync(settings) {
    baseScale = settings.scale;
    lift = 0;
    scaleIn.value = '0';
    rotIn.value = String(Math.round(settings.rotation));
    liftIn.value = '0';
    show();
  }

  function show() {
    scaleOut.textContent = '×' + Math.pow(2, Number(scaleIn.value)).toFixed(2);
    rotOut.textContent = rotIn.value + '°';
    liftOut.textContent = (Number(liftIn.value) > 0 ? '+' : '') + liftIn.value + ' cm';
  }

  function change(fn) {
    const settings = room.fit();
    if (!settings) return;
    room.setFit(fn(settings));
    show();
    save();
    if (onChange) onChange();
  }

  scaleIn.addEventListener('input', () => change(s => withScale(s, baseScale * Math.pow(2, Number(scaleIn.value)))));
  rotIn.addEventListener('input', () => change(s => withRotation(s, Number(rotIn.value))));
  liftIn.addEventListener('input', () => change(s => {
    const next = Number(liftIn.value) / 100;
    const offset = [...s.offset];
    offset[1] += next - lift;
    lift = next;
    return { ...s, offset };
  }));

  function setPlacing(on) {
    placing = on;
    document.body.classList.toggle('scene-placing', on);
    placeBtn.classList.toggle('active', on);
    hint.textContent = on ? 'Clicca sul pavimento dove vuoi l\'avatar (Esc annulla).' : '';
  }
  placeBtn.addEventListener('click', () => setPlacing(!placing));

  // Il clic che sceglie il posto non deve girare la camera ne' toccare
  // l'avatar: si ferma qui, prima di OrbitControls e companion-input.js.
  const ray = new THREE.Raycaster();
  window.addEventListener('pointerdown', (e) => {
    if (!placing || e.button !== 0 || e.target !== document.getElementById('drag-zone')) return;
    e.stopPropagation();
    e.preventDefault();
    ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
    const hit = room.pick(ray);
    if (!hit) { hint.textContent = 'Li\' non c\'e\' niente della scena: clicca sul pavimento.'; return; }
    // Solo superfici piane: il fianco di un mobile o una parete metterebbero
    // l'avatar dentro il legno.
    if (Math.abs(hit.normal.y) < 0.7) { hint.textContent = 'Li\' e\' in verticale: clicca su un pavimento o un piano.'; return; }
    change(s => withSpot(s, hit.point));
    sync(room.fit());
    setPlacing(false);
  }, true);
  window.addEventListener('keydown', (e) => { if (placing && e.key === 'Escape') setPlacing(false); });

  document.getElementById('adj-auto').addEventListener('click', () => {
    const settings = room.refit();
    if (!settings) return;
    sync(settings);
    save();
    if (onChange) onChange();
  });
  document.getElementById('adj-remove').addEventListener('click', () => {
    // La conferma la chiede il main, con un suo dialogo.
    if (sceneId && api && api.removeScene) api.removeScene(sceneId);
  });
  document.getElementById('adj-done').addEventListener('click', () => close());

  function open(id) {
    const settings = room.fit();
    if (!settings) { showBubble('La scena si sta ancora caricando', 2400); return; }
    sceneId = id;
    document.getElementById('adj-name').textContent = currentLabel();
    sync(settings);
    setPlacing(false);
    panel.classList.add('open');
  }

  function close() {
    if (!panel.classList.contains('open')) return;
    setPlacing(false);
    panel.classList.remove('open');
    sceneId = null;
  }

  return {
    open,
    close,
    /** La scena in vista e' cambiata: il pannello di un'altra scena si chiude. */
    sceneChanged(id) { if (sceneId && id !== sceneId) close(); },
    isOpen: () => panel.classList.contains('open'),
  };
}
