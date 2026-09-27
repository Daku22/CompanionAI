// test-mood.js — lo stato d'animo, senza Electron e senza orologi veri.

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mood = require('../src/main/mood')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 26, 12, 0, 0)
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' != ' + b)

async function main() {
  console.log('=== Umore ===\n')

  await test('dopo un-emivita un-emozione vale la meta-`', () => {
    const start = { ...mood.createMood(null, T0), emotions: { joy: 0.8, annoyance: 0.8 } }
    const later = mood.decay(start, T0 + 6 * HOUR)
    close(later.emotions.joy, 0.4)
    close(later.emotions.annoyance, 0.8 / 64)
    // il fastidio ha emivita di un'ora: dopo dieci ore e' sotto la soglia e sparisce
    assert.equal(mood.decay(start, T0 + 10 * HOUR).emotions.annoyance, undefined)
  })

  await test('due passi da un-ora equivalgono a uno da due ore', () => {
    const start = { ...mood.createMood(null, T0), emotions: { calm: 0.9 } }
    const twoSteps = mood.decay(mood.decay(start, T0 + HOUR), T0 + 2 * HOUR)
    const oneStep = mood.decay(start, T0 + 2 * HOUR)
    close(twoSteps.emotions.calm, oneStep.emotions.calm)
  })

  await test('l-affetto non decade e cresce piano', () => {
    const start = { ...mood.createMood(null, T0), emotions: { affection: 0.5 } }
    assert.equal(mood.decay(start, T0 + 1000 * HOUR).emotions.affection, 0.5)
    close(mood.nudge(start, 'affection', 0.4).emotions.affection, 0.6)
    close(mood.nudge(start, 'joy', 0.4).emotions.joy, 0.4)
  })

  await test('le intensita-` restano fra 0 e 1', () => {
    let m = mood.createMood(null, T0)
    for (let i = 0; i < 10; i++) m = mood.nudge(m, 'joy', 0.5)
    assert.equal(m.emotions.joy, 1)
    m = mood.nudge(m, 'joy', -5)
    assert.equal(m.emotions.joy, undefined)
    assert.equal(mood.nudge(m, 'inventata', 1), m, 'un nome sconosciuto non cambia nulla')
  })

  await test('l-emozione della risposta sposta l-umore, i valori estranei no', () => {
    const start = { ...mood.createMood(null, T0), emotions: { sadness: 0.5 } }
    const happy = mood.react(start, 'joy')
    close(happy.emotions.joy, 0.25)
    close(happy.emotions.sadness, 0.4)
    assert.ok(happy.emotions.affection > 0, 'ogni scambio lascia un filo di affetto')
    /** @type {any} */
    let fond = start
    for (let i = 0; i < 20; i++) fond = mood.react(fond, 'calm')
    close(fond.emotions.affection, 0.1, 1e-9)
    // Il primo filo di affetto sopravvive al passare del tempo: sta sotto la
    // soglia di rumore, ma non decade.
    assert.ok(mood.decay(happy, T0 + 1000 * HOUR).emotions.affection > 0)
    assert.equal(mood.react(start, 'neutral'), start)
    assert.equal(mood.react(start, 'rabbia cosmica'), start)
    assert.equal(mood.react(start, undefined), start)
  })

  await test('un messaggio consuma energia, il riposo la restituisce', () => {
    let m = mood.createMood(null, T0)
    for (let i = 0; i < 10; i++) m = mood.onUserMessage(m, T0 + i * 1000)
    // fra un messaggio e l'altro passa un secondo: l'energia risale di un soffio
    close(m.energy, 0.8, 1e-3)
    assert.equal(m.messages, 10)
    const rested = mood.decay(m, m.updatedAt + 2 * HOUR)
    close(rested.energy, 1 - (1 - m.energy) / 2)
  })

  await test('dopo un-assenza lunga il ritorno fa piacere', () => {
    const first = mood.onUserMessage(mood.createMood(null, T0), T0)
    assert.equal(first.previousUserAt, null)
    const back = mood.onUserMessage(first, T0 + 8 * HOUR)
    assert.equal(back.previousUserAt, T0)
    assert.ok(back.emotions.joy > mood.decay(first, T0 + 8 * HOUR).emotions.joy)
  })

  await test('la riga del prompt dice umore, ora e tempo trascorso', () => {
    let m = { ...mood.createMood(null, T0), emotions: { joy: 0.7, calm: 0.2, annoyance: 0.05 } }
    const now = new Date(2026, 8, 26, 15, 7)
    let line = mood.promptLine(m, now)
    assert.match(line, /15:07, pomeriggio/)
    assert.match(line, /molta allegria, un po' di calma/)
    assert.doesNotMatch(line, /fastidio/, 'un-emozione appena percepibile non si nomina')
    assert.match(line, /prima volta/)
    m = { ...m, previousUserAt: now.getTime() - 3 * 24 * HOUR }
    assert.match(mood.promptLine(m, now), /3 giorni fa/)
    m = { ...m, previousUserAt: now.getTime() - 60 * 1000 }
    assert.doesNotMatch(mood.promptLine(m, now), /risale/, 'in una conversazione in corso non si parla di attese')
    assert.match(mood.promptLine(m, new Date(2026, 8, 26, 2, 0)), /notte fonda/)
  })

  await test('dominante e vista pubblica', () => {
    const m = { ...mood.createMood(null, T0), emotions: { joy: 0.2, curiosity: 0.5 } }
    assert.equal(mood.dominant(m), 'curiosity')
    const pub = mood.publicMood(m)
    assert.equal(pub.label, 'curiosità')
    assert.equal(pub.lastUserAt, undefined, 'ai renderer non vanno gli orari')
    assert.equal(mood.publicMood({ ...m, emotions: { joy: 0.05 } }).label, 'neutro')
  })

  await test('il contratto del router usa le stesse emozioni', () => {
    const { EMOTIONS, COMPANION_SCHEMA } = require('../src/main/ai-router')
    assert.deepEqual(EMOTIONS, mood.REPLY_EMOTIONS)
    assert.deepEqual(COMPANION_SCHEMA.properties.emotion.enum, mood.REPLY_EMOTIONS)
    assert.ok(!COMPANION_SCHEMA.required.includes('emotion'), 'facoltativa: un provider che non la manda non si rompe')
  })

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-mood-test-'))
  try {
    await test('salvato e riletto resta uguale, anche in una cartella nuova', async () => {
      const file = path.join(dir, 'nuova', 'mood.json')
      const m = mood.onUserMessage(mood.react(mood.createMood(null, T0), 'joy'), T0 + 1000)
      await mood.saveMood(file, m)
      assert.deepEqual(await mood.loadMood(file, T0 + 2000), m)
    })

    await test('un file corrotto o strano riparte dallo stato iniziale', async () => {
      const file = path.join(dir, 'rotto.json')
      await fs.promises.writeFile(file, '{ non json')
      assert.deepEqual((await mood.loadMood(file, T0)).emotions, mood.createMood(null, T0).emotions)
      await fs.promises.writeFile(file, JSON.stringify({ emotions: { joy: 7, boh: 1, calm: 'tanta' }, energy: -3, updatedAt: T0 + 99 * HOUR }))
      const odd = await mood.loadMood(file, T0)
      assert.deepEqual(odd.emotions, { joy: 1 })
      assert.equal(odd.energy, 0)
      assert.equal(odd.updatedAt, T0, 'un orario nel futuro non blocca il decadimento')
      assert.deepEqual((await mood.loadMood(path.join(dir, 'assente.json'), T0)).emotions, mood.createMood(null, T0).emotions)
    })
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }) }

  console.log('\n=== ' + passed + ' test superati ===')
  if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
}
main()
