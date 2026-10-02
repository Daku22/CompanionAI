// companion-input.js — il mouse sull'avatar, come in Mate Engine.
//
// - Sui pixel vuoti della finestra i clic passano alle finestre sotto: il main
//   parte con setIgnoreMouseEvents(true, { forward: true }) e qui si chiede di
//   catturare il mouse solo quando il cursore sta sull'avatar o su un pulsante.
// - Premere sull'avatar e muovere lo prende in braccio: il main sposta la
//   finestra seguendo il cursore e manda la velocita' (drag-motion). Quando
//   un clic diventa una presa lo decide touch.js (pressAction): il tremolio
//   della mano resta un clic, e tenuto fermo a lungo lo prende in braccio.
// - Clic: una reazione per la zona toccata (testa, viso, pancia...). La zona
//   la dice il renderer attivo (setZoneProbe), la reazione la decide il main
//   (touch-react.js) e torna con l'evento companion-touch. Il mouse avanti e
//   indietro sulla testa, senza tasti, e' una carezza (createRubDetector).
//   Doppio clic: la chat. Tasto destro: il menu.
// - Destro o centrale + trascina ruotano la camera 3D (OrbitControls in
//   companion-3d.js, sullo stesso strato): il menu si apre solo se il destro
//   e' stato rilasciato senza muoversi. Doppio clic centrale: camera a posto.
//
// Se il pixel sotto il cursore sia pieno lo dice il renderer attivo (2D o 3D)
// con setProbe(); il 3D lo sa solo al frame successivo e lo comunica con
// setOverModel().

