const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, protocol, net, dialog, safeStorage, session, powerMonitor, utilityProcess, globalShortcut, desktopCapturer } = require('electron')
const path  = require('path')
const { spawn } = require('child_process')
const fs    = require('fs')
const os    = require('os')
const { route, PROVIDERS, describeError, listModels, EMOTIONS, SYSTEM_PROMPT, MOTION_PROMPT, modelCaps: modelCapsOf, validImage } = require('./ai-router')
const { MemoryManager } = require('../memory/MemoryManager')
const { AvatarLibrary } = require('./AvatarLibrary')
const { SceneLibrary } = require('./SceneLibrary')
const { AnimationLibrary, ANIMATION_SLOTS, SLOT_LABELS, isGlb } = require('./AnimationLibrary')
const { KimodoService, motionPrompt, cacheKey } = require('./kimodo-service')
const winWindows = require('./win-windows')
const { findWindowSeat, findTaskbarSeat, taskbarEdge, perchPosition, staysSeated } = require('./perch')
const edgePeek = require('./edge-peek')
const { builtinAvatars } = require('./builtin-avatars')
const room = require('./room')
const { WeatherService } = require('./weather')
const { isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender, checkMotion, keysForDisk, legacyKeyProvider, WINDOW_SCALES, voiceConfig, allowPermission, MIC_SHORTCUTS, checkLive2DChoices, allowDisplayCapture, danceApps, DANCE_APPS_DEFAULT, chibiAvatars, chibiUnavailable } = require('./guards')
const winAudio = require('./win-audio')
const { VoiceService } = require('./voice')
const { XttsEngine } = require('./xtts-engine')
const xttsSetup = require('./xtts-setup')
const live2dCore = require('./live2d-core')
// La licenza del modello XTTS-v2, al commit scaricato.
const XTTS_LICENSE_URL = 'https://huggingface.co/coqui/XTTS-v2/blob/6c2b0d75eae4b7047358e3b6bd9325f857d43f77/LICENSE.txt'
const { walkTarget } = require('./walk-target')
const { setupLogging } = require('./logger')
const moodLib = require('./mood')
const Personas = require('./personas')
const Rapport = require('./rapport')
const Diary = require('./diary')
const Initiative = require('./initiative')
const ActiveApp = require('./active-app')
const Mcp = require('./mcp')
const { writeAtomic } = require('./write-atomic')
const touchReact = require('./touch-react')
const { createCompanion } = require('./companion')
const Companions = require('./companions')
const Group = require('./group-chat')

let chatWindow      = null
let tray            = null
let avatarLibrary   = null
let sceneLibrary    = null
let animationLibrary = null
let kimodo = null
let voiceService = null
let settingsWindow = null

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.desktop-companion', 'config.json')

// Mappa provider → nome variabile d'ambiente per la chiave API
const ENV_KEY_MAP = {
  claude:     'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

// Il default decide se la primissima installazione funziona o fallisce al primo
// messaggio: deve essere un modello che esiste davvero. Verificato contro
// GET https://openrouter.ai/api/v1/models il 2026-09-13.
const DEFAULT_MODEL = PROVIDERS.openrouter.models[0].id
// avatarModel vuoto = l'avatar predefinito, scelto da builtin-avatars.js.
// idleLife: gesti autonomi quando nessuno scrive (idle-life.js).
// followMouse, alwaysOnTop e scale si cambiano dal menu col tasto destro.
// kimodo: movimenti nuovi generati in locale (kimodo-service.js); kimodoDir
// si scrive solo a mano in config.json, mai dalla UI.
// perch: posato sul bordo di una finestra o della taskbar, ci si siede (perch.js).
// touchReactions: reagisce ai tocchi per zona (touch-react.js); spento, un clic
// da' solo il sorriso di prima.
// danceMusic: balla con la musica (Blocco 5c), spento di base; danceApps: le
// app il cui suono conta (win-audio.js).
// chibiAvatars: gli avatar 3D in chibi (Blocco 5d), per id; lo scrive solo il
// main, dal menu o dalle Impostazioni.
// view: 'desktop' (trasparente, sul desktop) o 'room' (la stanza, room.js);
// roomBounds: dove era la stanza, la scrive solo il main.
const DEFAULT_CONFIG = {
  provider: 'openrouter', model: DEFAULT_MODEL, avatarModel: '', idleLife: true,
  followMouse: true, alwaysOnTop: true, scale: 'm', kimodo: false, perch: true, view: 'desktop', keys: {},
  touchReactions: true, initiative: true, initiativeVoice: false, danceMusic: false, danceApps: DANCE_APPS_DEFAULT, chibiAvatars: [],
}

function loadEnvFile() {
  // .env leggero, senza dipendenze: solo per chi lavora sul sorgente.
  // L'app installata legge le variabili d'ambiente, ma nessun file .env.
  if (app.isPackaged) return
  try {
    const envPath = path.join(__dirname, '..', '..', '.env')
    if (!fs.existsSync(envPath)) return
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const idx = t.indexOf('=')
      const k = t.slice(0, idx).trim()
      let v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch (e) { console.warn('[config] .env non caricato:', e.message) }
}
loadEnvFile()

// loadConfig gira a ogni messaggio e a ogni apertura della chat: l'avviso per
// una chiave illeggibile va nel log una volta sola, non a ogni lettura.
const warnedUnreadable = new Set()

function loadConfig() {
  let cfg = null
  try {
    if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    console.error('[config] config.json corrotto, uso default. Dettaglio:', e.message)
    try {
      const bak = CONFIG_PATH + '.corrupt-' + Date.now() + '.bak'
      fs.copyFileSync(CONFIG_PATH, bak)
      console.error('[config] backup creato:', bak)
    } catch (_) {}
    cfg = null
  }
  if (!cfg || typeof cfg !== 'object') cfg = { ...DEFAULT_CONFIG }
  // Chiavi che questa installazione non sa decifrare: cifrate da un'altra
  // cartella dati di Electron, o dopo che la sua chiave principale e' cambiata.
  // Restano da parte, non si perdono, e la chat chiede di reinserirle.
  cfg.unreadableKeys = {}
  if (cfg.keys && typeof cfg.keys === 'object') {
    // Provider tolti nel Blocco 7a: la loro chiave non serve piu'.
    for (const name of Object.keys(cfg.keys)) if (!PROVIDERS[name]) delete cfg.keys[name]
  }
  if (cfg.keysEncrypted && cfg.keys && typeof cfg.keys === 'object') {
    for (const [provider, value] of Object.entries(cfg.keys)) {
      try { cfg.keys[provider] = safeStorage.decryptString(Buffer.from(value, 'base64')) } catch (e) {
        if (!warnedUnreadable.has(value)) {
          warnedUnreadable.add(value)
          console.warn('[config] chiave di ' + provider + ' non decifrabile, va reinserita: ' + e.message)
        }
        cfg.unreadableKeys[provider] = value
        delete cfg.keys[provider]
      }
    }
  }
  cfg.provider = typeof cfg.provider === 'string' ? cfg.provider : DEFAULT_CONFIG.provider
  cfg.model = typeof cfg.model === 'string' ? cfg.model : DEFAULT_CONFIG.model
  cfg.avatarModel = typeof cfg.avatarModel === 'string' ? cfg.avatarModel : DEFAULT_CONFIG.avatarModel
  cfg.idleLife = cfg.idleLife !== false
  cfg.followMouse = cfg.followMouse !== false
  cfg.alwaysOnTop = cfg.alwaysOnTop !== false
  cfg.kimodo = cfg.kimodo === true
  cfg.perch = cfg.perch !== false
  cfg.touchReactions = cfg.touchReactions !== false
  cfg.danceMusic = cfg.danceMusic === true
  // Iniziativa (Blocco 6d): accesa di base; letta ad alta voce solo se chiesto.
  cfg.initiative = cfg.initiative !== false
  cfg.initiativeVoice = cfg.initiativeVoice === true
  // App attiva (Blocco 7c): spenta di base, con l'elenco delle finestre da non leggere.
  cfg.activeApp = cfg.activeApp === true
  cfg.activeAppIgnore = ActiveApp.cleanIgnore(cfg.activeAppIgnore) || ActiveApp.IGNORE_DEFAULT
  // Server MCP (Blocco 7f): li aggiunge l'utente, spenti di base.
  cfg.mcpServers = Mcp.cleanServers(cfg.mcpServers)
  cfg.danceApps = danceApps(cfg.danceApps) || DANCE_APPS_DEFAULT
  cfg.chibiAvatars = chibiAvatars(cfg.chibiAvatars) || []
  cfg.view = cfg.view === 'room' ? 'room' : 'desktop'
  if (typeof cfg.scale !== 'string' || !Object.prototype.hasOwnProperty.call(WINDOW_SCALES, cfg.scale)) cfg.scale = DEFAULT_CONFIG.scale
  if (!PROVIDERS[cfg.provider]) { cfg.provider = DEFAULT_CONFIG.provider; cfg.model = DEFAULT_CONFIG.model }

  // Fallback: se manca la key salvata per il provider attivo, usa l'env var
  cfg.keys = (cfg.keys && typeof cfg.keys === 'object') ? cfg.keys : {}

  // Vecchio formato: un `apiKey` in chiaro. Passa fra le chiavi, che il
  // salvataggio cifra, e sparisce subito dal file. Prima della variabile
  // d'ambiente: quella non deve finire su disco.
  if ('apiKey' in cfg) {
    const target = legacyKeyProvider(cfg.apiKey, cfg.keys)
    if (target) cfg.keys[target] = String(cfg.apiKey).trim()
    delete cfg.apiKey
    console.log('[config] chiave del vecchio formato ' + (target ? 'spostata fra quelle di ' + target : 'tolta dal file'))
    saveConfig(cfg)
  }

  const envName = ENV_KEY_MAP[cfg.provider]
  if (envName && !cfg.keys[cfg.provider] && process.env[envName]) {
    cfg.keys[cfg.provider] = process.env[envName]
  }
  return cfg
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const { unreadableKeys, ...stored } = cfg
    const encrypt = safeStorage.isEncryptionAvailable() ? (value) => safeStorage.encryptString(value).toString('base64') : null
    stored.keys = keysForDisk(cfg.keys, unreadableKeys, encrypt)
    if (encrypt) stored.keysEncrypted = true
    else delete stored.keysEncrypted
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2))
  } catch (e) { console.error('[config] salvataggio fallito:', e.message) }
}

function publicConfig(cfg) {
  // I server MCP hanno variabili d'ambiente (a volte chiavi): alle pagine vanno con mcp:list, senza valori.
  const { keys, unreadableKeys, kimodoDir, mcpServers, ...safe } = cfg
  return {
    ...safe,
    keyConfigured: Object.fromEntries(Object.entries(keys || {}).map(([name, value]) => [name, !!value])),
    // Solo i nomi dei provider: la chat spiega perche' la chiave va reinserita.
    keyUnreadable: Object.fromEntries(Object.keys(unreadableKeys || {}).filter(name => !(keys || {})[name]).map(name => [name, true])),
    providers: PROVIDERS,
    kimodoAvailable: !!kimodo && kimodo.available(),
    // Meteo della stanza: la citta' trovata, o perche' non c'e'.
    weatherStatus,
    persona: activePersona() ? { id: activePersona().id, name: activePersona().name } : null,
    // Chi e' sul desktop: con piu' di uno la chat e' di gruppo (Blocco 8c).
    companions: companions.map(c => ({ id: c.personaId, name: (c.persona() || {}).name || c.personaId })),
    voice: voiceConfig(cfg),
    // Microfono: installato, la scorciatoia davvero registrata (null se un
    // altro programma la usa gia'), e le scorciatoie fra cui scegliere.
    micInstalled: !!voiceService && voiceService.sttInstalled(),
    micShortcutActive: micShortcut,
    micShortcuts: Object.entries(MIC_SHORTCUTS).map(([id, s]) => ({ id, label: s.label })),
  }
}

// ─── Memoria (fading memory + lossless archive) ──────────────────────────────

const MEMORY_PATH = path.join(os.homedir(), '.desktop-companion', 'memory')

// Budget di contesto riservato alla memoria a lungo termine, in token stimati.
const MEMORY_CONTEXT_TOKENS = 1500
// "Compatta" lascia interi gli ultimi turni (due scambi).
const MANUAL_COMPACT_KEEP = 4

// Per il riassunto usa il provider configurato. Senza chiave il MemoryManager
// ripiega su un riassunto deterministico invece di bloccarsi.
function memoryModelFrom(cfg) {
  return {
    provider: cfg.provider || 'openrouter',
    model: cfg.model || DEFAULT_MODEL,
    apiKey: cfg.keys?.[cfg.provider] || null,
  }
}

// ─── Persone (Blocco 6a) ─────────────────────────────────────────────────────
// Ognuna ha memoria, umore, personalita', avatar e voce. Le regole stanno in
// personas.js; qui si carica, si salva e si cambia persona.
const PERSONAS_PATH = path.join(MEMORY_PATH, 'personas.json')
let personas = null

function loadPersonas() {
  const cfg = loadConfig()
  personas = Personas.load(PERSONAS_PATH, { avatarModel: cfg.avatarModel, voice: cfg.voice })
}

function savePersonas() {
  fs.promises.mkdir(MEMORY_PATH, { recursive: true })
    .then(() => Personas.save(PERSONAS_PATH, personas))
    .catch(e => console.error('[persone] salvataggio fallito:', e.message))
}

const activePersona = () => (personas ? Personas.active(personas) : null)

// La voce della persona attiva e' quella in uso adesso (si cambia anche dalla
// scheda Voce); le altre hanno quella ricordata.
function personasPublic() {
  const current = voiceConfig(loadConfig())
  return {
    activeId: personas.activeId,
    // Chi e' sul desktop (Blocco 8b), e quanti ce ne stanno.
    open: companions.map(c => c.personaId),
    maxOpen: Companions.MAX_OPEN,
    list: personas.list.map(({ id, name, prompt, voice }) => {
      const v = id === personas.activeId ? current : { ...current, ...(voice || {}) }
      return { id, name, prompt, voice: { engine: v.engine, kokoroVoice: v.kokoroVoice, xttsSpeaker: v.xttsSpeaker } }
    }),
  }
}

/** Lascia la persona attiva (ricordando avatar e voce) e passa a id. */
async function switchPersona(id) {
  // Il companion della persona attiva, se e' aperto.
  const current = companions.find(x => personas && x.personaId === personas.activeId) || null
  if (!personas || id === personas.activeId || (current && current.busy)) return false
  const cfg = loadConfig()
  const next = Personas.activate(Personas.snapshot(personas, { avatarModel: cfg.avatarModel, voice: cfg.voice }), id)
  if (!next) return false
  if (current) await current.moodSaved()
  personas = next
  savePersonas()
  const p = activePersona()
  const merged = mergeConfig(cfg, { voice: p.voice || {} })
  merged.avatarModel = p.avatarModel || ''
  saveConfig(merged)
  const already = companions.find(x => x.personaId === id)
  if (already) {
    // Gia' sul desktop: la chat passa a lui, e ne mostra l'umore.
    already.broadcastMood()
  } else {
    // Non e' sul desktop: il companion della chat diventa lui.
    const c = current || companions[0]
    if (c) {
      await c.setPersona(id)
      // L'avatar lo cambia il companion, come dal menu ('' = il predefinito).
      let avatarId = p.avatarModel
      if (!avatarId && avatarLibrary) {
        const avatars = await avatarLibrary.list().catch(() => [])
        avatarId = (avatars.find(a => a.default) || avatars[0] || {}).id
      }
      if (avatarId) c.send('menu-command', { cmd: 'avatar', id: avatarId })
      saveOpen()
    }
  }
  syncVoice(merged)
  sendChatConfig(merged)
  console.log('[persone] attiva:', p.id)
  return true
}

