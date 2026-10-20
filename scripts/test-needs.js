// test-needs.js — fame e sete (src/main/needs.js, Blocco 10a).

const assert = require('node:assert/strict')
const N = require('../src/main/needs')

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

const MIN = 60 * 1000
const HOUR = 60 * MIN
/** Fa passare h ore di app aperta, a passi di un minuto (come il main). */
function openFor(needs, h) {
  for (let i = 0; i < h * 60; i++) needs = N.grow(needs, MIN)
  return needs
}

test('si parte sazi, e un file rotto non rompe niente', () => {
  assert.deepEqual(N.createNeeds(null), { hunger: 0, thirst: 0 })
  assert.deepEqual(N.createNeeds({ hunger: 2, thirst: 'tanta' }), { hunger: 1, thirst: 0 })
  assert.deepEqual(N.createNeeds({ hunger: 0.4, thirst: 0.7 }), { hunger: 0.4, thirst: 0.7 })
})

test('salgono con il tempo di app aperta: fame piena in 8 ore, sete in 5', () => {
  const four = openFor(N.createNeeds(null), 4)
  assert.ok(Math.abs(four.hunger - 0.5) < 1e-9, 'fame a meta\' dopo 4 ore: ' + four.hunger)
  assert.ok(Math.abs(four.thirst - 0.8) < 1e-9, 'sete a 0,8 dopo 4 ore: ' + four.thirst)
  const day = openFor(N.createNeeds(null), 9)
  assert.equal(day.hunger, 1)
  assert.equal(day.thirst, 1)
})

test('il tempo ad app chiusa o a PC sospeso non conta', () => {
  const after = N.grow(N.createNeeds(null), 10 * HOUR)
  assert.ok(after.hunger < 0.01, 'un passo di 10 ore conta al massimo 2 minuti: ' + after.hunger)
  assert.deepEqual(N.grow({ hunger: 0.3, thirst: 0.3 }, -5000), { hunger: 0.3, thirst: 0.3 })
  assert.deepEqual(N.grow({ hunger: 0.3, thirst: 0.3 }, NaN), { hunger: 0.3, thirst: 0.3 })
})

test('mangiare e bere: scendono, mai sotto zero', () => {
  const n = N.feed({ hunger: 0.9, thirst: 0.6 }, { hunger: 0.6, thirst: 0.1 })
  assert.ok(Math.abs(n.hunger - 0.3) < 1e-9 && Math.abs(n.thirst - 0.5) < 1e-9)
  assert.deepEqual(N.feed({ hunger: 0.2, thirst: 0.1 }, { hunger: 1, thirst: 1 }), { hunger: 0, thirst: 0 })
  assert.deepEqual(N.feed({ hunger: 0.5, thirst: 0.5 }, { hunger: -3 }), { hunger: 0.5, thirst: 0.5 }, 'un valore negativo non fa venire fame')
})

test('livelli: ok, un po\', molta; il bisogno piu\' forte', () => {
  assert.equal(N.level(0.49), 'ok')
  assert.equal(N.level(0.5), 'some')
  assert.equal(N.level(0.8), 'much')
  assert.equal(N.worst({ hunger: 0.2, thirst: 0.3 }), null)
  assert.deepEqual(N.worst({ hunger: 0.6, thirst: 0.85 }), { kind: 'thirst', level: 'much' })
  assert.deepEqual(N.worst({ hunger: 0.6, thirst: 0.1 }), { kind: 'hunger', level: 'some' })
})

test('effetti graduali: prompt, umore, camminata, rapporto', () => {
  const ok = { hunger: 0.1, thirst: 0.1 }
  const some = { hunger: 0.6, thirst: 0.1 }
  const much = { hunger: 0.9, thirst: 0.6 }
  assert.equal(N.promptLine(ok), '')
  assert.match(N.promptLine(some), /un po' di fame/)
  assert.match(N.promptLine(some), /senza insistere/)
  assert.match(N.promptLine(much), /molta fame e un po' di sete/)
  assert.match(N.promptLine(much), /scontroso/)
  assert.deepEqual(N.moodPull(ok), [])
  assert.deepEqual(N.moodPull(some), [['annoyance', N.RULES.MOOD_SOME]])
  assert.deepEqual(N.moodPull(much), [['annoyance', N.RULES.MOOD_MUCH], ['joy', -N.RULES.MOOD_MUCH]])
  assert.deepEqual([N.walkFactor(ok), N.walkFactor(some), N.walkFactor(much)], [1, 0.85, 0.7])
  assert.equal(N.neglect(some, HOUR), 0, "con un po' di fame il rapporto non cala")
  assert.equal(N.neglect(much, 2 * HOUR), 1, 'con molta fame mezzo punto all\'ora')
})

test('fumetti: solo se serve, piu\' spesso con molta fame', () => {
  assert.equal(N.bubble({ hunger: 0.1, thirst: 0.1 }), null)
  assert.equal(N.bubbleDelay({ hunger: 0.1, thirst: 0.1 }), null)
  assert.ok(N.BUBBLES.hunger.much.includes(N.bubble({ hunger: 0.95, thirst: 0 }, () => 0.99)))
  assert.ok(N.BUBBLES.thirst.some.includes(N.bubble({ hunger: 0, thirst: 0.6 }, () => 0)))
  const some = N.bubbleDelay({ hunger: 0.6, thirst: 0 }, () => 0.5)
  const much = N.bubbleDelay({ hunger: 0.9, thirst: 0 }, () => 0.5)
  assert.ok(some >= 20 * MIN && some <= 40 * MIN && much >= 10 * MIN && much <= 15 * MIN && much < some)
})

test('pubblico: valori e livelli per HUD e chat', () => {
  assert.deepEqual(N.publicNeeds({ hunger: 0.85, thirst: 0.2 }), { hunger: 0.85, thirst: 0.2, hungerLevel: 'much', thirstLevel: 'ok' })
})

console.log(`=== ${passed} test superati ===`)
