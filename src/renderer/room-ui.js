// room-ui.js — barra del titolo e bordi della stanza.
//
// La finestra e' trasparente e senza cornice anche nella stanza (non si puo'
// cambiare dopo averla creata), quindi titolo, pulsanti e bordi li disegna
// la pagina. La barra sposta la finestra con -webkit-app-region; i bordi
// dicono al main quale lato si e' preso, e il main segue il cursore (room.js).

/**
 * @param {{ api: any, scenes: () => { id: string, label: string }[], currentScene: () => string | null,
 *   onScene: (id: string) => void }} opts
 */
export function initRoomUI({ api, scenes, currentScene, onScene }) {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById('room-scene'));
  const maxBtn = document.getElementById('room-max');
  const click = (id, fn) => document.getElementById(id).addEventListener('click', fn);

  click('room-chat', () => api && api.toggleChat && api.toggleChat());
  click('room-min', () => api && api.roomMinimize && api.roomMinimize());
  click('room-max', () => api && api.roomMaximize && api.roomMaximize());
  click('room-close', () => api && api.setView && api.setView('desktop'));
  select.addEventListener('change', () => onScene(select.value));

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
      maxBtn.textContent = maximized ? '❐' : '□';
      maxBtn.title = maximized ? 'Ripristina' : 'Ingrandisci';
      document.body.classList.toggle('room-maximized', !!room && !!maximized);
    },
    /** Rilegge l'elenco delle scene e segna quella in uso. */
    refreshScenes() {
      const list = scenes();
      select.replaceChildren(...list.map(({ id, label }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        return option;
      }));
      select.value = currentScene() || (list[0] && list[0].id) || '';
    },
  };
}
