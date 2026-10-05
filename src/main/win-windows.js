// win-windows.js — le finestre degli altri programmi, lette da Windows.
//
// Electron non elenca le finestre degli altri programmi: servono user32 e
// dwmapi, chiamati con koffi (MIT, FFI senza compilazione; il binario sta in
// @koromix/koffi-win32-x64). Serve alla seduta su finestre e taskbar, alla
// scorciatoia del microfono (quando si lascia il tasto), e piu' avanti a
// schermo intero, bordi e app attiva.
//
// Se koffi non si carica (altro sistema, pacchetto rotto) il modulo si spegne:
// available() dice false, le funzioni restituiscono valori vuoti e il resto
// dell'app funziona.
//
// Gli handle sono numeri (intptr_t), non oggetti puntatore: si confrontano e
// si conservano come qualsiasi numero. Le coordinate sono in pixel fisici,
// come le da' Windows: in Electron vanno convertite con screen.screenToDipRect.

const GWL_EXSTYLE = -20
const WS_EX_TOPMOST = 0x8
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const GW_HWNDNEXT = 2
const GW_HWNDPREV = 3
const HWND_TOP = 0
const SWP_NOSIZE = 0x1
const SWP_NOMOVE = 0x2
const SWP_NOACTIVATE = 0x10
const SWP_NOOWNERZORDER = 0x200

/** @type {any} */
let api = null
/** @type {Error|null} */
let loadError = null

function load() {
  if (api || loadError) return api
  if (process.platform !== 'win32') { loadError = new Error('solo su Windows'); return null }
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)')
    api = {
      koffi,
      EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ char16_t *text, int max)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ char16_t *text, int max)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
      GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32 cmd)'),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int key)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
      DwmRect: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ RECT *value, uint32 size)'),
      DwmInt: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)'),
    }
  } catch (e) {
    loadError = e
    api = null
  }
  return api
}

function available() { return !!load() }

/** Perche' non e' disponibile, per il log; null se funziona. */
function unavailableReason() {
  load()
  return loadError ? loadError.message : null
}

function readText(fn, hwnd) {
  const max = 512
  const buf = Buffer.alloc(max * 2)
  const n = fn(hwnd, buf, max)
  return n > 0 ? api.koffi.decode(buf, 'char16_t', n) : ''
}

/**
 * Rettangolo visibile. Su Windows 10/11 GetWindowRect include circa 7 px di
 * bordo invisibile: senza DWM l'avatar sembrerebbe sospeso sopra la finestra.
 */
function frameBounds(hwnd) {
  const r = {}
  if (api.DwmRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0 && !api.GetWindowRect(hwnd, r)) return null
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
}

/** Nascosta da DWM: su un altro desktop virtuale, o un'app sospesa. */
function isCloaked(hwnd) {
  const value = [0]
  return api.DwmInt(hwnd, DWMWA_CLOAKED, value, 4) === 0 && value[0] !== 0
}

/**
 * Finestre di primo livello visibili e non nascoste da DWM, dall'alto in basso
 * (ordine z). Le altre regole (titolo, dimensioni, stile, processo) le decide
 * chi le usa: vedi perch.js.
 * @returns {{ hwnd: number, title: string, className: string, pid: number, exStyle: number, minimized: boolean, maximized: boolean, bounds: {x: number, y: number, width: number, height: number} | null }[]}
 */
function listWindows() {
  if (!load()) return []
  const out = []
  api.EnumWindows((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd) || isCloaked(hwnd)) return true
      const pid = [0]
      api.GetWindowThreadProcessId(hwnd, pid)
      out.push({
        hwnd: Number(hwnd),
        title: readText(api.GetWindowTextW, hwnd),
        className: readText(api.GetClassNameW, hwnd),
        pid: pid[0],
        exStyle: Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)),
        minimized: !!api.IsIconic(hwnd),
        maximized: !!api.IsZoomed(hwnd),
        bounds: frameBounds(hwnd),
      })
    } catch (_) {}
    return true
  }, 0)
  return out
}

/** La finestra in primo piano, 0 se non si sa. */
function foregroundWindow() {
  if (!load()) return 0
  try { return Number(api.GetForegroundWindow()) } catch (_) { return 0 }
}

/** Titolo e processo di una finestra (Blocco 7c, l'app attiva); null se non si sa. */
function windowInfo(hwnd) {
  if (!load() || !hwnd) return null
  try {
    const pid = [0]
    api.GetWindowThreadProcessId(hwnd, pid)
    return { title: readText(api.GetWindowTextW, hwnd), pid: pid[0] }
  } catch (_) { return null }
}

/**
 * Stato di una finestra sola, per seguirla senza rileggere tutte le altre.
 * null se non esiste piu'.
 * @param {number} hwnd
 */
function windowState(hwnd) {
  if (!load() || !hwnd) return null
  try {
    if (!api.IsWindow(hwnd)) return null
    return {
      hwnd,
      visible: !!api.IsWindowVisible(hwnd) && !isCloaked(hwnd),
      minimized: !!api.IsIconic(hwnd),
      maximized: !!api.IsZoomed(hwnd),
      bounds: frameBounds(hwnd),
    }
  } catch (_) { return null }
}

/** Prima finestra visibile sopra (GW_HWNDPREV) o sotto (GW_HWNDNEXT), saltando quelle in skip. */
function neighbour(hwnd, cmd, skip) {
  let h = Number(api.GetWindow(hwnd, cmd))
  // Fra una finestra e l'altra ci sono molte finestre invisibili: il limite
  // evita di girare a vuoto se l'ordine cambia durante la lettura.
  for (let i = 0; h && i < 1000; i++) {
    if (!skip.has(h) && api.IsWindowVisible(h) && !isCloaked(h)) return h
    h = Number(api.GetWindow(h, cmd))
  }
  return 0
}

/**
 * Mette own subito sopra target nell'ordine z, senza attivarla: cosi' le
 * finestre davanti a quella su cui l'avatar siede coprono anche lui, come in
 * una scrivania vera. own non deve essere "sempre in primo piano".
 * @param {number} own
 * @param {number} target
 * @param {number[]} [skip] altre finestre dell'app, da non contare
 * @returns {boolean} true se ha dovuto spostarla
 */
function placeAbove(own, target, skip = []) {
  if (!load() || !own || !target) return false
  try {
    const ignore = new Set([own, ...skip])
    if (neighbour(own, GW_HWNDNEXT, ignore) === target) return false
    const above = neighbour(target, GW_HWNDPREV, ignore)
    // Sopra target c'e' solo una finestra "sempre in primo piano" (o niente):
    // own va in cima alle finestre normali, cioe' subito sopra target.
    const topmost = above && (Number(api.GetWindowLongPtrW(above, GWL_EXSTYLE)) & WS_EX_TOPMOST)
    const after = !above || topmost ? HWND_TOP : above
    return !!api.SetWindowPos(own, after, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
  } catch (_) { return false }
}

/**
 * Handle nativo di una BrowserWindow (Buffer di getNativeWindowHandle) come numero.
 * @param {Buffer} buf
 */
function handleOf(buf) {
  if (!buf || buf.length < 4) return 0
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
}

/**
 * Il tasto e' premuto adesso (codice virtuale di Windows)? Per la scorciatoia
 * del microfono: Electron dice quando la si preme, non quando la si lascia.
 * @param {number} vk
 */
function isKeyDown(vk) {
  if (!load() || !vk) return false
  return (api.GetAsyncKeyState(vk) & 0x8000) !== 0
}

module.exports = { available, unavailableReason, listWindows, foregroundWindow, windowInfo, windowState, placeAbove, handleOf, isKeyDown }
