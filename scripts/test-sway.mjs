// test-sway.mjs — la molla dell'oscillazione durante il trascinamento.

import assert from 'node:assert/strict'
import '../src/renderer/sway.js'

const { SWAY, swayTarget, createSway } = globalThis.CompanionSway

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

const run = (sway, seconds, vx, vy, fps = 60) => {
  let out = sway.get()
  const peak = { side: 0, forward: 0 }
  for (let i = 0; i < seconds * fps; i++) {
    out = sway.update(1 / fps, vx, vy)
    peak.side = Math.max(peak.side, Math.abs(out.side))
    peak.forward = Math.max(peak.forward, Math.abs(out.forward))
  }
  return { out, peak }
}

console.log('=== Oscillazione nel trascinamento ===\n')

test('fermo, l-avatar resta dritto', () => {
  const { out } = run(createSway(), 2, 0, 0)
  assert.equal(out.side, 0)
  assert.equal(out.forward, 0)
})

test('tirato verso destra, penzola a sinistra (angolo positivo)', () => {
  const { out } = run(createSway(), 2, 800, 0)
  assert.ok(out.side > 0, 'side ' + out.side)
  assert.ok(Math.abs(out.side - swayTarget(800, 0).side) < 0.01)
})

test('verso sinistra il verso si inverte', () => {
  const { out } = run(createSway(), 2, -800, 0)
  assert.ok(out.side < 0)
})

test('non supera mai i limiti, nemmeno con uno strattone', () => {
  const { peak } = run(createSway(), 3, 20000, -20000)
  assert.ok(peak.side <= SWAY.maxSide + 1e-9, 'side ' + peak.side)
  assert.ok(peak.forward <= SWAY.maxForward + 1e-9, 'forward ' + peak.forward)
})

test('lasciato andare, oscilla un poco e si riassesta', () => {
  const sway = createSway()
  run(sway, 1, 1500, 0)
  const start = sway.get().side
  let crossed = false
  let last = start
  for (let i = 0; i < 60; i++) {
    const { side } = sway.update(1 / 60, 0, 0)
    if (Math.sign(side) !== Math.sign(last) && side !== 0) crossed = true
    last = side
  }
  assert.ok(crossed, 'con smorzamento 0,35 deve superare lo zero almeno una volta')
  const { out } = run(sway, 2, 0, 0)
  assert.ok(Math.abs(out.side) < 0.005, 'dopo tre secondi e-` ancora a ' + out.side)
})

test('lo stesso movimento a 30 e a 144 fps finisce nello stesso punto', () => {
  const a = run(createSway(), 1.5, 900, 300, 30).out
  const b = run(createSway(), 1.5, 900, 300, 144).out
  assert.ok(Math.abs(a.side - b.side) < 0.01, a.side + ' vs ' + b.side)
  assert.ok(Math.abs(a.forward - b.forward) < 0.01)
})

test('un frame lunghissimo (finestra nascosta) non fa esplodere la molla', () => {
  const sway = createSway()
  const out = sway.update(5, 3000, 0)
  assert.ok(Number.isFinite(out.side) && Math.abs(out.side) <= SWAY.maxSide)
})

test('reset riporta tutto a zero', () => {
  const sway = createSway()
  run(sway, 1, 900, 900)
  sway.reset()
  assert.deepEqual(sway.get(), { side: 0, forward: 0 })
})

console.log('\n=== ' + passed + ' test superati ===')
