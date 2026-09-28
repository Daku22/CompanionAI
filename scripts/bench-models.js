// bench-models.js — quanto ogni modello gratuito di OpenRouter rispetta il
// contratto del companion.
//
// Gli stessi messaggi vanno a ogni modello, senza modelli di scorta (route con
// fallback: false). Per ogni risposta si registra da che strada e' arrivata
// (schema, json, tool, prompt o fallback), l'azione, se era quella attesa e
// quanto ci ha messo. Serve a scegliere il modello predefinito con dei numeri:
// Laguna S 2.1, il predefinito di oggi, al test dal vivo del 27-09 rispondeva
// fuori formato in circa meta' dei messaggi.
//
// Gira dentro Electron per usare la chiave salvata dall'app: safeStorage la
// decifra con la "Local State" dell'app, copiata in una cartella temporanea
// (l'app puo' restare aperta). La chiave non viene mai stampata ne' scritta.
//
// I modelli gratuiti hanno un limite giornaliero comune: le chiamate si
// limitano con --max, i risultati gia' nel file si saltano, e si puo'
// riprendere il giorno dopo. Una chiamata costa una richiesta, due se il
// modello risponde fuori formato (il router ritenta una volta). I messaggi
// vanno a tutti i modelli prima di passare al successivo, cosi' anche una
// prova interrotta confronta i modelli sulle stesse domande.
//
// Uso:
//   npm run bench -- [--max 20] [--models id1,id2] [--out <file.json>] [--summary]

const { app, safeStorage } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { route, listModels, describeError, fetchJSON, openRouterUrl, SYSTEM_PROMPT, MOTION_PROMPT } = require('../src/main/ai-router')

const PROMPTS = [
  { id: 'destra', text: 'Cammina verso destra', ok: (r) => r.action?.animation === 'walk-to' && r.action?.direction === 'right' },
  { id: 'siediti', text: 'Siediti qui', ok: (r) => r.action?.animation === 'sit' },
  { id: 'saluto', text: 'Salutami con la mano!', ok: (r) => r.action?.animation === 'wave' },
  { id: 'sinistra', text: 'Corri verso sinistra, fino al bordo', ok: (r) => r.action?.animation === 'run-to' && r.action?.direction === 'left' },
  // Non e' fra le animazioni ne' fra gli esempi del prompt: deve arrivare come motion.
  { id: 'giravolta', text: 'Fai una giravolta su te stesso', ok: (r) => typeof r.action?.motion === 'string' && r.action.motion.trim().length > 0 },
  { id: 'umore', text: 'Oggi è stata una giornata pesante...', ok: (r) => !!r.emotion && r.emotion !== 'neutral' },
]
const PAUSE_MS = 3500   // i gratuiti accettano circa 20 richieste al minuto

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] }
const MAX = Number(opt('--max') || 20)
// Fuori dalla temp di sistema, che Windows puo' svuotare fra una sessione e l'altra.
const OUT = path.resolve(opt('--out') || path.join(app.getPath('appData'), 'CompanionAI', 'bench', 'openrouter.json'))
const ONLY = opt('--models')
const SUMMARY_ONLY = argv.includes('--summary')

// Prima di "ready": la chiave principale di safeStorage sta nella Local State
// della cartella dati. Una copia basta, e l'app vera resta intatta.
const appData = app.getPath('appData')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-bench-'))
const localState = path.join(appData, 'CompanionAI', 'Local State')
if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(scratch, 'Local State'))
app.setPath('userData', scratch)

function readKey() {
  const file = path.join(os.homedir(), '.desktop-companion', 'config.json')
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const stored = cfg.keys && cfg.keys.openrouter
  if (stored) {
    if (!cfg.keysEncrypted) return stored
    try { return safeStorage.decryptString(Buffer.from(stored, 'base64')) } catch (_) {}
  }
  return process.env.OPENROUTER_API_KEY || null
}

function load() {
  // Il BOM lo aggiungono il Blocco note e PowerShell 5, e JSON.parse lo rifiuta.
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8').replace(/^﻿/, '')) } catch (_) { return { results: [] } }
}

function save(data) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2))
}

async function freeModels() {
  const { models, live } = await listModels('openrouter')
  if (!live) throw new Error("l'elenco dal vivo di OpenRouter non risponde")
  if (ONLY) return ONLY.split(',').map(s => s.trim()).filter(Boolean)
  // Un classificatore di sicurezza non chiacchiera; senza nessun modo di
  // vincolare il formato resterebbe solo il prompt, gia' sappiamo come va.
  return models
    .filter(m => !/content-safety/i.test(m.id))
    .filter(m => {
      // L'elenco dal vivo porta le capacita' (parseOpenRouterModels), quello statico no.
      const caps = /** @type {any} */ (m).caps
      return caps && (caps.schema || caps.json || caps.tools)
    })
    .map(m => m.id)
}

