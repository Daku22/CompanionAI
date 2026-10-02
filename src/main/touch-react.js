// touch-react.js — come reagisce l'avatar quando lo tocchi (Blocco 5b).
//
// Il renderer riconosce dove e come lo hai toccato (src/renderer/touch.js) e
// manda zona e tipo di tocco; qui si decide la reazione: il gesto da recitare,
// l'espressione, quanto si sposta l'umore e, a volte, una battuta. Lo stato
// dei clic ripetuti sta qui e non nel renderer, cosi' vale uguale per il 3D,
// il 2D e Live2D, e cambiare avatar non azzera i gradini del fastidio.
//
// Solo i clic ripetuti sul basso ventre danno fastidio, a gradini: imbarazzo,
// rimprovero, poi si gira di spalle. Il tono resta quello di chi si imbarazza
// o rimprovera, mai allusivo. Le altre zone restano amichevoli; tanti clic
// fitti ovunque lo fanno ridere piu' in fretta e poi lo stufano un poco.
//
// Funzioni pure: il tempo entra come argomento, i test non hanno orologi.

const { LINES } = require('./touch-lines')

// Stessi nomi di src/renderer/touch.js (test-touch-react.js controlla).
const ZONES = ['head', 'face', 'chest', 'belly', 'lowerBelly', 'hand', 'legs']
const KINDS = ['poke', 'pat']

// Basso ventre: ogni clic sale di un gradino, ogni LOWER_DECAY_MS senza clic
// se ne scende uno. Clic fitti ovunque (nella finestra SPAM_WINDOW_MS): da
// SPAM_GIGGLE ride piu' in fretta, da SPAM_SCOLD si stufa un poco.
const STEPS = { LOWER_DECAY_MS: 20000, TURNAWAY_MS: 5000, SPAM_WINDOW_MS: 4000, SPAM_GIGGLE: 6, SPAM_SCOLD: 9 }

// slot: il gesto (vrm-animation.js, AnimationLibrary.js); expression: VRM,
// con peso e durata in ms; mood: spostamenti dell'umore (mood.js nudge, che
// gia' rallenta l'affetto); line: la famiglia di battute (touch-lines.js) e
// chance la probabilita' di dirne una.
const REACTIONS = {
  pat:        { slot: 'pat',      expression: 'happy',     weight: 1.0,  ms: 2200, mood: { affection: 0.05, calm: 0.06 },       line: 'pat',        chance: 0.3 },
  headTap:    { slot: 'pat',      expression: 'happy',     weight: 0.7,  ms: 1200, mood: { affection: 0.02 },                   line: 'headTap',    chance: 0.15 },
  flinch:     { slot: 'flinch',   expression: 'surprised', weight: 0.9,  ms: 1000, mood: { curiosity: 0.05 },                   line: 'face',       chance: 0.2 },
  giggle:     { slot: 'giggle',   expression: 'happy',     weight: 1.0,  ms: 1600, mood: { joy: 0.06 },                         line: 'tickle',     chance: 0.25 },
  hand:       { slot: 'hop',      expression: 'happy',     weight: 0.8,  ms: 1200, mood: { affection: 0.02 },                   line: 'hand',       chance: 0.2 },
  hop:        { slot: 'hop',      expression: 'surprised', weight: 0.6,  ms: 700,  mood: { curiosity: 0.04 },                   line: 'legs',       chance: 0.15 },
  shy:        { slot: 'shy',      expression: 'surprised', weight: 0.5,  ms: 1800, mood: { curiosity: 0.03 },                   line: 'shy',        chance: 0.7 },
  scold:      { slot: 'scold',    expression: 'angry',     weight: 0.6,  ms: 2400, mood: { annoyance: 0.12 },                   line: 'scold',      chance: 0.9 },
  turnaway:   { slot: 'turnaway', expression: 'angry',     weight: 0.9,  ms: 5000, mood: { annoyance: 0.25, affection: -0.02 }, line: 'turnaway',   chance: 1 },
  spamGiggle: { slot: 'giggle',   expression: 'happy',     weight: 1.0,  ms: 1000, mood: { joy: 0.02, annoyance: 0.03 },        line: 'spamGiggle', chance: 0.3 },
  spamScold:  { slot: 'scold',    expression: 'angry',     weight: 0.35, ms: 1500, mood: { annoyance: 0.08 },                   line: 'spamScold',  chance: 0.6 },
}

const POKE_REACTION = { head: 'headTap', face: 'flinch', chest: 'giggle', belly: 'giggle', hand: 'hand', legs: 'hop' }

/** Gradino del basso ventre: 1 imbarazzo, 2-3 rimprovero, 4 e oltre si gira. */
function lowerBellyReaction(step) {
  if (step >= 4) return 'turnaway'
  if (step >= 2) return 'scold'
  return 'shy'
}

/**
 * Un tocco dal renderer, controllato: arriva da una pagina e non ci si fida.
 * @returns {{ zone: string, kind: string } | null}
 */
