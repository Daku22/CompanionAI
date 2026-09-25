// test-main-flusso.js — simula il flusso main.js: registrazione turni + compaction
const path = require('path')
const os = require('os')
const { MemoryManager } = require('../src/memory/MemoryManager.js')
const { route, PROVIDERS } = require('../src/main/ai-router.js')

const API_KEY = process.env.OPENROUTER_API_KEY
const PROVIDER = 'openrouter'
// Stesso default del router: un id scritto qui a mano invecchia senza avvisare.
const MODEL = PROVIDERS.openrouter.models[0].id

async function main() {
  if (!API_KEY) {
    console.error('Imposta OPENROUTER_API_KEY prima di eseguire')
    process.exit(1)
  }

  const mm = new MemoryManager('default', path.join(os.tmpdir(), 'companion-e2e'), {
    provider: PROVIDER,
    model: MODEL,
    apiKey: API_KEY,
  })

  // 1. Registra turno utente
  const userMsg = 'Ciao! Come si chiama il tuo progetto?'
  await mm.addTurn(userMsg, 'user')
  console.log('[1] turno utente registrato')

  // 2. Chiamata LLM (come fa il main handler ai:send-message)
  const history = [{ role: 'user', content: userMsg }]
  const result = await route({ provider: PROVIDER, model: MODEL, apiKey: API_KEY, history })
  console.log('[2] risposta LLM:', JSON.stringify(result.reply).slice(0, 90))
  if (!result.reply) throw new Error('nessuna risposta')

  // 3. Registra turno assistant
  await mm.addTurn(result.reply, 'assistant')
  console.log('[3] turno assistant registrato')

  // 4. Compaction e verifica
  const did = await mm.compact(0)
  console.log('[4] compattato:', did)
  console.log('    summary:', JSON.stringify(mm.getSummary()).slice(0, 100))
  console.log('    stats:', JSON.stringify(mm.getStats()))
}

main().catch(e => { console.error('ERR', e); process.exit(1) })