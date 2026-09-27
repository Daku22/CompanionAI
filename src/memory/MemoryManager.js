// MemoryManager — fading memory + lossless archive (ispirato a companion-emergence)
// CommonJS: richiedibile dal main process Electron e da script di test.
// Standalone: nessun sidecar Hermes, persistenza locale in ~/.desktop-companion/memory.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { route, PROVIDERS } = require('../main/ai-router')
const { writeAtomic } = require('../main/write-atomic')

// Default allineato al router: mai un id di modello inventato qui dentro.
const DEFAULT_MODEL = PROVIDERS.openrouter.models[0].id

/**
 * I tipi vivono in types.ts e sono agganciati qui via JSDoc: unica definizione,
 * verificata da `npm run typecheck` sullo stesso file che gira in produzione.
 * @typedef {import('./types').MemoryRecord}   MemoryRecord
 * @typedef {import('./types').ArchivedRecord} ArchivedRecord
 * @typedef {import('./types').MemoryState}    MemoryState
 */

// Oltre questa soglia i turni piu' vecchi vengono riassunti, non scartati: un
// taglio secco li toglieva dalla RAM senza che il riassunto li vedesse mai.
const MAX_RAW_TURNS = 200
// L'archivio completo sta nei file archive/*.jsonl; in state.json ne resta solo
// la coda, che serve a riconoscere i turni gia' compattati durante un reload.
const MAX_ARCHIVE_IN_RAM = 200
// Limite per messaggio applicato da sanitizeHistory in ai-router.js: il testo da
// riassumere va spezzato in blocchi che ci stiano dentro.
const ROUTER_MESSAGE_CHARS = 8000
// Lunghezza massima del riassunto di ripiego, usato senza chiave o se il modello fallisce.
const FALLBACK_SUMMARY_CHARS = 2000

class MemoryManager {
  /**
   * @param {string} conversationId
   * @param {string} storagePath
   * @param {{provider?: string, model?: string, apiKey?: string|null}} [config]
   */
  constructor(conversationId, storagePath, config = {}) {
    /** @type {MemoryState} */
    this.state = {
      conversationId,
      fadingMemory: { summary: '', rawTurns: [], archive: [] },
      lastCompacted: new Date().toISOString(),
      cursor: null,
    }
    this.setModel(config)
    this.archiveDir = path.join(storagePath, 'archive', conversationId)
    this.activeDir = path.join(storagePath, 'active', conversationId)
    this.storagePath = storagePath
    this._loaded = false
  }

  /**
   * Modello usato per i riassunti. Il main lo aggiorna a ogni cambio di
   * configurazione: fissarlo all'avvio lasciava i riassunti senza chiave per
   * tutta la prima sessione, quella in cui la chiave viene inserita.
   * @param {{provider?: string, model?: string, apiKey?: string|null}} [config]
   */
  setModel(config = {}) {
    this.provider = config.provider || 'openrouter'
    this.model = config.model || DEFAULT_MODEL
    this.apiKey = config.apiKey || null
  }

