// touch.js — come si tocca l'avatar: clic o presa, dove, carezza.
//
// Tre parti, tutte pure (i test le caricano da Node):
// - clic o presa (Blocco 5a, sotto);
// - dove: la zona toccata (testa, viso, petto...), dalle ossa proiettate sullo
//   schermo nel 3D o dall'altezza nella figura nel 2D e in Live2D;
// - la carezza, il mouse avanti e indietro sulla testa (Blocco 5b).
// Come reagisce lo decide il main (src/main/touch-react.js): la zona e il
// tipo di tocco vanno li', e torna la reazione da recitare.
//
// Clic e presa partono dallo stesso tasto sinistro. Con una soglia di pochi
// px un clic normale, con il tremolio della mano o di un mouse sensibile,
// diventava una presa: partiva il trascinamento e la reazione al clic non
// arrivava. Qui la regola:
// - sotto CLICK_SLOP px e' ancora un clic, quanto che duri;
// - oltre CLICK_SLOP px e' una presa;
// - tenuto oltre SLOW_DRAG_MS, bastano SLOW_DRAG_PX: chi trascina piano e'
//   deciso, e non deve spostare il cursore di 10 px prima che l'avatar segua;
// - tenuto fermo oltre PICKUP_MS lo si prende in braccio senza spostarlo.
// Le distanze sono in px dello schermo di Electron (DIP): la scala di Windows
// e' gia' tolta, quindi valgono uguali su ogni monitor.
//
// Script classico e non modulo, come sway.js: lo usa companion-input.js e i
// test lo caricano da Node.

