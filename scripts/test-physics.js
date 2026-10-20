// test-physics.js — gravita', rimbalzi e attrito degli oggetti (src/main/physics.js, Blocco 10c).

const assert = require('node:assert/strict')
const P = require('../src/main/physics')

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

const W = P.worldOf({ x: 0, y: 0, width: 1920, height: 1040 })
/** Fa girare la simulazione per s secondi a 30 passi al secondo (come il main). */
function run(b, s, w = W) {
  let hits = 0
  for (let t = 0; t < s; t += 1 / 30) { const r = P.step(b, 1 / 30, w); b = r.body; if (r.hit) hits++ }
  return { b, hits }
}

test('cade, rimbalza e si ferma sul pavimento (sopra la taskbar)', () => {
  const { b, hits } = run(P.createBody({ x: 500, y: 200, r: 30, bounce: 0.7 }), 6)
  assert.ok(b.resting, 'alla fine e\' fermo')
  assert.equal(b.y, W.floor - 30, 'appoggiato al pavimento')
  assert.ok(hits >= 3, 'un pallone rimbalza piu\' volte: ' + hits)
  const soft = run(P.createBody({ x: 500, y: 200, r: 30, bounce: 0.1 }), 6)
  assert.ok(soft.hits < hits, 'un peluche rimbalza meno')
})

test('lanciato di lato rotola e rallenta, i muri lo respingono', () => {
  const thrown = P.push(P.createBody({ x: 300, y: W.floor - 30, r: 30, bounce: 0.6 }), 900, 0)
  const later = run(thrown, 0.5).b
  assert.ok(later.x > 300 && later.vx < 900, 'avanza e rallenta')
  assert.ok(later.spin > 0, 'rotola nel verso del moto')
  const wall = run(P.push(P.createBody({ x: 1850, y: 500, r: 30, bounce: 0.6 }), 2000, 0), 0.3).b
  assert.ok(wall.x + wall.r <= W.right && wall.vx <= 0, 'dal muro destro torna indietro')
  const stopped = run(thrown, 8).b
  assert.ok(stopped.resting && stopped.x > 300 && stopped.x < W.right, 'alla fine si ferma dentro lo schermo')
})

test('mai fuori dallo schermo, anche con passi lunghi o lanci enormi', () => {
  const b = run(P.push(P.createBody({ x: 50, y: 50, r: 20, bounce: 0.9 }), -99999, -99999), 3).b
  assert.ok(b.x - b.r >= W.left && b.y - b.r >= W.top && b.y + b.r <= W.floor)
  const long = P.step(P.createBody({ x: 500, y: 100, r: 20 }), 30, W).body
  assert.ok(long.y + long.r <= W.floor, 'un passo di 30 s (PC sospeso) vale al massimo 1 s')
})

test('fermo non costa nulla: lo stesso corpo', () => {
  const rest = { ...P.createBody({ x: 500, y: W.floor - 30, r: 30 }), resting: true }
  assert.equal(P.step(rest, 1 / 30, W).body, rest)
})

test('la velocita\' di un lancio dal trascinamento del mouse', () => {
  assert.deepEqual(P.throwVelocity([]), { vx: 0, vy: 0 })
  const v = P.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: -20, t: 50 }, { x: 100, y: -40, t: 100 }])
  assert.equal(Math.round(v.vx), 1000)
  assert.equal(Math.round(v.vy), -400)
  assert.deepEqual(P.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 3 }]), { vx: 0, vy: 0 })
  assert.ok(P.throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 9e6, y: 0, t: 50 }]).vx <= P.PHYS.MAX_SPEED)
})

test('dove arriva: il primo tocco a terra e dove si ferma', () => {
  const b = P.push(P.createBody({ x: 300, y: 300, r: 25, bounce: 0.6 }), 600, -500)
  const touch = P.landing(b, W, { firstTouch: true })
  const rest = P.landing(b, W)
  assert.ok(touch.x > 300 && touch.t > 0.3, 'tocca terra piu\' avanti: ' + JSON.stringify(touch))
  assert.ok(rest.x >= touch.x && rest.t > touch.t, 'e si ferma ancora piu\' avanti')
  const sim = run(b, rest.t + 0.1).b
  assert.ok(Math.abs(sim.x - rest.x) < 40, 'la previsione coincide con la simulazione: ' + sim.x + ' / ' + rest.x)
})

test('pallavolo: la mira arriva dove deve, e si sa dove ribatterla', () => {
  const from = { x: 400, y: 800 }
  const to = { x: 1300, y: 700 }
  // A 30 passi al secondo, come il giro del cursore nel main.
  const v = P.aim(from, to, 1.4)
  assert.ok(v.vy < 0, "parte verso l'alto")
  let b = P.push(P.createBody({ x: from.x, y: from.y, r: 30, bounce: 0.7 }), v.vx, v.vy)
  for (let t = 0; t < 1.4 - 1e-9; t += 1 / 30) b = P.step(b, 1 / 30, W).body
  assert.ok(Math.hypot(b.x - to.x, b.y - to.y) < 25, "dopo 1,4 s e' li': " + Math.round(b.x) + ',' + Math.round(b.y))
  const start = P.push(P.createBody({ x: from.x, y: from.y, r: 30, bounce: 0.7 }), v.vx, v.vy)
  const c = P.crossing(start, W, to.y)
  assert.ok(c && Math.abs(c.x - to.x) < 25 && Math.abs(c.t - 1.4) < 0.05, 'scendendo passa per y=700 vicino a x=1300: ' + JSON.stringify(c))
  assert.equal(P.crossing(start, W, W.floor + 100), null, 'sotto il pavimento non ci passa mai')
  const low = P.push(P.createBody({ x: 400, y: 900, r: 30 }), 300, 0)
  assert.equal(P.crossing(low, W, 600), null, "gia' sotto quell'altezza: tocca terra prima")
})

console.log(`=== ${passed} test superati ===`)
