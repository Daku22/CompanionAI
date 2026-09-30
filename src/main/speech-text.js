// speech-text.js — il testo di una risposta, pronto da pronunciare.
//
// La risposta del modello e' scritta per la chat: emoji, un po' di markdown,
// link. Letti ad alta voce sono rumore ("asterisco", un indirizzo lettera per
// lettera). Poi si divide in frasi: il motore sintetizza la seconda mentre la
// prima suona, e la prima parola arriva prima.

const MAX_SENTENCE = 220   // oltre, la frase si spezza alle virgole o agli spazi
const MIN_SENTENCE = 12    // sotto, si unisce alla seguente ("Ah!" da sola suona a scatti)

/**
 * Testo senza cio' che non si pronuncia.
 * @param {string} text
 * @returns {string}
 */
function cleanForSpeech(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/```[\s\S]*?```/g, ' ')                       // blocchi di codice
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')              // [testo](link) -> testo
    .replace(/\bhttps?:\/\/\S+/gi, ' un link ')
    .replace(/\bwww\.\S+/gi, ' un link ')
    .replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|[\u{1f3fb}-\u{1f3ff}])*/gu, ' ')
    .replace(/[*_#>~|]+/g, ' ')                             // markdown
    .replace(/^\s*[-+•]\s+/gm, '')                          // punti elenco
    .replace(/([.!?…:;,])[ \t]*\n+\s*/g, '$1 ')             // a capo dopo la punteggiatura: basta lei
    .replace(/\s*\n+\s*/g, '. ')                            // a capo: una pausa
    .replace(/\s+([,.!?;:…])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:]+/, '')
    .trim()
}

/** Spezza una frase troppo lunga: prima alle virgole, poi agli spazi. */
function splitLong(sentence) {
  if (sentence.length <= MAX_SENTENCE) return [sentence]
  const out = []
  let rest = sentence
  while (rest.length > MAX_SENTENCE) {
    const window = rest.slice(0, MAX_SENTENCE)
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '))
    if (cut < MAX_SENTENCE / 3) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = MAX_SENTENCE
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Frasi da sintetizzare una alla volta.
 * @param {string} text gia' pulito (cleanForSpeech)
 * @returns {string[]}
 */
function splitSentences(text) {
  const clean = String(text || '').trim()
  if (!clean) return []
  // Fine frase: punteggiatura forte seguita da uno spazio. "3.5" e "ecc.)" restano.
  const raw = clean.split(/(?<=[.!?…])\s+/)
  const merged = []
  for (const piece of raw.map(s => s.trim()).filter(Boolean)) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length < MIN_SENTENCE) merged[merged.length - 1] = last + ' ' + piece
    else merged.push(piece)
  }
  return merged.flatMap(splitLong)
}

module.exports = { cleanForSpeech, splitSentences, MAX_SENTENCE }
