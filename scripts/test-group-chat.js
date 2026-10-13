// test-group-chat.js — la chat di gruppo (src/main/group-chat.js, Blocco 8c).

const assert = require('node:assert/strict')
const G = require('../src/main/group-chat')

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

const open = [{ id: 'luma', name: 'Luma' }, { id: 'kai', name: 'Kai' }, { id: 'neve', name: 'Nève' }]
const seq = (...values) => { let i = 0; return () => values[i++ % values.length] }

console.log('=== Chat di gruppo ===')

test('chi risponde: per nome, nell\'ordine in cui compare, al massimo 2', () => {
  assert.deepEqual(G.pickResponders('Kai, cosa ne pensi?', open), ['kai'])
  assert.deepEqual(G.pickResponders('luma e kai, e voi?', open), ['luma', 'kai'])
  assert.deepEqual(G.pickResponders('Kai, Luma e Neve: ciao', open), ['kai', 'luma'])
  assert.deepEqual(G.pickResponders('ciao neve!', open), ['neve'], 'senza accento e minuscolo')
  assert.deepEqual(G.pickResponders('il kaiser', open, { rand: seq(0.9, 0.9) }), ['neve'], 'non dentro un\'altra parola')
})

test('chi risponde: la pastiglia scelta vince su tutto', () => {
  assert.deepEqual(G.pickResponders('Kai, e tu?', open, { to: 'neve' }), ['neve'])
  assert.deepEqual(G.pickResponders('ciao', open, { to: 'nessuno', rand: seq(0.1, 0.9) }), ['luma'])
})

test('chi risponde: senza nomi uno, di solito chi ha parlato, a volte un secondo', () => {
  assert.deepEqual(G.pickResponders('ciao', open, { last: 'kai', rand: seq(0.1, 0.9) }), ['kai'])
  const other = G.pickResponders('ciao', open, { last: 'kai', rand: seq(0.9, 0.0, 0.9) })
  assert.equal(other.length, 1)
  assert.notEqual(other[0], 'kai', 'a volte risponde un altro')
  const two = G.pickResponders('ciao', open, { last: 'kai', rand: seq(0.1, 0.1, 0.5) })
  assert.equal(two.length, 2)
  assert.equal(two[0], 'kai')
  assert.notEqual(two[1], 'kai', 'il secondo e\' un altro')
  assert.deepEqual(G.pickResponders('ciao', [open[0]]), ['luma'], 'da solo risponde lui')
  assert.deepEqual(G.pickResponders('ciao', []), [])
})

test('cronologia: le risposte degli altri arrivano come "Nome ha detto"', () => {
  const names = { luma: 'Luma', kai: 'Kai' }
  const h = [
    { role: 'user', content: 'ciao' },
    { role: 'assistant', content: 'ciao a te', speaker: 'luma' },
    { role: 'assistant', content: 'ehi', speaker: 'kai' },
    { role: 'assistant', content: 'vecchia risposta' },
  ]
  const forKai = G.historyFor(h, 'kai', names)
  assert.deepEqual(forKai[1], { role: 'user', content: '[Luma ha detto: ciao a te]' })
  assert.deepEqual(forKai[2], { role: 'assistant', content: 'ehi' })
  assert.deepEqual(forKai[3], { role: 'assistant', content: 'vecchia risposta' }, 'senza autore resta com\'era')
})

test('riga di gruppo: chi c\'e\', e a chi si reagisce', () => {
  assert.equal(G.groupLine([]), '')
  assert.match(G.groupLine(['Kai', 'Neve']), /anche Kai, Neve/)
  assert.match(G.groupLine(['Luma'], 'Luma'), /Luma ha appena risposto/)
  assert.equal(G.heardLine('Kai', 'ok'), '[Kai ha detto: ok]')
})

console.log(`=== ${passed} test superati ===`)
