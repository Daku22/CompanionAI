// test-speech-text.js — testo da pronunciare (src/main/speech-text.js).
const assert = require('node:assert/strict')
const { cleanForSpeech, splitSentences, takeSentences, cleanTranscript, MAX_SENTENCE } = require('../src/main/speech-text')

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

t('microfono: via le frasi inventate sul silenzio, il resto intatto', () => {
  assert.equal(cleanTranscript('  Ciao,   come stai?  '), 'Ciao, come stai?')
  assert.equal(cleanTranscript('Sottotitoli creati dalla comunità Amara.org'), '')
  assert.equal(cleanTranscript('Sottotitoli a cura di QTSS'), '')
  assert.equal(cleanTranscript('Apri il blocco note. Sottotitoli a cura di QTSS.'), 'Apri il blocco note.')
  assert.equal(cleanTranscript('Mi piacciono i film con i sottotitoli.'), 'Mi piacciono i film con i sottotitoli.')
  assert.equal(cleanTranscript(' ... '), '')
  assert.equal(cleanTranscript(null), '')
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

t('una risposta che arriva a pezzi: escono solo le frasi finite (Blocco 11a)', () => {
  const full = 'Ciao! Che bella giornata, vero? Il dott. Rossi dice che costa 3.5 euro... Ma io non ci credo. Fine'
  let buffer = ''
  const said = []
  for (let i = 0; i < full.length; i += 4) {
    buffer += full.slice(i, i + 4)
    const r = takeSentences(buffer)
    said.push(...r.sentences)
    buffer = r.rest
  }
  said.push(...takeSentences(buffer, true).sentences)
  assert.equal(said.join(' '), splitSentences(cleanForSpeech(full)).join(' '), 'detto tutto, una volta sola: ' + JSON.stringify(said))
  assert.ok(said.length >= 3, 'in piu\' frasi')
  assert.ok(!said.some(s => s === '3.' || s.endsWith(' 3.')), '"3.5" non si spezza')
})

t('takeSentences: le frasi corte aspettano, il codice aperto pure, la frase lunghissima si taglia', () => {
  assert.deepEqual(takeSentences('Ah! Ma'), { sentences: [], rest: 'Ah! Ma' })
  assert.deepEqual(takeSentences('Ciao a tutti quanti! Oggi'), { sentences: ['Ciao a tutti quanti!'], rest: 'Oggi' })
  assert.deepEqual(takeSentences('Ecco il codice:\n```js\nconst a = 1.\n'), { sentences: [], rest: 'Ecco il codice:\n```js\nconst a = 1.\n' })
  assert.deepEqual(takeSentences('Una frase senza fine'), { sentences: [], rest: 'Una frase senza fine' })
  const long = 'parola, '.repeat(60)
  const r = takeSentences(long)
  assert.ok(r.sentences.length >= 1 && r.sentences.every(s => s.length <= MAX_SENTENCE), 'tagliata a misura')
  assert.ok(long.endsWith(r.rest) && r.rest.length < long.length)
  assert.deepEqual(takeSentences('ultima parte', true), { sentences: ['ultima parte'], rest: '' })
})

console.log('=== ' + passed + ' test superati ===')
