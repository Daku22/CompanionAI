// room.js — la modalita' stanza: la finestra del companion diventa grande,
// con una scena 3D, la barra del titolo e la chat agganciata a destra.
//
// Funzioni pure: dimensioni, ridimensionamento dai bordi, posto della chat.
// Le chiamate a Electron stanno in main.js. La finestra resta trasparente e
// senza cornice (non si puo' cambiare dopo averla creata): i bordi per
// ridimensionarla li disegna la pagina, e il main segue il cursore.

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

const ROOM_MIN = { width: 560, height: 380 }
const ROOM_DEFAULT = { width: 1040, height: 680 }
// Chat agganciata: la stessa larghezza di sempre, dentro la stanza, sotto la
// barra del titolo.
const CHAT_WIDTH = 380
const TITLE_BAR = 36
const CHAT_MARGIN = 10
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const isRect = (r) => !!r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]))

/**
 * Dove aprire la stanza: quella salvata se sta ancora sullo schermo, se no al
 * centro dell'area di lavoro. Mai piu' grande dell'area, mai sotto il minimo.
 * @param {unknown} saved
 * @param {Rect} area area di lavoro dello schermo
 * @returns {Rect}
 */
function roomBounds(saved, area) {
  const fit = (w, h) => ({
    width: Math.round(Math.max(Math.min(ROOM_MIN.width, area.width), Math.min(w, area.width))),
    height: Math.round(Math.max(Math.min(ROOM_MIN.height, area.height), Math.min(h, area.height))),
  })
  if (isRect(saved)) {
    const r = /** @type {Rect} */ (saved)
    const { width, height } = fit(r.width, r.height)
    // Deve restare afferrabile: la barra del titolo dentro l'area.
    const x = Math.max(area.x, Math.min(Math.round(r.x), area.x + area.width - width))
    const y = Math.max(area.y, Math.min(Math.round(r.y), area.y + area.height - height))
    const moved = Math.abs(x - r.x) > r.width / 2 || Math.abs(y - r.y) > r.height / 2
    if (!moved) return { x, y, width, height }
  }
  const { width, height } = fit(ROOM_DEFAULT.width, ROOM_DEFAULT.height)
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width, height,
  }
}

/**
 * La stanza mentre si trascina un bordo: edge e' una o due lettere (n, s, e,
 * w), dx e dy lo spostamento del cursore dall'inizio. Il lato opposto resta
 * fermo anche quando si arriva al minimo.
 * @param {Rect} start
 * @param {string} edge
 * @param {number} dx
 * @param {number} dy
 * @returns {Rect}
 */
function resizeBounds(start, edge, dx, dy) {
  if (!EDGES.includes(edge)) return { ...start }
  let { x, y, width, height } = start
  if (edge.includes('e')) width = Math.max(ROOM_MIN.width, start.width + dx)
  if (edge.includes('s')) height = Math.max(ROOM_MIN.height, start.height + dy)
  if (edge.includes('w')) {
    width = Math.max(ROOM_MIN.width, start.width - dx)
    x = start.x + start.width - width
  }
  if (edge.includes('n')) {
    height = Math.max(ROOM_MIN.height, start.height - dy)
    y = start.y + start.height - height
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/**
 * Posto della chat agganciata: a destra dentro la stanza, sotto la barra del
 * titolo, alta quanto la stanza.
 * @param {Rect} room
 * @returns {Rect}
 */
function chatDock(room) {
  return {
    x: Math.round(room.x + room.width - CHAT_WIDTH - CHAT_MARGIN),
    y: Math.round(room.y + TITLE_BAR + CHAT_MARGIN),
    width: CHAT_WIDTH,
    height: Math.max(200, Math.round(room.height - TITLE_BAR - 2 * CHAT_MARGIN)),
  }
}

/** Spazio a destra che la chat agganciata toglie alla scena, in px. */
const CHAT_INSET = CHAT_WIDTH + 2 * CHAT_MARGIN

const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/
const HDR_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.hdr$/i
const VARIANTS = ['day', 'dawn', 'dusk', 'night']

/**
 * Le scene HDRI di modelli-3d/scenes/scenes.json, controllate: id semplici,
 * solo file .hdr della cartella che esistono davvero, e almeno quello di
 * giorno. height e' l'altezza della fotocamera che ha scattato la foto, per
 * proiettarla sul pavimento.
 * @param {unknown} json
 * @param {(file: string) => boolean} exists
 * @returns {{ id: string, label: string, outdoor: boolean, height: number, radius: number, variants: Record<string, string> }[]}
 */
function parseScenes(json, exists) {
  const list = json && typeof json === 'object' && Array.isArray(/** @type {any} */ (json).scenes) ? /** @type {any} */ (json).scenes : []
  const seen = new Set()
  const out = []
  for (const s of list) {
    if (!s || typeof s !== 'object' || !SCENE_ID_RE.test(s.id) || seen.has(s.id)) continue
    if (s.id === 'studio' || s.id === 'giardino') continue
    /** @type {Record<string, string>} */
    const variants = {}
    for (const v of VARIANTS) {
      const file = s.variants && s.variants[v]
      if (typeof file === 'string' && HDR_FILE_RE.test(file) && exists(file)) variants[v] = file
    }
    if (!variants.day) continue
    seen.add(s.id)
    const height = Number(s.height)
    const radius = Number(s.radius)
    out.push({
      id: s.id,
      label: String(s.label || s.id).slice(0, 40),
      outdoor: s.outdoor === true,
      height: Number.isFinite(height) && height > 0.2 && height < 20 ? height : 1.6,
      // Raggio della cupola su cui si proietta la foto: grande all'aperto,
      // quanto la stanza al chiuso (con 100 m le pareti si curvavano).
      radius: Number.isFinite(radius) && radius >= 4 && radius <= 500 ? radius : 100,
      variants,
    })
  }
  return out
}

module.exports = { ROOM_MIN, ROOM_DEFAULT, CHAT_WIDTH, CHAT_INSET, TITLE_BAR, EDGES, roomBounds, resizeBounds, chatDock, isRect, parseScenes }
