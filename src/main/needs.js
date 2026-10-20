// needs.js — fame e sete del companion (Blocco 10a).
//
// Due valori da 0 (sazio, dissetato) a 1 (molta fame, molta sete) che salgono
// solo con il tempo di app aperta: una giornata d'uso li porta in alto (fame
// in 8 ore, sete in 5), e il tempo ad app chiusa non conta. Scendono solo
// mangiando e bevendo (feed). Gli effetti sono graduali e mai irreversibili:
// con "un po'" di fame un filo di malumore, qualche sbadiglio e un fumetto
// ogni tanto; con "molta" tono scontroso, lamentele piu' frequenti e il
// rapporto che cala piano (rapport.js, onNeglect), finche' non mangia.
//
// Funzioni pure, come mood.js: lo stato entra e ne esce una copia nuova. Solo
// loadNeeds e saveNeeds toccano il disco.

const fs = require('fs')
const path = require('path')
const { writeAtomic } = require('./write-atomic')

const HOUR_MS = 60 * 60 * 1000
const RULES = {
  HUNGER_FULL_H: 8,     // ore di app aperta da sazio a molta fame
  THIRST_FULL_H: 5,
  SOME: 0.5,            // da qui "un po'"
  MUCH: 0.8,            // da qui "molta"
  // Un passo di tempo piu' lungo di questo e' un PC sospeso o un orologio
  // spostato, non tempo d'uso: si conta al massimo questo.
  MAX_STEP_MS: 2 * 60 * 1000,
  // Ogni quanto i bisogni spingono l'umore, e di quanto (fastidio; con molta
  // fame anche meno allegria).
  MOOD_EVERY_MS: 5 * 60 * 1000,
  MOOD_SOME: 0.02,
  MOOD_MUCH: 0.05,
  // Il rapporto con molta fame o sete: punti all'ora (rapport.js tiene il
  // tetto giornaliero).
  NEGLECT_PER_H: 0.5,
  // Fumetti: con un po' di fame ogni 20-40 minuti, con molta ogni 10-15.
  BUBBLE_SOME_MS: [20 * 60 * 1000, 40 * 60 * 1000],
  BUBBLE_MUCH_MS: [10 * 60 * 1000, 15 * 60 * 1000],
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const num01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0)

/**
 * @typedef {{ hunger: number, thirst: number }} Needs
 */

/** Stato iniziale, o quello salvato ripulito. */
function createNeeds(saved) {
  if (!saved || typeof saved !== 'object') return { hunger: 0, thirst: 0 }
  return { hunger: num01(saved.hunger), thirst: num01(saved.thirst) }
}

/**
 * Passa del tempo di app aperta (ms). I passi troppo lunghi (sospensione)
 * contano per MAX_STEP_MS.
 * @param {Needs} needs
 * @param {number} ms
 * @returns {Needs}
 */
function grow(needs, ms) {
  const step = Math.min(RULES.MAX_STEP_MS, Math.max(0, Number(ms) || 0))
  if (!step) return needs
  const h = step / HOUR_MS
  return {
    ...needs,
    hunger: clamp01(needs.hunger + h / RULES.HUNGER_FULL_H),
    thirst: clamp01(needs.thirst + h / RULES.THIRST_FULL_H),
  }
}

/**
 * Mangiare o bere: quanto toglie a fame e sete (valori da 0 a 1).
 * @param {Needs} needs
 * @param {{ hunger?: number, thirst?: number }} item
 * @returns {Needs}
 */
function feed(needs, item) {
  const h = num01(item && item.hunger)
  const t = num01(item && item.thirst)
  return { ...needs, hunger: clamp01(needs.hunger - h), thirst: clamp01(needs.thirst - t) }
}

/** 'ok', 'some' (un po') o 'much' (molta). */
function level(value) {
  return value >= RULES.MUCH ? 'much' : value >= RULES.SOME ? 'some' : 'ok'
}

/** Il bisogno piu' forte: { kind: 'hunger'|'thirst', level } o null se nessuno si sente. */
function worst(needs) {
  const kind = needs.thirst > needs.hunger ? 'thirst' : 'hunger'
  const l = level(needs[kind])
  return l === 'ok' ? null : { kind, level: l }
}

