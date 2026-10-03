// diary.js — il diario della persona (Blocco 6c): una voce per ogni giorno in
// cui vi siete parlati, scritta dal modello in prima persona il primo avvio
// del giorno dopo. Le scelte (quale giorno, quale testo mandare) sono pure;
// load/append leggono e scrivono <persona>/diary.jsonl, una riga per voce.

const fs = require('fs')
const path = require('path')
const { dayOf } = require('./rapport')

const MAX_TRANSCRIPT = 6000   // caratteri del dialogo mandati al modello
// Tetti di sicurezza, non di stile: la pagina e' libera, ma un modello che si
// incastra a ripetere una frase non deve riempire il disco.
const MAX_ENTRY = 8000        // caratteri di una voce salvata
const MAX_TOKENS = 2000       // risposta del modello
const MAX_ENTRIES_SHOWN = 60

/**
 * Il giorno da scrivere: l'ultimo prima di oggi in cui ci sono turni, se non
 * ha ancora una voce. null se non c'e' niente da fare.
 * @param {{ timestamp: string }[]} turns
 * @param {{ day: string }[]} entries
 * @param {number} now
 */
function dayToWrite(turns, entries, now = Date.now()) {
  const today = dayOf(now)
  let last = null
  for (const t of turns) {
    const ms = Date.parse(t && t.timestamp)
    if (!Number.isFinite(ms)) continue
    const day = dayOf(ms)
    if (day < today && (!last || day > last)) last = day
  }
  if (!last || entries.some(e => e.day === last)) return null
  return last
}

/** Il dialogo di quel giorno, come testo, tagliato dall'inizio se lungo. */
function transcript(turns, day, name = 'Companion') {
  const text = turns
    .filter(t => Number.isFinite(Date.parse(t && t.timestamp)) && dayOf(Date.parse(t.timestamp)) === day)
    .map(t => (t.speaker === 'assistant' ? name : 'Utente') + ': ' + String(t.content || '').trim())
    .join('\n')
  return text.length > MAX_TRANSCRIPT ? '…' + text.slice(-MAX_TRANSCRIPT) : text
}

function systemPrompt(persona) {
  const who = persona && persona.prompt ? `Ti chiami ${persona.name}. La tua personalità:\n${persona.prompt}\n\n` : ''
  return who + "E' il tuo diario personale: scrivi la pagina di questa giornata, in prima persona. " +
    'Scrivi quello che vuoi e quanto vuoi: cosa vi siete detti, cosa ne pensi, pensieri tuoi, domande, ' +
    'divagazioni. Solo testo, senza JSON. ' +
    "Non inventare cose successe tra te e l'utente che non sono nel dialogo."
}

/** Il testo del modello, ripulito; null se vuoto. */
function cleanEntry(text) {
  const t = String(text || '').replace(/^```\w*\s*|```$/g, '').trim().slice(0, MAX_ENTRY)
  return t || null
}

/** Le voci, dalla piu' recente. File assente o righe rotte: si saltano. */
async function loadDiary(file) {
  let raw = ''
  try { raw = await fs.promises.readFile(file, 'utf8') } catch (_) { return [] }
  const entries = []
  for (const line of raw.split('\n')) {
    try {
      const e = JSON.parse(line)
      if (e && typeof e.day === 'string' && typeof e.text === 'string') entries.push({ day: e.day, text: e.text })
    } catch (_) {}
  }
  return entries.sort((a, b) => b.day.localeCompare(a.day))
}

async function appendDiary(file, entry) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.appendFile(file, JSON.stringify({ day: entry.day, text: entry.text, at: new Date().toISOString() }) + '\n', 'utf8')
}

module.exports = { MAX_TRANSCRIPT, MAX_ENTRY, MAX_TOKENS, MAX_ENTRIES_SHOWN, dayToWrite, transcript, systemPrompt, cleanEntry, loadDiary, appendDiary }
