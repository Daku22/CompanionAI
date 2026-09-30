// test-kokoro-text.js — fonemi e token per Kokoro (src/main/kokoro-text.js).
const assert = require('node:assert/strict')
const { phonemize, tokenize, styleFor, MAX_TOKENS, STYLE_DIM } = require('../src/main/kokoro-text')

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Fonemi per Kokoro ===')

// Uscite vere di espeak-ng ("it") per questi pezzi, prese dal prototipo.
const ESPEAK = {
  'Ciao': 'tʃ_ˈa_o\n',
  'Sono contenta di vederti': 's_ˌo_n_o k_o_n_t_ˈɛ_n_t_a d_ɪ v_e_d_ˈɛ__r_t_ɪ\n',
  'Com\'è andata la giornata': 'k_ˌo_m_ˈɛ a_n_d_ˈa_t_a l_a dʒ_o__r_n_ˈa_t_a\n',
  'lo zucchero': 'l_o dz_ˈu_kː_e_r_o\n',
}
const ipa = (text) => { if (!(text in ESPEAK)) throw new Error('pezzo inatteso: ' + text); return ESPEAK[text] }

t('italiano: affricate unite, punteggiatura rimessa', () => {
  assert.equal(phonemize('Ciao! Sono contenta di vederti. Com\'è andata la giornata?', ipa),
    'ʧˈao! sˌono kontˈɛnta dɪ vedˈɛrtɪ. kˌomˈɛ andˈata la ʤornˈata?')
})

t('le doppie restano lunghe anche sulle affricate', () => {
  assert.equal(phonemize('lo zucchero', ipa), 'lo ʣˈukːero')
  assert.equal(phonemize('x', () => 'p_ˈa_tʃː_o\n'), 'pˈaʧːo')
})

t('solo punteggiatura, testo vuoto', () => {
  assert.equal(phonemize('...', ipa), '.')
  assert.equal(phonemize('', ipa), '')
})

t('token: zeri ai bordi, simboli sconosciuti saltati, limite rispettato', () => {
  const vocab = { a: 5, b: 6, ' ': 16 }
  assert.deepEqual(tokenize('ab a?', vocab), [0, 5, 6, 16, 5, 0])
  const long = tokenize('a'.repeat(2000), vocab)
  assert.equal(long.length, MAX_TOKENS)
  assert.equal(long[0], 0); assert.equal(long[long.length - 1], 0)
})

t('stile: la riga giusta per la lunghezza, mai fuori dal file', () => {
  const rows = 510
  const voice = new Float32Array(rows * STYLE_DIM).map((_, i) => Math.floor(i / STYLE_DIM))
  assert.equal(styleFor(voice, 12)[0], 10)          // 12 token -> 10 simboli -> riga 10
  assert.equal(styleFor(voice, 12).length, STYLE_DIM)
  assert.equal(styleFor(voice, 2)[0], 0)
  assert.equal(styleFor(voice, 5000)[0], rows - 1)
})

console.log('=== ' + passed + ' test superati ===')
