// mcp-http.js — connettori remoti (Blocco 7f): il client MCP su HTTP
// ("Streamable HTTP"). Ogni messaggio JSON-RPC e' un POST all'URL del server;
// la risposta arriva come JSON o come flusso SSE ("data: {...}"). Il server
// puo' dare un Mcp-Session-Id all'inizializzazione, da rimandare dopo.
//
// L'accesso lo gestisce chi lo usa (main.js, mcp-oauth.js): qui arriva solo il
// token da mettere nell'intestazione, e un 401 diventa AuthRequiredError.

const PROTOCOL_VERSION = '2025-06-18'
const START_TIMEOUT_MS = 30000
const CALL_TIMEOUT_MS = 30000
const MAX_BODY = 4 * 1024 * 1024

class AuthRequiredError extends Error {
  /** @param {string} wwwAuthenticate l'intestazione del 401, per trovare dove accedere */
  constructor(wwwAuthenticate) {
    super('serve l\'accesso')
    this.authRequired = true
    this.wwwAuthenticate = wwwAuthenticate || ''
  }
}

/** I messaggi JSON di un flusso SSE: le righe "data:" di ogni evento, unite. */
function parseSse(text) {
  const out = []
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
    if (!data) continue
    try { out.push(JSON.parse(data)) } catch (_) {}
  }
  return out
}

/** Indirizzo accettato: https, oppure http solo su questo PC (prove e server locali). */
function validUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))
  } catch (_) { return false }
}

class HttpMcpClient {
  /**
   * @param {{ url: string }} server
   * @param {{ token?: () => (string | null) }} [auth] il token di accesso, se c'e'
   */
  constructor(server, auth = {}) {
    this.server = server
    this.auth = auth
    this.sessionId = null
    this.nextId = 1
    this.ready = null
  }

  headers(initialized) {
    const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (initialized) h['mcp-protocol-version'] = PROTOCOL_VERSION
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    const token = this.auth.token ? this.auth.token() : null
    if (token) h.authorization = 'Bearer ' + token
    return h
  }

  async post(message, timeoutMs, initialized = true) {
    let res
    try {
      res = await fetch(this.server.url, { method: 'POST', headers: this.headers(initialized), body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new Error('il server non ha risposto in ' + Math.round(timeoutMs / 1000) + ' s')
      throw new Error('server non raggiungibile' + (e && e.cause && e.cause.code ? ' (' + e.cause.code + ')' : ''))
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {})
      throw new AuthRequiredError(res.headers.get('www-authenticate'))
    }
    const session = res.headers.get('mcp-session-id')
    if (session) this.sessionId = session
    if (message.id === undefined) { await res.body?.cancel().catch(() => {}); return null }   // notifica: niente da leggere
    if (res.status === 404 && this.sessionId && initialized) { this.ready = null; this.sessionId = null; throw new Error('sessione scaduta: riprova') }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
      throw new Error('il server ha risposto ' + res.status + (text ? ': ' + text : ''))
    }
    const type = res.headers.get('content-type') || ''
    const text = await res.text()
    if (text.length > MAX_BODY) throw new Error('risposta troppo grande')
    const messages = /text\/event-stream/i.test(type) ? parseSse(text) : (() => { try { return [JSON.parse(text)] } catch (_) { return [] } })()
    const reply = messages.find(m => m && m.id === message.id && ('result' in m || 'error' in m))
    if (!reply) throw new Error('il server non ha mandato una risposta valida')
    if (reply.error) throw new Error(String(reply.error.message || 'errore del server').slice(0, 300))
    return reply.result
  }

  start() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      this.sessionId = null
      await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: {
        protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'CompanionAI', version: '1.1.0' },
      } }, START_TIMEOUT_MS, false)
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, START_TIMEOUT_MS)
    })()
    this.ready.catch(() => { this.ready = null })
    return this.ready
  }

  request(method, params, timeoutMs = CALL_TIMEOUT_MS) {
    return this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, timeoutMs)
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
    return tools
  }

  async callTool(name, args) {
    await this.start()
    return this.request('tools/call', { name, arguments: args }, CALL_TIMEOUT_MS)
  }

  /** Chiude la sessione sul server, se ce n'e' una (senza aspettare). */
  stop() {
    const headers = this.sessionId ? this.headers(true) : null
    this.sessionId = null
    this.ready = null
    if (headers) fetch(this.server.url, { method: 'DELETE', headers, signal: AbortSignal.timeout(3000) }).catch(() => {})
  }
}

module.exports = { HttpMcpClient, AuthRequiredError, parseSse, validUrl }