function checkTouch(input) {
  if (!input || typeof input !== 'object') return null
  if (!ZONES.includes(input.zone) || !KINDS.includes(input.kind)) return null
  return { zone: input.zone, kind: input.kind }
}

/**
 * Stato dei tocchi: onTouch dice quale reazione dare, o null se nessuna
 * (girato di spalle, carezza fuori dalla testa).
 */
function createTouchState() {
  let lower = 0
  let lowerAt = 0
  let clicks = []
  let turnedUntil = 0
  function settle(now) {
    if (lower <= 0) return
    const drop = Math.floor((now - lowerAt) / STEPS.LOWER_DECAY_MS)
    if (drop > 0) { lower = Math.max(0, lower - drop); lowerAt += drop * STEPS.LOWER_DECAY_MS }
  }
  return {
    /**
     * @param {string} zone
     * @param {string} kind 'poke' o 'pat'
     * @param {number} now ms
     * @returns {{ name: string, step: number, zone: string, kind: string } | null}
     */
    onTouch(zone, kind, now) {
      if (!ZONES.includes(zone) || !KINDS.includes(kind)) return null
      settle(now)
      // Girato di spalle non si lascia toccare; una carezza lo addolcisce.
      if (now < turnedUntil) {
        if (kind === 'pat' && lower > 0) { lower--; lowerAt = now }
        return null
      }
      if (kind === 'pat') {
        if (zone !== 'head' && zone !== 'face') return null
        if (lower > 0) { lower--; lowerAt = now }
        return { name: 'pat', step: 0, zone, kind }
      }
      if (zone === 'lowerBelly') {
        lower++
        lowerAt = now
        const name = lowerBellyReaction(lower)
        if (name === 'turnaway') turnedUntil = now + STEPS.TURNAWAY_MS
        return { name, step: lower, zone, kind }
      }
      clicks = clicks.filter(t => now - t < STEPS.SPAM_WINDOW_MS)
      clicks.push(now)
      if (clicks.length >= STEPS.SPAM_SCOLD) return { name: 'spamScold', step: clicks.length, zone, kind }
      if (clicks.length >= STEPS.SPAM_GIGGLE) return { name: 'spamGiggle', step: clicks.length, zone, kind }
      return { name: POKE_REACTION[zone], step: 0, zone, kind }
    },
    debug: () => ({ lower, turnedUntil, clicks: clicks.length }),
  }
}

/**
 * Una battuta della famiglia, con la sua probabilita', senza ripetere
 * l'ultima detta. null: questa volta niente.
 * @param {string} family
 * @param {number} chance
 * @param {Record<string, string>} last ultima battuta per famiglia (si aggiorna)
 * @param {() => number} [rand]
 */
function pickLine(family, chance, last, rand = Math.random) {
  const lines = LINES[family]
  if (!lines || !lines.length || rand() >= chance) return null
  const pool = lines.length > 1 ? lines.filter(l => l !== last[family]) : lines
  const line = pool[Math.floor(rand() * pool.length) % pool.length]
  last[family] = line
  return line
}

/**
 * La battuta si dice anche a voce? Solo se c'e', e se la voce e' libera: una
 * battuta non deve interrompere una risposta che sta leggendo, ne' partire
 * mentre si aspetta una risposta o il microfono ascolta.
 * @param {string|null} line
 * @param {{ voiceOn: boolean, speaking: boolean, awaitingReply: boolean, listening: boolean }} state
 */
function shouldSayLine(line, state) {
  return !!line && state.voiceOn && !state.speaking && !state.awaitingReply && !state.listening
}

const ZONE_TEXT = {
  head: 'sulla testa', face: 'sul viso', chest: 'sul petto', belly: 'sulla pancia',
  lowerBelly: 'sul basso ventre', hand: 'sulla mano', legs: 'sulle gambe',
}

/**
 * Riga per il prompt sull'ultimo tocco, cosi' il modello sa cosa e' appena
 * successo. null dopo tre minuti. Senza genere, ne' per il companion ne' per
 * l'utente.
 * @param {{ name: string, zone: string, kind: string, at: number } | null} last
 * @param {number} now
 */
function touchPromptText(last, now) {
  if (!last || !(now - last.at < 3 * 60000)) return null
  if (last.kind === 'pat') return "Poco fa l'utente ti ha fatto una carezza sulla testa, e ti ha fatto piacere."
  const where = ZONE_TEXT[last.zone] || ''
  if (last.name === 'turnaway') return "Poco fa l'utente ha insistito a toccarti " + where + ' anche dopo che avevi chiesto di smettere: hai voltato le spalle e provi fastidio.'
  if (last.name === 'scold' || last.name === 'spamScold') return "Poco fa l'utente ha continuato a toccarti " + where + ' e hai chiesto di smettere.'
  if (last.name === 'shy') return "Poco fa l'utente ti ha toccato " + where + ' e hai provato imbarazzo.'
  return "Poco fa l'utente ti ha dato un colpetto " + where + '.'
}

module.exports = {
  ZONES, KINDS, STEPS, REACTIONS,
  checkTouch, createTouchState, pickLine, shouldSayLine, touchPromptText,
}
