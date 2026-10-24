// screens.js — quale schermo guarda il companion, con piu' monitor.
//
// "Guarda lo schermo" (Blocco 7b) e "Tutto lo schermo" della modalita' gioco
// (Blocco 12) fotografano il monitor scelto nella pagina Visione: quello su
// cui sta il companion (di base), un monitor preciso, o tutti affiancati in
// un'immagine sola (con meno dettaglio per ciascuno). Funzioni pure, con test.

/**
 * La scelta salvata: 'companion', 'all' o 'display:<id>' (l'id di Electron).
 * @param {unknown} v
 */
function cleanScreenChoice(v) {
  return v === 'all' || (typeof v === 'string' && /^display:\d{1,20}$/.test(v)) ? v : 'companion'
}

/** I monitor da sinistra a destra (e dall'alto in basso). */
const ordered = (displays) => [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)

/**
 * I monitor da fotografare per la scelta: tutti, quello scelto, o quello del
 * companion (anche quando il monitor scelto non c'e' piu').
 * @param {{ id: number, bounds: object }[]} displays
 * @param {string} choice
 * @param {number} companionId il monitor su cui sta il companion
 */
function pickDisplays(displays, choice, companionId) {
  if (!displays.length) return []
  if (choice === 'all') return ordered(displays)
  const wanted = choice.startsWith('display:') ? displays.find(d => String(d.id) === choice.slice(8)) : null
  return [wanted || displays.find(d => d.id === companionId) || displays[0]]
}

/**
 * Le card della pagina Visione: il companion, ogni monitor (numerati da
 * sinistra), e "tutti" se sono almeno due.
 * @param {{ id: number, bounds: object, size: object, label?: string, primary?: boolean }[]} displays
 * @param {number} companionId
 */
function screenOptions(displays, companionId) {
  const list = ordered(displays)
  const name = (d) => 'Monitor ' + (list.indexOf(d) + 1)
  const own = list.find(d => d.id === companionId) || list[0]
  const out = [{ choice: 'companion', label: 'Quello del companion', sub: own ? 'ora: ' + name(own) : '', ids: own ? [own.id] : [] }]
  for (const d of list) {
    out.push({ choice: 'display:' + d.id, label: name(d) + (d.label ? ' · ' + d.label : ''),
      sub: d.size.width + '×' + d.size.height + (d.primary ? ' · principale' : ''), ids: [d.id] })
  }
  if (list.length > 1) out.push({ choice: 'all', label: 'Tutti i monitor', sub: 'affiancati, con meno dettaglio', ids: list.map(d => d.id) })
  return out
}

/**
 * Dove va ogni monitor nell'immagine: le loro posizioni vere, ridotte perche'
 * il lato lungo dell'insieme sia longSide.
 * @param {{ id: number, bounds: { x: number, y: number, width: number, height: number } }[]} displays
 * @param {number} longSide
 */
function layout(displays, longSide) {
  const minX = Math.min(...displays.map(d => d.bounds.x))
  const minY = Math.min(...displays.map(d => d.bounds.y))
  const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height))
  const scale = longSide / Math.max(maxX - minX, maxY - minY)
  return {
    width: Math.max(1, Math.round((maxX - minX) * scale)),
    height: Math.max(1, Math.round((maxY - minY) * scale)),
    parts: displays.map(d => ({
      id: d.id,
      x: Math.round((d.bounds.x - minX) * scale), y: Math.round((d.bounds.y - minY) * scale),
      width: Math.max(1, Math.round(d.bounds.width * scale)), height: Math.max(1, Math.round(d.bounds.height * scale)),
    })),
  }
}

/**
 * Incolla le immagini dei monitor (BGRA) nell'immagine d'insieme, su nero.
 * pieces: { x, y, width, height, bitmap } con bitmap di width*height*4 byte.
 * @returns {Buffer}
 */
function compose(width, height, pieces) {
  const out = Buffer.alloc(width * height * 4)
  for (let i = 3; i < out.length; i += 4) out[i] = 255
  for (const p of pieces) {
    const w = Math.min(p.width, width - p.x)
    if (w <= 0) continue
    for (let row = 0; row < p.height && p.y + row < height; row++) {
      p.bitmap.copy(out, ((p.y + row) * width + p.x) * 4, row * p.width * 4, (row * p.width + w) * 4)
    }
  }
  return out
}

module.exports = { cleanScreenChoice, pickDisplays, screenOptions, layout, compose }
