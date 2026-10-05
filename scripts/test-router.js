// test-router.js — verifica il router senza fare chiamate di rete.
//
// Il punto piu' importante coperto qui e' che la memoria arrivi davvero al
// modello. Il main la inietta come messaggi con role "system": se il router li
// scartasse, il companion tornerebbe a essere smemorato senza che nulla si
// rompa in modo visibile. E' esattamente il bug che c'era.

const assert = require('node:assert/strict')
const http = require('http')
const {
  prepare, sanitizeHistory, parseResponse, PROVIDERS, ANIMATIONS, ACTION_TYPES, EMOTIONS,
  COMPANION_SCHEMA, SYSTEM_PROMPT, MOTION_PROMPT, route, fetchJSON, requestBudget,
  describeError, ollamaFailure, parseOpenRouterModels, parseAnthropicModels, parseOpenAIModels, parseOllamaTags,
  directFromOpenRouter, cloudName, mergeOllamaModels,
  capsFromParams, outputMode, openRouterBody, readChoice, openRouterUrl, DIRECTIONS, DISTANCES,
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

test('il system prompt elenca le emozioni dello schema', () => {
  assert.deepEqual(COMPANION_SCHEMA.properties.emotion.enum, EMOTIONS)
  for (const e of EMOTIONS) assert.ok(SYSTEM_PROMPT.includes('"' + e + '"'), 'emozione "' + e + '" assente dal prompt')
})

test('l-emozione della risposta arriva al main', () => {
  const r = parseResponse('{"reply":"ciao","emotion":"joy","action":{"type":"none","animation":"wave"}}')
  assert.equal(r.emotion, 'joy')
  // Senza il campo la risposta resta valida: e' facoltativo.
  assert.equal(parseResponse('{"reply":"ciao"}').emotion, undefined)
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
  for (const [provider, model] of [['openai', 'o3'], ['claude', 'claude-opus-5-5']]) {
    const b = requestBudget(provider, model, 1024)
    assert.ok(b.maxTokens >= 8192, provider + '/' + model + ' ha solo ' + b.maxTokens + ' token')
    assert.ok(b.timeoutMs > 20000, provider + '/' + model + ' ha un timeout troppo corto')
  }
})

test('i modelli normali restano con il budget richiesto', () => {
  assert.deepEqual(requestBudget('openai', 'gpt-4o-mini', 1024), { maxTokens: 1024, timeoutMs: 20000, effort: null, reasoning: false })
  assert.deepEqual(requestBudget('inventato', 'x', 500), { maxTokens: 500, timeoutMs: 20000, effort: null, reasoning: false })
})

test('effort solo dove l-API lo accetta', () => {
  // Haiku 4.5 risponde con un errore se riceve effort.
  assert.equal(requestBudget('claude', 'claude-sonnet-5-5', 1024).effort, 'low')
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
  // 403: la chiave e' buona, e' il modello a non essere permesso.
  const forbidden = describeError(err(403, 'inkling:free is only available on agentic harnesses'), 'openrouter')
  assert.match(forbidden, /non ti permette di usare questo modello/)
  assert.doesNotMatch(forbidden, /rifiutato la chiave/)
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

test('da OpenRouter tutti i modelli, prima i gratuiti (Blocco 7a)', () => {
  const models = parseOpenRouterModels({ data: [
    { id: 'anthropic/claude-x', name: 'Claude X' },
    { id: 'b/zeta:free', name: 'Zeta (free)' },
    { id: 'c/alfa:free', name: 'Alfa' },
    { name: 'senza id' },
  ] })
  assert.deepEqual(models.map(({ id, label, free }) => ({ id, label, free })), [
    { id: 'c/alfa:free', label: 'Alfa (free)', free: true },
    { id: 'b/zeta:free', label: 'Zeta (free)', free: true },
    { id: 'anthropic/claude-x', label: 'Claude X', free: false },
  ])
  assert.deepEqual(parseOpenRouterModels(null), [])
})

test('Claude e OpenAI: elenchi dal vivo, solo chat, con visione e opzioni note', () => {
  const claude = parseAnthropicModels({ data: [
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
    { id: 'claude-nuovo-9', display_name: 'Claude Nuovo 9' },
    { id: 'non-claude' },
  ] })
  assert.deepEqual(claude.map(m => m.id), ['claude-sonnet-5-5', 'claude-nuovo-9'])
  assert.equal(claude[0].effort, true, 'le opzioni note restano')
  assert.ok(claude.every(m => m.vision))
  const openai = parseOpenAIModels({ data: [
    { id: 'gpt-4.1' }, { id: 'gpt-4o-mini-tts' }, { id: 'text-embedding-3-large' },
    { id: 'o4-mini' }, { id: 'gpt-realtime' }, { id: 'dall-e-3' }, { id: 'gpt-3.5-turbo' },
  ] })
  assert.deepEqual(openai.map(m => m.id), ['o4-mini', 'gpt-4.1', 'gpt-3.5-turbo'])
  assert.equal(openai.find(m => m.id === 'o4-mini').reasoning, true)
  assert.deepEqual(openai.map(m => m.vision), [true, true, false])
  assert.deepEqual(parseAnthropicModels(null), [])
})

test('Claude e ChatGPT senza chiave: elenco dal catalogo di OpenRouter', () => {
  const catalog = [
    { id: 'anthropic/claude-sonnet-4.5', label: 'Anthropic: Claude Sonnet 4.5' },
    { id: 'anthropic/claude-3.7-sonnet:thinking', label: 'Anthropic: Claude 3.7 Sonnet (thinking)' },
    { id: 'openai/gpt-4.1', label: 'OpenAI: GPT-4.1' },
    { id: 'openai/gpt-4o-mini-tts', label: 'OpenAI: TTS' },
    { id: 'google/gemma-4-31b-it:free', label: 'Gemma' },
  ]
  assert.deepEqual(directFromOpenRouter('claude', catalog).map(({ id, label }) => ({ id, label })),
    [{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }])
  assert.deepEqual(directFromOpenRouter('openai', catalog).map(m => m.id), ['gpt-4.1'])
  assert.equal(directFromOpenRouter('openai', catalog)[0].vision, true)
})

test('Ollama: installati, poi i modelli cloud del catalogo', () => {
  assert.equal(cloudName('gpt-oss:120b'), 'gpt-oss:120b-cloud')
  assert.equal(cloudName('kimi-k3'), 'kimi-k3:cloud')
  const models = mergeOllamaModels(
    [{ id: 'gpt-oss:120b-cloud', label: 'gpt-oss:120b-cloud' }, { id: 'mistral', label: 'mistral' }],
    ['gpt-oss:120b', 'kimi-k3'])
  assert.deepEqual(models.map(m => [m.id, m.cloud]), [['mistral', false], ['gpt-oss:120b-cloud', true], ['kimi-k3:cloud', true]])
  assert.ok(models[0].group.startsWith('Installati') && models[2].group.startsWith('Cloud'))
  assert.deepEqual(mergeOllamaModels([{ id: 'qwen3', label: 'qwen3' }], []).map(m => m.id), ['qwen3'])
})

test('Ollama: per i modelli cloud l\'errore dice di fare l\'accesso', () => {
  const e = Object.assign(new Error('unauthorized'), { status: 401 })
  assert.match(describeError(e, 'ollama'), /Accedi a Ollama/)
  const { NAME_RE } = require('../src/main/ollama')
  for (const ok of ['qwen3', 'gpt-oss:20b-cloud', 'utente/modello:q4_K_M']) assert.ok(NAME_RE.test(ok), ok)
  for (const bad of ['', '-x', 'a b', 'x;rm', '../x', 'a:b:c']) assert.ok(!NAME_RE.test(bad), bad)
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

// ── Modelli che non sanno fare JSON (Laguna S 2.1) ─────────────────────────
// Laguna dichiara tools e reasoning ma non response_format: mandargli solo
// response_format lo faceva rispondere in prosa, e l'avatar restava fermo.

const LAGUNA_PARAMS = ['include_reasoning', 'max_tokens', 'reasoning', 'temperature', 'tool_choice', 'tools']

test('le capacita-` si leggono dai supported_parameters di OpenRouter', () => {
  assert.deepEqual(capsFromParams(LAGUNA_PARAMS), { schema: false, json: false, tools: true, reasoning: true, vision: false })
  assert.deepEqual(capsFromParams(['response_format', 'structured_outputs']), { schema: true, json: true, tools: false, reasoning: false, vision: false })
  assert.deepEqual(capsFromParams(undefined), { schema: false, json: false, tools: false, reasoning: false, vision: false })
  // La visione dalle modalita' d'ingresso (Blocco 7b).
  assert.equal(capsFromParams([], { input_modalities: ['text', 'image'] }).vision, true)
  const models = parseOpenRouterModels({ data: [{ id: 'poolside/laguna-s-2.1:free', name: 'Laguna', supported_parameters: LAGUNA_PARAMS }] })
  assert.equal(models[0].caps.tools, true)
})

test('la strategia di uscita segue cio-` che il modello sa fare', () => {
  const caps = (list) => capsFromParams(list)
  assert.equal(outputMode(caps(['structured_outputs', 'response_format', 'tools']), true), 'schema')
  assert.equal(outputMode(caps(['response_format', 'tools']), true), 'json')
  assert.equal(outputMode(caps(LAGUNA_PARAMS), true), 'tool')
  assert.equal(outputMode(caps([]), true), 'prompt')
  assert.equal(outputMode(null, true), 'json', 'capacita-` sconosciute: come prima')
  assert.equal(outputMode(caps(LAGUNA_PARAMS), false), 'text', 'i riassunti restano testo libero')
})

test('a un modello con soli tools si chiede una tool call forzata', () => {
  const opts = { maxTokens: 8192, reasoning: true }
  const body = openRouterBody('poolside/laguna-s-2.1:free', [{ role: 'user', content: 'ciao' }], opts, 'tool')
  assert.equal(body.response_format, undefined, 'niente response_format: il fornitore lo ignorerebbe')
  assert.equal(body.tools[0].function.name, 'rispondi_companion')
  assert.deepEqual(body.tools[0].function.parameters, COMPANION_SCHEMA)
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'rispondi_companion' } })
  assert.deepEqual(body.provider, { require_parameters: true })
  assert.deepEqual(body.reasoning, { effort: 'low', exclude: true })
  assert.equal(openRouterBody('m', [], opts, 'tool', { strictRouting: false }).provider, undefined)
  assert.equal(openRouterBody('m', [], { maxTokens: 10 }, 'schema').response_format.type, 'json_schema')
  assert.equal(openRouterBody('m', [], { maxTokens: 10 }, 'json').response_format.type, 'json_object')
  assert.equal(openRouterBody('m', [], { maxTokens: 10 }, 'prompt').provider, undefined)
})

test('la risposta arriva dalla tool call, con l-azione intatta', () => {
  const args = JSON.stringify({ reply: 'Vado!', emotion: 'joy', action: { type: 'none', animation: 'walk-to', direction: 'right', distance: 'medium' } })
  const r = readChoice({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'rispondi_companion', arguments: args } }] } }] }, 'tool', true)
  assert.equal(r.via, 'tool')
  assert.equal(r.action.direction, 'right')
  // Tool ignorata ma JSON nel testo: si prende comunque.
  const t = readChoice({ choices: [{ message: { content: '{"reply":"ok","action":{"type":"none","animation":"sit"}}' } }] }, 'tool', true)
  assert.equal(t.via, 'json')
  assert.equal(t.action.animation, 'sit')
  // Prosa: niente azione, e il testo grezzo per il log.
  const p = readChoice({ choices: [{ message: { content: 'Certo, cammino verso destra!' } }] }, 'tool', true)
  assert.equal(p.via, 'fallback')
  assert.equal(p.action.animation, 'idle')
  assert.equal(p.raw, 'Certo, cammino verso destra!')
})