function summary(data) {
  const rows = new Map()
  const unusable = new Set(data.results.filter(r => r.status === 403).map(r => r.model))
  for (const r of data.results) {
    if (unusable.has(r.model)) continue
    const row = rows.get(r.model) || { n: 0, format: 0, action: 0, ms: 0, errors: 0, via: {} }
    row.n++
    if (r.error) row.errors++
    else {
      if (r.via !== 'fallback') row.format++
      if (r.ok) row.action++
      row.ms += r.ms
      row.via[r.via] = (row.via[r.via] || 0) + 1
    }
    rows.set(r.model, row)
  }
  const sorted = [...rows.entries()].sort((a, b) => (b[1].action / b[1].n) - (a[1].action / a[1].n) || (b[1].format / b[1].n) - (a[1].format / a[1].n))
  console.log('\nmodello'.padEnd(52) + 'prove  formato  azione giusta  media   strade')
  for (const [model, row] of sorted) {
    const answered = row.n - row.errors
    const pct = (x) => (row.n ? Math.round(100 * x / row.n) : 0) + '%'
    const avg = answered ? (row.ms / answered / 1000).toFixed(1) + ' s' : '-'
    const via = Object.entries(row.via).map(([k, v]) => k + ' ' + v).join(', ') + (row.errors ? ', errori ' + row.errors : '')
    console.log(model.padEnd(51) + String(row.n).padStart(5) + pct(row.format).padStart(9) + pct(row.action).padStart(15) + avg.padStart(8) + '   ' + via)
  }
  if (unusable.size) console.log('non utilizzabili (403): ' + [...unusable].join(', '))
}

async function main() {
  const data = load()
  if (SUMMARY_ONLY) { summary(data); return 0 }

  const apiKey = readKey()
  if (!apiKey) {
    console.error('[bench] nessuna chiave OpenRouter leggibile: salvala dalla chat dell\'app, poi riprova')
    return 1
  }
  try {
    const info = await fetchJSON(openRouterUrl('/key'), { method: 'GET', headers: { Authorization: 'Bearer ' + apiKey } }, null)
    const d = info.body && info.body.data
    if (d) console.log('[bench] account OpenRouter: ' + (d.is_free_tier ? 'senza credito, limite giornaliero basso sui modelli gratuiti' : 'con credito'))
  } catch (_) {}

  const models = await freeModels()
  // 403: la chiave vale ma il modello non si puo' usare (Inkling), inutile
  // riprovarlo. Gli altri errori (fornitore occupato) si rifanno al giro dopo.
  const unusable = new Set(data.results.filter(r => r.status === 403).map(r => r.model))
  const done = new Set(data.results.filter(r => !r.error).map(r => r.model + '|' + r.prompt))
  const todo = []
  for (const p of PROMPTS) for (const m of models) if (!unusable.has(m) && !done.has(m + '|' + p.id)) todo.push({ model: m, prompt: p })
  console.log('[bench] ' + models.length + ' modelli (' + unusable.size + ' non utilizzabili), ' + todo.length + ' prove da fare, ' + Math.min(MAX, todo.length) + ' in questa sessione')

  let calls = 0
  for (const { model, prompt } of todo) {
    if (calls >= MAX) break
    calls++
    const started = Date.now()
    const entry = { model, prompt: prompt.id, at: new Date().toISOString() }
    try {
      // Niente scorta e niente tentativi in piu': ogni richiesta pesa sul limite.
      const r = await route({
        provider: 'openrouter', model, apiKey, fallback: false, retries: 0,
        systemPrompt: SYSTEM_PROMPT + MOTION_PROMPT,
        history: [{ role: 'user', content: prompt.text }],
      })
      Object.assign(entry, {
        ms: Date.now() - started, via: r.via, retried: !!r.retried, ok: r.via !== 'fallback' && prompt.ok(r),
        emotion: r.emotion || null, action: r.action || null, reply: String(r.reply || '').slice(0, 120),
      })
    } catch (err) {
      const message = describeError(err, 'openrouter')
      if (err && err.daily) {
        console.error('[bench] ' + message)
        break
      }
      Object.assign(entry, { ms: Date.now() - started, status: (err && err.status) || null, error: message.slice(0, 200) })
    }
    // Una prova rifatta prende il posto dell'errore di prima.
    data.results = data.results.filter(r => !(r.model === model && r.prompt === prompt.id))
    data.results.push(entry)
    save(data)
    console.log('  ' + (entry.error ? 'ERR ' : entry.ok ? 'ok  ' : 'no  ') + model + ' · ' + prompt.id + ' · ' + (entry.via || entry.error) + ' · ' + ((entry.ms || 0) / 1000).toFixed(1) + ' s')
    await new Promise(r => setTimeout(r, PAUSE_MS))
  }

  summary(data)
  console.log('\n[bench] risultati in ' + OUT)
  return 0
}

app.whenReady()
  .then(main)
  .catch((err) => { console.error('[bench]', err && err.message); return 1 })
  .then((code) => {
    // app.exit chiude subito: la copia della Local State si toglie prima.
    try { fs.rmSync(scratch, { recursive: true, force: true }) } catch (_) {}
    app.exit(code)
  })
