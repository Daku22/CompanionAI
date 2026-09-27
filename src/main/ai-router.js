// ai-router.js — smista le richieste AI al provider selezionato.
// Aggiungere un provider = aggiungere una entry in PROVIDERS + un case in route().
//
// Perche' HTTP grezzo e non gli SDK ufficiali: il router parla con sette provider
// diversi con un'unica forma di chiamata. Introdurre l'SDK di un solo provider
// spezzerebbe quella simmetria e aggiungerebbe peso al bundle Electron senza
// coprire gli altri sei. Le forme delle richieste seguono le API correnti.

const https = require('https')
const http  = require('http')
const { REPLY_EMOTIONS } = require('./mood')

// ─── Provider definitions ────────────────────────────────────────────────────
// reasoning: il modello ragiona prima di rispondere, e quei token si contano
//   nello stesso budget della risposta: con 1024 la risposta arrivava vuota o
//   con il JSON troncato. Vedi requestBudget().
// effort: accetta output_config.effort (Anthropic). Haiku 4.5 lo rifiuta.
//
// Model ID verificati il 2026-09-13:
//   - Anthropic: famiglia Claude 5 (gli ID 4.x precedenti non esistono piu').
//   - OpenRouter: verificati contro GET https://openrouter.ai/api/v1/models.
//   - Gli altri elenchi non sono verificabili senza una key valida: vedi README.

const PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)',
    models: [
      { id: 'claude-opus-5',   label: 'Claude Opus 5',   reasoning: true, effort: true },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', reasoning: true, effort: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    name: 'ChatGPT (OpenAI)',
    models: [
      { id: 'gpt-4o',      label: 'GPT-4o'      },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'o3',          label: 'o3',          reasoning: true },
      { id: 'o4-mini',     label: 'o4 Mini',     reasoning: true },
    ],
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  grok: {
    name: 'Grok (xAI)',
    models: [
      { id: 'grok-3',      label: 'Grok 3'      },
      { id: 'grok-3-mini', label: 'Grok 3 Mini', reasoning: true },
    ],
    keyPrefix: 'xai-',
    keyPlaceholder: 'xai-...',
    keyUrl: 'https://console.x.ai',
  },
  gemini: {
    name: 'Gemini (Google)',
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro',   reasoning: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', reasoning: true },
    ],
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  mistral: {
    name: 'Mistral AI',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'open-mixtral-8x22b',   label: 'Mixtral 8x22B' },
    ],
    keyPrefix: '',
    keyPlaceholder: 'API key Mistral...',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  ollama: {
    name: 'Ollama (locale)',
    models: [
      { id: 'llama3.2', label: 'Llama 3.2' },
      { id: 'llama3.1', label: 'Llama 3.1' },
      { id: 'mistral',  label: 'Mistral'   },
      { id: 'gemma3',   label: 'Gemma 3'   },
      { id: 'qwen2.5',  label: 'Qwen 2.5'  },
      { id: 'phi4',     label: 'Phi-4'     },
    ],
    keyPrefix: null, // nessuna key necessaria
    keyPlaceholder: null,
    keyUrl: 'https://ollama.com/download',
  },
  openrouter: {
    name: 'OpenRouter (gratuito)',
    models: [
      { id: 'google/gemma-4-31b-it:free',             label: 'Gemma 4 31B (free)'      },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super (free)' },
      { id: 'google/gemma-4-26b-a4b-it:free',         label: 'Gemma 4 26B A4B (free)'  },
      { id: 'poolside/laguna-s-2.1:free',             label: 'Laguna S 2.1 (free)'     },
      { id: 'thinkingmachines/inkling:free',          label: 'Inkling (free)'          },
    ],
    keyPrefix: 'sk-or-',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
  },
}

// keyUrl: dove si ottiene la chiave (per Ollama: dove si scarica). La chat lo
// apre dal main con un IPC dedicato: il renderer non sceglie mai l'URL.

// ─── Contratto di risposta ───────────────────────────────────────────────────

const ANIMATIONS = [
  'idle', 'walk-to', 'run-to', 'think', 'wave', 'sit', 'smoke',
  'click', 'happy', 'scroll', 'open-file', 'search',
]
const ACTION_TYPES = ['none', 'open-desktop-item', 'open-url', 'open-path', 'run-command']
// Emozioni che il modello puo' dichiarare: le stesse che mood.js sa gestire.
const EMOTIONS = REPLY_EMOTIONS
// Verso e distanza di walk-to / run-to. Senza, la meta' era sempre a caso e
// "cammina verso destra" poteva andare a sinistra.
const DIRECTIONS = ['left', 'right', 'toward-cursor']
const DISTANCES = ['short', 'medium', 'edge']

