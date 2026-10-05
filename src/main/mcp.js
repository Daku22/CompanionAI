// mcp.js — strumenti MCP (Blocco 7f): un client stdio scritto a mano (JSON-RPC
// 2.0, un messaggio per riga), senza l'SDK: servono solo initialize,
// tools/list e tools/call.
//
// Regole: i server li aggiunge l'utente nelle Impostazioni; gli strumenti si
// leggono con "Collega" e si salvano; al modello arrivano solo quelli spuntati;
// nessun server parte da solo: si avvia alla prima chiamata, che l'utente ha
// gia' confermato nel dialogo. Una chiamata per risposta, 30 s al massimo.

const { spawn } = require('child_process')
const { HttpMcpClient, validUrl } = require('./mcp-http')

const PROTOCOL_VERSION = '2025-06-18'
const MAX_SERVERS = 10
const MAX_TOOLS = 100
const MAX_RESULT = 4000
const MAX_ARGS_JSON = 4000
const START_TIMEOUT_MS = 60000   // la prima volta npx scarica il pacchetto
const CALL_TIMEOUT_MS = 30000

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const TOOL_RE = /^[A-Za-z0-9_.-]{1,64}$/
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, n)

// Strumenti che cambiano qualcosa (file, dati, messaggi): mai "senza chiedere".
const MODIFY_RE = /(write|edit|create|move|delete|remove|rename|update|insert|append|upload|send|post|set_|put_|patch)/i

/** Legge soltanto? Dalle annotazioni MCP se ci sono, altrimenti dal nome. */
function isReadOnly(t) {
  if (typeof t.readOnly === 'boolean') return t.readOnly
  const a = t.annotations && typeof t.annotations === 'object' ? t.annotations : {}
  if (a.readOnlyHint === true) return true
  if (a.readOnlyHint === false || a.destructiveHint === true) return false
  return !MODIFY_RE.test(t.name)
}