handle('personas:get', () => personasPublic())
handle('personas:change', async (_e, input) => {
  const op = input && input.op
  const id = input && typeof input.id === 'string' ? input.id : ''
  let next = null
  if (op === 'create') {
    const made = Personas.create(personas, input.name, input.prompt)
    if (made) next = made.state
  } else if (op === 'update') {
    // La voce passa dai controlli di sempre (mergeVoice) prima di salvarla.
    const voice = input.voice && typeof input.voice === 'object' ? mergeConfig(loadConfig(), { voice: input.voice }).voice : undefined
    next = Personas.update(personas, id, { name: input.name, prompt: input.prompt, voice })
    // Per la persona attiva la voce vale subito.
    if (next && voice && id === personas.activeId) {
      const merged = mergeConfig(loadConfig(), { voice })
      saveConfig(merged)
      syncVoice(merged)
    }
  }
  else if (op === 'remove') {
    if (id === personas.activeId) return { ok: false, error: 'Attiva prima un\'altra persona.' }
    // Sul desktop: prima si toglie da li'.
    const open = companions.find(c => c.personaId === id)
    if (open) {
      if (open.busy) return { ok: false, error: 'Non adesso: aspetta la risposta.' }
      closeCompanion(open)
      saveOpen()
      buildTrayMenu()
    }
    next = Personas.remove(personas, id)
    // Memoria e umore se ne vanno con lei; "default" non ha una cartella sua.
    if (next && id !== 'default') {
      for (const dir of [Personas.personaDir(MEMORY_PATH, id), path.join(MEMORY_PATH, 'active', id), path.join(MEMORY_PATH, 'archive', id)]) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }
  } else if (op === 'open' || op === 'close') {
    const r = await setCompanionOpen(id, op === 'open')
    return r.ok ? { ok: true, personas: personasPublic() } : r
  } else if (op === 'activate') {
    return (await switchPersona(id)) ? { ok: true, personas: personasPublic() } : { ok: false, error: 'Non adesso: aspetta la risposta.' }
  }
  if (!next) return { ok: false, error: 'Richiesta non valida.' }
  personas = next
  savePersonas()
  sendChatConfig(loadConfig())
  return { ok: true, personas: personasPublic() }
})

// ─── Diario (Blocco 6c) ──────────────────────────────────────────────────────
// Una voce per l'ultimo giorno in cui vi siete parlati, scritta al primo avvio
// del giorno dopo (e al cambio di persona, e dal timer orario se l'app resta
// accesa a cavallo della mezzanotte). Senza chiave o con un errore si salta:
// riprova la volta dopo.
const diaryPath = (id) => path.join(Personas.personaDir(MEMORY_PATH, id), 'diary.jsonl')

handle('personas:diary', async (_e, id) => {
  if (!personas || !personas.list.some(p => p.id === id)) return []
  return (await Diary.loadDiary(diaryPath(id))).slice(0, Diary.MAX_ENTRIES_SHOWN)
})

// ─── Companion (Blocco 8) ────────────────────────────────────────────────────
// Ogni companion sul desktop e' un'istanza di companion.js, abitata da una
// persona, con la sua finestra, il suo umore, la sua memoria e la sua vita.
// Qui il registro, chi parla con la chat, e quello che condividono (ctx).
/** @type {any[]} */
const companions = []

/** Il companion con cui parla la chat: quello della persona attiva, o il primo. */
function chatTarget() {
  return companions.find(c => personas && c.personaId === personas.activeId) || companions[0] || null
}
/** Il companion che ha mandato un messaggio, riconosciuto dalla sua finestra. */
function companionOf(event) {
  const w = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null
  return (w && companions.find(c => c.win === w)) || null
}
/** Il companion nella stanza, se c'e'. */
const roomHost = () => companions.find(c => c.viewMode === 'room') || null
/** Un messaggio al companion con cui parla la chat. */
function sendCompanion(channel, data) {
  const c = chatTarget()
  if (c) c.send(channel, data)
}
/** Un messaggio a tutti i companion. */
function sendAll(channel, data) {
  for (const c of companions) c.send(channel, data)
}
/** La finestra a cui appoggiare un dialogo: il companion della chat, se c'e'. */
function dialogParent() {
  const c = chatTarget()
  return c && c.alive() ? c.win : null
}

// Le preferenze di comportamento, uguali per tutti (applyWindowOptions).
const prefs = { idleLife: true, touch: true, followMouse: true, perch: true }
// Solo per audit.mjs: un cursore finto per la sbirciata.
let testCursor = null

const companionCtx = {
  MEMORY_PATH, MEMORY_CONTEXT_TOKENS, prefs,
  loadConfig, saveConfig, sendSettings,
  memoryModel: () => memoryModelFrom(loadConfig()),
  diaryPath: (id) => diaryPath(id),
  persona: (id) => (personas ? personas.list.find(p => p.id === id) || null : null),
  chat: () => (chatWindow && !chatWindow.isDestroyed() ? chatWindow : null),
  isChatTarget: (c) => chatTarget() === c,
  lastForeign: () => lastForeign,
  testCursor: () => testCursor,
  listening: () => micBusy || !!micHold,
  voiceOn: () => voiceConfig(loadConfig()).enabled,
  speak: (c, text) => speakReply(c, text),
  avatarLibrary: () => avatarLibrary,
  kimodo: () => kimodo,
  motionsEnabled: (avatarId) => motionsEnabled(avatarId),
  expectMotion: (prompt, seconds) => {
    const key = cacheKey(prompt, seconds)
    expectedMotions.set(key, prompt)
    return key
  },
  refreshWeather: () => { refreshWeather().catch(() => {}) },
  onViewChanged: () => onViewChanged(),
  toggleChat: () => toggleChat(),
  openSettings: (page) => openSettings(page),
  setOption: (partial) => setOption(partial),
  sceneMenu: (cfg, command) => sceneMenu(cfg, command),
  previewMenu: (command) => previewMenu(command),
  openAnimationsFolder: () => openAnimationsFolder(),
  companionsMenu: () => companionsMenu(),
  quit: () => app.quit(),
  // Gli altri companion, per non sovrapporsi (camminata, rilascio, seduta).
  othersRects: (me) => companions.filter(o => o !== me && o.alive() && o.win.isVisible() && o.viewMode === 'desktop').map(o => o.bounds),
  // Dove nasce: dove era l'ultima volta, se e' ancora su uno schermo e non
  // copre nessuno; se no un posto libero in basso a destra.
  spotFor: (id, size) => {
    const saved = (loadConfig().companionSpots || {})[id]
    const taken = companions.filter(o => o.personaId !== id && o.alive()).map(o => o.bounds)
    const areas = screen.getAllDisplays().map(d => d.workArea)
    if (Companions.onSomeArea(saved, size, areas) && !taken.some(t => Companions.overlaps({ ...saved, ...size }, t))) return { x: saved.x, y: saved.y }
    return Companions.freeSpot(screen.getPrimaryDisplay().workArea, size, taken)
  },
  saveSpot: (id, b) => {
    const cfg = loadConfig()
    cfg.companionSpots = { ...(cfg.companionSpots || {}), [id]: { x: b.x, y: b.y } }
    saveConfig(cfg)
  },
}

/** Apre il companion della persona id (al massimo Companions.MAX_OPEN). */
function openCompanion(id) {
  if (companions.some(c => c.personaId === id) || companions.length >= Companions.MAX_OPEN) return null
  const used = new Set(companions.map(c => c.slot))
  let slot = 0
  while (used.has(slot)) slot++
  const c = createCompanion(companionCtx, id, { slot })
  companions.push(c)
  c.initMemory()
  c.createWindow()
  c.initMood().catch(e => console.error('[mood] caricamento fallito:', e.message))
  return c
}

/**
 * Stanza aperta o chiusa. Finche' gli altri non entrano anche loro nella
 * stanza (Blocco 8e), si nascondono e tornano quando si chiude.
 */
function onViewChanged() {
  const host = roomHost()
  for (const c of companions) {
    if (c === host || !c.alive()) continue
    if (host) c.win.hide()
    else c.win.showInactive()
  }
  buildTrayMenu()
}

/** Chiude un companion: torna dalla stanza, ricorda il posto, chiude la finestra. */
function closeCompanion(c) {
  if (c.viewMode === 'room') c.setView('desktop')
  c.shutdown()
  if (speakingCompanion === c) { if (voiceService) voiceService.stop(); speakingCompanion = null }
  const i = companions.indexOf(c)
  if (i >= 0) companions.splice(i, 1)
  if (c.alive()) c.win.destroy()
}

/** Le persone sul desktop, nell'ordine in cui si sono aperte: si ricordano. */
function saveOpen() {
  const cfg = loadConfig()
  cfg.openPersonas = companions.map(c => c.personaId)
  saveConfig(cfg)
}

/**
 * Mette o toglie dal desktop il companion di una persona. Ne resta sempre
 * almeno uno; se si toglie quello della chat, la chat passa a un altro.
 * @returns {{ ok: boolean, error?: string }}
 */
async function setCompanionOpen(id, on) {
  if (!personas || !personas.list.some(p => p.id === id)) return { ok: false, error: 'Persona non trovata.' }
  const open = companions.find(c => c.personaId === id)
  if (on) {
    if (open) return { ok: true }
    if (companions.length >= Companions.MAX_OPEN) return { ok: false, error: 'Sul desktop ci stanno al massimo ' + Companions.MAX_OPEN + ' companion.' }
    const c = openCompanion(id)
    // Appena arrivato saluta gli altri, quando la sua finestra e' pronta.
    if (c && c.alive()) c.win.webContents.once('did-finish-load', () => setTimeout(() => {
      greetArrival(c).catch(e => console.error('[iniziativa] saluto non riuscito:', e.message))
    }, ARRIVAL_GREET_MS))
  } else {
    if (!open) return { ok: true }
    if (companions.length <= 1) return { ok: false, error: 'Almeno un companion resta sul desktop.' }
    if (open.busy) return { ok: false, error: 'Non adesso: aspetta la risposta.' }
    const wasTarget = open === chatTarget()
    closeCompanion(open)
    if (wasTarget) await switchPersona(companions[0].personaId)
  }
  saveOpen()
  buildTrayMenu()
  sendChatConfig(loadConfig())
  console.log('[companion] sul desktop: ' + companions.map(c => c.personaId).join(', '))
  return { ok: true }
}

/** "Companion": le persone, spuntate quelle sul desktop. Per la tray e il tasto destro. */
function companionsMenu() {
  const full = companions.length >= Companions.MAX_OPEN
  return {
    label: 'Companion sul desktop',
    submenu: personas.list.map(p => {
      const isOpen = companions.some(c => c.personaId === p.id)
      return {
        label: p.name.replace(/&/g, '&&'), type: /** @type {const} */ ('checkbox'), checked: isOpen,
        enabled: isOpen ? companions.length > 1 : !full,
        click: () => { setCompanionOpen(p.id, !isOpen).catch(e => console.error('[companion]', e.message)) },
      }
    }),
  }
}

// ─── Chat Window ─────────────────────────────────────────────────────────────

function createChatWindow() {
  const area = screen.getPrimaryDisplay().workArea

  chatWindow = new BrowserWindow({
    width: 380, height: 520,
    x: area.x + area.width - 420, y: area.y + area.height - 580,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  chatWindow.loadFile(path.join(__dirname, '../renderer/chat.html'))
  chatWindow.setAlwaysOnTop(true, 'screen-saver')
  // Nella stanza la scena lascia alla chat il lato destro solo se si vede.
  chatWindow.on('show', () => { const h = roomHost(); if (h) h.sendViewMode() })
  chatWindow.on('hide', () => { const h = roomHost(); if (h) h.sendViewMode() })

  if (process.argv.includes('--dev')) {
    chatWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── Impostazioni ────────────────────────────────────────────────────────────
// Una finestra normale, con cornice: si apre dal menu col tasto destro, dalla
// tray e dalla chat. Schede: Modello, Generale, Voce, Microfono. page sceglie
// la scheda (la chat apre Modello); senza, si riapre sull'ultima usata.

const SETTINGS_PAGES = ['modello', 'generale', 'persone', 'memoria', 'voce', 'microfono', 'movimenti', 'strumenti', 'live2d']

function openSettings(page) {
  page = SETTINGS_PAGES.includes(page) ? page : ''
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (page) sendSettings('settings-page', page)
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 560, height: 640, minWidth: 440, minHeight: 420,
    title: 'Impostazioni — CompanionAI',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#151416',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  settingsWindow.setMenu(null)
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'), page ? { hash: page } : undefined)
  settingsWindow.once('ready-to-show', () => settingsWindow && settingsWindow.show())
  settingsWindow.on('closed', () => { settingsWindow = null })
}

function sendSettings(channel, data) {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  try { settingsWindow.webContents.send(channel, data) } catch (_) {}
}

// ─── Live2D: il Cubism Core (live2d-core.js) ─────────────────────────────────
// Si scarica dalle Impostazioni, solo dopo che l'utente ha accettato la
// licenza di Live2D (live2dAccepted). Lo stato va alle Impostazioni e al
// companion, che puo' mostrare un avatar Live2D appena il Core arriva.
const live2dDir = () => path.join(app.getPath('userData'), 'live2d')
let live2dInstall = null   // { step, index, count, label, done, total } mentre installa
let live2dAbort = null
let live2dError = null
function live2dStatus() {
  return { installed: live2dCore.coreInstalled(live2dDir()), installing: live2dInstall, error: live2dError, sdk: live2dCore.SDK_VERSION }
}
function sendLive2DStatus() {
  const status = live2dStatus()
  sendSettings('live2d-status', status)
  sendCompanion('live2d-status', status)
}

// ─── Voce (voice.js) ─────────────────────────────────────────────────────────
// Kokoro gira in un processo di utilita' (kokoro-worker.js): il main lo avvia
// alla prima frase e gli passa la cartella con i file scaricati. XTTS e' un
// servizio Python (xtts-engine.js), acceso finche' la voce XTTS o il
// microfono (faster-whisper, nello stesso servizio) sono in uso.

function initVoice() {
  const dir = path.join(app.getPath('userData'), 'voice')
  // Solo per l'audit: i file da un server locale invece che da Internet.
  const fake = process.env.COMPANION_VOICE_ASSETS_URL
  const baseUrl = typeof fake === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(fake) ? fake : undefined
  voiceService = new VoiceService({
    dir,
    baseUrl,
    xtts: new XttsEngine({ root: path.join(dir, 'xtts'), samplesDir: path.join(dir, 'samples') }),
    spawn: () => {
      const child = utilityProcess.fork(path.join(__dirname, 'kokoro-worker.js'), [dir], { serviceName: 'CompanionAI voce', stdio: 'pipe' })
      const log = (stream, level) => stream && stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(line => console[level]('[voce] ' + line)))
      log(child.stdout, 'log')
      log(child.stderr, 'warn')
      return {
        send: (msg) => child.postMessage(msg),
        onMessage: (fn) => child.on('message', fn),
        onExit: (fn) => child.on('exit', fn),
        kill: () => child.kill(),
      }
    },
    // L'audio va al companion che parla: e' lui a muovere la bocca.
    play: (msg) => {
      // Quanto parlera' ancora: chi risponde per secondo aspetta (chat di gruppo).
      const secs = msg.type === 'chunk' && msg.pcm && msg.rate ? msg.pcm.length / msg.rate : msg.type === 'gap' ? Number(msg.seconds) || 0 : 0
      if (msg.type === 'stop') speechEndsAt = 0
      else if (secs > 0) speechEndsAt = Math.max(Date.now(), speechEndsAt) + secs * 1000
      const c = speakingCompanion && speakingCompanion.alive() ? speakingCompanion : chatTarget()
      if (c) c.send('voice-audio', msg)
    },
    onStatus: (status) => sendSettings('voice-status', status),
  })
  syncVoice(loadConfig())
}

/**
 * Il servizio della voce locale acceso solo se serve: voce accesa con XTTS,
 * o microfono acceso. Con la config si aggiornano anche il permesso del
 * microfono e la scorciatoia.
 */
function syncVoice(cfg) {
  const voice = voiceConfig(cfg)
  micAllowed = !!voice.micEnabled
  if (voiceService) voiceService.syncService({ tts: voice.enabled && voice.engine === 'xtts', stt: voice.micEnabled })
  syncMicShortcut(voice)
}

// ─── Microfono ───────────────────────────────────────────────────────────────
// La registrazione la fa la chat (mic-recorder.js), il testo lo scrive Whisper
// nel servizio della voce. Qui: il permesso del browser, la scorciatoia
// globale e il fumetto "Ti ascolto…" sul companion.
//
// La scorciatoia si tiene premuta per parlare: Electron dice solo quando la
// si preme, quindi finche' si registra si guarda il tasto con koffi
// (win-windows.js). Un tocco breve lascia il microfono aperto fino al tocco
// successivo; senza koffi funziona sempre cosi'.

let micAllowed = false   // voice.micEnabled, per i gestori dei permessi
let micShortcut = null   // l'acceleratore registrato
let micHold = null       // { started, toggle, poll } mentre la scorciatoia tiene aperto il microfono
let micBusy = false      // il microfono ascolta o trascrive (mic:state), da chat o da scorciatoia
const MIC_TAP_MS = 350

function syncMicShortcut(voice) {
  const want = voice.micEnabled && voiceService && voiceService.sttInstalled() && voice.micShortcut !== 'off' ? voice.micShortcut : null
  if (want === micShortcut) return
  if (micShortcut) { try { globalShortcut.unregister(micShortcut) } catch (_) {} }
  micShortcut = null
  endMicHold(null)
  if (!want) return
  const vk = MIC_SHORTCUTS[want].vk
  if (globalShortcut.register(want, () => onMicShortcut(vk))) micShortcut = want
  else console.warn('[mic] la scorciatoia ' + want + ' e\' gia\' usata da un altro programma')
}

function sendMicCommand(cmd) {
  if (chatWindow && !chatWindow.isDestroyed()) {
    try { chatWindow.webContents.send('mic-command', { cmd }) } catch (_) {}
  }
}

function onMicShortcut(vk) {
  if (micHold) {
    // Il tasto tenuto giu' si ripete: si ignora. Dopo un tocco breve, il
    // tocco successivo chiude.
    if (micHold.toggle) endMicHold('stop')
    return
  }
  if (!chatWindow || chatWindow.isDestroyed()) return
  // Con la voce spenta la risposta si vede solo nella chat: la si apre.
  if (!voiceConfig(loadConfig()).enabled && !chatWindow.isVisible()) toggleChat()
  micHold = { started: Date.now(), toggle: !winWindows.available(), poll: null }
  sendMicCommand('start')
  if (micHold.toggle) return
  micHold.poll = setInterval(() => {
    if (!micHold || winWindows.isKeyDown(vk)) return
    clearInterval(micHold.poll)
    micHold.poll = null
    if (Date.now() - micHold.started < MIC_TAP_MS) micHold.toggle = true
    else endMicHold('stop')
  }, 40)
}

function endMicHold(cmd) {
  const hold = micHold
  micHold = null
  if (hold && hold.poll) clearInterval(hold.poll)
  if (hold && cmd) sendMicCommand(cmd)
}

// La voce di XTTS: il campione dell'utente se c'e', altrimenti una inclusa.
const XTTS_FALLBACK_SPEAKER = 'Ana Florence'
function xttsSpeaker(voice) {
  if (voice.xttsSpeaker !== 'sample') return { builtin: voice.xttsSpeaker }
  const sample = voiceService && voiceService.samplePath(voice.xttsSample)
  return sample ? { sample } : { builtin: XTTS_FALLBACK_SPEAKER }
}

function speakOptions(voice) {
  return { engine: voice.engine, voice: voice.kokoroVoice, speaker: xttsSpeaker(voice), speed: voice.speed, volume: voice.volume }
}

/**
 * La voce di un companion: quella della sua persona. Per la persona attiva e'
 * quella della scheda Voce (switchPersona ce la copia); accensione, volume e
 * microfono sono dell'app.
 */
function voiceFor(c) {
  const base = voiceConfig(loadConfig())
  const p = c && c.persona()
  if (!p || !p.voice || (personas && p.id === personas.activeId)) return base
  return { ...base, ...p.voice }
}

// Chi sta parlando adesso: l'audio va alla sua finestra (una voce alla volta).
let speakingCompanion = null

/** Legge ad alta voce una risposta del companion c, se la voce e' accesa. */
function speakReply(c, text) {
  const voice = voiceFor(c)
  if (!voice.enabled || !voiceService) return
  speakingCompanion = c
  voiceService.speak(text, speakOptions(voice))
    .catch(e => console.error('[voce] ' + e.message))
}

// ─── Tray Icon ───────────────────────────────────────────────────────────────

function createTray() {
  // L'icona la genera scripts/make-icon.js (npm run icon), lanciato dagli hook
  // prestart/prebuild. Il vecchio fallback silenzioso a createEmpty() lasciava
  // un quadratino invisibile nella barra di sistema senza dire perche'.
  // tray.png e' il logo a 16 px; tray-2x.png (32 px) serve agli schermi con
  // scala 200%.
  let icon = nativeImage.createEmpty()
  try {
    const assets = path.join(__dirname, '..', 'renderer', 'assets')
    const trayPath = path.join(assets, 'tray.png')
    const tray2xPath = path.join(assets, 'tray-2x.png')
    const iconPath = path.join(assets, 'icon.png')
    if (fs.existsSync(trayPath)) {
      icon = nativeImage.createFromPath(trayPath)
      if (fs.existsSync(tray2xPath)) {
        icon.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(tray2xPath) })
      }
    } else if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    } else {
      console.warn('[tray] icona assente: esegui "npm run icon" per generarla')
    }
  } catch (e) { console.warn('[tray] icona non caricata:', e.message) }
  tray = new Tray(icon)
  tray.setToolTip('CompanionAI')
  buildTrayMenu()
  tray.on('click', () => toggleChat())
}