test('un JSON senza reply non passa per una risposta valida', () => {
  const r = parseResponse('{"text":"ciao","action":{"type":"none","animation":"wave"}}')
  assert.equal(r.via, 'fallback')
  assert.equal(typeof r.reply, 'string')
})

test('un modello che ragiona, dall-elenco dal vivo, riceve spazio e tempo', () => {
  const b = requestBudget('openrouter', 'poolside/laguna-s-2.1:free', 1024, capsFromParams(LAGUNA_PARAMS))
  assert.deepEqual(b, { maxTokens: 8192, timeoutMs: 90000, effort: null, reasoning: true })
})

test('il contratto sa dire verso e distanza della camminata', () => {
  const props = COMPANION_SCHEMA.properties.action.properties
  assert.deepEqual(props.direction.enum, DIRECTIONS)
  assert.deepEqual(props.distance.enum, DISTANCES)
  assert.ok(!COMPANION_SCHEMA.properties.action.required.includes('direction'))
  assert.match(SYSTEM_PROMPT, /cammina verso destra.*direction: "right"/)
  assert.match(SYSTEM_PROMPT, /siediti.*animation: "sit"/)
})

test('movimenti nuovi: campo motion facoltativo, spiegato solo quando serve', () => {
  const props = COMPANION_SCHEMA.properties.action.properties
  assert.equal(props.motion.type, 'string')
  assert.ok(!COMPANION_SCHEMA.properties.action.required.includes('motion'))
  // Il prompt di base non ne parla: senza Kimodo il modello non deve proporlo.
  assert.ok(!SYSTEM_PROMPT.includes('"motion"'))
  assert.match(MOTION_PROMPT, /IN INGLESE/)
  assert.match(MOTION_PROMPT, /motion: "A person/)
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

  await testAsync('route con un modello a soli tools: tool call, verso e budget giusti', async () => {
    const seen = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url === '/api/v1/models') {
          res.end(JSON.stringify({ data: [{ id: 'finto/laguna:free', name: 'Laguna finto', supported_parameters: LAGUNA_PARAMS }] }))
          return
        }
        seen.push(JSON.parse(body))
        const args = JSON.stringify({ reply: 'Vado a destra!', emotion: 'joy', action: { type: 'none', animation: 'walk-to', direction: 'right', distance: 'medium' } })
        res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'rispondi_companion', arguments: args } }] } }] }))
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
    const previous = process.env.OPENROUTER_URL
    try {
      const { port } = /** @type {import('net').AddressInfo} */ (server.address())
      process.env.OPENROUTER_URL = 'http://127.0.0.1:' + port
      const r = await route({ provider: 'openrouter', model: 'finto/laguna:free', apiKey: 'sk-or-test',
        history: [{ role: 'user', content: 'cammina verso destra' }] })
      assert.equal(r.via, 'tool')
      assert.equal(r.action.animation, 'walk-to')
      assert.equal(r.action.direction, 'right')
      assert.equal(seen.length, 1)
      assert.ok(seen[0].tools && !seen[0].response_format, 'tool call, non response_format')
      assert.equal(seen[0].max_tokens, 8192, 'modello che ragiona: budget pieno')
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_URL; else process.env.OPENROUTER_URL = previous
      server.close()
    }
  })

  await testAsync('una risposta in prosa viene richiesta di nuovo, una volta sola', async () => {
    const seen = []
    let alwaysProse = false   // true: anche il secondo tentativo risponde in prosa
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url === '/api/v1/models') {
          res.end(JSON.stringify({ data: [{ id: 'finto/prosa-poi-tool:free', name: 'x', supported_parameters: LAGUNA_PARAMS }] }))
          return
        }
        seen.push(JSON.parse(body))
        if (seen.length === 1 || alwaysProse) {
          res.end(JSON.stringify({ choices: [{ message: { content: 'Ciao! Ti saluto con la mano.' } }] }))
          return
        }
        const args = JSON.stringify({ reply: 'Ciao!', action: { type: 'none', animation: 'wave' } })
        res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'rispondi_companion', arguments: args } }] } }] }))
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
    const previous = process.env.OPENROUTER_URL
    try {
      const { port } = /** @type {import('net').AddressInfo} */ (server.address())
      process.env.OPENROUTER_URL = 'http://127.0.0.1:' + port
      const ask = () => route({ provider: 'openrouter', model: 'finto/prosa-poi-tool:free', apiKey: 'sk-or-test',
        history: [{ role: 'user', content: 'salutami' }] })
      const r = await ask()
      assert.equal(r.via, 'tool')
      assert.equal(r.action.animation, 'wave')
      assert.equal(seen.length, 2, 'un solo secondo tentativo')
      assert.match(seen[1].messages.at(-1).content, /formato del companion/)
      assert.equal(seen[1].messages.at(-2).role, 'assistant', 'il modello rivede la propria risposta')
      // Se anche il secondo tentativo e' in prosa, resta la prima risposta.
      seen.length = 0
      alwaysProse = true
      const again = await ask()
      assert.equal(again.via, 'fallback')
      assert.equal(again.reply, 'Ciao! Ti saluto con la mano.')
      assert.equal(seen.length, 2)
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_URL; else process.env.OPENROUTER_URL = previous
      server.close()
    }
  })

  await testAsync('limite giornaliero dei modelli gratuiti: nessun altro tentativo', async () => {
    const seen = []
    let answer = { status: 429, body: { error: { message: 'Rate limit exceeded: free-models-per-day.', code: 429 } } }
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        if (req.url === '/api/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ data: [{ id: 'finto/limite:free', name: 'x', supported_parameters: ['response_format'] }] }))
          return
        }
        seen.push(JSON.parse(body).model)
        res.writeHead(answer.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(answer.body))
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
    const previous = process.env.OPENROUTER_URL
    try {
      const { port } = /** @type {import('net').AddressInfo} */ (server.address())
      process.env.OPENROUTER_URL = 'http://127.0.0.1:' + port
      const ask = (fallback, retries) => route({ provider: 'openrouter', model: 'finto/limite:free', apiKey: 'sk-or-test',
        history: [{ role: 'user', content: 'ciao' }], fallback, retries })
      // Prima si ritentava tre volte e poi si provavano gli altri modelli gratuiti.
      const err = await ask(true).then(() => null, e => e)
      assert.ok(err && err.daily, 'errore segnato come limite giornaliero')
      assert.deepEqual(seen, ['finto/limite:free'], 'una richiesta sola')
      assert.match(describeError(err, 'openrouter'), /richieste gratuite di oggi/)
      // Un 429 qualsiasi si ritenta, ma senza scorta resta sullo stesso modello.
      seen.length = 0
      answer = { status: 429, body: { error: { message: 'Provider busy', code: 429 } } }
      await assert.rejects(() => ask(false))
      assert.ok(seen.length > 1, 'un 429 qualsiasi si ritenta')
      assert.ok(seen.every(m => m === 'finto/limite:free'), 'fallback: false non passa ad altri modelli')
      // retries: 0 (bench-models.js): una richiesta sola, si rifa' al giro dopo.
      seen.length = 0
      await assert.rejects(() => ask(false, 0))
      assert.equal(seen.length, 1)
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_URL; else process.env.OPENROUTER_URL = previous
      server.close()
    }
  })

  await testAsync('OPENROUTER_URL vale solo verso questo PC', async () => {
    const previous = process.env.OPENROUTER_URL
    try {
      process.env.OPENROUTER_URL = 'http://127.0.0.1:9999'
      assert.equal(openRouterUrl('/models'), 'http://127.0.0.1:9999/api/v1/models')
      // Un indirizzo esterno viene ignorato: la chiave non si dirotta con una variabile.
      for (const evil of ['http://evil.example.com', 'https://127.0.0.1.evil.com', 'http://localhost.evil.com:80']) {
        process.env.OPENROUTER_URL = evil
        assert.equal(openRouterUrl('/models'), 'https://openrouter.ai/api/v1/models', evil)
      }
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_URL; else process.env.OPENROUTER_URL = previous
    }
  })

  await testAsync('Ollama spento: il messaggio dice di avviarlo', async () => {
    // Una porta appena liberata: nessuno ascolta, la connessione viene rifiutata.
    const server = http.createServer()
    await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
    const { port } = /** @type {import('net').AddressInfo} */ (server.address())
    await new Promise(r => server.close(() => r(null)))
    const previous = process.env.OLLAMA_PORT
    process.env.OLLAMA_PORT = String(port)
    process.env.COMPANION_NO_OLLAMA_START = '1'
    try {
      await assert.rejects(
        () => route({ provider: 'ollama', model: 'x', history: [{ role: 'user', content: 'a' }] }),
        /Ollama non si avvia/)
    } finally {
      if (previous === undefined) delete process.env.OLLAMA_PORT; else process.env.OLLAMA_PORT = previous
      delete process.env.COMPANION_NO_OLLAMA_START
    }
  })

  test('Ollama lento non viene scambiato per Ollama spento', () => {
    // Al primo messaggio carica il modello: prima il timeout diceva "non raggiungibile".
    const slow = ollamaFailure(new Error('Timeout dopo 120000ms'))
    assert.match(slow.message, /non ha risposto in 120 s/)
    assert.doesNotMatch(slow.message, /non si avvia/)
    const off = ollamaFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    assert.match(off.message, /non si avvia/)
    // Una risposta interrotta con Ollama acceso tiene il motivo vero.
    const reset = ollamaFailure(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    assert.doesNotMatch(reset.message, /non si avvia/)
    assert.match(reset.message, /ECONNRESET/)
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
