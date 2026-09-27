// walk-target.js — dove va il companion quando cammina.
//
// Funzione pura, separata da main.js per poterla provare da Node. Prima la
// meta' era sempre a caso: "cammina verso destra" poteva andare a sinistra.

const DISTANCE_PX = { short: 150, medium: 400 }
const MIN_WALK_DIST = 120   // sotto questa soglia uno spostamento a caso non si nota

/**
 * Coordinata x della finestra alla fine della camminata, o null se non c'e'
 * spazio per muoversi (gia' sul bordo, area troppo stretta).
 * @param {{ x: number, width: number, area: { x: number, width: number },
 *           direction?: string, distance?: string, cursorX?: number,
 *           maxDistance?: number, rand?: () => number }} input
 */
function walkTarget({ x, width, area, direction, distance, cursorX, maxDistance = Infinity, rand = Math.random }) {
  const minX = Math.max(area.x, x - maxDistance)
  const maxX = Math.min(area.x + area.width - width, x + maxDistance)
  if (maxX <= minX) return null
  const clamp = (v) => Math.round(Math.max(minX, Math.min(maxX, v)))

  let target
  if (direction === 'toward-cursor' && typeof cursorX === 'number') {
    target = clamp(cursorX - width / 2)
  } else if (direction === 'left' || direction === 'right') {
    const sign = direction === 'right' ? 1 : -1
    const span = distance === 'edge' ? Infinity : (DISTANCE_PX[distance] || DISTANCE_PX.medium)
    target = clamp(x + sign * span)
  } else {
    // Nessuna direzione: una meta' a caso, lontana abbastanza da vedersi.
    let guard = 0
    do {
      target = Math.round(minX + rand() * (maxX - minX))
      guard++
    } while (Math.abs(target - x) < MIN_WALK_DIST && guard < 12)
  }
  return Math.abs(target - x) < 8 ? null : target
}

module.exports = { walkTarget, DISTANCE_PX }
