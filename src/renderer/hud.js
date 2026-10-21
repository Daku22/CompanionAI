// hud.js — la barra a pillola e le capsule attorno al companion (Blocco 9b).
//
// La finestra e' trasparente e lascia passare i clic: il mouse si cattura solo
// sopra i comandi (come companion-input.js per l'avatar), e il main sa cosi'
// che il mouse e' sull'HUD e lo tiene aperto. Il main manda dov'e' il
// companion dentro la finestra, il suo stato, e se mostrarsi o no.

(function () {
  const api = window.companion
  const root = document.documentElement
  const CONTROLS = '.capsule, .pill, #name'
  let capturing = false
  let unread = 0

  function setCapture(on) {
    if (on === capturing) return
    capturing = on
    if (api && api.hudCapture) api.hudCapture(on)
  }
  window.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    setCapture(!!(el && el.closest(CONTROLS)))
  })
  document.addEventListener('mouseleave', () => setCapture(false))

  // Umore: da 0 (giu') a 1 (su), come nella chat (faces.js).
  const moodValue = window.CompanionFaces.moodValue
  const ring = (id, value, title) => {
    const el = document.getElementById(id)
    el.style.setProperty('--value', String(Math.max(0, Math.min(1, value))))
    el.title = title
  }

  function show(state) {
    const s = state || {}
    if (s.layout) {
      const a = s.layout.avatar
      root.style.setProperty('--av-x', a.x + 'px')
      root.style.setProperty('--av-y', a.y + 'px')
      root.style.setProperty('--av-w', a.width + 'px')
      root.style.setProperty('--av-h', a.height + 'px')
      document.body.classList.toggle('pill-below', s.layout.pill === 'below')
      document.body.classList.toggle('pill-above', s.layout.pill === 'above')
    }
    if ('shown' in s) {
      document.body.classList.toggle('shown', !!s.shown)
      if (!s.shown) setCapture(false)
    }
    if (s.name !== undefined) document.getElementById('name').textContent = s.name
    if (s.mood) {
      const m = s.mood
      ring('r-mood', moodValue(m), 'Umore: ' + (m.label || '—'))
      ring('r-energy', m.energy || 0, 'Energia: ' + Math.round((m.energy || 0) * 100) + '%')
      const r = m.rapport
      if (r) ring('r-bond', (r.level + 1) / r.levels, 'Rapporto: ' + r.label + (r.days ? ' · ' + r.days + ' giorni insieme' : ''))
      // Fame e sete (Blocco 10a): l'anello pieno e' la pancia piena.
      const needs = window.CompanionFaces.needsRings(m.needs)
      document.body.classList.toggle('needs', !!needs)
      for (const kind of ['hunger', 'thirst']) {
        const el = document.getElementById('r-' + kind)
        const n = needs && needs.find(x => x.kind === kind)
        el.hidden = !n
        if (!n) continue
        ring('r-' + kind, n.value, n.title)
        el.classList.toggle('low', n.low)
      }
    }
    if (s.mic) {
      const b = document.getElementById('b-mic')
      b.classList.toggle('listening', !!s.mic.listening)
      b.title = !s.mic.enabled ? 'Microfono spento: accendilo nelle Impostazioni' : s.mic.handsFree ? 'Mani libere: ti ascolto. Clic per spegnere' : 'Mani libere: parla senza premere niente'
      b.setAttribute('aria-pressed', String(!!s.mic.handsFree))
    }
    if ('paused' in s) {
      const b = document.getElementById('b-pause')
      b.classList.toggle('on', !!s.paused)
      b.title = s.paused ? 'In pausa: clic per riprendere' : 'Pausa: zitto e fermo'
    }
    if ('group' in s) document.getElementById('b-group').hidden = !s.group
    if ('unread' in s || 'group' in s) {
      if ('unread' in s) unread = s.unread
      // Il numero sta sul tasto della chat di gruppo se c'e', se no su quello della chat singola.
      const groupShown = !document.getElementById('b-group').hidden
      for (const u of document.querySelectorAll('[data-unread]')) {
        const onGroup = !!u.closest('#b-group')
        u.hidden = !unread || onGroup !== groupShown
        u.textContent = unread > 9 ? '9+' : String(unread || '')
      }
    }
  }
  if (api && api.onHudState) api.onHudState(show)

  for (const b of document.querySelectorAll('[data-cmd]')) {
    b.addEventListener('click', () => { if (api && api.hudAction) api.hudAction(b.dataset.cmd) })
  }
  // La maniglia prende il companion in braccio, come prenderlo direttamente.
  document.getElementById('grip').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (api && api.hudAction) api.hudAction('drag')
  })
})()
