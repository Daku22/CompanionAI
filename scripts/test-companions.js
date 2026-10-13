// test-companions.js — chi e' sul desktop e dove (src/main/companions.js, Blocco 8).

const assert = require('node:assert/strict')
const C = require('../src/main/companions')

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

console.log('=== Companion aperti ===')

test('da aprire: solo persone vere, senza doppioni, al massimo 3', () => {
  const known = ['a', 'b', 'c', 'd']
  assert.deepEqual(C.cleanOpen(['b', 'x', 'b', 'a', 'c', 'd'], known, 'a'), ['b', 'a', 'c'])
  assert.deepEqual(C.cleanOpen('rotto', known, 'c'), ['c'], 'senza elenco: la persona attiva')
  assert.deepEqual(C.cleanOpen([42, null], known, 'a'), ['a'])
  assert.deepEqual(C.cleanOpen([], [], 'a'), [], 'nessuna persona: nessuno')
})

test('posto libero: in basso a destra, poi verso sinistra, senza coprire gli altri', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 }
  const size = { width: 180, height: 260 }
  const first = C.freeSpot(area, size, [])
  assert.deepEqual(first, { x: 780, y: 540 })
  const second = C.freeSpot(area, size, [{ ...first, ...size }])
  assert.equal(second.y, 540)
  assert.ok(second.x + size.width <= first.x, 'a sinistra del primo')
  const third = C.freeSpot(area, size, [{ ...first, ...size }, { ...second, ...size }])
  assert.ok(!C.overlaps({ ...third, ...size }, { ...second, ...size }))
})

test('posto libero: con lo schermo pieno resta dentro l\'area', () => {
  const area = { x: 100, y: 0, width: 300, height: 400 }
  const size = { width: 180, height: 260 }
  const spot = C.freeSpot(area, size, [{ x: 0, y: 0, width: 1000, height: 1000 }])
  assert.ok(spot.x >= area.x - size.width && spot.y === 140)
})

test('posto salvato: vale solo se il companion ci sta per intero', () => {
  const areas = [{ x: 0, y: 0, width: 1000, height: 800 }]
  const size = { width: 180, height: 260 }
  assert.equal(C.onSomeArea({ x: 100, y: 100 }, size, areas), true)
  assert.equal(C.onSomeArea({ x: 900, y: 100 }, size, areas), false, 'mezzo fuori')
  assert.equal(C.onSomeArea({ x: 3000, y: 100 }, size, areas), false, 'schermo staccato')
  assert.equal(C.onSomeArea(null, size, areas), false)
})

test('camminata: si ferma prima di un altro companion sulla stessa fascia', () => {
  const me = { x: 100, y: 500, width: 180, height: 260 }
  const other = { x: 500, y: 520, width: 180, height: 260 }
  assert.equal(C.blockedWalk(me, 800, [other]), 500 - 180 - 12)
  assert.equal(C.blockedWalk(me, 250, [other]), 250, "prima dell'altro: libera")
  assert.equal(C.blockedWalk(me, 0, [other]), 0, "dall'altra parte: libera")
  assert.equal(C.blockedWalk({ ...me, x: 305 }, 800, [other]), null, "gia' attaccato: non si muove")
  assert.equal(C.blockedWalk(me, 800, [{ ...other, y: 0, height: 100 }]), 800, 'altra fascia: libera')
})

test("posato sopra un altro: scivola di lato, nel posto libero piu' vicino", () => {
  const area = { x: 0, width: 1000 }
  const other = { x: 400, y: 500, width: 180, height: 260 }
  assert.equal(C.nudgeAside({ x: 100, y: 500, width: 180, height: 260 }, [other], area), null, 'non si toccano')
  assert.deepEqual(C.nudgeAside({ x: 450, y: 500, width: 180, height: 260 }, [other], area), { x: 592, y: 500 })
  assert.deepEqual(C.nudgeAside({ x: 350, y: 500, width: 180, height: 260 }, [other], area), { x: 208, y: 500 })
})

console.log(`=== ${passed} test superati ===`)
