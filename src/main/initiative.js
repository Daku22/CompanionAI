// initiative.js — il companion che scrive per primo (Blocco 6d). Funzioni
// pure: quale occasione c'e' adesso e se si puo' parlare. Il testo lo scrive
// il modello (main.js), che riceve la riga dell'occasione.
//
// Freni: al massimo MAX_PER_DAY messaggi al giorno, almeno MIN_GAP_MS fra uno
// e l'altro, mai addormentato, con un'app a schermo intero o mentre l'utente
// scrive nella chat. Niente ore di silenzio (scelta dell'utente): conta solo
// che sia sveglio.
//
// Con piu' companion (Blocco 8d) ognuno ha il suo stato e i suoi 6 al giorno;
// fra i messaggi spontanei di companion diversi passano almeno
// OTHERS_GAP_MS, e c'e' un'occasione in piu': "peer", un commento su un altro
// companion, a cui l'altro puo' rispondere una volta.

const { dayOf } = require('./rapport')

const RULES = {
  MAX_PER_DAY: 6,
  MIN_GAP_MS: 45 * 60000,
  SILENCE_MS: 3 * 3600000,   // tanto senza chat, con l'utente al PC
  PRESENT_MS: 2 * 60000,     // l'utente ha toccato mouse o tastiera da poco
  AWAY_MS: 2 * 3600000,      // un'assenza da cui si "rientra"
  OTHERS_GAP_MS: 10 * 60000, // fra i messaggi spontanei di companion diversi
  // Fra companion (Blocco 8d) un conto a parte, piu' largo: non tolgono
  // messaggi all'utente.
  MAX_PEER_PER_DAY: 12,
  PEER_GAP_MS: 15 * 60000,   // fra due commenti dello stesso companion
  PEER_QUIET_MS: 8 * 60000,  // un commento su un altro solo dopo un po' senza chat
  PEER_CHANCE: 1 / 16,       // per controllo (ogni 30 s): circa uno ogni 8 minuti buoni
  // Fame o sete "molta" (Blocco 10a): lo chiede all'utente, dentro i 6 al
  // giorno, al massimo una volta ogni NEEDS_GAP_MS.
  NEEDS_GAP_MS: 2 * 3600000,
}

/** I messaggi fra companion: commento, risposta, saluto all'arrivo. */
const isPeer = (kind) => kind === 'peer' || kind === 'peer-reply' || kind === 'hello'

// La riga per il modello, per occasione.
const OCCASIONS = {
  hungry: "Hai molta fame: chiedi all'utente qualcosa da mangiare, a modo tuo, anche lamentandoti un po'.",
  thirsty: "Hai molta sete: chiedi all'utente qualcosa da bere, a modo tuo, anche lamentandoti un po'.",
  morning: "E' la prima volta che vi vedete oggi: salutalo tu, come ti viene. Guarda l'ora che ti e' stata " +
    "indicata: non e' per forza mattina, il saluto deve andare bene per quell'ora.",
  return: "L'utente e' appena tornato al computer dopo un'assenza di qualche ora: accoglilo tu.",
  silence: "Non vi parlate da qualche ora, ma l'utente e' al computer: scrivigli tu qualcosa, " +
    'una curiosita\', una domanda, un pensiero tuo, quello che ti va.',
}

function createInitiative() {
  return { day: null, sent: 0, lastAt: 0, morningDay: null, peerSent: 0, peerAt: 0, needsAt: 0 }
}

/** I contatori ripartono ogni giorno. */
const today = (s, now) => (s.day === dayOf(now) ? s : { ...s, day: dayOf(now), sent: 0, peerSent: 0 })

/**
 * L'occasione di adesso, o null.
 * @param {object} s stato (createInitiative)
 * @param {{ now: number, returned?: boolean, lastChatAt: number, systemIdleMs: number }} input
 *   returned: l'utente e' appena tornato dopo almeno AWAY_MS (o l'app e' partita)
 */
