// live2d-map.js — come un modello Live2D risponde al companion. Puro, con
// test (scripts/test-live2d-map.js).
//
// I gesti del contratto di risposta (wave, happy, think...) e le emozioni
// dell'umore non esistono in un modello Live2D: il modello ha gruppi di
// movimenti con nomi suoi ("Idle", "Tap", "FlickUp", "Tap@Body") e, a volte,
// espressioni ("f01", "Smile"). Qui si propone un abbinamento dai nomi; chi
// vuole lo cambia nelle Impostazioni (scheda Live2D), e la scelta vince.
//
// In piu' il test del punto: un punto e' sull'avatar se cade in un triangolo
// di una mesh visibile. Con i clic che passano sulle parti vuote della
// finestra, il riquadro del modello non basterebbe.

(function () {
  // Gesti che hanno senso come movimento. Per ognuno, i nomi di gruppo da
  // cercare in ordine; il primo che c'e' vince. Gli altri gesti (sit, doze,
  // smoke, scroll...) restano sul riposo: un movimento a caso sarebbe peggio.
  const GESTURE_PATTERNS = {
    wave: [/wave|hello|greet|bye/i, /^tap$/i, /^tap/i, /^flick$/i],
    happy: [/happy|joy|smile|laugh|glad/i, /flick.?up/i, /tap@body/i, /^tap/i],
    click: [/tap@body/i, /^tap/i, /^flick/i],
    dance: [/dance|shake/i, /flick@body/i, /^flick$/i],
    think: [/think|ponder|wonder|question/i, /flick.?down/i],
    stretch: [/stretch/i, /flick.?up/i],
    yawn: [/yawn|sleepy|tired/i, /flick.?down/i],
    search: [/search|look/i],
    // Reazioni ai tocchi (Blocco 5b). Senza un gruppo adatto restano a null e
    // companion-live2d.js muove testa, corpo e occhi da se'.
    pat: [/pat|stroke|nade/i, /tap@head/i],
    flinch: [/surpris|startl|flinch/i, /tap@face/i],
    giggle: [/laugh|giggle|tickl/i],
    hop: [/jump|hop/i],
    shy: [/shy|blush|embarrass/i],
    scold: [/angry|anger|scold|mad/i],
    turnaway: [/turn.?away|sulk|ignore/i],
  }
  const GESTURES = Object.keys(GESTURE_PATTERNS)
  const IDLE_PATTERNS = [/^idle$/i, /idle/i]

  // Emozioni dell'umore (mood.js) e nomi di espressione da cercare.
  const EMOTION_PATTERNS = {
    joy: [/happy|joy|smile|laugh|glad/i],
    affection: [/love|blush|shy|affection|heart/i, /happy|smile/i],
    sadness: [/sad|cry|tear|sorrow/i],
    annoyance: [/angry|anger|annoy|mad|pout/i],
    curiosity: [/surpris|curious|wonder|question/i],
    calm: [/calm|relax|neutral|normal|default/i],
  }
  const EMOTIONS = Object.keys(EMOTION_PATTERNS)

  function firstMatch(names, patterns) {
    for (const re of patterns) {
      const hit = names.find(n => re.test(n))
      if (hit) return hit
    }
    return null
  }

  /**
   * Gesto -> gruppo di movimenti, dai nomi dei gruppi. null: resta il riposo.
   * @param {string[]} groups
   * @returns {Record<string, string|null>}
   */
  function proposeMotionMap(groups) {
    const names = (groups || []).filter(g => typeof g === 'string' && g)
    const idle = firstMatch(names, IDLE_PATTERNS)
    const active = names.filter(n => n !== idle)
    /** @type {Record<string, string|null>} */
    const map = {}
    for (const gesture of GESTURES) map[gesture] = firstMatch(active, GESTURE_PATTERNS[gesture])
    return map
  }

  /** Il gruppo dei movimenti a riposo, se il modello ne ha uno. */
  function idleGroup(groups) {
    return firstMatch((groups || []).filter(g => typeof g === 'string'), IDLE_PATTERNS)
  }

  /**
   * Emozione -> espressione, dai nomi delle espressioni. null: nessuna.
   * @param {string[]} expressions
   */
  function proposeExpressionMap(expressions) {
    const names = (expressions || []).filter(e => typeof e === 'string' && e)
    /** @type {Record<string, string|null>} */
    const map = {}
    for (const emotion of EMOTIONS) map[emotion] = firstMatch(names, EMOTION_PATTERNS[emotion])
    return map
  }

  /**
   * La proposta con le scelte dell'utente sopra: valgono solo gruppi o
   * espressioni che il modello ha davvero ('' = nessuno, voluto).
   * @param {Record<string, string|null>} proposed
   * @param {Record<string, string>} [chosen]
   * @param {string[]} available
   */
  function applyChoices(proposed, chosen, available) {
    const out = { ...proposed }
    for (const [key, value] of Object.entries(chosen || {})) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) continue
      if (value === '') out[key] = null
      else if (available.includes(value)) out[key] = value
    }
    return out
  }

  /** Il punto (px, py) cade in un triangolo della mesh? vertices: [x0, y0, x1, y1...]. */
  function pointInMesh(px, py, vertices, indices) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i] * 2, b = indices[i + 1] * 2, c = indices[i + 2] * 2
      const ax = vertices[a], ay = vertices[a + 1]
      const bx = vertices[b], by = vertices[b + 1]
      const cx = vertices[c], cy = vertices[c + 1]
      const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
      const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
      const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
      const neg = d1 < 0 || d2 < 0 || d3 < 0
      const pos = d1 > 0 || d2 > 0 || d3 > 0
      if (!(neg && pos)) return true
    }
    return false
  }

  const api = { GESTURES, EMOTIONS, proposeMotionMap, idleGroup, proposeExpressionMap, applyChoices, pointInMesh }
  window.Live2DMap = api
})()