function cleanTool(t) {
  if (!t || typeof t !== 'object' || !TOOL_RE.test(t.name)) return null
  let schema = t.schema && typeof t.schema === 'object' ? t.schema : (t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' })
  if (JSON.stringify(schema).length > 4000) schema = { type: 'object' }
  return { name: t.name, description: clip(t.description, 300), schema, readOnly: isReadOnly(t) }
}

// Nomi in italiano per gli strumenti piu' comuni (il server dei file ufficiale),
// all'infinito: "Luma vuole leggere un file".
const TOOL_LABELS = {
  read_file: 'leggere un file', read_text_file: 'leggere un file di testo', read_media_file: 'aprire un\'immagine o un audio',
  read_multiple_files: 'leggere più file', write_file: 'scrivere un file', edit_file: 'modificare un file',
  create_directory: 'creare una cartella', list_directory: 'vedere cosa c\'è in una cartella',
  list_directory_with_sizes: 'vedere i file di una cartella con le dimensioni', directory_tree: 'vedere l\'albero delle cartelle',
  move_file: 'spostare o rinominare un file', search_files: 'cercare dei file', get_file_info: 'leggere i dettagli di un file',
  list_allowed_directories: 'vedere quali cartelle può usare',
}

/** Il nome da mostrare: italiano se conosciuto, altrimenti "read_text_file" -> "Read text file". */
function toolLabel(name) {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name]
  const words = String(name).replace(/[_.-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const knownLabel = (name) => !!TOOL_LABELS[name]

/** Gli argomenti come righe leggibili ("path: C:\\...\\spesa.txt"), non JSON. */
function argsText(args) {
  const lines = Object.entries(args || {}).map(([k, v]) => k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)))
  const text = lines.join('\n') || '(nessun argomento)'
  return text.length > 1500 ? text.slice(0, 1500) + '…' : text
}

/** Lo strumento pronto "File di una cartella": il server dei file ufficiale. */
function filesServer(folder) {
  const base = String(folder).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder
  return { name: 'File: ' + base, command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', folder] }
}

/**
 * I server dalla config o dal renderer, controllati. Gli id diventano chiavi
 * di prompt e azione, quindi solo minuscole, cifre e trattini.
 */
function cleanServers(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const s of input) {
    if (!s || typeof s !== 'object' || !ID_RE.test(s.id) || out.some(o => o.id === s.id)) continue
    // Remoto (un URL, Blocco 7f: i connettori) o sul PC (un comando).
    const url = typeof s.url === 'string' && validUrl(s.url.trim()) ? s.url.trim().slice(0, 500) : ''
    const command = url ? '' : clip(s.command, 300)
    if (!url && !command) continue
    const tools = (Array.isArray(s.tools) ? s.tools : []).map(cleanTool).filter(Boolean).slice(0, MAX_TOOLS)
    const env = {}
    if (s.env && typeof s.env === 'object') {
      for (const [k, v] of Object.entries(s.env)) if (ENV_RE.test(k) && typeof v === 'string' && Object.keys(env).length < 30) env[k] = v.slice(0, 1000)
    }
    out.push({
      id: s.id,
      name: clip(s.name, 40) || s.id,
      url,
      // Come si accede a un connettore remoto: nessun accesso, login OAuth o token (i segreti stanno altrove, cifrati).
      auth: url ? (['oauth', 'token'].includes(s.auth) ? s.auth : 'none') : 'none',
      command,
      args: (Array.isArray(s.args) ? s.args : []).filter(a => typeof a === 'string').map(a => a.slice(0, 500)).slice(0, 30),
      env,
      enabled: s.enabled === true,
      tools,
      allowed: (Array.isArray(s.allowed) ? s.allowed : []).filter(n => tools.some(t => t.name === n)),
      // "Non chiedere piu'": solo strumenti ammessi che leggono soltanto.
      trusted: (Array.isArray(s.trusted) ? s.trusted : []).filter(n =>
        (Array.isArray(s.allowed) ? s.allowed : []).includes(n) && tools.some(t => t.name === n && t.readOnly)),
    })
    if (out.length >= MAX_SERVERS) break
  }
  return out
}

/** Gli strumenti che il modello puo' proporre: server accesi, strumenti spuntati. */
function allowedTools(servers) {
  const out = []
  for (const s of servers || []) {
    if (!s.enabled) continue
    for (const t of s.tools) if (s.allowed.includes(t.name)) out.push({ server: s.id, serverName: s.name, ...t })
  }
  return out
}

/** Gli argomenti di uno schema, in breve: "path (string, obbligatorio), depth (integer)". */
function argsSummary(schema) {
  const props = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const required = Array.isArray(schema && schema.required) ? schema.required : []
  const parts = Object.entries(props).slice(0, 12).map(([k, v]) =>
    k + ' (' + (v && v.type ? v.type : 'qualsiasi') + (required.includes(k) ? ', obbligatorio' : '') +
    (v && Array.isArray(v.enum) ? ', uno tra: ' + v.enum.slice(0, 10).map(e => JSON.stringify(e)).join(' ') : '') + ')')
  return parts.length ? parts.join(', ') : 'nessuno'
}

/** La parte di prompt sugli strumenti, o '' se non ce ne sono. */
function toolsPrompt(servers) {
  const tools = allowedTools(servers)
  if (!tools.length) return ''
  return `

Strumenti esterni (MCP): se per rispondere ti serve uno di questi strumenti,
metti in "action" type "tool", "server", "tool" e "args" (un oggetto con gli
argomenti), animation "think", e nel "reply" di' in breve cosa stai per fare.
L'utente deve approvare ogni chiamata; dopo ricevi il risultato e puoi
rispondere, o chiamare un altro strumento se serve un secondo passo.
Un solo strumento per risposta. Usa i nomi esatti di server e tool, metti
tutti gli argomenti obbligatori e, dove c'e' un elenco, solo quei valori.
Se un risultato contiene un link che l'utente vuole aprire, usa open-url.
` + tools.map(t => `- server "${t.server}", tool "${t.name}": ${t.description || '(senza descrizione)'} Argomenti: ${argsSummary(t.schema)}.`).join('\n')
}

const TYPE_OK = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  array: v => Array.isArray(v),
  object: v => !!v && typeof v === 'object' && !Array.isArray(v),
}

