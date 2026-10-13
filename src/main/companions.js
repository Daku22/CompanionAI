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

module.exports = { MAX_OPEN, cleanOpen, freeSpot, overlaps }
