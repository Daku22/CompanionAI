// win-windows.js — le finestre degli altri programmi, lette da Windows.
//
// Electron non elenca le finestre degli altri programmi: servono user32 e
// dwmapi, chiamati con koffi (MIT, FFI senza compilazione; il binario sta in
// @koromix/koffi-win32-x64). Serve alla seduta su finestre e taskbar, e piu'
// avanti a schermo intero, bordi e app attiva.
//
// Se koffi non si carica (altro sistema, pacchetto rotto) il modulo si spegne:
// available() dice false, le funzioni restituiscono valori vuoti e il resto
// dell'app funziona.
//
// Gli handle sono numeri (intptr_t), non oggetti puntatore: si confrontano e
// si conservano come qualsiasi numero. Le coordinate sono in pixel fisici,
// come le da' Windows: in Electron vanno convertite con screen.screenToDipRect.

const GWL_EXSTYLE = -20
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14

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

module.exports = { available, unavailableReason, listWindows, foregroundWindow }
