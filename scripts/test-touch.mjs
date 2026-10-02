// test-touch.mjs — clic o presa, zone e carezza (src/renderer/touch.js).
import assert from 'node:assert/strict'
import '../src/renderer/touch.js'

const { PRESS, pressAction, movedBeyondClick, ZONES, zoneFromHeight, heightTableFrom, zoneFromBones, PAT, createRubDetector } = globalThis.CompanionTouch

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

// ─── Zone ────────────────────────────────────────────────────────────────────

// Un avatar in piedi, di fronte, con H = 200 px fra bacino e testa (y verso
// il basso, come lo schermo). Le mani pendono ai fianchi.
const STAND = {
  hips: { x: 300, y: 500 }, neck: { x: 300, y: 330 }, head: { x: 300, y: 300 },
  leftLowerArm: { x: 360, y: 430 }, leftHand: { x: 370, y: 520 },
  rightLowerArm: { x: 240, y: 430 }, rightHand: { x: 230, y: 520 },
}

t('ossa: testa, viso, petto, pancia, basso ventre, gambe, mano', () => {
  assert.equal(zoneFromBones({ x: 300, y: 250 }, STAND), 'head')
  assert.equal(zoneFromBones({ x: 300, y: 285 }, STAND), 'face')
  assert.equal(zoneFromBones({ x: 300, y: 370 }, STAND), 'chest')
  assert.equal(zoneFromBones({ x: 300, y: 440 }, STAND), 'belly')
  assert.equal(zoneFromBones({ x: 300, y: 510 }, STAND), 'lowerBelly')
  assert.equal(zoneFromBones({ x: 300, y: 600 }, STAND), 'legs')
  assert.equal(zoneFromBones({ x: 372, y: 525 }, STAND), 'hand')
  assert.equal(zoneFromBones({ x: 236, y: 480 }, STAND), 'hand')
})

t('ossa: ai lati del bacino sono gambe, non basso ventre', () => {
  assert.equal(zoneFromBones({ x: 300 + 0.2 * 200, y: 490 }, STAND), 'legs')
})

t('ossa: visto da dietro, il basso ventre non c\'e\'', () => {
  assert.equal(zoneFromBones({ x: 300, y: 510 }, STAND, { facingAway: true }), 'legs')
})

t('ossa: le zone seguono il corpo anche inclinato', () => {
  // Lo stesso avatar ruotato di 90 gradi (sdraiato, testa a destra).
  const rot = (p) => ({ x: 300 + (500 - p.y), y: 500 - (300 - p.x) })
  const lying = Object.fromEntries(Object.entries(STAND).map(([k, v]) => [k, rot(v)]))
  assert.equal(zoneFromBones(rot({ x: 300, y: 250 }), lying), 'head')
  assert.equal(zoneFromBones(rot({ x: 300, y: 440 }), lying), 'belly')
  assert.equal(zoneFromBones(rot({ x: 300, y: 510 }), lying), 'lowerBelly')
})

t('ossa: in chibi la testa è più grande, e la zona con lei', () => {
  // Sopra la testa a misura piena non e' testa; con la testa a 1,875 si'.
  assert.notEqual(zoneFromBones({ x: 300, y: 190 }, STAND), 'head')
  assert.equal(zoneFromBones({ x: 300, y: 190 }, STAND, { headScale: 1.875 }), 'head')
  // La linea degli occhi scende con la testa.
  assert.equal(zoneFromBones({ x: 300, y: 255 }, STAND), 'head')
  assert.equal(zoneFromBones({ x: 300, y: 255 }, STAND, { headScale: 1.875 }), 'face')
  // Il resto del corpo non cambia.
  assert.equal(zoneFromBones({ x: 300, y: 440 }, STAND, { headScale: 1.875 }), 'belly')
})

t('ossa: senza bacino, collo o testa nessuna zona', () => {
  assert.equal(zoneFromBones({ x: 1, y: 1 }, { hips: STAND.hips, neck: STAND.neck }), null)
  assert.equal(zoneFromBones({ x: 1, y: 1 }, { hips: { x: 0, y: 0 }, neck: { x: 0, y: 0 }, head: { x: 0, y: 1 } }), null)
})

t('altezza: tabelle in ordine, ognuna fino a 1', () => {
  for (const name of ['full', 'chibi', 'bust']) {
    assert.equal(zoneFromHeight(0, name), 'head')
    assert.ok(ZONES.includes(zoneFromHeight(1, name)))
  }
  assert.equal(zoneFromHeight(0.53, 'full'), 'lowerBelly')
  assert.equal(zoneFromHeight(0.9, 'bust'), 'belly')   // un busto non ha basso ventre
  assert.equal(zoneFromHeight(-0.1), null)
  assert.equal(zoneFromHeight(NaN), null)
})

t('altezza: touchZones del pacchetto, valido o scartato', () => {
  const ok = heightTableFrom([['head', 0.3], ['chest', 0.6], ['legs', 1]])
  assert.deepEqual(ok, [['head', 0.3], ['chest', 0.6], ['legs', 1]])
  assert.equal(zoneFromHeight(0.5, ok), 'chest')
  assert.equal(heightTableFrom([['head', 0.5], ['chest', 0.4], ['legs', 1]]), null)  // non crescente
  assert.equal(heightTableFrom([['head', 0.5], ['chest', 0.9]]), null)               // non arriva a 1
  assert.equal(heightTableFrom([['coda', 1]]), null)
  assert.equal(heightTableFrom('head'), null)
})

// ─── Carezza ─────────────────────────────────────────────────────────────────

/** Avanti e indietro di `amp` px, `turns` volte, un passo ogni `stepMs`. */
function rub(det, { turns, amp = 30, stepMs = 40, start = 0, onHead = true }) {
  let now = start
  let x = 500
  let hits = 0
  for (let k = 0; k <= turns; k++) {
    const dir = k % 2 === 0 ? 1 : -1
    for (let i = 0; i < 3; i++) {
      x += dir * amp / 3
      now += stepMs
      if (det.feed(x, now, onHead)) hits++
    }
  }
  return { hits, now }
}

t('carezza: tre cambi di direzione sulla testa', () => {
  const det = createRubDetector()
  assert.equal(rub(det, { turns: PAT.TURNS - 1 }).hits, 0)
  assert.equal(rub(createRubDetector(), { turns: PAT.TURNS }).hits, 1)
})

t('carezza: fuori dalla testa o troppo lenta non conta', () => {
  assert.equal(rub(createRubDetector(), { turns: 6, onHead: false }).hits, 0)
  assert.equal(rub(createRubDetector(), { turns: 6, stepMs: 400 }).hits, 0)
})

t('carezza: il tremolio non conta come movimento', () => {
  assert.equal(rub(createRubDetector(), { turns: 8, amp: 6 }).hits, 0)
})

t('carezza: continuando, una ogni tanto e non a ogni passo', () => {
  const { hits, now } = rub(createRubDetector(), { turns: 40 })
  assert.ok(hits >= 2, hits + ' carezze')
  assert.ok(hits <= Math.ceil(now / PAT.REPEAT_MS), hits + ' carezze in ' + now + ' ms')
})

console.log('=== ' + passed + ' test superati ===')
