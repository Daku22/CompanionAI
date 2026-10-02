// companion-live2d.js — avatar Live2D (Cubism 3, 4 e 5).
//
// Quale avatar mostrare lo decide companion-3d.js, che chiama
// loadLive2DAvatar() per i modelli .model3.json. Il rendering lo fa
// untitled-pixi-live2d-engine (MIT, con il Cubism Framework di Live2D) sopra
// Pixi 8, con il Cubism Core che l'utente scarica dalle Impostazioni
// (live2d-core.js nel main, servito da live2d://).
//
// Live2D ha una sua applicazione Pixi, in #live2d-mount, creata al primo
// avatar Live2D: la libreria va registrata (Live2DPlugin) prima di creare il
// renderer, e si puo' caricare solo dopo il Core. L'app del 2D a strip
// (companion-2d.js) parte invece subito, quando il Core magari non c'e'.
//
// Cosa fa il modello:
// - i gesti della chat diventano i suoi gruppi di movimenti, e l'umore le sue
//   espressioni (live2d-map.js, con le scelte delle Impostazioni sopra);
// - sbatte le palpebre, respira e ha la fisica da solo (la libreria);
// - lo sguardo segue il mouse (focus), la bocca segue la voce;
// - preso in braccio penzola come il 2D; un clic e' un tocco.

