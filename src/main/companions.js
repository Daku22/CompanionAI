// companions.js — chi e' sul desktop e dove (Blocco 8). Funzioni pure: main.js
// le usa per aprire i companion all'avvio e per metterne uno nuovo dove non
// copre gli altri.

const MAX_OPEN = 3

/**
 * Le persone da aprire: solo quelle che esistono, senza doppioni, al massimo
 * MAX_OPEN; senza nessuna, la persona attiva.
 * @param {unknown} ids
 * @param {string[]} known gli id delle persone
 * @param {string} activeId
 */
function cleanOpen(ids, known, activeId) {
  const list = (Array.isArray(ids) ? ids : []).filter((id, i, all) => typeof id === 'string' && known.includes(id) && all.indexOf(id) === i)
  if (!list.length && known.includes(activeId)) list.push(activeId)
  return list.slice(0, MAX_OPEN)
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Un posto sul fondo dell'area di lavoro, da destra verso sinistra, che non
 * copre i companion gia' aperti; se non ce n'e', l'ultimo provato.
 * @param {{ x: number, y: number, width: number, height: number }} area
 * @param {{ width: number, height: number }} size
 * @param {{ x: number, y: number, width: number, height: number }[]} taken
 * @param {number} [gap] spazio fra due companion
 */
function freeSpot(area, size, taken, gap = 20) {
  const y = area.y + area.height - size.height
  let x = area.x + area.width - size.width - 40
  let spot = { x, y }
  while (x >= area.x) {
    spot = { x, y }
    if (!taken.some(t => overlaps({ ...spot, ...size }, t))) return spot
    x -= size.width + gap
  }
  return spot
}

/** Il posto salvato vale se il companion ci sta per intero in un'area di lavoro. */
function onSomeArea(spot, size, areas) {
  return !!spot && Number.isFinite(spot.x) && Number.isFinite(spot.y) && areas.some(a =>
    spot.x >= a.x && spot.y >= a.y && spot.x + size.width <= a.x + a.width && spot.y + size.height <= a.y + a.height)
}

/**
 * Una camminata da x verso target si ferma prima di un altro companion sulla
 * stessa fascia di schermo. null se non resta strada da fare.
 * @param {{ x: number, y: number, width: number, height: number }} me
 * @param {number} target x finale voluta
 * @param {{ x: number, y: number, width: number, height: number }[]} others
 */
function blockedWalk(me, target, others, gap = 12) {
  let limit = target
  for (const o of others) {
    if (!(me.y < o.y + o.height && o.y < me.y + me.height)) continue
    if (target > me.x && o.x >= me.x + me.width) limit = Math.min(limit, o.x - me.width - gap)
    if (target < me.x && o.x + o.width <= me.x) limit = Math.max(limit, o.x + o.width + gap)
  }
  return Math.abs(limit - me.x) < 8 || (target > me.x) !== (limit > me.x) ? null : Math.round(limit)
}

/**
 * Posato sopra un altro companion, si sposta di lato: il posto libero piu'
 * vicino, dentro l'area. null se non serve o non c'e'.
 * @param {{ x: number, y: number, width: number, height: number }} me
 * @param {{ x: number, y: number, width: number, height: number }[]} others
 * @param {{ x: number, width: number }} area
 */
function nudgeAside(me, others, area, gap = 12) {
  if (!others.some(o => overlaps(me, o))) return null
  const candidates = others.flatMap(o => [o.x - me.width - gap, o.x + o.width + gap])
    .filter(x => x >= area.x && x + me.width <= area.x + area.width)
    .filter(x => !others.some(o => overlaps({ ...me, x }, o)))
    .sort((a, b) => Math.abs(a - me.x) - Math.abs(b - me.x))
  return candidates.length ? { x: Math.round(candidates[0]), y: me.y } : null
}

/** Dove guardare un altro companion: piu' o meno la sua testa. */
const headPoint = (r) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.22) })

module.exports = { MAX_OPEN, cleanOpen, freeSpot, overlaps, onSomeArea, blockedWalk, nudgeAside, headPoint }
