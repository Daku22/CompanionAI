// test-avatar-thumb.mjs — il ritaglio del viso per le miniature (Blocco 9c).
//
// faceRect cerca la sagoma in un'immagine RGBA e ne prende la parte alta: qui
// figure finte (rettangoli pieni) con la testa in posti diversi.

import assert from 'node:assert/strict'
import '../src/renderer/avatar-thumb.js'

const { faceRect, SIZE } = globalThis.CompanionThumb

/** Un'immagine w x h trasparente, con i rettangoli [x0, y0, x1, y1] pieni. */
function image(w, h, rects) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * w + x) * 4 + 3] = 255
  }
  return data
}
const inside = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.size <= w && r.y + r.size <= h

let passed = 0
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name) }

test('niente sagoma, niente miniatura', () => {
  assert.equal(faceRect(image(40, 40, []), 40, 40), null)
  // Un'ombra quasi trasparente non e' l'avatar.
  const faint = image(40, 40, [[5, 5, 30, 30]]).map((v, i) => (i % 4 === 3 && v ? 10 : v))
  assert.equal(faceRect(faint, 40, 40), null)
})

test('figura intera: il quadrato prende la testa, in alto', () => {
  // Testa 35..65 x 10..40, corpo 30..70 x 40..199.
  const w = 100, h = 200
  const r = faceRect(image(w, h, [[35, 10, 65, 40], [30, 40, 70, 199]]), w, h)
  assert.ok(inside(r, w, h))
  assert.ok(r.size <= 41 && r.size >= 30, 'largo quanto la sagoma: ' + r.size)
  assert.ok(r.y <= 10 && r.y >= 6, 'parte dai capelli: ' + r.y)
  assert.ok(r.x <= 35 && r.x + r.size >= 65, 'la testa sta dentro')
})

test('un braccio di lato non sposta il viso', () => {
  // Come sopra, con un braccio teso verso destra a meta' corpo.
  const w = 120, h = 200
  const r = faceRect(image(w, h, [[35, 10, 65, 40], [30, 40, 70, 199], [70, 90, 118, 100]]), w, h)
  assert.ok(inside(r, w, h))
  const center = r.x + r.size / 2
  assert.ok(Math.abs(center - 50) <= 6, 'centrato sulla testa, non sulla sagoma: ' + center)
})

test('mezzo busto largo: il lato segue l\'altezza', () => {
  const w = 300, h = 120
  const r = faceRect(image(w, h, [[100, 0, 200, 60], [20, 60, 280, 119]]), w, h)
  assert.ok(inside(r, w, h))
  assert.equal(r.size, Math.round(120 * 0.42))
  assert.equal(r.y, 0, 'la sagoma tocca il bordo: si parte da li\'')
  assert.ok(r.x <= 150 && r.x + r.size >= 150)
})

test('share piu\' alto per i 2D, con la testa grande', () => {
  const w = 100, h = 200
  const img = image(w, h, [[20, 0, 80, 90], [30, 90, 70, 199]])
  assert.ok(faceRect(img, w, h, 0.5).size > faceRect(img, w, h, 0.3).size)
  assert.equal(SIZE, 256)
})

console.log('\n=== avatar-thumb: ' + passed + ' test superati ===')
