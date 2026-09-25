// test-router.js — verifica il router senza fare chiamate di rete.
//
// Il punto piu' importante coperto qui e' che la memoria arrivi davvero al
// modello. Il main la inietta come messaggi con role "system": se il router li
// scartasse, il companion tornerebbe a essere smemorato senza che nulla si
// rompa in modo visibile. E' esattamente il bug che c'era.

const assert = require('node:assert/strict')
const http = require('http')
const {
  prepare, sanitizeHistory, parseResponse, PROVIDERS, ANIMATIONS, ACTION_TYPES,
  COMPANION_SCHEMA, SYSTEM_PROMPT, route, fetchJSON, requestBudget,
  describeError, parseOpenRouterModels, parseOllamaTags,
} = require('../src/main/ai-router')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

async function testAsync(name, fn) {
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

console.log('=== Router AI ===\n')

// ── Memoria che raggiunge il modello ────────────────────────────────────────

test('i messaggi di sistema finiscono nel system prompt, non vengono persi', () => {
  const memoria = 'MEMORIA: l-utente si chiama Sara e lavora su un companion desktop.'
  const { system, messages } = prepare([
    { role: 'system', content: memoria },
    { role: 'user', content: 'ciao' },
  ], 'PROMPT BASE')

  assert.ok(system.includes('PROMPT BASE'), 'il prompt base deve restare')
  assert.ok(system.includes(memoria), 'la memoria iniettata sarebbe stata scartata')
  assert.equal(messages.length, 1, 'il system non deve restare tra i messaggi')
  assert.equal(messages[0].role, 'user')
})

test('piu-` blocchi di memoria vengono uniti in ordine', () => {
  const { system } = prepare([
    { role: 'system', content: 'PRIMO' },
    { role: 'user', content: 'a' },
    { role: 'system', content: 'SECONDO' },
  ], 'BASE')
  assert.ok(system.indexOf('PRIMO') < system.indexOf('SECONDO'), 'ordine non rispettato')
})

test('la memoria sopravvive a una chat piu-` lunga del limite di 40 messaggi', () => {
  // Il main mette il riassunto in testa: tagliare l'intera lista a 40 lo
  // scartava per primo, proprio quando la conversazione si allungava.
  const chat = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }))
  const { system, messages } = prepare([{ role: 'system', content: 'MEMORIA' }, ...chat], 'BASE')
  assert.ok(system.includes('MEMORIA'), 'il riassunto e-` stato tagliato via')
  assert.equal(messages.length, 40)
})

test('il dialogo inizia sempre dall-utente', () => {
  // I turni recuperati dalla memoria possono partire da una risposta del
  // companion: Anthropic rifiuterebbe la richiesta con un 400.
  const { messages } = prepare([
    { role: 'assistant', content: 'risposta vecchia' },
    { role: 'user', content: 'ciao' },
  ], 'BASE')
  assert.equal(messages[0].role, 'user')
  assert.equal(messages.length, 1)
})

test('due messaggi di fila dello stesso ruolo vengono uniti', () => {
  const { messages } = prepare([
    { role: 'user', content: 'domanda senza risposta' },
    { role: 'user', content: 'seconda domanda' },
    { role: 'assistant', content: 'ok' },
  ], 'BASE')
  assert.deepEqual(messages.map(m => m.role), ['user', 'assistant'])
  assert.ok(messages[0].content.includes('domanda senza risposta') && messages[0].content.includes('seconda domanda'))
})

test('senza memoria il system prompt resta quello base', () => {
  const { system } = prepare([{ role: 'user', content: 'ciao' }], 'BASE')
  assert.equal(system, 'BASE')
})

// ── Igiene della history ────────────────────────────────────────────────────

test('la history scarta i messaggi malformati', () => {
  const out = sanitizeHistory([
    { role: 'user', content: 'buono' },
    { role: 'user', content: 123 },
    { role: 'hacker', content: 'ruolo inventato' },
    null,
    { content: 'senza ruolo' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].content, 'buono')
})

test('la history viene troncata a 40 messaggi e 8000 caratteri', () => {
  const lunga = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: 'm' + i }))
  assert.equal(sanitizeHistory(lunga).length, 40)
  const enorme = sanitizeHistory([{ role: 'user', content: 'x'.repeat(20000) }])
  assert.equal(enorme[0].content.length, 8000)
})

// ── Contratto di risposta ───────────────────────────────────────────────────

