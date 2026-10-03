// initiative.js — il companion che scrive per primo (Blocco 6d). Funzioni
// pure: quale occasione c'e' adesso e se si puo' parlare. Il testo lo scrive
// il modello (main.js), che riceve la riga dell'occasione.
//
// Freni: al massimo MAX_PER_DAY messaggi al giorno, almeno MIN_GAP_MS fra uno
// e l'altro, mai addormentato, con un'app a schermo intero o mentre l'utente
// scrive nella chat. Niente ore di silenzio (scelta dell'utente): conta solo
// che sia sveglio.

const { dayOf } = require('./rapport')

const RULES = {
  MAX_PER_DAY: 6,
  MIN_GAP_MS: 45 * 60000,
  SILENCE_MS: 3 * 3600000,   // tanto senza chat, con l'utente al PC
  PRESENT_MS: 2 * 60000,     // l'utente ha toccato mouse o tastiera da poco
  AWAY_MS: 2 * 3600000,      // un'assenza da cui si "rientra"
}

// La riga per il modello, per occasione.
const OCCASIONS = {
  morning: "E' la prima volta che vi vedete oggi: salutalo tu, come ti viene. Guarda l'ora che ti e' stata " +
    "indicata: non e' per forza mattina, il saluto deve andare bene per quell'ora.",
  return: "L'utente e' appena tornato al computer dopo un'assenza di qualche ora: accoglilo tu.",
  silence: "Non vi parlate da qualche ora, ma l'utente e' al computer: scrivigli tu qualcosa, " +
    'una curiosita\', una domanda, un pensiero tuo, quello che ti va.',
}

function createInitiative() {
  return { day: null, sent: 0, lastAt: 0, morningDay: null }
}

/** Il contatore riparte ogni giorno. */
const today = (s, now) => (s.day === dayOf(now) ? s : { ...s, day: dayOf(now), sent: 0 })

/**
 * L'occasione di adesso, o null.
 * @param {object} s stato (createInitiative)
 * @param {{ now: number, returned?: boolean, lastChatAt: number, systemIdleMs: number }} input
 *   returned: l'utente e' appena tornato dopo almeno AWAY_MS (o l'app e' partita)
 */
function occasion(s, { now, returned = false, lastChatAt, systemIdleMs }) {
  if (returned) return s.morningDay === dayOf(now) ? 'return' : 'morning'
  if (systemIdleMs < RULES.PRESENT_MS && now - lastChatAt >= RULES.SILENCE_MS && now - s.lastAt >= RULES.SILENCE_MS) return 'silence'
  return null
}

/**
 * Si puo' parlare adesso?
 * @param {object} s
 * @param {{ now: number, enabled: boolean, asleep: boolean, fullscreen: boolean, typing: boolean, busy?: boolean }} input
 */
function canSpeak(s, { now, enabled, asleep, fullscreen, typing, busy = false }) {
  if (!enabled || asleep || fullscreen || typing || busy) return false
  const t = today(s, now)
  return t.sent < RULES.MAX_PER_DAY && now - t.lastAt >= RULES.MIN_GAP_MS
}

/** Dopo un messaggio mandato. */
function onSpoke(s, kind, now) {
  const t = today(s, now)
  return { ...t, sent: t.sent + 1, lastAt: now, morningDay: kind === 'morning' ? dayOf(now) : t.morningDay }
}

/** La richiesta al modello: una riga di contesto al posto del messaggio dell'utente. */
function prompt(kind) {
  return '[Nessun messaggio dell\'utente: sei tu a scrivere per primo. ' + OCCASIONS[kind] +
    ' Un messaggio breve e naturale; non dire che e\' un evento o un promemoria.]'
}

/** Stato salvato, controllato. */
function restore(data) {
  const s = createInitiative()
  if (!data || typeof data !== 'object') return s
  if (typeof data.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.day)) s.day = data.day
  if (typeof data.morningDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.morningDay)) s.morningDay = data.morningDay
  if (Number.isInteger(data.sent) && data.sent >= 0) s.sent = data.sent
  if (Number.isFinite(data.lastAt) && data.lastAt >= 0) s.lastAt = data.lastAt
  return s
}

module.exports = { RULES, OCCASIONS, createInitiative, occasion, canSpeak, onSpoke, prompt, restore }
