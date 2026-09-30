// xtts-engine.js — la voce XTTS-v2, lato main.
//
// Avvia xtts_service.py con il Python installato da xtts-setup.js, aspetta la
// riga "XTTS_SERVICE_READY" con la porta e parla con lui in HTTP su
// 127.0.0.1, con un token casuale che conosce solo questo processo. Il modello
// resta caricato sulla GPU finche' la voce XTTS e' accesa: caricarlo richiede
// decine di secondi, troppo per farlo a ogni risposta.
//
// L'audio arriva a pezzi mentre il modello genera (vedi xtts_service.py):
// ogni pezzo va subito al companion, e la prima parola si sente prima che la
// frase sia finita.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const READY_PREFIX = 'XTTS_SERVICE_READY '
const START_TIMEOUT_MS = 4 * 60 * 1000
const STDERR_KEEP = 40

/**
 * Lettore dei pezzi di /tts: [uint32 LE byte][float32 LE ...], 0 byte = fine.
 * push() restituisce i pezzi completi arrivati finora; done diventa true al
 * pezzo di chiusura.
 */
function createFrameReader() {
  let pending = Buffer.alloc(0)
  const reader = {
    done: false,
    /** @param {Uint8Array} bytes @returns {Float32Array[]} */
    push(bytes) {
      pending = pending.length ? Buffer.concat([pending, Buffer.from(bytes)]) : Buffer.from(bytes)
      const out = []
      while (!reader.done && pending.length >= 4) {
        const size = pending.readUInt32LE(0)
        if (size === 0) { reader.done = true; pending = pending.subarray(4); break }
        if (size % 4 !== 0) throw new Error('pezzo di audio non valido (' + size + ' byte)')
        if (pending.length < 4 + size) break
        const copy = new Float32Array(size / 4)
        Buffer.from(copy.buffer).set(pending.subarray(4, 4 + size))
        out.push(copy)
        pending = pending.subarray(4 + size)
      }
      return out
    },
  }
  return reader
}

class XttsEngine {
  /**
   * @param {{ root: string, samplesDir: string, onState?: (s: any) => void, fetchImpl?: typeof fetch }} opts
   *   root: la cartella di xtts-setup.js (env/, model/, app/)
   */
  constructor({ root, samplesDir, onState, fetchImpl }) {
    this.root = root
    this.samplesDir = samplesDir
    this.onState = onState || (() => {})
    this.fetch = fetchImpl || fetch
    this.proc = null
    this.port = null
    this.token = null
    this.state = 'off'       // off | loading | ready | error
    this.error = null
    this.info = null         // { device, gpu, seconds }
    this.starting = null
    this.stderr = []
  }

  python() { return path.join(this.root, 'env', 'Scripts', 'python.exe') }
  script() { return path.join(this.root, 'app', 'xtts_service.py') }

  _set(state, error = null) {
    this.state = state
    this.error = error
    try { this.onState({ state, error, info: this.info }) } catch (_) { /* finestra chiusa */ }
  }

