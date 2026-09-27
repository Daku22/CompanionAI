// mood.js — lo stato d'animo del companion.
//
// Senza uno stato che attraversa i messaggi ogni risposta partiva da zero: il
// companion poteva essere entusiasta e un attimo dopo neutro, senza memoria di
// come si sentiva. Qui ogni emozione ha un'intensita' fra 0 e 1 che decade con
// la propria emivita, come in companion-emergence (brain/emotion/decay.py,
// MIT): il fastidio passa in un'ora, la malinconia dura un giorno, l'affetto
// non decade e cresce piano. Codice riscritto, non copiato.
//
// Funzioni pure: lo stato entra e ne esce una copia nuova, cosi' i test non
// hanno bisogno di orologi finti o di Electron. Solo loadMood e saveMood
// toccano il disco.

const fs = require('fs')
const path = require('path')
const { writeAtomic } = require('./write-atomic')

const HOUR_MS = 60 * 60 * 1000

// halfLifeH null = identitaria, non decade. I nomi sono sostantivi perche' il
// companion non ha un genere fissato: "allegria", non "allegra".
const EMOTIONS = {
  joy:       { halfLifeH: 6,    label: 'allegria',   icon: '✨' },
  curiosity: { halfLifeH: 3,    label: 'curiosità',  icon: '🔍' },
  calm:      { halfLifeH: 12,   label: 'calma',      icon: '🍃' },
  sadness:   { halfLifeH: 24,   label: 'malinconia', icon: '🌧' },
  annoyance: { halfLifeH: 1,    label: 'fastidio',   icon: '💢' },
  affection: { halfLifeH: null, label: 'affetto',    icon: '💜' },
}
const EMOTION_NAMES = Object.keys(EMOTIONS)
// Valori ammessi nel campo "emotion" della risposta: "neutral" non sposta nulla.
const REPLY_EMOTIONS = [...EMOTION_NAMES, 'neutral']

// Sotto questa soglia un'emozione e' rumore e sparisce (come _NOISE_FLOOR).
const NOISE_FLOOR = 0.01
// Sotto questa non si nomina: nel prompt e nella chat conta solo cio' che si sente.
const FELT = 0.15
// L'affetto cresce a un quarto della velocita' delle altre emozioni.
const AFFECTION_RATE = 0.25
const REACTION = 0.25
// Un'emozione ne attenua un'altra: l'allegria scaccia la malinconia, e cosi' via.
const OPPOSITE = { joy: 'sadness', sadness: 'joy', calm: 'annoyance', annoyance: 'calm' }
const OPPOSITE_DAMPING = 0.1
// Energia: ogni scambio stanca un poco, il riposo la recupera con emivita di 2 ore.
const ENERGY_PER_MESSAGE = 0.02
const ENERGY_RECOVERY_HALF_LIFE_H = 2
// Dopo un'assenza lunga il ritorno dell'utente fa piacere.
const LONG_ABSENCE_MS = 6 * HOUR_MS

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * @typedef {{ emotions: Record<string, number>, energy: number,
 *             updatedAt: number, lastUserAt: number|null,
 *             previousUserAt: number|null, messages: number }} Mood
 */

/**
 * Stato iniziale, o quello salvato ripulito da valori fuori posto: un file
 * scritto a mano o da una versione vecchia non deve rompere il companion.
 * @param {any} [saved]
 * @param {number} [now]
 * @returns {Mood}
 */
