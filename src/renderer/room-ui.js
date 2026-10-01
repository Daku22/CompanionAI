// room-ui.js — barra del titolo e bordi della stanza.
//
// La finestra e' trasparente e senza cornice anche nella stanza (non si puo'
// cambiare dopo averla creata), quindi titolo, pulsanti e bordi li disegna
// la pagina. La barra sposta la finestra con -webkit-app-region; i bordi
// dicono al main quale lato si e' preso, e il main segue il cursore (room.js).

/**
 * @param {{ api: any, scenes: () => { id: string, label: string, imported?: boolean }[], currentScene: () => string | null,
 *   onScene: (id: string) => void, onAdjust: () => void }} opts
 */
// Icone fisse, scritte qui: innerHTML non riceve mai testo da fuori.
const MAXIMIZE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
const RESTORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8.5" width="10.5" height="10.5" rx="1.5"/><path d="M8.5 5.5h8.5a1.5 1.5 0 0 1 1.5 1.5v8.5"/></svg>';

export function initRoomUI({ api, scenes, currentScene, onScene, onAdjust }) {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('room-scene'));
  const maxBtn = document.getElementById('room-max');
  const adjustBtn = document.getElementById('room-adjust');
  const click = (id, fn) => document.getElementById(id).addEventListener('click', fn);

  click('room-chat', () => api && api.toggleChat && api.toggleChat());
  click('room-min', () => api && api.roomMinimize && api.roomMinimize());
  click('room-max', () => api && api.roomMaximize && api.roomMaximize());
  click('room-close', () => api && api.setView && api.setView('desktop'));
  select.addEventListener('change', () => onScene(select.value));
  click('room-adjust', () => onAdjust());

  for (const grip of document.querySelectorAll('.room-grip')) {
    const edge = /** @type {HTMLElement} */ (grip).dataset.edge;
    let held = false;
    const end = () => {
      if (!held) return;
      held = false;
      if (api && api.roomResizeEnd) api.roomResizeEnd();
    };
    grip.addEventListener('pointerdown', (e) => {
      const ev = /** @type {PointerEvent} */ (e);
      if (ev.button !== 0) return;
      held = true;
      try { grip.setPointerCapture(ev.pointerId); } catch (_) {}
      if (api && api.roomResizeStart) api.roomResizeStart(edge);
    });
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
  }

  return {
    /** room: stanza accesa; maximized: la stanza copre l'area di lavoro. */
    setState({ room, maximized }) {
      maxBtn.innerHTML = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
      maxBtn.title = maximized ? 'Ripristina' : 'Ingrandisci';
      maxBtn.setAttribute('aria-label', maxBtn.title);
      document.body.classList.toggle('room-maximized', !!room && !!maximized);
    },
    /** Rilegge l'elenco delle scene e segna quella in uso; ⚙ solo per le importate. */
    refreshScenes() {
      const list = scenes();
      select.replaceChildren(...list.map(({ id, label }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        return option;
      }));
      select.value = currentScene() || (list[0] && list[0].id) || '';
      const shown = list.find(s => s.id === select.value);
      adjustBtn.classList.toggle('shown', !!(shown && shown.imported));
    },
  };
}