/**
 * L'azione "tool" proposta dal modello, controllata contro gli strumenti
 * ammessi e il loro schema (campi obbligatori e tipi del primo livello).
 * @returns {{ server: object, tool: object, args: object } | { error: string }}
 */
function checkToolAction(action, servers) {
  if (!action || action.type !== 'tool') return { error: 'non e\' un\'azione strumento' }
  // I modelli piccoli sbagliano spesso il server: se lo strumento c'e' in un
  // server solo, vale quello.
  const owners = (servers || []).filter(s => s.enabled && s.allowed.includes(action.tool))
  const server = (servers || []).find(s => s.id === action.server && s.enabled) || (owners.length === 1 ? owners[0] : null)
  if (!server) return { error: 'server non ammesso: ' + clip(action.server, 60) }
  const tool = server.tools.find(t => t.name === action.tool && server.allowed.includes(t.name))
  if (!tool) return { error: 'strumento non ammesso: ' + clip(action.tool, 64) }
  const args = action.args === undefined ? {} : action.args
  if (!TYPE_OK.object(args)) return { error: 'argomenti non validi' }
  if (JSON.stringify(args).length > MAX_ARGS_JSON) return { error: 'argomenti troppo lunghi' }
  const props = (tool.schema && tool.schema.properties) || {}
  for (const name of Array.isArray(tool.schema && tool.schema.required) ? tool.schema.required : []) {
    if (!(name in args)) return { error: 'manca l\'argomento ' + clip(name, 60) }
  }
  for (const [name, value] of Object.entries(args)) {
    const type = props[name] && props[name].type
    if (typeof type === 'string' && TYPE_OK[type] && !TYPE_OK[type](value)) return { error: 'argomento ' + clip(name, 60) + ' di tipo sbagliato' }
  }
  return { server, tool, args }
}

/** Il risultato di tools/call come testo, tagliato. */
function resultText(result) {
  const items = result && Array.isArray(result.content) ? result.content : []
  const text = items.map(c => (c && c.type === 'text' ? String(c.text || '') : '[contenuto ' + clip(c && c.type, 20) + ']')).join('\n').trim()
  const out = (result && result.isError ? 'ERRORE: ' : '') + (text || '(nessun risultato)')
  return out.length > MAX_RESULT ? out.slice(0, MAX_RESULT) + '…' : out
}

/** Il messaggio con il risultato, per il secondo giro del modello. */
function resultPrompt(serverId, toolName, text) {
  return `[Risultato dello strumento "${toolName}" (server "${serverId}"), approvato dall'utente:]\n${text}\n` +
    '[Ora rispondi all\'utente usando questo risultato. Se gli argomenti erano sbagliati puoi riprovare correggendoli; se serve un altro passo, chiama un altro strumento.]'
}

/** La chiamata non e' partita: il modello la corregge o risponde. */
function errorPrompt(error) {
  return '[La chiamata allo strumento non e\' partita: ' + clip(error, 200) + '. Correggila (server, tool e argomenti come nell\'elenco) oppure rispondi all\'utente.]'
}

// ─── Client stdio ────────────────────────────────────────────────────────────