// Il menu della tray cambia con la modalita': si ricostruisce a ogni cambio.
function buildTrayMenu() {
  if (!tray) return
  const host = roomHost()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostra companion',  click: () => { for (const c of companions) if (c.alive()) c.win.show() } },
    { label: 'Apri chat',         click: () => toggleChat() },
    ...(personas ? [companionsMenu()] : []),
    host
      ? { label: 'Torna sul desktop', click: () => host.setView('desktop') }
      : { label: 'Apri la stanza', click: () => { const c = chatTarget(); if (c) c.setView('room') } },
    { label: 'Impostazioni…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Apri cartella dei log', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')).catch(() => {}) },
    { type: 'separator' },
    { label: 'Esci',              click: () => app.quit() },
  ]))
}

// ─── Toggle Chat ─────────────────────────────────────────────────────────────

function toggleChat() {
  if (!chatWindow || chatWindow.isDestroyed()) return
  if (chatWindow.isVisible()) {
    chatWindow.hide()
  } else if (roomHost()) {
    // Nella stanza la chat ha il suo posto, a destra.
    roomHost().dockChat()
    chatWindow.show()
    chatWindow.focus()
  } else {
    try {
      // In alto a sinistra del companion, ma dentro lo schermo su cui si trova:
      // con il companion vicino al bordo la chat finiva in parte fuori vista.
      const c = chatTarget()
      const pos = c && c.alive() ? c.win.getPosition() : [100, 100]
      const area = c ? c.workArea() : screen.getPrimaryDisplay().workArea
      const [w, h] = chatWindow.getSize()
      const x = Math.max(area.x, Math.min(pos[0] - 210, area.x + area.width - w))
      const y = Math.max(area.y, Math.min(pos[1] - 270, area.y + area.height - h))
      chatWindow.setPosition(Math.round(x), Math.round(y))
    } catch (_) {}
    chatWindow.show()
    chatWindow.focus()
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
// Ogni canale accetta messaggi solo dalle pagine di src/renderer/ (vedi
// isTrustedSender in guards.js): gli handler salvano chiavi, leggono la memoria
// e lanciano azioni sul sistema.

const RENDERER_DIR_URL = require('url').pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href

function trusted(event, channel) {
  const url = event.senderFrame && event.senderFrame.url
  if (isTrustedSender(url, RENDERER_DIR_URL)) return true
  console.warn('[ipc] ' + channel + ' rifiutato: mittente non attendibile (' + url + ')')
  return false
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event, channel)) throw new Error('richiesta non autorizzata')
    return fn(event, ...args)
  })
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => { if (trusted(event, channel)) fn(event, ...args) })
}

on('toggle-chat', () => toggleChat())

// Config
// Un companion vede come avatar quello della sua persona.
function configFor(e, cfg) {
  const c = companionOf(e)
  const pub = publicConfig(cfg)
  if (c) pub.avatarModel = c.avatarId() || (c === chatTarget() ? cfg.avatarModel : '')
  return pub
}

handle('config:get', (e) => configFor(e, loadConfig()))

handle('config:set', async (e, newCfg) => {
  // L'avatar scelto da un companion e' della sua persona; nella config resta
  // quello della persona attiva (Impostazioni e chat lo leggono da li').
  const from = companionOf(e)
  if (from && newCfg && typeof newCfg.avatarModel === 'string' && personas) {
    personas = Personas.setAvatar(personas, from.personaId, newCfg.avatarModel)
    savePersonas()
    if (from !== chatTarget()) {
      const { avatarModel, ...rest } = newCfg
      newCfg = rest
    }
  }
  const current = loadConfig()
  const merged  = mergeConfig(current, newCfg || {})
  saveConfig(merged)
  // Acceso il meteo o cambiata citta': si chiede subito, e la risposta dice
  // alla chat se la citta' e' stata trovata.
  if (merged.weather !== current.weather || merged.weatherCity !== current.weatherCity) {
    await refreshWeather({ force: true })
  }
  // La chiave inserita adesso deve servire anche ai riassunti, non solo dal
  // prossimo avvio. loadConfig riapplica il fallback sulle variabili d'ambiente.
  for (const c of companions) if (c.memory) c.memory.setModel(memoryModelFrom(loadConfig()))
  applyWindowOptions(merged)
  syncVoice(merged)
  // Chat e Impostazioni si aggiornano a vicenda: provider e modello per
  // l'intestazione della chat, il microfono per il suo pulsante, gli
  // interruttori di Generale. La finestra che ha salvato riceve la stessa config.
  sendChatConfig(merged)
  return configFor(e, merged)
})

// Ollama dall'app (Blocco 7a): avviare il server, accedere per i modelli cloud,
// scaricare un modello, aprire le pagine dei modelli. Comandi e indirizzi fissi.
const ollamaTools = require('./ollama')
const OLLAMA_PAGES = { models: 'https://ollama.com/search' }
handle('ollama:signin', async () => {
  const r = await ollamaTools.signin()
  if (r.url) shell.openExternal(r.url).catch(() => {})
  return r
})
handle('ollama:pull', (e, name) => ollamaTools.pull(String(name || '').trim(), (progress) => {
  try { e.sender.send('ollama-pull-progress', progress) } catch (_) {}
}))
handle('ollama:open-page', (_e, which) => {
  if (OLLAMA_PAGES[which]) shell.openExternal(OLLAMA_PAGES[which]).catch(() => {})
})

// Guarda lo schermo (Blocco 7b): schermata del monitor del companion, con le
// finestre dell'app trasparenti per un istante. Va alla chat come anteprima:
// al modello arriva solo se l'utente la invia.
const VISION_LONG_SIDE = 1568
handle('vision:capture', async () => {
  const anchor = dialogParent() || chatWindow
  if (!anchor || anchor.isDestroyed()) return { ok: false, error: 'Nessuna finestra' }
  const display = screen.getDisplayMatching(anchor.getBounds())
  const wins = [...companions.map(c => c.win), chatWindow, settingsWindow].filter(w => w && !w.isDestroyed() && w.isVisible())
  const scale = VISION_LONG_SIDE / Math.max(display.size.width, display.size.height)
  try {
    for (const w of wins) w.setOpacity(0)
    await new Promise(r => setTimeout(r, 250))
    const sources = await desktopCapturer.getSources({ types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } })
    const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
    if (!source) return { ok: false, error: 'Schermo non trovato' }
    return { ok: true, image: 'data:image/jpeg;base64,' + source.thumbnail.toJPEG(80).toString('base64') }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    for (const w of wins) if (!w.isDestroyed()) w.setOpacity(1)
  }
})

// Movimenti generati con Kimodo (Blocco 7d): elenco, nome, prova, eliminazione.
handle('motions:list', () => (kimodo ? kimodo.list() : []))
handle('motions:rename', (_e, key, name) => (kimodo && typeof key === 'string' ? kimodo.rename(key, typeof name === 'string' ? name : '') : false))
handle('motions:remove', (_e, key) => (kimodo && typeof key === 'string' ? kimodo.remove(key) : false))
handle('motions:preview', async (_e, key) => {
  if (!kimodo || typeof key !== 'string' || !kimodo.resolve(key)) return false
  const g = (await kimodo.list()).find(m => m.key === key)
  sendCompanion('menu-command', { cmd: 'preview-clip', url: 'motion://generated/' + key, name: (g && (g.name || g.prompt)) || 'movimento generato' })
  return true
})

// Foto (Blocco 7e): il PNG arriva dalla stanza, e dove salvarlo lo sceglie l'utente.
const PHOTO_RE = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/
handle('photo:save', async (_e, dataUrl) => {
  const m = typeof dataUrl === 'string' && dataUrl.length <= 60 * 1024 * 1024 ? dataUrl.match(PHOTO_RE) : null
  if (!m) return { ok: false, error: 'Immagine non valida.' }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  const parent = dialogParent() || undefined
  const picked = await dialog.showSaveDialog(parent, {
    title: 'Salva la foto',
    defaultPath: path.join(app.getPath('pictures'), 'CompanionAI-' + stamp + '.png'),
    filters: [{ name: 'Immagine PNG', extensions: ['png'] }],
  })
  if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
  const file = /\.png$/i.test(picked.filePath) ? picked.filePath : picked.filePath + '.png'
  await fs.promises.writeFile(file, Buffer.from(m[1], 'base64'))
  return { ok: true, path: file }
})

// ─── Connettori MCP (Blocco 7f) ──────────────────────────────────────────────
// Due tipi, come i connettori di Claude: remoti (nome e URL, con login OAuth o
// token quando servono) e sul PC (un comando, per esempio i file di una
// cartella). L'azione del modello si controlla (mcp.js), poi l'utente la
// conferma a parole semplici; per gli strumenti che leggono soltanto puo'
// dire "non chiedermelo piu'".
const Connectors = require('./connectors')
const McpOAuth = require('./mcp-oauth')
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// Segreti dei connettori (token di accesso, token personali): un file a parte,
// ogni voce cifrata con il portachiavi di Windows (safeStorage). Senza
// cifratura restano solo in memoria fino all'uscita.
const MCP_SECRETS_PATH = path.join(os.homedir(), '.desktop-companion', 'mcp-secrets.json')
let mcpSecrets = null
function loadMcpSecrets() {
  if (mcpSecrets) return mcpSecrets
  mcpSecrets = {}
  try {
    const raw = JSON.parse(fs.readFileSync(MCP_SECRETS_PATH, 'utf8'))
    for (const [id, value] of Object.entries(raw || {})) {
      try { mcpSecrets[id] = JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) } catch (_) {}
    }
  } catch (_) {}
  return mcpSecrets
}
function setMcpSecret(id, data) {
  const all = loadMcpSecrets()
  if (data) all[id] = data
  else delete all[id]
  if (!safeStorage.isEncryptionAvailable()) return
  const out = {}
  for (const [k, v] of Object.entries(all)) out[k] = safeStorage.encryptString(JSON.stringify(v)).toString('base64')
  try {
    fs.mkdirSync(path.dirname(MCP_SECRETS_PATH), { recursive: true })
    fs.writeFileSync(MCP_SECRETS_PATH, JSON.stringify(out))
  } catch (e) { console.error('[mcp] segreti non salvati:', e.message) }
}
const tokenOf = (id) => () => { const s = loadMcpSecrets()[id]; return (s && (s.access_token || s.api_key)) || null }
const clientOf = (server) => Mcp.clientFor(server, tokenOf(server.id))

class NeedsLogin extends Error {
  constructor(server) { super(server.name + ' chiede di accedere di nuovo'); this.needsLogin = true }
}

/**
 * Esegue fn(client) con l'accesso in ordine: token scaduto -> si rinnova; il
 * server dice 401 -> si rinnova e si riprova una volta; senza rinnovo possibile
 * -> NeedsLogin (o il login, se interactive).
 */
async function withMcpAuth(server, fn, { interactive = false } = {}) {
  const renew = async () => {
    const saved = loadMcpSecrets()[server.id]
    const tokens = await McpOAuth.refresh(saved, server.url)
    setMcpSecret(server.id, { ...saved, ...tokens })
  }
  const saved = loadMcpSecrets()[server.id]
  if (server.url && McpOAuth.expired(saved)) await renew().catch(() => {})
  try {
    return await fn(clientOf(server))
  } catch (e) {
    if (!e || !e.authRequired || !server.url) throw e
    if (loadMcpSecrets()[server.id]?.refresh_token) {
      try { await renew(); return await fn(clientOf(server)) } catch (again) { if (!again || !again.authRequired) throw again }
    }
    if (!interactive || server.auth === 'token') throw server.auth === 'token' ? new Error('il token non è valido o è scaduto') : new NeedsLogin(server)
    // Login nel browser, poi di nuovo.
    const { tokens, client, meta } = await McpOAuth.login(server.url, e.wwwAuthenticate, (url) => shell.openExternal(url))
    setMcpSecret(server.id, { ...tokens, token_endpoint: meta.token_endpoint, client_id: client.client_id, client_secret: client.client_secret })
    Mcp.clientFor(server, tokenOf(server.id)).stop()
    return fn(clientOf(server))
  }
}

const MAX_TOOL_STEPS = 3

