// voice.js — la voce del companion, lato main.
//
// Dalla risposta del modello all'audio che suona nella finestra dell'avatar:
// il testo si pulisce e si divide in frasi (speech-text.js), un motore le
// sintetizza una alla volta e ogni frase va subito al companion, che la suona
// mentre qui si prepara la seguente. Una risposta nuova interrompe quella in
// corso.
//
// Due motori:
// - XTTS-v2 (xtts-engine.js), la voce principale, anche clonata da un
//   campione: un servizio Python sulla GPU, installato dalle Impostazioni
//   (xtts-setup.js), acceso finche' la voce XTTS e' in uso. Manda l'audio a
//   pezzi mentre genera;
// - Kokoro, la riserva: un processo a parte (kokoro-worker.js), avviato alla
//   prima frase e chiuso dopo qualche minuto di silenzio. I suoi file si
//   scaricano dalle Impostazioni (voice-assets.js).
// Se XTTS non e' installato o si guasta, parla Kokoro, se c'e'.
// Fra una frase e l'altra il companion riceve una pausa ({ type: 'gap' }).
//
// Il microfono (transcribe) usa lo stesso servizio di XTTS, con faster-whisper:
// si installa a parte, dopo XTTS, e il servizio resta acceso finche' il
// microfono e' attivo, anche se a parlare e' Kokoro.

const fs = require('fs')
const path = require('path')
const { KOKORO_FILES, packStatus, downloadPack, removePack } = require('./voice-assets')
const { cleanForSpeech, splitSentences, cleanTranscript } = require('./speech-text')
const setupDefaults = require('./xtts-setup')

const IDLE_STOP_MS = 5 * 60 * 1000
const SYNTH_TIMEOUT_MS = 60 * 1000
const LOAD_TIMEOUT_MS = 120 * 1000
const SENTENCE_GAP_S = 0.12
const XTTS_IDLE_STOP_MS = 2 * 60 * 1000   // XTTS non piu' in uso: spento dopo 2 minuti
const SAMPLE_RE = /^voce-\d{8,16}\.wav$/

/**
 * @typedef {{ send: (msg: any) => void, onMessage: (fn: (msg: any) => void) => void,
 *   onExit: (fn: (code: number) => void) => void, kill: () => void }} VoiceWorker
 */

class VoiceService {
  /**
   * @param {{ dir: string, spawn: () => VoiceWorker, play: (msg: any) => void,
   *   onStatus?: (status: any) => void, baseUrl?: string, idleMs?: number, xttsIdleMs?: number,
   *   xtts?: any, setup?: { installXtts: Function, uninstallXtts: Function, xttsInstalled: Function, STEPS?: any[],
   *     installStt?: Function, uninstallStt?: Function, sttInstalled?: Function, STT_STEPS?: any[] } }} opts
   *   play: messaggi per il companion ({ type: 'chunk' | 'gap' | 'stop', ... })
   *   baseUrl: solo per i test, la fonte dei file
   *   xtts: un XttsEngine (o un finto nei test); setup: xtts-setup.js
   */
  constructor({ dir, spawn, play, onStatus, baseUrl, idleMs, xtts, setup, xttsIdleMs }) {
    this.dir = dir
    this.spawn = spawn
    this.play = play
    this.onStatus = onStatus || (() => {})
    this.baseUrl = baseUrl
    this.idleMs = idleMs || IDLE_STOP_MS
    this.worker = null
    this.engine = 'off'          // Kokoro: off | loading | ready | error
    this.error = null
    this.downloading = null      // { done, total } mentre scarica
    this.abort = null
    this.pending = new Map()     // id -> { resolve, reject, timer }
    this.nextId = 1
    this.utterance = 0           // quella in corso; una nuova interrompe le vecchie
    this.speaking = null         // AbortController della frase XTTS in corso
    this.idleTimer = null
    this.xtts = xtts || null
    this.setup = setup || setupDefaults
    this.xttsInstall = null      // { step, index, count, label, done, total } mentre installa
    this.xttsAbort = null
    this.xttsError = null
    this.xttsIdleMs = xttsIdleMs || XTTS_IDLE_STOP_MS
    this.xttsStopTimer = null
    this.sttInstall = null       // come xttsInstall, per il microfono
    this.sttAbort = null
    this.sttError = null
    this.need = { tts: false, stt: false }  // cosa chiede la config (syncService)
    if (this.xtts) this.xtts.onState = () => this._emit()
  }

