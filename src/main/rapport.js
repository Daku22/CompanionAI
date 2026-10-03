// rapport.js — il rapporto con l'utente (Blocco 6b): punteggio, giorni
// insieme, serie giornaliera e livello. Funzioni pure, piu' load/save.
//
// Il punteggio (0..100) sale con i giorni insieme e con il campo "rapport"
// della risposta (da -2 a +2: come il modello ha vissuto il messaggio
// dell'utente), e cala con le assenze lunghe e con i toni ostili. Il livello
// non sblocca nulla: cambia il tono nel prompt e quanto spesso arrivano le
// reazioni affettuose o infastidite (reactionScale).

const fs = require('fs')
const path = require('path')
const { writeAtomic } = require('./write-atomic')

const LEVELS = ['Sconosciuto', 'Conoscente', 'Amico', 'Amico stretto', 'Confidente', 'Anima gemella']
const THRESHOLDS = [0, 10, 25, 45, 65, 85]
const RULES = {
  START: 5,
  HYSTERESIS: 4,     // si scende di livello solo sotto la soglia meno questo
  DAY_BONUS: 1,      // ogni giorno in cui ci si parla
  STREAK_BONUS: 1,   // in piu' da 7 giorni di fila
  DAILY_CAP: 6,      // il massimo che i messaggi possono dare in un giorno
  ABSENCE_DAYS: 3,   // oltre questi giorni senza parlarsi si perde...
  ABSENCE_STEP: 2,   // ...tanto per ogni giorno in piu'...
  ABSENCE_MAX: 20,   // ...fino a questo
  HOSTILE_X: 1.5,    // un rapport negativo pesa di piu' di uno positivo
}
// Il tono, per livello: entra nel prompt.
const TONES = [
  "non vi conoscete ancora: sii gentile ma un po' riservato.",
  'vi state conoscendo: cordiale, qualche battuta leggera.',
  'siete amici: tono caldo e informale.',
  'siete molto legati: affettuoso, scherzi complici, ricordi condivisi.',
  'ti fidi completamente: aperto, sincero, ti esponi volentieri.',
  'siete inseparabili: profondo affetto, complicita\' totale, ma resta te stesso.',
]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Il giorno locale come 'AAAA-MM-GG'. */
function dayOf(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000)

function createRapport() {
  return { score: RULES.START, level: 0, days: 0, streak: 0, lastDay: null, todayGain: 0 }
}

/** Il livello per il punteggio, con l'isteresi rispetto a quello di prima. */
function levelFor(score, prev = 0) {
  let level = 0
  for (let i = 0; i < THRESHOLDS.length; i++) if (score >= THRESHOLDS[i]) level = i
  if (level < prev && score >= THRESHOLDS[prev] - RULES.HYSTERESIS) return prev
  return level
}

const withScore = (r, score) => {
  const s = clamp(score, 0, 100)
  return { ...r, score: s, level: levelFor(s, r.level) }
}

/**
 * L'utente scrive oggi: giorni insieme, serie, bonus del giorno e, dopo
 * un'assenza lunga, il calo. Lo stesso giorno non conta due volte.
 */
function onDay(r, now = Date.now()) {
  const day = dayOf(now)
  if (r.lastDay === day) return r
  const gap = r.lastDay ? daysBetween(r.lastDay, day) : 1
  if (gap < 0) return { ...r, lastDay: day }   // orologio tornato indietro
  const streak = gap === 1 ? r.streak + 1 : 1
  const absence = gap > RULES.ABSENCE_DAYS ? Math.min(RULES.ABSENCE_MAX, (gap - RULES.ABSENCE_DAYS) * RULES.ABSENCE_STEP) : 0
  const bonus = RULES.DAY_BONUS + (streak >= 7 ? RULES.STREAK_BONUS : 0)
  return withScore({ ...r, days: r.days + 1, streak, lastDay: day, todayGain: 0 }, r.score + bonus - absence)
}

/** Il campo "rapport" di una risposta: solo interi da -2 a +2. */
function onReply(r, value) {
  if (!Number.isInteger(value) || value < -2 || value > 2 || value === 0) return r
  if (value > 0) {
    const gain = Math.min(value, RULES.DAILY_CAP - r.todayGain)
    if (gain <= 0) return r
    return withScore({ ...r, todayGain: r.todayGain + gain }, r.score + gain)
  }
  return withScore(r, r.score + value * RULES.HOSTILE_X)
}

/**
 * Quanto spesso arrivano le reazioni: affection moltiplica quelle affettuose
 * (da 0,6 a 1,4), annoyance quelle infastidite (da 1,4 a 0,6); patience e'
 * di quanti clic il fastidio arriva prima (-1) o dopo (+1).
 */
function reactionScale(level) {
  const l = clamp(level | 0, 0, LEVELS.length - 1)
  return { affection: 0.6 + 0.16 * l, annoyance: 1.4 - 0.16 * l, patience: l <= 1 ? -1 : l >= 4 ? 1 : 0 }
}

function promptLine(r) {
  return 'IL VOSTRO RAPPORTO: ' + LEVELS[r.level].toLowerCase() + ' (livello ' + (r.level + 1) + ' di ' + LEVELS.length + ')' +
    (r.days ? ', vi parlate da ' + r.days + (r.days === 1 ? ' giorno' : ' giorni') : '') + '. Tono: ' + TONES[r.level] +
    ' Nel campo "rapport" dai da -2 a +2 a come ti ha trattato l\'utente in questo messaggio (0 se neutro).'
}

function publicRapport(r) {
  return { level: r.level, label: LEVELS[r.level], levels: LEVELS.length, days: r.days, streak: r.streak, score: Math.round(r.score) }
}

/** Stato salvato. File assente o corrotto: stato iniziale. */
async function loadRapport(file) {
  try {
    const d = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    const r = createRapport()
    for (const k of ['score', 'days', 'streak', 'todayGain']) if (Number.isFinite(d[k])) r[k] = Math.max(0, d[k])
    if (typeof d.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.lastDay)) r.lastDay = d.lastDay
    const level = Number.isInteger(d.level) ? clamp(d.level, 0, LEVELS.length - 1) : 0
    return { ...r, score: clamp(r.score, 0, 100), level: levelFor(clamp(r.score, 0, 100), level) }
  } catch (_) { return createRapport() }
}

async function saveRapport(file, r) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await writeAtomic(file, JSON.stringify(r, null, 2))
}

module.exports = { LEVELS, THRESHOLDS, RULES, dayOf, createRapport, levelFor, onDay, onReply, reactionScale, promptLine, publicRapport, loadRapport, saveRapport }
