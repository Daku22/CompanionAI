// test-objects.js — gli oggetti della borsa (src/main/objects.js, Blocco 10c).

const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const O = require('../src/main/objects')

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

const DIR = path.join(__dirname, '..', 'modelli-3d', 'objects')
const included = O.loadIncluded(DIR)

test('gli oggetti inclusi: pallone, gomitolo, orsetto, cuscino, con modello e icona', () => {
  assert.deepEqual(included.map(o => o.id + ':' + o.type), ['pallone:throw', 'gomitolo:throw', 'orsetto:hug', 'cuscino:hug'])
  for (const o of included) {
    assert.ok(fs.existsSync(path.join(DIR, o.id + '.glb')), 'manca il modello di ' + o.id)
    assert.ok(fs.existsSync(path.join(DIR, 'icons', o.id + '.png')), "manca l'icona di " + o.id)
    assert.equal(o.url, 'vrm://objects/' + o.id + '.glb')
  }
  assert.ok(included[0].bounce > included[2].bounce, 'il pallone rimbalza piu\' dell\'orsetto')
})

test('un catalogo scritto male non rompe niente', () => {
  assert.deepEqual(O.cleanIncluded({ items: [{ id: '../x', name: 'X', type: 'throw' }, { id: 'y', name: 'Y', type: 'arma' }, { id: 'z', type: 'hug' }] }), [])
  const [o] = O.cleanIncluded({ items: [{ id: 'k', name: 'Palla', type: 'throw', size: 50, bounce: 7 }] })
  assert.deepEqual([o.size, o.bounce], [0.3, 0.95])
})

test("il tipo di un oggetto importato: solo quelli ammessi, nome e misura ripuliti", () => {
  assert.equal(O.cleanMeta({ type: 'esplode' }), null)
  assert.deepEqual(O.cleanMeta({ type: 'throw', name: '  Palla\nmia ', size: 0.25 }), { type: 'throw', name: 'Palla mia', size: 0.25 })
  assert.deepEqual(O.cleanMeta({ type: 'decor', size: 99 }, 'Vaso'), { type: 'decor', name: 'Vaso', size: 0.3 })
  const fresh = O.fromRecord({ id: 'abc', name: 'tazza', url: 'object://abc/tazza.glb' })
  assert.equal(fresh.type, 'decor', 'appena importato, finche\' non si sceglie, e\' una decorazione')
  assert.equal(fresh.typed, false)
  const typed = O.fromRecord({ id: 'abc', name: 'tazza', url: 'object://abc/tazza.glb', meta: { type: 'drink', name: 'Tazza', size: 0.1 } })
  assert.deepEqual([typed.type, typed.name, typed.typed], ['drink', 'Tazza', true])
})

test('un oggetto cibo o bevanda si mangia come gli altri', () => {
  const tazza = O.fromRecord({ id: 'abc', name: 'tazza', url: 'object://abc/t.glb', meta: { type: 'drink', name: 'Tazza', size: 0.1 } })
  const food = O.asFood(tazza)
  assert.equal(food.kind, 'drink')
  assert.ok(food.thirst > 0 && food.url === 'object://abc/t.glb')
  assert.equal(O.asFood(included[0]), null, 'un pallone non si mangia')
  assert.deepEqual(O.publicObject(included[2]).typeLabel, 'Da abbracciare')
})

console.log(`=== ${passed} test superati ===`)
