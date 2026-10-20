// test-food.js — il catalogo di cibi e bevande (src/main/food.js, Blocco 10b).

const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const F = require('../src/main/food')

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

const DIR = path.join(__dirname, '..', 'modelli-3d', 'food')
const catalog = F.loadCatalog(DIR)

test('il catalogo incluso: cibi e bevande, ognuno con il suo modello', () => {
  assert.ok(catalog.filter(i => i.kind === 'food').length >= 10)
  assert.ok(catalog.filter(i => i.kind === 'drink').length >= 5)
  for (const it of catalog) {
    assert.ok(fs.existsSync(path.join(DIR, it.id + '.glb')), 'manca il modello di ' + it.id)
    assert.ok(fs.existsSync(path.join(DIR, 'icons', it.id + '.png')), "manca l'icona di " + it.id)
    assert.ok(it.kind === 'drink' ? it.thirst > 0 : it.hunger > 0, it.id + ' deve saziare o dissetare')
  }
})

test('un catalogo scritto male non rompe niente', () => {
  assert.deepEqual(F.cleanCatalog(null), [])
  const c = F.cleanCatalog({ items: [
    { id: '../x', name: 'Furbo', kind: 'food' },
    { id: 'ok', name: 'Buono', kind: 'food', hunger: 5, thirst: -1, size: 40, words: ['Buonò', 3] },
    { id: 'ok', name: 'Doppio', kind: 'food' },
    { id: 'strano', name: 'Strano', kind: 'pozione' },
  ] })
  assert.equal(c.length, 1)
  assert.deepEqual([c[0].hunger, c[0].thirst, c[0].size, c[0].words], [1, 0, 0.1, ['buono']])
})

test('in chat si riconosce il cibo, anche senza accenti, a parole intere', () => {
  assert.equal(F.findFood(catalog, 'Ti preparo un tè caldo').id, 'te')
  assert.equal(F.findFood(catalog, 'vuoi un te?').id, 'te')
  assert.equal(F.findFood(catalog, 'ecco un CAFFE').id, 'caffe')
  assert.equal(F.findFood(catalog, 'una bella fetta di torta').id, 'torta')
  assert.equal(F.findFood(catalog, 'ti va una polpetta di riso?').id, 'onigiri')
  assert.equal(F.findFood(catalog, 'teatro e telefono'), null, 'non dentro altre parole')
  assert.equal(F.findFood(catalog, 'ti porto qualcosa'), null)
  assert.equal(F.findFood(catalog, 'latte', 'food'), null, 'il latte e\' una bevanda')
  assert.equal(F.findFood(catalog, 'latte', 'drink').id, 'latte')
})

test('effetti, ringraziamenti e memoria', () => {
  const caffe = catalog.find(i => i.id === 'caffe')
  assert.deepEqual(F.effectsOf(caffe), { hunger: 0, thirst: 0.3, joy: 0.05, energy: 0.15 })
  assert.match(F.memoryLine(caffe), /da bere: un caffè/)
  assert.match(F.memoryLine(catalog.find(i => i.id === 'mela')), /da mangiare: una mela/)
  assert.ok(F.thanks(caffe, () => 0).length > 0)
  assert.deepEqual(F.publicItem(caffe), { id: 'caffe', name: 'Caffè', kind: 'drink' })
})

console.log(`=== ${passed} test superati ===`)
