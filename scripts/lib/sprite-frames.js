// sprite-frames.js — analisi dei fogli di sprite, senza dipendenze.
//
// Lavora su bitmap a 4 canali con l'alpha all'indice 3 (vale sia per il BGRA
// di nativeImage sia per l'RGBA), cosi' build-strips.js lo usa con Electron e
// i test lo verificano da Node con bitmap costruite a mano.

// Alpha oltre cui un pixel e' "pieno". Gli aloni sfumati attorno ai contorni
// restano sotto.
const SOLID_ALPHA = 96

/**
 * Isole di pixel pieni (connessione a 8), con riquadro e numero di pixel.
 * @param {Buffer|Uint8Array} bitmap
 * @returns {{top:number,bottom:number,left:number,right:number,pixels:number}[]}
 */
function findIslands(bitmap, width, height, alphaMin = SOLID_ALPHA) {
  const total = width * height
  const solid = new Uint8Array(total)
  for (let i = 0; i < total; i++) solid[i] = bitmap[i * 4 + 3] > alphaMin ? 1 : 0

  const seen = new Uint8Array(total)
  const queue = new Int32Array(total)
  const islands = []
  for (let startPx = 0; startPx < total; startPx++) {
    if (!solid[startPx] || seen[startPx]) continue
    const island = { top: height, bottom: -1, left: width, right: -1, pixels: 0 }
    let head = 0
    let tail = 0
    queue[tail++] = startPx
    seen[startPx] = 1
    while (head < tail) {
      const px = queue[head++]
      const x = px % width
      const y = (px - x) / width
      island.pixels++
      if (y < island.top) island.top = y
      if (y > island.bottom) island.bottom = y
      if (x < island.left) island.left = x
      if (x > island.right) island.right = x
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const n = ny * width + nx
          if (solid[n] && !seen[n]) { seen[n] = 1; queue[tail++] = n }
        }
      }
    }
    islands.push(island)
  }
  return islands
}

/**
 * Riduce un riquadro al solo personaggio: tiene l'isola piu' grande e quelle
 * che le stanno accanto (una mano staccata, la coda), scarta quelle
 * interamente sopra o sotto e i ritagli del fotogramma vicino tagliati dal
 * bordo. Con cutLabel taglia anche sotto l'ultima riga con i colori caldi
 * delle scarpe: serve per le etichette attaccate ai piedi nella strip CLICK di
 * Yanineko. Il bitmap deve essere BGRA (nativeImage).
 * @returns {{x:number,y:number,width:number,height:number}|null} relativo al bitmap
 */
function trimToCharacter(bitmap, width, height, { cutLabel = false } = {}) {
  const islands = findIslands(bitmap, width, height)
  if (!islands.length) return null

  const main = islands.reduce((a, b) => (b.pixels > a.pixels ? b : a))
  const touchesBorder = (i) => i.top === 0 || i.left === 0 || i.bottom === height - 1 || i.right === width - 1
  const kept = islands.filter(i => i === main || (
    i.top <= main.bottom && i.bottom >= main.top &&
    !(touchesBorder(i) && i.pixels < main.pixels * 0.05)))
  // Un pixel di margine ai lati per l'alone sfumato. Sopra e sotto no: li'
  // l'alone dei frammenti scartati e dell'etichetta arriva fino al personaggio.
  const left = Math.max(0, Math.min(...kept.map(i => i.left)) - 1)
  const right = Math.min(width - 1, Math.max(...kept.map(i => i.right)) + 1)
  const top = Math.min(...kept.map(i => i.top))
  let bottom = Math.max(...kept.map(i => i.bottom))

  if (cutLabel) {
    for (let y = bottom; y > top; y--) {
      let solidCount = 0
      let warm = 0
      for (let x = left; x <= right; x++) {
        const i = (y * width + x) * 4
        if (bitmap[i + 3] <= SOLID_ALPHA) continue
        solidCount++
        const b = bitmap[i], r = bitmap[i + 2]
        if (r > 90 && r > b + 20) warm++
      }
      if (solidCount && warm >= solidCount * 0.1) { bottom = y; break }
    }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * Trova i fotogrammi in un foglio senza coordinate: ogni fotogramma e' un
 * gruppo di isole vicine, separato dagli altri da spazio vuoto. Le isole
 * minuscole (polvere, sbavature) vengono ignorate; quelle vicine si fondono,
 * cosi' una nuvoletta o il fumo restano nel fotogramma del personaggio.
 * Ordine: righe dall'alto, poi da sinistra a destra.
 *
 * mergeGap e' la distanza sotto cui due isole appartengono allo stesso
 * fotogramma: il brief (docs/avatar-brief.md) chiede almeno 40 px di vuoto fra
 * un fotogramma e l'altro, quindi 24 px uniscono i pezzi staccati senza
 * fondere fotogrammi vicini.
 * @returns {{x:number,y:number,width:number,height:number}[]}
 */
function detectFrames(bitmap, width, height, { minFraction = 0.01, mergeGap = 24 } = {}) {
  const islands = findIslands(bitmap, width, height)
  if (!islands.length) return []
  const largest = Math.max(...islands.map(i => i.pixels))
  let groups = islands.filter(i => i.pixels >= largest * minFraction).map(i => ({ ...i }))

  // Fonde i gruppi i cui riquadri, allargati di mergeGap, si toccano.
  let merged = true
  while (merged) {
    merged = false
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const A = groups[a], B = groups[b]
        if (A.left - mergeGap <= B.right && B.left - mergeGap <= A.right &&
            A.top - mergeGap <= B.bottom && B.top - mergeGap <= A.bottom) {
          groups[a] = {
            top: Math.min(A.top, B.top), bottom: Math.max(A.bottom, B.bottom),
            left: Math.min(A.left, B.left), right: Math.max(A.right, B.right), pixels: A.pixels + B.pixels,
          }
          groups.splice(b, 1)
          merged = true
          break outer
        }
      }
    }
  }

  // Righe: due gruppi stanno sulla stessa riga se si sovrappongono in verticale.
  groups.sort((a, b) => a.top - b.top)
  const rows = []
  for (const g of groups) {
    const row = rows.find(r => g.top <= r.bottom && g.bottom >= r.top)
    if (row) { row.items.push(g); row.top = Math.min(row.top, g.top); row.bottom = Math.max(row.bottom, g.bottom) }
    else rows.push({ top: g.top, bottom: g.bottom, items: [g] })
  }
  rows.sort((a, b) => a.top - b.top)
  return rows.flatMap(r => r.items.sort((a, b) => a.left - b.left))
    .map(g => ({ x: g.left, y: g.top, width: g.right - g.left + 1, height: g.bottom - g.top + 1 }))
}

module.exports = { SOLID_ALPHA, findIslands, trimToCharacter, detectFrames }
