// test-edge-peek.js — sbirciare dal bordo (src/main/edge-peek.js).
const assert = require('assert/strict')
const { PEEK, edgeState, peekPosition, outPosition, peekCursor, fullscreenApp } = require('../src/main/edge-peek')

let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ok  ' + name) } catch (err) {
    process.exitCode = 1
    console.error('  FALLITO  ' + name + '\n     ' + err.message)
  }
}
console.log('=== Sbirciare dal bordo ===')

// Due schermi affiancati, il secondo piu' basso; la taskbar in basso sul primo.
const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const B = { id: 2, bounds: { x: 1920, y: 200, width: 1280, height: 1024 }, workArea: { x: 1920, y: 200, width: 1280, height: 1024 } }
const W = 180, H = 260, MID = 90   // finestra del companion, centro dell'avatar
const win = (x, y = 500) => ({ x, y, width: W, height: H })

test('dentro lo schermo, o fuori meno di meta\': niente', () => {
  assert.equal(edgeState(win(800), MID, [A]), null)
  assert.equal(edgeState(win(-80), MID, [A]), null)   // centro a 10 px dentro
  assert.equal(edgeState(win(1920 - 100), MID, [A]), null)
})

test('oltre meta\' fuori a sinistra o a destra: sbircia da quel bordo', () => {
  const left = edgeState(win(-120), MID, [A])
  assert.equal(left.side, 'left')
  assert.equal(left.edgeX, 0)
  assert.equal(left.displayId, 1)
  const right = edgeState(win(1920 - 60), MID, [A])
  assert.equal(right.side, 'right')
  assert.equal(right.edgeX, 1920)
})

test('verso un altro schermo non e\' un bordo', () => {
  // Il centro passa sul secondo schermo: ci va, non sbircia.
  assert.equal(edgeState(win(1920 - 60, 500), MID, [A, B]), null)
  // Piu' in alto il secondo schermo non c'e': li' il bordo destro del primo e' esterno.
  assert.equal(edgeState(win(1920 - 60, 20), MID, [A, B]).side, 'right')
  // Il bordo sinistro del secondo, sotto il primo schermo.
  const b = edgeState(win(1920 - 120, 1040), MID, [A, B])
  assert.equal(b.side, 'left')
  assert.equal(b.displayId, 2)
})

test('lontano dal bordo o fuori in verticale: niente', () => {
  assert.equal(edgeState(win(-400), MID, [A]), null)
  assert.equal(edgeState(win(-120, 1200), MID, [A]), null)
  assert.equal(edgeState(null, MID, [A]), null)
  assert.equal(edgeState(win(-120), NaN, [A]), null)
})

test('sbircia: il taglio sul bordo, l\'altezza dentro l\'area di lavoro', () => {
  const left = edgeState(win(-120, 900), MID, [A])
  // Fuori a sinistra si vede la parte destra della finestra, oltre il taglio.
  assert.deepEqual(peekPosition(left, 120, win(-120, 900), MID), { x: -120, y: 1040 - H })
  const right = edgeState(win(1880), MID, [A])
  assert.deepEqual(peekPosition(right, 60, win(1880), MID), { x: 1860, y: 500 })
})

test('sbircia: il taglio resta dentro la finestra, e senza misura c\'e\' un ripiego', () => {
  const left = edgeState(win(-120), MID, [A])
  assert.equal(peekPosition(left, -50, win(-120), MID).x, -Math.round(PEEK.CUT_MIN * W))
  assert.equal(peekPosition(left, 999, win(-120), MID).x, -Math.round(PEEK.CUT_MAX * W))
  // Senza misura: un quarto di finestra dal centro verso l'esterno.
  assert.equal(peekPosition(left, null, win(-120), MID).x, -(MID + PEEK.DEFAULT_CUT * W))
  const right = edgeState(win(1880), MID, [A])
  assert.equal(peekPosition(right, undefined, win(1880), MID).x, 1920 - (MID - PEEK.DEFAULT_CUT * W))
})

test('esce: tutto dentro, accanto al bordo da cui sbirciava', () => {
  const left = edgeState(win(-120), MID, [A])
  assert.deepEqual(outPosition(left, win(-120)), { x: 0, y: 500 })
  const right = edgeState(win(1880, 900), MID, [A])
  assert.deepEqual(outPosition(right, win(1880, 900)), { x: 1920 - W, y: 1040 - H })
})

test('cursore: prima si allontana, poi avvicinandosi lo fa uscire', () => {
  const spot = { x: 10, y: 400 }
  let s = peekCursor(false, { x: 30, y: 420 }, spot)
  assert.deepEqual(s, { armed: false, exit: false }, 'al rilascio il cursore e\' li\'')
  s = peekCursor(s.armed, { x: 600, y: 400 }, spot)
  assert.deepEqual(s, { armed: true, exit: false })
  s = peekCursor(s.armed, { x: 10 + PEEK.NEAR_PX + 20, y: 400 }, spot)
  assert.equal(s.exit, false)
  s = peekCursor(s.armed, { x: 60, y: 430 }, spot)
  assert.equal(s.exit, true)
})

test('app a schermo intero sopra le altre: non sbircia; desktop, taskbar e finestre normali si\'', () => {
  const companion = { hwnd: 9, className: 'Companion', pid: 99, minimized: false, bounds: { x: 0, y: 0, width: 300, height: 400 } }
  const game = { hwnd: 1, className: 'UnityWndClass', pid: 10, minimized: false, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  const notepad = { hwnd: 3, className: 'Notepad', pid: 12, minimized: false, bounds: { x: 100, y: 100, width: 800, height: 600 } }
  const desktop = { hwnd: 2, className: 'Progman', pid: 11, minimized: false, bounds: { x: 0, y: 0, width: 3200, height: 1224 } }
  const taskbar = { hwnd: 4, className: 'Shell_TrayWnd', pid: 11, minimized: false, bounds: { x: 0, y: 1040, width: 1920, height: 40 } }
  const overlay = { hwnd: 5, className: 'Overlay', pid: 13, exStyle: 0x20, minimized: false, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  // Il companion in cima (appena rilasciato), poi il gioco a schermo intero.
  assert.equal(fullscreenApp([companion, taskbar, overlay, game, notepad, desktop], A, 99), true)
  assert.equal(fullscreenApp([companion, taskbar, game, desktop], B, 99), false, 'su un altro schermo')
  assert.equal(fullscreenApp([companion, notepad, game, desktop], A, 99), false, 'una finestra normale sopra')
  assert.equal(fullscreenApp([companion, taskbar, desktop], A, 99), false, 'solo il desktop')
  assert.equal(fullscreenApp([], A, 99), false)
  // Con la taskbar nascosta un browser massimizzato copre lo schermo: non e' schermo intero.
  const browser = { hwnd: 6, className: 'Chrome_WidgetWin_1', pid: 14, minimized: false, maximized: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  assert.equal(fullscreenApp([companion, taskbar, browser, desktop], A, 99), false, 'massimizzata')
})

console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
