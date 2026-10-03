// test-personas.js — le Persone (src/main/personas.js).

const assert = require('node:assert/strict')
const path = require('path')
const P = require('../src/main/personas')

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

console.log('=== Persone ===')

test('senza file nasce "default" con avatar e voce di oggi', () => {
  const s = P.normalize(null, { avatarModel: 'fred', voice: { engine: 'kokoro' } })
  assert.equal(s.activeId, 'default')
  assert.deepEqual(s.list, [{ id: 'default', name: 'Companion', prompt: '', avatarModel: 'fred', voice: { engine: 'kokoro' } }])
})

test('id non validi o doppi si scartano, attiva sconosciuta -> la prima', () => {
  const s = P.normalize({ activeId: 'boh', list: [{ id: '../x' }, { id: 'Elsa' }, { id: 'elsa', name: 'Elsa' }, { id: 'elsa' }] })
  assert.deepEqual(s.list.map(p => p.id), ['elsa'])
  assert.equal(s.activeId, 'elsa')
})

test('crea: id dal nome, unico, eredita avatar e voce dell\'attiva', () => {
  let s = P.normalize(null, { avatarModel: 'neko' })
  const a = P.create(s, '  Élsa   la Gatta ')
  assert.equal(a.id, 'elsa-la-gatta')
  s = a.state
  assert.equal(P.create(s, 'Elsa la gatta').id, 'elsa-la-gatta-2')
  assert.equal(s.list[1].avatarModel, 'neko')
  assert.equal(P.create(s, '   '), null)
  assert.equal(P.create(s, '!!!').id, 'persona')
})

test('rinomina e personalita\', con i limiti', () => {
  let s = P.create(P.normalize(null), 'Bob').state
  s = P.update(s, 'bob', { name: 'Roberto', prompt: 'x'.repeat(5000) })
  assert.equal(s.list[1].name, 'Roberto')
  assert.equal(s.list[1].prompt.length, P.MAX_PROMPT)
  assert.deepEqual(P.update(s, 'bob', { voice: { engine: 'kokoro', kokoroVoice: 'im_nicola', volume: 1 } }).list[1].voice, { engine: 'kokoro', kokoroVoice: 'im_nicola' })
  assert.equal(P.update(s, 'bob', { name: ' ' }), null)
  assert.equal(P.update(s, 'nessuno', { name: 'x' }), null)
})

test('elimina: mai l\'ultima; se era attiva tocca alla prima', () => {
  let s = P.normalize(null)
  assert.equal(P.remove(s, 'default'), null)
  s = P.activate(P.create(s, 'Bob').state, 'bob')
  s = P.remove(s, 'bob')
  assert.equal(s.activeId, 'default')
  assert.equal(P.activate(s, 'bob'), null)
})

test('snapshot: avatar e voce restano alla persona che si lascia', () => {
  let s = P.create(P.normalize(null, { avatarModel: 'fred' }), 'Bob').state
  s = P.snapshot(s, { avatarModel: 'neko', voice: { engine: 'xtts', enabled: true, micEnabled: true } })
  assert.deepEqual(s.list[0].voice, { engine: 'xtts' })
  s = P.activate(s, 'bob')
  assert.equal(s.list[0].avatarModel, 'neko')
  assert.equal(P.active(s).avatarModel, 'fred')
})

test('prompt: la personalita\' davanti al prompt di base, solo se c\'e\'', () => {
  assert.equal(P.systemPrompt({ name: 'Bob', prompt: '' }, 'BASE'), 'BASE')
  const out = P.systemPrompt({ name: 'Bob', prompt: 'Sei pigro.' }, 'BASE')
  assert.ok(out.startsWith('Ti chiami Bob.') && out.includes('Sei pigro.') && out.endsWith('BASE'))
})

test('cartella: default resta dov\'era, le altre in personas/<id>', () => {
  assert.equal(P.personaDir('/m', 'default'), '/m')
  assert.equal(P.personaDir('/m', 'bob'), path.join('/m', 'personas', 'bob'))
})

console.log(`=== ${passed} test superati ===`)
