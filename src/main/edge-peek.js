// edge-peek.js — sbirciare dal bordo dello schermo (Blocco 5d).
//
// Lasciato oltre meta' fuori dal bordo sinistro o destro di uno schermo (il
// centro dell'avatar oltre il bordo, e di la' nessun altro schermo), il
// companion non torna dentro da solo: resta quasi tutto fuori e sbircia, con
// la testa e una mano. Esce quando il cursore si avvicina, quando arriva un
// messaggio o con un doppio clic.
//
// Dove tagliare lo dice il renderer, che conosce la posa: `cut` e' la x
// dentro la finestra su cui deve cadere il bordo dello schermo, appena oltre
// la testa. Qui ci sono solo funzioni pure; timer e finestre stanno in
// main.js, come per perch.js.

const PEEK = {
  // Il cursore deve prima allontanarsi (al rilascio e' proprio sopra
  // l'avatar), poi avvicinarsi alla testa che sbuca.
  ARM_PX: 200,
  NEAR_PX: 110,
  // Il taglio resta dentro la finestra, con almeno un po' di avatar da una
  // parte e dall'altra.
  CUT_MIN: 0.15,
  CUT_MAX: 0.85,
  // Senza la misura del renderer: il taglio a un quarto di finestra dal centro.
  DEFAULT_CUT: 0.25,
}

// Il desktop e la taskbar: in primo piano coprono lo schermo, ma non sono app.
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ id: number, bounds: Rect, workArea: Rect }} DisplayInfo
 * @typedef {{ side: 'left' | 'right', displayId: number, edgeX: number, area: Rect }} Edge
 */

function contains(r, x, y) {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

/**
 * Il companion e' oltre meta' fuori da un bordo esterno? Il centro
 * dell'avatar (anchorX dentro la finestra) sta oltre il bordo sinistro o
 * destro dell'area di lavoro di uno schermo, e non dentro un altro schermo.
 * @param {Rect} bounds finestra del companion
 * @param {number} anchorX centro dell'avatar dentro la finestra, in px
 * @param {DisplayInfo[]} displays
 * @returns {Edge | null}
 */
function edgeState(bounds, anchorX, displays) {
  if (!bounds || !Array.isArray(displays) || !Number.isFinite(anchorX)) return null
  const cx = bounds.x + anchorX
  const cy = bounds.y + bounds.height / 2
  if (displays.some(d => contains(d.workArea, cx, cy))) return null
  /** @type {Edge | null} */
  let best = null
  let bestDist = Infinity
  for (const d of displays) {
    const a = d.workArea
    if (cy < a.y || cy >= a.y + a.height) continue
    const left = a.x - cx
    const right = cx - (a.x + a.width)
    const side = left > 0 ? 'left' : right >= 0 ? 'right' : null
    const dist = side === 'left' ? left : right
    // Oltre una finestra di distanza non e' un bordo lasciato, e' altro.
    if (!side || dist > bounds.width || dist >= bestDist) continue
    bestDist = dist
    best = { side, displayId: d.id, edgeX: side === 'left' ? a.x : a.x + a.width, area: a }
  }
  return best
}

/** Il taglio, dentro i limiti; senza misura, a un quarto di finestra dal centro verso l'esterno. */
function clampCut(edge, cut, width, anchorX) {
  const fallback = anchorX + (edge.side === 'right' ? -1 : 1) * PEEK.DEFAULT_CUT * width
  const value = Number.isFinite(cut) ? cut : fallback
  return Math.max(PEEK.CUT_MIN * width, Math.min(PEEK.CUT_MAX * width, value))
}

/**
 * Dove sta la finestra mentre sbircia: il taglio sul bordo dello schermo,
 * l'altezza dentro l'area di lavoro.
 * @param {Edge} edge
 * @param {number | null} cut x del taglio dentro la finestra (dal renderer)
 * @param {Rect} bounds
 * @param {number} anchorX
 */
function peekPosition(edge, cut, bounds, anchorX) {
  const c = clampCut(edge, cut, bounds.width, anchorX)
  const a = edge.area
  return {
    x: Math.round(edge.edgeX - c),
    y: Math.round(Math.max(a.y, Math.min(bounds.y, a.y + a.height - bounds.height))),
  }
}

/**
 * Dove va la finestra quando esce: tutta dentro l'area di lavoro, accanto al
 * bordo da cui sbirciava.
 * @param {Edge} edge
 * @param {Rect} bounds
 */
function outPosition(edge, bounds) {
  const a = edge.area
  return {
    x: edge.side === 'left' ? a.x : a.x + a.width - bounds.width,
    y: Math.round(Math.max(a.y, Math.min(bounds.y, a.y + a.height - bounds.height))),
  }
}

/**
 * Il cursore: prima deve allontanarsi dalla testa che sbuca (armed), poi
 * avvicinandosi la fa uscire.
 * @param {boolean} armed
 * @param {{ x: number, y: number }} cursor
 * @param {{ x: number, y: number }} spot la testa, sullo schermo
 */
function peekCursor(armed, cursor, spot) {
  const d = Math.hypot(cursor.x - spot.x, cursor.y - spot.y)
  if (!armed) return { armed: d > PEEK.ARM_PX, exit: false }
  return { armed: true, exit: d < PEEK.NEAR_PX }
}

const WS_EX_TRANSPARENT = 0x20

/**
 * C'e' un'app a schermo intero sopra le altre su questo schermo? Allora non si
 * sbircia (un film, un gioco). Conta la prima finestra dall'alto che tocca lo
 * schermo, saltando il companion (al rilascio e' lui in primo piano), il
 * desktop, la taskbar e le sovrapposizioni trasparenti ai clic.
 * @param {{ hwnd: number, className: string, pid: number, exStyle?: number, minimized: boolean, maximized?: boolean, bounds: Rect | null }[]} windows in ordine z, dall'alto
 * @param {DisplayInfo} display
 * @param {number} ownPid
 */
function fullscreenApp(windows, display, ownPid) {
  const d = display.bounds
  for (const w of windows) {
    if (!w.bounds || w.minimized || w.pid === ownPid || SHELL_CLASSES.has(w.className)) continue
    if ((w.exStyle || 0) & WS_EX_TRANSPARENT) continue
    const b = w.bounds
    if (b.x >= d.x + d.width || b.x + b.width <= d.x || b.y >= d.y + d.height || b.y + b.height <= d.y) continue
    // Massimizzata non e' schermo intero, anche se con la taskbar nascosta
    // copre tutto lo schermo: e' un browser, non un film o un gioco.
    if (w.maximized) return false
    return b.x <= d.x && b.y <= d.y && b.x + b.width >= d.x + d.width && b.y + b.height >= d.y + d.height
  }
  return false
}

module.exports = { PEEK, edgeState, peekPosition, outPosition, peekCursor, fullscreenApp }
