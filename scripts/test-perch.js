// test-perch.js — sedersi su finestre e taskbar, con finestre finte.

const assert = require('node:assert/strict')
const { findWindowSeat, findTaskbarSeat, taskbarEdge, perchPosition, staysSeated, isSeatWindow } = require('../src/main/perch')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const OWN = 4242
// Schermo 1920x1080 con la taskbar in basso, alta 48.
const DISPLAY = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } }
const ctx = { ownPid: OWN, displays: [DISPLAY] }

function win(hwnd, bounds, extra = {}) {
  return { hwnd, title: 'Finestra ' + hwnd, className: 'Notepad', pid: 100 + hwnd, exStyle: 0, minimized: false, maximized: false, bounds, ...extra }
}

const notepad = win(1, { x: 400, y: 300, width: 800, height: 500 })

test('si siede se il punto di seduta cade vicino al bordo alto', () => {
  const seat = findWindowSeat([notepad], { x: 600, y: 310 }, ctx)
  assert.deepEqual(seat, { kind: 'window', hwnd: 1, fraction: 0.25 })
  assert.equal(findWindowSeat([notepad], { x: 600, y: 290 }, ctx).hwnd, 1, 'anche poco sopra')
  // Posato con il bacino appena dentro la finestra: la voleva li'.
  assert.equal(findWindowSeat([notepad], { x: 600, y: 340 }, ctx).hwnd, 1, 'fino a 48 px sotto')
})

test('troppo lontano dal bordo, o fuori dalla larghezza, no', () => {
  assert.equal(findWindowSeat([notepad], { x: 600, y: 360 }, ctx), null, '60 px sotto')
  assert.equal(findWindowSeat([notepad], { x: 600, y: 270 }, ctx), null, '30 px sopra')
  assert.equal(findWindowSeat([notepad], { x: 300, y: 300 }, ctx), null)
})

test('le finestre che non sono sedili vengono scartate', () => {
  const b = { x: 400, y: 300, width: 800, height: 500 }
  assert.ok(!isSeatWindow(win(2, b, { pid: OWN }), ctx), "le finestre dell'app")
  assert.ok(!isSeatWindow(win(2, b, { title: '' }), ctx), 'senza titolo')
  assert.ok(!isSeatWindow(win(2, b, { minimized: true }), ctx), 'ridotta')
  assert.ok(!isSeatWindow(win(2, b, { maximized: true }), ctx), 'massimizzata')
  assert.ok(!isSeatWindow(win(2, b, { className: 'Progman' }), ctx), 'il desktop')
  assert.ok(!isSeatWindow(win(2, { x: 0, y: 0, width: 150, height: 40 }), ctx), 'troppo piccola')
  assert.ok(!isSeatWindow(win(2, b, { exStyle: 0x20 }), ctx), 'trasparente ai clic')
  assert.ok(!isSeatWindow(win(2, b, { exStyle: 0x80 }), ctx), 'finestra strumenti')
  assert.ok(!isSeatWindow(win(2, { x: 0, y: 0, width: 1920, height: 1080 }), ctx), 'a schermo intero')
})

test('un bordo coperto da una finestra piu\' in alto non conta', () => {
  const cover = win(9, { x: 500, y: 200, width: 300, height: 300 })
  assert.equal(findWindowSeat([cover, notepad], { x: 600, y: 300 }, ctx), null, 'coperto proprio li\'')
  assert.equal(findWindowSeat([cover, notepad], { x: 1000, y: 300 }, ctx).hwnd, 1, 'altrove si')
  // Un overlay trasparente ai clic, o una finestra dell'app, non copre.
  const overlay = win(8, { x: 0, y: 0, width: 1920, height: 1080 }, { exStyle: 0x20 })
  assert.equal(findWindowSeat([overlay, notepad], { x: 600, y: 300 }, ctx).hwnd, 1)
})

test('vince la finestra piu\' in alto', () => {
  const upper = win(5, { x: 300, y: 305, width: 700, height: 400 })
  assert.equal(findWindowSeat([upper, notepad], { x: 600, y: 303 }, ctx).hwnd, 5)
})

test('la taskbar in basso fa da sedile se l\'ombra ci cade sopra, in alto no', () => {
  assert.deepEqual(taskbarEdge(DISPLAY), { x: 0, y: 1032, width: 1920, height: 48 })
  assert.deepEqual(findTaskbarSeat({ x: 960, y: 1050 }, [DISPLAY]), { kind: 'taskbar', displayId: 1, fraction: 0.5 })
  // Sul bordo (il pavimento di sempre) o sopra: resta a terra.
  assert.equal(findTaskbarSeat({ x: 960, y: 1032 }, [DISPLAY]), null)
  assert.equal(findTaskbarSeat({ x: 960, y: 1020 }, [DISPLAY]), null)
  assert.equal(findTaskbarSeat({ x: 960, y: 900 }, [DISPLAY]), null)
  const topBar = { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 48, width: 1920, height: 1032 } }
  assert.equal(taskbarEdge(topBar), null)
})

test('la posizione segue il bordo alla stessa frazione', () => {
  const anchor = { x: 160, y: 230 }
  assert.deepEqual(perchPosition({ x: 400, y: 300, width: 800 }, 0.25, anchor), { x: 440, y: 70 })
  // La finestra si sposta e si allarga: l'avatar resta a un quarto.
  assert.deepEqual(perchPosition({ x: 100, y: 500, width: 1200 }, 0.25, anchor), { x: 240, y: 270 })
  // Una frazione fuori dal bordo viene riportata dentro.
  assert.deepEqual(perchPosition({ x: 0, y: 0, width: 100 }, 1.5, { x: 0, y: 0 }), { x: 100, y: 0 })
})

test('si scende se la finestra sparisce, si riduce, si massimizza o va a schermo intero', () => {
  const ok = { visible: true, minimized: false, maximized: false, bounds: { x: 400, y: 300, width: 800, height: 500 } }
  assert.ok(staysSeated(ok, [DISPLAY]))
  assert.ok(!staysSeated(null, [DISPLAY]), 'chiusa')
  assert.ok(!staysSeated({ ...ok, visible: false }, [DISPLAY]), 'nascosta')
  assert.ok(!staysSeated({ ...ok, minimized: true }, [DISPLAY]), 'ridotta')
  assert.ok(!staysSeated({ ...ok, maximized: true }, [DISPLAY]), 'massimizzata')
  assert.ok(!staysSeated({ ...ok, bounds: DISPLAY.bounds }, [DISPLAY]), 'a schermo intero')
})

console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