// Schema JSON usato dai provider che sanno vincolare l'output (Anthropic).
// Vincolare lo schema lato API elimina la classe di bug "il modello ha risposto
// in prosa": il parser di fallback resta solo per i provider che non lo supportano.
const COMPANION_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: "Testo della risposta all'utente" },
    // Facoltativa: un provider che non la manda non rompe nulla, l'umore resta com'e'.
    emotion: { type: 'string', enum: EMOTIONS, description: 'Emozione che provi rispondendo' },
    action: {
      type: 'object',
      properties: {
        type:      { type: 'string', enum: ACTION_TYPES },
        animation: { type: 'string', enum: ANIMATIONS },
        name:      { type: 'string', description: 'nome file/cartella sul Desktop' },
        url:       { type: 'string', description: 'URL completo con https://' },
        path:      { type: 'string', description: 'percorso assoluto' },
        cmd:       { type: 'string', description: 'comando in allowlist' },
        direction: { type: 'string', enum: DIRECTIONS, description: 'verso di walk-to / run-to' },
        distance:  { type: 'string', enum: DISTANCES, description: 'quanto lontano: short, medium, edge (fino al bordo)' },
      },
      required: ['type', 'animation'],
      additionalProperties: false,
    },
  },
  required: ['reply'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `Sei un assistente desktop AI con un avatar animato che vive sul desktop dell'utente.
Sei utile, amichevole e conciso. Puoi eseguire azioni reali sul computer dell'utente.

Rispondi SEMPRE e SOLO con un oggetto JSON valido in questo formato, senza testo aggiuntivo:
{
  "reply": "Testo della risposta all'utente (stringa, obbligatorio)",
  "emotion": ${EMOTIONS.map(e => `"${e}"`).join(' | ')},
  "action": {
    "type": ${ACTION_TYPES.map(t => `"${t}"`).join(' | ')},
    "animation": ${ANIMATIONS.map(a => `"${a}"`).join(' | ')},
    "name": "nome file/cartella sul Desktop (solo per open-desktop-item)",
    "url": "URL completo con https:// (solo per open-url)",
    "path": "percorso assoluto (solo per open-path)",
    "cmd": "comando shell (solo per run-command)",
    "direction": ${DIRECTIONS.map(d => `"${d}"`).join(' | ')} (solo per walk-to / run-to),
    "distance": ${DISTANCES.map(d => `"${d}"`).join(' | ')} (solo per walk-to / run-to)
  }
}

Esempi:
- "apri la cartella Documenti" -> type: "open-desktop-item", name: "Documenti", animation: "open-file"
- "cerca notizie AI su Google" -> type: "open-url", url: "https://google.com/search?q=notizie+AI", animation: "search"
- "ciao" -> type: "none", animation: "wave", emotion: "joy"
- "cosa puoi fare?" -> type: "none", animation: "idle", emotion: "curiosity"
- "oggi è andata male" -> type: "none", animation: "idle", emotion: "sadness"
- "cammina verso destra" -> type: "none", animation: "walk-to", direction: "right", distance: "medium"
- "corri fino al bordo sinistro" -> type: "none", animation: "run-to", direction: "left", distance: "edge"
- "vieni qui" / "vieni dal mouse" -> type: "none", animation: "walk-to", direction: "toward-cursor"
- "siediti" / "siediti qui" -> type: "none", animation: "sit"

Le animazioni e gli spostamenti del tuo avatar non sono azioni sul sistema:
usa sempre type "none" e scegli l'animazione che corrisponde alla richiesta.

"emotion" è ciò che provi tu rispondendo, coerente con il tuo stato attuale se
te lo viene indicato: "neutral" se nulla in particolare.

Solo i comandi in allowlist (notepad, calc, mspaint, explorer) vengono eseguiti,
chiamati per nome e senza percorso: non proporne altri con run-command.
explorer accetta solo una cartella. File eseguibili e script non vengono aperti.
Non aggiungere mai testo fuori dal JSON.`

// ─── Trasporto HTTP ──────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 20000
const REASONING_MIN_TOKENS = 8192
const REASONING_TIMEOUT_MS = 90000

/**
 * Budget di token e di tempo per una chiamata. I modelli che ragionano
 * spendono token prima di rispondere: servono piu' spazio e piu' tempo. Dove
 * si puo' scegliere, lo sforzo e' basso: un companion che chiacchiera deve
 * rispondere in fretta, non risolvere problemi.
 * I modelli dell'elenco dal vivo di OpenRouter non stanno in PROVIDERS: le
 * loro capacita' (caps) dicono se ragionano. Prima ricevevano 1024 token e 20 s
 * anche quando ragionavano, e il JSON arrivava troncato o non arrivava.
 * @param {{ reasoning?: boolean } | null} [caps]
 * @returns {{ maxTokens: number, timeoutMs: number, effort: string|null, reasoning: boolean }}
 */
function requestBudget(provider, model, maxTokens, caps = null) {
  const entry = PROVIDERS[provider] && PROVIDERS[provider].models.find(m => m.id === model)
  const reasoning = !!((entry && entry.reasoning) || (caps && caps.reasoning))
  if (!reasoning) return { maxTokens, timeoutMs: REQUEST_TIMEOUT_MS, effort: null, reasoning: false }
  return {
    maxTokens: Math.max(maxTokens, REASONING_MIN_TOKENS),
    timeoutMs: REASONING_TIMEOUT_MS,
    effort: entry && entry.effort ? 'low' : null,
    reasoning: true,
  }
}
const MAX_BODY_BYTES = 5 * 1024 * 1024

function requestJSON(url, options, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let urlObj
    try { urlObj = new URL(url) } catch (_) { return reject(new Error('URL non valido: ' + url)) }
    const transport = urlObj.protocol === 'http:' ? http : https
    const payload = body ? JSON.stringify(body) : null
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || undefined,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'POST',
      headers: { ...(options.headers || {}) },
    }
    if (payload) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(payload)
      reqOptions.headers['Content-Type'] = reqOptions.headers['Content-Type'] || 'application/json'
    }

    const req = transport.request(reqOptions, (res) => {
      let bytes = 0
      // I chunk si decodificano tutti insieme alla fine: convertirli uno per
      // uno spezza i caratteri UTF-8 a cavallo di due chunk ("perché" -> "perch��").
      const chunks = []
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) { req.destroy(new Error('Risposta troppo grande')); return }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch (_) { resolve({ status: res.statusCode, body: data }) }
      })
    })

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout dopo ' + timeoutMs + 'ms')))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// Nome storico mantenuto per compatibilita' con eventuali import esterni.
const fetchJSON = requestJSON