/** @param {any} action @param {any} c il companion che chiede lo strumento */
async function useTool(action, c) {
  const checked = Mcp.checkToolAction(action, loadConfig().mcpServers)
  // Una chiamata sbagliata torna al modello, che puo' correggerla.
  if ('error' in checked) {
    console.warn('[mcp] azione rifiutata:', checked.error)
    return { error: checked.error }
  }
  const { server, tool, args } = checked
  const label = Mcp.toolLabel(tool.name)
  if (!server.trusted.includes(tool.name)) {
    const who = (c && c.persona() && c.persona().name) || 'Il companion'
    const options = {
      type: /** @type {const} */ ('question'), buttons: ['Non consentire', 'Consenti'], defaultId: 1, cancelId: 0,
      title: 'Permesso per un connettore',
      message: Mcp.knownLabel(tool.name) ? who + ' vuole ' + label : who + ' vuole usare «' + label + '» di ' + server.name,
      detail: 'Connettore: ' + server.name + (tool.readOnly ? ' (legge soltanto)' : ' (può modificare qualcosa)') +
        '\n\n' + Mcp.argsText(args) + (tool.description ? '\n\nCosa fa: ' + tool.description : ''),
      checkboxLabel: tool.readOnly ? 'Non chiedermelo più per questa azione' : undefined,
    }
    const parent = c && c.alive() ? c.win : null
    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (answer.response !== 1) return { notice: 'Non hai dato il permesso: il connettore non è stato usato.' }
    if (answer.checkboxChecked && tool.readOnly) {
      saveMcp(list => list.map(s => (s.id === server.id ? { ...s, trusted: [...s.trusted, tool.name] } : s)))
    }
  }
  try {
    const r = await withMcpAuth(server, client => client.callTool(tool.name, args))
    console.log('[mcp] ' + server.id + '/' + tool.name + ' eseguito')
    return { server, tool, text: Mcp.resultText(r), note: '🔧 ' + capital(label) + ' · ' + server.name }
  } catch (e) {
    console.error('[mcp] ' + server.id + '/' + tool.name + ' fallito:', e.message)
    if (e.needsLogin) return { notice: server.name + ' chiede di accedere di nuovo: Impostazioni → Connettori → «Accedi di nuovo».' }
    return { server, tool, text: 'ERRORE: ' + e.message, note: '🔧 ' + capital(label) + ' · ' + server.name + ': non è riuscito (' + friendlyMcpError(e.message) + ')' }
  }
}

/** Gli errori piu' comuni, detti in chiaro. */
function friendlyMcpError(message) {
  const m = String(message || '')
  if (/ENOENT|riconosciuto|is not recognized|non parte/i.test(m)) return 'il programma del connettore non si trova: per i connettori sul PC serve Node.js'
  if (/non ha risposto in/i.test(m)) return 'ci ha messo troppo a rispondere, riprova'
  if (/E404|404 Not Found/i.test(m)) return 'il pacchetto non esiste: controlla il nome'
  if (/non raggiungibile|ENOTFOUND|EAI_AGAIN|network/i.test(m)) return 'il server non si raggiunge: controlla l\'indirizzo e la connessione'
  if (/ha risposto 404/i.test(m)) return 'a quell\'indirizzo non c\'è un server MCP: controlla l\'URL'
  if (/accesso annullato|access_denied/i.test(m)) return 'l\'accesso è stato annullato'
  return m.slice(0, 200)
}

const mcpPublic = (servers) => {
  const secrets = loadMcpSecrets()
  return servers.map(s => ({
    id: s.id, name: s.name, url: s.url, auth: s.auth, command: s.command, args: s.args, envKeys: Object.keys(s.env), enabled: s.enabled,
    signedIn: !!(secrets[s.id] && (secrets[s.id].access_token || secrets[s.id].api_key)),
    tools: s.tools.map(t => ({ name: t.name, label: capital(Mcp.toolLabel(t.name)), description: t.description, readOnly: t.readOnly })),
    allowed: s.allowed, trusted: s.trusted,
  }))
}
function saveMcp(change) {
  const cfg = loadConfig()
  cfg.mcpServers = Mcp.cleanServers(change(cfg.mcpServers))
  saveConfig(cfg)
  return mcpPublic(cfg.mcpServers)
}
/** Un id nuovo dal nome, unico fra i connettori. */
function mcpId(list, name) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'connettore'
  let id = base
  for (let n = 2; list.some(s => s.id === id); n++) id = base + '-' + n
  return id
}

/** Legge gli strumenti (con il login se serve) e li salva; pick sceglie quelli permessi. */
async function connectMcp(id, pick) {
  const server = loadConfig().mcpServers.find(s => s.id === id)
  if (!server) return { ok: false, error: 'Connettore non trovato.' }
  try {
    const tools = await withMcpAuth(server, client => Mcp.listTools(client), { interactive: true })
    const servers = saveMcp(list => list.map(s => (s.id !== id ? s : {
      ...s, tools, auth: s.url && loadMcpSecrets()[id]?.access_token ? 'oauth' : s.auth,
      allowed: pick ? tools.filter(pick).map(t => t.name) : s.allowed.filter(n => tools.some(t => t.name === n)),
    })))
    return { ok: true, servers, id }
  } catch (e) {
    return { ok: false, error: friendlyMcpError(e.message) }
  }
}

/** Aggiunge un connettore e lo collega; se non va, lo toglie (con i suoi segreti). */
async function addAndConnect(def, pick, secret) {
  let id = null
  saveMcp(list => { id = mcpId(list, def.name); return [...list, { env: {}, args: [], ...def, id, enabled: true, tools: [], allowed: [] }] })
  if (!loadConfig().mcpServers.some(s => s.id === id)) return { ok: false, error: 'Al massimo 10 connettori.' }
  if (secret) setMcpSecret(id, secret)
  const r = await connectMcp(id, pick)
  if (!r.ok) {
    const server = loadConfig().mcpServers.find(s => s.id === id)
    if (server) clientOf(server).stop()
    setMcpSecret(id, null)
    saveMcp(list => list.filter(s => s.id !== id))
  }
  return r
}

handle('mcp:list', () => mcpPublic(loadConfig().mcpServers))
handle('mcp:catalog', () => Connectors.catalog(loadConfig().mcpServers))

// Node.js serve ai connettori sul PC (npx): si controlla prima, per dirlo in chiaro.
handle('mcp:node', () => new Promise((resolve) => {
  const child = require('child_process').spawn('node', ['--version'], { windowsHide: true })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.once('error', () => resolve(null))
  child.once('exit', (code) => resolve(code === 0 ? out.trim() : null))
}))
handle('mcp:open-node-page', () => { shell.openExternal('https://nodejs.org/it/download').catch(() => {}) })
// La pagina dove si crea il token di un connettore del catalogo (indirizzo dal catalogo, non dalla pagina).
handle('mcp:open-token-page', (_e, id) => {
  const c = Connectors.CONNECTORS.find(x => x.id === id && x.tokenUrl)
  if (c) shell.openExternal(c.tokenUrl).catch(() => {})
})

// Dal catalogo: tutti gli strumenti permessi, ognuno chiede comunque il permesso quando si usa.
handle('mcp:add-connector', async (_e, input) => {
  const c = Connectors.CONNECTORS.find(x => x.id === (input && input.id))
  if (!c) return { ok: false, error: 'Connettore sconosciuto.' }
  const token = input && typeof input.token === 'string' ? input.token.trim().slice(0, 500) : ''
  if (c.auth === 'token' && !token) return { ok: false, error: 'Serve il token.' }
  return addAndConnect({ name: c.name, url: c.url, auth: c.auth }, () => true, token ? { api_key: token } : null)
})

// Connettore personalizzato: nome e URL, con un token facoltativo; se il server chiede l'accesso, parte il login.
handle('mcp:add-remote', async (_e, input) => {
  const name = String((input && input.name) || '').trim().slice(0, 40)
  const url = String((input && input.url) || '').trim()
  const token = input && typeof input.token === 'string' ? input.token.trim().slice(0, 500) : ''
  if (!name || !url) return { ok: false, error: 'Servono un nome e l\'URL del server MCP.' }
  if (!require('./mcp-http').validUrl(url)) return { ok: false, error: 'L\'URL deve iniziare con https://' }
  return addAndConnect({ name, url, auth: token ? 'token' : 'none' }, () => true, token ? { api_key: token } : null)
})

// Sul PC: i file di una cartella scelta con il dialogo del main.
handle('mcp:add-files', async (_e, input) => {
  const parent = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
  const picked = await dialog.showOpenDialog(parent, { title: 'Quale cartella può usare?', properties: ['openDirectory'] })
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
  const write = !!(input && input.write === true)
  return addAndConnect(Mcp.filesServer(picked.filePaths[0]), t => write || t.readOnly)
})

