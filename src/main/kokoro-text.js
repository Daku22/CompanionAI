// kokoro-text.js — dal testo ai numeri che il modello Kokoro vuole.
//
// kokoro-js (la libreria ufficiale in JavaScript) foneticizza solo in inglese:
// un testo italiano diventava inglese pronunciato con una voce italiana. Qui i
// fonemi li da' espeak-ng con la voce "it", resi come li ha visti Kokoro
// quando e' stato addestrato (misaki, il suo G2P, per le lingue via espeak):
// le affricate diventano un simbolo solo ("tʃ" -> "ʧ").
//
// Puro: espeak si passa come funzione, cosi' i test non ne hanno bisogno.

// Unita' di espeak (divise da "_") da scrivere come un solo simbolo.
const E2M = { 'aɪ': 'I', 'aʊ': 'W', 'dz': 'ʣ', 'dʒ': 'ʤ', 'eɪ': 'A', 'oʊ': 'O', 'əʊ': 'Q', 'ts': 'ʦ', 'tʃ': 'ʧ', 'ɔɪ': 'Y' }
const PUNCT_RE = /([.,!?;:…]+)/
const PUNCT_ONLY = /^[.,!?;:…]+$/
const MAX_TOKENS = 510   // limite del modello, compresi i due 0 ai bordi
const STYLE_DIM = 256

/** Pezzi di testo e punteggiatura: espeak toglie la punteggiatura, qui si rimette. */
function chunks(text) {
  return String(text).split(PUNCT_RE).map(s => s.trim()).filter(Boolean)
}

/**
 * Fonemi di un testo, nella forma di Kokoro.
 * @param {string} text
 * @param {(text: string) => string} ipa espeak: unita' divise da "_", righe da "\n"
 */
function phonemize(text, ipa) {
  let out = ''
  for (const piece of chunks(text)) {
    if (PUNCT_ONLY.test(piece)) { out = out.trimEnd() + piece[0] + ' '; continue }
    const raw = String(ipa(piece) || '')
    const words = raw.split('\n').map(l => l.trim()).filter(Boolean).join(' ').split(/\s+/)
    out += words.map(w => w.split('_').filter(Boolean).map(unit => {
      const long = unit.endsWith('ː')
      const key = long ? unit.slice(0, -1) : unit
      return E2M[key] ? E2M[key] + (long ? 'ː' : '') : unit
    }).join('')).join(' ') + ' '
  }
  return out.trim()
}

/**
 * Token del modello: 0, un id per simbolo del vocabolario, 0. I simboli che il
 * vocabolario non conosce si saltano; oltre il limite il testo si taglia.
 * @param {string} phonemes
 * @param {Record<string, number>} vocab
 */
function tokenize(phonemes, vocab) {
  const ids = []
  for (const c of phonemes) if (Object.prototype.hasOwnProperty.call(vocab, c)) ids.push(vocab[c])
  return [0, ...ids.slice(0, MAX_TOKENS - 2), 0]
}

/**
 * Lo stile della voce dipende dalla lunghezza: il file .bin ha una riga di
 * 256 numeri per ogni numero di token.
 * @param {Float32Array} voice
 * @param {number} tokenCount lunghezza di tokenize(), zeri compresi
 */
function styleFor(voice, tokenCount) {
  const rows = Math.floor(voice.length / STYLE_DIM)
  const n = Math.max(0, Math.min(tokenCount - 2, rows - 1))
  return voice.slice(n * STYLE_DIM, n * STYLE_DIM + STYLE_DIM)
}

module.exports = { phonemize, tokenize, styleFor, chunks, MAX_TOKENS, STYLE_DIM }