function createMood(saved, now = Date.now()) {
  const base = { emotions: { calm: 0.3, joy: 0.2 }, energy: 1, updatedAt: now, lastUserAt: null, previousUserAt: null, messages: 0 }
  if (!saved || typeof saved !== 'object') return base
  /** @type {Record<string, number>} */
  const emotions = {}
  for (const name of EMOTION_NAMES) {
    const value = saved.emotions && saved.emotions[name]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) emotions[name] = clamp01(value)
  }
  const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  return {
    emotions,
    energy: typeof saved.energy === 'number' && Number.isFinite(saved.energy) ? clamp01(saved.energy) : 1,
    // Un orologio nel futuro bloccherebbe il decadimento: si riparte da adesso.
    updatedAt: Math.min(time(saved.updatedAt) || now, now),
    lastUserAt: time(saved.lastUserAt),
    previousUserAt: time(saved.previousUserAt),
    messages: Number.isInteger(saved.messages) && saved.messages > 0 ? saved.messages : 0,
  }
}

/**
 * Fa passare il tempo: ogni emozione decade con la sua emivita, l'energia si
 * ricarica. Decadimento esponenziale, quindi due passi da un'ora danno lo
 * stesso risultato di uno da due ore.
 * @param {Mood} mood
 * @param {number} [now]
 * @returns {Mood}
 */
function decay(mood, now = Date.now()) {
  const elapsedH = (now - mood.updatedAt) / HOUR_MS
  if (!(elapsedH > 0)) return mood
  /** @type {Record<string, number>} */
  const emotions = {}
  for (const [name, value] of Object.entries(mood.emotions)) {
    const halfLife = EMOTIONS[name] && EMOTIONS[name].halfLifeH
    // Le emozioni identitarie non decadono, e la soglia di rumore non le tocca:
    // l'affetto parte da pochi millesimi e deve poter restare.
    if (!halfLife) { emotions[name] = value; continue }
    const next = value * Math.pow(0.5, elapsedH / halfLife)
    if (next >= NOISE_FLOOR) emotions[name] = next
  }
  const missing = 1 - mood.energy
  const energy = 1 - missing * Math.pow(0.5, elapsedH / ENERGY_RECOVERY_HALF_LIFE_H)
  return { ...mood, emotions, energy, updatedAt: now }
}

/**
 * Sposta un'emozione di delta, restando fra 0 e 1. Nomi sconosciuti: nessun effetto.
 * @param {Mood} mood
 * @param {string} name
 * @param {number} delta
 * @returns {Mood}
 */
function nudge(mood, name, delta) {
  if (!EMOTIONS[name] || !Number.isFinite(delta)) return mood
  const scaled = name === 'affection' && delta > 0 ? delta * AFFECTION_RATE : delta
  const value = clamp01((mood.emotions[name] || 0) + scaled)
  const emotions = { ...mood.emotions }
  // La soglia di rumore vale per il decadimento, non qui: l'affetto cresce di
  // pochi millesimi a scambio, e partendo da zero verrebbe cancellato subito.
  if (value > 0) emotions[name] = value
  else delete emotions[name]
  return { ...mood, emotions }
}

/**
 * L'emozione con cui il modello ha risposto. Valori non ammessi vengono
 * ignorati: il campo arriva da un LLM e non e' affidabile.
 * @param {Mood} mood
 * @param {unknown} emotion
 * @returns {Mood}
 */
function react(mood, emotion) {
  if (typeof emotion !== 'string' || !EMOTIONS[emotion]) return mood
  let next = nudge(mood, emotion, REACTION)
  if (OPPOSITE[emotion]) next = nudge(next, OPPOSITE[emotion], -OPPOSITE_DAMPING)
  // Ogni scambio andato bene lascia un filo di affetto.
  return nudge(next, 'affection', 0.02)
}

/**
 * Un messaggio dell'utente: fa passare il tempo, consuma un po' di energia e,
 * dopo un'assenza lunga, rallegra. previousUserAt tiene l'ultimo messaggio
 * prima di questo, per dire al modello quanto tempo e' passato.
 * @param {Mood} mood
 * @param {number} [now]
 * @returns {Mood}
 */