(function (root) {
  const PRESS = {
    CLICK_SLOP: 10,     // px: sotto questa distanza e' ancora un clic
    SLOW_DRAG_MS: 350,  // dopo questo tempo la presa parte con meno strada
    SLOW_DRAG_PX: 4,
    PICKUP_MS: 600,     // tenuto fermo: preso in braccio
  }

  /**
   * Cosa fare con il sinistro ancora premuto: 'drag' (parte la presa) o
   * 'wait' (puo' ancora essere un clic).
   * @param {number} elapsedMs da quando il tasto e' giu'
   * @param {number} distance px percorsi dal punto di pressione
   */
  function pressAction(elapsedMs, distance) {
    if (distance >= PRESS.CLICK_SLOP) return 'drag'
    if (elapsedMs >= PRESS.SLOW_DRAG_MS && distance >= PRESS.SLOW_DRAG_PX) return 'drag'
    if (elapsedMs >= PRESS.PICKUP_MS) return 'drag'
    return 'wait'
  }

  /** Destro o centrale: si e' mosso abbastanza da non essere piu' un clic? */
  function movedBeyondClick(distance) {
    return distance >= PRESS.CLICK_SLOP
  }

  // ─── Dove: le zone ─────────────────────────────────────────────────────────

  const ZONES = ['head', 'face', 'chest', 'belly', 'lowerBelly', 'hand', 'legs']
  const KINDS = ['poke', 'pat']

  // Per altezza nella figura, dall'alto: ogni riga e' [zona, fino a], in
  // frazioni dell'altezza dell'avatar. full: figura intera con proporzioni
  // anime, circa sei teste (misurata sugli sprite di Yanineko); chibi: testa
  // grande; bust: busto senza gambe (molti Live2D).
  const HEIGHT_TABLES = {
    full:  [['head', 0.13], ['face', 0.24], ['chest', 0.38], ['belly', 0.49], ['lowerBelly', 0.57], ['legs', 1]],
    chibi: [['head', 0.18], ['face', 0.38], ['chest', 0.52], ['belly', 0.64], ['lowerBelly', 0.72], ['legs', 1]],
    bust:  [['head', 0.20], ['face', 0.45], ['chest', 0.75], ['belly', 1]],
  }

  /**
   * Zona da un'altezza nella figura (0 in cima, 1 ai piedi).
   * @param {number} frac
   * @param {Array<[string, number]>|string} [table] righe, o nome in HEIGHT_TABLES
   */
  function zoneFromHeight(frac, table = 'full') {
    const rows = typeof table === 'string' ? HEIGHT_TABLES[table] || HEIGHT_TABLES.full : table
    if (!Number.isFinite(frac) || frac < 0 || frac > 1) return null
    for (const [zone, upTo] of rows) if (frac <= upTo) return zone
    return rows[rows.length - 1][0]
  }

  /**
   * Zone di un pacchetto 2D (sprites.json, campo "touchZones"): [[zona, fino
   * a]...] in ordine crescente, l'ultima fino a 1. Valori sbagliati: null, e
   * si usa la tabella standard.
   */
  function heightTableFrom(touchZones) {
    if (!Array.isArray(touchZones) || !touchZones.length || touchZones.length > ZONES.length) return null
    let last = 0
    for (const row of touchZones) {
      if (!Array.isArray(row) || !ZONES.includes(row[0]) || !Number.isFinite(row[1]) || row[1] <= last || row[1] > 1) return null
      last = row[1]
    }
    return last === 1 ? touchZones.map(r => [r[0], r[1]]) : null
  }

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
  const dot = (a, b) => a.x * b.x + a.y * b.y
  const len = (a) => Math.hypot(a.x, a.y)
  function segmentDistance(p, a, b) {
    const ab = sub(b, a)
    const l2 = dot(ab, ab)
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0
    return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }))
  }

  // Proporzioni del corpo in unita' di H, la distanza bacino-testa sullo
  // schermo (l'osso head sta alla base del cranio). Larghe apposta: un clic
  // vicino al confine non deve finire nella zona sbagliata per pochi pixel.
  const BODY = {
    headCenter: 0.20, headRadius: 0.26, eyeLine: 0.16,
    handRadius: 0.13, forearmRadius: 0.08,
    chestFrom: 0.50, bellyFrom: 0.17, lowerBellyFrom: -0.20, lowerBellyHalfWidth: 0.17,
  }

  /**
   * Zona da un punto e dalle ossa proiettate sullo schermo (px della finestra).
   * Le direzioni vengono dalle ossa, non dagli assi dello schermo: con la
   * camera ruotata o l'avatar inclinato le zone restano giuste.
   * @param {{x: number, y: number}} p
   * @param {Record<string, {x: number, y: number}|null|undefined>} bones hips,
   *        neck e head obbligatorie; leftHand, rightHand, leftLowerArm,
   *        rightLowerArm facoltative
   * @param {{ facingAway?: boolean, headScale?: number }} [options]
   *        facingAway: lo si guarda da dietro, e li' non c'e' il basso ventre;
   *        headScale: la testa rispetto al busto (chibi), 1 di base
   */
  function zoneFromBones(p, bones, options = {}) {
    const { hips, neck, head } = bones || {}
    if (!p || !hips || !neck || !head) return null
    const H = len(sub(head, hips))
    if (!(H > 4)) return null
    for (const side of ['left', 'right']) {
      const hand = bones[side + 'Hand']
      const fore = bones[side + 'LowerArm']
      if (hand && len(sub(p, hand)) < BODY.handRadius * H) return 'hand'
      if (hand && fore && segmentDistance(p, fore, hand) < BODY.forearmRadius * H) return 'hand'
    }
    const upHead = sub(head, neck)
    const upLen = len(upHead) || 1
    const uh = { x: upHead.x / upLen, y: upHead.y / upLen }
    const hs = options.headScale > 0 ? options.headScale : 1
    const center = { x: head.x + uh.x * BODY.headCenter * hs * H, y: head.y + uh.y * BODY.headCenter * hs * H }
    if (len(sub(p, center)) < BODY.headRadius * hs * H) {
      const along = dot(sub(p, head), uh) / (hs * H)
      if (along >= -0.04) return along > BODY.eyeLine ? 'head' : 'face'
    }
    const axis = sub(neck, hips)
    const axisLen = len(axis) || 1
    const ua = { x: axis.x / axisLen, y: axis.y / axisLen }
    const rel = sub(p, hips)
    const s = dot(rel, ua) / H
    const lateral = Math.abs(rel.x * ua.y - rel.y * ua.x) / H
    if (s >= BODY.chestFrom) return 'chest'
    if (s >= BODY.bellyFrom) return 'belly'
    if (s >= BODY.lowerBellyFrom) {
      if (lateral > BODY.lowerBellyHalfWidth) return 'legs'
      return options.facingAway ? 'legs' : 'lowerBelly'
    }
    return 'legs'
  }

  // ─── Carezza: avanti e indietro sulla testa ───────────────────────────────

  // MIN_SWING_PX: un cambio di direzione conta solo dopo un'oscillazione di
  // almeno tanto, cosi' il tremolio della mano non diventa una carezza.
  const PAT = { TURNS: 3, WINDOW_MS: 1200, MIN_STEP_PX: 2, MIN_SWING_PX: 12, REPEAT_MS: 1500 }

  /**
   * Riconosce la carezza: almeno PAT.TURNS cambi di direzione orizzontale in
   * PAT.WINDOW_MS, con il cursore sulla testa e nessun tasto premuto. Chi
   * continua ad accarezzare ne conta un'altra ogni PAT.REPEAT_MS.
   */
  function createRubDetector() {
    let lastX = null
    let dir = 0
    let swing = 0
    let turns = []
    let lastPatAt = -Infinity
    const reset = () => { lastX = null; dir = 0; swing = 0; turns = [] }
    return {
      /**
       * @param {number} x px
       * @param {number} now ms
       * @param {boolean} onHead cursore sulla testa, nessun tasto premuto
       * @returns {boolean} true: e' una carezza
       */
      feed(x, now, onHead) {
        if (!onHead || !Number.isFinite(x)) { reset(); return false }
        if (lastX === null) { lastX = x; return false }
        const step = x - lastX
        if (Math.abs(step) < PAT.MIN_STEP_PX) return false
        lastX = x
        const d = Math.sign(step)
        if (d === dir) swing += Math.abs(step)
        else {
          if (dir !== 0 && swing >= PAT.MIN_SWING_PX) turns.push(now)
          dir = d
          swing = Math.abs(step)
        }
        turns = turns.filter(t => now - t <= PAT.WINDOW_MS)
        if (turns.length >= PAT.TURNS && now - lastPatAt >= PAT.REPEAT_MS) {
          lastPatAt = now
          turns = []
          return true
        }
        return false
      },
      reset,
    }
  }

  const api = {
    PRESS, pressAction, movedBeyondClick,
    ZONES, KINDS, HEIGHT_TABLES, BODY, zoneFromHeight, heightTableFrom, zoneFromBones,
    PAT, createRubDetector,
  }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.CompanionTouch = api
})(typeof window !== 'undefined' ? window : globalThis)
