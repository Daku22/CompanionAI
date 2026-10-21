// mic-recorder.js — il microfono, lato pagina. Registra finche' serve e
// restituisce i campioni mono a 16 kHz che vuole Whisper (il servizio della
// voce, nel main). Lo usano la chat (tieni premuto 🎙 o la scorciatoia) e le
// Impostazioni (prova del microfono).
//
// L'AudioContext a 16 kHz fa lui il ricampionamento dal microfono (48 kHz di
// solito); i campioni arrivano da mic-worklet.js. Il microfono resta aperto
// solo mentre si registra: fuori, la spia di Windows e' spenta.
//
// Il microfono si sceglie nelle Impostazioni (voice.micDevice e il suo nome,
// micDeviceLabel); vuoto e' il predefinito di Windows.
//
// A mani libere (Blocco 11b) il microfono resta aperto: vadStep, a ogni
// blocco, dice quando un turno comincia e finisce; trim tiene solo l'ultimo
// pezzo mentre nessuno parla, takeFrom prende il turno (con un attimo prima,
// per non tagliare la prima sillaba).

(function () {
  const RATE = 16000
  const MAX_SECONDS = 60
  // Voci che Chromium aggiunge all'elenco: non sono microfoni veri, ma il
  // predefinito e quello "per le comunicazioni" di Windows.
  const ALIASES = ['default', 'communications']

  /**
   * I microfoni del sistema, e il nome di quello predefinito di Windows.
   * I nomi ci sono solo se la pagina ha il permesso del microfono.
   * @returns {Promise<{ devices: { id: string, label: string }[], defaultLabel: string }>}
   */
  async function listInputs() {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')
    const def = inputs.find(d => d.deviceId === 'default')
    return {
      devices: inputs.filter(d => !ALIASES.includes(d.deviceId)).map(d => ({ id: d.deviceId, label: d.label })),
      // "Predefinito - Microfono (Realtek)": solo il nome del dispositivo.
      defaultLabel: def ? def.label.replace(/^[^-]+ - /, '') : '',
    }
  }

  /**
   * Il microfono da aprire: quello scelto, per id o, se l'id e' cambiato
   * (ricollegato a un'altra porta USB, per esempio), per nome. id null: il
   * predefinito di Windows; missing: quello scelto non c'e'.
   * @param {{ id: string, label: string }[]} devices
   * @param {{ id?: string, label?: string }} [pref]
   * @returns {{ id: string|null, missing: boolean }}
   */
  function pickInput(devices, pref) {
    if (!pref || !pref.id) return { id: null, missing: false }
    const byId = devices.find(d => d.id === pref.id)
    if (byId) return { id: byId.id, missing: false }
    const byLabel = pref.label ? devices.find(d => d.label && d.label === pref.label) : null
    if (byLabel) return { id: byLabel.id, missing: false }
    return { id: null, missing: true }
  }

  /**
   * Un passo del rilevatore di voce (Blocco 11b), a ogni blocco del microfono
   * (circa 128 ms). Il turno si apre sopra la soglia e si chiude dopo hangMs
   * di silenzio (sotto il 60% della soglia); un turno piu' corto di minMs e'
   * rumore (un colpo, un clic) e si scarta. deaf: mentre il companion parla
   * non si ascolta, e un turno a meta' si scarta. Pura, con test.
   * @param {{ phase: 'idle'|'speech', startAt: number, lastVoiceAt: number } | null} state
   * @param {number} level volume 0..1 (onLevel)
   * @param {number} now ms
   * @param {{ threshold: number, hangMs?: number, minMs?: number, maxMs?: number, deaf?: boolean }} o
   * @returns {{ state: { phase: 'idle'|'speech', startAt: number, lastVoiceAt: number }, event: null | 'start' | 'end' | 'discard' }}
   */
  function vadStep(state, level, now, o) {
    const hang = o.hangMs == null ? 800 : o.hangMs
    const min = o.minMs == null ? 400 : o.minMs
    const max = o.maxMs == null ? 30000 : o.maxMs
    const idle = { phase: 'idle', startAt: 0, lastVoiceAt: 0 }
    const s = state || idle
    if (o.deaf) return { state: idle, event: s.phase === 'speech' ? 'discard' : null }
    if (s.phase !== 'speech') {
      return level >= o.threshold ? { state: { phase: 'speech', startAt: now, lastVoiceAt: now }, event: 'start' } : { state: idle, event: null }
    }
    const lastVoiceAt = level >= o.threshold * 0.6 ? now : s.lastVoiceAt
    if (now - lastVoiceAt < hang && now - s.startAt < max) return { state: { ...s, lastVoiceAt }, event: null }
    return { state: idle, event: lastVoiceAt - s.startAt >= min ? 'end' : 'discard' }
  }

  /**
   * La soglia del rilevatore dalla sensibilita' delle Impostazioni (0..1):
   * piu' sensibile, soglia piu' bassa. 0,5 sta sopra il rumore di una stanza
   * e sotto una voce normale a mezzo metro.
   */
  function thresholdOf(sensitivity) {
    const s = typeof sensitivity === 'number' && Number.isFinite(sensitivity) ? Math.max(0, Math.min(1, sensitivity)) : 0.5
    return Math.round((0.32 - 0.26 * s) * 1000) / 1000
  }

  class MicRecorder {
    /**
     * @param {{ onLevel?: (level: number) => void, onLimit?: () => void }} [opts]
     *   onLevel: volume 0..1 mentre registra; onLimit: raggiunto il massimo (60 s)
     */
    constructor(opts = {}) {
      this.onLevel = opts.onLevel || (() => {})
      this.onLimit = opts.onLimit || (() => {})
      this.ctx = null
      this.stream = null
      this.node = null
      this.chunks = []
      this.length = 0
      this.starting = null
      this.missing = false   // il microfono scelto non c'era: si registra dal predefinito
    }

    get recording() { return !!this.ctx || !!this.starting }

    /**
     * Apre il microfono e comincia a registrare.
     * @param {{ deviceId?: string, deviceLabel?: string }} [opts] il microfono scelto
     */
    start(opts = {}) {
      if (this.recording) return this.starting || Promise.resolve()
      this.starting = (async () => {
        const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        this.missing = false
        if (opts.deviceId) {
          const pick = pickInput((await listInputs()).devices, { id: opts.deviceId, label: opts.deviceLabel })
          this.missing = pick.missing
          if (pick.id) audio.deviceId = { exact: pick.id }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio })
        const ctx = new AudioContext({ sampleRate: RATE })
        try {
          await ctx.audioWorklet.addModule('mic-worklet.js')
          const source = ctx.createMediaStreamSource(stream)
          const node = new AudioWorkletNode(ctx, 'mic-tap')
          this.chunks = []
          this.length = 0
          let limited = false
          node.port.onmessage = (e) => {
            const pcm = e.data
            if (!(pcm instanceof Float32Array) || !pcm.length || this.length >= RATE * MAX_SECONDS) return
            this.chunks.push(pcm)
            this.length += pcm.length
            let sum = 0
            for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
            try { this.onLevel(Math.min(1, Math.sqrt(sum / pcm.length) * 6)) } catch (_) {}
            if (this.length >= RATE * MAX_SECONDS && !limited) { limited = true; try { this.onLimit() } catch (_) {} }
          }
          // Un nodo che non arriva all'uscita potrebbe non essere mai
          // chiamato: si collega all'uscita attraverso un volume a zero.
          const mute = ctx.createGain()
          mute.gain.value = 0
          source.connect(node)
          node.connect(mute)
          mute.connect(ctx.destination)
          this.ctx = ctx
          this.stream = stream
          this.node = node
        } catch (error) {
          stream.getTracks().forEach(t => t.stop())
          ctx.close().catch(() => {})
          throw error
        }
      })()
      return this.starting.finally(() => { this.starting = null })
    }

    /** Chiude il microfono. @returns {Promise<Float32Array>} tutto il registrato */
    async stop() {
      if (this.starting) { try { await this.starting } catch (_) { return new Float32Array(0) } }
      if (!this.ctx) return new Float32Array(0)
      // Il pezzo di blocco rimasto nel worklet, poi si chiude.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 150)
        const port = this.node.port
        const prev = port.onmessage
        // Il resto e' un blocco piu' corto: uno pieno e' arrivato prima.
        port.onmessage = (e) => { prev.call(port, e); if (e.data.length < 2048) { clearTimeout(timer); resolve() } }
        port.postMessage('flush')
      })
      this._close()
      const out = new Float32Array(this.length)
      let at = 0
      for (const c of this.chunks) { out.set(c, at); at += c.length }
      this.chunks = []
      this.length = 0
      return out
    }

    /** Quanti blocchi ci sono da quando si e' cominciato (o dall'ultimo takeFrom). */
    get blockCount() { return this.chunks.length }

    /** A mani libere, mentre nessuno parla: tiene solo gli ultimi keep blocchi. */
    trim(keep) {
      if (this.chunks.length <= keep) return
      const drop = this.chunks.splice(0, this.chunks.length - keep)
      for (const c of drop) this.length -= c.length
    }

    /** Il turno dal blocco from in poi; il microfono resta aperto e si riparte da vuoto. */
    takeFrom(from) {
      const parts = this.chunks.slice(Math.max(0, from))
      const out = new Float32Array(parts.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of parts) { out.set(c, at); at += c.length }
      this.chunks = []
      this.length = 0
      return out
    }

    /** Chiude senza tenere niente. */
    cancel() {
      this._close()
      this.chunks = []
      this.length = 0
    }

    _close() {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop())
      if (this.ctx) this.ctx.close().catch(() => {})
      this.stream = null
      this.ctx = null
      this.node = null
    }
  }

  MicRecorder.RATE = RATE
  MicRecorder.MAX_SECONDS = MAX_SECONDS
  MicRecorder.listInputs = listInputs
  MicRecorder.pickInput = pickInput
  MicRecorder.vadStep = vadStep
  MicRecorder.thresholdOf = thresholdOf
  window.MicRecorder = MicRecorder
})()
