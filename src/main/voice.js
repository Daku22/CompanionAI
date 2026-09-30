// voice.js — la voce del companion, lato main.
//
// Dalla risposta del modello all'audio che suona nella finestra dell'avatar:
// il testo si pulisce e si divide in frasi (speech-text.js), un motore le
// sintetizza una alla volta e ogni frase va subito al companion, che la suona
// mentre qui si prepara la seguente. Una risposta nuova interrompe quella in
// corso.
//
// Il motore di base e' Kokoro, in un processo a parte (kokoro-worker.js),
// avviato alla prima frase e chiuso dopo qualche minuto di silenzio. I suoi
// file si scaricano dalle Impostazioni (voice-assets.js).

const { KOKORO_FILES, packStatus, downloadPack, removePack } = require('./voice-assets')
const { cleanForSpeech, splitSentences } = require('./speech-text')

const IDLE_STOP_MS = 5 * 60 * 1000
const SYNTH_TIMEOUT_MS = 60 * 1000
const LOAD_TIMEOUT_MS = 120 * 1000

/**
 * @typedef {{ send: (msg: any) => void, onMessage: (fn: (msg: any) => void) => void,
 *   onExit: (fn: (code: number) => void) => void, kill: () => void }} VoiceWorker
 */

class VoiceService {
  /**
   * @param {{ dir: string, spawn: () => VoiceWorker, play: (msg: any) => void,
   *   onStatus?: (status: any) => void, baseUrl?: string, idleMs?: number }} opts
   *   play: messaggi per il companion ({ type: 'chunk' | 'stop', ... })
   *   baseUrl: solo per i test, la fonte dei file
   */
  constructor({ dir, spawn, play, onStatus, baseUrl, idleMs }) {
    this.dir = dir
    this.spawn = spawn
    this.play = play
    this.onStatus = onStatus || (() => {})
    this.baseUrl = baseUrl
    this.idleMs = idleMs || IDLE_STOP_MS
    this.worker = null
    this.engine = 'off'          // off | loading | ready | error
    this.error = null
    this.downloading = null      // { done, total } mentre scarica
    this.abort = null
    this.pending = new Map()     // id -> { resolve, reject, timer }
    this.nextId = 1
    this.utterance = 0           // quella in corso; una nuova interrompe le vecchie
    this.idleTimer = null
  }

  status() {
    return { ...packStatus(this.dir, KOKORO_FILES), downloading: this.downloading, engine: this.engine, error: this.error }
  }

  _emit() { try { this.onStatus(this.status()) } catch (_) { /* la finestra puo' essere chiusa */ } }

  /** Scarica i file di Kokoro. Una volta sola alla volta. */
  async download() {
    if (this.downloading) return this.status()
    this.abort = new AbortController()
    this.downloading = { done: packStatus(this.dir, KOKORO_FILES).have, total: packStatus(this.dir, KOKORO_FILES).total }
    this.error = null
    this._emit()
    let last = 0
    try {
      await downloadPack(this.dir, KOKORO_FILES, {
        signal: this.abort.signal,
        baseUrl: this.baseUrl,
        onProgress: ({ done, total }) => {
          this.downloading = { done, total }
          // Non a ogni pezzo: bastano pochi aggiornamenti al secondo.
          const now = Date.now()
          if (now - last > 250 || done === total) { last = now; this._emit() }
        },
      })
    } catch (error) {
      this.error = this.abort.signal.aborted ? 'download annullato' : error.message
    } finally {
      this.downloading = null
      this.abort = null
      this._emit()
    }
    return this.status()
  }

  cancelDownload() { if (this.abort) this.abort.abort() }

  /** Toglie i file scaricati (e ferma il motore, che li sta usando). */
  async remove() {
    this.stop()
    this._stopWorker()
    this.cancelDownload()
    await removePack(this.dir, KOKORO_FILES)
    this.error = null
    this._emit()
    return this.status()
  }

  _startWorker() {
    if (this.worker) return
    const worker = this.spawn()
    this.worker = worker
    this.engine = 'loading'
    this._emit()
    worker.onMessage((msg) => this._onMessage(msg))
    worker.onExit((code) => {
      if (this.worker !== worker) return
      this.worker = null
      if (this.engine !== 'off') { this.engine = 'error'; this.error = 'il processo della voce si e\' chiuso (' + code + ')' }
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(this.error || 'voce chiusa')) }
      this.pending.clear()
      this._emit()
    })
  }

  _stopWorker() {
    clearTimeout(this.idleTimer)
    const worker = this.worker
    if (!worker) return
    this.engine = 'off'
    this.worker = null
    try { worker.kill() } catch (_) { /* gia' uscito */ }
    this._emit()
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.type === 'error') p.reject(new Error(msg.message || 'errore della voce'))
    else p.resolve(msg)
  }

  _ask(msg, timeoutMs) {
    this._startWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('la voce non ha risposto in tempo')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.send({ ...msg, id })
    })
  }

  async _ready() {
    if (this.engine === 'ready' && this.worker) return
    await this._ask({ type: 'load' }, LOAD_TIMEOUT_MS)
    this.engine = 'ready'
    this.error = null
    this._emit()
  }

  _touch() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this._stopWorker(), this.idleMs)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  /**
   * Pronuncia un testo. Restituisce false se non c'e' niente da dire o la
   * voce non e' installata; gli errori del motore finiscono nello stato.
   * @param {string} text
   * @param {{ voice?: string, speed?: number, volume?: number }} [opts] volume: 0..1, lo applica il companion
   */
  async speak(text, opts = {}) {
    const sentences = splitSentences(cleanForSpeech(text))
    if (!sentences.length) return false
    if (!packStatus(this.dir, KOKORO_FILES).installed) return false
    this.stop()
    const utterance = this.utterance
    try {
      await this._ready()
      for (let seq = 0; seq < sentences.length; seq++) {
        if (utterance !== this.utterance) return false
        const res = await this._ask({ type: 'synth', text: sentences[seq], voice: opts.voice, speed: opts.speed }, SYNTH_TIMEOUT_MS)
        if (utterance !== this.utterance) return false
        this.play({ type: 'chunk', utterance, seq, last: seq === sentences.length - 1, pcm: res.pcm, rate: res.rate, text: sentences[seq], volume: opts.volume })
      }
      return true
    } catch (error) {
      this.error = error.message
      if (this.engine === 'loading') this.engine = 'error'
      this._emit()
      if (utterance === this.utterance) this.play({ type: 'stop', utterance })
      return false
    } finally {
      this._touch()
    }
  }

  /** Zitto: la frase in corso si interrompe, quelle in coda non partono. */
  stop() {
    this.utterance++
    this.play({ type: 'stop', utterance: this.utterance })
  }

  shutdown() {
    this.cancelDownload()
    this._stopWorker()
  }
}

module.exports = { VoiceService }