// Sul PC, personalizzato (per esperti): comando, argomenti e variabili scritti a mano.
handle('mcp:add', async (_e, input) => {
  const name = String((input && input.name) || '').trim().slice(0, 40)
  const command = String((input && input.command) || '').trim()
  if (!name || !command) return { ok: false, error: 'Servono un nome e un comando.' }
  const env = {}
  for (const line of Array.isArray(input.env) ? input.env : []) {
    const m = typeof line === 'string' && line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return addAndConnect({ name, command, args: Array.isArray(input.args) ? input.args : [], env }, t => t.readOnly)
})
handle('mcp:update', (_e, input) => {
  const id = input && input.id
  return { ok: true, servers: saveMcp(list => list.map(s => (s.id !== id ? s : {
    ...s,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : s.enabled,
    allowed: Array.isArray(input.allowed) ? input.allowed : s.allowed,
    trusted: Array.isArray(input.trusted) ? input.trusted : s.trusted,
  }))) }
})
handle('mcp:remove', (_e, id) => {
  const server = loadConfig().mcpServers.find(s => s.id === id)
  if (server) clientOf(server).stop()
  setMcpSecret(id, null)
  return { ok: true, servers: saveMcp(list => list.filter(s => s.id !== id)) }
})
// "Aggiorna" / "Accedi di nuovo": rilegge gli strumenti, con il login se serve.
handle('mcp:connect', (_e, id) => connectMcp(id, null))
app.on('will-quit', () => Mcp.stopAll())

// Prova il modello (Blocco 7a): una richiesta minima, senza scorte ne'
// nuovi tentativi, con la chiave del campo (non ancora salvata) o quella salvata.
handle('ai:test-model', async (_e, input) => {
  const provider = input && typeof input.provider === 'string' ? input.provider : ''
  const model = input && typeof input.model === 'string' ? input.model.slice(0, 200) : ''
  if (!PROVIDERS[provider] || !model) return { ok: false, error: 'Scegli un provider e un modello.' }
  const typed = input && typeof input.key === 'string' ? input.key.trim().slice(0, 300) : ''
  const apiKey = typed || loadConfig().keys?.[provider] || ''
  const started = Date.now()
  try {
    const result = await route({
      provider, model, apiKey, fallback: false, retries: 0,
      history: [{ role: 'user', content: 'Ciao! Rispondi con una parola.' }],
    })
    const caps = await modelCapsOf(provider, model)
    return { ok: true, ms: Date.now() - started, format: result.via !== 'fallback', vision: !!(caps && caps.vision) }
  } catch (err) {
    return { ok: false, error: describeError(err, provider) }
  }
})

// ─── Chat (Blocco 8c: anche di gruppo) ──────────────────────────────────────
// Con un companion solo risponde lui, come sempre. Con piu' companion sul
// desktop si scrive a tutti: risponde chi e' chiamato per nome (o chi e'
// scelto dalla pastiglia nella chat), se no uno, e a volte un secondo che
// reagisce al primo (group-chat.js). La prima risposta torna subito alla
// chat; la seconda arriva dopo, con 'group-reply'. Tutti quelli sul desktop
// sentono la conversazione: va nella memoria di ciascuno.

// Fine stimata della voce in corso: chi risponde per secondo aspetta.
let speechEndsAt = 0
let lastSpeakerId = null
let groupTurn = 0

async function waitForSpeech(maxMs = 60000) {
  const until = Date.now() + maxMs
  while (Date.now() < Math.min(speechEndsAt, until)) await new Promise(r => setTimeout(r, 200))
}

/**
 * Una risposta del companion c: umore, modello, strumenti, memoria, voce.
 * @param {any} c
 * @param {{ cfg: any, apiKey: string, history: any[], group: string, others: any[] }} turn
 */
async function replyFrom(c, { cfg, apiKey, history, group, others }) {
  c.busy = true
  c.markActivity()
  const mm = c.memory
  try {
    const historyWithMemory = c.withMoodLine(await c.buildHistoryWithMemory(history))
    if (group) historyWithMemory.splice(historyWithMemory.findIndex(m => m.role !== 'system') === -1 ? historyWithMemory.length : historyWithMemory.findIndex(m => m.role !== 'system'), 0, { role: 'system', content: group })

    console.log('[Main] Chiamata route per ' + c.personaId + '...')
    // Il campo motion si spiega al modello solo quando si puo' usare; gli
    // strumenti MCP solo se ce ne sono di ammessi.
    const basePrompt = ((await motionsEnabled(c.avatarId())) ? SYSTEM_PROMPT + MOTION_PROMPT : SYSTEM_PROMPT) + Mcp.toolsPrompt(cfg.mcpServers)
    let result = await route({
      provider: cfg.provider,
      model:    cfg.model,
      apiKey,
      history: historyWithMemory,
      systemPrompt: Personas.systemPrompt(c.persona(), basePrompt),
    })
    console.log('[Main] route() completato, reply length:', result?.reply?.length)

    // Da che strada e' arrivata la risposta: con 'fallback' il modello non ha
    // rispettato il formato e l'azione non c'e'. Il testo grezzo resta nel log.
    console.log('[Main] risposta via ' + (result?.via || '?') + (result?.retried ? ' (secondo tentativo)' : '') + (result?.action?.animation ? ', animazione ' + result.action.animation : ''))
    if (result?.via === 'fallback') console.warn('[Main] risposta fuori formato da ' + cfg.model + ': ' + JSON.stringify(result.raw || ''))
    if (result) delete result.raw

    // Il campo arriva da un modello: solo i valori del contratto passano.
    if (result && !EMOTIONS.includes(result.emotion)) delete result.emotion
    if (result?.emotion) c.updateMood(m => moodLib.react(moodLib.decay(m), result.emotion))
    // rapport: solo interi da -2 a +2 (onReply scarta il resto), mai alla chat.
    if (result && 'rapport' in result) {
      c.updateRapport(r => Rapport.onReply(r, result.rapport))
      delete result.rapport
    }

    // Strumenti MCP (Blocco 7f): conferma, chiamata, poi un altro giro del
    // modello con il risultato (o con l'errore, per correggersi). Fino a
    // MAX_TOOL_STEPS strumenti per messaggio: alcune richieste vogliono due
    // passi (cerca, poi apri). Alla chat arriva solo la risposta finale.
    const notes = []
    const turns = []
    for (let step = 0; result?.action?.type === 'tool'; step++) {
      if (step >= MAX_TOOL_STEPS) { result.action = { type: 'none', animation: 'idle' }; break }
      const used = await useTool(result.action, c)
      result.action = { type: 'none', animation: 'idle' }
      if (used.notice) { result.notice = used.notice; break }
      if (used.note) notes.push(used.note)
      turns.push({ role: 'assistant', content: result.reply || '…' },
        { role: 'user', content: used.error ? Mcp.errorPrompt(used.error) : Mcp.resultPrompt(used.server.id, used.tool.name, used.text) })
      const next = await route({
        provider: cfg.provider, model: cfg.model, apiKey,
        history: [...historyWithMemory, ...turns],
        systemPrompt: Personas.systemPrompt(c.persona(), basePrompt),
      }).catch(err => { console.error('[mcp] giro dopo lo strumento fallito:', err.message); return null })
      if (!next || !next.reply) { result.notice = 'Lo strumento ha risposto, ma il modello non ha scritto la risposta: riprova.'; break }
      result.reply = next.reply
      result.action = next.action || { type: 'none', animation: 'idle' }
    }
    if (notes.length) result.toolNote = notes.join('\n')

    if (result?.reply) {
      if (mm) {
        await mm.addTurn(result.reply, 'assistant').catch(() => {})
        // Oltre la soglia i turni piu' vecchi vanno riassunti. In background: la
        // risposta all'utente non deve aspettare il riassunto.
        if (mm.needsCompaction()) mm.compact().catch(e => console.error('[memory] compattazione per soglia fallita:', e.message))
      }
      // Gli altri sul desktop l'hanno sentita.
      for (const o of others) if (o !== c && o.memory) o.memory.addTurn(Group.heardLine(c.persona().name, result.reply), 'user').catch(() => {})
      // Una risposta lo fa uscire dal bordo, se stava sbirciando.
      c.endPeek('message')
      lastSpeakerId = c.personaId
    }
    return result
  } finally {
    c.busy = false
    c.markActivity()
  }
}

handle('ai:send-message', async (_e, { history, image, to }) => {
  const cfg = loadConfig()
  const apiKey = cfg.keys?.[cfg.provider] || ''
  // Le risposte dei companion portano chi le ha dette (speaker): ognuno vede
  // le proprie come sue e quelle degli altri come "Nome ha detto".
  const safeHistory = Array.isArray(history) ? history.filter(m => m && typeof m.content === 'string').slice(-40)
    .map(m => ({ role: m.role, content: m.content, ...(typeof m.speaker === 'string' ? { speaker: m.speaker } : {}) })) : []
  if (safeHistory.length === 0) return { ok: false, error: 'history vuota o non valida' }
  if (cfg.provider !== 'ollama' && !apiKey) return { ok: false, error: `Manca API key per ${cfg.provider}` }
  const last = safeHistory[safeHistory.length - 1]
  if (!last || last.role !== 'user') return { ok: false, error: 'history vuota o non valida' }
  // Schermata (Blocco 7b): solo sull'ultimo messaggio dell'utente, solo a un
  // modello che vede le immagini, e mai in memoria.
  if (image !== undefined) {
    if (!validImage(image)) return { ok: false, error: 'Immagine non valida.' }
    const caps = await modelCapsOf(cfg.provider, cfg.model).catch(() => null)
    if (!caps || !caps.vision) return { ok: false, error: 'Il modello scelto non vede le immagini: scegline uno che le vede nelle impostazioni (⚙, "Prova il modello" te lo dice).' }
  }
  console.log('[Main] Ricevuta richiesta sendMessage, provider:', cfg.provider)

  const present = companions.filter(c => c.alive())
  if (!present.length) return { ok: false, error: 'Nessun companion aperto.' }
  const open = present.map(c => ({ id: c.personaId, name: (c.persona() || {}).name || c.personaId }))
  const names = Object.fromEntries(open.map(o => [o.id, o.name]))
  // Con un companion solo risponde quello della chat, come prima.
  const ids = present.length === 1 ? [present[0].personaId]
    : Group.pickResponders(last.content, open, { to: typeof to === 'string' ? to : null, last: lastSpeakerId || (chatTarget() || {}).personaId })
  const responders = ids.map(id => present.find(c => c.personaId === id)).filter(Boolean)
  const turnId = ++groupTurn

  // Un messaggio nuovo zittisce la risposta di prima, chiunque stesse parlando.
  if (voiceService) {
    voiceService.stop()
    for (const c of present) c.send('voice-audio', { type: 'stop', utterance: voiceService.utterance })
  }
  speechEndsAt = 0
  lastChatAt = Date.now()
  // Tutti sentono il messaggio: memoria, e il giorno insieme per il rapporto.
  // Con una schermata il testo ha gia' "[immagine dello schermo]" (lo mette la chat).
  for (const c of present) {
    if (c.memory) await c.memory.addTurn(last.content, 'user').catch(() => {})
    c.updateRapport(r => Rapport.onDay(r))
  }
  for (const c of responders) c.updateMood(m => moodLib.onUserMessage(m))

  const groupFor = (c, after) => Group.groupLine(open.filter(o => o.id !== c.personaId).map(o => o.name), after)
  const historyOf = (c, extra = []) => {
    const h = Group.historyFor([...safeHistory, ...extra], c.personaId, names)
    // La schermata solo a chi risponde per primo.
    if (image !== undefined && c === responders[0]) h[safeHistory.length - 1].image = image
    return h
  }

  const first = responders[0]
  let result
  try {
    result = await replyFrom(first, { cfg, apiKey, history: historyOf(first), group: present.length > 1 ? groupFor(first) : '', others: present })
  } catch (err) {
    console.error('[Main] Errore in route():', err)
    return { ok: false, error: describeError(err, cfg.provider) }
  }
  if (result?.reply) speakReply(first, result.reply)

  // Il secondo, se c'e', reagisce al primo: arriva dopo, quando il primo ha finito di parlare.
  const second = responders[1]
  if (second && result?.reply) {
    const extra = [{ role: 'assistant', content: result.reply, speaker: first.personaId }]
    replyFrom(second, { cfg, apiKey, history: historyOf(second, extra), group: groupFor(second, names[first.personaId]), others: present })
      .then(async (r) => {
        if (!r || !r.reply || turnId !== groupTurn) return
        await waitForSpeech()
        if (turnId !== groupTurn) return
        if (chatWindow && !chatWindow.isDestroyed()) {
          try { chatWindow.webContents.send('group-reply', { ...r, personaId: second.personaId, name: names[second.personaId] }) } catch (_) {}
        }
        speakReply(second, r.reply)
      })
      .catch(err => console.error('[gruppo] seconda risposta non riuscita:', err.message))
  }
  return { ok: true, result: { ...result, personaId: first.personaId, name: names[first.personaId] }, group: present.length > 1 }
})

// Impostazioni e voce. Gli indirizzi dei file, gli hash e la cartella li
// decide il main: la pagina chiede solo di scaricare, eliminare o provare.
on('settings:open', (_e, page) => openSettings(typeof page === 'string' ? page : ''))
handle('voice:status', () => (voiceService ? voiceService.status() : null))
handle('voice:download', () => (voiceService ? voiceService.download() : null))
on('voice:cancel-download', () => { if (voiceService) voiceService.cancelDownload() })
handle('voice:remove', () => (voiceService ? voiceService.remove() : null))
on('voice:stop', () => { if (voiceService) voiceService.stop() })
// La prova usa motore, voce e velocita' mostrati nella pagina, anche se non salvati.
handle('voice:test', async (_e, opts) => {
  if (!voiceService) return { ok: false, error: 'voce non pronta' }
  const saved = voiceConfig(loadConfig())
  const pick = mergeConfig({ voice: saved }, { voice: opts || {} }).voice
  speakingCompanion = chatTarget()
  const ok = await voiceService.speak('Ciao! Questa è la mia voce. Ti piace come parlo?', speakOptions(pick))
  if (ok) return { ok: true }
  const status = voiceService.status()
  if (pick.engine === 'xtts' && status.xtts.error) return { ok: false, error: status.xtts.error }
  return { ok: false, error: status.installed || status.xtts.installed ? (status.error || 'la voce non ha parlato') : 'prima installa una voce' }
})

// XTTS: installazione solo dopo aver accettato la licenza del modello (CPML),
// campione scelto con il dialogo del main, e il controllo di GPU e spazio.
handle('voice:xtts-check', async () => {
  const dir = path.join(app.getPath('userData'), 'voice')
  return { gpu: await xttsSetup.nvidiaGpu(), freeBytes: xttsSetup.freeBytes(dir) }
})
handle('voice:xtts-install', async () => {
  if (!voiceService) return null
  if (!voiceConfig(loadConfig()).cpmlAccepted) throw new Error('prima accetta la licenza del modello (CPML)')
  const status = await voiceService.installXtts()
  syncVoice(loadConfig())
  return status
})
on('voice:xtts-cancel', () => { if (voiceService) voiceService.cancelXttsInstall() })
handle('voice:xtts-remove', () => (voiceService ? voiceService.removeXtts() : null))
handle('voice:xtts-speakers', () => (voiceService ? voiceService.xttsSpeakers() : []))
// Microfono: si aggiunge a XTTS installato. Finita l'installazione (o la
// disinstallazione) la chat mostra o nasconde 🎙 e la scorciatoia si registra.
handle('voice:stt-install', async () => {
  if (!voiceService) return null
  const status = await voiceService.installStt()
  syncVoice(loadConfig())
  sendChatConfig(loadConfig())
  return status
})
on('voice:stt-cancel', () => { if (voiceService) voiceService.cancelSttInstall() })
handle('voice:stt-remove', async () => {
  if (!voiceService) return null
  const status = await voiceService.removeStt()
  syncVoice(loadConfig())
  sendChatConfig(loadConfig())
  return status
})
// Il testo di una registrazione (Float32Array mono a 16 kHz). Nel log solo
// quanto e' durata: quello che l'utente ha detto non si scrive.
handle('mic:transcribe', async (_e, pcm) => {
  if (!voiceService) return { ok: false, error: 'voce non pronta' }
  if (!micAllowed) return { ok: false, error: 'il microfono è spento nelle Impostazioni' }
  if (!(pcm instanceof Float32Array)) return { ok: false, error: 'audio non valido' }
  try {
    const res = await voiceService.transcribe(pcm)
    console.log('[mic] ' + res.seconds + ' s di audio trascritti in ' + res.took + ' s' + (res.text ? '' : ' (niente testo)'))
    return { ok: true, ...res }
  } catch (e) {
    console.warn('[mic] trascrizione non riuscita: ' + e.message)
    return { ok: false, error: e.message }
  }
})
// Mentre ascolta il companion tace e lo dice con un fumetto.
on('mic:state', (_e, state) => {
  micBusy = state === 'listening' || state === 'transcribing'
  if (state === 'listening') {
    if (voiceService) voiceService.stop()
    const c = chatTarget()
    if (c) c.markActivity()
    sendCompanion('companion-bubble', { text: '🎙 Ti ascolto…', ms: 65000 })
  } else if (state === 'transcribing') {
    endMicHold(null)
    sendCompanion('companion-bubble', { text: '…', ms: 30000 })
  } else {
    endMicHold(null)
    sendCompanion('companion-bubble', { text: '' })
  }
})
// Live2D: Cubism Core scaricato solo dopo l'accettazione della licenza, che
// il main ricontrolla.
handle('live2d:status', () => live2dStatus())
handle('live2d:install', async () => {
  if (live2dInstall) return live2dStatus()
  if (!loadConfig().live2dAccepted) throw new Error('prima accetta la licenza di Live2D')
  live2dAbort = new AbortController()
  live2dError = null
  live2dInstall = { step: 'download', index: 0, count: live2dCore.STEPS.length, label: live2dCore.STEPS[0].label, done: 0, total: 0 }
  sendLive2DStatus()
  let last = 0
  try {
    await live2dCore.installCore(live2dDir(), {
      signal: live2dAbort.signal,
      onProgress: (p) => {
        const changed = live2dInstall.step !== p.step
        live2dInstall = p
        const now = Date.now()
        if (changed || now - last > 300) { last = now; sendLive2DStatus() }
      },
    })
    console.log('[live2d] Cubism Core ' + live2dCore.SDK_VERSION + ' installato')
  } catch (e) {
    live2dError = live2dAbort.signal.aborted ? 'installazione annullata' : e.message
    console.warn('[live2d] installazione non riuscita: ' + live2dError)
  } finally {
    live2dInstall = null
    live2dAbort = null
    sendLive2DStatus()
  }
  return live2dStatus()
})
on('live2d:cancel', () => { if (live2dAbort) live2dAbort.abort() })
handle('live2d:remove', () => {
  if (live2dAbort) live2dAbort.abort()
  live2dCore.removeCore(live2dDir())
  live2dError = null
  sendLive2DStatus()
  return live2dStatus()
})
// Il modello Live2D in vista: gruppi ed espressioni li conosce il companion,
// che li riporta al caricamento; le Impostazioni ci costruiscono la tabella
// degli abbinamenti, e le scelte (live2dChoices, per avatar) tornano ai
// companion. Il main ricontrolla i nomi contro quelli riportati. Le
// Impostazioni mostrano quello del companion della chat.
const cleanNames = (list) => (Array.isArray(list) ? list : []).filter(n => typeof n === 'string' && n.length <= 64).slice(0, 200)
const live2dView = (c) => (c && c.live2dModel ? { model: c.live2dModel, choices: (loadConfig().live2dChoices || {})[c.live2dModel.id] || {} } : null)
on('live2d:report-model', (e, m) => {
  const c = companionOf(e)
  if (!c || !m || typeof m.id !== 'string') return
  c.live2dModel = { id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 64) : m.id, groups: cleanNames(m.groups), expressions: cleanNames(m.expressions) }
  if (c === chatTarget()) sendSettings('live2d-model', live2dView(c))
})
handle('live2d:model', () => live2dView(chatTarget()))
handle('live2d:set-choices', (_e, id, input) => {
  const c = chatTarget()
  const model = c && c.live2dModel
  if (!model || model.id !== id) throw new Error('il modello Live2D non e\' in vista')
  const clean = checkLive2DChoices(id, input, model)
  if (!clean) throw new Error('scelte non valide')
  const cfg = loadConfig()
  cfg.live2dChoices = { ...(cfg.live2dChoices || {}), [id]: clean }
  saveConfig(cfg)
  sendAll('live2d-choices', cfg.live2dChoices)
  return clean
})

// ─── Chibi (Blocco 5d) ───────────────────────────────────────────────────────
// Ogni companion riporta l'avatar che ha caricato e se ha uno scheletro umano;
// menu e Impostazioni accendono e spengono il chibi per quell'avatar.
handle('avatar:report', (e, info) => {
  const c = companionOf(e)
  if (!c || !info || typeof info.id !== 'string' || info.id.length > 200 || typeof info.kind !== 'string' || info.kind.length > 20) return { chibi: false }
  return c.reportAvatar({ id: info.id, kind: info.kind, humanoid: info.humanoid === true })
})
handle('avatar:chibi-state', () => { const c = chatTarget(); return c ? c.chibiState() : { available: false, reason: '', on: false } })
handle('avatar:set-chibi', (_e, on) => { const c = chatTarget(); return c ? c.setChibi(on === true) : null })
on('live2d:open-license', () => { shell.openExternal(live2dCore.LICENSE_URL).catch(e => console.error('[app] openExternal:', e.message)) })

on('voice:open-license', () => { shell.openExternal(XTTS_LICENSE_URL).catch(e => console.error('[app] openExternal:', e.message)) })
handle('voice:import-sample', async () => {
  if (!voiceService) return { canceled: true }
  const parent = (settingsWindow && !settingsWindow.isDestroyed()) ? settingsWindow : null
  const options = {
    title: 'Campione della tua voce',
    properties: /** @type {('openFile')[]} */ (['openFile']),
    filters: [{ name: 'Audio (WAV, MP3, FLAC, OGG)', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] }],
  }
  // Solo per le prove automatiche: il dialogo nativo non si puo' cliccare.
  const testSample = process.env.COMPANION_TEST_SAMPLE
  const picked = testSample && fs.existsSync(testSample) ? { canceled: false, filePaths: [testSample] }
    : parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  const { file, seconds } = await voiceService.importSample(picked.filePaths[0])
  const cfg = loadConfig()
  cfg.voice = { ...voiceConfig(cfg), xttsSample: file, xttsSpeaker: 'sample' }
  saveConfig(cfg)
  return { ok: true, seconds, config: publicConfig(cfg) }
})

// Elenco modelli, dal vivo per tutti; Claude e OpenAI con la chiave salvata.
handle('models:list', (_e, provider) => {
  if (typeof provider !== 'string' || !PROVIDERS[provider]) return { models: [], live: false }
  return listModels(provider, loadConfig().keys?.[provider] || '')
})

// Pagina dove si ottiene la chiave. L'URL lo sceglie il main da PROVIDERS: il
// renderer indica solo il provider, quindi non puo' aprire indirizzi arbitrari.
handle('app:open-key-page', (_e, provider) => {
  const url = typeof provider === 'string' && PROVIDERS[provider] && PROVIDERS[provider].keyUrl
  if (url) shell.openExternal(url).catch(e => console.error('[app] openExternal:', e.message))
})

// Avvio con Windows. Solo nell'app installata: in sviluppo registrerebbe
// electron.exe senza il progetto, cioe' una finestra vuota a ogni accesso.
handle('app:login-item:get', () => ({
  supported: app.isPackaged,
  enabled: app.isPackaged && app.getLoginItemSettings().openAtLogin,
}))
handle('app:login-item:set', (_e, enabled) => {
  if (!app.isPackaged) return { supported: false, enabled: false }
  app.setLoginItemSettings({ openAtLogin: enabled === true })
  return { supported: true, enabled: app.getLoginItemSettings().openAtLogin }
})

// Memoria — esposizione al renderer
// La memoria della chat e' quella del companion con cui parla.
const chatMemory = () => { const c = chatTarget(); return c ? c.memory : null }
handle('memory:stats', () => {
  const mm = chatMemory()
  return mm ? mm.getStats() : { error: 'memory not initialized' }
})

handle('memory:get-context', async () => {
  const mm = chatMemory()
  return mm ? await mm.getContext() : []
})