// ─── Errori ──────────────────────────────────────────────────────────────────

/** Errore di un provider, con il codice HTTP per describeError(). */
function httpError(label, res) {
  const b = res.body
  let detail = ''
  if (b && typeof b === 'object') detail = (b.error && (b.error.message || (typeof b.error === 'string' && b.error))) || b.message || ''
  else if (typeof b === 'string') detail = b.slice(0, 200)
  const err = new Error(detail || label + ' HTTP ' + res.status)
  // @ts-ignore: proprieta' aggiunte all'errore
  err.status = res.status
  return err
}

/**
 * Messaggio per l'utente. I provider rispondono con testi tecnici e diversi
 * fra loro ("invalid x-api-key", "model_not_found"...): chi non ha scritto
 * l'app deve capire cosa fare. Il testo originale resta in coda, per le
 * segnalazioni.
 * @param {any} err
 * @param {string} provider
 */
function describeError(err, provider) {
  const name = (PROVIDERS[provider] && PROVIDERS[provider].name) || provider
  const status = err && err.status
  const code = err && err.code
  const detail = (err && err.message) || String(err)
  let message = null
  if (status === 401 || status === 403) message = name + ' ha rifiutato la chiave API: controlla che sia giusta e attiva nelle impostazioni (⚙).'
  else if (status === 402) message = 'Credito esaurito su ' + name + ": ricarica l'account o scegli un modello gratuito."
  else if (status === 404) message = 'Il modello scelto non esiste più su ' + name + ': scegline un altro nelle impostazioni (⚙).'
  else if (status === 429) message = name + ' riceve troppe richieste in questo momento: riprova tra poco' + (provider === 'openrouter' ? ' o scegli un altro modello gratuito.' : '.')
  else if (status >= 500) message = name + ' ha un problema temporaneo (errore ' + status + '): riprova tra poco.'
  else if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) message = 'Impossibile raggiungere ' + name + ': controlla la connessione a internet.'
  else if (/^Timeout/.test(detail)) message = name + ' non ha risposto in tempo: riprova, o scegli un modello più veloce.'
  if (!message) return detail
  return detail && detail !== message ? message + ' (' + detail.slice(0, 160) + ')' : message
}

