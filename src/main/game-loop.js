// game-loop.js — il ciclo della modalita' gioco (Blocco 12b).
//
// Ogni 5 s (LOOK.TICK_MS) un'impronta minuscola della finestra del gioco
// (sigCapture: niente modello); nextStep decide se guardare davvero. Lo
// sguardo (look, il modello nel 12c) e' uno alla volta: mentre e' in corso
// le impronte continuano ma non partono altri sguardi. Se intanto la scena
// e' cambiata molto, il risultato vale come contesto ma non si commenta
// (onResult riceve stale). Senza la finestra (chiusa, ridotta, un'app da
// ignorare in primo piano) la modalita' e' in pausa, e riparte da sola. Mentre
// parli o scrivi (busy) non guarda.
//
// Le dipendenze arrivano da fuori (cattura, sguardo, orologio): il test le
// finge.

const G = require('./game-mode')

/**
 * @param {{ config: () => { intervalS: number, perHour: number },
 *   sigCapture: () => Promise<{ ok: boolean, state?: string, sig?: Uint8Array, title?: string }>,
 *   look: (info: { sig: Uint8Array, at: number }) => Promise<any>,
 *   busy?: () => string|null,
 *   onSame?: () => void,
 *   onResult?: (result: any, info: { stale: boolean, at: number }) => void,
 *   onState?: (state: any) => void, now?: () => number, tickMs?: number }} ctx
 */
function createGameLoop(ctx) {
  const now = ctx.now || Date.now
  let s = fresh()

  function fresh() {
    return { on: false, watcher: null, timer: null, ticking: false, looking: false, lookSig: null, latestSig: null,
      lastLookAt: null, looks: [], total: 0, paused: null, title: '', startedAt: 0, lastReason: '' }
  }

  const state = () => {
    const t = now()
    return { on: s.on, watcher: s.watcher, paused: s.paused, title: s.title, looking: s.looking, startedAt: s.startedAt,
      looks: s.looks.filter(x => t - x < 60 * 60 * 1000).length, total: s.total, perHour: ctx.config().perHour, reason: s.lastReason }
  }
  const emit = () => { if (ctx.onState) try { ctx.onState(state()) } catch (_) {} }

  async function tick() {
    if (!s.on || s.ticking) return
    const mine = s
    mine.ticking = true
    try {
      const cfg = ctx.config()
      const snap = await ctx.sigCapture()
      if (mine !== s || !s.on) return
      const paused = snap && snap.ok ? null : (snap && snap.state) || 'missing'
      if (paused !== s.paused) { s.paused = paused; emit() }
      if (paused) return
      if (snap.title && snap.title !== s.title) { s.title = snap.title; emit() }
      s.latestSig = snap.sig
      const t = now()
      const step = G.nextStep(s, { now: t, sig: snap.sig, intervalS: cfg.intervalS, perHour: cfg.perHour, busy: ctx.busy ? ctx.busy() : null })
      s.looks = step.looks
      s.lastReason = step.reason
      // La scena e' ancora quella dell'ultimo sguardo: chi la usa come contesto
      // sa che e' ancora vera, anche se lo sguardo e' di qualche minuto fa.
      if (step.reason === 'scena uguale' && ctx.onSame) try { ctx.onSame() } catch (_) {}
      if (!step.look) return
      s.looking = true
      s.lookSig = snap.sig
      s.lastLookAt = t
      s.looks.push(t)
      s.total++
      emit()
      // Lo sguardo va per conto suo: le impronte continuano intanto.
      ;(async () => {
        let result = null
        try { result = await ctx.look({ sig: snap.sig, at: t }) } catch (e) { result = { ok: false, error: e.message } }
        mine.looking = false
        if (mine !== s || !s.on) return
        const stale = G.changed(s.latestSig, snap.sig) >= G.LOOK.STALE
        if (ctx.onResult) try { ctx.onResult(result, { stale, at: t }) } catch (e) { console.error('[gioco] risultato:', e.message) }
        emit()
      })()
    } finally {
      mine.ticking = false
    }
  }

  return {
    /** Accende la modalita' gioco per il companion watcher (il suo id). */
    start(watcher) {
      if (s.on) return state()
      s = fresh()
      s.on = true
      s.watcher = watcher || null
      s.startedAt = now()
      s.timer = setInterval(() => { tick().catch(() => {}) }, ctx.tickMs || G.LOOK.TICK_MS)
      if (s.timer.unref) s.timer.unref()
      tick().catch(() => {})
      emit()
      return state()
    },
    /** Spegne; il riassunto (per la riga in memoria, 12c), o null se era spenta. */
    stop() {
      if (!s.on) return null
      const ended = s
      clearInterval(ended.timer)
      ended.on = false
      const summary = { watcher: ended.watcher, title: ended.title, startedAt: ended.startedAt, endedAt: now(), looks: ended.total }
      s = fresh()
      emit()
      return summary
    },
    state,
    /** Per i test: un giro subito. */
    _tick: tick,
  }
}

module.exports = { createGameLoop }
