// test-diary.js — il diario della persona (src/main/diary.js).

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const D = require('../src/main/diary')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const at = (d, h) => new Date(2026, 9, d, h).toISOString()
const now = new Date(2026, 9, 5, 9).getTime()
const turns = [
  { speaker: 'user', content: 'ciao', timestamp: at(2, 10) },
  { speaker: 'assistant', content: 'ciao!', timestamp: at(2, 10) },
  { speaker: 'user', content: 'parliamo di musica', timestamp: at(3, 21) },
  { speaker: 'assistant', content: 'volentieri', timestamp: at(3, 21) },
  { speaker: 'user', content: 'oggi', timestamp: at(5, 8) },
]

async function main() {
  console.log('=== Diario ===')

  await test("il giorno da scrivere: l'ultimo prima di oggi con turni, senza voce", () => {
    assert.equal(D.dayToWrite(turns, [], now), '2026-10-03')
    assert.equal(D.dayToWrite(turns, [{ day: '2026-10-03' }], now), null)
    // Solo turni di oggi: niente da scrivere.
    assert.equal(D.dayToWrite(turns.slice(4), [], now), null)
    assert.equal(D.dayToWrite([], [], now), null)
    assert.equal(D.dayToWrite([{ timestamp: 'boh' }], [], now), null)
  })

  await test('il dialogo di quel giorno, con i nomi, e tagliato se lungo', () => {
    assert.equal(D.transcript(turns, '2026-10-03', 'Luma'), 'Utente: parliamo di musica\nLuma: volentieri')
    const long = Array.from({ length: 400 }, (_, i) => ({ speaker: 'user', content: 'frase numero ' + i, timestamp: at(3, 12) }))
    const t = D.transcript(long, '2026-10-03')
    assert.ok(t.length <= D.MAX_TRANSCRIPT + 1 && t.startsWith('…') && t.endsWith('frase numero 399'))
  })

  await test('prompt: personalita\' solo se c\'e\', e mai JSON', () => {
    assert.ok(!D.systemPrompt({ name: 'Luma', prompt: '' }).includes('Ti chiami'))
    const p = D.systemPrompt({ name: 'Luma', prompt: 'Sei curiosa.' })
    assert.ok(p.startsWith('Ti chiami Luma.') && p.includes('senza JSON') && p.includes('quanto vuoi'))
  })

  await test('la voce si ripulisce; vuota non si salva', () => {
    assert.equal(D.cleanEntry('```\nCaro diario\n```'), 'Caro diario')
    assert.equal(D.cleanEntry('   '), null)
    assert.equal(D.cleanEntry('x'.repeat(20000)).length, D.MAX_ENTRY)
    assert.equal(D.cleanEntry(null), null)
  })

  await test('su disco: si aggiunge, si rilegge dalla piu\' recente, le righe rotte si saltano', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diary-'))
    const file = path.join(dir, 'p', 'diary.jsonl')
    assert.deepEqual(await D.loadDiary(file), [])
    await D.appendDiary(file, { day: '2026-10-02', text: 'uno' })
    await fs.promises.appendFile(file, '{rotta\n')
    await D.appendDiary(file, { day: '2026-10-03', text: 'due' })
    assert.deepEqual(await D.loadDiary(file), [{ day: '2026-10-03', text: 'due' }, { day: '2026-10-02', text: 'uno' }])
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  await test('la live (Blocco 11d): un paragrafo a parte, che non toglie la pagina del giorno', async () => {
    const turns = [{ timestamp: '2026-10-03T10:00:00Z', speaker: 'user', content: 'ciao' }]
    const now = Date.parse('2026-10-04T09:00:00Z')
    assert.equal(D.dayToWrite(turns, [{ day: '2026-10-03', kind: 'live' }], now), '2026-10-03', 'la pagina del 3 si scrive lo stesso')
    const summary = { startedAt: 0, endedAt: 47 * 60000, channel: 'canale', counts: { received: 30, answered: 5 },
      events: [{ user: 'Amico', text: 'raid con 9 spettatori' }],
      answered: [{ kind: 'mention', user: 'Marco', by: 'Feniel', reply: 'Benissimo, grazie Marco!' }, { kind: 'event', user: 'Amico', by: 'Luma', reply: 'Benvenuti!' }] }
    const t = D.liveTranscript(summary, 'Feniel')
    assert.match(t, /circa 47 minuti/)
    assert.match(t, /raid con 9/)
    assert.match(t, /rispondendo a Marco: «Benissimo, grazie Marco!»/)
    assert.doesNotMatch(t, /Benvenuti/, 'solo le sue risposte')
    assert.match(D.liveTranscript(summary, 'Nessuno'), /non hai risposto/)
    assert.match(D.liveSystemPrompt({ name: 'Feniel', prompt: 'allegra' }), /live su Twitch.*come ti sei sentito/)
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diary-live-'))
    const file = path.join(dir, 'diary.jsonl')
    await D.appendDiary(file, { day: '2026-10-03', text: 'live!', kind: 'live' })
    await D.appendDiary(file, { day: '2026-10-03', text: 'giornata' })
    assert.deepEqual((await D.loadDiary(file)).map(e => e.kind || 'pagina').sort(), ['live', 'pagina'])
    await fs.promises.rm(dir, { recursive: true, force: true })
  })

  console.log(`=== ${passed} test superati ===`)
}

main()