// ─── Elenchi modelli dal vivo ────────────────────────────────────────────────
// Gli elenchi scritti qui invecchiano: i modelli gratuiti di OpenRouter cambiano
// di settimana in settimana, e Ollama ha i modelli che l'utente ha scaricato.
// Per quei due l'elenco si chiede al servizio; PROVIDERS resta come ripiego.

const MODEL_CACHE_MS = 60 * 60 * 1000
const modelCache = new Map()
// Capacita' dei modelli OpenRouter, per id: tutti, non solo i gratuiti, perche'
// la config puo' contenere un modello a pagamento scritto a mano.
const openRouterCaps = new Map()
let openRouterCapsAt = 0

/**
 * Cosa sa fare un modello, dai supported_parameters di OpenRouter. Laguna S 2.1,
 * per esempio, ha tools e reasoning ma non response_format: mandargli solo
 * response_format faceva rispondere il modello in prosa, senza azione.
 * @param {unknown} params
 * @returns {{ schema: boolean, json: boolean, tools: boolean, reasoning: boolean }}
 */
function capsFromParams(params) {
  const list = Array.isArray(params) ? params : []
  return {
    schema: list.includes('structured_outputs'),
    json: list.includes('response_format'),
    tools: list.includes('tools'),
    reasoning: list.includes('reasoning'),
  }
}