function occasion(s, { now, returned = false, lastChatAt, systemIdleMs, peers = 0, needs = null, rand = Math.random }) {
  if (returned) return s.morningDay === dayOf(now) ? 'return' : 'morning'
  // needs: il bisogno piu' forte (needs.worst); solo "molta" fame o sete, con l'utente al PC.
  if (needs && needs.level === 'much' && systemIdleMs < RULES.PRESENT_MS && now - (s.needsAt || 0) >= RULES.NEEDS_GAP_MS) {
    return needs.kind === 'thirst' ? 'thirsty' : 'hungry'
  }
  if (systemIdleMs < RULES.PRESENT_MS && now - lastChatAt >= RULES.SILENCE_MS && now - s.lastAt >= RULES.SILENCE_MS) return 'silence'
  // Un altro companion sul desktop: ogni tanto un commento su di lui.
  if (peers > 0 && systemIdleMs < RULES.PRESENT_MS && now - lastChatAt >= RULES.PEER_QUIET_MS &&
    now - (s.peerAt || 0) >= RULES.PEER_GAP_MS && rand() < RULES.PEER_CHANCE) return 'peer'
  return null
}

/**
 * Si puo' parlare adesso? kind sceglie il conto: i messaggi all'utente (6 al
 * giorno, 45 minuti fra uno e l'altro) o quelli fra companion (12 al giorno;
 * la risposta e il saluto all'arrivo non aspettano i 15 minuti).
 * @param {object} s
 * @param {{ now: number, enabled: boolean, asleep: boolean, fullscreen: boolean, typing: boolean, busy?: boolean, sinceOtherMs?: number }} input
 * @param {string} [kind]
 */
function canSpeak(s, { now, enabled, asleep, fullscreen, typing, busy = false, sinceOtherMs = Infinity }, kind = 'message') {
  if (!enabled || asleep || fullscreen || typing || busy) return false
  if (sinceOtherMs < RULES.OTHERS_GAP_MS) return false
  const t = today(s, now)
  if (isPeer(kind)) return t.peerSent < RULES.MAX_PEER_PER_DAY && (kind !== 'peer' || now - (t.peerAt || 0) >= RULES.PEER_GAP_MS)
  return t.sent < RULES.MAX_PER_DAY && now - t.lastAt >= RULES.MIN_GAP_MS
}

/** Dopo un messaggio mandato. */
function onSpoke(s, kind, now) {
  const t = today(s, now)
  if (isPeer(kind)) return { ...t, peerSent: (t.peerSent || 0) + 1, peerAt: now }
  return { ...t, sent: t.sent + 1, lastAt: now, morningDay: kind === 'morning' ? dayOf(now) : t.morningDay,
    needsAt: kind === 'hungry' || kind === 'thirsty' ? now : (t.needsAt || 0) }
}

/**
 * Il commento su un altro companion (peer), o la risposta a un suo commento
 * (peer-reply): name e' l'altro, doing cosa sta facendo, said cosa ha detto.
 * @param {string} kind
 * @param {{ name: string, doing?: string | null, said?: string | null }} other
 */
function peerLine(kind, { name, doing = null, said = null }) {
  if (kind === 'peer-reply') return name + ' ti ha appena detto: «' + said + '». Rispondigli tu, in breve, come ti viene.'
  if (kind === 'hello') return 'Sei appena arrivato sul desktop, dove c\'e\' gia\' ' + name + ' (altri companion): saluta ' + name +
    ' e l\'utente, come ti viene.'
  return 'Sul desktop con te c\'e\' anche ' + name + ', un altro companion' + (doing ? ', che adesso ' + doing : '') + '.' +
    (said ? ' Poco fa ha detto: «' + said + '».' : '') +
    ' Di\' qualcosa a ' + name + ' o su ' + name + ', come ti viene: una battuta, una domanda, un pensiero. Lo legge anche l\'utente.'
}

/** La richiesta al modello: una riga di contesto al posto del messaggio dell'utente. */
function prompt(kind, other = null) {
  const line = isPeer(kind) && other ? peerLine(kind, other) : OCCASIONS[kind]
  return '[Nessun messaggio dell\'utente: sei tu a scrivere per primo. ' + line +
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
  if (Number.isInteger(data.peerSent) && data.peerSent >= 0) s.peerSent = data.peerSent
  if (Number.isFinite(data.peerAt) && data.peerAt >= 0) s.peerAt = data.peerAt
  if (Number.isFinite(data.needsAt) && data.needsAt >= 0) s.needsAt = data.needsAt
  return s
}

module.exports = { RULES, OCCASIONS, createInitiative, occasion, canSpeak, onSpoke, prompt, restore, isPeer }
