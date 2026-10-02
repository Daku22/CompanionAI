// beat.js — il ritmo della musica, dal livello dei bassi (Blocco 5c).
//
// Entra un numero per fotogramma: il livello dei bassi (sotto 150 Hz) del
// suono del PC, a circa 43 fotogrammi al secondo (beat-worklet.js). Esce:
// - bpm e confidence (0..1): il tempo, con autocorrelazione dell'attacco
//   delle note (spectral flux sul logaritmo del livello) su 6 s, fra 70 e
//   180 BPM, con una preferenza morbida attorno a 120 per non saltare
//   all'ottava;
// - phase (0..1 dentro la battuta) e count (battute contate): la fase si
//   aggancia ai picchi e si corregge piano a ogni stima;
// - energy (0..1): quanto suona forte, rispetto agli ultimi secondi;
// - active: si balla. Parte dopo 3 s di ritmo sicuro, smette dopo 3 s di
//   silenzio o di ritmo perso.
//
// Puro, senza Web Audio: i test lo nutrono con segnali finti (click a 90,
// 120, 140 BPM, rumore, voce simulata). Script classico come touch.js.

(function (root) {
  const BEAT = {
    WINDOW_S: 6,          // storia per il tempo
    MIN_BPM: 70, MAX_BPM: 180, PRIOR_BPM: 120, PRIOR_OCTAVES: 0.9,
    ESTIMATE_S: 0.5,      // ogni quanto si rifa' la stima
    START_S: 3, STOP_S: 3,
    CONFIDENT: 0.3,       // sicurezza per contare come ritmo
    SILENT_DB: -60,       // sotto questo livello e' silenzio
    PHASE_GAIN: 0.35,     // quanto la fase misurata corregge quella prevista
  }

  /**
   * @param {{ fps?: number }} [options] fotogrammi al secondo del livello
   */
  function createBeatTracker(options = {}) {
    const fps = options.fps || 43
    const size = Math.round(BEAT.WINDOW_S * fps)
    const onset = new Float32Array(size)
    const level = new Float32Array(size)
    let n = 0                 // fotogrammi ricevuti
    let prevLog = null
    let bpm = 0
    let period = 0            // in fotogrammi
    let confidence = 0
    let anchor = 0            // fotogramma (anche frazionario) di una battuta
    let energy = 0
    let goodFor = 0           // secondi di ritmo sicuro di fila
    let badFor = 0            // secondi di silenzio o ritmo perso di fila
    let active = false
    const estimateEvery = Math.max(1, Math.round(BEAT.ESTIMATE_S * fps))

    const at = (buf, frame) => buf[((frame % size) + size) % size]

    function estimateTempo() {
      const count = Math.min(n, size)
      if (count < fps * 2) return
      let mean = 0
      for (let i = 0; i < count; i++) mean += at(onset, n - 1 - i)
      mean /= count
      // Attacchi ammorbiditi su tre fotogrammi: una battuta che cade fra due
      // fotogrammi (140 BPM a 43 fps sono 18,4) divideva il suo picco in due
      // e perdeva contro quello doppio, che cade quasi intero.
      const x = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const f = n - count + i
        x[i] = 0.25 * at(onset, f - 1) + 0.5 * at(onset, f) + 0.25 * at(onset, f + 1 < n ? f + 1 : f) - mean
      }
      let r0 = 0
      for (let i = 0; i < count; i++) r0 += x[i] * x[i]
      if (r0 <= 1e-9) { confidence = 0; return }
      const minLag = Math.floor(fps * 60 / BEAT.MAX_BPM)
      const maxLag = Math.ceil(fps * 60 / BEAT.MIN_BPM)
      const r = new Float32Array(maxLag + 2)
      for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
        let s = 0
        for (let i = lag; i < count; i++) s += x[i] * x[i - lag]
        r[lag] = s / r0 * count / (count - lag)
      }
      let best = -1
      let bestScore = -Infinity
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (!(r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1])) continue
        const b = fps * 60 / lag
        const prior = Math.exp(-0.5 * Math.pow(Math.log2(b / BEAT.PRIOR_BPM) / BEAT.PRIOR_OCTAVES, 2))
        const score = r[lag] * prior
        if (score > bestScore) { bestScore = score; best = lag }
      }
      if (best < 0) { confidence = 0; return }
      // Picco fra due fotogrammi: interpolazione parabolica.
      const a = r[best - 1], b = r[best], c = r[best + 1]
      const den = a - 2 * b + c
      const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0
      const lag = best + shift
      confidence = Math.max(0, Math.min(1, b))
      const nextPeriod = lag
      // Stesso tempo di prima (entro il 4%): si ammorbidisce, se no si salta.
      period = period && Math.abs(nextPeriod - period) / period < 0.04 ? period * 0.7 + nextPeriod * 0.3 : nextPeriod
      bpm = fps * 60 / period
      alignPhase(count)
    }

    // La fase: l'offset che mette piu' attacchi sulle battute previste, su
    // tutta la finestra; poi la battuta prevista si sposta verso quella.
    function alignPhase(count) {
      const steps = Math.max(8, Math.round(period))
      let bestOffset = 0
      let bestSum = -Infinity
      for (let k = 0; k < steps; k++) {
        const offset = k * period / steps
        let sum = 0
        for (let t = n - 1 - offset; t > n - count; t -= period) sum += at(onset, Math.round(t))
        if (sum > bestSum) { bestSum = sum; bestOffset = offset }
      }
      const measured = n - 1 - bestOffset
      if (!anchor) { anchor = measured; return }
      let diff = ((measured - anchor) % period + period) % period
      if (diff > period / 2) diff -= period
      anchor += diff * BEAT.PHASE_GAIN
    }

    function updateEnergy() {
      const recent = Math.min(n, Math.round(fps))
      const whole = Math.min(n, size)
      // L'ultimo secondo contro la media degli ultimi 6: musica costante = 1,
      // un passaggio piano scende, un attacco forte resta a 1.
      let r = 0, mean = 1e-6
      for (let i = 0; i < recent; i++) r += at(level, n - 1 - i)
      r /= Math.max(1, recent)
      for (let i = 0; i < whole; i++) mean += at(level, n - 1 - i)
      mean /= Math.max(1, whole)
      energy = Math.max(0, Math.min(1, r / mean))
      return 20 * Math.log10(r + 1e-9)
    }

    return {
      /**
       * Un fotogramma: il livello dei bassi (ampiezza lineare, 0..1).
       * @param {number} value
       */
      push(value) {
        const v = Number.isFinite(value) && value > 0 ? value : 0
        const lg = Math.log(v + 1e-4)
        const flux = prevLog === null ? 0 : Math.max(0, lg - prevLog)
        prevLog = lg
        onset[n % size] = flux
        level[n % size] = v
        n++
        if (n % estimateEvery === 0) {
          estimateTempo()
          const db = updateEnergy()
          const step = estimateEvery / fps
          const good = db > BEAT.SILENT_DB && confidence >= BEAT.CONFIDENT && bpm > 0
          if (good) { goodFor += step; badFor = 0 } else { badFor += step; goodFor = 0 }
          if (!active && goodFor >= BEAT.START_S) active = true
          if (active && badFor >= BEAT.STOP_S) active = false
        }
        return this.state()
      },

      /** Lo stato di adesso. */
      state() {
        let phase = 0, count = 0
        if (period > 0 && anchor) {
          const beats = (n - 1 - anchor) / period
          count = Math.floor(beats)
          phase = beats - count
        }
        return { bpm: active || confidence > 0 ? Math.round(bpm * 10) / 10 : 0, confidence, phase, count, energy, active }
      },

      /** Si riparte da zero (cattura chiusa e riaperta). */
      reset() {
        onset.fill(0); level.fill(0)
        n = 0; prevLog = null; bpm = 0; period = 0; confidence = 0; anchor = 0
        energy = 0; goodFor = 0; badFor = 0; active = false
      },
    }
  }

  const api = { BEAT, createBeatTracker }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.CompanionBeat = api
})(typeof window !== 'undefined' ? window : globalThis)
