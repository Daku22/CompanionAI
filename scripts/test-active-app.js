// test-active-app.js — l'app attiva (src/main/active-app.js).

const assert = require('node:assert/strict')
const A = require('../src/main/active-app')

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

console.log('=== App attiva ===')

test('la finestra in primo piano diventa una riga di contesto', () => {
  const line = A.activeAppLine({ title: '  progetto.docx  - Word ', pid: 10 }, A.IGNORE_DEFAULT, 1)
  assert.ok(line.includes('"progetto.docx - Word"'))
})

test('niente riga: nessuna finestra, la nostra, o una da ignorare', () => {
  assert.equal(A.activeAppLine(null, [], 1), null)
  assert.equal(A.activeAppLine({ title: '', pid: 10 }, [], 1), null)
  assert.equal(A.activeAppLine({ title: 'Chat', pid: 1 }, [], 1), null)
  assert.equal(A.activeAppLine({ title: 'Database.kdbx - KeePass', pid: 10 }, A.IGNORE_DEFAULT, 1), null)
  assert.equal(A.activeAppLine({ title: 'Nuova scheda - InPrivate - Microsoft Edge', pid: 10 }, A.IGNORE_DEFAULT, 1), null)
  assert.equal(A.activeAppLine({ title: 'Banca online', pid: 10 }, ['banca'], 1), null, 'maiuscole e minuscole non contano')
})

test('titoli lunghi tagliati', () => {
  const line = A.activeAppLine({ title: 'x'.repeat(500), pid: 10 }, [], 1)
  assert.ok(line.includes('x'.repeat(120) + '…') && !line.includes('x'.repeat(121)))
})

test('l\'elenco da ignorare dal renderer si controlla', () => {
  assert.deepEqual(A.cleanIgnore([' Banca ', 'banca', 'x', 42, 'a'.repeat(80)]), ['Banca', 'a'.repeat(60)])
  assert.equal(A.cleanIgnore('banca'), null)
  assert.equal(A.cleanIgnore(Array.from({ length: 60 }, (_, i) => 'parola' + i)).length, 40)
})

console.log(`=== ${passed} test superati ===`)