// ─── Memoria leggibile (Blocco 6e) ───────────────────────────────────────────
// Una persona con il companion aperto usa il suo MemoryManager vivo, cosi'
// quello che c'e' in RAM resta allineato; le altre una copia letta da disco
// solo per l'occasione.
async function memoryFor(id) {
  if (!personas || typeof id !== 'string' || !personas.list.some(p => p.id === id)) return null
  const open = companions.find(c => c.personaId === id)
  if (open && open.memory) return open.memory
  const mm = new MemoryManager(id, MEMORY_PATH, memoryModelFrom(loadConfig()))
  await mm.loadState()
  return mm
}
const turnView = (t) => ({ id: String(t.id), speaker: t.speaker === 'assistant' ? 'assistant' : 'user', content: String(t.content || '').slice(0, 4000), timestamp: t.timestamp })

handle('memory:view', async (_e, id) => {
  const mm = await memoryFor(id)
  if (!mm) return null
  return {
    summary: mm.getSummary() || '',
    recent: mm.getRawTurns().map(turnView).reverse(),
    archive: mm.getArchive().map(turnView).reverse(),
    archived: mm.getStats().archivedTurns,
  }
})

handle('memory:edit', async (_e, input) => {
  const mm = await memoryFor(input && input.id)
  if (!mm) return { ok: false, error: 'Persona non trovata.' }
  if (input.op === 'summary' && typeof input.text === 'string') await mm.editSummary(input.text)
  else if (input.op === 'delete' && typeof input.turnId === 'string') {
    if (!(await mm.deleteTurn(input.turnId))) return { ok: false, error: 'Ricordo non trovato.' }
  } else return { ok: false, error: 'Richiesta non valida.' }
  return { ok: true }
})

// L'umore di chi chiede: un companion il suo, la chat quello con cui parla.
handle('mood:get', (e) => {
  const c = companionOf(e) || chatTarget()
  return c ? c.publicMood() : null
})

