// group-chat.js — la chat di gruppo (Blocco 8c): con piu' companion sul
// desktop scrivi a tutti, e rispondono uno o due. Funzioni pure: chi
// risponde, come ciascuno vede quello che hanno detto gli altri, e la riga
// che gli dice con chi e' in chat.

const MAX_REPLIES = 2
const SECOND_CHANCE = 0.35   // a volte un secondo reagisce al primo
const KEEP_LAST = 0.6        // senza nomi, di solito continua chi ha parlato

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Dove compare il nome nel testo, come parola intera; -1 se non c'e'. */
function mentionAt(text, name) {
  const n = fold(name).trim()
  if (!n) return -1
  const m = new RegExp('(^|[^a-z0-9])' + escape(n) + '(?![a-z0-9])').exec(fold(text))
  return m ? m.index + m[1].length : -1
}

/**
 * Chi risponde, in ordine (al massimo MAX_REPLIES).
 *  - to: il messaggio e' solo per lui (la sua pastiglia scelta nella chat);
 *  - chi e' chiamato per nome, nell'ordine in cui compare;
 *  - se no uno: di solito chi ha parlato per ultimo, a volte un altro; e a
 *    volte un secondo che reagisce al primo.
 * @param {string} text il messaggio dell'utente
 * @param {{ id: string, name: string }[]} open i companion sul desktop
 * @param {{ to?: string | null, last?: string | null, rand?: () => number }} [opts]
 * @returns {string[]} gli id
 */
function pickResponders(text, open, { to = null, last = null, rand = Math.random } = {}) {
  if (!open.length) return []
  if (to && open.some(o => o.id === to)) return [to]
  if (open.length === 1) return [open[0].id]
  const named = open.map(o => ({ id: o.id, at: mentionAt(text, o.name) }))
    .filter(o => o.at >= 0).sort((a, b) => a.at - b.at).map(o => o.id)
  if (named.length) return named.slice(0, MAX_REPLIES)
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
  const others = open.filter(o => o.id !== last)
  const first = last && open.some(o => o.id === last) && rand() < KEEP_LAST ? last : pick(others.length ? others : open).id
  const out = [first]
  if (rand() < SECOND_CHANCE) out.push(pick(open.filter(o => o.id !== first)).id)
  return out
}

/**
 * La conversazione vista da un companion: le sue risposte restano sue, quelle
 * degli altri diventano "[Nome ha detto: ...]" da parte del mondo (role user),
 * cosi' non crede di averle dette lui.
 * @param {{ role: string, content: string, speaker?: string }[]} history
 * @param {string} me l'id di chi risponde
 * @param {Record<string, string>} names id -> nome
 */
function historyFor(history, me, names) {
  return history.map(m => {
    if (m.role !== 'assistant' || !m.speaker || m.speaker === me) return { role: m.role, content: m.content }
    return { role: 'user', content: '[' + (names[m.speaker] || 'Un altro companion') + ' ha detto: ' + m.content + ']' }
  })
}

/**
 * La riga di sistema per la chat di gruppo; '' se il companion e' solo.
 * @param {string[]} others i nomi degli altri companion in chat
 * @param {string | null} [after] il nome di chi ha appena risposto, se si reagisce a lui
 */
function groupLine(others, after = null) {
  if (!others.length) return ''
  return 'Nella chat ci sono anche ' + others.join(', ') + ': altri companion sul desktop, ognuno con la sua personalita\'. ' +
    'L\'utente scrive a tutti voi. Rispondi solo per te, in breve, senza parlare al posto degli altri.' +
    (after ? ' ' + after + ' ha appena risposto: puoi reagire anche a quello che ha detto.' : '')
}

/** Come ricorda un companion la risposta di un altro. */
const heardLine = (name, reply) => '[' + name + ' ha detto: ' + reply + ']'

module.exports = { MAX_REPLIES, pickResponders, historyFor, groupLine, heardLine, mentionAt }