  status() {
    const x = this.xtts
    return {
      ...packStatus(this.dir, KOKORO_FILES), downloading: this.downloading, engine: this.engine, error: this.error,
      xtts: {
        available: !!x,
        installed: !!x && this.setup.xttsInstalled(this.dir),
        state: x ? x.state : 'off',
        error: (x && x.error) || this.xttsError,
        info: x ? x.info : null,
        installing: this.xttsInstall,
        loaded: x && x.loaded ? [...x.loaded] : [],
      },
      stt: {
        installed: this.sttInstalled(),
        installing: this.sttInstall,
        error: this.sttError,
        loading: !!x && !!x.loading && x.loading.has('stt'),
        ready: !!x && x.state === 'ready' && !!x.loaded && x.loaded.has('stt'),
      },
    }
  }

  /** Il microfono e' installato (XTTS, pacchetti e modello Whisper). */
  sttInstalled() { return !!this.xtts && !!this.setup.sttInstalled && this.setup.sttInstalled(this.dir) }

  samplesDir() { return path.join(this.dir, 'samples') }

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

  /** Il motore per questa risposta: XTTS se scelto e installato, se no Kokoro, se no nessuno. */
  _pick(opts) {
    if (opts.engine === 'xtts' && this.xtts && this.setup.xttsInstalled(this.dir)) return 'xtts'
    return packStatus(this.dir, KOKORO_FILES).installed ? 'kokoro' : null
  }

  /**
   * Pronuncia un testo. Restituisce false se non c'e' niente da dire, nessuna
   * voce e' installata o la risposta e' stata interrotta; gli errori dei
   * motori finiscono nello stato.
   * @param {string} text
   * @param {{ engine?: string, voice?: string, speaker?: { sample?: string, builtin?: string },
   *   speed?: number, volume?: number }} [opts]
   *   voice: la voce di Kokoro; speaker: quella di XTTS; volume: 0..1, lo applica il companion
   */
  async speak(text, opts = {}) {
    const sentences = splitSentences(cleanForSpeech(text))
    if (!sentences.length) return false
    let engine = this._pick(opts)
    if (!engine) return false
    this.stop()
    const utterance = this.utterance
    const live = () => utterance === this.utterance
    const send = (seq, pcm, rate) => { if (live()) this.play({ type: 'chunk', utterance, seq, pcm, rate, text: sentences[seq], volume: opts.volume }) }
    try {
      if (engine === 'kokoro') await this._ready()
      for (let seq = 0; seq < sentences.length; seq++) {
        if (!live()) return false
        if (engine === 'xtts') {
          const ctrl = new AbortController()
          this.speaking = ctrl
          try {
            await this.xtts.synth(sentences[seq], { speaker: opts.speaker || {}, speed: opts.speed, signal: ctrl.signal }, (pcm, rate) => send(seq, pcm, rate))
            this.xttsError = null
          } catch (error) {
            if (!live()) return false
            // XTTS non va: il resto della risposta con Kokoro, se c'e'.
            this.xttsError = error.message
            this._emit()
            if (!packStatus(this.dir, KOKORO_FILES).installed) throw error
            engine = 'kokoro'
            await this._ready()
            seq--
            continue
          } finally {
            if (this.speaking === ctrl) this.speaking = null
          }
        } else {
          const res = await this._ask({ type: 'synth', text: sentences[seq], voice: opts.voice, speed: opts.speed }, SYNTH_TIMEOUT_MS)
          if (!live()) return false
          send(seq, res.pcm, res.rate)
        }
        if (live()) this.play({ type: 'gap', utterance, seconds: SENTENCE_GAP_S })
      }
      return live()
    } catch (error) {
      if (engine === 'kokoro') {
        this.error = error.message
        if (this.engine === 'loading') this.engine = 'error'
      }
      this._emit()
      if (live()) this.play({ type: 'stop', utterance })
      return false
    } finally {
      if (engine === 'kokoro') this._touch()
    }
  }

  /** Zitto: la frase in corso si interrompe, quelle in coda non partono. */
  stop() {
    this.utterance++
    if (this.speaking) { this.speaking.abort(); this.speaking = null }
    this.play({ type: 'stop', utterance: this.utterance })
  }

  // ─── XTTS ────────────────────────────────────────────────────────────────

