// test-idle-life.js — i gesti a riposo, con un caso deterministico al posto del dado.

const assert = require('node:assert/strict')
const { decideIdle, gestureWeights, GESTURES, AWAY_MS } = require('../src/main/idle-life')
const { ANIMATIONS } = require('../src/main/ai-router')
const { walkTarget, DISTANCE_PX } = require('../src/main/walk-target')

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

const always = () => 0          // il dado da' sempre il minimo: il gesto scatta
const never = () => 0.999       // il dado da' sempre il massimo: nessun gesto
const calmMood = { emotions: {}, energy: 1 }
const base = { quietMs: 60000, sinceGestureMs: 60000, systemIdleMs: 0, asleep: false, mood: calmMood, hour: 15 }

console.log('=== Vita a riposo ===\n')

test('nessun gesto nei primi secondi di quiete', () => {
  assert.equal(decideIdle({ ...base, quietMs: 10000, rand: always }), null)
})

test('nessun gesto subito dopo il precedente', () => {
  assert.equal(decideIdle({ ...base, sinceGestureMs: 5000, rand: always }), null)
})

test('il dado decide: a volte si', () => {
  assert.ok(decideIdle({ ...base, rand: always }))
  assert.equal(decideIdle({ ...base, rand: never }), null)
})

test('con l-utente lontano si addormenta, una volta sola', () => {
  const sleep = decideIdle({ ...base, systemIdleMs: AWAY_MS, rand: never })
  assert.equal(sleep.animation, 'sit')
  assert.equal(sleep.asleep, true)
  assert.equal(sleep.holdMs, 0, 'resta seduto finche-` l-utente non torna')
  assert.equal(decideIdle({ ...base, systemIdleMs: AWAY_MS * 2, asleep: true, rand: always }), null)
})

test('al ritorno dell-utente si sveglia e saluta', () => {
  const wake = decideIdle({ ...base, systemIdleMs: 1000, asleep: true, rand: never })
  assert.equal(wake.name, 'wake')
  assert.equal(wake.asleep, false)
})

test('di notte o senza energia sonnecchia soltanto', () => {
  for (const w of [gestureWeights(calmMood, 2), gestureWeights({ emotions: {}, energy: 0.2 }, 15)]) {
    assert.equal(w.walk, undefined, 'niente passeggiate da stanco')
    assert.ok(w.doze > w.look)
  }
})

test('l-umore cambia i gesti', () => {
  const neutral = gestureWeights(calmMood, 15)
  assert.ok(gestureWeights({ emotions: { joy: 0.6 }, energy: 1 }, 15).happy > neutral.happy)
  assert.ok(gestureWeights({ emotions: { curiosity: 0.6 }, energy: 1 }, 15).look > neutral.look)
  assert.equal(gestureWeights({ emotions: { sadness: 0.6 }, energy: 1 }, 15).happy, 0, 'triste non canticchia')
})

test('molto contento, con l-utente al PC, ogni tanto offre il batti cinque', () => {
  const happy = { emotions: { joy: 0.7 }, energy: 1 }
  assert.ok(gestureWeights(happy, 15, true).highfive > 0)
  assert.ok(!gestureWeights(happy, 15, false).highfive, 'utente lontano')
  assert.ok(!gestureWeights({ emotions: { joy: 0.45 }, energy: 1 }, 15, true).highfive, 'contento ma non abbastanza')
  assert.ok(!gestureWeights(happy, 2, true).highfive, 'di notte no')
})

test('il dado sceglie fra i gesti in proporzione ai pesi', () => {
  // look ha il peso piu' alto ed e' il primo: con il dado al minimo esce lui.
  assert.equal(decideIdle({ ...base, rand: always }).name, 'look')
  const counts = {}
  let seed = 7
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  for (let i = 0; i < 20000; i++) {
    const d = decideIdle({ ...base, quietMs: 10 * 60 * 60 * 1000, rand })
    if (d) counts[d.name] = (counts[d.name] || 0) + 1
  }
  assert.ok(counts.look > counts.happy, JSON.stringify(counts))
  assert.ok(counts.walk > counts.smoke, JSON.stringify(counts))
})

test('ogni gesto usa un-animazione del contratto', () => {
  for (const g of Object.values(GESTURES)) assert.ok(ANIMATIONS.includes(g.animation), g.animation)
})

// ── Camminata: dove va ─────────────────────────────────────────────────────
const area = { x: 0, width: 1920 }
const at = (x, extra) => walkTarget({ x, width: 180, area, ...extra })

test('verso destra va a destra, verso sinistra a sinistra', () => {
  assert.equal(at(800, { direction: 'right', distance: 'medium' }), 800 + DISTANCE_PX.medium)
  assert.equal(at(800, { direction: 'left', distance: 'short' }), 800 - DISTANCE_PX.short)
  assert.equal(at(800, { direction: 'right' }), 800 + DISTANCE_PX.medium, 'senza distanza: media')
})

test('fino al bordo si ferma dentro l-area di lavoro', () => {
  assert.equal(at(800, { direction: 'right', distance: 'edge' }), 1920 - 180)
  assert.equal(at(800, { direction: 'left', distance: 'edge' }), 0)
  assert.equal(walkTarget({ x: 2000, width: 180, area: { x: 1920, width: 1920 }, direction: 'left', distance: 'edge' }), 1920, 'secondo monitor')
})

test('gia-` sul bordo non si muove', () => {
  assert.equal(at(1740, { direction: 'right', distance: 'edge' }), null)
  assert.equal(at(0, { direction: 'left' }), null)
})

test('verso il cursore mette il centro sotto il mouse', () => {
  assert.equal(at(100, { direction: 'toward-cursor', cursorX: 1000 }), 1000 - 90)
  assert.equal(at(100, { direction: 'toward-cursor', cursorX: 1910 }), 1740, 'senza uscire dallo schermo')
})

test('senza direzione una meta-` a caso, lontana abbastanza, e i gesti restano vicini', () => {
  let seed = 3
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  for (let i = 0; i < 50; i++) {
    const t = at(800, { rand })
    assert.ok(t !== null && Math.abs(t - 800) >= 120 && t >= 0 && t <= 1740, String(t))
    const near = at(800, { rand, maxDistance: 300 })
    assert.ok(near === null || Math.abs(near - 800) <= 300, String(near))
  }
})

console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
