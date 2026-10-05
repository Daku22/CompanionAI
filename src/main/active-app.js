// active-app.js — l'app attiva (Blocco 7c, facoltativa e spenta di base): il
// titolo della finestra in primo piano entra come riga di contesto, mai in
// memoria. Le finestre il cui titolo contiene una parola dell'elenco da
// ignorare (password manager, navigazione privata) non si leggono.

const IGNORE_DEFAULT = ['KeePass', '1Password', 'Bitwarden', 'LastPass', 'Dashlane', 'Proton Pass',
  'InPrivate', 'Incognito', 'in incognito', 'Navigazione anonima', 'Private Browsing', 'Navigazione privata']
const MAX_TITLE = 120

/** L'elenco dal renderer, controllato: parole di 2-60 caratteri, al massimo 40. */
function cleanIgnore(input) {
  if (!Array.isArray(input)) return null
  const out = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const word = item.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 60)
    if (word.length >= 2 && !out.some(w => w.toLowerCase() === word.toLowerCase())) out.push(word)
    if (out.length >= 40) break
  }
  return out
}

/**
 * La riga per il prompt, o null (nessuna finestra, la nostra, o da ignorare).
 * @param {{ title: string, pid: number } | null} win
 * @param {string[]} ignore
 * @param {number} ownPid
 */
function activeAppLine(win, ignore, ownPid) {
  const title = win && typeof win.title === 'string' ? win.title.replace(/\s+/g, ' ').trim() : ''
  if (!title || win.pid === ownPid) return null
  const lower = title.toLowerCase()
  if ((ignore || []).some(w => lower.includes(w.toLowerCase()))) return null
  const shown = title.length > MAX_TITLE ? title.slice(0, MAX_TITLE) + '…' : title
  return 'L\'utente ha in primo piano la finestra "' + shown + '". Tienine conto se c\'entra con quello che dice, senza commentarla di tua iniziativa.'
}

module.exports = { IGNORE_DEFAULT, cleanIgnore, activeAppLine }
