// test-screens.js — quale schermo guarda il companion (src/main/screens.js).
const assert = require('node:assert/strict')
const S = require('../src/main/screens')

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
console.log('=== Schermi ===')

// Come quelli dell'utente: il principale a sinistra, uno piccolo a destra.
const main = { id: 2528732444, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, primary: true }
const side = { id: 2779098405, bounds: { x: 1920, y: 0, width: 1024, height: 768 }, size: { width: 1024, height: 768 }, label: 'Generic PnP' }

test('la scelta salvata: companion, tutti o un monitor', () => {
  assert.equal(S.cleanScreenChoice('all'), 'all')
  assert.equal(S.cleanScreenChoice('display:2779098405'), 'display:2779098405')
  assert.equal(S.cleanScreenChoice('display:../x'), 'companion')
  assert.equal(S.cleanScreenChoice(42), 'companion')
  assert.equal(S.cleanScreenChoice(undefined), 'companion')
})

test('quali monitor si fotografano', () => {
  assert.deepEqual(S.pickDisplays([side, main], 'companion', side.id).map(d => d.id), [side.id], 'quello del companion')
  assert.deepEqual(S.pickDisplays([side, main], 'display:' + main.id, side.id).map(d => d.id), [main.id], 'quello scelto')
  assert.deepEqual(S.pickDisplays([side, main], 'display:1', side.id).map(d => d.id), [side.id], 'scelto ma staccato: quello del companion')
  assert.deepEqual(S.pickDisplays([side, main], 'all', main.id).map(d => d.id), [main.id, side.id], 'tutti, da sinistra')
  assert.deepEqual(S.pickDisplays([], 'all', 1), [])
})

test('le card della pagina Visione', () => {
  const two = S.screenOptions([side, main], side.id)
  assert.deepEqual(two.map(o => o.choice), ['companion', 'display:' + main.id, 'display:' + side.id, 'all'])
  assert.equal(two[0].sub, 'ora: Monitor 2')
  assert.equal(two[1].label, 'Monitor 1')
  assert.equal(two[1].sub, '1920×1080 · principale')
  assert.equal(two[2].label, 'Monitor 2 · Generic PnP')
  assert.deepEqual(two[3].ids, [main.id, side.id])
  assert.deepEqual(S.screenOptions([main], main.id).map(o => o.choice), ['companion', 'display:' + main.id], 'un monitor solo: niente "tutti"')
})

test('i monitor affiancati nell\'immagine, nelle loro posizioni', () => {
  const one = S.layout([main], 1568)
  assert.deepEqual([one.width, one.height], [1568, 882])
  const both = S.layout([main, side], 1568)
  assert.equal(both.width, 1568)
  assert.equal(both.height, Math.round(1080 * 1568 / 2944))
  assert.deepEqual(both.parts[1], { id: side.id, x: Math.round(1920 * 1568 / 2944), y: 0, width: Math.round(1024 * 1568 / 2944), height: Math.round(768 * 1568 / 2944) })
})

test('l\'immagine d\'insieme: ogni pezzo al suo posto, il resto nero', () => {
  const red = Buffer.from([0, 0, 255, 255, 0, 0, 255, 255])        // 2x1 rosso
  const blue = Buffer.from([255, 0, 0, 255])                        // 1x1 blu
  const out = S.compose(3, 2, [{ x: 0, y: 0, width: 2, height: 1, bitmap: red }, { x: 2, y: 1, width: 1, height: 1, bitmap: blue }])
  const px = (x, y) => [...out.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)]
  assert.deepEqual(px(0, 0), [0, 0, 255, 255])
  assert.deepEqual(px(1, 0), [0, 0, 255, 255])
  assert.deepEqual(px(2, 1), [255, 0, 0, 255])
  assert.deepEqual(px(0, 1), [0, 0, 0, 255], 'nero dove non c\'e\' un monitor')
  const clipped = S.compose(2, 1, [{ x: 1, y: 0, width: 2, height: 1, bitmap: red }])
  assert.equal(clipped.length, 8, 'un pezzo che sborda non scrive fuori')
})

console.log('=== ' + passed + ' test superati ===')
