// test-memory.js — smoke test isolato del MemoryManager (nessuna key richiesta)
const { MemoryManager } = require('./MemoryManager.js')
const { PROVIDERS } = require('../main/ai-router')

// Il test usa lo stesso default del router: se quel modello sparisce, il test
// lo segue senza restare indietro con un id morto.
const TEST_MODEL = PROVIDERS.openrouter.models[0].id
const path = require('path')
const os = require('os')
const fs = require('fs')

function assert(cond, msg) {
  if (!cond) { console.error('ASSERT FALLITO:', msg); process.exit(1) }
}

async function test() {
  console.log('=== MemoryManager Integration Test (isolato) ===\n')

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-test-'))
  const mm = new MemoryManager('test-session', dir, {
    provider: 'openrouter',
    model: TEST_MODEL,
    apiKey: process.env.OPENROUTER_API_KEY || null,
  })

  await mm.addTurn('Ciao, come stai?', 'user')
  await mm.addTurn('Sto bene, grazie! Libro interessante.', 'assistant')
  await mm.addTurn('Che libro è?', 'user')
  await mm.addTurn('Fantascienza su AI companion desktop.', 'assistant')
  await mm.addTurn('Di cosa parla?', 'user')
  await mm.addTurn('Di AI che vivono sul desktop.', 'assistant')
  console.log('1. 6 turni aggiunti OK')

  const ctx = await mm.getContext(4096)
  assert(ctx.length === 6, `context atteso 6, ottenuto ${ctx.length}`)
  console.log(`2. getContext OK (${ctx.length} record, nessun summary ancora)`)

  // Persistenza: nuova istanza deve ricaricare da disco
  const mm2 = new MemoryManager('test-session', dir, { provider: 'openrouter', model: TEST_MODEL, apiKey: null })
  const loaded = await mm2.loadState()
  assert(loaded, 'loadState deve tornare true')
  assert(mm2.getRawTurns().length === 6, 'reload deve avere 6 turni')
  console.log('3. loadState OK (6 turni ricaricati)')

  const did = await mm2.compact(0)
  assert(did === true, 'compact(0) deve compattare')
  const summary = await mm2.getSummary()
  assert(summary.length > 0 && !summary.includes('Nell:'), 'summary senza refuso Nell')
  assert((await mm2.getRawTurns()).length === 0, 'raw svuotato dopo compact')
  assert((await mm2.getArchive()).length === 6, 'archivio lossless 6')
  console.log(`4. compact OK (summary ${summary.length} chars, archive 6)`)

  await mm2.clear()
  assert((await mm2.getRawTurns()).length === 0 && (await mm2.getArchive()).length === 0, 'clear svuota tutto')
  const turnsFile = path.join(dir, 'active', 'test-session', 'turns.jsonl')
  const size = fs.existsSync(turnsFile) ? fs.statSync(turnsFile).size : -1
  assert(size === 0, 'turns.jsonl troncato dopo clear')
  assert(!fs.existsSync(path.join(dir, 'archive', 'test-session')), 'l\'archivio su disco deve sparire dopo clear')
  console.log('5. clear OK (RAM + turns.jsonl troncato + archivio rimosso)')

  // Il modello dei riassunti segue la configurazione: la chiave inserita dopo
  // l'avvio deve arrivare al MemoryManager senza riavviare l'app.
  mm2.setModel({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'sk-ant-x' })
  assert(mm2.provider === 'claude' && mm2.apiKey === 'sk-ant-x', 'setModel deve aggiornare provider e chiave')
  mm2.setModel({})
  assert(mm2.apiKey === null && mm2.model === TEST_MODEL, 'senza config torna al default')
  console.log('6. setModel OK')

  await fs.promises.rm(dir, { recursive: true, force: true })

  // ── Memoria su disco nel tempo ────────────────────────────────────────────
  const dir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-test-'))
  const opts = { provider: 'openrouter', model: TEST_MODEL, apiKey: null }
  const turnsLog = path.join(dir2, 'active', 'long', 'turns.jsonl')
  const logLines = () => fs.readFileSync(turnsLog, 'utf-8').split('\n').filter(Boolean).length

  // Oltre i 200 turni archiviati il reload non li riconosceva piu' e li
  // reintroduceva come nuovi: il log attivo deve contenere solo il non riassunto.
  const long = new MemoryManager('long', dir2, opts)
  for (let i = 0; i < 250; i++) await long.addTurn('vecchio ' + i, i % 2 ? 'assistant' : 'user')
  assert(await long.compact(0), 'compact(0) deve compattare')
  assert(logLines() === 0, 'dopo la compattazione turns.jsonl deve essere vuoto, ha ' + logLines() + ' righe')
  const reloaded = new MemoryManager('long', dir2, opts)
  await reloaded.loadState()
  assert(reloaded.getRawTurns().length === 0, 'al reload i turni compattati sono rientrati: ' + reloaded.getRawTurns().length)
  assert(reloaded.getStats().archivedTurns === 250, 'il conteggio archiviati deve essere 250, e-` ' + reloaded.getStats().archivedTurns)
  console.log('7. log attivo ripulito, nessun turno riassunto due volte OK')

  // Oltre la soglia i piu' vecchi si riassumono: prima venivano tagliati via
  // dalla RAM senza passare dal riassunto.
  for (let i = 0; i < 205; i++) await reloaded.addTurn('recente ' + i, 'user')
  assert(reloaded.needsCompaction(), 'con 205 turni in RAM serve una compattazione')
  assert(reloaded.getRawTurns().length === 205, 'nessun turno deve sparire prima della compattazione')
  await reloaded.compact(7)
  const raw = reloaded.getRawTurns()
  assert(raw.length === 200 && raw[0].content === 'recente 5', 'devono restare gli ultimi 200 turni, in ordine')
  assert(reloaded.getSummary().includes('recente 0'), 'i turni oltre soglia devono finire nel riassunto')
  assert(logLines() === 200, 'il log attivo deve rispecchiare i 200 turni rimasti')
  console.log('8. soglia dei 200 turni: riassunto invece di taglio OK')

  // Timer, pulsante e soglia possono chiedere la compattazione insieme.
  const busy = new MemoryManager('busy', dir2, opts)
  for (let i = 0; i < 4; i++) await busy.addTurn('turno ' + i, 'user')
  let summaries = 0
  busy._generateSummary = async () => { summaries++; await new Promise(r => setTimeout(r, 30)); return 'riassunto' }
  const [a, b] = await Promise.all([busy.compact(0), busy.compact(0)])
  assert(a === true && b === true && summaries === 1, 'due compattazioni insieme devono diventare una sola, riassunti: ' + summaries)
  assert(busy.getStats().archivedTurns === 4, 'i turni non devono essere archiviati due volte')

  // Un turno che arriva mentre il riassunto e' in corso non va perso.
  await busy.addTurn('prima', 'user')
  const pending = busy.compact(0)
  await busy.addTurn('durante la compattazione', 'user')
  await pending
  assert(busy.getRawTurns().some(t => t.content === 'durante la compattazione'), 'il turno arrivato durante la compattazione e-` sparito')
  console.log('9. compattazioni contemporanee e turni in arrivo OK')

  // Il router taglia ogni messaggio a 8000 caratteri: una compattazione grossa
  // mandata tutta insieme veniva riassunta solo nel suo inizio.
  const big = new MemoryManager('big', dir2, opts)
  for (let i = 0; i < 40; i++) await big.addTurn('turno-' + i + ' ' + 'x'.repeat(1000), 'user')
  const seen = []
  big._generateSummary = async (prev, prompt) => {
    seen.push(prompt)
    assert((prev + prompt).length < 8000, 'un blocco supera il limite del router: ' + (prev + prompt).length)
    return 'riassunto fino a ' + seen.length
  }
  await big.compact(0)
  assert(seen.length > 1, 'la compattazione doveva essere divisa in piu-` blocchi')
  const covered = seen.join('\n')
  assert(covered.includes('turno-0 ') && covered.includes('turno-39 '), 'qualche turno non e-` arrivato al riassunto')
  assert(big.getSummary() === 'riassunto fino a ' + seen.length, 'il riassunto finale deve piegare tutti i blocchi')
  console.log('10. compattazione grossa divisa in ' + seen.length + ' blocchi OK')

  // Senza chiave il riassunto di ripiego tiene la parte recente, non l'inizio.
  const full = new MemoryManager('full', dir2, opts)
  full.state.fadingMemory.summary = 'y'.repeat(3000)
  await full.addTurn('novita importante', 'user')
  await full.compact(0)
  assert(full.getSummary().includes('novita importante'), 'con il riassunto pieno i turni nuovi non entravano piu-`')
  assert(full.getSummary().length <= 2000, 'il riassunto di ripiego deve restare entro 2000 caratteri')
  console.log('11. ripiego senza chiave tiene i turni recenti OK')

  // Il pulsante "Compatta": turni recenti (meno di 7 giorni) compattati
  // comunque, tranne gli ultimi keepRecent.
  const manual = new MemoryManager('manual', dir2, opts)
  for (let i = 0; i < 6; i++) await manual.addTurn('recente-' + i, 'user')
  assert(await manual.compact(7) === false, 'con i 7 giorni non doveva compattare nulla')
  assert(await manual.compact(0, 4) === true, 'a mano doveva compattare')
  assert(manual.getRawTurns().map(t => t.content).join() === 'recente-2,recente-3,recente-4,recente-5', 'restano gli ultimi 4')
  assert(await manual.compact(0, 4) === false, 'restano solo gli ultimi: niente da compattare')
  console.log('12. compattazione a mano tiene gli ultimi turni OK')

  // Memoria leggibile (Blocco 6e): riassunto riscritto, ricordi eliminati
  // dai recenti e dall'archivio, anche su disco e dopo un riavvio.
  const edit = new MemoryManager('edit', dir2, opts)
  for (let i = 0; i < 6; i++) await edit.addTurn('ricordo-' + i, 'user')
  await edit.compact(0, 2)
  const archivedId = edit.getArchive()[0].id
  const rawId = edit.getRawTurns()[0].id
  await edit.editSummary('  Riassunto scritto a mano.  ')
  assert(await edit.deleteTurn(rawId) === true, 'il turno recente doveva sparire')
  assert(await edit.deleteTurn(archivedId) === true, 'il turno archiviato doveva sparire')
  assert(await edit.deleteTurn('nessuno') === false, 'un id sconosciuto non elimina nulla')
  const again = new MemoryManager('edit', dir2, opts)
  await again.loadState()
  assert(again.getSummary() === 'Riassunto scritto a mano.', 'il riassunto a mano non e-` stato salvato')
  assert(!again.getRawTurns().some(t => t.id === rawId), 'il turno recente e-` tornato al riavvio')
  assert(!again.getArchive().some(t => t.id === archivedId), 'il turno archiviato e-` tornato al riavvio')
  const onDisk = (await fs.promises.readdir(path.join(dir2, 'archive', 'edit')))
    .map(f => fs.readFileSync(path.join(dir2, 'archive', 'edit', f), 'utf8')).join('')
  assert(!onDisk.includes(archivedId) && onDisk.includes('ricordo-1'), 'il file d-`archivio non e-` stato corretto')
  assert(again.getStats().archivedTurns === 3, 'il conteggio dell-`archivio doveva scendere')
  console.log('13. memoria leggibile: riassunto e ricordi eliminati OK')

  await fs.promises.rm(dir2, { recursive: true, force: true })
  console.log('\n=== Test completato: TUTTO OK ===')
}

test().catch(err => { console.error('Test failed:', err); process.exit(1) })
