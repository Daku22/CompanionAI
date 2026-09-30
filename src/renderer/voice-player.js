// voice-player.js — la voce suona nella finestra dell'avatar.
//
// Il main manda una frase alla volta (voice.js): qui si mettono in fila, una
// dopo l'altra con una piccola pausa, e uno stop le ferma tutte. Da quanto
// forte suona la voce in questo momento si ricava quanto e' aperta la bocca:
// companion-3d.js lo chiede a ogni frame (mouth) e muove l'espressione "aa".
// Il volume si ascolta prima del guadagno: a volume basso la bocca si apre
// lo stesso.

(function () {
  const api = window.companion
  const PAUSE_S = 0.12        // fra una frase e l'altra
  const START_DELAY_S = 0.05
  const OPEN_PER_S = 28       // la bocca si apre in fretta...
  const CLOSE_PER_S = 12      // ...e si chiude un po' piu' piano

  let ctx = null
  let analyser = null
  let gain = null
  let samples = null
  let current = 0             // numero della risposta in corso
  let nextAt = 0
  let sources = []
  let mouth = 0

  function ensure() {
    if (ctx) return
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    gain = ctx.createGain()
    analyser.connect(gain)
    gain.connect(ctx.destination)
    samples = new Float32Array(analyser.fftSize)
  }

  function stopAll() {
    for (const s of sources) { try { s.stop() } catch (_) { /* gia' finita */ } }
    sources = []
    nextAt = 0
  }

  function chunk(msg) {
    if (msg.utterance < current) return
    if (msg.utterance > current) { stopAll(); current = msg.utterance }
    ensure()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const pcm = msg.pcm instanceof Float32Array ? msg.pcm : new Float32Array(msg.pcm || [])
    const rate = Number(msg.rate) || 24000
    if (!pcm.length) return
    if (typeof msg.volume === 'number') gain.gain.value = Math.max(0, Math.min(1, msg.volume))
    const buffer = ctx.createBuffer(1, pcm.length, rate)
    buffer.copyToChannel(pcm, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(analyser)
    const at = Math.max(ctx.currentTime + START_DELAY_S, nextAt)
    src.start(at)
    nextAt = at + buffer.duration + PAUSE_S
    sources.push(src)
    src.onended = () => { sources = sources.filter(s => s !== src) }
  }

  if (api && api.onVoiceAudio) {
    api.onVoiceAudio((msg) => {
      if (!msg) return
      if (msg.type === 'stop') {
        if (msg.utterance >= current) { current = msg.utterance; stopAll() }
      } else if (msg.type === 'chunk') chunk(msg)
    })
  }

  window.CompanionVoice = {
    /** Quanto e' aperta la bocca, da 0 a 1. Da chiamare una volta per frame. */
    mouth(delta) {
      let target = 0
      if (analyser && sources.length) {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
        const rms = Math.sqrt(sum / samples.length)
        target = Math.max(0, Math.min(1, (rms - 0.015) * 6))
      }
      const speed = target > mouth ? OPEN_PER_S : CLOSE_PER_S
      mouth += (target - mouth) * Math.min(1, (delta || 0.016) * speed)
      return mouth < 0.01 ? 0 : mouth
    },
    isSpeaking: () => sources.length > 0,
  }
})()
