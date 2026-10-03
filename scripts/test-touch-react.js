// test-touch-react.js — le reazioni ai tocchi (src/main/touch-react.js), con
// il tempo passato a mano.

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ZONES, KINDS, STEPS, REACTIONS, checkTouch, createTouchState, pickLine, shouldSayLine, touchPromptText } = require('../src/main/touch-react')
const { LINES } = require('../src/main/touch-lines')
const { ANIMATION_SLOTS } = require('../src/main/AnimationLibrary')
const { EMOTION_NAMES } = require('../src/main/mood')

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

console.log('=== Reazioni ai tocchi ===')

test('zone e tipi uguali a quelli del renderer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'touch.js'), 'utf8')
  assert.ok(src.includes("const ZONES = " + JSON.stringify(ZONES).replace(/"/g, "'").replace(/,/g, ', ')), 'ZONES diverse')
  assert.ok(src.includes("const KINDS = " + JSON.stringify(KINDS).replace(/"/g, "'").replace(/,/g, ', ')), 'KINDS diversi')
})

test('ogni reazione ha uno slot vero, emozioni vere e battute', () => {
  for (const [name, r] of Object.entries(REACTIONS)) {
    // Il batti cinque usa pose col lato della mano, fuori dalla libreria .vrma.
    assert.ok(ANIMATION_SLOTS.includes(r.slot) || ['highfive', 'missed'].includes(r.slot), name + ': slot ' + r.slot)
    for (const e of Object.keys(r.mood)) assert.ok(EMOTION_NAMES.includes(e), name + ': ' + e)
    assert.ok(LINES[r.line] && LINES[r.line].length, name + ': battute ' + r.line)
    assert.ok(r.chance >= 0 && r.chance <= 1)
    assert.ok(r.ms > 0 && r.weight > 0 && r.weight <= 1)
  }
})

test('un tocco dalla pagina si controlla', () => {
  assert.deepEqual(checkTouch({ zone: 'head', kind: 'pat', extra: 1 }), { zone: 'head', kind: 'pat' })
  assert.equal(checkTouch({ zone: 'coda', kind: 'poke' }), null)
  assert.equal(checkTouch({ zone: 'head', kind: 'kick' }), null)
  assert.equal(checkTouch(null), null)
  assert.equal(checkTouch('head'), null)
})

test('le zone gentili restano gentili', () => {
  const s = createTouchState()
  const names = ['head', 'face', 'chest', 'belly', 'hand', 'legs'].map((z, i) => s.onTouch(z, 'poke', i * 5000).name)
  assert.deepEqual(names, ['headTap', 'flinch', 'giggle', 'giggle', 'hand', 'hop'])
  for (const n of names) assert.ok(!(REACTIONS[n].mood.annoyance > 0), n)
})

test('basso ventre: imbarazzo, rimprovero, poi si gira', () => {
  const s = createTouchState()
  const seq = [1, 2, 3, 4].map(i => s.onTouch('lowerBelly', 'poke', i * 1000))
  assert.deepEqual(seq.map(r => r.name), ['shy', 'scold', 'scold', 'turnaway'])
  assert.deepEqual(seq.map(r => r.step), [1, 2, 3, 4])
})

test('girato di spalle non reagisce, poi torna', () => {
  const s = createTouchState()
  for (let i = 1; i <= 4; i++) s.onTouch('lowerBelly', 'poke', i * 1000)
  assert.equal(s.onTouch('chest', 'poke', 4000 + STEPS.TURNAWAY_MS - 1), null)
  assert.equal(s.onTouch('chest', 'poke', 4000 + STEPS.TURNAWAY_MS).name, 'giggle')
})

test('il fastidio scende di un gradino ogni 20 s', () => {
  const s = createTouchState()
  s.onTouch('lowerBelly', 'poke', 0)
  s.onTouch('lowerBelly', 'poke', 1000)                       // gradino 2
  const later = s.onTouch('lowerBelly', 'poke', 1000 + STEPS.LOWER_DECAY_MS * 2)
  assert.equal(later.step, 1)
  assert.equal(later.name, 'shy')
})

test('una carezza addolcisce, ed e\' solo sulla testa', () => {
  const s = createTouchState()
  s.onTouch('lowerBelly', 'poke', 0)
  s.onTouch('lowerBelly', 'poke', 100)                         // gradino 2
  assert.equal(s.onTouch('head', 'pat', 200).name, 'pat')
  assert.equal(s.debug().lower, 1)
  assert.equal(s.onTouch('belly', 'pat', 300), null)
})

test('clic fitti ovunque: ride piu\' in fretta, poi si stufa', () => {
  const s = createTouchState()
  const names = []
  for (let i = 0; i < STEPS.SPAM_SCOLD; i++) names.push(s.onTouch('chest', 'poke', i * 300).name)
  assert.equal(names[STEPS.SPAM_GIGGLE - 2], 'giggle')
  assert.equal(names[STEPS.SPAM_GIGGLE - 1], 'spamGiggle')
  assert.equal(names[STEPS.SPAM_SCOLD - 1], 'spamScold')
  // Dopo una pausa si riparte da capo.
  assert.equal(s.onTouch('chest', 'poke', 100000).name, 'giggle')
})

test('battute: con la probabilita', () => {
  /** @type {Record<string, string>} */
  const last = {}
  assert.equal(pickLine('pat', 0.3, last, () => 0.5), null)
  assert.ok(LINES.pat.includes(pickLine('pat', 0.3, last, () => 0.1)))
  assert.equal(pickLine('nessuna', 1, last), null)
})

test('battute: mai la stessa due volte di fila', () => {
  /** @type {Record<string, string>} */
  const last = {}
  let prev = null
  for (let i = 0; i < 30; i++) {
    const line = pickLine('scold', 1, last)
    assert.notEqual(line, prev)
    prev = line
  }
})

test('battute: corte, senza genere', () => {
  for (const [family, lines] of Object.entries(LINES)) {
    for (const line of lines) {
      assert.ok(line.length <= 40, family + ': troppo lunga: ' + line)
      assert.ok(!/\b(contenta|contento|arrabbiata|arrabbiato|imbarazzata|imbarazzato|offesa|offeso)\b/i.test(line), family + ': ' + line)
    }
  }
})

test('voce: la battuta si dice solo con la voce libera', () => {
  const free = { voiceOn: true, speaking: false, awaitingReply: false, listening: false }
  assert.equal(shouldSayLine('Ehi!', free), true)
  assert.equal(shouldSayLine(null, free), false)
  assert.equal(shouldSayLine('Ehi!', { ...free, voiceOn: false }), false)
  assert.equal(shouldSayLine('Ehi!', { ...free, speaking: true }), false, 'non interrompe una risposta')
  assert.equal(shouldSayLine('Ehi!', { ...free, awaitingReply: true }), false)
  assert.equal(shouldSayLine('Ehi!', { ...free, listening: true }), false)
})

test('prompt: l\'ultimo tocco, solo per tre minuti', () => {
  const now = 1e9
  assert.match(touchPromptText({ name: 'pat', zone: 'head', kind: 'pat', at: now - 1000 }, now), /carezza/)
  assert.match(touchPromptText({ name: 'turnaway', zone: 'lowerBelly', kind: 'poke', at: now }, now), /spalle/)
  assert.match(touchPromptText({ name: 'shy', zone: 'lowerBelly', kind: 'poke', at: now }, now), /imbarazzo/)
  assert.equal(touchPromptText({ name: 'pat', zone: 'head', kind: 'pat', at: now - 3 * 60000 }, now), null)
  assert.equal(touchPromptText(null, now), null)
})

test('batti cinque: preso vale umore e battuta, di fila vale sempre meno', () => {
  const { createHighFiveState, highFiveReaction, REACTIONS } = require('../src/main/touch-react')
  const hs = createHighFiveState()
  const f1 = hs.onSlap(0), f2 = hs.onSlap(1000), f3 = hs.onSlap(2000)
  assert.deepEqual([f1, f2, f3], [1, 1 / 2, 1 / 3])
  assert.equal(hs.onSlap(2000 + 10 * 60000), 1, 'dopo la finestra torna a valere tutto')
  const slap = highFiveReaction('slap', 0.5)
  assert.equal(slap.slot, 'highfive')
  assert.equal(slap.mood.joy, REACTIONS.highfive.mood.joy * 0.5)
  assert.ok(slap.mood.affection > 0)
})

test('batti cinque mancato: un po\' di delusione, niente fastidio', () => {
  const { highFiveReaction } = require('../src/main/touch-react')
  const missed = highFiveReaction('missed')
  assert.equal(missed.slot, 'missed')
  assert.ok(!missed.mood.annoyance)
  assert.ok(missed.mood.sadness > 0 && missed.mood.sadness <= 0.05)
  assert.equal(highFiveReaction('offer'), null)
})

test('batti cinque: la riga per il prompt', () => {
  const now = 1e9
  assert.match(touchPromptText({ name: 'highfive', zone: 'hand', kind: 'highfive', at: now }, now), /battuto il cinque/)
  assert.match(touchPromptText({ name: 'missed', zone: 'hand', kind: 'highfive', at: now }, now), /non l'ha raccolto/)
})

console.log('=== ' + passed + ' test superati ===')
