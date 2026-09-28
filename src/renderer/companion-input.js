// companion-input.js — il mouse sull'avatar, come in Mate Engine.
//
// - Sui pixel vuoti della finestra i clic passano alle finestre sotto: il main
//   parte con setIgnoreMouseEvents(true, { forward: true }) e qui si chiede di
//   catturare il mouse solo quando il cursore sta sull'avatar o su un pulsante.
// - Premere sull'avatar e muovere lo prende in braccio: il main sposta la
//   finestra seguendo il cursore e manda la velocita' (drag-motion).
// - Clic: una piccola reazione. Doppio clic: la chat. Tasto destro: il menu.
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
  const DRAG_THRESHOLD_PX = 4

  /** @type {((x: number, y: number) => boolean | null) | null} */
  let probe = null
  let overModel = false
  let overUI = false
  let captured = null
  /** @type {{ sx: number, sy: number, dragging: boolean } | null} */
  let press = null
  // Destro o centrale premuto: la camera ruota. menu: il contextmenu e'
  // arrivato a tasto ancora giu' (su Windows arriva dopo il rilascio).
  /** @type {{ sx: number, sy: number, button: number, moved: boolean, menu: boolean } | null} */
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

  // Con la finestra che ignora il mouse arrivano solo i movimenti (forward).
  window.addEventListener('mousemove', (e) => check(e.clientX, e.clientY))
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
      orbit = { sx: e.screenX, sy: e.screenY, button: e.button, moved: false, menu: false }
      try { layer.setPointerCapture(e.pointerId) } catch (_) {}
      sync()
      return
    }
    if (e.button !== 0) return
    press = { sx: e.screenX, sy: e.screenY, dragging: false }
    try { layer.setPointerCapture(e.pointerId) } catch (_) {}
    sync()
  })

  layer.addEventListener('pointermove', (e) => {
    if (orbit && !orbit.moved && Math.hypot(e.screenX - orbit.sx, e.screenY - orbit.sy) >= DRAG_THRESHOLD_PX) orbit.moved = true
    if (!press || press.dragging) return
    if (Math.hypot(e.screenX - press.sx, e.screenY - press.sy) < DRAG_THRESHOLD_PX) return
    press.dragging = true
    if (api && api.startDrag) api.startDrag()
  })

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
        if (!o.moved && overModel) window.dispatchEvent(new CustomEvent('companion-poke'))
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
    const wasDragging = press.dragging
    press = null
    if (wasDragging) { if (api && api.endDrag) api.endDrag() }
    else if (e && e.type === 'pointerup') window.dispatchEvent(new CustomEvent('companion-poke'))
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
    setRoom(on) { room = on === true; orbit = null; press = null; sync() },
  }
})()
