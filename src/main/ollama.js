// ollama.js — Ollama dall'app (Blocco 7a): avviare il server, accedere a
// ollama.com per i modelli cloud, scaricare un modello con l'avanzamento.
// Si esegue solo l'ollama.exe installato, con argomenti fissi.

const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

// Nome di un modello Ollama: "qwen3", "gpt-oss:120b-cloud", "utente/modello:tag".
const NAME_RE = /^[a-z0-9][a-z0-9._/-]{0,100}(:[a-z0-9._-]{1,60})?$/i
const SIGNIN_URL_RE = /https:\/\/ollama\.com\/[^\s"'<>]+/

function address() {
  return { host: process.env.OLLAMA_HOST || '127.0.0.1', port: parseInt(process.env.OLLAMA_PORT || '11434', 10) }
}

/** L'eseguibile: quello dell'installer di Ollama, altrimenti dal PATH. */
function exePath() {
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')
  return local && fs.existsSync(local) ? local : 'ollama'
}

function request(method, pathname, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { host, port } = address()
    const req = http.request({ host, port, path: pathname, method, timeout: timeoutMs,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, resolve)
    req.on('timeout', () => req.destroy(new Error('Timeout')))
    req.on('error', reject)
    req.end(body ? JSON.stringify(body) : undefined)
  })
}

async function running() {
  try { const res = await request('GET', '/api/version', null, 1500); res.resume(); return res.statusCode === 200 } catch (_) { return false }
}

/** Avvia "ollama serve" se non risponde gia', e aspetta che risponda (10 s). */
async function start() {
  if (await running()) return { ok: true, already: true }
  // I test simulano Ollama spento: non devono avviare quello vero.
  if (process.env.COMPANION_NO_OLLAMA_START === '1') return { ok: false, error: 'avvio spento' }
  const error = await new Promise((resolve) => {
    const child = spawn(exePath(), ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (e) => resolve(e))
    child.once('spawn', () => { child.unref(); resolve(null) })
  })
  if (error) return { ok: false, error: 'Ollama non e\' installato: scaricalo da ollama.com.' }
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await running()) return { ok: true }
  }
  return { ok: false, error: 'Ollama e\' partito ma non risponde ancora: riprova tra poco.' }
}

/**
 * "ollama signin": l'accesso si conferma nel browser, all'indirizzo che il
 * comando stampa. Torna l'indirizzo (lo apre il main), o already.
 */
function signin() {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (value) => { if (!done) { done = true; resolve(value) } }
    const child = spawn(exePath(), ['signin'], { windowsHide: true })
    const read = (chunk) => {
      out += chunk.toString()
      const url = out.match(SIGNIN_URL_RE)
      if (url) finish({ ok: true, url: url[0] })
      else if (/already signed in|signed in as/i.test(out)) finish({ ok: true, already: true, text: out.trim().slice(0, 200) })
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('error', () => finish({ ok: false, error: 'Ollama non e\' installato: scaricalo da ollama.com.' }))
    child.once('exit', () => finish(/signed in/i.test(out)
      ? { ok: true, already: true, text: out.trim().slice(0, 200) }
      : { ok: false, error: out.trim().slice(0, 200) || 'Accesso non riuscito.' }))
    // Il comando puo' restare ad aspettare la conferma: dopo 5 minuti basta.
    setTimeout(() => { try { child.kill() } catch (_) {} }, 5 * 60000).unref()
  })
}

/**
 * Scarica un modello, chiamando onProgress({ status, percent }) a ogni passo.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function pull(name, onProgress = () => {}) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: 'Nome del modello non valido.' }
  let res
  try { res = await request('POST', '/api/pull', { model: name, stream: true }, 0) } catch (_) {
    return { ok: false, error: 'Ollama non risponde: avvialo prima.' }
  }
  return new Promise((resolve) => {
    let buffer = ''
    let failed = null
    res.setEncoding('utf8')
    res.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let step = null
        try { step = JSON.parse(line) } catch (_) { continue }
        if (step.error) { failed = String(step.error).slice(0, 200); continue }
        const percent = step.total > 0 ? Math.round(100 * (step.completed || 0) / step.total) : null
        onProgress({ status: String(step.status || '').slice(0, 80), percent })
      }
    })
    res.on('end', () => resolve(failed || res.statusCode !== 200 ? { ok: false, error: failed || 'Ollama ha risposto ' + res.statusCode } : { ok: true }))
    res.on('error', (e) => resolve({ ok: false, error: e.message }))
  })
}

module.exports = { NAME_RE, exePath, running, start, signin, pull }
