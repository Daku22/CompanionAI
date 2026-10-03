// companion-highfive.js — il batti cinque (Blocco 5e), lato pagina.
//
// La macchina a stati sta in touch.js (createHighFive); qui le si danno il
// cursore, la sagoma dell'avatar (dal renderer attivo, setGeometry) e cio'
// che la blocca, e si parla con il main: 'offer' chiede il permesso (con i
// tocchi spenti no) e ferma la vita autonoma, 'slap' e 'missed' portano
// umore, battuta e riga per il prompt.
//
// I renderer ascoltano companion-highfive ({ state, side, reaction }) per le
// pose e leggono state() a ogni frame per la mano che segue il cursore.
// companion-input.js passa qui i clic (click(zone)): durante l'offerta un
// clic sulla mano e' lo schiaffo; nel 2D e in Live2D, senza mani da colpire,
// vale un clic sull'avatar.

(function () {
  const api = window.companion
  const Touch = window.CompanionTouch
  const TICK_MS = 50
  const TURNAWAY_BLOCK_MS = 5500

  const hf = Touch.createHighFive()
  let cursor = null
  let geometry = null          // () => { centerX, halfWidth, top, bottom } | null
  let handOnly = false         // 3D: vale solo il clic sulla mano
  let follow = 0
  let dragging = false
  let perched = false
  let dozing = false
  let blockedUntil = 0
  let shown = 'idle'           // l'ultimo stato annunciato ai renderer

  const speaking = () => !!(window.CompanionVoice && window.CompanionVoice.isSpeaking())
  const peeking = () => !!(window.CompanionPeek && window.CompanionPeek.side())
  const dancing = () => { const d = window.CompanionDance && window.CompanionDance.state(); return !!(d && d.dancing) }
  const blocked = () => dragging || perched || dozing || peeking() || dancing() || performance.now() < blockedUntil
  const overModel = () => !!(window.CompanionInput && window.CompanionInput.isOverModel && window.CompanionInput.isOverModel())

  function body() {
    try { return geometry ? geometry() : null } catch (_) { return null }
  }

  function announce(state, extra = {}) {
    shown = state
    window.dispatchEvent(new CustomEvent('companion-highfive', { detail: { state, side: hf.get().side, ...extra } }))
  }

  /** Il main sa dell'evento; per 'offer' puo' dire di no (tocchi spenti). */
  async function tell(event) {
    if (!api || !api.highFive) return event === 'offer' ? { ok: true } : null
    try { return await api.highFive(event, speaking()) } catch (_) { return null }
  }

  async function startOffer() {
    const answer = await tell('offer')
    if (hf.get().state !== 'offer') return
    if (!answer || answer.off) { hf.cancel(performance.now()); return }
    announce('offer')
  }

  async function finish(event) {
    const reaction = await tell(event)
    announce(event === 'slap' ? 'slap' : 'missed', { reaction })
  }

  function tick() {
    const now = performance.now()
    const b = body()
    const before = hf.get().state
    const r = hf.update(now, { near: Touch.nearHand(cursor, b, overModel()), blocked: blocked() })
    follow = r.side ? Touch.handFollow(cursor, b, r.side) : 0
    if (!r.changed) return
    if (r.state === 'offer') startOffer()
    else if (r.state === 'missed') finish('missed')
    else if (before === 'offer') { tell('cancel'); announce('idle') }
    else if (shown !== r.state && (r.state === 'idle' || r.state === 'cooldown')) announce(r.state)
  }
  setInterval(tick, TICK_MS)

  if (api && api.onCursor) api.onCursor((c) => { if (!window.__companionTest) cursor = c })
  if (api && api.onWindowDragState) api.onWindowDragState(({ dragging: on }) => { dragging = !!on })
  if (api && api.onPerchState) api.onPerchState((d) => { perched = !!(d && d.perched) })
  if (api && api.onTriggerAnimation) {
    api.onTriggerAnimation((action) => {
      const key = action && (action.animation || action.type)
      if (!key) return
      dozing = key === 'doze' || key === 'sleep'
      if (key !== 'highfive') return
      // Chiesto in chat, o dalla vita autonoma (idle: rispetta la pausa).
      const b = body()
      const side = cursor && b ? (cursor.x < b.centerX ? 'left' : 'right') : 'right'
      if (hf.request(performance.now(), { spontaneous: action.idle === true, side, blocked: blocked() })) startOffer()
    })
  }
  window.addEventListener('companion-touch', (e) => {
    const r = e.detail && e.detail.reaction
    if (r && r.slot === 'turnaway') blockedUntil = performance.now() + TURNAWAY_BLOCK_MS
  })

  window.CompanionHighFive = {
    /** A ogni frame, per i renderer: stato, lato della mano e quanto segue il cursore. */
    state: () => ({ ...hf.get(), follow }),
    /**
     * Il renderer attivo dice dov'e' l'avatar sullo schermo; handOnly: lo
     * schiaffo vale solo sulla mano (3D).
     */
    setGeometry(fn, options = {}) { geometry = typeof fn === 'function' ? fn : null; handOnly = options.handOnly === true },
    /** Un clic sull'avatar (companion-input.js): true se era lo schiaffo. */
    click(zone) {
      if (hf.get().state !== 'offer') return false
      const onHand = handOnly ? zone === 'hand' : !!zone
      if (!hf.click(performance.now(), onHand)) return false
      finish('slap')
      return true
    },
    /** Per l'audit: il cursore finto (con __companionTest quello vero non conta). */
    cursor(c) { cursor = c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null },
    debug: () => ({ ...hf.debug(), follow, shown, blocked: blocked(), body: body() }),
  }
})()