function onUserMessage(mood, now = Date.now()) {
  let next = decay(mood, now)
  if (next.lastUserAt && now - next.lastUserAt > LONG_ABSENCE_MS) {
    next = nudge(nudge(next, 'joy', 0.2), 'affection', 0.1)
  }
  return {
    ...next,
    energy: clamp01(next.energy - ENERGY_PER_MESSAGE),
    previousUserAt: next.lastUserAt,
    lastUserAt: now,
    messages: next.messages + 1,
  }
}

/**
 * L'emozione piu' forte, se si sente abbastanza.
 * @param {Mood} mood
 * @returns {string|null}
 */
function dominant(mood) {
  let best = null
  let bestValue = FELT
  for (const [name, value] of Object.entries(mood.emotions)) {
    if (value >= bestValue) { best = name; bestValue = value }
  }
  return best
}

function timeOfDay(hour) {
  if (hour >= 5 && hour <= 8) return 'prima mattina'
  if (hour >= 9 && hour <= 11) return 'mattina'
  if (hour >= 12 && hour <= 13) return 'ora di pranzo'
  if (hour >= 14 && hour <= 17) return 'pomeriggio'
  if (hour >= 18 && hour <= 20) return 'sera'
  if (hour >= 21 && hour <= 23) return 'notte'
  return "notte fonda, l'utente dovrebbe riposare"
}

function elapsedText(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return minutes + ' minuti fa'
  const hours = Math.round(minutes / 60)
  if (hours < 48) return hours === 1 ? "un'ora fa" : hours + ' ore fa'
  return Math.round(hours / 24) + ' giorni fa'
}

/**
 * Riga di contesto per il modello: umore, energia, ora del giorno e tempo
 * trascorso dall'ultimo messaggio (l'idea dell'ora del giorno viene da
 * Kokoro-Engine, src-tauri/src/ai/heartbeat.rs, MIT).
 * @param {Mood} mood
 * @param {Date} [now]
 */
function promptLine(mood, now = new Date()) {
  const felt = Object.entries(mood.emotions)
    .filter(([, value]) => value >= FELT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, value]) => (value >= 0.6 ? 'molta ' : value < 0.3 ? "un po' di " : '') + EMOTIONS[name].label)
  const energy = mood.energy >= 0.7 ? 'piena' : mood.energy >= 0.4 ? 'normale' : 'bassa'
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const parts = [
    'IL TUO STATO ATTUALE (non citarlo alla lettera: lascia che colori il tono).',
    'Sono le ' + hh + ':' + mm + ', ' + timeOfDay(now.getHours()) + '.',
    'Umore: ' + (felt.length ? felt.join(', ') : 'neutro') + '. Energia: ' + energy + '.',
  ]
  const gap = mood.previousUserAt ? now.getTime() - mood.previousUserAt : null
  if (gap === null) parts.push('È la prima volta che parli con questo utente.')
  else if (gap > 10 * 60000) parts.push("Il messaggio precedente dell'utente risale a " + elapsedText(gap) + '.')
  return parts.join(' ')
}

/** Cio' che vedono i renderer: niente orari, solo cio' che serve a mostrarlo. */
function publicMood(mood) {
  const name = dominant(mood)
  return {
    emotions: { ...mood.emotions },
    energy: mood.energy,
    dominant: name,
    label: name ? EMOTIONS[name].label : 'neutro',
    icon: name ? EMOTIONS[name].icon : '·',
  }
}

/** Legge lo stato salvato. File assente o corrotto: stato iniziale. */
async function loadMood(file, now = Date.now()) {
  try { return createMood(JSON.parse(await fs.promises.readFile(file, 'utf8')), now) } catch (_) { return createMood(null, now) }
}

async function saveMood(file, mood) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await writeAtomic(file, JSON.stringify(mood, null, 2))
}

module.exports = {
  EMOTIONS, EMOTION_NAMES, REPLY_EMOTIONS,
  createMood, decay, nudge, react, onUserMessage, dominant, promptLine, publicMood,
  loadMood, saveMood,
}