(function () {
  const api = window.companion
  const layer = document.getElementById('drag-zone')
  const UI_SELECTOR = '#click-zone, #switch-zone, #model-menu'
  const Touch = window.CompanionTouch

  /** @type {((x: number, y: number) => boolean | null) | null} */
  let probe = null
  /** @type {((x: number, y: number) => string | null) | null} */
  let zoneProbe = null
  const rub = Touch.createRubDetector()
  let overModel = false
  let overUI = false
  let captured = null
  // Sinistro premuto: s* in px dello schermo per la distanza, c* nella pagina
  // per il punto del clic, t per il tempo, timer per la presa da fermo.
  /** @type {{ sx: number, sy: number, cx: number, cy: number, t: number, dragging: boolean, timer: any } | null} */
  let press = null
  // Destro o centrale premuto: la camera ruota. menu: il contextmenu e'
  // arrivato a tasto ancora giu' (su Windows arriva dopo il rilascio).
  /** @type {{ sx: number, sy: number, cx: number, cy: number, button: number, moved: boolean, menu: boolean } | null} */
  let orbit = null
  let skipMenuUntil = 0
  let lastMiddleUp = 0
  const DOUBLE_CLICK_MS = 400
  // Nella stanza la finestra e' normale: il mouse arriva sempre, il sinistro
  // gira la camera e un clic fermo sull'avatar e' ancora una carezza.
  let room = false

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
  }

  function sync() {
    const want = room || !!press || !!orbit || overModel || overUI
    document.body.classList.toggle('hover-avatar', want)
    if (want === captured) return
    captured = want
    if (api && api.setMouseCapture) api.setMouseCapture(want)
  }

  function check(x, y) {
    if (press || orbit) return
    if (!inside(x, y)) {
      overModel = false
      overUI = false
    } else {
      const el = document.elementFromPoint(x, y)
      overUI = !!(el && el.closest(UI_SELECTOR))
      if (probe) {
        const hit = probe(x, y)
        if (hit === true || hit === false) overModel = hit
      }
    }
    sync()
  }

  /** La zona sotto un punto della pagina, se il renderer attivo la sa dire. */
  function zoneAt(x, y) {
    if (!zoneProbe) return null
    try { return zoneProbe(x, y) } catch (_) { return null }
  }

  /**
   * Un tocco: al main, e la reazione torna ai renderer con companion-touch.
   * reaction null: nessuna (troppo presto, o e' girato di spalle); { off:
   * true }: tocchi spenti nelle Impostazioni, vale il sorriso di sempre.
   */
  function touch(zone, kind) {
    const send = (reaction) => window.dispatchEvent(new CustomEvent('companion-touch', { detail: { zone, kind, reaction } }))
    if (!zone || !api || !api.touch) { if (kind === 'poke') send({ off: true }); return }
    const speaking = !!(window.CompanionVoice && window.CompanionVoice.isSpeaking())
    api.touch(zone, kind, speaking).then(send, () => { if (kind === 'poke') send({ off: true }) })
  }

  // Carezza: il cursore che va avanti e indietro sulla testa, senza tasti.
  function feedRub(e) {
    if (press || orbit || e.buttons !== 0 || !overModel) { rub.reset(); return }
    const zone = zoneAt(e.clientX, e.clientY)
    if (rub.feed(e.screenX, performance.now(), zone === 'head' || zone === 'face')) touch(zone, 'pat')
  }

  // Con la finestra che ignora il mouse arrivano solo i movimenti (forward).
  window.addEventListener('mousemove', (e) => { check(e.clientX, e.clientY); feedRub(e) })
  document.addEventListener('mouseleave', () => { if (!press && !orbit) { overModel = false; overUI = false; sync() } })
  // Il cursore dal main copre il caso in cui esce senza che la pagina lo veda.
  // __companionTest lo imposta audit.mjs: il mouse vero non deve interferire.
  if (api && api.onCursor) api.onCursor((c) => {
    if (window.__companionTest) return
    if (c && !inside(c.x, c.y)) check(c.x, c.y)
  })

  layer.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2 || (room && e.button === 0)) {
      // Il centrale non deve avviare lo scorrimento automatico.
      if (e.button === 1) e.preventDefault()
      orbit = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, button: e.button, moved: false, menu: false }
      try { layer.setPointerCapture(e.pointerId) } catch (_) {}
      sync()
      return
    }
    if (e.button !== 0) return
    const p = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, t: performance.now(), dragging: false, timer: null }
    // Tenuto fermo: nessun pointermove arriva, quindi lo decide un timer.
    p.timer = setTimeout(() => { if (press === p && Touch.pressAction(performance.now() - p.t, 0) === 'drag') startDragging(p) }, Touch.PRESS.PICKUP_MS)
    press = p
    try { layer.setPointerCapture(e.pointerId) } catch (_) {}
    sync()
  })

  function startDragging(p) {
    if (p.dragging) return
    p.dragging = true
    clearTimeout(p.timer)
    if (window.__companionTest) window.__dragStarts = (window.__dragStarts || 0) + 1
    if (api && api.startDrag) api.startDrag()
  }

  layer.addEventListener('pointermove', (e) => {
    if (orbit && !orbit.moved && Touch.movedBeyondClick(Math.hypot(e.screenX - orbit.sx, e.screenY - orbit.sy))) orbit.moved = true
    if (!press || press.dragging) return
    const distance = Math.hypot(e.screenX - press.sx, e.screenY - press.sy)
    if (Touch.pressAction(performance.now() - press.t, distance) === 'drag') startDragging(press)
  })

  /** Clic sull'avatar: il punto e' quello premuto, dove l'utente mirava. */
  function poke(x, y) {
    const zone = zoneAt(x, y)
    if (window.__companionTest) {
      window.__pokes = (window.__pokes || 0) + 1
      window.__lastPokeZone = zone
    }
    window.dispatchEvent(new CustomEvent('companion-poke', { detail: { x, y, zone } }))
    touch(zone, 'poke')
  }

  // Con __companionTest (audit.mjs) il menu nativo non si apre: si contano
  // le aperture, che l'audit controlla.
  function openMenu() {
    if (window.__companionTest) { window.__menuOpened = (window.__menuOpened || 0) + 1; return }
    if (api && api.showMenu) api.showMenu()
  }

  /** Rilascio del destro o del centrale. */
  function releaseOrbit(e) {
    const o = orbit
    orbit = null
    if (o && e && e.type === 'pointerup') {
      if (o.button === 2) {
        if (o.menu) { if (!o.moved) openMenu() }
        else if (o.moved) skipMenuUntil = Date.now() + 500
      } else if (o.button === 0) {
        if (!o.moved && overModel) poke(o.cx, o.cy)
      } else if (!o.moved) {
        const now = Date.now()
        if (now - lastMiddleUp < DOUBLE_CLICK_MS) {
          lastMiddleUp = 0
          window.dispatchEvent(new CustomEvent('companion-camera-reset'))
        } else lastMiddleUp = now
      }
    }
    if (e && 'clientX' in e) check(e.clientX, e.clientY)
    else sync()
  }

  function release(e) {
    if (orbit && (!e || e.type !== 'pointerup' || e.button === orbit.button)) { releaseOrbit(e); return }
    if (!press) return
    const p = press
    press = null
    clearTimeout(p.timer)
    if (p.dragging) { if (api && api.endDrag) api.endDrag() }
    else if (e && e.type === 'pointerup') poke(p.cx, p.cy)
    if (e && 'clientX' in e) check(e.clientX, e.clientY)
    else sync()
  }
  layer.addEventListener('pointerup', release)
  layer.addEventListener('pointercancel', release)
  // Perso il focus a meta' presa (Alt+Tab, un dialogo): si posa l'avatar.
  window.addEventListener('blur', () => release(null))

  layer.addEventListener('dblclick', () => {
    // Nella stanza il doppio clic conta solo sull'avatar: il resto e' scena.
    if (room && !overModel) return
    if (api && api.toggleChat) api.toggleChat()
  })

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (orbit && orbit.button === 2) { orbit.menu = true; return }
    if (Date.now() < skipMenuUntil) { skipMenuUntil = 0; return }
    openMenu()
  })

  window.CompanionInput = {
    /** Il renderer attivo registra come sapere se un punto e' sull'avatar. */
    setProbe(fn) { probe = typeof fn === 'function' ? fn : null; overModel = false; sync() },
    /** ...e quale zona del corpo c'e' sotto un punto (touch.js, ZONES). */
    setZoneProbe(fn) { zoneProbe = typeof fn === 'function' ? fn : null; rub.reset() },
    /** Per audit.mjs: la zona sotto un punto, come la vede un clic. */
    zoneAt,
    /** Risultato arrivato in ritardo (3D: lettura del pixel al frame dopo). */
    setOverModel(hit) {
      if (press || overModel === hit) return
      overModel = hit
      sync()
    },
    isPressed() { return !!press },
    /** Destro o centrale premuto: la camera sta ruotando. */
    isOrbiting() { return !!orbit },
    /** Stanza accesa o spenta (companion-3d.js, dalla modalita' del main). */
    setRoom(on) {
      room = on === true
      orbit = null
      if (press) clearTimeout(press.timer)
      press = null
      sync()
    },
  }
})()
