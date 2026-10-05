// kimodo-service.js — Kimodo in locale per le animazioni chieste in chat.
//
// Quando l'utente chiede un movimento che l'avatar non conosce ("fai una
// capriola"), il modello lo descrive in inglese nel campo action.motion e qui
// kimodo.cpp lo genera sulla scheda video. Il server (kmd-generate --server)
// parte alla prima richiesta, tiene il modello caricato fra una richiesta e
// l'altra e si chiude dopo IDLE_MS senza richieste, per liberare la memoria
// video (circa 2,4 GB).
//
// Il main restituisce l'uscita grezza (bacino e rotazioni dello scheletro
// SOMA a 30 ossa): la conversione in .vrma la fa il renderer, che ha three
// (kimodo-raw.js, motion-retarget.js), e il .vrma torna qui per la cache.
// Una frase gia' generata si riprende dalla cache senza scheda video.
//
// kimodo.cpp e i pesi non fanno parte dell'app: si installano a parte in
// %USERPROFILE%\kimodo (docs/kimodo-locale.md), o nella cartella scritta a
// mano in config.json come "kimodoDir". Il percorso non arriva mai dal
// renderer: da li' si potrebbe far partire un eseguibile qualsiasi.

const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { writeAtomic } = require('./write-atomic')

const KIMODO_FPS = 30
const JOINTS = 30
const IDLE_MS = 5 * 60 * 1000
// Il primo avvio carica 5,5 GB di pesi: sul PC di prova 30 s, su un disco
// lento molto di piu'.
const FIRST_TIMEOUT_MS = 4 * 60 * 1000
const TIMEOUT_MS = 2 * 60 * 1000
const STEPS = 100
const TRANSITION = 5
const MAX_CACHE = 100
const MAX_PROMPT = 200
const KEY_RE = /^[a-f0-9]{32}\.vrma$/
const INDEX_FILE = 'index.json'
// I nomi dati dall'utente (Blocco 7d), accanto all'indice delle frasi.
const NAMES_FILE = 'names.json'
const MAX_NAME = 60

/**
 * La descrizione del movimento proposta dal modello, ripulita: una riga di
 * testo stampabile, non troppo lunga. null se non c'e' niente da generare.
 * @param {unknown} text
 * @returns {string | null}
 */
function motionPrompt(text) {
  if (typeof text !== 'string') return null
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT)
  return /[a-z]{3}/i.test(clean) ? clean : null
}

/** Nome del file in cache per una frase e una durata. */
function cacheKey(prompt, seconds) {
  const normal = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return crypto.createHash('sha256').update(normal + '|' + seconds).digest('hex').slice(0, 32) + '.vrma'
}

class KimodoService {
  /**
   * @param {{ dir: string, cacheDir: string, idleMs?: number, timeoutMs?: number,
   *           firstTimeoutMs?: number, spawn?: typeof childProcess.spawn }} options
   */
  constructor({ dir, cacheDir, idleMs = IDLE_MS, timeoutMs = TIMEOUT_MS, firstTimeoutMs = FIRST_TIMEOUT_MS, spawn = childProcess.spawn }) {
    this.dir = dir
    this.cacheDir = cacheDir
    this.idleMs = idleMs
    this.timeoutMs = timeoutMs
    this.firstTimeoutMs = firstTimeoutMs
    this.spawn = spawn
    this.proc = null
    this.ready = false        // il server ha gia' risposto una volta
    this.pending = null       // { resolve, reject, timer }
    /** @type {Promise<any>} */
    this.queue = Promise.resolve()
    this.idleTimer = null
  }

  get paths() {
    const build = path.join(this.dir, 'build', 'release')
    return {
      exe: path.join(build, 'kmd-generate.exe'),
      bin: path.join(build, 'bin'),
      motion: path.join(this.dir, 'weights', 'models', 'kimodo-soma-rp-v1.1-f32.gguf'),
      text: path.join(this.dir, 'weights', 'Llama-3-Kimodo-Q4_K.gguf'),
    }
  }

  /** File mancanti per usare Kimodo: vuoto se e' tutto installato. */
  missing() {
    const p = this.paths
    return [p.exe, p.motion, p.text].filter(f => !fs.existsSync(f))
  }

