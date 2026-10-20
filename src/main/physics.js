// physics.js — gli oggetti sul desktop (Blocco 10c): gravita', rimbalzi e
// attrito, scritti a mano.
//
// Un corpo e' un cerchio in pixel dello schermo (centro, raggio, velocita');
// il mondo e' l'area di lavoro: il pavimento e' il suo bordo basso (sopra la
// taskbar), i muri i lati. Un corpo che rimbalza poco e striscia piano si
// ferma (resting) e non costa piu' nulla. Funzioni pure, con test.

const PHYS = {
  GRAVITY: 2200,          // px/s²
  MAX_SPEED: 3500,        // px/s, un lancio piu' forte viene limitato
  REST_SPEED: 40,         // sotto questa velocita' verticale al pavimento non rimbalza piu'
  FLOOR_FRICTION: 2.2,    // 1/s: quanto rallenta strisciando
  AIR_DRAG: 0.15,         // 1/s
  WALL_KEEP: 0.8,         // parte della velocita' che resta dopo un muro (per il rimbalzo)
  STOP_SPEED: 12,         // px/s: sotto, a terra, e' fermo
  MAX_DT: 0.05,           // s: un passo piu' lungo (PC sospeso) si spezza
}

/**
 * @typedef {{ x: number, y: number, vx: number, vy: number, r: number,
 *             bounce: number, spin: number, resting: boolean }} Body
 * @typedef {{ left: number, right: number, top: number, floor: number }} World
 */

/** Un corpo nuovo, fermo o lanciato. */
function createBody({ x, y, r, bounce = 0.5, vx = 0, vy = 0 }) {
  return { x, y, vx, vy, r: Math.max(2, r), bounce: Math.max(0, Math.min(0.95, bounce)), spin: 0, resting: false }
}

/** L'area di lavoro di uno schermo come mondo. */
function worldOf(area) {
  return { left: area.x, right: area.x + area.width, top: area.y, floor: area.y + area.height }
}

const clampSpeed = (v) => Math.max(-PHYS.MAX_SPEED, Math.min(PHYS.MAX_SPEED, v))

function stepOnce(b, dt, w) {
  let { x, y, vx, vy, spin } = b
  // Appoggiato al pavimento (e non in salita) la gravita' non lo spinge piu'.
  const lying = y + b.r >= w.floor - 0.5 && vy >= 0 && vy < PHYS.REST_SPEED
  if (!lying) vy += PHYS.GRAVITY * dt
  vx *= 1 - PHYS.AIR_DRAG * dt
  x += vx * dt
  y += vy * dt
  let hit = false
  // Pavimento: rimbalza, o si appoggia e striscia.
  if (y + b.r >= w.floor) {
    y = w.floor - b.r
    if (vy > PHYS.REST_SPEED) {
      vy = -vy * b.bounce
      hit = true
      // Un rimbalzo troppo debole non lo stacca da terra.
      if (-vy < PHYS.REST_SPEED) vy = 0
    } else vy = 0
  }
  if (y + b.r >= w.floor - 0.5 && vy === 0) vx *= Math.max(0, 1 - PHYS.FLOOR_FRICTION * dt)
  // Muri e soffitto.
  if (x - b.r < w.left) { x = w.left + b.r; vx = Math.abs(vx) * b.bounce * PHYS.WALL_KEEP; hit = true }
  if (x + b.r > w.right) { x = w.right - b.r; vx = -Math.abs(vx) * b.bounce * PHYS.WALL_KEEP; hit = true }
  if (y - b.r < w.top) { y = w.top + b.r; vy = Math.abs(vy) * b.bounce; hit = true }
  // Rotola: la rotazione segue lo spostamento orizzontale.
  spin += (vx * dt) / b.r
  const resting = vy === 0 && y + b.r >= w.floor - 0.5 && Math.abs(vx) < PHYS.STOP_SPEED
  if (resting) vx = 0
  return { body: { ...b, x, y, vx, vy, spin, resting }, hit }
}

/**
 * Fa passare dt secondi. Restituisce il corpo nuovo e se ha urtato qualcosa
 * (per il suono o il palleggio).
 * @param {Body} b
 * @param {number} dt
 * @param {World} w
 */
function step(b, dt, w) {
  if (b.resting) return { body: b, hit: false }
  let left = Math.max(0, Math.min(1, dt))
  let body = { ...b, vx: clampSpeed(b.vx), vy: clampSpeed(b.vy) }
  let hit = false
  while (left > 1e-6) {
    const h = Math.min(PHYS.MAX_DT, left)
    const r = stepOnce(body, h, w)
    body = r.body
    hit = hit || r.hit
    left -= h
    if (body.resting) break
  }
  return { body, hit }
}

/** Una spinta (un lancio, un colpo): il corpo riparte. */
function push(b, vx, vy) {
  return { ...b, vx: clampSpeed(vx), vy: clampSpeed(vy), resting: false }
}

/**
 * La velocita' di un lancio dal mouse: dagli ultimi punti (x, y, t in ms)
 * negli ultimi 120 ms. Pochi punti o fermo: nessuna velocita'.
 * @param {Array<{x: number, y: number, t: number}>} trail
 */
function throwVelocity(trail) {
  if (!trail || trail.length < 2) return { vx: 0, vy: 0 }
  const last = trail[trail.length - 1]
  const recent = trail.filter(p => last.t - p.t <= 120)
  const first = recent[0]
  const dt = (last.t - first.t) / 1000
  if (dt <= 0.008) return { vx: 0, vy: 0 }
  return { vx: clampSpeed((last.x - first.x) / dt), vy: clampSpeed((last.y - first.y) / dt) }
}

/**
 * Dove si ferma (o dove tocca terra la prima volta, con firstTouch): una
 * simulazione a passi, per sapere dove mandare il companion.
 * @returns {{ x: number, t: number }} x del centro e secondi
 */
function landing(b, w, { firstTouch = false, maxS = 8, dt = 1 / 30 } = {}) {
  let body = { ...b, resting: false }
  let t = 0
  while (t < maxS) {
    const wasAir = body.y + body.r < w.floor - 0.5
    const r = step(body, dt, w)
    body = r.body
    t += dt
    if (firstTouch && wasAir && body.y + body.r >= w.floor - 0.5) break
    if (body.resting) break
  }
  return { x: body.x, t }
}

module.exports = { PHYS, createBody, worldOf, step, push, throwVelocity, landing }