handle('memory:compact-now', async () => {
  const mm = chatMemory()
  if (!mm) return { ok: false, error: 'memory not initialized' }
  try {
    // A mano si riassume tutto tranne gli ultimi turni, di qualunque eta':
    // con i 7 giorni del timer il pulsante non faceva quasi mai nulla.
    const did = await mm.compact(0, MANUAL_COMPACT_KEEP)
    return { ok: true, compacted: did }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

handle('memory:clear', async () => {
  const c = chatTarget()
  if (!c || !c.memory) return { ok: false, error: 'memory not initialized' }
  try {
    // Dimenticare tutto vale anche per come si sentiva, per il rapporto e il diario.
    await c.forget()
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

// Avatar library — la scelta del file e la copia avvengono nel main process.
// Questo impedisce al renderer di trasformare un path arbitrario in un URL locale.
handle('avatars:list', () => avatarLibrary ? avatarLibrary.list() : [])
handle('avatars:scan-import', async () => {
  const picked = await dialog.showOpenDialog({
    title: 'Importa avatar',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Avatar supportati', extensions: ['vrm', 'glb', 'gltf', 'fbx', 'png', 'webp', 'jpg', 'jpeg', 'json'] }],
  })
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  return avatarLibrary.scan(picked.filePaths[0])
})
handle('avatars:commit-import', (_event, data) => {
  const { token, candidateId } = data || {}
  if (typeof token !== 'string' || typeof candidateId !== 'string') throw new Error('Selezione avatar non valida')
  return avatarLibrary.commit(token, candidateId)
})
handle('avatars:remove', (_event, ids) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new Error('Selezione avatar non valida')
  return avatarLibrary.remove(ids)
})

// Animazioni .vrma. Il file da importare lo sceglie e lo legge il main; la
// conversione in .vrma la fa il renderer (motion-retarget.js), che ha three.
const ANIMATION_IMPORT_EXTENSIONS = ['vrma', 'glb', 'gltf', 'fbx', 'bvh']
const MAX_ANIMATION_IMPORT_BYTES = 60 * 1024 * 1024
handle('animations:list', () => animationLibrary ? animationLibrary.list() : [])
handle('animations:pick', async (e) => {
  const from = companionOf(e)
  const parent = from && from.alive() ? from.win : dialogParent()
  const options = {
    title: 'Importa animazione',
    properties: /** @type {('openFile')[]} */ (['openFile']),
    filters: [{ name: 'Animazioni (VRMA, glTF, FBX, BVH)', extensions: ANIMATION_IMPORT_EXTENSIONS }],
  }
  const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  const file = picked.filePaths[0]
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!ANIMATION_IMPORT_EXTENSIONS.includes(ext)) throw new Error('Formato non supportato: .' + ext)
  const stat = await fs.promises.stat(file)
  if (stat.size > MAX_ANIMATION_IMPORT_BYTES) throw new Error('File oltre ' + (MAX_ANIMATION_IMPORT_BYTES / 1024 / 1024) + ' MB')
  // Al renderer solo il nome e i dati, mai il percorso.
  return { name: path.basename(file), ext, data: new Uint8Array(await fs.promises.readFile(file)) }
})
handle('animations:save', (_e, payload) => {
  const { slot, name, data, phase } = payload || {}
  if (typeof slot !== 'string' || typeof name !== 'string') throw new Error('Animazione non valida')
  return animationLibrary.save(slot, name, data instanceof Uint8Array ? data : new Uint8Array(data || []), typeof phase === 'string' ? phase : 'loop')
})

// Azioni OS — eseguite solo nel processo main, mai nel renderer
on('os:execute', async (_e, action, personaId) => {
  if (!action?.type) return
  // L'azione e' del companion che ha risposto (chat di gruppo), se no di
  // quello della chat.
  const c = companions.find(x => x.personaId === personaId) || chatTarget()

  // Prima si controlla, poi si chiede: approvare un'azione che verrebbe comunque
  // bloccata non ha senso, e nel dialogo deve comparire cio' che girera' davvero,
  // non la stringa proposta dal modello.
  const plan = planAction(action)
  if ('error' in plan) {
    console.error('[OS] ' + action.type + ' rifiutato:', plan.error)
  } else if ('run' in plan) {
    // La chat si nasconde quando parte un'azione: il dialogo va appoggiato al
    // companion, che resta visibile, altrimenti puo' finire dietro le finestre.
    const options = {
      type: /** @type {const} */ ('question'), buttons: ['Annulla', 'Approva'], defaultId: 0, cancelId: 0,
      title: 'Conferma azione del companion',
      message: ((c && c.persona() && c.persona().name) || 'Il companion') + ' vuole eseguire un’azione esterna',
      detail: plan.label,
    }
    const parent = c && c.alive() ? c.win : null
    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (answer.response !== 1) return
    plan.run()
  }

  // Triggera animazione companion. Passano solo tipo e animazione: il resto
  // dell'oggetto arriva dal modello e non deve finire nel fumetto.
  if (!c) return
  if (action.animation) {
    c.markActivity()
    const motion = checkMotion(action)
    c.animate({ type: action.type, animation: action.animation, ...motion }, motion)
    // Una posa chiesta dall'utente ("siediti") resta per un po': i gesti a
    // riposo non devono farlo alzare dopo venti secondi.
    c.holdPose(action.animation)
  }
  const motion = motionPrompt(action.motion)
  if (motion) c.requestGeneratedMotion(motion).catch(e => console.error('[kimodo]', e.message))
})

// ─── Movimenti generati (Kimodo) ─────────────────────────────────────────────
// Il modello descrive in action.motion un movimento che non e' fra le
// animazioni; kimodo-service.js lo genera sulla scheda video. Il renderer
// converte l'uscita in .vrma, la riproduce una volta e la rimanda qui per la
// cache: la stessa frase, la volta dopo, parte subito.

// Chiavi di cache che il renderer puo' salvare, solo quelle appena generate,
// con la frase da cui vengono.
/** @type {Map<string, string>} */
const expectedMotions = new Map()

/** Kimodo attivo, installato, e l'avatar avatarId in 3D (il 2D ha solo sprite). */
async function motionsEnabled(avatarId) {
  if (!loadConfig().kimodo || !kimodo || !kimodo.available()) return false
  let avatars = []
  try { avatars = avatarLibrary ? await avatarLibrary.list() : [] } catch (_) { return false }
  const current = avatars.find(a => a.id === avatarId) || avatars.find(a => a.default) || avatars[0]
  return !!current && current.kind !== 'sprite-pack' && current.kind !== 'sprite'
}

const MAX_MOTION_BYTES = 10 * 1024 * 1024
handle('motions:store', async (_e, payload) => {
  const { key, data } = payload || {}
  if (typeof key !== 'string' || !expectedMotions.has(key)) throw new Error('Movimento non atteso')
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || [])
  if (bytes.length > MAX_MOTION_BYTES || !isGlb(bytes)) throw new Error('Movimento non valido')
  const prompt = expectedMotions.get(key)
  expectedMotions.delete(key)
  await kimodo.store(key, bytes, prompt)
  return { url: 'motion://generated/' + key }
})


// ─── Iniziativa (Blocchi 6d e 8d) ────────────────────────────────────────────
// Un companion scrive per primo: buongiorno, rientro dopo un'assenza, silenzio
// lungo, e con altri companion sul desktop ogni tanto un commento su uno di
// loro, che puo' rispondere una volta. Le regole stanno in initiative.js;
// qui un controllo ogni 30 s, il testo dal modello (con memoria, umore e
// persona come una risposta) e la consegna: fumetto sull'avatar e messaggio
// nella chat, voce solo se chiesta. Ogni companion ha il suo stato e i suoi
// 6 al giorno (initiative.json nella cartella della persona).
const INITIATIVE_TICK_MS = 30 * 1000
const INITIATIVE_FIRST_MS = 60 * 1000     // all'avvio aspetta che tutto sia su
const RETURN_VALID_MS = 10 * 60 * 1000    // un rientro vale per un po', poi scade
const PEER_SAID_MS = 30 * 60 * 1000       // "poco fa ha detto": l'ultima mezz'ora
const INITIATIVE_ANIMS = ['wave', 'happy', 'think', 'idle', 'highfive']
const ARRIVAL_GREET_MS = 2500                 // il nuovo arrivato si guarda attorno, poi saluta
const initiativePath = (id) => path.join(Personas.personaDir(MEMORY_PATH, id), 'initiative.json')
/** @type {Map<string, any>} lo stato di ogni persona */
const initiatives = new Map()
let lastChatAt = Date.now()
let awaySeen = false
let returnedAt = 0
let initiativeBusy = false
let exchanging = false   // un commento fra due companion, con la risposta
let lastInitiativeAt = 0
let lastInitiativeBy = null

function initiativeOf(id) {
  if (!initiatives.has(id)) {
    let s = Initiative.createInitiative()
    try { s = Initiative.restore(JSON.parse(fs.readFileSync(initiativePath(id), 'utf8'))) } catch (_) {}
    initiatives.set(id, s)
  }
  return initiatives.get(id)
}

function saveInitiative(id, s) {
  initiatives.set(id, s)
  const file = initiativePath(id)
  fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => writeAtomic(file, JSON.stringify(s)))
    .catch(e => console.error('[iniziativa] salvataggio fallito:', e.message))
}

/** Cosa sta facendo un companion, detto per un altro. */
function doingOf(c) {
  if (c.asleep) return 'sonnecchia'
  if (c.dancing) return 'sta ballando'
  if (c.perched) return 'sta seduto su una finestra'
  return null
}

/** L'ultima cosa detta da un companion, se e' di poco fa. */
function lastSaid(c) {
  const turns = c.memory ? c.memory.getRawTurns() : []
  const t = [...turns].reverse().find(x => x.speaker === 'assistant')
  if (!t || Date.now() - new Date(t.timestamp).getTime() > PEER_SAID_MS) return null
  const text = String(t.content || '').trim()
  return text.length > 200 ? text.slice(0, 199) + '…' : text
}

function initiativeTick() {
  const now = Date.now()
  const systemIdleMs = powerMonitor.getSystemIdleTime() * 1000
  // Rientro: prima via per almeno AWAY_MS, poi di nuovo al PC.
  if (systemIdleMs >= Initiative.RULES.AWAY_MS) awaySeen = true
  else if (awaySeen && systemIdleMs < Initiative.RULES.PRESENT_MS) { awaySeen = false; returnedAt = now }
  if (initiativeBusy || exchanging) return
  const returned = returnedAt > 0 && now - returnedAt < RETURN_VALID_MS
  const typing = !!(chatWindow && !chatWindow.isDestroyed() && chatWindow.isFocused())
  const enabled = loadConfig().initiative
  // In ordine sparso, cosi' non parla sempre lo stesso; uno per controllo.
  const order = companions.filter(c => c.alive() && c.win.isVisible()).sort(() => Math.random() - 0.5)
  for (const c of order) {
    const s = initiativeOf(c.personaId)
    const peers = order.filter(o => o !== c)
    const kind = Initiative.occasion(s, { now, returned, lastChatAt, systemIdleMs, peers: peers.length })
    if (!kind) continue
    const busy = c.busy || c.dragging || micBusy
    const sinceOtherMs = lastInitiativeBy && lastInitiativeBy !== c.personaId ? now - lastInitiativeAt : Infinity
    if (!Initiative.canSpeak(s, { now, enabled, asleep: c.asleep, fullscreen: busy ? false : c.fullscreenNow(), typing, busy, sinceOtherMs }, kind)) continue
    const done = (e) => console.error('[iniziativa] non riuscita:', e.message)
    if (kind === 'peer') {
      exchanging = true
      peerExchange(c, peers[Math.floor(Math.random() * peers.length)]).catch(done).finally(() => { exchanging = false })
    } else speakFirst(c, kind).catch(done)
    return
  }
}

/**
 * Un messaggio spontaneo di c. Con peer: un commento su di lui (kind 'peer')
 * o la risposta a un suo commento ('peer-reply', said: il commento).
 * @returns {Promise<string>} il testo detto, o ''
 */
async function speakFirst(c, kind, peer = null, said = null) {
  initiativeBusy = true
  const mm = c.memory
  try {
    const cfg = loadConfig()
    const apiKey = cfg.keys?.[cfg.provider] || ''
    if (cfg.provider !== 'ollama' && !apiKey) return ''
    const peerName = peer && !Array.isArray(peer) ? (peer.persona() || {}).name || 'l\'altro companion' : null
    const history = c.withMoodLine(await c.buildHistoryWithMemory([]))
    // peer puo' essere uno o piu' companion (il saluto all'arrivo li saluta tutti).
    const peerOf = Array.isArray(peer) ? { name: peer.map(o => (o.persona() || {}).name || o.personaId).join(' e ') }
      : peer ? { name: peerName, doing: doingOf(peer), said: said || lastSaid(peer) } : null
    history.push({ role: 'user', content: Initiative.prompt(kind, peerOf) })
    const result = await route({
      provider: cfg.provider, model: cfg.model, apiKey, history,
      systemPrompt: Personas.systemPrompt(c.persona(), SYSTEM_PROMPT),
    })
    const reply = String((result && result.reply) || '').trim().slice(0, 2000)
    if (!reply || result.via === 'fallback') return ''
    // Contato anche se poi nessuno lo legge: il freno e' sui tentativi riusciti.
    const s = Initiative.onSpoke(initiativeOf(c.personaId), kind, Date.now())
    saveInitiative(c.personaId, s)
    lastInitiativeAt = Date.now()
    lastInitiativeBy = c.personaId
    if (kind === 'morning' || kind === 'return') returnedAt = 0
    if (EMOTIONS.includes(result.emotion)) c.updateMood(m => moodLib.react(moodLib.decay(m), result.emotion))
    if (mm) await mm.addTurn(reply, 'assistant').catch(() => {})
    // Gli altri sul desktop l'hanno sentito.
    const name = (c.persona() || {}).name || c.personaId
    for (const o of companions) if (o !== c && o.memory) o.memory.addTurn(Group.heardLine(name, reply), 'user').catch(() => {})
    console.log('[iniziativa] ' + c.personaId + ': ' + kind + (peer && !Array.isArray(peer) ? ' (' + peer.personaId + ')' : '') + ' (' + s.sent + ' all\'utente, ' + s.peerSent + ' fra companion oggi)')
    const anim = result.action && INITIATIVE_ANIMS.includes(result.action.animation) ? result.action.animation : 'wave'
    c.endPeek('message')
    c.animate({ type: 'none', animation: anim, bubble: reply.length > 140 ? reply.slice(0, 139) + '…' : reply })
    if (chatWindow && !chatWindow.isDestroyed()) {
      try { chatWindow.webContents.send('companion-initiative', { reply, personaId: c.personaId, name }) } catch (_) {}
    }
    lastSpeakerId = c.personaId
    if (cfg.initiativeVoice) speakReply(c, reply)
    return reply
  } finally { initiativeBusy = false }
}

// Il commento su un altro: l'altro, se puo', risponde una volta, dopo che il
// primo ha finito di parlare. Conta anche sul suo limite (quello fra companion).
async function peerExchange(c, peer) {
  const said = await speakFirst(c, 'peer', peer)
  if (said) await answerPeer(peer, c, said)
}

/** who risponde a quello che from gli ha appena detto. */
async function answerPeer(who, from, said) {
  if (!who.alive()) return
  await waitForSpeech()
  await new Promise(r => setTimeout(r, 1500))
  const free = { enabled: loadConfig().initiative, asleep: who.asleep, fullscreen: false, typing: false, busy: who.busy || who.dragging || micBusy }
  if (!Initiative.canSpeak(initiativeOf(who.personaId), { now: Date.now(), ...free }, 'peer-reply')) return
  await speakFirst(who, 'peer-reply', from, said)
}

/**
 * Un companion appena messo sul desktop saluta quelli che ci sono gia', e uno
 * di loro gli risponde. Non all'avvio dell'app: solo quando arriva qualcuno.
 */
async function greetArrival(c) {
  if (process.env.COMPANION_NO_INITIATIVE === '1' || !loadConfig().initiative) return
  const others = companions.filter(o => o !== c && o.alive() && o.win.isVisible())
  if (!others.length || !c.alive()) return
  if (!Initiative.canSpeak(initiativeOf(c.personaId), { now: Date.now(), enabled: true, asleep: false, fullscreen: false, typing: false }, 'hello')) return
  exchanging = true
  try {
    const said = await speakFirst(c, 'hello', others)
    if (said) await answerPeer(others[Math.floor(Math.random() * others.length)], c, said)
  } finally { exchanging = false }
}

function startInitiative() {
  // Lo smoke gira sui dati veri: niente messaggi spontanei nella memoria.
  if (process.env.COMPANION_NO_INITIATIVE === '1') return
  // L'avvio dell'app vale come un rientro: il primo del giorno e' il buongiorno.
  returnedAt = Date.now()
  setTimeout(() => {
    initiativeTick()
    const timer = setInterval(initiativeTick, INITIATIVE_TICK_MS)
    if (timer.unref) timer.unref()
  }, INITIATIVE_FIRST_MS).unref?.()
}

// ─── App attiva (Blocco 7c) ──────────────────────────────────────────────────
// Mentre scrivi, in primo piano c'e' la chat: si ricorda l'ultima finestra in
// primo piano che non e' dell'app, controllando ogni 2 s solo se l'opzione e'
// accesa. Il titolo resta in RAM e entra nel prompt (active-app.js), mai in memoria.
let lastForeign = null
function startActiveApp() {
  const timer = setInterval(() => {
    if (!loadConfig().activeApp) { lastForeign = null; return }
    const info = winWindows.windowInfo(winWindows.foregroundWindow())
    if (info && info.title && info.pid !== process.pid) lastForeign = info
  }, 2000)
  if (timer.unref) timer.unref()
}

// ─── Vita a riposo e cursore: un ciclo per tutti i companion ────────────────
const IDLE_TICK_MS = 5000
const GLANCE_CHANCE = 0.06   // per companion, ogni 5 s: un'occhiata a un vicino ogni minuto o poco piu'
const CURSOR_TICK_MS = 33     // ~30 Hz: lo sguardo e' smorzato, basta
let idleTimer = null
let cursorTimer = null

function startIdleLife() {
  applyWindowOptions(loadConfig())
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(() => {
    for (const c of companions) c.idleTick()
    // Con altri companion vicino, ogni tanto uno guarda un altro (Blocco 8d).
    const shown = companions.filter(c => c.alive() && c.win.isVisible() && c.viewMode === 'desktop')
    if (shown.length < 2) return
    for (const c of shown) {
      if (c.dragging || Math.random() >= GLANCE_CHANCE) continue
      const others = shown.filter(o => o !== c)
      const other = others[Math.floor(Math.random() * others.length)]
      c.glanceAt(Companions.headPoint(other.bounds), 2500 + Math.random() * 2000)
    }
  }, IDLE_TICK_MS)
  if (idleTimer.unref) idleTimer.unref()
}

// Il cursore rispetto a ogni finestra, anche quando e' fuori: la pagina lo usa
// per lo sguardo e per accorgersi che il mouse se n'e' andato.
function startCursorFeed() {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = setInterval(() => {
    if (!companions.length) return
    const cursor = screen.getCursorScreenPoint()
    // Chi ascolta guarda chi sta parlando (Blocco 8d).
    const speaker = speakingCompanion && speakingCompanion.alive() && speakingCompanion.win.isVisible() && Date.now() < speechEndsAt ? speakingCompanion : null
    const head = speaker && speaker.viewMode === 'desktop' ? Companions.headPoint(speaker.bounds) : null
    for (const c of companions) c.cursorTick(cursor, head && c !== speaker && c.viewMode === 'desktop' ? head : null)
  }, CURSOR_TICK_MS)
  if (cursorTimer.unref) cursorTimer.unref()
}

// ─── Ballo con la musica (Blocco 5c) ─────────────────────────────────────────
// Con l'interruttore acceso, ogni MUSIC_POLL_MS si guarda nel mixer di
// Windows (win-audio.js) se un'app ammessa sta suonando, e lo si dice alla
// pagina: e' lei che apre la cattura del suono e ne trova il ritmo. Spento,
// niente sorveglianza e niente cattura.
const MUSIC_POLL_MS = 700
let danceEnabled = false
let danceAppList = DANCE_APPS_DEFAULT
let musicTimer = null
let musicState = { playing: false, app: null }
let musicWarned = false

function musicTick() {
  let next
  if (winAudio.available()) {
    const app = winAudio.musicApp(winAudio.sessions(), danceAppList)
    next = { playing: !!app, app }
  } else {
    // Senza il mixer non si sa chi suona: decide solo il ritmo.
    if (!musicWarned) { console.warn('[ballo] mixer non leggibile: ' + winAudio.unavailableReason()); musicWarned = true }
    next = { playing: true, app: null }
  }
  if (next.playing === musicState.playing && next.app === musicState.app) return
  musicState = next
  sendAll('music-state', { ...musicState, enabled: danceEnabled })
}

function applyDance(cfg) {
  danceEnabled = cfg.danceMusic === true
  danceAppList = Array.isArray(cfg.danceApps) ? cfg.danceApps : DANCE_APPS_DEFAULT
  if (danceEnabled && !musicTimer) {
    musicTimer = setInterval(musicTick, MUSIC_POLL_MS)
    musicTick()
  } else if (!danceEnabled && musicTimer) {
    clearInterval(musicTimer)
    musicTimer = null
    musicState = { playing: false, app: null }
    for (const c of companions) c.dancing = false
    sendAll('music-state', { ...musicState, enabled: false })
  }
}

// Solo per audit.mjs (COMPANION_TEST_HOOKS=1): mettere la finestra oltre il
// bordo, rilasciarla come dopo una presa, muovere un cursore finto e leggere
// lo stato. Senza la variabile il canale non esiste. Vale per il primo companion.
if (process.env.COMPANION_TEST_HOOKS === '1') {
  handle('test:peek', (_e, cmd) => {
    const c = companions[0]
    if (!c || !c.alive()) return null
    if (cmd && cmd.place) c.moveTo(Number(cmd.place.x) || 0, Number(cmd.place.y) || 0)
    if (cmd && cmd.release && !c.tryPerch() && !c.tryPeek()) c.keepOnScreen()
    if (cmd && 'cursor' in cmd) testCursor = cmd.cursor && Number.isFinite(cmd.cursor.x) ? { x: cmd.cursor.x, y: cmd.cursor.y } : null
    return { bounds: c.win.getBounds(), workArea: c.workArea(), peek: c.peekState() }
  })
  // Un commento fra i primi due companion, subito (Blocco 8d).
  handle('test:peer', async () => {
    if (companions.length < 2) return false
    await peerExchange(companions[0], companions[1])
    return true
  })
}

// Scene della stanza: le HDRI in modelli-3d/scenes (servite da
// vrm://scenes/...) e i modelli 3D importati (SceneLibrary, scene://).
async function listRoomScenes() {
  const dir = path.join(__dirname, '..', '..', 'modelli-3d', 'scenes')
  let hdri = []
  try {
    const json = JSON.parse(await fs.promises.readFile(path.join(dir, 'scenes.json'), 'utf8'))
    hdri = room.parseScenes(json, (file) => fs.existsSync(path.join(dir, file))).map(s => ({ ...s, kind: 'hdri' }))
  } catch (_) { /* nessuna HDRI */ }
  let imported = []
  try { imported = sceneLibrary ? await sceneLibrary.list() : [] } catch (_) { /* libreria illeggibile */ }
  return [...hdri, ...imported.map(s => ({
    id: s.id, label: s.name, kind: 'model', format: s.kind, url: s.url, textures: s.textures || [], settings: s.settings, imported: true,
  }))]
}
handle('scenes:list', () => listRoomScenes())
handle('scenes:update', (_e, data) => {
  const { id, settings } = data || {}
  if (!sceneLibrary || typeof id !== 'string') return null
  return sceneLibrary.update(id, settings)
})
on('scenes:import', () => { importScene().catch(e => console.error('[scene] importazione:', e)) })
on('scenes:remove', (_e, id) => { if (typeof id === 'string') removeScene(id).catch(e => console.error('[scene] eliminazione:', e)) })

/** Dialogo del main, legato alla finestra del companion se c'e'. */
function companionDialog(options) {
  const parent = dialogParent()
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

// Importa una scena 3D: scelta del file o della cartella, e se dentro ci sono
// piu' modelli la scelta fra quelli. La pagina riceve solo l'elenco nuovo e
// quale scena mostrare.
async function importScene() {
  const parent = dialogParent()
  const options = {
    title: 'Importa scena 3D',
    properties: /** @type {('openFile' | 'openDirectory')[]} */ (['openFile', 'openDirectory']),
    filters: [{ name: 'Scene 3D (glTF, FBX, OBJ)', extensions: ['glb', 'gltf', 'fbx', 'obj'] }],
  }
  const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return
  try {
    const scan = await sceneLibrary.scan(picked.filePaths[0])
    let candidate = scan.candidates[0]
    if (scan.candidates.length > 1) {
      const shown = scan.candidates.slice(0, 8)
      const { response } = await companionDialog({
        type: 'question', title: 'Importa scena 3D', message: 'Nella cartella ci sono piu\' modelli: quale importare?',
        buttons: [...shown.map(c => c.name + ' (' + c.kind + ')'), 'Annulla'], cancelId: shown.length, noLink: true,
      })
      candidate = shown[response]
    }
    if (!candidate) return
    const scene = await sceneLibrary.commit(scan.token, candidate.id)
    setOption({ roomScene: scene.id })
    sendAll('room-scenes', { select: scene.id, imported: scene.name })
  } catch (error) {
    await companionDialog({ type: 'error', title: 'Importa scena 3D', message: 'Importazione non riuscita', detail: error.message })
  }
}

async function removeScene(id) {
  const scene = (await sceneLibrary.list()).find(s => s.id === id)
  if (!scene) return
  const { response } = await companionDialog({
    type: 'warning', title: 'Elimina scena', message: 'Eliminare la scena "' + scene.name + '"?',
    detail: 'Si cancella la copia importata; il file originale resta dov\'era.',
    buttons: ['Elimina', 'Annulla'], defaultId: 1, cancelId: 1, noLink: true,
  })
  if (response !== 0) return
  await sceneLibrary.remove([id])
  sendAll('room-scenes', { removed: id })
}
// La stanza la apre e la gestisce il companion che lo chiede dalla sua pagina.
on('view:set', (e, mode) => {
  const c = companionOf(e) || chatTarget()
  if (c && (mode === 'room' || mode === 'desktop')) c.setView(mode)
})
on('room:minimize', (e) => { const c = companionOf(e); if (c && c.isRoomWindow()) c.win.minimize() })
on('room:maximize', (e) => { const c = companionOf(e); if (c) c.toggleRoomMaximize() })
on('room:resize-start', (e, edge) => { const c = companionOf(e); if (c && typeof edge === 'string') c.startRoomResize(edge) })
on('room:resize-end', (e) => { const c = companionOf(e); if (c) c.endRoomResize() })


// ─── Meteo della stanza (weather.js) ─────────────────────────────────────────
// Facoltativo: solo con la stanza aperta, il meteo acceso e una citta'. Il
// servizio ricorda l'ultimo meteo per 30 minuti; il timer controlla ogni 5.

const weatherService = new WeatherService()
const WEATHER_CHECK_MS = 5 * 60 * 1000
let weatherStatus = ''
let weatherTimer = null

async function refreshWeather({ force = false } = {}) {
  const cfg = loadConfig()
  if (!cfg.weather || !cfg.weatherCity) {
    weatherStatus = cfg.weather ? 'Scrivi una città' : ''
    sendAll('room-weather', { weather: null, place: null })
    return
  }
  if (!roomHost() && !force) return
  try {
    const { place, weather } = await weatherService.get(cfg.weatherCity, { force })
    weatherStatus = place.name + (place.country ? ', ' + place.country : '')
    sendAll('room-weather', { weather, place: { latitude: place.latitude, longitude: place.longitude } })
  } catch (error) {
    weatherStatus = error.message
    console.warn('[meteo] ' + error.message)
    sendAll('room-weather', { weather: null, place: null })
  }
}

function startWeatherFeed() {
  if (weatherTimer) clearInterval(weatherTimer)
  weatherTimer = setInterval(() => { if (roomHost()) refreshWeather().catch(() => {}) }, WEATHER_CHECK_MS)
  if (weatherTimer.unref) weatherTimer.unref()
}

/**
 * Applica le opzioni della config che toccano finestre e comportamento: le
 * preferenze (uguali per tutti) e la finestra di ogni companion.
 */
function applyWindowOptions(cfg) {
  prefs.idleLife = cfg.idleLife !== false
  prefs.touch = cfg.touchReactions !== false
  prefs.followMouse = cfg.followMouse !== false
  prefs.perch = cfg.perch !== false
  applyDance(cfg)
  // Spento Kimodo, la memoria video si libera subito.
  if (!cfg.kimodo && kimodo) kimodo.stop()
  for (const c of companions) c.applyWindowOptions(cfg)
}

/** Manda la config a chat e Impostazioni: intestazione, pulsante del microfono, interruttori. */
function sendChatConfig(cfg) {
  const pub = publicConfig(cfg)
  if (chatWindow && !chatWindow.isDestroyed()) {
    try { chatWindow.webContents.send('config-changed', pub) } catch (_) {}
  }
  sendSettings('config-changed', pub)
}

/** Cambia un'opzione dal menu e avvisa la chat. */
function setOption(partial) {
  const merged = mergeConfig(loadConfig(), partial)
  saveConfig(merged)
  applyWindowOptions(merged)
  sendChatConfig(merged)
}

/**
 * "Scena", nella stanza: quale mostrare, importarne una, sistemarla (scala,
 * rotazione, posto dell'avatar) ed eliminarla.
 * @param {any} cfg
 * @param {(data: any) => void} command
 * @returns {Promise<Electron.MenuItemConstructorOptions>}
 */
async function sceneMenu(cfg, command) {
  const scenes = [{ id: 'studio', label: 'Studio' }, { id: 'giardino', label: 'Giardino' }, ...(await listRoomScenes())]
  const current = scenes.find(s => s.id === cfg.roomScene) || scenes[0]
  const imported = scenes.filter(s => s.imported)
  const label = (s) => s.label.replace(/&/g, '&&')
  return {
    label: 'Scena',
    submenu: [
      ...scenes.map(s => ({
        label: label(s) + (s.imported ? '  (importata)' : ''), type: /** @type {const} */ ('radio'), checked: s.id === current.id,
        click: () => command({ cmd: 'scene', id: s.id }),
      })),
      { type: 'separator' },
      { label: 'Importa scena 3D (glTF, FBX, OBJ)…', click: () => { importScene().catch(e => console.error('[scene] importazione:', e)) } },
      current.imported
        ? { label: 'Sistema la scena…', click: () => command({ cmd: 'scene-adjust' }) }
        : { label: 'Sistema la scena (solo per quelle importate)', enabled: false },
      imported.length
        ? { label: 'Elimina scena', submenu: imported.map(s => ({ label: label(s) + '…', click: () => { removeScene(s.id).catch(e => console.error('[scene] eliminazione:', e)) } })) }
        : { label: 'Elimina scena (nessuna importata)', enabled: false },
    ],
  }
}

const SOURCE_LABELS = { builtin: 'integrata', private: 'privata', user: 'importata' }
const PHASE_TAGS = { enter: ' (entrata)', exit: ' (uscita)' }

/**
 * "Prova": ogni clip per nome, divise per gesto, e i movimenti di Kimodo in
 * cache. Il renderer riproduce proprio quel file, una volta; un gesto senza
 * clip mostra la sua posa procedurale.
 * @param {(data: any) => void} command
 * @returns {Promise<Electron.MenuItemConstructorOptions[]>}
 */
async function previewMenu(command) {
  let clips = []
  let generated = []
  try { clips = animationLibrary ? await animationLibrary.list() : [] } catch (_) {}
  try { generated = kimodo ? await kimodo.list() : [] } catch (_) {}
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const slots = ANIMATION_SLOTS.map(slot => {
    const label = SLOT_LABELS[slot] || slot
    const own = clips.filter(c => c.slot === slot)
    if (!own.length) return { label: label + '  (posa procedurale)', click: () => command({ cmd: 'preview-slot', slot }) }
    return {
      label: label + '  (' + own.length + ')',
      submenu: own.map(c => ({
        label: c.name.replace(/\.vrma$/i, '') + (PHASE_TAGS[c.phase] || '') + '  · ' + (SOURCE_LABELS[c.source] || c.source),
        click: () => command({ cmd: 'preview-clip', url: c.url, name: c.name }),
      })),
    }
  })
  const moments = generated.slice(0, 30).map((g, i) => {
    const text = g.name || g.prompt || 'senza frase, del ' + new Date(g.time).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
    return {
      label: (text.length > 70 ? text.slice(0, 69) + '…' : text).replace(/&/g, '&&'),
      click: () => command({ cmd: 'preview-clip', url: 'motion://generated/' + g.key, name: g.name || g.prompt || 'movimento generato ' + (i + 1) }),
    }
  })
  return [
    { label: 'Prova', submenu: slots },
    moments.length
      ? { label: 'Prova i movimenti di Kimodo', submenu: moments }
      : { label: 'Prova i movimenti di Kimodo (nessuno)', enabled: false },
  ]
}

// Per togliere un'animazione importata basta cancellarne il file.
function openAnimationsFolder() {
  const dir = animationLibrary && animationLibrary.userDir
  if (!dir) return
  fs.promises.mkdir(dir, { recursive: true })
    .then(() => shell.openPath(dir))
    .catch(e => console.error('[animazioni] cartella non aperta:', e.message))
}

// ─── Messaggi dalla pagina di un companion ──────────────────────────────────
// Ognuno va al companion che l'ha mandato (companionOf): presa in braccio,
// clic che passano, menu, ballo, sbirciata, tocchi, batti cinque, seduta.
on('drag:start', (e) => { const c = companionOf(e); if (c) c.startDrag() })
on('drag:end', (e) => { const c = companionOf(e); if (c) c.endDrag() })
on('mouse:capture', (e, capture) => {
  const c = companionOf(e)
  if (!c || !c.alive() || c.viewMode === 'room') return
  c.win.setIgnoreMouseEvents(capture !== true, { forward: true })
})
on('companion:menu', (e) => { const c = companionOf(e); if (c) c.showMenu().catch(err => console.error('[menu]', err.message)) })
// Ballo: lo stato della musica alla pagina appena carica, e dalla pagina se
// sta ballando (la vita autonoma aspetta).
handle('music:state', () => ({ ...musicState, enabled: danceEnabled }))
on('companion:dancing', (e, on) => { const c = companionOf(e); if (c) c.dancing = danceEnabled && on === true })
on('companion:peek-geometry', (e, g) => { const c = companionOf(e); if (c) c.peekGeometry(g) })
on('companion:peek-out', (e) => { const c = companionOf(e); if (c) c.endPeek('dblclick') })
handle('companion:touch', (e, input) => { const c = companionOf(e); return c ? c.onTouch(input) : null })
handle('companion:highfive', (e, input) => { const c = companionOf(e); return c ? c.onHighFive(input) : null })
// Ombra e seduta dentro la finestra, in px: solo numeri, la finestra li limita.
on('companion:seat-anchor', (e, anchor) => {
  const c = companionOf(e)
  if (!c || !anchor || ![anchor.x, anchor.feet, anchor.seat].every(Number.isFinite)) return
  c.setSeatAnchor(anchor)
})

// ─── OS Actions (hardened, standalone) ─────────────────────────────────────────
// Le regole stanno in guards.js. run-command accetta solo l'allowlist; per
// toglierla: config.json { "allowUnsafeCommands": true } — sconsigliato.

const logOpenError = (label) => (err) => { if (err) console.error('[OS] ' + label + ':', err) }

/**
 * Traduce un'azione proposta dal modello in cio' che verra' eseguito.
 * @returns {{ error: string } | { label: string, run: () => void } | {}}
 */
function planAction(action) {
  switch (action.type) {
    case 'open-path': {
      const res = checkOpenPath(action.path)
      if ('error' in res) return res
      return { label: 'Aprire ' + res.path, run: () => shell.openPath(res.path).then(logOpenError('openPath')) }
    }
    case 'open-url': {
      if (!isSafeUrl(action.url)) return { error: 'solo http/https: ' + action.url }
      return { label: 'Aprire nel browser ' + action.url, run: () => shell.openExternal(action.url).catch(e => console.error('[OS] openExternal:', e.message)) }
    }
    case 'open-desktop-item': {
      // getPath('desktop') segue anche il Desktop spostato da OneDrive, che
      // homedir/Desktop non vede.
      const res = checkDesktopItem(action.name, app.getPath('desktop'))
      if ('error' in res) return res
      return { label: 'Aprire ' + res.path, run: () => shell.openPath(res.path).then(logOpenError('openPath')) }
    }
    case 'run-command': {
      const res = parseCommand(action.cmd, { allowUnsafe: !!loadConfig().allowUnsafeCommands })
      if ('error' in res) return res
      return {
        label: 'Eseguire ' + [res.program, ...res.args].join(' '),
        // Nessuna shell: "notepad & ..." aggirerebbe l'allowlist. Il processo
        // parte staccato e senza timeout, che chiuderebbe Blocco note dopo pochi secondi.
        run: () => {
          try {
            const child = spawn(res.program, res.args, { detached: true, stdio: 'ignore' })
            child.on('error', e => console.error('[CMD]', e.message))
            child.unref()
          } catch (e) { console.error('[CMD]', e.message) }
        },
      }
    }
    case 'none':
      return {}
    default:
      console.warn('[OS] action type sconosciuto:', action.type)
      return {}
  }
}

// Chromium abbassa il maiuscolo dell'host negli URL con schema standard, quindi
// vrm://Fred/Fred_optimized.vrm arriva al gestore come vrm://fred/... . Su
// Windows non si nota perche' il filesystem ignora il maiuscolo, ma su Linux o
// dentro un archivio case-sensitive il modello non verrebbe trovato. Qui ogni
// segmento viene riportato al nome reale confrontandolo con il contenuto della
// cartella; se non c'e' corrispondenza si tiene il segmento originale, cosi' il
// controllo sul traversal e quello di esistenza restano gli unici a decidere.
function resolveCaseInsensitive(root, relative) {
  let current = root
  const parts = relative.split(/[\/]+/).filter(Boolean)
  const resolved = []
  for (const part of parts) {
    let match = part
    try {
      const entries = fs.readdirSync(current)
      if (!entries.includes(part)) {
        const lower = part.toLowerCase()
        const found = entries.find(e => e.toLowerCase() === lower)
        if (found) match = found
      }
    } catch (_) { /* cartella inesistente: decide il controllo di esistenza */ }
    resolved.push(match)
    current = path.join(current, match)
  }
  return resolved.join(path.sep)
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vrm',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      // Niente bypassCSP: la CSP di companion.html ammette gia' vrm: in
      // img-src e connect-src, e non serve che questo schema la scavalchi.
      stream: true,
    }
  },
  {
    scheme: 'avatar',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  // Scene 3D importate per la stanza (SceneLibrary).
  {
    scheme: 'scene',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  // Clip .vrma: motion://builtin, motion://private, motion://user.
  {
    scheme: 'motion',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  // Il Cubism Core di Live2D (live2d-core.js): un solo file, l'unico script
  // che la pagina del companion carica da fuori dall'app.
  {
    scheme: 'live2d',
    privileges: { standard: true, secure: true }
  }
]);

// Una sola istanza: due companion scriverebbero insieme sugli stessi file di
// memoria e config, e sul desktop comparirebbero due avatar e due icone.
// Rilanciare l'app riporta in vista quella gia' aperta.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    for (const c of companions) if (c.alive()) c.win.show()
    if (chatWindow && !chatWindow.isDestroyed() && !chatWindow.isVisible()) toggleChat()
  })
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  setupLogging(path.join(app.getPath('userData'), 'logs'))

  // Finestre degli altri programmi, per sedersi su finestre e taskbar (koffi).
  // Se non si leggono la funzione resta spenta, e il log dice perche'.
  if (winWindows.available()) console.log('[win] finestre di Windows leggibili: ' + winWindows.listWindows().length)
  else console.warn('[win] finestre di Windows non disponibili: ' + winWindows.unavailableReason())

  // Dei permessi del browser solo il microfono, e solo per le pagine dell'app
  // con il microfono acceso (allowPermission in guards.js). Fotocamera,
  // notifiche, posizione e il resto: no.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(allowPermission(permission, details, RENDERER_DIR_URL, micAllowed, danceEnabled)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    allowPermission(permission, details, RENDERER_DIR_URL, micAllowed, danceEnabled))
  // Il suono del PC per il ballo: getDisplayMedia vuole anche un video, si da'
  // lo schermo e la pagina ferma subito la traccia video senza leggerla.
  // Solo alla pagina del companion e solo con il ballo acceso.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const url = request.frame && request.frame.url
    if (!request.audioRequested || !allowDisplayCapture(url, RENDERER_DIR_URL, danceEnabled)) { callback({}); return }
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}))
  })

  avatarLibrary = new AvatarLibrary(path.join(app.getPath('userData'), 'avatars'), builtinAvatars(path.join(__dirname, '..', '..')))
  sceneLibrary = new SceneLibrary(path.join(app.getPath('userData'), 'scenes'))
  // audit.mjs e preview-clips.mjs provano le proprie clip: con anche le
  // integrate e le private, uno slot sceglierebbe a caso fra piu' clip.
  const onlyUserClips = process.env.COMPANION_ONLY_USER_CLIPS === '1'
  animationLibrary = new AnimationLibrary([
    ...(onlyUserClips ? [] : [
      { id: 'builtin', dir: path.join(__dirname, '..', '..', 'modelli-3d', 'animations') },
      { id: 'private', dir: path.join(__dirname, '..', '..', 'private-assets', 'animations') },
    ]),
    { id: 'user', dir: path.join(app.getPath('userData'), 'animations') },
  ])
  const startCfg = loadConfig()
  kimodo = new KimodoService({
    dir: typeof startCfg.kimodoDir === 'string' && path.isAbsolute(startCfg.kimodoDir) ? startCfg.kimodoDir : path.join(os.homedir(), 'kimodo'),
    cacheDir: path.join(app.getPath('userData'), 'generated-motions'),
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    // Gli errori dei renderer finiscono nel file di log, con quelli del main.
    contents.on('console-message', (event, ...legacy) => {
      const level = /** @type {any} */ (event).level ?? legacy[0]
      const message = /** @type {any} */ (event).message ?? legacy[1]
      if (level === 'error' || level === 3) console.error('[renderer] ' + message)
    })
    contents.on('render-process-gone', (_e, details) => console.error('[renderer] processo terminato:', details.reason))
  })
  // vrm:// serve gli avatar integrati: vrm://<percorso> da modelli-3d/, e
  // vrm://private/<percorso> da private-assets/, che esiste solo nella copia
  // privata (vedi builtin-avatars.js). Nel pacchetto pubblico quella cartella
  // non c'e' e le richieste private rispondono 404.
  const projectRoot = path.join(__dirname, '..', '..')
  protocol.handle('vrm', async (request) => {
    try {
      let relativePath = decodeURIComponent(request.url.replace(/^vrm:\/\//i, ''));
      let rootDir = 'modelli-3d';
      if (/^private\//i.test(relativePath)) { rootDir = 'private-assets'; relativePath = relativePath.slice('private/'.length); }
      else relativePath = relativePath.replace(/^modelli-3d\//i, '');

      const safeRoot = path.normalize(path.join(projectRoot, rootDir));
      const realRelative = resolveCaseInsensitive(safeRoot, relativePath);
      const absolutePath = path.normalize(path.join(safeRoot, realRelative));

      if (!absolutePath.startsWith(safeRoot + path.sep)) {
        console.error('[VRM Protocol] Accesso negato:', absolutePath);
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(absolutePath)) {
        console.error('[VRM Protocol] File non trovato:', absolutePath);
        return new Response('File Not Found', { status: 404 });
      }

      // Le strip dei pacchetti privati diventano texture WebGL: servono
      // l'header CORS, come per avatar://.
      const res = await net.fetch(require('url').pathToFileURL(absolutePath).toString());
      const headers = new Headers(res.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      console.error('[VRM Protocol] Errore:', err);
      return new Response('Error', { status: 500 });
    }
  });
  protocol.handle('avatar', async (request) => {
    try {
      const url = new URL(request.url)
      const file = await avatarLibrary.resolve(url.hostname, decodeURIComponent(url.pathname.slice(1)))
      if (!file) return new Response('Not found', { status: 404 })
      // La pagina viene da file:// e l'immagine da avatar://: senza questo
      // header WebGL la considera di un'altra origine e rifiuta di usarla come
      // texture, e un avatar 2D importato restava invisibile.
      const res = await net.fetch(require('url').pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers })
    } catch (_) { return new Response('Forbidden', { status: 403 }) }
  })
  // Come avatar://: le texture delle scene diventano texture WebGL.
  protocol.handle('scene', async (request) => {
    try {
      const url = new URL(request.url)
      const file = await sceneLibrary.resolve(url.hostname, decodeURIComponent(url.pathname.slice(1)))
      if (!file) return new Response('Not found', { status: 404 })
      const res = await net.fetch(require('url').pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers })
    } catch (_) { return new Response('Forbidden', { status: 403 }) }
  })

  // live2d://core/live2dcubismcore.min.js e nient'altro, e solo se il file
  // ha ancora l'hash del Core scaricato: e' codice che la pagina esegue.
  protocol.handle('live2d', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'core' || url.pathname !== '/' + live2dCore.CORE.name) return new Response('Not found', { status: 404 })
      const file = live2dCore.coreFileIfValid(live2dDir())
      if (!file) return new Response('Not found', { status: 404 })
      return new Response(fs.readFileSync(file), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })
    } catch (_) { return new Response('Forbidden', { status: 403 }) }
  })

  protocol.handle('motion', async (request) => {
    try {
      const url = new URL(request.url)
      const name = decodeURIComponent(url.pathname.slice(1))
      const file = url.hostname === 'generated' ? (kimodo && kimodo.resolve(name)) : animationLibrary.resolve(url.hostname, name)
      if (!file) return new Response('Not found', { status: 404 })
      const res = await net.fetch(require('url').pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers })
    } catch (_) { return new Response('Forbidden', { status: 403 }) }
  })

  loadPersonas()
  initVoice()
  // Sul desktop chi c'era l'ultima volta, con la persona attiva sempre fra loro.
  const known = personas.list.map(p => p.id)
  const toOpen = Companions.cleanOpen(loadConfig().openPersonas, known, personas.activeId)
  if (!toOpen.includes(personas.activeId)) toOpen.splice(Companions.MAX_OPEN - 1, 1, personas.activeId)
  for (const id of toOpen) openCompanion(id)
  createChatWindow()
  createTray()
  startIdleLife()
  startInitiative()
  startActiveApp()
  startCursorFeed()
  startWeatherFeed()
})

app.on('window-all-closed', () => {
  for (const c of companions) c.shutdown()
  if (cursorTimer) clearInterval(cursorTimer)
  if (idleTimer) clearInterval(idleTimer)
  if (weatherTimer) clearInterval(weatherTimer)
  if (kimodo) kimodo.stop()
  if (voiceService) voiceService.shutdown()
  endMicHold(null)
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!companions.some(c => c.alive()) && personas) { companions.length = 0; openCompanion(personas.activeId) }
    if (!chatWindow || chatWindow.isDestroyed()) createChatWindow()
  }
})
