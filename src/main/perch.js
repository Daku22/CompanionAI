// perch.js — sedersi sulle finestre e sulla taskbar, come in Mate Engine.
//
// Funzioni pure: ricevono le finestre (win-windows.js, con le coordinate gia'
// convertite in DIP dal main), gli schermi e il punto di seduta dell'avatar,
// e dicono dove sedersi, dove stare mentre la finestra si muove e quando
// scendere. Il timer e le chiamate a Windows stanno in main.js.
//
// Regole e numeri come idea da AvatarWindowHandler di Mate Engine (AGPL-3.0):
// nessuna riga del suo codice.

// L'ancora e' l'ombra ai piedi dell'avatar: al rilascio deve cadere vicino al
// bordo alto, fino a 24 px sopra (come in Mate Engine) e fino a 48 px sotto.
// Con 24 px anche sotto, posarlo con l'ombra appena dentro la finestra (cioe'
// chiaramente "qui") non bastava.
const SNAP_PX = 24
const SNAP_BELOW_PX = 48
// Sulla taskbar l'ombra deve stare proprio sopra la taskbar, non sul suo bordo:
// il bordo e' il pavimento dove l'avatar sta di solito, e ogni rilascio in
// basso lo farebbe sedere.
const TASKBAR_MIN_PX = 6
// Sotto queste misure e' un menu, una notifica o un tooltip, non un sedile.
const MIN_WIDTH = 200
const MIN_HEIGHT = 60

const WS_EX_TRANSPARENT = 0x20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000
// Il desktop e la taskbar: la taskbar ha un caso a parte (taskbarSeat).
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ hwnd: number, title: string, className: string, pid: number, exStyle: number, minimized: boolean, maximized: boolean, bounds: Rect | null }} WinInfo
 * @typedef {{ id: number, bounds: Rect, workArea: Rect }} DisplayInfo
 * @typedef {{ kind: 'window' | 'taskbar', hwnd?: number, displayId?: number, fraction: number }} Seat
 *   hwnd per una finestra, displayId per la taskbar di quello schermo
 */

function contains(b, x, y) {
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
}

/** Il punto di seduta sta abbastanza vicino al bordo alto (y dello schermo). */
function nearEdge(seatY, edgeY) {
  const dy = seatY - edgeY
  return dy >= -SNAP_PX && dy <= SNAP_BELOW_PX
}

/**
 * A schermo intero: copre un intero schermo.
 * @param {Rect} b
 * @param {DisplayInfo[]} displays
 */
function isFullscreen(b, displays) {
  return displays.some(d => b.x <= d.bounds.x && b.y <= d.bounds.y &&
    b.x + b.width >= d.bounds.x + d.bounds.width && b.y + b.height >= d.bounds.y + d.bounds.height)
}

/**
 * Ci si puo' sedere sopra: una finestra vera, abbastanza grande, ne' ridotta
 * ne' massimizzata, non dell'app stessa.
 * @param {WinInfo} w
 * @param {{ ownPid: number, displays: DisplayInfo[] }} ctx
 */
function isSeatWindow(w, { ownPid, displays }) {
  if (!w.bounds || w.minimized || w.maximized || w.pid === ownPid) return false
  if (!w.title || SHELL_CLASSES.has(w.className)) return false
  if (w.bounds.width < MIN_WIDTH || w.bounds.height < MIN_HEIGHT) return false
  if (w.exStyle & (WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) return false
  return !isFullscreen(w.bounds, displays)
}

/**
 * Nasconde il punto? Conta anche la taskbar, che sta sopra tutto. Non contano
 * le sovrapposizioni trasparenti ai clic (altri companion, overlay dei giochi)
 * e le finestre dell'app.
 * @param {WinInfo} w
 */
function hides(w, x, y, ownPid) {
  if (!w.bounds || w.minimized || w.pid === ownPid) return false
  if (w.className === 'Progman' || w.className === 'WorkerW') return false
  if (w.exStyle & WS_EX_TRANSPARENT) return false
  return contains(w.bounds, x, y)
}

/**
 * La finestra su cui sedersi lasciando l'avatar con il punto di seduta qui.
 * windows e' in ordine z, dall'alto: vince la prima, e il bordo sotto il
 * punto non deve essere coperto da una finestra piu' in alto.
 * @param {WinInfo[]} windows
 * @param {{ x: number, y: number }} seat punto di seduta sullo schermo
 * @param {{ ownPid: number, displays: DisplayInfo[] }} ctx
 * @returns {Seat | null}
 */
function findWindowSeat(windows, seat, { ownPid, displays }) {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    if (!isSeatWindow(w, { ownPid, displays })) continue
    const b = w.bounds
    if (!nearEdge(seat.y, b.y)) continue
    if (seat.x < b.x || seat.x > b.x + b.width) continue
    if (windows.slice(0, i).some(o => hides(o, seat.x, b.y, ownPid))) continue
    return { kind: 'window', hwnd: w.hwnd, fraction: (seat.x - b.x) / b.width }
  }
  return null
}

/**
 * Bordo alto della taskbar in basso: lo schermo meno l'area di lavoro. Solo
 * in basso: in alto o di lato non ci si puo' sedere sopra.
 * @param {DisplayInfo} d
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function taskbarEdge(d) {
  const bottom = d.bounds.y + d.bounds.height
  const workBottom = d.workArea.y + d.workArea.height
  if (bottom - workBottom <= 0) return null
  return { x: d.workArea.x, y: workBottom, width: d.workArea.width, height: bottom - workBottom }
}

/**
 * Sulla taskbar se l'ombra cade sulla taskbar stessa.
 * @param {{ x: number, y: number }} shadow l'ancora sullo schermo
 * @param {DisplayInfo[]} displays
 * @returns {Seat | null}
 */
function findTaskbarSeat(shadow, displays) {
  for (const d of displays) {
    const edge = taskbarEdge(d)
    if (!edge || shadow.x < edge.x || shadow.x > edge.x + edge.width) continue
    const dy = shadow.y - edge.y
    if (dy >= TASKBAR_MIN_PX && dy <= edge.height) return { kind: 'taskbar', displayId: d.id, fraction: (shadow.x - edge.x) / edge.width }
  }
  return null
}

/**
 * Dove mettere la finestra dell'avatar perche' il punto di seduta stia sul
 * bordo, alla stessa frazione della larghezza: la finestra si puo' spostare e
 * ridimensionare, e l'avatar la segue.
 * @param {{ x: number, y: number, width: number }} edge
 * @param {number} fraction
 * @param {{ x: number, y: number }} anchor punto di seduta dentro la finestra dell'avatar
 */
function perchPosition(edge, fraction, anchor) {
  const f = Math.max(0, Math.min(1, fraction))
  return { x: Math.round(edge.x + f * edge.width - anchor.x), y: Math.round(edge.y - anchor.y) }
}

/**
 * Si resta seduti? No se la finestra non c'e' piu', e' nascosta, ridotta,
 * massimizzata o a schermo intero.
 * @param {{ visible: boolean, minimized: boolean, maximized: boolean, bounds: Rect | null } | null} state
 * @param {DisplayInfo[]} displays
 */
function staysSeated(state, displays) {
  return !!state && state.visible && !state.minimized && !state.maximized && !!state.bounds &&
    !isFullscreen(state.bounds, displays)
}

module.exports = {
  SNAP_PX,
  SNAP_BELOW_PX,
  isSeatWindow,
  findWindowSeat,
  findTaskbarSeat,
  taskbarEdge,
  perchPosition,
  staysSeated,
}