  available() { return this.missing().length === 0 }

  /** Nome del file in cache, se la frase e' gia' stata generata. */
  cached(prompt, seconds) {
    const key = cacheKey(prompt, seconds)
    return fs.existsSync(path.join(this.cacheDir, key)) ? key : null
  }

  /** Percorso di un file della cache, per il protocollo motion://. */
  resolve(key) {
    if (!KEY_RE.test(key)) return null
    const full = path.join(this.cacheDir, key)
    return fs.existsSync(full) ? full : null
  }

  /**
   * Salva in cache il .vrma convertito dal renderer. Oltre MAX_CACHE file si
   * tolgono i piu' vecchi. La frase va in un indice accanto: dal nome del
   * file (un hash) non si risale, e il menu "Prova" la mostra.
   * @param {string} key
   * @param {Uint8Array} data
   * @param {string} [prompt]
   */
  async store(key, data, prompt) {
    if (!KEY_RE.test(key)) throw new Error('nome di cache non valido')
    await fs.promises.mkdir(this.cacheDir, { recursive: true })
    await writeAtomic(path.join(this.cacheDir, key), Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    const files = (await fs.promises.readdir(this.cacheDir)).filter(f => KEY_RE.test(f))
    let removed = []
    if (files.length > MAX_CACHE) {
      const dated = await Promise.all(files.map(async f => ({ f, t: (await fs.promises.stat(path.join(this.cacheDir, f))).mtimeMs })))
      dated.sort((a, b) => a.t - b.t)
      removed = dated.slice(0, dated.length - MAX_CACHE).map(d => d.f)
      for (const f of removed) await fs.promises.rm(path.join(this.cacheDir, f), { force: true })
    }
    if (typeof prompt !== 'string' && !removed.length) return
    const index = this.readIndex()
    if (typeof prompt === 'string') index[key] = prompt.slice(0, MAX_PROMPT)
    for (const f of removed) delete index[f]
    await writeAtomic(path.join(this.cacheDir, INDEX_FILE), JSON.stringify(index))
  }

  /** @returns {Record<string, string>} chiave -> frase */
  readIndex() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.cacheDir, INDEX_FILE), 'utf8'))
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (_) { return {} }
  }

  /** @returns {Record<string, string>} chiave -> nome dato dall'utente */
  readNames() {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.cacheDir, NAMES_FILE), 'utf8'))
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (_) { return {} }
  }

  /** Dà un nome a un movimento; vuoto lo toglie. false se non esiste. */
  async rename(key, name) {
    if (!this.resolve(key)) return false
    const names = this.readNames()
    const clean = String(name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    if (clean) names[key] = clean
    else delete names[key]
    await writeAtomic(path.join(this.cacheDir, NAMES_FILE), JSON.stringify(names))
    return true
  }

  /** Elimina un movimento: il file, la frase e il nome. false se non esiste. */
  async remove(key) {
    const full = this.resolve(key)
    if (!full) return false
    await fs.promises.rm(full, { force: true })
    const index = this.readIndex()
    const names = this.readNames()
    if (key in index) { delete index[key]; await writeAtomic(path.join(this.cacheDir, INDEX_FILE), JSON.stringify(index)) }
    if (key in names) { delete names[key]; await writeAtomic(path.join(this.cacheDir, NAMES_FILE), JSON.stringify(names)) }
    return true
  }

  /**
   * I movimenti in cache, dal piu' recente. prompt e' null per quelli salvati
   * prima dell'indice; name e' null se l'utente non gliene ha dato uno.
   * @returns {Promise<{ key: string, prompt: string | null, name: string | null, time: number }[]>}
   */
  async list() {
    let files = []
    try { files = (await fs.promises.readdir(this.cacheDir)).filter(f => KEY_RE.test(f)) } catch (_) { return [] }
    const index = this.readIndex()
    const names = this.readNames()
    const out = await Promise.all(files.map(async key => ({
      key,
      prompt: typeof index[key] === 'string' ? index[key] : null,
      name: typeof names[key] === 'string' ? names[key] : null,
      time: (await fs.promises.stat(path.join(this.cacheDir, key))).mtimeMs,
    })))
    return out.sort((a, b) => b.time - a.time)
  }

  /**
   * Genera un movimento. Le richieste passano una alla volta, in ordine.
   * @param {string} prompt frase in inglese ("A person does a cartwheel.")
   * @param {{ seconds?: number, seed?: number }} [options]
   * @returns {Promise<{ rootPositions: Float32Array, rotations: Float32Array, frames: number }>}
   */
  generate(prompt, { seconds = 4, seed = 1 } = {}) {
    const run = () => this._generate(prompt, seconds, seed)
    const job = this.queue.then(run, run)
    this.queue = job.catch(() => {})
    return job
  }

  async _generate(prompt, seconds, seed) {
    this._clearIdle()
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-kimodo-'))
    try {
      const promptFile = path.join(work, 'prompt.txt')
      await fs.promises.writeFile(promptFile, prompt)
      const frames = Math.max(2, Math.min(300, Math.round(seconds * KIMODO_FPS)))
      // transizione, passi, seme, cartella, fotogrammi, file del prompt
      const reply = await this._request([TRANSITION, STEPS, seed, work, frames, promptFile].join('\t'))
      if (!reply.startsWith('OK')) throw new Error('Kimodo: ' + reply.replace(/^ERR\t/, ''))
      const read = async (name) => {
        const bytes = await fs.promises.readFile(path.join(work, name))
        return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      }
      const rootPositions = await read('root_positions.f32')
      const rotations = await read('local_rotations_xyzw.f32')
      const count = rootPositions.length / 3
      if (!Number.isInteger(count) || count < 2 || rotations.length !== count * JOINTS * 4) throw new Error('Kimodo: uscita non valida')
      return { rootPositions, rotations, frames: count }
    } finally {
      fs.promises.rm(work, { recursive: true, force: true }).catch(() => {})
      this._armIdle()
    }
  }

  _start() {
    const missing = this.missing()
    if (missing.length) throw new Error('Kimodo non trovato: manca ' + missing[0])
    const p = this.paths
    // Le DLL di ggml (Vulkan compreso) stanno in build/release/bin.
    const env = { ...process.env, PATH: p.bin + path.delimiter + (process.env.PATH || '') }
    const proc = this.spawn(p.exe, ['--server', p.motion, p.text], { cwd: this.dir, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    this.proc = proc
    this.ready = false
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      const pending = this.pending
      if (!pending) return
      this.pending = null
      clearTimeout(pending.timer)
      this.ready = true
      pending.resolve(line)
    })
    const gone = (reason) => {
      if (this.proc !== proc) return
      this.proc = null
      this.ready = false
      const pending = this.pending
      this.pending = null
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Kimodo si e\' chiuso: ' + reason)) }
    }
    proc.on('exit', (code) => gone('codice ' + code))
    proc.on('error', (error) => gone(error.message))
  }

  _request(line) {
    return new Promise((resolve, reject) => {
      try { if (!this.proc) this._start() } catch (error) { reject(error); return }
      const proc = this.proc
      const timer = setTimeout(() => {
        this.pending = null
        this._kill()
        reject(new Error('Kimodo non ha risposto in tempo'))
      }, this.ready ? this.timeoutMs : this.firstTimeoutMs)
      this.pending = { resolve, reject, timer }
      proc.stdin.write(line + '\n')
    })
  }

  _armIdle() {
    this._clearIdle()
    this.idleTimer = setTimeout(() => this.stop(), this.idleMs)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  _clearIdle() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  _kill() {
    const proc = this.proc
    this.proc = null
    this.ready = false
    if (proc) { try { proc.kill() } catch (_) {} }
  }

  /** Chiude il server: con stdin chiuso esce da solo; se no, lo si ferma. */
  stop() {
    this._clearIdle()
    const proc = this.proc
    if (!proc) return
    if (this.pending) return   // una generazione in corso finisce prima
    this.proc = null
    this.ready = false
    try { proc.stdin.end() } catch (_) {}
    const force = setTimeout(() => { try { proc.kill() } catch (_) {} }, 5000)
    if (force.unref) force.unref()
    proc.on('exit', () => clearTimeout(force))
  }
}

module.exports = { KimodoService, motionPrompt, cacheKey, KIMODO_FPS, MAX_PROMPT }