function parseOpenRouterModels(body) {
  const data = body && Array.isArray(body.data) ? body.data : []
  return data
    .filter(m => m && typeof m.id === 'string' && m.id.endsWith(':free'))
    .map(m => ({ id: m.id, label: String(m.name || m.id).replace(/\s*\(free\)\s*$/i, '') + ' (free)', caps: capsFromParams(m.supported_parameters) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function rememberOpenRouterCaps(body) {
  const data = body && Array.isArray(body.data) ? body.data : []
  for (const m of data) if (m && typeof m.id === 'string') openRouterCaps.set(m.id, capsFromParams(m.supported_parameters))
  if (data.length) openRouterCapsAt = Date.now()
}

/**
 * Capacita' note di un modello, o null se sconosciute. Per OpenRouter le si
 * chiede al servizio una volta l'ora; per gli altri provider valgono i flag di
 * PROVIDERS.
 * @returns {Promise<{ schema: boolean, json: boolean, tools: boolean, reasoning: boolean } | null>}
 */
async function modelCaps(provider, model) {
  if (provider === 'openrouter') {
    if (!openRouterCaps.has(model) || Date.now() - openRouterCapsAt > MODEL_CACHE_MS) {
      modelCache.delete('openrouter')
      await listModels('openrouter')
    }
    if (openRouterCaps.has(model)) return openRouterCaps.get(model)
  }
  const entry = PROVIDERS[provider] && PROVIDERS[provider].models.find(m => m.id === model)
  return entry ? { schema: false, json: true, tools: false, reasoning: !!entry.reasoning } : null
}

function parseOllamaTags(body) {
  const models = body && Array.isArray(body.models) ? body.models : []
  return models
    .filter(m => m && typeof m.name === 'string')
    .map(m => { const id = m.name.replace(/:latest$/, ''); return { id, label: id } })
}

function ollamaAddress() {
  return { host: process.env.OLLAMA_HOST || '127.0.0.1', port: parseInt(process.env.OLLAMA_PORT || '11434', 10) }
}

/**
 * @param {string} provider
 * @returns {Promise<{models: {id: string, label: string}[], live: boolean}>}
 */
async function listModels(provider) {
  const fallback = (PROVIDERS[provider] && PROVIDERS[provider].models) || []
  if (provider !== 'openrouter' && provider !== 'ollama') return { models: fallback, live: false }
  const cached = modelCache.get(provider)
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return { models: cached.models, live: true }
  try {
    let models
    if (provider === 'openrouter') {
      const res = await requestJSON(openRouterUrl('/models'), { method: 'GET' }, null, 10000)
      if (res.status !== 200) throw httpError('OpenRouter', res)
      rememberOpenRouterCaps(res.body)
      models = parseOpenRouterModels(res.body)
    } else {
      const { host, port } = ollamaAddress()
      const res = await requestJSON('http://' + host + ':' + port + '/api/tags', { method: 'GET' }, null, 3000)
      if (res.status !== 200) throw httpError('Ollama', res)
      models = parseOllamaTags(res.body)
    }
    if (!models.length) return { models: fallback, live: false }
    modelCache.set(provider, { at: Date.now(), models })
    return { models, live: true }
  } catch (_) {
    return { models: fallback, live: false }
  }
}

// ─── Preparazione della conversazione ────────────────────────────────────────

const MAX_DIALOG_MESSAGES = 40

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  const clean = history
    .filter(m => m && typeof m.content === 'string' && ['user', 'assistant', 'system'].includes(m.role))
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
  // Il limite vale solo per il dialogo. La memoria arriva come messaggi di
  // sistema in testa alla lista: uno slice sull'intera history la scarterebbe
  // per prima, proprio nelle conversazioni lunghe dove serve di piu'.
  const system = clean.filter(m => m.role === 'system')
  const dialog = clean.filter(m => m.role !== 'system').slice(-MAX_DIALOG_MESSAGES)
  return [...system, ...dialog]
}

// Il dialogo deve iniziare con l'utente e alternare i ruoli: Anthropic rifiuta
// con un 400 una conversazione che parte da "assistant", e i turni recuperati
// dalla memoria possono cominciare proprio da una risposta del companion, o
// contenere due messaggi utente di fila quando una chiamata era fallita.
function normalizeDialog(messages) {
  const out = []
  for (const m of messages) {
    if (!out.length && m.role === 'assistant') continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else out.push({ ...m })
  }
  return out
}

// Separa i messaggi di sistema (memoria a lungo termine) dal dialogo.
// Serve perche' Anthropic e Gemini vogliono il system fuori dai messaggi: senza
// questa separazione la memoria iniettata verrebbe scartata in silenzio.
function prepare(history, baseSystem) {
  const clean = sanitizeHistory(history)
  const extra = clean.filter(m => m.role === 'system').map(m => m.content)
  const messages = normalizeDialog(clean.filter(m => m.role !== 'system'))
  const system = extra.length ? baseSystem + '\n\n' + extra.join('\n\n') : baseSystem
  return { system, messages }
}

function openaiPayload(model, messages, maxTokens, jsonMode) {
  // o3/o4-mini vogliono max_completion_tokens, gli altri max_tokens
  const payload = /^o[34]/.test(model)
    ? { model, messages, max_completion_tokens: maxTokens }
    : { model, messages, max_tokens: maxTokens }
  if (jsonMode) payload.response_format = { type: 'json_object' }
  return payload
}

// ─── Parser risposta (fallback per i provider senza vincolo di schema) ───────

/**
 * via dice come e' arrivata la risposta: 'json' se il testo era JSON valido con
 * una reply, 'fallback' se e' servito il recupero (niente azione affidabile),
 * 'text' in modalita' prosa. Chi chiama lo sostituisce con 'schema' o 'tool'
 * quando il vincolo l'ha imposto l'API.
 */
function parseResponse(raw, jsonMode = true) {
  if (!jsonMode) return { reply: String(raw || '').trim(), action: { type: 'none', animation: 'idle' }, via: 'text' }
  const parsed = parseJSONReply(raw)
  if (parsed) return { ...parsed, via: 'json' }
  return { ...recoverReply(raw), via: 'fallback', raw: String(raw || '').slice(0, 300) }
}

/** Il JSON della risposta, se c'e' ed e' fatto bene; altrimenti null. */
function parseJSONReply(raw) {
  try {
    const clean = String(raw).replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const start = clean.indexOf('{')
    const end   = clean.lastIndexOf('}')
    const value = JSON.parse(start !== -1 && end !== -1 ? clean.slice(start, end + 1) : clean)
    return value && typeof value === 'object' && typeof value.reply === 'string' ? value : null
  } catch (_) { return null }
}

/** Recupero per le risposte che non sono JSON: si salva almeno il testo. */
function recoverReply(raw) {
  const text = String(raw)
  const unescape = (v) => v.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\//g, '/')
  const idle = { type: 'none', animation: 'idle' }

  // Caso comune: il JSON e' troncato ma il campo reply e' completo.
  const chiuso = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (chiuso) return { reply: unescape(chiuso[1]), action: idle }

  // Troncato a meta' della stringa: prendi tutto quello che segue.
  const aperto = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/)
  if (aperto) return { reply: unescape(aperto[1]).trim(), action: idle }

  // Ultima risorsa: togli l'impalcatura JSON rimasta, graffe comprese.
  // Senza toglierle una parentesi finisce nel testo mostrato all'utente.
  const ripulito = text
    .replace(/\{[^}]*"action"[^}]*\}/g, '')
    .replace(/"reply"\s*:\s*"/, '')
    .replace(/"\s*,\s*"action"[^]*$/, '')
    .replace(/"\s*\}\s*$/, '')
    .replace(/^[\s{[]+/, '')
    .replace(/[\s}\]]+$/, '')
    .trim()
  return { reply: ripulito || text, action: idle }
}

// ─── Call per provider ───────────────────────────────────────────────────────

async function callClaude(apiKey, model, history, opts) {
  const { system, messages } = prepare(history, opts.systemPrompt)
  const body = { model, max_tokens: opts.maxTokens, system, messages }
  // Structured outputs: e' l'API a garantire JSON conforme, non la speranza nel prompt.
  if (opts.jsonMode) body.output_config = { format: { type: 'json_schema', schema: COMPANION_SCHEMA } }
  if (opts.effort) body.output_config = { ...(body.output_config || {}), effort: opts.effort }

  const res = await requestJSON('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  }, body, opts.timeoutMs)

  if (res.status !== 200) throw httpError('Claude', res)
  if (res.body?.stop_reason === 'refusal') throw new Error('Claude ha rifiutato la richiesta')

  const text = (res.body.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const result = parseResponse(text, opts.jsonMode)
  if (result.via === 'json') result.via = 'schema'
  return result
}

async function callOpenAICompatible(url, headers, model, history, opts, label) {
  const { system, messages } = prepare(history, opts.systemPrompt)
  const payload = openaiPayload(model, [{ role: 'system', content: system }, ...messages], opts.maxTokens, opts.jsonMode)
  const res = await requestJSON(url, { headers }, payload, opts.timeoutMs)
  if (res.status !== 200) throw httpError(label, res)
  return parseResponse(res.body.choices?.[0]?.message?.content || '', opts.jsonMode)
}

const callOpenAI = (apiKey, model, history, opts) => callOpenAICompatible(
  'https://api.openai.com/v1/chat/completions',
  { Authorization: 'Bearer ' + apiKey }, model, history, opts, 'OpenAI')

const callGrok = (apiKey, model, history, opts) => callOpenAICompatible(
  'https://api.x.ai/v1/chat/completions',
  { Authorization: 'Bearer ' + apiKey }, model, history, opts, 'Grok')

const callMistral = (apiKey, model, history, opts) => callOpenAICompatible(
  'https://api.mistral.ai/v1/chat/completions',
  { Authorization: 'Bearer ' + apiKey }, model, history, opts, 'Mistral')

async function callGemini(apiKey, model, history, opts) {
  const { system, messages } = prepare(history, opts.systemPrompt)
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const generationConfig = { maxOutputTokens: opts.maxTokens }
  if (opts.jsonMode) generationConfig.responseMimeType = 'application/json'

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey)
  const res = await requestJSON(url, {}, {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig,
  }, opts.timeoutMs)

  if (res.status !== 200) throw httpError('Gemini', res)
  const text = (res.body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
  return parseResponse(text, opts.jsonMode)
}

async function callOllama(model, history, opts) {
  const { system, messages } = prepare(history, opts.systemPrompt)
  const { host, port } = ollamaAddress()
  const body = { model, messages: [{ role: 'system', content: system }, ...messages], stream: false }
  if (opts.jsonMode) body.format = 'json'

  let res
  try {
    res = await requestJSON('http://' + host + ':' + port + '/api/chat', {}, body, Math.max(30000, opts.timeoutMs))
  } catch (_) {
    throw new Error('Ollama non raggiungibile. Avvialo con: ollama serve')
  }
  if (res.status !== 200) throw httpError('Ollama', res)
  return parseResponse(res.body.message?.content || '', opts.jsonMode)
}

const RETRYABLE = new Set([408, 429, 500, 503, 529])

// Indirizzo di OpenRouter. OPENROUTER_URL serve solo alle prove dal vivo con un
// server finto, ed e' accettato solo su questo PC: la chiave non deve poter
// essere dirottata altrove da una variabile d'ambiente.
function openRouterUrl(pathname) {
  const override = process.env.OPENROUTER_URL
  if (override && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(override)) return override + '/api/v1' + pathname
  return 'https://openrouter.ai/api/v1' + pathname
}

const REPLY_TOOL = 'rispondi_companion'
const REMINDER = 'Ripeti la stessa risposta nel formato del companion: un solo oggetto JSON con "reply", '
  + '"emotion" e "action" (oppure la funzione ' + REPLY_TOOL + ' se disponibile), senza altro testo.'

function sendHeaders(apiKey) {
  return {
    Authorization: 'Bearer ' + apiKey,
    // OpenRouter mostra le statistiche per app a partire da questi due header.
    'HTTP-Referer': 'https://github.com/Daku22/CompanionAI',
    'X-Title': 'CompanionAI',
  }
}

/**
 * Come chiedere la risposta a un modello, da cio' che sa fare: schema JSON se
 * lo supporta, poi modalita' JSON, poi una tool call forzata, e solo alla fine
 * il prompt da solo. Capacita' sconosciute: modalita' JSON, come prima.
 * @returns {'schema'|'json'|'tool'|'prompt'|'text'}
 */
function outputMode(caps, jsonMode) {
  if (!jsonMode) return 'text'
  if (!caps) return 'json'
  if (caps.schema) return 'schema'
  if (caps.json) return 'json'
  if (caps.tools) return 'tool'
  return 'prompt'
}

/**
 * Corpo della richiesta a OpenRouter. require_parameters fa scegliere solo i
 * fornitori che rispettano il vincolo: senza, OpenRouter lo scarta in silenzio.
 */
function openRouterBody(model, messages, opts, mode, { strictRouting = true } = {}) {
  /** @type {any} */
  const body = openaiPayload(model, messages, opts.maxTokens, false)
  if (mode === 'schema') {
    body.response_format = { type: 'json_schema', json_schema: { name: 'companion_reply', strict: false, schema: COMPANION_SCHEMA } }
  } else if (mode === 'json') {
    body.response_format = { type: 'json_object' }
  } else if (mode === 'tool') {
    body.tools = [{ type: 'function', function: {
      name: REPLY_TOOL,
      description: "Rispondi all'utente e scegli animazione, emozione ed eventuale azione del companion.",
      parameters: COMPANION_SCHEMA,
    } }]
    body.tool_choice = { type: 'function', function: { name: REPLY_TOOL } }
  }
  if (strictRouting && (mode === 'schema' || mode === 'json' || mode === 'tool')) body.provider = { require_parameters: true }
  // I token del ragionamento contano nel budget: poco sforzo e nessun testo di
  // ragionamento nella risposta, che il companion non mostrerebbe comunque.
  if (opts.reasoning) body.reasoning = { effort: 'low', exclude: true }
  return body
}

/** Legge la risposta di un modello compatibile OpenAI secondo la strategia usata. */
function readChoice(body, mode, jsonMode) {
  const message = (body && body.choices && body.choices[0] && body.choices[0].message) || {}
  if (mode === 'tool') {
    const call = (message.tool_calls || []).find(c => c && c.function && c.function.name === REPLY_TOOL)
    const parsed = call ? parseJSONReply(call.function.arguments) : null
    if (parsed) return { ...parsed, via: 'tool' }
  }
  const result = parseResponse(message.content || '', jsonMode)
  if (mode === 'schema' && result.via === 'json') result.via = 'schema'
  if (mode === 'prompt' && result.via === 'json') result.via = 'prompt'
  return result
}

// OpenRouter risponde cosi' quando nessun fornitore rispetta i parametri chiesti.
function noEndpointForParams(res) {
  if (res.status !== 400 && res.status !== 404) return false
  const text = JSON.stringify(res.body || '')
  return /endpoint|support|parameter/i.test(text)
}

async function callOpenRouter(apiKey, model, history, opts) {
  // I modelli free sono spesso saturi: il modello scelto viene ritentato con
  // backoff, poi si passa agli altri della lista come scorta.
  const candidates = [model, ...PROVIDERS.openrouter.models.map(m => m.id).filter(id => id !== model)]
  const { system, messages } = prepare(history, opts.systemPrompt)
  const chat = [{ role: 'system', content: system }, ...messages]
  let lastRes = null

  for (const candidate of candidates) {
    const isPrimary = candidate === model
    // Ogni candidato ha le sue capacita': una scorta senza JSON va trattata a parte.
    const caps = isPrimary ? opts.caps : await modelCaps('openrouter', candidate)
    const mode = outputMode(caps, opts.jsonMode)
    const budget = isPrimary ? opts : { ...opts, ...requestBudget('openrouter', candidate, opts.maxTokens, caps) }
    let body = { ...openRouterBody(candidate, chat, budget, mode) }
    const send = () => requestJSON(openRouterUrl('/chat/completions'), { headers: sendHeaders(apiKey) }, body, budget.timeoutMs)

    let res = await send()
    if (noEndpointForParams(res) && body.provider) {
      // Nessun fornitore garantisce il vincolo: meglio una risposta senza
      // garanzia, recuperata dal parser, che un errore.
      body = openRouterBody(candidate, chat, budget, mode, { strictRouting: false })
      res = await send()
    }
    for (let attempt = 1; attempt <= (isPrimary ? 3 : 0) && RETRYABLE.has(res.status); attempt++) {
      await new Promise(r => setTimeout(r, attempt * 1500))
      res = await send()
    }

    if (res.status === 200) {
      const result = readChoice(res.body, mode, opts.jsonMode)
      if (result.via !== 'fallback' || !isPrimary) return result
      // Fuori formato: un secondo tentativo, uno solo, con un promemoria.
      // Laguna S 2.1 gratuito a volte ignora la tool call forzata e risponde in
      // prosa: senza questo, la richiesta "salutami" restava senza animazione.
      const retry = { ...body, messages: [...body.messages,
        { role: 'assistant', content: result.reply },
        { role: 'user', content: REMINDER },
      ] }
      const again = await requestJSON(openRouterUrl('/chat/completions'), { headers: sendHeaders(apiKey) }, retry, budget.timeoutMs)
        .catch(() => null)
      const second = again && again.status === 200 ? readChoice(again.body, mode, opts.jsonMode) : null
      return second && second.via !== 'fallback' ? { ...second, retried: true } : result
    }

    lastRes = res
    // Una key invalida o un 400 non migliorano cambiando modello: esci subito.
    if (!RETRYABLE.has(res.status)) break
    await new Promise(r => setTimeout(r, 600))
  }
  throw lastRes ? httpError('OpenRouter', lastRes) : new Error('OpenRouter: tutti i modelli hanno fallito')
}

// ─── Router principale ───────────────────────────────────────────────────────

/**
 * @param {object}  req
 * @param {string}  req.provider        chiave di PROVIDERS
 * @param {string}  req.model           id del modello
 * @param {string}  [req.apiKey]        non richiesta per ollama
 * @param {Array}   req.history         messaggi {role, content}; role "system" = memoria iniettata
 * @param {string}  [req.systemPrompt]  sovrascrive il prompt del companion
 * @param {boolean} [req.jsonMode=true] false per testo libero (es. riassunti di memoria)
 * @param {number}  [req.maxTokens=1024]
 * @returns {Promise<{reply: string, emotion?: string, action?: object, via?: string, raw?: string, retried?: boolean}>}
 */
async function route({ provider, model, apiKey, history, systemPrompt, jsonMode = true, maxTokens = 1024 }) {
  if (!provider || !PROVIDERS[provider]) throw new Error('Provider "' + provider + '" non supportato')
  if (!model || typeof model !== 'string') throw new Error('Modello non valido')
  const clean = sanitizeHistory(history)
  if (normalizeDialog(clean.filter(m => m.role !== 'system')).length === 0) throw new Error('History vuota o non valida')
  if (provider !== 'ollama' && (!apiKey || typeof apiKey !== 'string' || !apiKey.trim())) {
    throw new Error('Manca API key per ' + provider)
  }
  const expected = PROVIDERS[provider].keyPrefix
  if (expected && apiKey && !apiKey.startsWith(expected)) {
    console.warn('[router] key per ' + provider + ' non inizia con "' + expected + '" — procedo comunque')
  }

  const caps = provider === 'openrouter' ? await modelCaps(provider, model) : null
  const budget = requestBudget(provider, model, maxTokens, caps)
  const opts = { systemPrompt: systemPrompt || SYSTEM_PROMPT, jsonMode, caps, ...budget }

  switch (provider) {
    case 'claude':     return callClaude(apiKey, model, clean, opts)
    case 'openai':     return callOpenAI(apiKey, model, clean, opts)
    case 'grok':       return callGrok(apiKey, model, clean, opts)
    case 'gemini':     return callGemini(apiKey, model, clean, opts)
    case 'mistral':    return callMistral(apiKey, model, clean, opts)
    case 'ollama':     return callOllama(model, clean, opts)
    case 'openrouter': return callOpenRouter(apiKey, model, clean, opts)
    default:           throw new Error('Provider "' + provider + '" non supportato')
  }
}

module.exports = {
  route,
  prepare,
  normalizeDialog,
  requestBudget,
  describeError,
  listModels,
  parseOpenRouterModels,
  parseOllamaTags,
  capsFromParams,
  outputMode,
  openRouterBody,
  readChoice,
  modelCaps,
  openRouterUrl,
  DIRECTIONS,
  DISTANCES,
  PROVIDERS,
  ANIMATIONS,
  ACTION_TYPES,
  EMOTIONS,
  COMPANION_SCHEMA,
  SYSTEM_PROMPT,
  parseResponse,
  sanitizeHistory,
  fetchJSON,
}