/** Su Windows npx, npm e gli script .cmd partono solo dentro cmd.exe. */
function needsShell(command) {
  return process.platform === 'win32' && !/\.exe$/i.test(command)
}
const quote = (a) => (/[\s"&|<>^()]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a)

class McpClient {
  constructor(server) {
    this.server = server
    this.proc = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.ready = null
  }

  start() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      const { command, args, env } = this.server
      const shell = needsShell(command)
      this.shell = shell
      this.proc = spawn(shell ? [command, ...args].map(quote).join(' ') : command, shell ? [] : args, {
        env: { ...process.env, ...env }, windowsHide: true, shell, stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk) => this._read(chunk))
      this.proc.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-600) })
      const failAll = (why) => {
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)) }
        this.pending.clear()
        this.ready = null
        this.proc = null
      }
      this.proc.once('error', (e) => failAll('il server non parte: ' + e.message))
      this.proc.once('exit', (code) => failAll('il server si e\' chiuso (codice ' + code + ')' + (this.stderr ? ': ' + this.stderr.trim().slice(-300) : '')))
      await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'CompanionAI', version: '1.1.0' },
      }, START_TIMEOUT_MS)
      this._send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })()
    this.ready.catch(() => { this.stop() })
    return this.ready
  }

  _send(message) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(message) + '\n')
  }

  _read(chunk) {
    this.buffer += chunk
    let nl
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch (_) { continue }
      if (msg && msg.id !== undefined && this.pending.has(msg.id) && ('result' in msg || 'error' in msg)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(clip(msg.error.message || 'errore del server', 300)))
        else p.resolve(msg.result)
      } else if (msg && msg.method && msg.id !== undefined) {
        // Richieste del server al client: solo ping ha risposta, il resto non e' supportato.
        this._send(msg.method === 'ping' ? { jsonrpc: '2.0', id: msg.id, result: {} }
          : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'non supportato' } })
      }
    }
  }

  request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('il server non e\' avviato'))
      const id = this.nextId++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('il server non ha risposto in ' + Math.round(timeoutMs / 1000) + ' s')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this._send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async listTools() {
    await this.start()
    const tools = []
    let cursor
    for (let page = 0; page < 10; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {})
      tools.push(...(Array.isArray(r && r.tools) ? r.tools : []))
      if (!r || !r.nextCursor) break
      cursor = r.nextCursor
    }
    return tools.map(cleanTool).filter(Boolean).slice(0, MAX_TOOLS)
  }

  async callTool(name, args) {
    await this.start()
    return this.request('tools/call', { name, arguments: args }, CALL_TIMEOUT_MS)
  }

  stop() {
    const proc = this.proc
    this.proc = null
    this.ready = null
    if (!proc) return
    try { proc.stdin.end() } catch (_) {}
    // Dentro cmd.exe il server e' un processo figlio: si chiude tutto l'albero.
    if (this.shell && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
    else { try { proc.kill() } catch (_) {} }
  }
}

// I client restano accesi fino all'uscita dall'app, o finche' il server cambia.
const clients = new Map()
const launchKey = (s) => JSON.stringify([s.url, s.command, s.args, s.env])
/**
 * Il client di un server, riusato finche' non cambia. Per i connettori remoti
 * token() da' il token di accesso del momento (lo gestisce il main).
 */
function clientFor(server, token) {
  const known = clients.get(server.id)
  if (known && launchKey(known.server) === launchKey(server)) return known
  if (known) known.stop()
  const client = server.url ? new HttpMcpClient(server, { token }) : new McpClient(server)
  clients.set(server.id, client)
  return client
}
function stopAll() {
  for (const c of clients.values()) c.stop()
  clients.clear()
}

/** Gli strumenti di un server, puliti, qualunque sia il client. */
async function listTools(client) {
  return (await client.listTools()).map(cleanTool).filter(Boolean).slice(0, MAX_TOOLS)
}

module.exports = {
  listTools, MAX_RESULT, toolLabel, knownLabel, argsText, filesServer, cleanServers, allowedTools, toolsPrompt, checkToolAction, resultText, resultPrompt, errorPrompt,
  McpClient, clientFor, stopAll,
}
