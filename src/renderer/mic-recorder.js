// mic-recorder.js — il microfono, lato pagina. Registra finche' serve e
// restituisce i campioni mono a 16 kHz che vuole Whisper (il servizio della
// voce, nel main). Lo usano la chat (tieni premuto 🎙 o la scorciatoia) e le
// Impostazioni (prova del microfono).
//
// L'AudioContext a 16 kHz fa lui il ricampionamento dal microfono (48 kHz di
// solito); i campioni arrivano da mic-worklet.js. Il microfono resta aperto
// solo mentre si registra: fuori, la spia di Windows e' spenta.

(function () {
  const RATE = 16000
  const MAX_SECONDS = 60

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
    }

    get recording() { return !!this.ctx || !!this.starting }

    /** Apre il microfono e comincia a registrare. */
    start() {
      if (this.recording) return this.starting || Promise.resolve()
      this.starting = (async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
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
  window.MicRecorder = MicRecorder
})()