  /**
   * Accende o spegne il servizio secondo la config: acceso se serve la voce
   * XTTS (voce attiva, XTTS scelto e installato) o il microfono (attivo e
   * installato), con i modelli che servono gia' caricati. Caricare XTTS
   * richiede decine di secondi, quindi si fa prima che arrivi una risposta.
   * Lo spegnimento aspetta un poco: chi sistema le impostazioni (motore, poi
   * voce attiva) lo spegnerebbe e riaccenderebbe a ogni clic.
   * @param {{ tts?: boolean, stt?: boolean }} need
   */
  syncService(need) {
    if (!this.xtts) return
    this.need = { tts: !!need.tts, stt: !!need.stt }
    clearTimeout(this.xttsStopTimer)
    this.xttsStopTimer = null
    const busy = !!this.xttsInstall || !!this.sttInstall
    const want = []
    if (this.need.tts && this.setup.xttsInstalled(this.dir)) want.push('tts')
    if (this.need.stt && this.sttInstalled()) want.push('stt')
    if (want.length && !busy) {
      this.xtts.start(want)
        .then(() => Promise.all(want.map(kind => this.xtts.ensure(kind))))
        .catch(() => { /* l'errore e' nello stato */ })
        .finally(() => this._emit())
      // Un modello caricato che non serve piu' (la voce passata a Kokoro col
      // microfono acceso, o il contrario) libera la memoria video, con lo
      // stesso ritardo dello spegnimento.
      const extra = ['tts', 'stt'].filter(kind => !want.includes(kind))
      if (extra.length && this.xtts.unload) {
        this.xttsStopTimer = setTimeout(() => {
          this.xttsStopTimer = null
          for (const kind of extra) this.xtts.unload(kind).catch(() => { /* resta caricato */ }).finally(() => this._emit())
        }, this.xttsIdleMs)
        if (this.xttsStopTimer.unref) this.xttsStopTimer.unref()
      }
    } else if (!want.length && !busy && this.xtts.state !== 'off') {
      this.xttsStopTimer = setTimeout(() => { this.xttsStopTimer = null; this.xtts.stop() }, this.xttsIdleMs)
      if (this.xttsStopTimer.unref) this.xttsStopTimer.unref()
    }
  }

  /** Installa XTTS (Python, pacchetti, modello) e lo accende una volta per provarlo. */
  async installXtts() {
    if (!this.xtts || this.xttsInstall) return this.status()
    this.xttsAbort = new AbortController()
    this.xttsError = null
    this.xttsInstall = { step: 'uv', index: 0, count: this.setup.STEPS ? this.setup.STEPS.length : 5, label: '', done: 0, total: 0 }
    this._emit()
    let last = 0
    try {
      await this.setup.installXtts(this.dir, {
        signal: this.xttsAbort.signal,
        baseUrl: this.baseUrl,
        onProgress: (p) => {
          const changed = !this.xttsInstall || this.xttsInstall.step !== p.step
          this.xttsInstall = p
          const now = Date.now()
          if (changed || now - last > 500) { last = now; this._emit() }
        },
        check: async () => {
          await this.xtts.start()
          if (this.xtts.info && this.xtts.info.device !== 'cuda') throw new Error('PyTorch non vede la scheda NVIDIA: XTTS sulla CPU sarebbe troppo lento')
        },
      })
    } catch (error) {
      this.xttsError = this.xttsAbort.signal.aborted ? 'installazione annullata' : error.message
      this.xtts.stop()
    } finally {
      this.xttsInstall = null
      this.xttsAbort = null
      this._emit()
    }
    return this.status()
  }

  cancelXttsInstall() { if (this.xttsAbort) this.xttsAbort.abort() }

  /** Toglie XTTS, e con lui il microfono (i campioni della voce restano). */
  async removeXtts() {
    this.stop()
    this.cancelXttsInstall()
    this.cancelSttInstall()
    this.sttError = null
    // Il processo deve aver lasciato i file prima di cancellarli.
    clearTimeout(this.xttsStopTimer)
    if (this.xtts) await this.xtts.stop()
    try {
      await this.setup.uninstallXtts(this.dir)
      this.xttsError = null
    } catch (error) {
      this.xttsError = 'disinstallazione incompleta, riprova: ' + error.message
    }
    this._emit()
    return this.status()
  }

  /**
   * Le voci incluse in XTTS, se il servizio e' acceso con XTTS caricato. Acceso
   * solo per il microfono non si carica XTTS per un elenco: 30 s e 2 GB.
   */
  async xttsSpeakers() {
    if (!this.xtts || this.xtts.state !== 'ready' || !this.xtts.loaded || !this.xtts.loaded.has('tts')) return []
    try { return await this.xtts.speakers() } catch (_) { return [] }
  }

