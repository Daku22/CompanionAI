// companion-input.js — il mouse sull'avatar, come in Mate Engine.
//
// - Sui pixel vuoti della finestra i clic passano alle finestre sotto: il main
//   parte con setIgnoreMouseEvents(true, { forward: true }) e qui si chiede di
//   catturare il mouse solo quando il cursore sta sull'avatar o su un pulsante.
// - Premere sull'avatar e muovere lo prende in braccio: il main sposta la
//   finestra seguendo il cursore e manda la velocita' (drag-motion).
// - Clic: una piccola reazione. Doppio clic: la chat. Tasto destro: il menu.
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

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
  }

  function sync() {
    const want = !!press || overModel || overUI
    document.body.classList.toggle('hover-avatar', want)
    if (want === captured) return
    captured = want
    if (api && api.setMouseCapture) api.setMouseCapture(want)
  }

  function check(x, y) {
    if (press) return
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
  document.addEventListener('mouseleave', () => { if (!press) { overModel = false; overUI = false; sync() } })
  // Il cursore dal main copre il caso in cui esce senza che la pagina lo veda.
  // __companionTest lo imposta audit.mjs: il mouse vero non deve interferire.
  if (api && api.onCursor) api.onCursor((c) => {
    if (window.__companionTest) return
    if (c && !inside(c.x, c.y)) check(c.x, c.y)
  })

  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    press = { sx: e.screenX, sy: e.screenY, dragging: false }
    try { layer.setPointerCapture(e.pointerId) } catch (_) {}
    sync()
  })

  layer.addEventListener('pointermove', (e) => {
    if (!press || press.dragging) return
    if (Math.hypot(e.screenX - press.sx, e.screenY - press.sy) < DRAG_THRESHOLD_PX) return
    press.dragging = true
    if (api && api.startDrag) api.startDrag()
  })

  function release(e) {
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

  layer.addEventListener('dblclick', () => { if (api && api.toggleChat) api.toggleChat() })

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (api && api.showMenu) api.showMenu()
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
  }
})()
