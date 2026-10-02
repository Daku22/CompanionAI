// companion-dance.js — balla con la musica (Blocco 5c). Spento di base.
//
// Il main guarda nel mixer di Windows (win-audio.js) e dice se un'app
// ammessa sta suonando (music-state). Solo allora qui si apre la cattura del
// suono del PC: getDisplayMedia con l'audio in loopback (il main la concede
// solo a questa pagina e solo con il ballo acceso), la traccia video si
// ferma subito senza essere letta. Il suono passa da un passa-basso a
// 150 Hz e da beat-worklet.js, che manda un livello per blocco: niente si
// registra, niente esce dal PC. beat.js ne ricava tempo, fase ed energia.
//
// Si balla quando beat.js dice active, ma non:
// - in braccio, mentre parla (il loopback sentirebbe la sua voce: i livelli
//   in quei momenti non entrano), mentre dorme, appena offeso (turnaway).
// La malinconia abbassa l'ampiezza.
//
// I renderer leggono window.CompanionDance.state() a ogni frame e ascoltano
// l'evento companion-dance ({ on }) per entrare e uscire dal ballo.

(function () {
  const api = window.companion
  const Beat = window.CompanionBeat
  const CLOSE_AFTER_MS = 4000    // musica ferma: la cattura si chiude dopo un po'
  const RETRY_MS = 30000         // cattura rifiutata: si riprova piu' tardi
  const TURNAWAY_BLOCK_MS = 5500

  let fps = 43
  let tracker = Beat.createBeatTracker({ fps })
  let music = { playing: false, app: null, enabled: false }
  let capture = null             // { stream, ctx }
  let opening = false
  let closeTimer = null
  let failedAt = 0
  let dancing = false
  let dragging = false
  let dozing = false
  let blockedUntil = 0
  let sadness = 0
  let simTimer = null

  const speaking = () => !!(window.CompanionVoice && window.CompanionVoice.isSpeaking())

  function blocked() {
    return dragging || dozing || speaking() || performance.now() < blockedUntil
  }

  function setDancing(on) {
    if (on === dancing) return
    dancing = on
    if (api && api.setDancing) api.setDancing(on)
    window.dispatchEvent(new CustomEvent('companion-dance', { detail: { on } }))
  }

  /** Un livello dei bassi: al tracker, se il companion non sta parlando. */
  function onLevel(level) {
    if (!speaking()) tracker.push(level)
    setDancing(tracker.state().active && !blocked())
  }

  async function open() {
    if (capture || opening || Date.now() - failedAt < RETRY_MS) return
    opening = true
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      // Il video serve solo a Chromium per concedere l'audio: si ferma subito.
      for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t) }
      if (!stream.getAudioTracks().length) throw new Error('nessuna traccia audio')
      const ctx = new AudioContext()
      await ctx.audioWorklet.addModule('beat-worklet.js')
      const source = ctx.createMediaStreamSource(stream)
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 150
      const band = new AudioWorkletNode(ctx, 'beat-band')
      // Durante la simulazione dell'audit il suono vero (un browser che suona
      // davvero sul PC) non deve mescolarsi alla cassa finta.
      band.port.onmessage = (e) => { if (!simTimer) onLevel(e.data) }
      source.connect(lowpass).connect(band)
      fps = ctx.sampleRate / Math.round(ctx.sampleRate / 43)
      tracker = Beat.createBeatTracker({ fps })
      capture = { stream, ctx }
      // Musica gia' ferma mentre si apriva: si chiude.
      if (!music.playing) scheduleClose()
    } catch (e) {
      failedAt = Date.now()
      console.warn('[ballo] suono del PC non catturato: ' + e.message)
    } finally {
      opening = false
    }
  }

  function close() {
    clearTimeout(closeTimer)
    closeTimer = null
    // Il ritmo si azzera solo se si chiude davvero una cattura: prima una
    // chiusura a vuoto (ballo acceso senza musica) lo azzerava 4 s dopo,
    // mentre una musica appena partita lo stava gia' nutrendo.
    if (!capture) return
    for (const t of capture.stream.getTracks()) t.stop()
    capture.ctx.close().catch(() => {})
    capture = null
    tracker.reset()
    setDancing(false)
  }

  function scheduleClose() {
    if (closeTimer) return
    closeTimer = setTimeout(close, CLOSE_AFTER_MS)
  }

  function applyMusic(state) {
    music = { ...music, ...(state || {}) }
    if (state && state.enabled === false) music.playing = false
    if (music.playing) {
      clearTimeout(closeTimer)
      closeTimer = null
      open()
    } else if (capture || opening) {
      scheduleClose()
    }
  }

  if (api && api.getMusicState) api.getMusicState().then(applyMusic).catch(() => {})
  // Ogni messaggio dice anche se il ballo e' acceso: spegnendolo, quello del
  // main arriva dopo il cambio di config e non deve riaccenderlo.
  if (api && api.onMusicState) api.onMusicState(applyMusic)
  if (api && api.onConfigChanged) api.onConfigChanged((cfg) => { if (cfg && cfg.danceMusic === false) { music.enabled = false; close(); setDancing(false) } })

  if (api && api.onWindowDragState) api.onWindowDragState(({ dragging: on }) => { dragging = !!on; if (on) setDancing(false) })
  // Dorme finche' non arriva un altro gesto.
  if (api && api.onTriggerAnimation) {
    api.onTriggerAnimation((action) => {
      const key = action && (action.animation || action.type)
      if (key) dozing = key === 'doze' || key === 'sleep'
    })
  }
  window.addEventListener('companion-touch', (e) => {
    const r = e.detail && e.detail.reaction
    if (r && r.slot === 'turnaway') { blockedUntil = performance.now() + TURNAWAY_BLOCK_MS; setDancing(false) }
  })
  const readMood = (m) => { sadness = (m && m.emotions && m.emotions.sadness) || 0 }
  if (api && api.onMoodChanged) api.onMoodChanged(readMood)
  if (api && api.getMood) api.getMood().then(readMood).catch(() => {})

  window.CompanionDance = {
    /** Per i renderer, a ogni frame. amp: ampiezza del movimento, 0..1. */
    state() {
      const s = tracker.state()
      return {
        dancing, bpm: s.bpm, phase: s.phase, count: s.count, energy: s.energy,
        amp: (0.6 + 0.4 * s.energy) * (1 - 0.5 * Math.min(1, sadness)),
      }
    },
    /** Per l'audit: stato della cattura e della musica. */
    debug: () => ({ music, capturing: !!capture, opening, failed: !!failedAt, dancing, blocked: blocked(), tracker: tracker.state() }),
    /**
     * Per l'audit: una cassa finta a `bpm`, al posto del suono catturato
     * (stesso percorso da onLevel in poi). null la ferma.
     */
    simulate(bpm) {
      clearInterval(simTimer)
      simTimer = null
      if (!bpm) { tracker.reset(); setDancing(false); return }
      tracker = Beat.createBeatTracker({ fps: 43 })
      const period = 43 * 60 / bpm
      let i = 0, next = 0, env = 0
      simTimer = setInterval(() => {
        // A 43 fps veri il timer va a scatti: si recupera con piu' livelli.
        for (let k = 0; k < 2; k++) {
          if (i >= next) { env = 1; next += period }
          onLevel(0.05 + 0.6 * env)
          env *= 0.55
          i++
        }
      }, 1000 / 21.5)
    },
  }
})()
