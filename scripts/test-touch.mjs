// test-touch.mjs — clic o presa sul tasto sinistro (src/renderer/touch.js).
import assert from 'node:assert/strict'
import '../src/renderer/touch.js'

const { PRESS, pressAction, movedBeyondClick } = globalThis.CompanionTouch

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Tocco: clic o presa ===')

t('un clic con il tremolio della mano resta un clic', () => {
  for (const d of [0, 2, 4, 6, 9]) assert.equal(pressAction(120, d), 'wait', d + ' px')
})

t('un clic lento ma fermo resta un clic', () => {
  assert.equal(pressAction(PRESS.SLOW_DRAG_MS + 100, PRESS.SLOW_DRAG_PX - 1), 'wait')
})

t('oltre la soglia del clic parte la presa, anche subito', () => {
  assert.equal(pressAction(30, PRESS.CLICK_SLOP), 'drag')
  assert.equal(pressAction(30, 40), 'drag')
})

t('tenuto un po\', basta poca strada per trascinare', () => {
  assert.equal(pressAction(PRESS.SLOW_DRAG_MS - 1, PRESS.SLOW_DRAG_PX), 'wait')
  assert.equal(pressAction(PRESS.SLOW_DRAG_MS, PRESS.SLOW_DRAG_PX), 'drag')
})

t('tenuto fermo a lungo lo prende in braccio', () => {
  assert.equal(pressAction(PRESS.PICKUP_MS - 1, 0), 'wait')
  assert.equal(pressAction(PRESS.PICKUP_MS, 0), 'drag')
})

t('le soglie restano in ordine', () => {
  assert.ok(PRESS.SLOW_DRAG_PX < PRESS.CLICK_SLOP)
  assert.ok(PRESS.SLOW_DRAG_MS < PRESS.PICKUP_MS)
  // Un doppio clic (due pressioni brevi) non deve mai arrivare alla presa da fermo.
  assert.ok(PRESS.PICKUP_MS > 400)
})

t('destro e centrale: stessa tolleranza del clic', () => {
  assert.equal(movedBeyondClick(PRESS.CLICK_SLOP - 1), false)
  assert.equal(movedBeyondClick(PRESS.CLICK_SLOP), true)
})

console.log('=== ' + passed + ' test superati ===')
