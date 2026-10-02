// touch.js — come si tocca l'avatar: clic o presa, e (Blocco 5) dove e come.
//
// Clic e presa partono dallo stesso tasto sinistro. Con una soglia di pochi
// px un clic normale, con il tremolio della mano o di un mouse sensibile,
// diventava una presa: partiva il trascinamento e la reazione al clic non
// arrivava. Qui la regola:
// - sotto CLICK_SLOP px e' ancora un clic, quanto che duri;
// - oltre CLICK_SLOP px e' una presa;
// - tenuto oltre SLOW_DRAG_MS, bastano SLOW_DRAG_PX: chi trascina piano e'
//   deciso, e non deve spostare il cursore di 10 px prima che l'avatar segua;
// - tenuto fermo oltre PICKUP_MS lo si prende in braccio senza spostarlo.
// Le distanze sono in px dello schermo di Electron (DIP): la scala di Windows
// e' gia' tolta, quindi valgono uguali su ogni monitor.
//
// Script classico e non modulo, come sway.js: lo usa companion-input.js e i
// test lo caricano da Node.

(function (root) {
  const PRESS = {
    CLICK_SLOP: 10,     // px: sotto questa distanza e' ancora un clic
    SLOW_DRAG_MS: 350,  // dopo questo tempo la presa parte con meno strada
    SLOW_DRAG_PX: 4,
    PICKUP_MS: 600,     // tenuto fermo: preso in braccio
  }

  /**
   * Cosa fare con il sinistro ancora premuto: 'drag' (parte la presa) o
   * 'wait' (puo' ancora essere un clic).
   * @param {number} elapsedMs da quando il tasto e' giu'
   * @param {number} distance px percorsi dal punto di pressione
   */
  function pressAction(elapsedMs, distance) {
    if (distance >= PRESS.CLICK_SLOP) return 'drag'
    if (elapsedMs >= PRESS.SLOW_DRAG_MS && distance >= PRESS.SLOW_DRAG_PX) return 'drag'
    if (elapsedMs >= PRESS.PICKUP_MS) return 'drag'
    return 'wait'
  }

  /** Destro o centrale: si e' mosso abbastanza da non essere piu' un clic? */
  function movedBeyondClick(distance) {
    return distance >= PRESS.CLICK_SLOP
  }

  const api = { PRESS, pressAction, movedBeyondClick }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.CompanionTouch = api
})(typeof window !== 'undefined' ? window : globalThis)