const WORDS = { hunger: { some: "un po' di fame", much: 'molta fame' }, thirst: { some: "un po' di sete", much: 'molta sete' } }

/**
 * La riga per il modello, o '' se e' sazio e dissetato. Con molta fame il
 * tono si fa scontroso, ma resta affettuoso.
 * @param {Needs} needs
 */
function promptLine(needs) {
  const felt = ['hunger', 'thirst'].filter(k => level(needs[k]) !== 'ok')
  if (!felt.length) return ''
  const much = felt.some(k => level(needs[k]) === 'much')
  const what = felt.map(k => WORDS[k][level(needs[k])]).join(' e ')
  return 'Hai ' + what + '. ' + (much
    ? "Ti pesa: sei piu' scontroso del solito e te ne lamenti, ma senza cattiveria; se l'utente ti da' qualcosa sei contento."
    : "Non e' grave: puoi accennarlo, se viene naturale, senza insistere.")
}

// Fumetti brevi, senza chiamare il modello.
const BUBBLES = {
  hunger: {
    some: ["Ho un po' fame…", 'Uno spuntino ci starebbe…', 'Mi brontola la pancia…'],
    much: ['Ho tanta fame…', 'Mi dai qualcosa da mangiare?', 'Fame… fame…', 'Non mangio da una vita…'],
  },
  thirst: {
    some: ["Ho un po' sete…", 'Un sorso d\'acqua?', 'Ho la gola secca…'],
    much: ['Ho tanta sete…', 'Mi dai qualcosa da bere?', 'Acqua… ti prego…'],
  },
}

/** Il fumetto per il bisogno piu' forte, o null. */
function bubble(needs, rand = Math.random) {
  const w = worst(needs)
  if (!w) return null
  const list = BUBBLES[w.kind][w.level]
  return list[Math.floor(rand() * list.length) % list.length]
}

/** Fra quanto il prossimo fumetto, per il livello (ms), o null se non serve. */
function bubbleDelay(needs, rand = Math.random) {
  const w = worst(needs)
  if (!w) return null
  const [lo, hi] = w.level === 'much' ? RULES.BUBBLE_MUCH_MS : RULES.BUBBLE_SOME_MS
  return lo + rand() * (hi - lo)
}

/**
 * La spinta sull'umore di un periodo MOOD_EVERY_MS: [emozione, delta] da
 * applicare con mood.nudge.
 * @returns {Array<[string, number]>}
 */
function moodPull(needs) {
  const w = worst(needs)
  if (!w) return []
  if (w.level === 'some') return [['annoyance', RULES.MOOD_SOME]]
  return [['annoyance', RULES.MOOD_MUCH], ['joy', -RULES.MOOD_MUCH]]
}

/** Punti di rapporto persi in ms con molta fame o sete (0 se non e' "molta"). */
function neglect(needs, ms) {
  const w = worst(needs)
  if (!w || w.level !== 'much') return 0
  return (Math.max(0, ms) / HOUR_MS) * RULES.NEGLECT_PER_H
}

/** Quanto rallenta la camminata: 1, 0,85 con un po' di fame o sete, 0,7 con molta. */
function walkFactor(needs) {
  const w = worst(needs)
  return !w ? 1 : w.level === 'much' ? 0.7 : 0.85
}

/** Cio' che vedono HUD e chat. */
function publicNeeds(needs) {
  return { hunger: needs.hunger, thirst: needs.thirst, hungerLevel: level(needs.hunger), thirstLevel: level(needs.thirst) }
}

async function loadNeeds(file) {
  try { return createNeeds(JSON.parse(await fs.promises.readFile(file, 'utf8'))) } catch (_) { return createNeeds(null) }
}

async function saveNeeds(file, needs) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await writeAtomic(file, JSON.stringify(needs, null, 2))
}

module.exports = {
  RULES, BUBBLES, createNeeds, grow, feed, level, worst, promptLine, bubble, bubbleDelay,
  moodPull, neglect, walkFactor, publicNeeds, loadNeeds, saveNeeds,
}
