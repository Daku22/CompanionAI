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

console.log(`=== ${passed} test superati ===`)
