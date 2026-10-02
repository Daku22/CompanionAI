// companion-peek.js — sbircia dal bordo dello schermo (Blocco 5d), lato pagina.
//
// Il main decide quando (edge-peek.js): lasciato oltre meta' fuori dal bordo
// sinistro o destro, manda edge-peek { side }. Qui si avvisa il renderer
// attivo (evento companion-peek), che mette la posa; quando la posa si e'
// assestata il renderer misura dove deve cadere il bordo dello schermo (cut,
// x dentro la finestra) e dove sta la testa, e la misura torna al main, che
// fa scivolare la finestra. edge-peek { side: null, reason } lo fa uscire.
//
// Esce con il doppio clic (companion-input.js chiama out()), con il cursore
// vicino alla testa o con un messaggio in arrivo (lo decide il main).

(function () {
  const api = window.companion
  const SETTLE_MS = 700        // la posa entra in 0,25 s; qualche frame in piu'
  let side = null
  let settleTimer = null
  let measure = null           // dal renderer attivo: (side) => { cut, head: { x, y } } | null

  function report() {
    if (!side || !api || !api.peekGeometry) return
    let g = null
    try { g = measure ? measure(side) : null } catch (e) { console.warn('[sbircia] misura non riuscita: ' + e.message) }
    const ok = g && [g.cut, g.head && g.head.x, g.head && g.head.y].every(Number.isFinite)
    api.peekGeometry(ok ? { side, cut: g.cut, headX: g.head.x, headY: g.head.y } : { side, cut: null })
  }

  function set(next, reason) {
    clearTimeout(settleTimer)
    if (next === side) return
    side = next
    window.dispatchEvent(new CustomEvent('companion-peek', { detail: { side, reason: reason || null } }))
    if (side) settleTimer = setTimeout(report, SETTLE_MS)
  }

  if (api && api.onEdgePeek) {
    api.onEdgePeek((data) => {
      const s = data && (data.side === 'left' || data.side === 'right') ? data.side : null
      set(s, data && typeof data.reason === 'string' ? data.reason : null)
    })
  }

  window.CompanionPeek = {
    /** 'left' o 'right' mentre sbircia, altrimenti null. */
    side: () => side,
    /** Il renderer attivo dice come misurare la sua posa (null: ripiego del main). */
    setMeasure(fn) { measure = typeof fn === 'function' ? fn : null },
    /** Doppio clic mentre sbircia: esce. */
    out() { if (side && api && api.peekOut) api.peekOut() },
    /** Per l'audit: la misura che andrebbe al main adesso. */
    debug: () => ({ side, geometry: side && measure ? measure(side) : null }),
  }
})()
