// test-beat.mjs — il ritmo dai bassi (src/renderer/beat.js), con segnali finti.
import assert from 'node:assert/strict'
import '../src/renderer/beat.js'

const { BEAT, createBeatTracker } = globalThis.CompanionBeat
const FPS = 43

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Ritmo della musica ===')

// Generatore ripetibile: i test non devono dipendere dal caso.
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Una cassa a `bpm` battiti al minuto: un colpo che si spegne, sopra un fondo. */
function clicks(bpm, seconds, { noise = 0.03, seed = 1, start = 0 } = {}) {
  const r = rng(seed)
  const out = []
  const period = FPS * 60 / bpm
  let next = start
  let env = 0
  for (let i = 0; i < seconds * FPS; i++) {
    if (i >= next) { env = 1; next += period }
    out.push(0.05 + 0.6 * env + noise * r())
    env *= 0.55
  }
  return out
}

function feed(tracker, frames) {
  let s = null
  for (const v of frames) s = tracker.push(v)
  return s
}

for (const bpm of [90, 120, 140]) {
  t('cassa a ' + bpm + ' BPM: tempo giusto e si balla', () => {
    const s = feed(createBeatTracker({ fps: FPS }), clicks(bpm, 10, { seed: bpm }))
    assert.ok(Math.abs(s.bpm - bpm) <= 3, 'stimato ' + s.bpm)
    assert.ok(s.confidence > BEAT.CONFIDENT, 'sicurezza ' + s.confidence.toFixed(2))
    assert.equal(s.active, true)
  })
}

t('la fase segue le battute', () => {
  const bpm = 120
  const frames = clicks(bpm, 12, { seed: 7, noise: 0.01 })
  const tracker = createBeatTracker({ fps: FPS })
  const period = FPS * 60 / bpm
  const errors = []
  frames.forEach((v, i) => {
    const s = tracker.push(v)
    // Sui fotogrammi del colpo, dopo 6 s, la fase deve essere vicina a 0 (o 1).
    if (i > 6 * FPS && (i % period) < 1) errors.push(Math.min(s.phase, 1 - s.phase))
  })
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  assert.ok(mean < 0.12, 'errore medio di fase ' + mean.toFixed(3))
})

t('non parte subito: aspetta 3 s di ritmo', () => {
  const tracker = createBeatTracker({ fps: FPS })
  const s = feed(tracker, clicks(120, 2.5, { seed: 3 }))
  assert.equal(s.active, false)
})

t('rumore: niente ballo', () => {
  const r = rng(11)
  const s = feed(createBeatTracker({ fps: FPS }), Array.from({ length: 10 * FPS }, () => 0.1 + 0.3 * r()))
  assert.equal(s.active, false, 'sicurezza ' + s.confidence.toFixed(2))
})

t('voce simulata (sillabe irregolari): niente ballo', () => {
  const r = rng(5)
  const frames = []
  while (frames.length < 10 * FPS) {
    const gap = 6 + Math.floor(r() * 20)
    const len = 3 + Math.floor(r() * 9)
    for (let i = 0; i < gap; i++) frames.push(0.02 + 0.02 * r())
    for (let i = 0; i < len; i++) frames.push(0.2 + 0.4 * r())
  }
  const s = feed(createBeatTracker({ fps: FPS }), frames)
  assert.equal(s.active, false, 'sicurezza ' + s.confidence.toFixed(2))
})

t('silenzio dopo la musica: smette dopo circa 3 s', () => {
  const tracker = createBeatTracker({ fps: FPS })
  feed(tracker, clicks(120, 8, { seed: 9 }))
  assert.equal(tracker.state().active, true)
  feed(tracker, new Array(Math.round(2 * FPS)).fill(0))
  assert.equal(tracker.state().active, true, 'non smette al primo attimo di silenzio')
  feed(tracker, new Array(Math.round(2 * FPS)).fill(0))
  assert.equal(tracker.state().active, false)
})

t('cambio di brano: il tempo nuovo si aggancia', () => {
  const tracker = createBeatTracker({ fps: FPS })
  feed(tracker, clicks(100, 8, { seed: 2 }))
  const s = feed(tracker, clicks(140, 8, { seed: 4 }))
  assert.ok(Math.abs(s.bpm - 140) <= 3, 'stimato ' + s.bpm)
})

t('energia: piano e forte', () => {
  const quiet = feed(createBeatTracker({ fps: FPS }), clicks(120, 6, { seed: 1 }).map((v, i) => i > 4 * FPS ? v * 0.2 : v))
  const loud = feed(createBeatTracker({ fps: FPS }), clicks(120, 6, { seed: 1 }))
  assert.ok(loud.energy > quiet.energy + 0.3, loud.energy.toFixed(2) + ' contro ' + quiet.energy.toFixed(2))
})

t('valori sbagliati non rompono niente', () => {
  const tracker = createBeatTracker({ fps: FPS })
  const s = feed(tracker, [NaN, -1, Infinity, undefined, 0.2])
  assert.equal(s.active, false)
  tracker.reset()
  assert.equal(tracker.state().bpm, 0)
})

console.log('=== ' + passed + ' test superati ===')