(function () {
  const api = window.companion
  const CORE_URL = 'live2d://core/live2dcubismcore.min.js'
  const ENGINE_URL = 'vendor/pixi-live2d.min.js'
  const mount = document.getElementById('live2d-mount')
  const L2D = window.Live2DMap

  let ready = null       // avvio di Core, libreria e app, una volta
  let l2dApp = null
  let shadow = null
  let model = null
  let baseHeight = 1     // altezza del modello a scala 1
  let info = null        // { id, groups, expressions, motions, expressionMap }
  let active = false
  let loadSeq = 0
  let pending = null     // avatar in attesa del Cubism Core
  let lastDelta = 1 / 60
  let mood = null
  let mouthForm = 0
  let mouthApplied = 0   // l'ultima apertura data alla bocca (per le prove)
  const state = { dragging: false, perched: false }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = resolve
      s.onerror = () => { s.remove(); reject(new Error('script non caricato: ' + src)) }
      document.head.appendChild(s)
    })
  }

  function coreMissing() {
    const e = new Error('per gli avatar Live2D scarica il Cubism Core (Impostazioni, scheda Live2D)')
    e.coreMissing = true
    return e
  }

  /** Core, libreria e applicazione Pixi di Live2D: una volta sola. */
  function start() {
    if (ready) return ready
    ready = (async () => {
      if (!window.Live2DCubismCore) {
        try { await loadScript(CORE_URL) } catch (_) { throw coreMissing() }
        if (!window.Live2DCubismCore) throw coreMissing()
      }
      if (!(window.PIXI && PIXI.live2d)) await loadScript(ENGINE_URL)
      // Pixi 8 caricherebbe le texture in un Web Worker creato da un blob:,
      // che la CSP (giustamente) blocca: le carica nella pagina.
      PIXI.Assets.setPreferences({ preferWorkers: false })
      PIXI.extensions.add(PIXI.live2d.Live2DPlugin)
      const app = new PIXI.Application()
      await app.init({
        resizeTo: window, backgroundAlpha: 0, antialias: true,
        resolution: window.devicePixelRatio || 1, autoDensity: true, preference: 'webgl',
      })
      // 60 fps: i movimenti di Live2D sono fluidi, e l'app si ferma quando
      // l'avatar non e' Live2D.
      app.ticker.maxFPS = 60
      mount.appendChild(app.canvas)
      // L'ombra ai piedi: e' anche l'ancora per sedersi sulle finestre.
      shadow = new PIXI.Graphics().ellipse(0, 0, 28, 6).fill({ color: 0x000000, alpha: 1 })
      shadow.alpha = 0.35
      app.stage.addChild(shadow)
      app.ticker.add(tick)
      app.ticker.stop()
      l2dApp = app
    })().catch((error) => { ready = null; throw error })
    return ready
  }

  // ── Disegno a ogni frame ──────────────────────────────────────────────────
  const sway = window.CompanionSway.createSway()
  let dragVel = { vx: 0, vy: 0 }
  if (api && api.onDragMotion) api.onDragMotion((v) => { if (v) dragVel = { vx: +v.vx || 0, vy: +v.vy || 0 } })
  let seatKey = ''
  let seatAt = 0

  function tick(ticker) {
    if (!model) return
    lastDelta = ticker.deltaMS / 1000
    const room = document.body.classList.contains('mode-room')
    const width = window.innerWidth - (window.__roomInset || 0)
    const height = window.innerHeight
    // Come il 2D: nella stanza l'avatar non riempie la finestra.
    const targetH = Math.min(height * (room ? 0.62 : 0.86), window.innerWidth * 2.2)
    const scale = targetH / baseHeight
    model.scale.set(scale)
    const x = width / 2
    const ground = height - 8
    shadow.x = x
    shadow.y = height - 12
    if (state.dragging) {
      // Penzola appeso per la testa: perno in alto, spinto dalla velocita'
      // della finestra (sway.js), come lo sprite 2D.
      const { side } = sway.update(lastDelta, dragVel.vx, dragVel.vy)
      const H = targetH * 1.02
      const theta = side
      model.rotation = theta
      model.x = x - H * Math.sin(theta)
      model.y = ground - H + H * Math.cos(theta) - 22
      shadow.alpha = 0.5
    } else {
      model.rotation = 0
      model.x = x
      model.y = ground - touchHop() - danceBounce()
      shadow.alpha = 0.35
    }
    // L'ancora per la seduta su finestre e taskbar, come reportSeat2D.
    if (!state.dragging && api && api.setSeatAnchor) {
      const key = Math.round(window.innerWidth / 2) + ',' + Math.round(height - 12)
      const now = performance.now()
      if (key !== seatKey || now - seatAt > 2000) {
        seatKey = key
        seatAt = now
        api.setSeatAnchor({ x: Math.round(window.innerWidth / 2), feet: Math.round(height - 12), seat: Math.round(height - 12) })
      }
    }
  }

  // Bocca con la voce, e un sorriso o un broncio leggero con l'umore: dopo i
  // movimenti, prima che il modello si aggiorni.
  function beforeModelUpdate() {
    if (!model) return
    const internal = model.internalModel
    const core = internal.coreModel
    const open = window.CompanionVoice ? window.CompanionVoice.mouth(lastDelta) : 0
    mouthApplied = open
    if (open > 0) {
      for (const id of info.lipIds) {
        try { core.setParameterValueById(internal.getIdSafe(id), Math.min(1, open * 1.2)) } catch (_) { /* parametro assente */ }
      }
    }
    if (mouthForm) {
      try { core.addParameterValueById(internal.getIdSafe('ParamMouthForm'), mouthForm) } catch (_) {}
    }
    applyTouchParams(internal, core)
  }

  // ── Test del punto: sui triangoli delle mesh visibili ─────────────────────
  window.hitTestLive2D = (x, y) => {
    if (!model || !active) return false
    const internal = model.internalModel
    const core = internal.coreModel
    const p = model.toModelPosition(new PIXI.Point(x, y))
    const count = core.getDrawableCount()
    for (let i = 0; i < count; i++) {
      if (!core.getDrawableDynamicFlagIsVisible(i) || core.getDrawableOpacity(i) < 0.1) continue
      if (L2D.pointInMesh(p.x, p.y, internal.getDrawableVertices(i), core.getDrawableVertexIndices(i))) return true
    }
    return false
  }

  // ── Gesti ed espressioni ──────────────────────────────────────────────────
  function play(gesture) {
    if (!model || !info) return false
    const group = info.motions[gesture]
    if (!group) return false
    model.motion(group, undefined, PIXI.live2d.MotionPriority.FORCE)
    return true
  }

  function applyMood() {
    if (!model || !info) return
    const name = mood && mood.dominant
    const expression = name ? info.expressionMap[name] : null
    if (expression) model.expression(expression)
    else if (info.expressions.length) model.expression()   // nessuna: torna al viso di base
    // Senza espressioni il modello ha comunque una bocca: allegria e affetto
    // la piegano in su, malinconia e fastidio in giu'.
    const strength = name && mood.emotions ? Math.min(1, (mood.emotions[name] || 0) * 1.5) : 0
    mouthForm = expression ? 0 : name === 'joy' || name === 'affection' ? 0.5 * strength
      : name === 'sadness' || name === 'annoyance' ? -0.4 * strength : 0
  }
  if (api && api.onMoodChanged) api.onMoodChanged((m) => { mood = m; applyMood() })
  if (api && api.getMood) api.getMood().then((m) => { mood = m; applyMood() }).catch(() => {})

  if (api && api.onTriggerAnimation) {
    api.onTriggerAnimation((action) => {
      if (!active || !action || state.dragging) return
      const key = action.animation || action.type || 'idle'
      if (key === 'idle' || key === 'none' || key === 'walk-to' || key === 'run-to') return
      play(key)
    })
  }

  // ── Tocchi (Blocco 5b) ────────────────────────────────────────────────────
  // La zona: prima le aree di tocco del modello (HitAreas, di solito Head e
  // Body), poi l'altezza del punto nel modello. Un modello alto e stretto e'
  // una figura intera, uno piu' largo e' un busto e non ha basso ventre.
  window.zoneLive2D = (x, y) => {
    if (!model || !active) return null
    try {
      const hits = model.hitTest(x, y) || []
      if (hits.some(h => /head|face/i.test(h))) {
        const zone = window.CompanionTouch.zoneFromHeight(heightIn(y), tableFor())
        return zone === 'face' ? 'face' : 'head'
      }
    } catch (_) { /* modello senza HitAreas */ }
    return window.CompanionTouch.zoneFromHeight(heightIn(y), tableFor())
  }
  function heightIn(y) {
    const b = model.getBounds()
    const rect = b.rectangle || b
    return rect.height > 0 ? (y - rect.y) / rect.height : NaN
  }
  function tableFor() {
    const b = model.getBounds()
    const rect = b.rectangle || b
    return rect.height >= rect.width * 1.8 ? 'full' : 'bust'
  }

  // Reazione senza un gruppo di movimenti adatto: testa, corpo, occhi e
  // guance mossi a mano, come offset sopra il movimento in corso.
  let touchFx = null   // { slot, start, ms }
  const easeIn = (v) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c) }
  function touchParams(slot, p, tt) {
    const env = easeIn(p / 0.15) * easeIn((1 - p) / 0.2)
    const jolt = p < 0.1 ? p / 0.1 : Math.exp(-(p - 0.1) * 5)
    switch (slot) {
      case 'pat': return { ParamAngleZ: 12 * env, ParamAngleY: -6 * env, eyesClosed: 0.8 * env, ParamCheek: 0.5 * env }
      case 'flinch': return { ParamAngleY: 10 * jolt, ParamAngleX: -8 * jolt }
      case 'giggle': return { ParamAngleZ: 6 * Math.sin(tt * 25) * env, ParamBodyAngleX: 4 * Math.sin(tt * 25) * env, eyesClosed: 0.6 * env }
      case 'shy': return { ParamAngleX: 20 * env, ParamAngleY: -10 * env, ParamCheek: env }
      case 'scold': return { ParamAngleX: 15 * Math.sin(tt * 12) * (1 - p), ParamAngleY: -5 * env }
      case 'turnaway': return { ParamAngleX: 30 * env, ParamBodyAngleX: 10 * env, ParamAngleY: -8 * env }
      default: return null
    }
  }
  function touchProgress() {
    if (!touchFx) return null
    const ms = performance.now() - touchFx.start
    if (ms >= touchFx.ms) { touchFx = null; return null }
    return { p: ms / touchFx.ms, tt: ms / 1000 }
  }
  function touchHop() {
    const at = touchFx && touchFx.slot === 'hop' ? touchProgress() : null
    return at ? 24 * Math.sin(Math.PI * Math.min(1, at.p / 0.7)) * (at.p < 0.7 ? 1 : 0) : 0
  }
  // ── Ballo con la musica (Blocco 5c) ───────────────────────────────────────
  // Sempre i parametri a tempo (testa e corpo da una parte all'altra ogni due
  // battute, un saltello sulla battuta); il gruppo "dance" del modello, se
  // c'e', parte all'inizio del ballo.
  function danceNow() {
    const d = window.CompanionDance && window.CompanionDance.state()
    return d && d.dancing && !state.dragging ? d : null
  }
  function danceBounce() {
    const d = danceNow()
    return d && !state.perched ? 8 * Math.abs(Math.cos(Math.PI * d.phase)) * d.amp : 0
  }
  function applyDanceParams(internal, core) {
    const d = danceNow()
    if (!d) return
    const sway = Math.sin(Math.PI * (d.count + d.phase))
    const params = { ParamAngleZ: 8 * sway * d.amp, ParamAngleX: 6 * sway * d.amp, ParamBodyAngleX: 6 * sway * d.amp, ParamAngleY: -4 * Math.abs(Math.cos(Math.PI * d.phase)) * d.amp }
    for (const [id, value] of Object.entries(params)) {
      try { core.addParameterValueById(internal.getIdSafe(id), value) } catch (_) { /* parametro assente */ }
    }
  }
  window.addEventListener('companion-dance', (e) => {
    if (active && model && e.detail && e.detail.on && !state.dragging) play('dance')
  })

  // ── Sbircia dal bordo (Blocco 5d) ─────────────────────────────────────────
  // Oltre il bordo dello schermo (companion-peek.js): il gruppo "wave" del
  // modello ogni tanto, e la testa girata e inclinata verso lo schermo. Il
  // bordo cade sul centro della testa, in alto nel modello.
  const PEEK_CUT_L2D = 0       // il bordo sul centro della testa: se ne vede meta'
  const PEEK_WAVE_MS = 6000
  let peekSide = null
  let peekWaveTimer = null
  window.addEventListener('companion-peek', (e) => {
    const d = e.detail || {}
    peekSide = d.side || null
    clearInterval(peekWaveTimer)
    peekWaveTimer = null
    if (!active || !model || state.dragging) return
    if (peekSide) {
      play('wave')
      peekWaveTimer = setInterval(() => { if (peekSide && !state.dragging) play('wave') }, PEEK_WAVE_MS)
    } else if (d.reason === 'cursor' || d.reason === 'dblclick') play('happy')
  })
  function applyPeekParams(internal, core) {
    if (!peekSide || state.dragging) return
    // Fuori a destra guarda verso sinistra, dentro lo schermo.
    const s = peekSide === 'right' ? -1 : 1
    const params = { ParamAngleX: 18 * s, ParamAngleZ: 10 * s, ParamBodyAngleX: 4 * s }
    for (const [id, value] of Object.entries(params)) {
      try { core.addParameterValueById(internal.getIdSafe(id), value) } catch (_) { /* parametro assente */ }
    }
  }

  /** Dove tagliare e dove sta la testa, in px della finestra. */
  window.peekMeasureLive2D = (side) => {
    if (!model || !active) return null
    const b = model.getBounds()
    const rect = b.rectangle || b
    const rows = window.CompanionTouch.HEIGHT_TABLES[tableFor()]
    const face = (rows.find(([zone]) => zone === 'face') || [null, 0.24])[1]
    const r = face / 2 * rect.height
    const head = { x: rect.x + rect.width / 2, y: rect.y + r }
    return { cut: Math.round(head.x + (side === 'right' ? 1 : -1) * PEEK_CUT_L2D * r), head: { x: Math.round(head.x), y: Math.round(head.y) } }
  }

  function applyTouchParams(internal, core) {
    applyPeekParams(internal, core)
    const at = touchProgress()
    if (!at) { applyDanceParams(internal, core); return }
    const params = touchParams(touchFx.slot, at.p, at.tt)
    if (!params) return
    for (const [id, value] of Object.entries(params)) {
      if (id === 'eyesClosed') continue
      try { core.addParameterValueById(internal.getIdSafe(id), value) } catch (_) { /* parametro assente */ }
    }
    if (params.eyesClosed) {
      for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
        try { core.multiplyParameterValueById(internal.getIdSafe(id), 1 - params.eyesClosed) } catch (_) {}
      }
    }
  }

  // Espressione della reazione: le espressioni VRM diventano emozioni
  // dell'umore, e l'abbinamento del modello dice quale espressione mostrare.
  const EXPRESSION_EMOTION = { happy: 'joy', surprised: 'curiosity', angry: 'annoyance', relaxed: 'calm' }
  let expressionTimer = null
  function showReactionExpression(name, ms) {
    const expression = info && info.expressionMap[EXPRESSION_EMOTION[name]]
    if (!expression) return
    model.expression(expression)
    clearTimeout(expressionTimer)
    expressionTimer = setTimeout(applyMood, ms)
  }

  // La reazione decisa dal main (touch-react.js).
  window.addEventListener('companion-touch', (e) => {
    if (!active || state.dragging || !model) return
    const r = e.detail && e.detail.reaction
    if (!r) return
    if (r.off) { play('click') || play('happy'); return }
    if (!play(r.slot)) touchFx = { slot: r.slot, start: performance.now(), ms: Math.max(600, r.ms) }
    showReactionExpression(r.expression, r.ms)
    if (r.line && window.showBubble) window.showBubble(r.line, 2600)
  })

  if (api && api.onWindowDragState) {
    api.onWindowDragState(({ dragging }) => {
      if (!active) return
      state.dragging = !!dragging
      if (dragging) sway.reset()
    })
  }

  // Lo sguardo segue il mouse; senza "segui il mouse" guarda avanti.
  if (api && api.onCursor) {
    api.onCursor((c) => {
      if (!active || !model || window.__companionTest) return
      const focusAt = (c && c.follow) ? c : { x: window.innerWidth / 2, y: window.innerHeight * 0.3 }
      model.focus(focusAt.x, focusAt.y)
    })
  }

  // ── Caricamento ───────────────────────────────────────────────────────────
  function unloadModel() {
    if (!model) return
    try { model.internalModel.off('beforeModelUpdate', beforeModelUpdate) } catch (_) {}
    l2dApp.stage.removeChild(model)
    model.destroy({ children: true })
    model = null
    info = null
  }

  /** Abbinamenti di questo modello: la proposta dai nomi, con le scelte dell'utente sopra. */
  function choicesFor(id, cfg, groups, expressions) {
    const chosen = (cfg && cfg.live2dChoices && cfg.live2dChoices[id]) || {}
    return {
      motions: L2D.applyChoices(L2D.proposeMotionMap(groups), chosen.motions, groups),
      expressionMap: L2D.applyChoices(L2D.proposeExpressionMap(expressions), chosen.expressions, expressions),
    }
  }

  /**
   * Mostra un avatar Live2D.
   * @param {{ id: string, name: string, url: string }} avatar
   */
  window.loadLive2DAvatar = async (avatar) => {
    const seq = ++loadSeq
    try {
      await start()
    } catch (error) {
      if (error.coreMissing) pending = avatar
      throw error
    }
    const next = await PIXI.live2d.Live2DModel.from(avatar.url, { autoHitTest: false, autoFocus: false, ticker: l2dApp.ticker })
    if (seq !== loadSeq) { next.destroy({ children: true }); return }
    unloadModel()
    pending = null
    model = next
    model.anchor.set(0.5, 1)
    model.scale.set(1)
    baseHeight = Math.max(1, model.height)
    l2dApp.stage.addChild(model)

    const settings = model.internalModel.settings
    const groups = Object.keys(settings.motions || {})
    const expressions = (settings.expressions || []).map(e => e && (e.Name || e.name)).filter(Boolean)
    const lipIds = (model.internalModel.motionManager && model.internalModel.motionManager.lipSyncIds) || []
    let cfg = null
    try { cfg = await api.getConfig() } catch (_) { /* proposta senza scelte */ }
    info = { id: avatar.id, groups, expressions, lipIds: lipIds.length ? lipIds : ['ParamMouthOpenY'], ...choicesFor(avatar.id, cfg, groups, expressions) }
    model.internalModel.on('beforeModelUpdate', beforeModelUpdate)

    // Al posto del 2D a strip: la sua app si ferma e il suo canvas sparisce.
    if (window.unload2DAvatar) window.unload2DAvatar()
    if (window.set2DActive) window.set2DActive(false)
    document.getElementById('pixi-mount').style.display = 'none'
    mount.style.display = 'block'
    active = true
    state.dragging = false
    l2dApp.ticker.start()
    window.CompanionInput.setProbe(window.hitTestLive2D)
    window.CompanionInput.setZoneProbe(window.zoneLive2D)
    if (window.CompanionPeek) window.CompanionPeek.setMeasure(window.peekMeasureLive2D)
    applyMood()
    play('wave')
    // Gruppi ed espressioni alle Impostazioni, per la tabella degli abbinamenti.
    if (api && api.live2dReportModel) api.live2dReportModel({ id: avatar.id, name: avatar.name, groups, expressions })
  }

  /** Toglie l'avatar Live2D (si passa a un 2D a strip o a un 3D). */
  window.unloadLive2DAvatar = () => {
    loadSeq++
    pending = null
    if (!active && !model) return
    active = false
    unloadModel()
    mount.style.display = 'none'
    if (l2dApp) l2dApp.ticker.stop()
  }

  // Scelte cambiate nelle Impostazioni: valgono subito per il modello in vista.
  if (api && api.onLive2DChoices) {
    api.onLive2DChoices((all) => {
      if (!model || !info) return
      Object.assign(info, choicesFor(info.id, { live2dChoices: all }, info.groups, info.expressions))
      applyMood()
    })
  }

  // Il Cubism Core arrivato dalle Impostazioni: l'avatar Live2D in attesa si mostra.
  if (api && api.onLive2DStatus) {
    api.onLive2DStatus((s) => {
      if (s && s.installed && pending) {
        const avatar = pending
        window.loadLive2DAvatar(avatar).catch(e => console.error('Avatar Live2D non caricato:', e))
      }
    })
  }

  // Solo per le prove (audit): stato del modello.
  window.__live2dTest = () => ({
    active, loaded: !!model, groups: info ? info.groups : [], motions: info ? info.motions : null,
    expressions: info ? info.expressions : [], scale: model ? model.scale.x : 0,
    bounds: model ? (({ x, y, width, height }) => ({ x, y, width, height }))(model.getBounds().rectangle) : null,
    // La libreria rimette i parametri come prima del frame dopo averlo
    // disegnato: si legge l'apertura applicata, non il parametro.
    mouth: model ? mouthApplied : null, lipIds: info ? info.lipIds : [],
    motion: model ? (model.internalModel.motionManager.state.currentGroup || model.internalModel.motionManager.state.reservedGroup || null) : null,
    // Reazione ai tocchi mossa a mano (senza un gruppo adatto), e la tabella delle zone.
    touch: touchFx ? touchFx.slot : null, table: model ? tableFor() : null,
    dancing: !!danceNow(), y: model ? model.y : null, peek: peekSide,
  })
})()
