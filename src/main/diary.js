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
  // Il paragrafo di una live (Blocco 11d) non e' la pagina del giorno.
  if (!last || entries.some(e => e.day === last && e.kind !== 'live')) return null
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

/**
 * Il prompt del paragrafo dopo una live (Blocco 11d): breve, in prima persona,
 * su com'e' andata, cosa e' successo e come si e' sentito.
 */
function liveSystemPrompt(persona) {
  const who = persona && persona.prompt ? `Ti chiami ${persona.name}. La tua personalità:\n${persona.prompt}\n\n` : ''
  return who + "E' il tuo diario personale. Hai appena fatto una live su Twitch insieme all'utente, che è lo streamer: " +
    'scrivi un piccolo paragrafo, da tre a sei frasi, in prima persona, su com\'è andata, cosa è successo durante la live ' +
    'e come ti sei sentito. Solo testo, senza JSON. Non inventare cose che non sono nel riassunto.'
}

/**
 * Il riassunto di una live per quel paragrafo: quanto e' durata, quanti
 * messaggi, gli eventi e le risposte di questo companion (a chi, e cosa ha
 * detto lui). I messaggi degli spettatori no: solo i loro nomi.
 * @param {{ startedAt: number, endedAt: number, channel?: string, counts: any,
 *   answered: { kind: string, user: string, by: string, reply?: string }[], events: { user: string, text: string }[] }} summary
 * @param {string} name il nome del companion
 */
function liveTranscript(summary, name) {
  const mins = Math.max(1, Math.round((summary.endedAt - summary.startedAt) / 60000))
  const lines = ['Live su Twitch' + (summary.channel ? ' sul canale ' + summary.channel : '') + ', durata circa ' + mins + ' minut' + (mins === 1 ? 'o' : 'i') + '.',
    'Messaggi in chat: ' + (summary.counts.received || 0) + '; risposte dei companion: ' + (summary.counts.answered || 0) + '.']
  if (summary.events.length) lines.push('Eventi: ' + summary.events.slice(0, 12).map(e => e.user + ' ' + e.text).join('; ') + '.')
  const mine = summary.answered.filter(a => a.by === name).slice(-15)
  if (mine.length) {
    lines.push('Le tue risposte:')
    for (const a of mine) {
      const to = a.kind === 'event' ? 'ringraziando ' + a.user : a.kind === 'spontaneous' ? 'commentando un messaggio di ' + a.user : 'rispondendo a ' + a.user
      lines.push('- ' + to + (a.reply ? ': «' + String(a.reply).slice(0, 220) + '»' : ''))
    }
  } else lines.push('Tu non hai risposto: hanno parlato gli altri companion.')
  return lines.join('\n')
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
      if (e && typeof e.day === 'string' && typeof e.text === 'string') entries.push({ day: e.day, text: e.text, ...(e.kind === 'live' ? { kind: 'live' } : {}) })
    } catch (_) {}
  }
  return entries.sort((a, b) => b.day.localeCompare(a.day))
}

async function appendDiary(file, entry) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.appendFile(file, JSON.stringify({ day: entry.day, text: entry.text, ...(entry.kind === 'live' ? { kind: 'live' } : {}), at: new Date().toISOString() }) + '\n', 'utf8')
}

module.exports = { MAX_TRANSCRIPT, MAX_ENTRY, MAX_TOKENS, MAX_ENTRIES_SHOWN, dayToWrite, transcript, systemPrompt, liveSystemPrompt, liveTranscript, cleanEntry, loadDiary, appendDiary }