  async loadState() {
    try {
      let fromState = false
      const p = path.join(this.activeDir, 'state.json')
      if (fs.existsSync(p)) {
        const raw = await fs.promises.readFile(p, 'utf-8')
        const parsed = JSON.parse(raw)
        if (parsed && parsed.fadingMemory) { this.state = parsed; fromState = true }
      }
      // Merge: turns.jsonl può contenere turni più recenti di state.json (persist throttled)
      const t = path.join(this.activeDir, 'turns.jsonl')
      if (fs.existsSync(t)) {
        const lines = (await fs.promises.readFile(t, 'utf-8')).split('\n').filter(Boolean)
        const turns = lines.map(l => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
        if (turns.length) {
          const known = new Set([
            ...this.state.fadingMemory.rawTurns.map(x => x.id),
            ...this.state.fadingMemory.archive.map(x => x.id),
          ])
          for (const turn of turns) {
            if (!known.has(turn.id)) { this.state.fadingMemory.rawTurns.push(turn); known.add(turn.id) }
          }
          // I turni presi dal log vengono accodati a quelli di state.json:
          // riordinarli tiene il dialogo in ordine anche se i due file divergono.
          this.state.fadingMemory.rawTurns.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          this.state.cursor = turns[turns.length - 1].id || this.state.cursor
          this._loaded = true
          return true
        }
      }
      if (fromState) { this._loaded = true; return true }
    } catch (e) { console.error('MemoryManager: load state failed:', e.message) }
    return false
  }

  async _ensureLoaded() {
    if (!this._loaded) await this.loadState()
  }

  /**
   * @param {string} content
   * @param {'user'|'assistant'} speaker
   */
  async addTurn(content, speaker) {
    await this._ensureLoaded()
    if (typeof content !== 'string' || !content.trim()) return
    if (!['user', 'assistant'].includes(speaker)) speaker = 'user'
    const turn = {
      id: crypto.randomUUID(),
      content: content.slice(0, 8000),
      speaker,
      timestamp: new Date().toISOString(),
    }
    this.state.fadingMemory.rawTurns.push(turn)
    await this._persistActiveTurn(turn)
    this.state.cursor = turn.id
    this._loaded = true
    // Persistenza leggera dello stato per permettere reload immediato (throttled: ogni 5 turni o 30s)
    this._persistCount = (this._persistCount || 0) + 1
    const now = Date.now()
    if (this._persistCount % 5 === 0 || !this._lastPersist || now - this._lastPersist > 30000) {
      this._lastPersist = now
      await this._persistState()
    }
  }

  /** Vero quando i turni in RAM hanno superato la soglia e vanno riassunti. */
  needsCompaction() {
    return this.state.fadingMemory.rawTurns.length > MAX_RAW_TURNS
  }

  /**
   * Riassume i turni piu' vecchi di olderThanDays, e comunque quelli oltre gli
   * ultimi MAX_RAW_TURNS. Una sola compattazione alla volta: timer, pulsante e
   * soglia possono chiederla insieme, e due in parallelo riassumerebbero gli
   * stessi turni due volte.
   * @param {number} [olderThanDays]
   * @returns {Promise<boolean>}
   */
  compact(olderThanDays = 7) {
    if (!this._compacting) {
      this._compacting = this._compact(olderThanDays).finally(() => { this._compacting = null })
    }
    return this._compacting
  }

  async _compact(olderThanDays) {
    await this._ensureLoaded()
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const raw = this.state.fadingMemory.rawTurns
    const overflow = Math.max(0, raw.length - MAX_RAW_TURNS)
    // Limite inclusivo: con olderThanDays = 0 ("tutto fino ad adesso") un turno
    // scritto nello stesso millisecondo restava fuori dalla compattazione.
    const toCompact = raw.filter((t, i) => i < overflow || new Date(t.timestamp) <= cutoff)
    if (toCompact.length === 0) return false

    const prev = this.state.fadingMemory.summary || ''
    const newSummary = await this._summarizeInBatches(prev, toCompact)

    const archived = toCompact.map(t => ({
      ...t,
      archiveId: crypto.randomUUID(),
      archivedAt: new Date().toISOString(),
    }))

    const ids = new Set(toCompact.map(t => t.id))
    this.state.fadingMemory.archive.push(...archived)
    if (this.state.fadingMemory.archive.length > MAX_ARCHIVE_IN_RAM) {
      this.state.fadingMemory.archive = this.state.fadingMemory.archive.slice(-MAX_ARCHIVE_IN_RAM)
    }
    // Filtra l'array attuale, non quello letto all'inizio: durante l'attesa del
    // riassunto possono essere arrivati turni nuovi, che vanno tenuti.
    this.state.fadingMemory.rawTurns = this.state.fadingMemory.rawTurns.filter(t => !ids.has(t.id))
    this.state.fadingMemory.summary = newSummary
    this.state.fadingMemory.archivedCount = (this.state.fadingMemory.archivedCount ?? 0) + toCompact.length
    this.state.lastCompacted = new Date().toISOString()

    await this._archiveTurns(toCompact)
    await this._persistState()
    await this._rewriteActiveTurns()
    return true
  }

  /**
   * Riassunto (se esiste) piu' i turni recenti che stanno nel budget di token.
   * @param {number} [maxTokens]
   * @returns {Promise<MemoryRecord[]>}
   */
  async getContext(maxTokens = 4096) {
    await this._ensureLoaded()
    /** @type {MemoryRecord[]} */
    const context = []
    if (this.state.fadingMemory.summary) {
      context.push({
        id: 'summary',
        content: this.state.fadingMemory.summary,
        speaker: /** @type {const} */ ('summary'),
        timestamp: this.state.lastCompacted,
      })
    }
    // Stima rozza 1 token ≈ 4 caratteri, rispetta maxTokens
    let budget = Math.max(512, maxTokens)
    const summaryChars = (this.state.fadingMemory.summary || '').length
    budget -= Math.ceil(summaryChars / 4)
    const recent = this.state.fadingMemory.rawTurns.slice(-10)
    const picked = []
    for (let i = recent.length - 1; i >= 0; i--) {
      const cost = Math.ceil((recent[i].content || '').length / 4) + 8
      if (budget - cost < 0) break
      budget -= cost
      picked.unshift(recent[i])
    }
    context.push(...picked)
    return context
  }

  // Accessor sincroni: leggono lo stato gia' in RAM. Non renderli async senza
  // aggiornare i chiamanti — e' esattamente su questo che il vecchio gemello .ts
  // era andato alla deriva rispetto a questo file.
  /** @returns {ArchivedRecord[]} */
  getArchive() { return this.state.fadingMemory.archive }
  /** @returns {string} */
  getSummary() { return this.state.fadingMemory.summary }
  /** @returns {MemoryRecord[]} */
  getRawTurns() { return this.state.fadingMemory.rawTurns }

  getStats() {
    return {
      totalTurns: this.state.fadingMemory.rawTurns.length + this._archivedTotal(),
      rawTurns: this.state.fadingMemory.rawTurns.length,
      archivedTurns: this._archivedTotal(),
      hasSummary: !!this.state.fadingMemory.summary,
      lastCompacted: this.state.lastCompacted,
    }
  }

  async clear() {
    this.state.fadingMemory = { summary: '', rawTurns: [], archive: [] }
    this.state.cursor = null
    this.state.lastCompacted = new Date().toISOString()
    await this._persistState()
    // Tronca il log append-only per evitare crescita infinita
    try {
      await fs.promises.mkdir(this.activeDir, { recursive: true })
      await fs.promises.writeFile(path.join(this.activeDir, 'turns.jsonl'), '', 'utf-8')
    } catch (e) { console.error('MemoryManager: truncate turns failed:', e.message) }
    // "Dimentica" deve valere anche per l'archivio: senza, le conversazioni
    // restavano su disco dopo che l'utente aveva chiesto di cancellarle.
    try {
      await fs.promises.rm(this.archiveDir, { recursive: true, force: true })
    } catch (e) { console.error('MemoryManager: remove archive failed:', e.message) }
    this._loaded = true
  }

  async _persistActiveTurn(turn) {
    try {
      await fs.promises.mkdir(this.activeDir, { recursive: true })
      const data = JSON.stringify(turn) + '\n'
      await fs.promises.appendFile(path.join(this.activeDir, 'turns.jsonl'), data, 'utf-8')
    } catch (error) {
      console.error('MemoryManager: persist active turn failed:', error.message)
    }
  }

  // Il conteggio vero: l'archivio in RAM e' tagliato a MAX_ARCHIVE_IN_RAM e da
  // solo sotto-conterebbe. Gli stati salvati prima del contatore usano la lunghezza.
  _archivedTotal() {
    return this.state.fadingMemory.archivedCount ?? this.state.fadingMemory.archive.length
  }

  // Dopo una compattazione il log attivo contiene solo i turni ancora da
  // riassumere. Senza questa riscrittura cresceva per sempre e, oltre i 200
  // turni archiviati, al reload i turni vecchi non erano piu' riconosciuti e
  // rientravano come nuovi, per essere riassunti una seconda volta.
  async _rewriteActiveTurns() {
    try {
      await fs.promises.mkdir(this.activeDir, { recursive: true })
      const data = this.state.fadingMemory.rawTurns.map(t => JSON.stringify(t) + '\n').join('')
      await writeAtomic(path.join(this.activeDir, 'turns.jsonl'), data)
    } catch (error) {
      console.error('MemoryManager: rewrite active turns failed:', error.message)
    }
  }

  async _archiveTurns(turns) {
    try {
      await fs.promises.mkdir(this.archiveDir, { recursive: true })
      const data = turns.map(t => JSON.stringify(t)).join('\n') + '\n'
      await fs.promises.writeFile(path.join(this.archiveDir, `${Date.now()}.jsonl`), data, 'utf-8')
    } catch (error) {
      console.error('MemoryManager: archive turns failed:', error.message)
    }
  }

  async _persistState() {
    try {
      await fs.promises.mkdir(this.activeDir, { recursive: true })
      const stateStr = JSON.stringify(this.state, null, 2)
      await writeAtomic(path.join(this.activeDir, 'state.json'), stateStr)
    } catch (error) {
      console.error('MemoryManager: persist state failed:', error.message)
    }
  }

  _buildSummaryPrompt(turns) {
    return turns.map(t => `${t.speaker === 'assistant' ? 'Companion' : 'User'}: ${t.content}`).join('\n')
  }

  async _generateSummary(prevSummary, prompt) {
    const systemPrompt = `Sei la memoria di un companion desktop. Riassumi in prima persona ("Io...") il dialogo seguente, mantenendo nomi, decisioni, argomenti. Formatta come memoria continua, non elenchi. Se esiste un riassunto precedente, fondilo senza duplicare.`
    const full = `${prevSummary ? 'RIASSUNTO PRECEDENTE:\n' + prevSummary + '\n\n' : ''}NUOVI TURNI:\n${prompt}`
    // Senza modello si accoda un estratto e si tiene la coda: tagliare dall'inizio
    // bloccava il riassunto una volta pieno, e i turni nuovi non entravano piu'.
    const fallback = () => (`${prevSummary ? prevSummary + ' ' : ''}[auto ${new Date().toISOString().slice(0, 10)}] `
      + prompt.split(/\s+/).slice(0, 60).join(' ')).slice(-FALLBACK_SUMMARY_CHARS)
    try {
      if (!this.apiKey) return fallback()
      const result = await route({
        provider: this.provider,
        model: this.model,
        apiKey: this.apiKey,
        // jsonMode:false — il riassunto e' prosa. Senza questo erediterebbe il
        // contratto JSON+action del companion, sprecando token e potendo
        // produrre azioni fantasma a partire da un semplice riassunto.
        systemPrompt,
        jsonMode: false,
        maxTokens: 800,
        history: [{ role: 'user', content: full }],
      })
      return result.reply || fallback()
    } catch (error) {
      // Il placeholder "[truncated]" di prima toglieva i turni dal riassunto per
      // sempre; l'estratto ne conserva almeno una parte.
      console.error('MemoryManager: LLM summary failed:', error.message)
      return fallback()
    }
  }

  /**
   * Piega i turni nel riassunto a blocchi. Il router taglia ogni messaggio a
   * ROUTER_MESSAGE_CHARS: mandare tutto in una volta faceva vedere al modello
   * solo l'inizio di una compattazione grossa, e il resto si perdeva.
   */
  async _summarizeInBatches(prevSummary, turns) {
    let summary = prevSummary
    let batch = []
    let size = 0
    const flush = async () => {
      if (!batch.length) return
      summary = await this._generateSummary(summary, this._buildSummaryPrompt(batch))
      batch = []
      size = 0
    }
    for (const turn of turns) {
      const cost = (turn.content || '').length + 16
      // Spazio per le intestazioni del prompt, oltre al riassunto precedente.
      const budget = Math.max(2000, ROUTER_MESSAGE_CHARS - (summary || '').length - 200)
      if (batch.length && size + cost > budget) await flush()
      batch.push(turn)
      size += cost
    }
    await flush()
    return summary
  }
}

module.exports = { MemoryManager }