  /** Avvia il servizio (una volta) e aspetta che sia pronto. */
  start() {
    if (this.state === 'ready' && this.proc) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise((resolve, reject) => {
      // Lo script sta nel pacchetto dell'app (asar), che Python non legge:
      // se ne tiene una copia accanto all'ambiente.
      fs.mkdirSync(path.dirname(this.script()), { recursive: true })
      const source = fs.readFileSync(path.join(__dirname, 'xtts', 'xtts_service.py'))
      if (!fs.existsSync(this.script()) || !fs.readFileSync(this.script()).equals(source)) fs.writeFileSync(this.script(), source)
      fs.mkdirSync(this.samplesDir, { recursive: true })

      this.token = crypto.randomBytes(24).toString('hex')
      this.stderr = []
      this._set('loading')
      const proc = spawn(this.python(), ['-u', this.script(), path.join(this.root, 'model'), this.samplesDir], {
        env: { ...process.env, XTTS_TOKEN: this.token, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', COQUI_TOS_AGREED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proc = proc
      let settled = false
      const fail = (message) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.starting = null
        this._set('error', message)
        this.stop()
        reject(new Error(message))
      }
      const timer = setTimeout(() => fail('il servizio XTTS non e\' partito in tempo'), START_TIMEOUT_MS)
      let out = ''
      proc.stdout.on('data', (d) => {
        out += String(d)
        const line = out.split(/\r?\n/).find(l => l.startsWith(READY_PREFIX))
        if (!line || settled) return
        try {
          const info = JSON.parse(line.slice(READY_PREFIX.length))
          this.port = info.port
          this.info = { device: info.device, gpu: info.gpu, seconds: info.seconds }
        } catch (_) { return fail('risposta del servizio XTTS non valida') }
        settled = true
        clearTimeout(timer)
        this.starting = null
        this._set('ready')
        resolve()
      })
      proc.stderr.on('data', (d) => {
        for (const l of String(d).split(/\r?\n/).filter(Boolean)) {
          this.stderr.push(l)
          if (this.stderr.length > STDERR_KEEP) this.stderr.shift()
        }
      })
      proc.on('error', (e) => fail('Python non si avvia: ' + e.message))
      proc.on('exit', (code) => {
        if (this.proc !== proc) return
        this.proc = null
        this.port = null
        const last = this.stderr.filter(l => /Error|error|Exception/.test(l)).slice(-1)[0]
        if (!settled) fail('il servizio XTTS si e\' chiuso (' + code + ')' + (last ? ': ' + last : ''))
        else if (this.state !== 'off') this._set('error', 'il servizio XTTS si e\' chiuso (' + code + ')' + (last ? ': ' + last : ''))
      })
    })
    return this.starting
  }

  /**
   * Spegne il servizio. La promessa si risolve quando il processo e' uscito
   * davvero (al massimo 10 s): prima, su Windows, i suoi file restano
   * bloccati e la disinstallazione non li cancellerebbe.
   */
  stop() {
    const proc = this.proc
    this.proc = null
    this.port = null
    this.starting = null
    if (this.state !== 'error') this._set('off')
    if (!proc || proc.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 10000)
      proc.once('exit', () => { clearTimeout(timer); resolve() })
      try { proc.stdin.end() } catch (_) { /* gia' chiuso */ }
      try { proc.kill() } catch (_) { /* gia' uscito */ }
    })
  }

  async _request(method, route, body, signal) {
    const res = await this.fetch('http://127.0.0.1:' + this.port + route, {
      method,
      headers: { 'X-Token': this.token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!res.ok) {
      let message = 'errore ' + res.status
      try { message = (await res.json()).error || message } catch (_) { /* non JSON */ }
      throw new Error('XTTS: ' + message)
    }
    return res
  }

  /** Le voci incluse nel modello (58, con nomi come "Ana Florence"). */
  async speakers() {
    await this.start()
    return (await (await this._request('GET', '/speakers')).json()).speakers || []
  }

  /** Converte un campione scelto dall'utente e ne prepara i latenti. */
  async prepareSample(src, dst) {
    await this.start()
    return (await this._request('POST', '/prepare', { src, dst })).json()
  }

  /**
   * Sintetizza una frase: onAudio(pcm, rate) a ogni pezzo, in ordine.
   * @param {string} text
   * @param {{ speaker: { sample?: string, builtin?: string }, speed?: number, signal?: AbortSignal }} opts
   * @param {(pcm: Float32Array, rate: number) => void} onAudio
   */
  async synth(text, opts, onAudio) {
    await this.start()
    const res = await this._request('POST', '/tts', { text, language: 'it', speaker: opts.speaker, speed: opts.speed || 1 }, opts.signal)
    const rate = Number(res.headers.get('x-sample-rate')) || 24000
    const reader = createFrameReader()
    for await (const bytes of res.body) {
      for (const pcm of reader.push(bytes)) onAudio(pcm, rate)
      if (reader.done) break
    }
    if (!reader.done) throw new Error('XTTS: frase interrotta')
  }
}

module.exports = { XttsEngine, createFrameReader, READY_PREFIX }
