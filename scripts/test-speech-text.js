// test-speech-text.js — testo da pronunciare (src/main/speech-text.js).
const assert = require('node:assert/strict')
const { cleanForSpeech, splitSentences, MAX_SENTENCE } = require('../src/main/speech-text')

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Testo per la voce ===')

t('niente emoji, markdown e link', () => {
  assert.equal(cleanForSpeech('Ciao! 👋😊 Sono **felice** di _vederti_. Guarda https://esempio.it/pagina?x=1 qui'),
    'Ciao! Sono felice di vederti. Guarda un link qui')
  assert.equal(cleanForSpeech('Leggi [la guida](https://x.y) e `npm start`'), 'Leggi la guida e npm start')
  assert.equal(cleanForSpeech('👨‍👩‍👧 famiglia 👍🏽'), 'famiglia')
})

t('a capo ed elenchi diventano pause', () => {
  assert.equal(cleanForSpeech('Ecco:\n- pane\n- latte\nFatto!'), 'Ecco: pane. latte. Fatto!')
  assert.equal(cleanForSpeech('Ciao!\nCome stai?'), 'Ciao! Come stai?')
})

t('testo vuoto o non stringa', () => {
  assert.equal(cleanForSpeech(''), '')
  assert.equal(cleanForSpeech(null), '')
  assert.deepEqual(splitSentences(''), [])
  assert.deepEqual(splitSentences('   '), [])
})

t('frasi divise alla punteggiatura forte, numeri interi', () => {
  assert.deepEqual(splitSentences('Oggi pesa 3.5 kg, sai? Poi andiamo al parco insieme, va bene? Perfetto, allora a dopo!'),
    ['Oggi pesa 3.5 kg, sai?', 'Poi andiamo al parco insieme, va bene?', 'Perfetto, allora a dopo!'])
})

t('le frasi brevi si uniscono alla seguente', () => {
  assert.deepEqual(splitSentences('Ah! Oh! Ho capito cosa intendi, davvero.'), ['Ah! Oh! Ho capito cosa intendi, davvero.'])
})

t('una frase lunghissima si spezza alle virgole, e nessuna parola si perde', () => {
  const long = Array.from({ length: 30 }, (_, i) => 'parte numero ' + i).join(', ') + '.'
  const parts = splitSentences(long)
  assert.ok(parts.length > 1)
  assert.ok(parts.every(p => p.length <= MAX_SENTENCE + 1), parts.map(p => p.length).join(','))
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long)
})

t('una frase senza spazi non si blocca', () => {
  const blob = 'x'.repeat(500)
  assert.equal(splitSentences(blob).join(''), blob)
})

console.log('=== ' + passed + ' test superati ===')