test('lo schema copre esattamente le animazioni e le azioni dichiarate', () => {
  const schemaAnim = COMPANION_SCHEMA.properties.action.properties.animation.enum
  const schemaAct  = COMPANION_SCHEMA.properties.action.properties.type.enum
  assert.deepEqual(schemaAnim, ANIMATIONS, 'schema e lista animazioni divergono')
  assert.deepEqual(schemaAct, ACTION_TYPES, 'schema e lista azioni divergono')
})

test('il system prompt elenca le stesse animazioni dello schema', () => {
  for (const a of ANIMATIONS) {
    assert.ok(SYSTEM_PROMPT.includes('"' + a + '"'),
      'animazione "' + a + '" assente dal prompt: il modello non sapra-` di poterla usare')
  }
})

test('una risposta JSON pulita viene letta cosi-` com-e-`', () => {
  const r = parseResponse('{"reply":"ciao","action":{"type":"none","animation":"wave"}}')
  assert.equal(r.reply, 'ciao')
  assert.equal(r.action.animation, 'wave')
})

test('il JSON dentro un blocco markdown viene recuperato', () => {
  const r = parseResponse('```json\n{"reply":"ok","action":{"type":"none","animation":"idle"}}\n```')
  assert.equal(r.reply, 'ok')
})

test('un JSON troncato conserva almeno la risposta', () => {
  const r = parseResponse('{"reply":"risposta lunga tagliata a meta')
  assert.equal(r.reply, 'risposta lunga tagliata a meta')
  assert.equal(r.action.type, 'none')
})

test('una risposta in prosa non fa perdere il testo', () => {
  const r = parseResponse('Ciao, come posso aiutarti?')
  assert.ok(r.reply.includes('Ciao'), 'il testo andrebbe perso')
  assert.equal(r.action.animation, 'idle')
})

test('in modalita-` prosa il testo passa senza essere interpretato', () => {
  const r = parseResponse('{ questo non e-` json }', false)
  assert.equal(r.reply, '{ questo non e-` json }')
})

// ── Configurazione dei provider ─────────────────────────────────────────────

test('ogni provider ha almeno un modello e un placeholder coerente', () => {
  for (const [nome, p] of Object.entries(PROVIDERS)) {
    assert.ok(p.models.length > 0, nome + ' non ha modelli')
    for (const m of p.models) {
      assert.ok(m.id && m.label, nome + ' ha un modello senza id o label')
    }
    if (p.keyPrefix === null) {
      assert.equal(p.keyPlaceholder, null, nome + ' non richiede key ma ha un placeholder')
    }
  }
})

test('i modelli che ragionano ricevono spazio e tempo in piu-`', () => {
  // Il ragionamento consuma lo stesso budget della risposta: con 1024 token
  // o3 e Opus 5 rispondevano vuoto o con il JSON troncato.
  for (const [provider, model] of [['openai', 'o3'], ['claude', 'claude-opus-5'], ['gemini', 'gemini-2.5-pro']]) {
    const b = requestBudget(provider, model, 1024)
    assert.ok(b.maxTokens >= 8192, provider + '/' + model + ' ha solo ' + b.maxTokens + ' token')
    assert.ok(b.timeoutMs > 20000, provider + '/' + model + ' ha un timeout troppo corto')
  }
})

test('i modelli normali restano con il budget richiesto', () => {
  assert.deepEqual(requestBudget('openai', 'gpt-4o-mini', 1024), { maxTokens: 1024, timeoutMs: 20000, effort: null })
  assert.deepEqual(requestBudget('inventato', 'x', 500), { maxTokens: 500, timeoutMs: 20000, effort: null })
})

test('effort solo dove l-API lo accetta', () => {
  // Haiku 4.5 risponde con un errore se riceve effort.
  assert.equal(requestBudget('claude', 'claude-sonnet-5', 1024).effort, 'low')
  assert.equal(requestBudget('claude', 'claude-haiku-4-5', 1024).effort, null)
  for (const [provider, p] of Object.entries(PROVIDERS)) {
    for (const m of p.models) {
      if (m.effort) assert.equal(provider, 'claude', m.id + ': effort e-` un parametro Anthropic')
    }
  }
})

