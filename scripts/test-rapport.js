// test-rapport.js — il rapporto con l'utente (src/main/rapport.js).

const assert = require('node:assert/strict')
const R = require('../src/main/rapport')

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

const DAY = 86400000
const t0 = new Date(2026, 9, 1, 10).getTime()

console.log('=== Rapporto ===')

test('il primo giorno conta, lo stesso giorno no', () => {
  let r = R.onDay(R.createRapport(), t0)
  assert.equal(r.days, 1)
  assert.equal(r.streak, 1)
  assert.equal(r.score, R.RULES.START + R.RULES.DAY_BONUS)
  assert.equal(R.onDay(r, t0 + 3600000), r)
})

test('serie: giorni di fila, poi un buco la azzera', () => {
  let r = R.createRapport()
  for (let i = 0; i < 7; i++) r = R.onDay(r, t0 + i * DAY)
  assert.equal(r.streak, 7)
  assert.equal(r.days, 7)
  r = R.onDay(r, t0 + 9 * DAY)
  assert.equal(r.streak, 1)
  assert.equal(r.days, 8)
})

test('assenza lunga: cala a gradini, con un tetto', () => {
  const base = { ...R.createRapport(), score: 60, level: 3, lastDay: R.dayOf(t0) }
  assert.equal(R.onDay(base, t0 + 3 * DAY).score, 61)                       // 3 giorni: niente calo
  assert.equal(R.onDay(base, t0 + 5 * DAY).score, 60 + 1 - 2 * 2)
  assert.equal(R.onDay(base, t0 + 60 * DAY).score, 60 + 1 - R.RULES.ABSENCE_MAX)
})

test('rapport: sale fino al tetto del giorno, i toni ostili pesano di piu\'', () => {
  let r = R.onDay(R.createRapport(), t0)
  const start = r.score
  for (let i = 0; i < 10; i++) r = R.onReply(r, 2)
  assert.equal(r.score, start + R.RULES.DAILY_CAP)
  r = R.onReply(r, -2)
  assert.equal(r.score, start + R.RULES.DAILY_CAP - 3)
  // Valori fuori contratto non contano.
  for (const bad of [3, -3, 1.5, '2', null, undefined]) assert.equal(R.onReply(r, bad), r)
  // Il giorno dopo il tetto riparte.
  assert.equal(R.onDay(r, t0 + DAY).todayGain, 0)
})

test('livelli: soglie e isteresi al confine', () => {
  assert.equal(R.levelFor(0), 0)
  assert.equal(R.levelFor(25), 2)
  assert.equal(R.levelFor(100), R.LEVELS.length - 1)
  // A 24 si resta Amico (25 - 4 = 21), a 20 si scende.
  assert.equal(R.levelFor(24, 2), 2)
  assert.equal(R.levelFor(20, 2), 1)
  // Il punteggio non esce da 0..100.
  assert.equal(R.onReply({ ...R.createRapport(), score: 1 }, -2).score, 0)
})

test('reazioni: affetto sale col livello, fastidio scende', () => {
  const low = R.reactionScale(0)
  const high = R.reactionScale(5)
  assert.ok(low.affection < 1 && high.affection > 1)
  assert.ok(low.annoyance > 1 && high.annoyance < 1)
  assert.equal(low.patience, -1)
  assert.equal(R.reactionScale(2).patience, 0)
  assert.equal(high.patience, 1)
})

test('prompt e dati per la chat', () => {
  const r = { ...R.createRapport(), score: 30, level: 2, days: 12, streak: 3 }
  const line = R.promptLine(r)
  assert.ok(line.includes('amico') && line.includes('12 giorni') && line.includes('"rapport"'))
  assert.deepEqual(R.publicRapport(r), { level: 2, label: 'Amico', levels: 6, days: 12, streak: 3, score: 30 })
})

console.log(`=== ${passed} test superati ===`)
