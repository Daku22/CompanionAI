// sway.js — oscillazione dell'avatar quando lo si prende in braccio.
//
// Una molla smorzata spinta dalla velocita' della finestra: spostandola verso
// destra il corpo resta indietro e penzola a sinistra, poi si riassesta. I
// numeri (2,6 Hz, smorzamento 0,35, al massimo 25 gradi di lato e 12 in
// avanti) sono quelli descritti da Mate Engine per AvatarSwayController; il
// codice e' scritto da zero (Mate Engine e' AGPL, da li' solo idee).
//
// Script classico e non modulo: lo usano sia companion-2d.js (script classico)
// sia companion-3d.js (modulo), e i test lo caricano da Node.

(function (root) {
  const DEG = Math.PI / 180

  const SWAY = {
    freq: 2.6,              // Hz della molla
    damping: 0.35,          // rapporto di smorzamento: meno di 1 oscilla un po'
    maxSide: 25 * DEG,      // inclinazione laterale massima
    maxForward: 12 * DEG,   // inclinazione avanti/indietro massima
    sidePerPx: 0.0003,      // radianti per px/s di velocita' orizzontale
    forwardPerPx: 0.00015,  // radianti per px/s di velocita' verticale
    maxStep: 1 / 120,       // passo d'integrazione massimo, per la stabilita'
  }

  const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v))

  /** Angoli a cui la molla tende, data la velocita' della finestra in px/s. */
  function swayTarget(vx, vy) {
    return {
      // Verso destra (vx > 0) i piedi restano indietro, a sinistra: angolo
      // positivo nella convenzione dello schermo (y in giu', orario positivo).
      side: clamp((vx || 0) * SWAY.sidePerPx, SWAY.maxSide),
      // Verso il basso il corpo si inclina all'indietro, verso l'alto in avanti.
      forward: clamp(-(vy || 0) * SWAY.forwardPerPx, SWAY.maxForward),
    }
  }

  /** Molla smorzata su due assi. update() restituisce gli angoli in radianti. */
  function createSway() {
    const omega = 2 * Math.PI * SWAY.freq
    const k = omega * omega
    const c = 2 * SWAY.damping * omega
    const side = { a: 0, v: 0 }
    const forward = { a: 0, v: 0 }

    function step(s, target, dt, max) {
      s.v += (-k * (s.a - target) - c * s.v) * dt
      s.a += s.v * dt
      // Oltre il limite la molla si ferma li' invece di rimbalzarci contro.
      if (Math.abs(s.a) > max) { s.a = clamp(s.a, max); s.v = 0 }
    }

    return {
      /**
       * @param {number} dt secondi dall'ultimo aggiornamento
       * @param {number} vx velocita' orizzontale della finestra, px/s
       * @param {number} vy velocita' verticale della finestra, px/s
       */
      update(dt, vx, vy) {
        const target = swayTarget(vx, vy)
        let left = Math.max(0, Math.min(dt, 0.1))
        while (left > 1e-6) {
          const h = Math.min(left, SWAY.maxStep)
          step(side, target.side, h, SWAY.maxSide)
          step(forward, target.forward, h, SWAY.maxForward)
          left -= h
        }
        return { side: side.a, forward: forward.a }
      },
      /** Ferma di colpo la molla, per un avatar nuovo. */
      reset() { side.a = side.v = forward.a = forward.v = 0 },
      get() { return { side: side.a, forward: forward.a } },
    }
  }

  const api = { SWAY, swayTarget, createSway }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.CompanionSway = api
})(typeof window !== 'undefined' ? window : globalThis)