test('gli errori dei provider diventano messaggi che dicono cosa fare', () => {
  const err = (status, message) => Object.assign(new Error(message), { status })
  assert.match(describeError(err(401, 'invalid x-api-key'), 'claude'), /rifiutato la chiave/)
  assert.match(describeError(err(401, 'invalid x-api-key'), 'claude'), /invalid x-api-key/, 'il testo originale resta per le segnalazioni')
  assert.match(describeError(err(402, 'Insufficient credits'), 'openrouter'), /Credito esaurito/)
  assert.match(describeError(err(404, 'model_not_found'), 'openai'), /non esiste più/)
  assert.match(describeError(err(429, 'rate limited'), 'openrouter'), /altro modello gratuito/)
  assert.match(describeError(err(503, 'overloaded'), 'gemini'), /temporaneo/)
  assert.match(describeError(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }), 'mistral'), /connessione/)
  assert.match(describeError(new Error('Timeout dopo 20000ms'), 'grok'), /non ha risposto in tempo/)
  assert.equal(describeError(new Error('Manca API key per claude'), 'claude'), 'Manca API key per claude')
})

test('ogni provider dice dove si ottiene la chiave', () => {
  for (const [nome, p] of Object.entries(PROVIDERS)) {
    assert.match(p.keyUrl || '', /^https:\/\//, nome + ' senza keyUrl https')
  }
})

test('dall-elenco di OpenRouter restano solo i modelli gratuiti', () => {
  const models = parseOpenRouterModels({ data: [
    { id: 'a/paid', name: 'Paid' },
    { id: 'b/zeta:free', name: 'Zeta (free)' },
    { id: 'c/alfa:free', name: 'Alfa' },
    { name: 'senza id' },
  ] })
  assert.deepEqual(models, [{ id: 'c/alfa:free', label: 'Alfa (free)' }, { id: 'b/zeta:free', label: 'Zeta (free)' }])
  assert.deepEqual(parseOpenRouterModels(null), [])
})

test('da Ollama arrivano i modelli scaricati, senza :latest', () => {
  assert.deepEqual(parseOllamaTags({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen2.5:7b' }] }),
    [{ id: 'llama3.2', label: 'llama3.2' }, { id: 'qwen2.5:7b', label: 'qwen2.5:7b' }])
  assert.deepEqual(parseOllamaTags({}), [])
})

test('nessun id di modello Anthropic con suffisso di data', () => {
  // Gli id correnti sono completi cosi-` come sono: un suffisso di data
  // significa quasi sempre un id ricordato a memoria e ormai inesistente.
  for (const m of PROVIDERS.claude.models) {
    assert.ok(!/-20\d{6}$/.test(m.id), 'id con data: ' + m.id)
  }
})

// ── Guardie di route() ──────────────────────────────────────────────────────

async function main() {
  await testAsync('route rifiuta un provider sconosciuto', async () => {
    await assert.rejects(
      () => route({ provider: 'inventato', model: 'x', history: [{ role: 'user', content: 'a' }] }),
      /non supportato/)
  })

  await testAsync('route rifiuta una history fatta di sola memoria', async () => {
    // Solo messaggi di sistema significa nessuna domanda: chiamare il provider
    // sarebbe uno spreco e molti rifiuterebbero la richiesta.
    await assert.rejects(
      () => route({ provider: 'openrouter', model: 'x', apiKey: 'sk-or-1',
                    history: [{ role: 'system', content: 'memoria' }] }),
      /History vuota/)
  })

  await testAsync('route rifiuta una history fatta solo di risposte del companion', async () => {
    await assert.rejects(
      () => route({ provider: 'openrouter', model: 'x', apiKey: 'sk-or-1',
                    history: [{ role: 'assistant', content: 'solo io' }] }),
      /History vuota/)
  })

  await testAsync('una lettera accentata spezzata fra due chunk arriva intatta', async () => {
    const body = Buffer.from(JSON.stringify({ reply: 'perché' }), 'utf8')
    const cut = body.indexOf(Buffer.from('é', 'utf8')) + 1 // a meta' dei due byte di "é"
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write(body.subarray(0, cut))
      setTimeout(() => res.end(body.subarray(cut)), 20)
    })
    await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
    try {
      const { port } = /** @type {import('net').AddressInfo} */ (server.address())
      const res = await fetchJSON('http://127.0.0.1:' + port + '/', { method: 'GET' }, null)
      assert.equal(res.body.reply, 'perché')
    } finally { server.close() }
  })

  await testAsync('route pretende una key tranne che per ollama', async () => {
    await assert.rejects(
      () => route({ provider: 'claude', model: 'claude-opus-5',
                    history: [{ role: 'user', content: 'a' }] }),
      /Manca API key/)
  })

  console.log('\n=== ' + passed + ' test superati ===')
  if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
}

main()