  /**
   * Il campione della voce da clonare: convertito dal servizio (che deve
   * essere installato) in samples/voce-<ora>.wav. I campioni vecchi si tolgono.
   * @param {string} src file scelto dall'utente
   * @returns {Promise<{ file: string, seconds: number }>}
   */
  async importSample(src) {
    if (!this.xtts || !this.setup.xttsInstalled(this.dir)) throw new Error('prima installa XTTS')
    fs.mkdirSync(this.samplesDir(), { recursive: true })
    const file = 'voce-' + Date.now() + '.wav'
    const res = await this.xtts.prepareSample(src, path.join(this.samplesDir(), file))
    for (const old of fs.readdirSync(this.samplesDir())) {
      if (!old.startsWith(file)) fs.rmSync(path.join(this.samplesDir(), old), { force: true })
    }
    return { file, seconds: res.seconds }
  }

  /** Percorso di un campione, solo se e' uno dei nostri e c'e' ancora. */
  samplePath(file) {
    if (typeof file !== 'string' || !SAMPLE_RE.test(file)) return null
    const full = path.join(this.samplesDir(), file)
    return fs.existsSync(full) ? full : null
  }

  // ─── Microfono ───────────────────────────────────────────────────────────

  /** Aggiunge il microfono (pacchetti e modello Whisper) a XTTS installato. */
  async installStt() {
    if (!this.xtts || !this.setup.installStt || this.sttInstall || this.xttsInstall) return this.status()
    this.sttAbort = new AbortController()
    this.sttError = null
    this.sttInstall = { step: 'packages', index: 0, count: this.setup.STT_STEPS ? this.setup.STT_STEPS.length : 3, label: '', done: 0, total: 0 }
    this._emit()
    let last = 0
    try {
      await this.setup.installStt(this.dir, {
        signal: this.sttAbort.signal,
        baseUrl: this.baseUrl,
        onProgress: (p) => {
          const changed = !this.sttInstall || this.sttInstall.step !== p.step
          this.sttInstall = p
          const now = Date.now()
          if (changed || now - last > 500) { last = now; this._emit() }
        },
        check: () => this.xtts.ensure('stt'),
      })
    } catch (error) {
      this.sttError = this.sttAbort.signal.aborted ? 'installazione annullata' : error.message
    } finally {
      this.sttInstall = null
      this.sttAbort = null
      this._emit()
    }
    // Il servizio acceso solo per la prova si spegne, se non serve.
    this.syncService(this.need)
    return this.status()
  }

  cancelSttInstall() { if (this.sttAbort) this.sttAbort.abort() }

  /** Toglie il modello del microfono. Il servizio si spegne: tiene il modello aperto. */
  async removeStt() {
    if (!this.setup.uninstallStt) return this.status()
    this.cancelSttInstall()
    clearTimeout(this.xttsStopTimer)
    if (this.xtts) await this.xtts.stop()
    try {
      await this.setup.uninstallStt(this.dir)
      this.sttError = null
    } catch (error) {
      this.sttError = 'disinstallazione incompleta, riprova: ' + error.message
    }
    this._emit()
    this.syncService(this.need)
    return this.status()
  }

  /**
   * Il testo detto nel microfono, pulito (cleanTranscript): vuoto se non si e'
   * capito niente. Gli errori finiscono anche nello stato.
   * @param {Float32Array} pcm mono a 16 kHz
   * @returns {Promise<{ text: string, seconds: number, took: number }>}
   */
  async transcribe(pcm) {
    if (!this.sttInstalled()) throw new Error('prima installa il microfono (Impostazioni, Voce)')
    try {
      const res = await this.xtts.transcribe(pcm)
      if (this.sttError) { this.sttError = null; this._emit() }
      return { text: cleanTranscript(res.text), seconds: Number(res.seconds) || 0, took: Number(res.took) || 0 }
    } catch (error) {
      this.sttError = error.message
      this._emit()
      throw error
    }
  }

  shutdown() {
    this.cancelDownload()
    this.cancelXttsInstall()
    this.cancelSttInstall()
    this._stopWorker()
    clearTimeout(this.xttsStopTimer)
    if (this.xtts) this.xtts.stop()
  }
}

module.exports = { VoiceService }
