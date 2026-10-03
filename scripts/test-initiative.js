// test-initiative.js — il companion che scrive per primo (src/main/initiative.js).

const assert = require('node:assert/strict')
const I = require('../src/main/initiative')

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

const H = 3600000
const t0 = new Date(2026, 9, 5, 9).getTime()
const free = { enabled: true, asleep: false, fullscreen: false, typing: false }

console.log('=== Iniziativa ===')

test('occasioni: il primo rientro del giorno e\' il buongiorno, poi "rientro"', () => {
  let s = I.createInitiative()
  assert.equal(I.occasion(s, { now: t0, returned: true, lastChatAt: 0, systemIdleMs: 0 }), 'morning')
  s = I.onSpoke(s, 'morning', t0)
  assert.equal(I.occasion(s, { now: t0 + 5 * H, returned: true, lastChatAt: 0, systemIdleMs: 0 }), 'return')
  // Il giorno dopo torna il buongiorno.
  assert.equal(I.occasion(s, { now: t0 + 24 * H, returned: true, lastChatAt: 0, systemIdleMs: 0 }), 'morning')
})

test('silenzio lungo, ma solo con l\'utente al PC', () => {
  const s = I.createInitiative()
  const base = { now: t0, lastChatAt: t0 - 4 * H }
  assert.equal(I.occasion(s, { ...base, systemIdleMs: 10000 }), 'silence')
  assert.equal(I.occasion(s, { ...base, systemIdleMs: 10 * 60000 }), null)
  assert.equal(I.occasion(s, { ...base, lastChatAt: t0 - H, systemIdleMs: 0 }), null)
  // Appena parlato per conto suo: non ricomincia subito col silenzio.
  assert.equal(I.occasion(I.onSpoke(s, 'silence', t0 - H), { ...base, systemIdleMs: 0 }), null)
})

test('freni: spento, addormentato, schermo intero, mentre scrivi, occupato', () => {
  const s = I.createInitiative()
  assert.equal(I.canSpeak(s, { now: t0, ...free }), true)
  for (const k of ['asleep', 'fullscreen', 'typing', 'busy']) assert.equal(I.canSpeak(s, { now: t0, ...free, [k]: true }), false, k)
  assert.equal(I.canSpeak(s, { now: t0, ...free, enabled: false }), false)
})

test('al massimo 6 al giorno, 45 minuti fra uno e l\'altro; il giorno dopo si riparte', () => {
  let s = I.createInitiative()
  let now = t0
  for (let i = 0; i < I.RULES.MAX_PER_DAY; i++) {
    assert.equal(I.canSpeak(s, { now, ...free }), true, 'messaggio ' + (i + 1))
    s = I.onSpoke(s, 'silence', now)
    assert.equal(I.canSpeak(s, { now: now + 10 * 60000, ...free }), false)
    now += I.RULES.MIN_GAP_MS
  }
  assert.equal(I.canSpeak(s, { now, ...free }), false)
  assert.equal(I.canSpeak(s, { now: t0 + 24 * H, ...free }), true)
})

test('prompt e stato salvato', () => {
  assert.ok(I.prompt('silence').includes('scrivere per primo'))
  const s = I.onSpoke(I.createInitiative(), 'morning', t0)
  assert.deepEqual(I.restore(JSON.parse(JSON.stringify(s))), s)
  assert.deepEqual(I.restore({ sent: -1, day: 'ieri', lastAt: 'boh' }), I.createInitiative())
  assert.deepEqual(I.restore(null), I.createInitiative())
})

console.log(`=== ${passed} test superati ===`)
