// avatar-thumb.js — la miniatura del viso di un avatar (Blocco 9c).
//
// La prima volta che un companion mostra un avatar, ne fotografa il viso: un
// PNG di 256x256 con lo sfondo trasparente, che il main salva e che le card
// delle Impostazioni (e la chat) mostrano al posto delle iniziali. Il 3D si
// inquadra con una camera davanti alla testa (companion-3d.js); per il 2D e il
// Live2D, e per i modelli 3D senza scheletro, qui si cerca la sagoma nel
// canvas appena disegnato e se ne ritaglia la parte alta.
//
// Script classico e non modulo: lo usano companion-2d.js, companion-live2d.js
// e companion-3d.js, e i test (faceRect) lo caricano da Node.

(function (root) {
  const SIZE = 256        // lato della miniatura, in px
  const ALPHA = 24        // da qui un pixel e' dell'avatar (come hitTest2D)
  const ANALYZE = 480     // lato massimo dell'immagine in cui si cerca la sagoma
  const MIN_COVER = 0.03  // sotto questa parte di pixel visibili lo scatto e' vuoto

  /**
   * Il quadrato del viso in un'immagine RGBA: la sagoma (i pixel visibili),
   * poi un quadrato in alto, largo quanto la sagoma ma non piu' di share
   * della sua altezza, centrato sulla parte alta (la testa: un braccio alzato
   * o una coda allargano la sagoma, non la testa).
   * @returns {{ x: number, y: number, size: number } | null}
   */
  function faceRect(data, w, h, share = 0.42, threshold = ALPHA) {
    let top = -1, bottom = -1, left = w, right = -1
    for (let y = 0; y < h; y++) {
      const row = y * w * 4
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] > threshold) {
          if (top < 0) top = y
          bottom = y
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }
    if (top < 0) return null
    const boxW = right - left + 1
    const boxH = bottom - top + 1
    const size = Math.max(1, Math.round(Math.min(boxW, boxH * share)))
    let bandL = w, bandR = -1
    const bandEnd = Math.min(bottom, top + Math.max(1, Math.round(size * 0.6)))
    for (let y = top; y <= bandEnd; y++) {
      for (let x = left; x <= right; x++) {
        if (data[(y * w + x) * 4 + 3] > threshold) { if (x < bandL) bandL = x; if (x > bandR) bandR = x }
      }
    }
    const cx = (bandL + bandR + 1) / 2
    const x = Math.round(Math.max(0, Math.min(w - size, cx - size / 2)))
    // Un filo di margine sopra i capelli, se c'e' posto.
    const y = Math.max(0, Math.min(h - size, top - Math.round(size * 0.04)))
    return { x, y, size }
  }

  /** Un quadrato di source in un PNG di SIZE px, o null se e' quasi vuoto. */
  function squareToPng(source, x, y, size) {
    const out = document.createElement('canvas')
    out.width = out.height = SIZE
    const ctx = out.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, x, y, size, size, 0, 0, SIZE, SIZE)
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data
    let seen = 0
    for (let i = 3; i < px.length; i += 4) if (px[i] > ALPHA) seen++
    return seen / (SIZE * SIZE) >= MIN_COVER ? out.toDataURL('image/png') : null
  }

  /**
   * Il viso di un canvas appena disegnato (WebGL: va letto prima che il
   * browser lo mostri, quindi subito dopo il render, senza attese).
   */
  function cropFace(source, share) {
    const W = source.width, H = source.height
    if (!W || !H) return null
    const k = Math.min(1, ANALYZE / Math.max(W, H))
    const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k))
    const probe = document.createElement('canvas')
    probe.width = w
    probe.height = h
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0, w, h)
    const r = faceRect(ctx.getImageData(0, 0, w, h).data, w, h, share)
    return r ? squareToPng(source, r.x / k, r.y / k, r.size / k) : null
  }

  /** Il quadrato centrale di un canvas (la camera sul viso del 3D). */
  function centerSquare(source) {
    const side = Math.min(source.width, source.height)
    return side ? squareToPng(source, (source.width - side) / 2, (source.height - side) / 2, side) : null
  }

  // Una richiesta alla volta per avatar: cambiarlo due volte di fila non scatta due foto.
  const pending = new Set()
  /**
   * Se al main manca la miniatura di id, aspetta che l'avatar sia a riposo,
   * scatta con capture() e la manda. still() dice se e' ancora il momento
   * (stesso avatar, niente stanza).
   */
  async function request(id, capture, { delay = 1500, still = () => true } = {}) {
    const api = root.companion
    if (!id || pending.has(id) || !api || !api.avatarThumbNeeded) return
    pending.add(id)
    try {
      if (!(await api.avatarThumbNeeded(id))) return
      await new Promise(r => setTimeout(r, delay))
      if (!still()) return
      const png = capture()
      if (png) await api.saveAvatarThumb(id, png)
    } catch (e) {
      console.warn('[miniatura] non scattata:', e.message)
    } finally {
      pending.delete(id)
    }
  }

  const api = { SIZE, faceRect, cropFace, centerSquare, request }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.CompanionThumb = api
})(typeof window !== 'undefined' ? window : globalThis)
