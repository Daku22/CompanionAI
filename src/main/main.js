const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, protocol, net, dialog, safeStorage, session, powerMonitor, utilityProcess, globalShortcut, desktopCapturer } = require('electron')
const path  = require('path')
const { spawn } = require('child_process')
const fs    = require('fs')
const os    = require('os')
const { route, PROVIDERS, describeError, listModels, EMOTIONS, ANIMATIONS, SYSTEM_PROMPT, MOTION_PROMPT, modelCaps: modelCapsOf, validImage } = require('./ai-router')
const { MemoryManager } = require('../memory/MemoryManager')
const { AvatarLibrary } = require('./AvatarLibrary')
const { SceneLibrary, ObjectLibrary } = require('./SceneLibrary')
const { AnimationLibrary, ANIMATION_SLOTS, SLOT_LABELS, isGlb } = require('./AnimationLibrary')
const { KimodoService, motionPrompt, cacheKey } = require('./kimodo-service')
const winWindows = require('./win-windows')
const { findWindowSeat, findTaskbarSeat, taskbarEdge, perchPosition, staysSeated } = require('./perch')
const edgePeek = require('./edge-peek')
const { builtinAvatars } = require('./builtin-avatars')
const room = require('./room')
const { WeatherService } = require('./weather')
const { isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender, checkMotion, keysForDisk, legacyKeyProvider, WINDOW_SCALES, voiceConfig, allowPermission, MIC_SHORTCUTS, APP_SHORTCUTS, shortcutsConfig, settingsPage, checkThumbPng, checkLive2DChoices, allowDisplayCapture, danceApps, DANCE_APPS_DEFAULT, chibiAvatars, chibiUnavailable } = require('./guards')
const winAudio = require('./win-audio')
const { VoiceService } = require('./voice')
const { XttsEngine } = require('./xtts-engine')
const xttsSetup = require('./xtts-setup')
const kimodoSetup = require('./kimodo-setup')
const SetupComponents = require('./setup-components')
const live2dCore = require('./live2d-core')
// La licenza del modello XTTS-v2, al commit scaricato.
const XTTS_LICENSE_URL = 'https://huggingface.co/coqui/XTTS-v2/blob/6c2b0d75eae4b7047358e3b6bd9325f857d43f77/LICENSE.txt'
const { walkTarget } = require('./walk-target')
const { setupLogging } = require('./logger')
const moodLib = require('./mood')
const Personas = require('./personas')
const Rapport = require('./rapport')
const Needs = require('./needs')
const Food = require('./food')
const { takeSentences } = require('./speech-text')
const Objects = require('./objects')
const { createDesktopObjects } = require('./desktop-objects')
const { createLiveSession } = require('./live-session')
const { streamConfig, liveLine, LIVE_PROMPT } = require('./live-chat')
const GameMode = require('./game-mode')
const Screens = require('./screens')
const { createGameLoop } = require('./game-loop')
const Diary = require('./diary')
const Initiative = require('./initiative')
const ActiveApp = require('./active-app')
const Mcp = require('./mcp')
const { writeAtomic } = require('./write-atomic')
const touchReact = require('./touch-react')
const { createCompanion } = require('./companion')
const Companions = require('./companions')
const Group = require('./group-chat')

let tray            = null
let avatarLibrary   = null
let sceneLibrary    = null
let objectLibrary   = null
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
  // La barra a pillola sempre visibile (Blocco 9b): spenta, compare al passaggio del mouse.
  cfg.hudPinned = cfg.hudPinned === true
  // Scorciatoie della chat e dei companion (Blocco 9c), con i predefiniti.
  cfg.shortcuts = shortcutsConfig(cfg)
  // Fame e sete (Blocco 10a): accese di base.
  cfg.needs = cfg.needs !== false
  cfg.activeAppIgnore = ActiveApp.cleanIgnore(cfg.activeAppIgnore) || ActiveApp.IGNORE_DEFAULT
  // Con piu' monitor: quale si fotografa (il suo di base, uno scelto, tutti).
  cfg.visionScreen = Screens.cleanScreenChoice(cfg.visionScreen)
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
    // Scorciatoie dell'app (Blocco 9c): quelle registrate davvero, e le scelte.
    shortcutsActive: { ...appShortcuts },
    stream: streamConfig(cfg),
    game: GameMode.gameConfig(cfg),
    // "Quanto parla": i tempi di ogni scelta per il modello che guarda (sul PC o online).
    gameTalk: (() => {
      const g = GameMode.gameConfig(cfg)
      const t = GameMode.gameTiming(g, { provider: cfg.provider, model: cfg.model })
      return { local: t.local, times: GameMode.TALK_TIMES[t.local ? 'local' : 'online'], timing: t }
    })(),
    appShortcuts: Object.entries(APP_SHORTCUTS).map(([id, label]) => ({ id, label })),
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
  const cfg = loadConfig()
  const current = voiceConfig(cfg)
  return {
    activeId: personas.activeId,
    // Chi e' sul desktop (Blocco 8b), e quanti ce ne stanno.
    open: companions.map(c => c.personaId),
    maxOpen: Companions.MAX_OPEN,
    list: personas.list.map(({ id, name, prompt, voice, avatarModel }) => {
      const v = id === personas.activeId ? current : { ...current, ...(voice || {}) }
      // L'avatar della persona ('' = il predefinito): la sua miniatura nelle card.
      const avatar = avatarModel || (id === personas.activeId ? cfg.avatarModel : '') || ''
      return { id, name, prompt, avatarModel: avatar, voice: { engine: v.engine, kokoroVoice: v.kokoroVoice, xttsSpeaker: v.xttsSpeaker } }
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
      // La sua chat singola passa alla persona nuova.
      const w = chatOf(c)
      if (w) try { w.webContents.send('chat-mode', { mode: 'single', personaId: id }) } catch (_) {}
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

// Il rapporto di ogni persona, per le card di Personaggi (Blocco 9c): dal suo
// companion se e' sul desktop, altrimenti dal suo file.
handle('personas:rapport', async () => {
  const out = {}
  for (const p of personas ? personas.list : []) {
    const c = companions.find(x => x.personaId === p.id)
    try {
      out[p.id] = c ? c.publicMood().rapport
        : Rapport.publicRapport(await Rapport.loadRapport(path.join(Personas.personaDir(MEMORY_PATH, p.id), 'rapport.json')))
    } catch (_) {}
  }
  return out
})

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
const prefs = { idleLife: true, touch: true, followMouse: true, perch: true, hudPinned: false, paused: false, needs: true }
// Solo per audit.mjs: un cursore finto per la sbirciata.
let testCursor = null

const companionCtx = {
  MEMORY_PATH, MEMORY_CONTEXT_TOKENS, prefs,
  // Oggetti sul desktop (Blocco 10e): la vita a riposo ci gioca.
  hasToy: (c) => desktopObjects.hasToy(c),
  playAlone: (c) => desktopObjects.playAlone(c),
  loadConfig, saveConfig, sendSettings,
  memoryModel: () => memoryModelFrom(loadConfig()),
  diaryPath: (id) => diaryPath(id),
  persona: (id) => (personas ? personas.list.find(p => p.id === id) || null : null),
  chatOf: (c) => chatOf(c),
  chatFocused: () => allChats().some(w => w.isFocused()),
  isChatTarget: (c) => chatTarget() === c,
  lastForeign: () => lastForeign,
  // La scena del gioco (2 minuti, finche' non cambia) e quello che questo
  // companion ne ha detto ad alta voce (5 minuti): Blocco 12c.
  gameLine: (personaId) => [GameMode.sceneLine(gameScene, Date.now()), GameMode.saidLine(gameSaid, personaId, Date.now())].filter(Boolean).join(' ') || null,
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
  guestHost: (c) => guestHost(c),
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
  // La sua chat singola, nascosta finche' non la si apre (Blocco 9b).
  ensureChatFor(c)
  c.initMood().catch(e => console.error('[mood] caricamento fallito:', e.message))
  // Con la stanza aperta entra subito anche lui, come ospite.
  if (roomHost()) onViewChanged()
  return c
}

/**
 * Stanza aperta o chiusa (Blocco 8e). Nella stanza entrano tutti: gli altri
 * companion nascondono la loro finestra e diventano ospiti della scena del
 * companion di casa. Chi ha un avatar Live2D o 2D resta sul desktop.
 */
const guestIds = new Set()
const THREE_D_KINDS = new Set(['vrm', 'gltf', 'glb', 'fbx'])

async function syncGuests() {
  const host = roomHost()
  if (!host) {
    guestIds.clear()
    for (const c of companions) if (c.alive() && !c.win.isVisible()) c.win.showInactive()
    return
  }
  const avatars = avatarLibrary ? await avatarLibrary.list().catch(() => []) : []
  const kindOf = (c) => { const a = avatars.find(x => x.id === c.avatarId()) || avatars.find(x => x.default) || avatars[0]; return a ? a.kind : '' }
  // Usciti dalla stanza (chiusi o tolti dal desktop).
  for (const id of [...guestIds]) {
    if (!companions.some(c => c.personaId === id)) { guestIds.delete(id); host.send('room-guest', { op: 'remove', id }) }
  }
  let index = 0
  for (const c of companions) {
    if (c === host || !c.alive()) continue
    const spot = room.guestSpot(index++)
    if (!THREE_D_KINDS.has(kindOf(c))) { c.win.showInactive(); continue }
    if (guestIds.has(c.personaId)) continue
    guestIds.add(c.personaId)
    c.win.hide()
    host.send('room-guest', { op: 'add', id: c.personaId, name: (c.persona() || {}).name || c.personaId, avatarId: c.avatarId(), spot })
    c.broadcastMood()
  }
}

function onViewChanged() {
  syncGuests().catch(e => console.error('[stanza] ospiti:', e.message))
  buildTrayMenu()
}

/** Il companion di casa, se c e' ospite nella stanza. */
const guestHost = (c) => { const host = roomHost(); return host && host !== c && guestIds.has(c.personaId) ? host : null }

/** Chiude un companion: torna dalla stanza, ricorda il posto, chiude la finestra. */
function closeCompanion(c) {
  if (c.viewMode === 'room') c.setView('desktop')
  c.shutdown()
  if (speakingCompanion === c) { if (voiceService) voiceService.stop(); speakingCompanion = null }
  const i = companions.indexOf(c)
  if (i >= 0) companions.splice(i, 1)
  closeChatFor(c)
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
    ensureGroupChat()
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
  onViewChanged()
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

// ─── HUD: barra a pillola e capsule (Blocco 9b) ─────────────────────────────
// Una finestra sola per tutti i companion: compare attorno a quello sotto il
// mouse (o, con "Barra sempre visibile", attorno a quello della chat) e lo
// segue. Lascia passare i clic tranne sui comandi (hud.js). Mai durante la
// sbirciata o nella stanza, dove i comandi stanno nella barra della stanza.
const HUD_LINGER_MS = 1200       // fuori da companion e comandi, resta ancora un attimo
const HUD_STATE_EVERY = 30       // tick del cursore fra un aggiornamento dello stato e l'altro (~1 s)
let hudWindow = null
let hudFor = null                // il companion a cui e' attaccato
let hudShown = false
let hudHot = false               // il mouse e' sopra i comandi
let hudHideAt = 0
let hudDragging = false
let hudLayoutKey = ''
let hudTicks = 0
let paused = false               // "Pausa" dalla pillola: zitti e fermi
let unread = 0                   // messaggi arrivati con la chat chiusa

function createHudWindow() {
  hudWindow = new BrowserWindow({
    width: 300, height: 320, show: false,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  })
  hudWindow.loadFile(path.join(__dirname, '../renderer/hud.html'))
  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  hudWindow.setIgnoreMouseEvents(true, { forward: true })
}

function sendHud(data) {
  if (!hudWindow || hudWindow.isDestroyed()) return
  try { hudWindow.webContents.send('hud-state', data) } catch (_) {}
}

function hudState(c) {
  const voice = voiceConfig(loadConfig())
  return {
    name: (c.persona() || {}).name || c.personaId,
    mood: c.publicMood(),
    mic: { enabled: !!voice.micEnabled && !!voiceService && voiceService.sttInstalled(), listening: micBusy || !!handsFree, handsFree: !!handsFree },
    paused, unread,
    // Il tasto della chat di gruppo c'e' solo con piu' companion sul desktop.
    group: companions.length > 1,
    game: gameHud(c),
  }
}

const insideRect = (p, r) => !!r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height
// Dove l'HUD non va: sbirciando, nella stanza, nascosto.
const hudAllowed = (c) => !!c && c.alive() && c.win.isVisible() && c.viewMode === 'desktop' && !c.peekState()

function placeHud(c) {
  const b = c.bounds
  const p = Companions.hudPlacement(b, screen.getDisplayMatching(b).workArea)
  const cur = hudWindow.getBounds()
  if (cur.x !== p.bounds.x || cur.y !== p.bounds.y || cur.width !== p.bounds.width || cur.height !== p.bounds.height) hudWindow.setBounds(p.bounds)
  const key = JSON.stringify([p.avatar, p.pill])
  if (key !== hudLayoutKey) { hudLayoutKey = key; sendHud({ layout: { avatar: p.avatar, pill: p.pill } }) }
}

function hideHud() {
  if (!hudShown) return
  hudShown = false
  hudHot = false
  sendHud({ shown: false })
  // La pagina sfuma, poi la finestra sparisce e smette di prendere il mouse.
  setTimeout(() => { if (!hudShown && hudWindow && !hudWindow.isDestroyed()) { hudWindow.hide(); hudWindow.setIgnoreMouseEvents(true, { forward: true }) } }, 200)
}

/** Ogni tick del cursore: a chi attaccarsi, dove stare, quando sparire. */
function hudTick(cursor) {
  if (!hudWindow || hudWindow.isDestroyed()) return
  // La maniglia ha preso il companion: si posa quando si lascia il tasto.
  if (hudDragging && hudFor && winWindows.available() && !winWindows.isKeyDown(0x01)) { hudDragging = false; hudFor.endDrag() }
  const under = companions.find(c => hudAllowed(c) && insideRect(cursor, c.bounds))
  let target = under || ((hudHot || hudDragging) && hudAllowed(hudFor) ? hudFor : null)
  if (!target && prefs.hudPinned && hudAllowed(chatTarget())) target = chatTarget()
  const now = Date.now()
  if (target) {
    hudHideAt = now + HUD_LINGER_MS
    if (target !== hudFor || !hudShown) { hudFor = target; sendHud(hudState(target)) }
    placeHud(target)
    if (!hudShown) {
      hudShown = true
      hudWindow.showInactive()
      hudWindow.moveTop()
      sendHud({ shown: true })
    }
  } else if (hudShown) {
    if (hudFor && hudAllowed(hudFor) && now < hudHideAt) placeHud(hudFor)
    else hideHud()
  }
  if (hudShown && hudFor && ++hudTicks % HUD_STATE_EVERY === 0) sendHud(hudState(hudFor))
}

on('hud:capture', (_e, capture) => {
  hudHot = capture === true
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.setIgnoreMouseEvents(!hudHot, { forward: true })
})

on('hud:action', async (_e, cmd) => {
  const c = hudFor
  if (!c || !c.alive()) return
  switch (cmd) {
    case 'chat': await openChatWith(c); break          // la chat singola con lui
    case 'group-chat': openGroupChat(); break           // la chat di gruppo
    // Il microfono della pillola accende e spegne le mani libere (Blocco 11b).
    case 'mic': toggleHandsFree(c); break
    case 'pause':
      paused = !paused
      prefs.paused = paused
      if (paused && voiceService) voiceService.stop()
      console.log('[hud] ' + (paused ? 'in pausa' : 'ripresa'))
      sendHud({ paused })
      break
    case 'people':
      if (personas && hudWindow) Menu.buildFromTemplate(companionsMenu().submenu).popup({ window: hudWindow })
      break
    case 'settings': openSettings(); break
    case 'room': c.setView('room'); hideHud(); break
    case 'avatar': c.send('menu-command', { cmd: 'avatars' }); break
    case 'food': openItemsPanel(c, 'food'); break
    case 'objects': openItemsPanel(c, 'objects'); break
    case 'hide': c.win.hide(); hideHud(); break
    case 'drag': hudDragging = true; c.startDrag(); break
    // La modalita' gioco (Blocco 12b): guarda questo companion.
    case 'game': toggleGame(c); break
  }
})

// ─── Cibo e oggetti (Blocchi 10b e 10c) ──────────────────────────────────────
// Il pannello (items.html) accanto al companion, in modo "cibo" o "oggetti", e
// il trascinamento: premendo su una card si apre il "fantasma" (ghost.html)
// che segue il cursore. Il cibo lasciato sopra un companion lo mangia (feed);
// un oggetto finisce sul desktop (desktop-objects.js), o in braccio o in bocca
// al companion su cui lo lasci. Il rilascio lo dice la pagina, o koffi se il
// tasto si lascia fuori finestra.
const FOOD_DIR = path.join(__dirname, '..', '..', 'modelli-3d', 'food')
const OBJECTS_DIR = path.join(__dirname, '..', '..', 'modelli-3d', 'objects')
let foodCatalog = null
let includedObjects = null
let importedObjects = []   // record di ObjectLibrary, riletti a ogni modifica
/** Gli oggetti della borsa: gli inclusi e gli importati. */
const objectItems = () => [...(includedObjects || (includedObjects = Objects.loadIncluded(OBJECTS_DIR))), ...importedObjects.map(Objects.fromRecord)]
/** Il cibo: il catalogo (food.json) e gli oggetti importati di tipo Cibo o Bevanda. */
const foodItems = () => [...(foodCatalog || (foodCatalog = Food.loadCatalog(FOOD_DIR))), ...objectItems().map(Objects.asFood).filter(Boolean)]
async function refreshImportedObjects() {
  try { importedObjects = objectLibrary ? await objectLibrary.list() : [] } catch (e) { console.warn('[oggetto] libreria illeggibile:', e.message) }
  sendItemsChanged()
}
let itemsWindow = null
let itemsMode = 'food'
let itemDrag = null   // { item, kind, ghost, started } mentre si trascina
const sendItemsChanged = () => { if (itemsWindow && !itemsWindow.isDestroyed()) itemsWindow.webContents.send('items-changed', {}) }

// Gli oggetti sul desktop: fisica, presa e lancio, inseguire e abbracciare.
const desktopObjects = createDesktopObjects({
  companions: () => companions,
  companionAt: (p) => companionAt(p),
  cursor: () => testCursor || screen.getCursorScreenPoint(),
  windowHeight: () => (WINDOW_SCALES[loadConfig().scale] || WINDOW_SCALES.m).height,
  alwaysOnTop: () => loadConfig().alwaysOnTop !== false,
  preload: path.join(__dirname, 'preload.js'),
  page: path.join(__dirname, '../renderer/object.html'),
  onChange: () => sendItemsChanged(),
})

function createItemsWindow() {
  const win = new BrowserWindow({
    width: 320, height: 430,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('closed', () => { if (itemsWindow === win) itemsWindow = null })
  return win
}

/** Apre il pannello del cibo o degli oggetti accanto a c, dal lato dove c'e' posto. */
function openItemsPanel(c, mode = 'food') {
  if (!c || !c.alive()) return
  mode = mode === 'objects' ? 'objects' : 'food'
  const fresh = !itemsWindow || itemsWindow.isDestroyed()
  if (fresh) itemsWindow = createItemsWindow()
  if (fresh || mode !== itemsMode) itemsWindow.loadFile(path.join(__dirname, '../renderer/items.html'), { query: { mode } })
  itemsMode = mode
  const b = c.bounds
  const area = c.workArea()
  const [w, h] = itemsWindow.getSize()
  const left = b.x - w - 8
  const x = left >= area.x ? left : Math.min(b.x + b.width + 8, area.x + area.width - w)
  const y = Math.max(area.y, Math.min(b.y + b.height - h, area.y + area.height - h))
  itemsWindow.setPosition(Math.round(x), Math.round(y))
  itemsWindow.show()
}
function closeItemsPanel() { if (itemsWindow && !itemsWindow.isDestroyed()) itemsWindow.hide() }

/** Il companion sotto un punto dello schermo (la sua finestra, sul desktop), o null. */
const companionAt = (p) => companions.find(c => c.alive() && c.win.isVisible() && c.viewMode === 'desktop' && insideRect(p, c.bounds)) || null

function startItemDrag(id, kind = 'food') {
  const item = (kind === 'object' ? objectItems() : foodItems()).find(it => it.id === id)
  if (!item) return false
  endItemDrag(null)
  const icon = item.icon || (kind === 'object' ? 'vrm://objects/icons/' + item.id + '.png' : 'vrm://food/icons/' + item.id + '.png')
  const ghost = new BrowserWindow({
    width: 72, height: 72, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    focusable: false, hasShadow: false, show: false, webPreferences: { sandbox: true, contextIsolation: true },
  })
  ghost.setIgnoreMouseEvents(true)
  ghost.setAlwaysOnTop(true, 'screen-saver')
  ghost.loadFile(path.join(__dirname, '../renderer/ghost.html'), { query: { src: icon } })
  ghost.once('ready-to-show', () => { if (itemDrag && itemDrag.ghost === ghost && !ghost.isDestroyed()) ghost.showInactive() })
  itemDrag = { item, kind, ghost, started: Date.now() }
  return true
}

/**
 * Fine del trascinamento. Il cibo sopra un companion: glielo da' (il
 * companion, o null). Un oggetto: fuori dal pannello va sul desktop, e
 * desktop-objects decide il resto (risultato di release, o null).
 */
function endItemDrag(point) {
  const d = itemDrag
  itemDrag = null
  if (!d) return null
  if (!d.ghost.isDestroyed()) d.ghost.destroy()
  if (d.kind === 'object') {
    if (!point || (itemsWindow && !itemsWindow.isDestroyed() && itemsWindow.isVisible() && insideRect(point, itemsWindow.getBounds()))) return null
    const e = desktopObjects.spawn(d.item, point)
    return e ? desktopObjects.release(e, point) : null
  }
  const c = point && companionAt(point)
  return c && c.feed(d.item) ? c : null
}

/** A ogni tick del cursore: il fantasma segue il mouse. */
function itemsTick(cursor) {
  desktopObjects.tick(cursor)
  const d = itemDrag
  if (!d) return
  if (!d.ghost.isDestroyed()) d.ghost.setPosition(Math.round(cursor.x - 36), Math.round(cursor.y - 36))
  if (winWindows.available() && Date.now() - d.started > 300 && !winWindows.isKeyDown(0x01)) endItemDrag(cursor)
  else if (Date.now() - d.started > 60000) endItemDrag(null)
}

handle('items:list', () => ({
  mode: itemsMode,
  food: foodItems().map(it => ({ ...Food.publicItem(it), icon: it.icon !== undefined ? it.icon : 'vrm://food/icons/' + it.id + '.png' })),
  objects: objectItems().map(Objects.publicObject),
  onDesk: desktopObjects.count, maxOnDesk: desktopObjects.MAX_ON_DESK,
}))
on('items:close', () => closeItemsPanel())
on('items:drag', (_e, msg) => {
  const phase = msg && msg.phase
  if (phase === 'start' && typeof msg.id === 'string') startItemDrag(msg.id, msg.kind === 'object' ? 'object' : 'food')
  else if (phase === 'drop') endItemDrag(testCursor || screen.getCursorScreenPoint())
  else if (phase === 'cancel') endItemDrag(null)
})

// Oggetti importati (Blocco 10c): la scelta del file la fa il main, il
// pannello riceve l'oggetto nuovo (senza tipo finche' non lo sceglie) e poi
// ne manda tipo, nome, misura e la miniatura scattata dalla sua anteprima.
const publicImported = (rec) => {
  const o = Objects.fromRecord(rec)
  return { ...Objects.publicObject(o), url: o.url, format: o.format, textures: o.textures }
}
handle('objects:import', async () => {
  if (!objectLibrary) return { ok: false }
  const parent = itemsWindow && !itemsWindow.isDestroyed() ? itemsWindow : null
  const options = {
    title: 'Importa un oggetto',
    properties: /** @type {('openFile')[]} */ (['openFile']),
    filters: [{ name: 'Modelli 3D (glTF, GLB, FBX, OBJ)', extensions: ['glb', 'gltf', 'fbx', 'obj'] }],
  }
  const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
  try {
    const scan = await objectLibrary.scan(picked.filePaths[0])
    const rec = await objectLibrary.commit(scan.token, scan.candidates[0].id)
    await refreshImportedObjects()
    const full = importedObjects.find(r => r.id === rec.id) || rec
    return { ok: true, object: publicImported(full) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
})
// Per l'anteprima del pannello: dove sta il modello di un oggetto importato.
handle('objects:model', (_e, id) => {
  const rec = importedObjects.find(r => r.id === id)
  if (rec) return publicImported(rec)
  const o = objectItems().find(x => x.id === id)
  return o ? { ...Objects.publicObject(o), url: o.url, format: o.format, textures: [] } : null
})
handle('objects:update', async (_e, msg) => {
  const id = msg && typeof msg.id === 'string' ? msg.id : ''
  const rec = importedObjects.find(r => r.id === id)
  const meta = rec && Objects.cleanMeta(msg.meta, rec.name)
  if (!meta || !(await objectLibrary.setMeta(id, meta))) return { ok: false }
  await refreshImportedObjects()
  const obj = objectItems().find(o => o.id === id)
  if (obj) desktopObjects.updateObject(obj)
  return { ok: true, object: Objects.publicObject(obj) }
})
handle('objects:thumb', async (_e, msg) => {
  const id = msg && typeof msg.id === 'string' ? msg.id : ''
  const buf = checkThumbPng(msg && msg.png)
  if (!buf || !importedObjects.some(r => r.id === id)) return { ok: false }
  await objectLibrary.saveThumb(id, buf)
  await refreshImportedObjects()
  return { ok: true }
})
handle('objects:remove', async (_e, id) => {
  if (typeof id !== 'string' || !importedObjects.some(r => r.id === id)) return { ok: false }
  desktopObjects.storeObject(id)
  await objectLibrary.remove([id])
  await refreshImportedObjects()
  return { ok: true }
})
on('objects:store-all', () => desktopObjects.storeAll())
handle('object:info', (e) => desktopObjects.info(e.sender))
on('object:grab', (e) => { const o = desktopObjects.bySender(e.sender); if (o) desktopObjects.grab(o) })
on('object:store', (e) => { const o = desktopObjects.bySender(e.sender); if (o) desktopObjects.store(o) })

/**
 * Il cibo di un'azione "eat"/"drink" del modello (Blocco 10b): quello nominato
 * in item, se c'e' nel catalogo; se no un panino o un bicchiere d'acqua.
 */
function foodForAction(action) {
  const kind = action.animation === 'drink' ? 'drink' : 'food'
  const said = typeof action.item === 'string' ? action.item.slice(0, 60) : ''
  const all = foodItems()
  return Food.findFood(all, said, kind) || Food.findFood(all, said) || all.find(it => it.id === (kind === 'drink' ? 'acqua' : 'panino')) || null
}

/** Un messaggio arrivato in una chat chiusa: il numero sulla pillola. */
function countUnread(win) {
  if (liveWin(win) && win.isVisible()) return
  unread++
  sendHud({ unread })
}

// ─── Finestre della chat (Blocco 9b) ─────────────────────────────────────────
// Una finestra per ogni companion (la sua chat singola, che segue la sua
// persona) e una per la chat di gruppo, finche' sul desktop ce ne sono almeno
// due. Si possono tenere aperte insieme. Nascono nascoste, cosi' i messaggi
// spontanei arrivati a chat chiusa ci sono quando la si apre.
/** @type {Map<any, Electron.BrowserWindow>} companion -> la sua chat */
const chatWins = new Map()
let groupChatWindow = null
let lastChat = null   // l'ultima chat mostrata o toccata: microfono, tray, scorciatoie

const liveWin = (w) => !!w && !w.isDestroyed()
const allChats = () => [...chatWins.values(), groupChatWindow].filter(liveWin)
const chatOf = (c) => { const w = c && chatWins.get(c); return liveWin(w) ? w : null }
const groupChat = () => (liveWin(groupChatWindow) ? groupChatWindow : null)
/** Il companion di una finestra di chat singola (null per quella di gruppo). */
function chatOwnerOf(event) {
  const w = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null
  for (const [c, cw] of chatWins) if (cw === w) return c
  return null
}
/** La chat da usare quando non si sa quale: l'ultima mostrata, o quella della persona attiva. */
const currentChat = () => (liveWin(lastChat) ? lastChat : chatOf(chatTarget()) || allChats()[0] || null)

function createChatWindow(query) {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
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
  win.loadFile(path.join(__dirname, '../renderer/chat.html'), { query })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Nella stanza la scena lascia alla chat il lato destro solo se si vede.
  win.on('show', () => {
    lastChat = win
    const h = roomHost()
    if (h) h.sendViewMode()
    // Aperta una chat, i messaggi sono letti.
    if (unread) { unread = 0; sendHud({ unread }) }
  })
  win.on('focus', () => { lastChat = win })
  win.on('hide', () => { const h = roomHost(); if (h) h.sendViewMode() })
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' })
  return win
}

/** La chat singola di c, creata la prima volta. */
function ensureChatFor(c) {
  if (!chatOf(c)) chatWins.set(c, createChatWindow({ mode: 'single', persona: c.personaId }))
  return chatOf(c)
}
/** La chat di gruppo, se ci sono almeno due companion. */
function ensureGroupChat() {
  if (companions.length < 2) return null
  if (!groupChat()) groupChatWindow = createChatWindow({ mode: 'group' })
  return groupChatWindow
}
function closeChatFor(c) {
  const w = chatWins.get(c)
  chatWins.delete(c)
  if (lastChat === w) lastChat = null
  if (liveWin(w)) w.destroy()
  // Rimasto uno solo, il gruppo si chiude (la sua conversazione resta, se torna).
  if (companions.length < 2 && groupChat() && groupChatWindow.isVisible()) groupChatWindow.hide()
}

/** Mostra una chat vicino a un companion (o agganciata nella stanza). */
function showChat(win, near) {
  if (!liveWin(win)) return
  const host = roomHost()
  if (host && win === chatOf(host)) {
    // Nella stanza la chat del companion di casa ha il suo posto, a destra.
    host.dockChat()
  } else {
    try {
      // In alto a sinistra del companion, ma dentro lo schermo su cui si trova:
      // con il companion vicino al bordo la chat finiva in parte fuori vista.
      const c = near || chatTarget()
      const pos = c && c.alive() ? c.win.getPosition() : [100, 100]
      const area = c ? c.workArea() : screen.getPrimaryDisplay().workArea
      const [w, h] = win.getSize()
      const clampX = (v) => Math.max(area.x, Math.min(v, area.x + area.width - w))
      let x = clampX(pos[0] - 210)
      const y = Math.max(area.y, Math.min(pos[1] - 270, area.y + area.height - h))
      // Due chat aperte insieme non si coprono: la nuova va di lato.
      const others = allChats().filter(o => o !== win && o.isVisible()).map(o => o.getBounds())
      const covers = (cx) => others.some(o => cx < o.x + o.width && o.x < cx + w && y < o.y + o.height && o.y < y + h)
      if (covers(x)) x = [x - w - 10, x + w + 10].map(clampX).find(cx => !covers(cx)) ?? x
      win.setPosition(Math.round(x), Math.round(y))
    } catch (_) {}
  }
  win.show()
  win.focus()
}

/** Apre o chiude una chat (di base l'ultima usata). */
function toggleChat(win = currentChat()) {
  if (!liveWin(win)) return
  if (win.isVisible()) win.hide()
  else showChat(win, [...chatWins].find(([, w]) => w === win)?.[0])
}

/** Manda a ogni finestra di chat. */
function sendAllChats(channel, data) {
  for (const w of allChats()) try { w.webContents.send(channel, data) } catch (_) {}
}

// ─── Impostazioni ────────────────────────────────────────────────────────────
// Una finestra normale, con cornice: si apre dal menu col tasto destro, dalla
// tray, dalla chat e dall'HUD. Le pagine sono in SETTINGS_PAGES (guards.js),
// con la barra laterale a gruppi (Blocco 9c). page sceglie la pagina (la chat
// apre Modello); senza, si riapre sull'ultima usata.

function openSettings(page) {
  page = settingsPage(page)
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (page) sendSettings('settings-page', page)
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 920, height: 680, minWidth: 720, minHeight: 520,
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

function initVoice({ sync = true } = {}) {
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
      syncDeaf()
      const c = speakingCompanion && speakingCompanion.alive() ? speakingCompanion : chatTarget()
      // Un ospite della stanza parla dalla finestra della stanza, con la sua bocca.
      const host = c && guestHost(c)
      if (host) host.send('voice-audio', { ...msg, speaker: c.personaId })
      else if (c) c.send('voice-audio', msg)
    },
    onStatus: (status) => sendSettings('voice-status', status),
  })
  if (sync) syncVoice(loadConfig())
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

// ─── Scorciatoie dell'app (Blocco 9c) ────────────────────────────────────────
// Aprire e chiudere la chat, mostrare e nascondere i companion. Si scelgono in
// Impostazioni > Tasti rapidi; una gia' presa da un altro programma resta
// spenta, e la pagina lo dice (shortcutsActive).
const appShortcuts = { chat: null, hide: null }        // registrate davvero
const appShortcutsWanted = { chat: null, hide: null }  // scelte nella config
const SHORTCUT_ACTIONS = {
  chat: () => toggleChat(),
  hide: () => toggleCompanionsShown(),
  // Con la modalita' gioco accesa, a mani libere si parla con chi guarda.
  handsfree: () => toggleHandsFree(gameWatcher() || hudFor || chatTarget()),
  live: () => toggleLive(),
  game: () => { if (gameLoop.state().on) endGame(); else toggleGame(chatTarget()) },
}
function syncAppShortcuts(cfg) {
  const want = shortcutsConfig(cfg)
  for (const [key, run] of Object.entries(SHORTCUT_ACTIONS)) {
    const next = want[key] === 'off' ? null : want[key]
    if (next === appShortcutsWanted[key]) continue
    appShortcutsWanted[key] = next
    if (appShortcuts[key]) { try { globalShortcut.unregister(appShortcuts[key]) } catch (_) {} }
    appShortcuts[key] = null
    if (next && globalShortcut.register(next, run)) appShortcuts[key] = next
    else if (next) console.warn('[scorciatoie] ' + next + " e' gia' usata da un altro programma")
  }
}
/** Nasconde i companion (e l'HUD) se se ne vede almeno uno, altrimenti li mostra. */
function toggleCompanionsShown() {
  // Gli ospiti della stanza si vedono nella finestra di chi li ospita.
  const live = companions.filter(c => c.alive() && !guestHost(c))
  if (live.some(c => c.win.isVisible())) { for (const c of live) c.win.hide(); hideHud() }
  else for (const c of live) c.win.show()
}

// ─── Live su Twitch (Blocco 11c) ─────────────────────────────────────────────
// "In diretta" (pagina Streaming o il suo tasto rapido) collega la chat del
// canale in sola lettura (twitch-chat.js) e la sessione (live-session.js)
// sceglie a cosa rispondere; il registro va alle Impostazioni. Chi risponde
// e come: il co-host qui sotto (11d).
const liveSession = createLiveSession({
  config: () => streamConfig(loadConfig()),
  names: () => companions.filter(c => c.alive()).map(c => ({ id: c.personaId, name: (c.persona() || {}).name || c.personaId })),
  respond: (item) => liveRespond(item),
  onState: (st) => sendSettings('stream-state', st),
})

// ─── Il co-host (Blocco 11d) ─────────────────────────────────────────────────
// Chi risponde: chi e' nominato, altrimenti a turno fra i companion sul
// desktop. La risposta passa dallo streaming (11a): voce dalla prima frase,
// sottotitoli nel fumetto (sempre, anche con la chat aperta: sono per chi
// guarda la live), animazione ed emozione. Niente azioni sul sistema e niente
// memoria: il contesto sono gli ultimi 20 messaggi della live. Ogni tanto un
// altro companion aggiunge una battuta. Spenta la live, chi ha risposto
// scrive un paragrafo nel suo diario.
const LIVE_CONTEXT = 20
const LIVE_SECOND_CHANCE = 0.3
const LIVE_NO_ANIMATION = new Set(['play', 'fetch', 'eat', 'drink'])
let liveContext = []   // { role, content, speaker? }
let liveTurn = 0

const nameOf = (c) => (c.persona() || {}).name || c.personaId

/** Chi risponde: il companion nominato, se c'e', altrimenti il prossimo del turno. */
function liveResponder(item, present) {
  const named = item.to && item.to !== 'command' ? present.find(c => c.personaId === item.to) : null
  if (named) return named
  const c = present[liveTurn % present.length]
  liveTurn++
  return c
}

/**
 * Una risposta a voce di c alla riga line, con i sottotitoli nel fumetto; il
 * testo detto, o '' se non e' andata. context e prompt: quelli della live, o
 * (Blocco 12c) nessun contesto e il prompt della battuta sul gioco.
 */
async function spokenReply(c, line, { context = liveContext, prompt = LIVE_PROMPT } = {}) {
  const cfg = loadConfig()
  const apiKey = cfg.keys?.[cfg.provider] || ''
  if (cfg.provider !== 'ollama' && !apiKey) return ''
  const names = Object.fromEntries(companions.map(o => [o.personaId, nameOf(o)]))
  c.busy = true
  const speech = speechSession(c) || captionSession(c, null)
  try {
    const history = c.withMoodLine(await c.buildHistoryWithMemory(Group.historyFor([...context, { role: 'user', content: line }], c.personaId, names)))
    const result = await route({
      provider: cfg.provider, model: cfg.model, apiKey, history,
      systemPrompt: Personas.systemPrompt(c.persona(), SYSTEM_PROMPT + prompt),
      onDelta: speech ? (t) => speech.push(t) : null,
    })
    const reply = String((result && result.reply) || '').trim().slice(0, 600)
    if (speech) speech.end(reply)
    if (!reply || result.via === 'fallback') return reply
    if (EMOTIONS.includes(result.emotion)) c.updateMood(m => moodLib.react(moodLib.decay(m), result.emotion))
    const anim = result.action && ANIMATIONS.includes(result.action.animation) && !LIVE_NO_ANIMATION.has(result.action.animation) ? result.action.animation : null
    if (anim) c.animate({ type: 'none', animation: anim })
    c.markActivity()
    return reply
  } catch (e) {
    if (speech) speech.end('')
    console.error('[live] ' + c.personaId + ' non ha risposto:', e.message)
    return ''
  } finally {
    c.busy = false
  }
}

/** La risposta a una cosa scelta dalla live (live-session.js chiama questo). */
async function liveRespond(item) {
  if (paused) return { ok: false, reason: 'in pausa' }
  const present = companions.filter(c => c.alive() && c.win.isVisible())
  if (!present.length) return { ok: false, reason: 'nessun companion sul desktop' }
  const c = liveResponder(item, present)
  const line = liveLine(item)
  const reply = await spokenReply(c, line)
  if (!reply) return { ok: false, reason: 'nessuna risposta dal modello' }
  liveContext.push({ role: 'user', content: line }, { role: 'assistant', content: reply, speaker: c.personaId })
  // A volte un altro companion aggiunge una battuta, quando il primo ha finito.
  const others = present.filter(o => o !== c)
  if (others.length && Math.random() < LIVE_SECOND_CHANCE) {
    await waitForSpeech()
    const o = others[liveTurn % others.length]
    const extraLine = '[Live su Twitch] ' + nameOf(c) + ' ha appena risposto in diretta. Se ti va, aggiungi una battuta breve.'
    const extra = await spokenReply(o, extraLine)
    if (extra) liveContext.push({ role: 'user', content: extraLine }, { role: 'assistant', content: extra, speaker: o.personaId })
  }
  if (liveContext.length > LIVE_CONTEXT) liveContext = liveContext.slice(-LIVE_CONTEXT)
  // Una cosa alla volta: la prossima quando ha finito di parlare.
  await waitForSpeech()
  return { ok: true, by: nameOf(c), reply }
}

/** Spenta la live: un paragrafo nel diario di ogni companion che ha risposto. */
async function writeLiveDiaries(summary) {
  liveContext = []
  if (!summary || !summary.answered.length) return
  const cfg = loadConfig()
  const apiKey = cfg.keys?.[cfg.provider] || ''
  if (cfg.provider !== 'ollama' && !apiKey) return
  const spoke = new Set(summary.answered.map(a => a.by).filter(Boolean))
  for (const c of companions.filter(x => x.alive())) {
    const p = c.persona()
    if (!p || !spoke.has(nameOf(c))) continue
    try {
      const result = await route({
        provider: cfg.provider, model: cfg.model, apiKey, jsonMode: false, maxTokens: 800,
        systemPrompt: Diary.liveSystemPrompt(p),
        history: [{ role: 'user', content: Diary.liveTranscript(summary, nameOf(c)) }],
      })
      const text = Diary.cleanEntry(result && result.reply)
      if (!text) continue
      await Diary.appendDiary(diaryPath(p.id), { day: Rapport.dayOf(summary.endedAt), text, kind: 'live' })
      console.log('[live] paragrafo nel diario di ' + p.id)
      sendSettings('diary-changed', p.id)
    } catch (e) { console.error('[live] diario non scritto per ' + p.id + ':', e.message) }
  }
}

/** Spegne la live e fa scrivere il diario. */
function endLive() {
  const summary = liveSession.stop()
  writeLiveDiaries(summary).catch(e => console.error('[live] diario:', e.message))
}

function toggleLive() {
  const st = liveSession.state()
  const c = chatTarget()
  if (st.on) {
    endLive()
    if (c) c.send('companion-bubble', { text: 'Fine della diretta', ms: 2500 })
    return liveSession.state()
  }
  const r = liveSession.start()
  if (!r.ok) { openSettings('streaming'); return r.state }
  if (c) c.send('companion-bubble', { text: 'In diretta!', ms: 2500 })
  return r.state
}
handle('stream:state', () => liveSession.state())
handle('stream:live', (_e, on) => {
  const st = liveSession.state()
  if (on === true && !st.on) {
    const r = liveSession.start()
    return { ok: r.ok, error: r.error || '', state: r.state }
  }
  if (on === false && st.on) endLive()
  return { ok: true, error: '', state: liveSession.state() }
})

// ─── Mani libere (Blocco 11b) ────────────────────────────────────────────────
// Il microfono della pillola (o il tasto rapido) accende l'ascolto continuo
// nella chat del companion: la pagina sente quando inizi e finisci di parlare
// (mic-recorder.js, vadStep) e manda il messaggio da sola. Mentre il companion
// parla il microfono e' sordo, se no con le casse sentirebbe se stesso; con
// "Uso le cuffie" no, e parlare lo interrompe. Un clic sul companion lo
// interrompe sempre.
let handsFree = null   // { win, c, deaf, headphones, deafTimer, bubble }

function toggleHandsFree(c) {
  if (handsFree) { stopHandsFree(); return }
  const v = voiceConfig(loadConfig())
  if (!v.micEnabled || !voiceService || !voiceService.sttInstalled()) { openSettings('microfono'); return }
  c = c && c.alive() ? c : chatTarget()
  if (!c) return
  const w = ensureChatFor(c)
  if (!liveWin(w)) return
  handsFree = { win: w, c, deaf: false, headphones: !!v.headphones, deafTimer: null, bubble: true }
  try { w.webContents.send('mic-command', { cmd: 'handsfree-on' }) } catch (_) {}
  c.send('companion-bubble', { text: '🎙 Ti ascolto: parla quando vuoi', ms: 2600 })
  console.log('[mani libere] acceso per ' + c.personaId)
  syncDeaf()
  if (hudShown && hudFor) sendHud(hudState(hudFor))
}

function stopHandsFree() {
  const h = handsFree
  handsFree = null
  if (!h) return
  clearTimeout(h.deafTimer)
  if (liveWin(h.win)) try { h.win.webContents.send('mic-command', { cmd: 'handsfree-off' }) } catch (_) {}
  if (h.bubble && h.c.alive()) h.c.send('companion-bubble', { text: '' })
  console.log('[mani libere] spento')
  if (hudShown && hudFor) sendHud(hudState(hudFor))
}

/** Sordo mentre il companion parla (con le casse); di nuovo in ascolto quando ha finito. */
function syncDeaf() {
  const h = handsFree
  if (!h) return
  if (!liveWin(h.win)) { handsFree = null; return }
  const deaf = !h.headphones && speechEndsAt > Date.now()
  clearTimeout(h.deafTimer)
  if (deaf) h.deafTimer = setTimeout(syncDeaf, speechEndsAt - Date.now() + 250)
  if (deaf === h.deaf) return
  h.deaf = deaf
  try { h.win.webContents.send('mic-command', { cmd: 'deaf', deaf }) } catch (_) {}
}

/** Zitto subito: la voce e la risposta che stava arrivando (un clic sul companion, Blocco 11b). */
function interruptSpeech() {
  if (voiceService) voiceService.stop()
  speechEndsAt = 0
  if (handsFree && liveWin(handsFree.win)) {
    const ctrl = replyAborts.get(handsFree.win.webContents.id)
    if (ctrl) ctrl.abort()
  }
  syncDeaf()
}

function sendMicCommand(cmd) {
  // Il microfono registra nella chat usata per ultima.
  const w = currentChat()
  if (w) try { w.webContents.send('mic-command', { cmd }) } catch (_) {}
}

function onMicShortcut(vk) {
  // A mani libere il microfono e' gia' aperto: il tasto lo zittisce.
  if (handsFree) { interruptSpeech(); return }
  if (micHold) {
    // Il tasto tenuto giu' si ripete: si ignora. Dopo un tocco breve, il
    // tocco successivo chiude.
    if (micHold.toggle) endMicHold('stop')
    return
  }
  const w = currentChat()
  if (!w) return
  // Con la voce spenta la risposta si vede solo nella chat: la si apre.
  if (!voiceConfig(loadConfig()).enabled && !w.isVisible()) toggleChat(w)
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
  // In pausa dalla pillola (Blocco 9b) nessuno parla.
  if (!voice.enabled || !voiceService || paused) return
  speakingCompanion = c
  voiceService.speak(text, speakOptions(voice))
    .catch(e => console.error('[voce] ' + e.message))
}

/**
 * La voce di una risposta che arriva a pezzi (Blocco 11a): parte alla prima
 * frase finita mentre il modello scrive il resto. push riceve il testo della
 * risposta finora, end quello finale (anche se non e' arrivato niente a
 * pezzi: allora la dice tutta, come speakReply). null con la voce spenta o in
 * pausa.
 */
function speechSession(c) {
  const voice = voiceFor(c)
  if (!voice.enabled || !voiceService || paused) return null
  speakingCompanion = c
  voiceService.begin(speakOptions(voice))
  const started = Date.now()
  let spoke = false
  return sentenceFeed((sentences, final) => {
    if (sentences.length) {
      if (!spoke) { spoke = true; console.log('[voce] prima frase dopo ' + (Date.now() - started) + ' ms') }
      voiceService.push(sentences.join(' '))
    }
    if (final) voiceService.end().catch(e => console.error('[voce] ' + e.message))
  })
}

/**
 * Le frasi finite di una risposta che arriva a pezzi (takeSentences), una
 * volta sola ciascuna: push riceve il testo finora, end quello finale; emit
 * riceve le frasi nuove (e final alla fine).
 */
function sentenceFeed(emit) {
  let seen = ''
  let buffer = ''
  const feed = (final) => {
    const { sentences, rest } = takeSentences(buffer, final)
    buffer = rest
    emit(sentences, final)
  }
  return {
    push(text) {
      // Un testo che non continua il precedente (un secondo tentativo): si
      // aspetta quello finale.
      if (typeof text !== 'string' || !text.startsWith(seen)) return
      buffer += text.slice(seen.length)
      seen = text
      feed(false)
    },
    end(text) {
      if (typeof text === 'string' && text.startsWith(seen)) { buffer += text.slice(seen.length); seen = text }
      feed(true)
    },
  }
}

/**
 * Sottotitoli senza voce (Blocco 11b): con la voce spenta e la chat chiusa, le
 * frasi della risposta nel fumetto del companion mentre arrivano. null se la
 * chat si vede (si legge li') o se parla la voce (i sottotitoli seguono lei).
 */
function captionSession(c, chatWin) {
  if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible()) return null
  c.send('companion-caption', { clear: true })
  return sentenceFeed((sentences) => { for (const text of sentences) c.send('companion-caption', { text }) })
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

// toggle-chat: dal companion (doppio clic, barra della stanza) apre o chiude
// la sua chat singola; da una finestra di chat (la X) apre o chiude quella.
on('toggle-chat', (e) => {
  const c = companionOf(e)
  if (c) {
    const w = chatOf(c)
    if (w && w.isVisible()) w.hide()
    else openChatWith(c).catch(err => console.error('[chat]', err.message))
    return
  }
  const sender = e && e.sender ? BrowserWindow.fromWebContents(e.sender) : null
  if (sender && allChats().includes(sender)) { toggleChat(sender); return }
  toggleChat()
})

/**
 * Apre la chat singola con c (Blocco 9b), nella sua finestra: diventa la
 * persona attiva (quella delle Impostazioni e dell'umore in primo piano).
 */
async function openChatWith(c) {
  if (personas && c.personaId !== personas.activeId) await switchPersona(c.personaId)
  const w = ensureChatFor(c)
  if (w && !w.isVisible()) showChat(w, c)
  else if (w) w.focus()
}

/** Apre la chat di gruppo, nella sua finestra, con tutti quelli sul desktop. */
function openGroupChat() {
  const w = ensureGroupChat()
  if (w && !w.isVisible()) showChat(w, chatTarget())
  else if (w) w.focus()
}

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
const OLLAMA_PAGES = { models: 'https://ollama.com/search', download: 'https://ollama.com/download' }
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
const GAME_LONG_SIDE = 1024   // per i commenti della modalita' gioco: costa meno

/** I monitor collegati, per screens.js. */
function displayList() {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, size: d.size, label: d.label || '', primary: d.id === primary }))
}

/**
 * I monitor in un'immagine sola, con il lato lungo di longSide px: uno, o
 * piu' affiancati nelle loro posizioni (screens.js).
 */
async function shootDisplays(displays, longSide) {
  const plan = Screens.layout(displays, longSide)
  const box = { width: Math.max(...plan.parts.map(p => p.width)), height: Math.max(...plan.parts.map(p => p.height)) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box })
  const sourceOf = (id) => sources.find(s => s.display_id === String(id))
  if (plan.parts.length === 1) {
    const source = sourceOf(plan.parts[0].id) || sources[0]
    return source ? source.thumbnail : null
  }
  const pieces = []
  for (const p of plan.parts) {
    const source = sourceOf(p.id)
    if (!source) continue
    const img = source.thumbnail.resize({ width: p.width, height: p.height })
    const size = img.getSize()
    pieces.push({ x: p.x, y: p.y, width: size.width, height: size.height, bitmap: img.toBitmap() })
  }
  if (!pieces.length) return null
  return nativeImage.createFromBitmap(Screens.compose(plan.width, plan.height, pieces), { width: plan.width, height: plan.height })
}

/**
 * Lo schermo scelto nella pagina Visione (di base quello su cui sta anchor,
 * o un monitor preciso, o tutti), con il lato lungo di longSide px. hideApp:
 * le finestre dell'app spariscono per un istante (il pulsante "Guarda lo
 * schermo"); la modalita' gioco no, se no lampeggerebbero a ogni sguardo.
 */
async function captureScreen(anchor, longSide, { hideApp = true } = {}) {
  if (!anchor || anchor.isDestroyed()) return { ok: false, error: 'Nessuna finestra' }
  const displays = Screens.pickDisplays(displayList(), loadConfig().visionScreen, screen.getDisplayMatching(anchor.getBounds()).id)
  if (!displays.length) return { ok: false, error: 'Schermo non trovato' }
  const wins = hideApp ? [...companions.map(c => c.win), ...allChats(), settingsWindow].filter(w => w && !w.isDestroyed() && w.isVisible()) : []
  try {
    for (const w of wins) w.setOpacity(0)
    if (wins.length) await new Promise(r => setTimeout(r, 250))
    const picture = await shootDisplays(displays, longSide)
    if (!picture || picture.isEmpty()) return { ok: false, error: 'Schermo non trovato' }
    return { ok: true, image: 'data:image/jpeg;base64,' + picture.toJPEG(80).toString('base64'), picture, title: 'schermo' }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    for (const w of wins) if (!w.isDestroyed()) w.setOpacity(1)
  }
}

// Le card della pagina Visione: quale schermo, con la miniatura di ciascuno.
handle('vision:screens', async () => {
  try {
    const all = displayList()
    const c = chatTarget()
    const own = screen.getDisplayMatching((c && c.alive() ? c.win : currentChat() || { getBounds: () => screen.getPrimaryDisplay().bounds }).getBounds()).id
    const out = []
    for (const o of Screens.screenOptions(all, own)) {
      const shown = o.ids.map(id => all.find(d => d.id === id)).filter(Boolean)
      const plan = Screens.layout(shown, 1000)
      const thumb = await shootDisplays(shown, 240).catch(() => null)
      out.push({ choice: o.choice, label: o.label, sub: o.sub, aspect: plan.width / plan.height, thumb: thumb && !thumb.isEmpty() ? thumb.toDataURL() : '' })
    }
    return out
  } catch (e) {
    console.error('[visione] schermi non letti:', e.message)
    return []
  }
})

handle('vision:capture', async () => {
  const r = await captureScreen(dialogParent() || currentChat(), VISION_LONG_SIDE)
  return r.ok ? { ok: true, image: r.image } : { ok: false, error: r.error }
})

// ─── Modalita' gioco: la finestra e il modello (Blocco 12a) ─────────────────
// Le finestre aperte degli altri programmi (non le nostre, non quelle
// dell'elenco da ignorare), con titolo, programma e miniatura. Gli id di
// desktopCapturer ("window:<HWND>:0") contengono l'handle di Windows, da cui
// win-windows.js legge processo, stato e misure.
async function gameWindows(thumbnailSize = { width: 160, height: 100 }) {
  const ignore = (loadConfig().activeAppIgnore || []).map(w => w.toLowerCase())
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize, fetchWindowIcons: false })
  const out = []
  for (const s of sources) {
    const hwnd = Number(String(s.id).split(':')[1]) || 0
    const title = String(s.name || '').replace(/\s+/g, ' ').trim()
    if (!title || ignore.some(w => title.toLowerCase().includes(w))) continue
    const info = winWindows.windowInfo(hwnd)
    if (info && info.pid === process.pid) continue
    const st = winWindows.windowState(hwnd)
    out.push({
      id: s.id, hwnd, title,
      app: info ? winWindows.exeOf(info.pid) : '',
      area: st && st.bounds ? st.bounds.width * st.bounds.height : 0,
      minimized: !!(st && st.minimized),
      picture: s.thumbnail,
    })
  }
  return out
}

/**
 * Lo scatto per la modalita' gioco: la finestra scelta (solo lei, i
 * companion non spariscono) o lo schermo del companion. state dice perche'
 * non c'e': 'none' (niente scelto), 'missing' (finestra chiusa),
 * 'minimized' (ridotta a icona), 'empty' (nessuna immagine).
 */
async function captureGame(longSide = GAME_LONG_SIDE) {
  const g = GameMode.gameConfig(loadConfig())
  if (!g.source) return { ok: false, state: 'none' }
  if (g.source.kind === 'screen') {
    const c = chatTarget()
    const r = await captureScreen(c && c.alive() ? c.win : currentChat(), longSide, { hideApp: false })
    return r.ok ? { ...r, state: 'ok', title: 'lo schermo', screen: true } : { ok: false, state: 'empty', error: r.error }
  }
  const sources = await gameWindows({ width: longSide, height: longSide })
  let w = GameMode.findSource(sources, g.source, { exact: true })
  if (!w) {
    // Le finestre ridotte a icona non sono fra quelle da catturare: si
    // cercano fra quelle di Windows, per dire "ridotta" invece di "chiusa".
    // Prima quella con il titolo giusto, poi (titolo cambiato) dal programma:
    // cosi' un gioco ridotto non diventa il suo launcher.
    const all = winWindows.listWindows().filter(x => x.title && x.pid !== process.pid).map(x => ({ id: String(x.hwnd), title: x.title, app: winWindows.exeOf(x.pid), minimized: x.minimized }))
    const minimized = (x) => x && x.minimized ? { ok: false, state: 'minimized', title: x.title } : null
    const hidden = minimized(GameMode.findSource(all, g.source, { exact: true }))
    if (hidden) return hidden
    w = GameMode.findSource(sources, g.source)
    if (!w) return minimized(GameMode.findSource(all, g.source)) || { ok: false, state: 'missing' }
  }
  if (w.minimized) return { ok: false, state: 'minimized', title: w.title }
  if (!w.picture || w.picture.isEmpty()) return { ok: false, state: 'empty', title: w.title }
  return { ok: true, state: 'ok', image: 'data:image/jpeg;base64,' + w.picture.toJPEG(80).toString('base64'), picture: w.picture, title: w.title, app: w.app, hwnd: w.hwnd }
}

handle('vision:sources', async () => {
  try {
    return (await gameWindows()).map(w => ({ id: w.id, title: w.title, app: w.app, minimized: w.minimized,
      thumb: w.picture && !w.picture.isEmpty() ? w.picture.toDataURL() : '' }))
  } catch (e) {
    console.error('[gioco] finestre non lette:', e.message)
    return []
  }
})

// La prova del modello che guarda: un quadrato rosso su bianco, e la domanda
// di che colore e'. Solo chi lo vede davvero risponde giusto.
function testPicture() {
  const size = 96
  const buf = Buffer.alloc(size * size * 4, 255)
  for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) { const i = (y * size + x) * 4; buf[i] = 30; buf[i + 1] = 30; buf[i + 2] = 220 }
  return 'data:image/png;base64,' + nativeImage.createFromBitmap(buf, { width: size, height: size }).toPNG().toString('base64')
}
handle('game:test-vision', async (_e, input) => {
  const provider = input && typeof input.provider === 'string' ? input.provider : ''
  const model = input && typeof input.model === 'string' ? input.model.slice(0, 200) : ''
  if (!PROVIDERS[provider] || !model) return { ok: false, error: 'Scegli un provider e un modello.' }
  const apiKey = loadConfig().keys?.[provider] || ''
  const started = Date.now()
  try {
    const result = await route({
      provider, model, apiKey, fallback: false, retries: 0, jsonMode: false, maxTokens: 400,
      history: [{ role: 'user', content: 'Di che colore è il quadrato al centro dell\'immagine? Rispondi con una parola sola.', image: testPicture() }],
    })
    const said = String(result.reply || '').trim().slice(0, 80)
    return { ok: true, sees: /ross|red/i.test(said), said, ms: Date.now() - started }
  } catch (err) {
    return { ok: false, error: describeError(err, provider) }
  }
})

// ─── Modalita' gioco: il ciclo (Blocco 12b) ─────────────────────────────────
// Il pulsante "gioco" della pillola (o il suo tasto rapido) accende il ciclo
// (game-loop.js) per quel companion: ogni 5 s l'impronta minuscola della
// finestra, lo sguardo vero (lo scatto a 1024 px) solo quando la scena cambia,
// e' passato l'intervallo e il tetto all'ora lo permette. In pausa da sola
// se la finestra si chiude o si riduce a icona, o se va in primo piano
// un'app da ignorare.
// Lo sguardo (Blocco 12c) e' una chiamata in prosa al modello che guarda:
// SCENA e COMMENTO. La scena resta 2 minuti come contesto della chat, delle
// mani libere e della live; il commento va a voce e nel fumetto (non in
// chat), e ogni tanto un altro companion aggiunge una battuta. A fine
// partita una riga nella memoria di chi guardava. Le immagini non si salvano
// mai, e nel log c'e' solo com'e' andato lo sguardo.
const GAME_SIG_SIDE = 64
const GAME_MAX_ERRORS = 3          // sguardi falliti di fila prima di fermarsi
const GAME_REACT_PROMPT = `

MODALITA' GIOCO
L'utente sta giocando e tu guardi la partita insieme a un altro companion, che l'ha appena commentata. Rispondi con una battuta breve da dire ad alta voce (al massimo 15 parole), nel tuo carattere, senza ripetere quello che ha detto l'altro. Niente azioni sul computer.`
let gameModel = null       // { provider, model, cost }: il modello che guarda e quanto costa uno sguardo
let gameLast = null        // l'ultimo sguardo (per l'audit)
let gameScene = null       // { text, title, at }: l'ultima scena vista, contesto per 2 minuti
let gameScenes = []        // { text, comment, at }: le scene della partita, per la riga in memoria
let gameErrors = 0
let gameEnded = ''         // perche' si e' fermata da sola, per la pagina Visione
let gameSecondChance = 0.2 // un altro companion aggiunge una battuta
let gameLastComment = null // per l'audit
let gameMemory = null      // per l'audit: l'ultima riga in memoria
let gameSaid = []          // { by, text, at }: i commenti detti ad alta voce, per il prompt di chi li ha detti
let gameBlank = 0          // impronte nere di fila con la finestra grande quanto lo schermo (12d)
let gameWarned = false     // l'avviso dello schermo intero, una volta per partita

/** Il companion che guarda, se c'e'. */
function gameWatcher() {
  const st = gameLoop.state()
  return st.on ? companions.find(c => c.alive() && c.personaId === st.watcher) || null : null
}

/** Perche' adesso non si guarda: parli, scrivi o il companion sta parlando; null se si puo'. */
function gameBusy() {
  if (micBusy || (handsFree && handsFree.hearing)) return 'stai parlando'
  if (allChats().some(w => w.isFocused())) return 'stai scrivendo'
  if (Date.now() < speechEndsAt) return 'sta parlando'
  const w = gameWatcher()
  if (w && w.busy) return 'sta rispondendo'
  return null
}

/** L'impronta della finestra del gioco, o perche' non c'e'. */
async function gameSignature() {
  const st = gameLoop.state()
  if (!companions.some(c => c.alive() && c.personaId === st.watcher)) { endGame(); return { ok: false, state: 'none' } }
  const fg = winWindows.windowInfo(winWindows.foregroundWindow())
  const ignore = (loadConfig().activeAppIgnore || []).map(w => w.toLowerCase())
  if (fg && fg.title && fg.pid !== process.pid && ignore.some(w => fg.title.toLowerCase().includes(w))) return { ok: false, state: 'private' }
  const r = await captureGame(GAME_SIG_SIDE)
  if (!r.ok) return { ok: false, state: r.state }
  const sig = GameMode.signature(r.picture.resize({ width: GameMode.SIG_W, height: GameMode.SIG_H }).toBitmap())
  if (!sig) return { ok: false, state: 'empty' }
  // Schermo intero (Blocco 12d): il gioco (o, per lo schermo, la finestra in
  // primo piano) copre tutto il monitor. In finestra senza bordi i companion
  // tornano sopra a ogni giro; se l'immagine e' nera da 15 s, e' lo schermo
  // intero esclusivo, che non si cattura.
  const st2 = winWindows.windowState(r.hwnd || winWindows.foregroundWindow())
  const dip = st2 && st2.bounds ? screen.screenToDipRect(null, st2.bounds) : null
  const full = !!dip && GameMode.coversDisplay(dip, screen.getDisplayMatching(dip).bounds)
  if (full) raiseCompanions()
  gameBlank = full && GameMode.blankSig(sig) ? gameBlank + 1 : 0
  if (gameBlank >= GameMode.BLANK_TICKS) return { ok: false, state: 'fullscreen' }
  return { ok: true, sig, title: r.title }
}

/** I companion (e la barra) di nuovo sopra un gioco che copre lo schermo. */
function raiseCompanions() {
  if (loadConfig().alwaysOnTop === false) return
  for (const c of companions) c.bringToFront()
  if (hudShown && hudWindow && !hudWindow.isDestroyed()) hudWindow.moveTop()
}

/** Lo sguardo: lo scatto a 1024 px al modello che guarda, in prosa (SCENA e COMMENTO). */
async function gameLook() {
  const c = gameWatcher()
  const vision = gameModel
  if (!c || !vision) return { ok: false, capture: true, error: 'nessuno guarda' }
  const shot = await captureGame()
  if (!shot.ok) return { ok: false, capture: true, error: shot.state }
  const title = shot.screen ? '' : shot.title
  const last = gameScenes[gameScenes.length - 1]
  const started = Date.now()
  try {
    // Lo stesso companion della chat: la memoria, la conversazione recente
    // (anche a mani libere), l'umore e il rapporto, poi la schermata.
    const look = { role: 'user', image: shot.image,
      content: GameMode.lookRequest({ title, previous: last ? { scene: last.text, comment: last.comment } : null, live: liveSession.state().on }) }
    const result = await route({
      provider: vision.provider, model: vision.model, apiKey: loadConfig().keys?.[vision.provider] || '',
      jsonMode: false, maxTokens: 400, retries: 1,
      systemPrompt: Personas.systemPrompt(c.persona(), GameMode.LOOK_PROMPT),
      history: c.withMoodLine(await c.buildHistoryWithMemory([look])),
    })
    const seen = GameMode.parseGameLook(result && result.reply)
    const ms = Date.now() - started
    // Nel log solo com'e' andata: niente immagine, niente scena.
    console.log('[gioco] sguardo, ' + ms + ' ms, ' + (!seen ? 'risposta fuori formato' : seen.comment ? 'con un commento' : 'senza commento'))
    return seen ? { ok: true, ...seen, title, ms } : { ok: false, error: 'Il modello non ha risposto nel formato SCENA / COMMENTO.', ms }
  } catch (err) {
    console.warn('[gioco] sguardo non riuscito:', err.message)
    return { ok: false, daily: !!err.daily, error: describeError(err, vision.provider) }
  }
}

/** Il risultato di uno sguardo: la scena come contesto, e il commento se si puo'. */
function gameResult(r, info) {
  gameLast = r ? { ok: !!r.ok, scene: r.scene || '', comment: r.comment || '', error: r.error || '', stale: info.stale, ms: r.ms || 0 } : null
  if (!r || r.capture) return   // la finestra non c'era: al prossimo giro va in pausa
  if (!r.ok) {
    // Il limite giornaliero dei modelli gratuiti: inutile riprovare fino a domani.
    if (r.daily) { endGame('Ho finito gli sguardi gratuiti di oggi: riprova domani, o scegli un altro modello nella pagina Modello', 'Ho finito gli sguardi gratuiti di oggi'); return }
    if (++gameErrors >= GAME_MAX_ERRORS) endGame('Non riesco a vedere il gioco: ' + r.error, 'Non riesco a vedere il gioco')
    return
  }
  gameErrors = 0
  gameScene = { text: r.scene, title: r.title, at: Date.now() }
  gameScenes.push({ text: r.scene, comment: '', at: Date.now() })
  // Tante scene: se ne tiene una si' e una no, cosi' il riassunto copre tutta la partita.
  if (gameScenes.length > GameMode.MAX_SCENES) gameScenes = gameScenes.filter((_, i) => i % 2 === 0)
  const c = gameWatcher()
  if (!c || !GameMode.canComment({ comment: r.comment, stale: info.stale, busy: gameBusy(), paused })) return
  gameScenes[gameScenes.length - 1].comment = r.comment
  gameComment(c, r).catch(e => console.error('[gioco] commento:', e.message))
}

/** Il commento a voce e nel fumetto; in diretta e' anche per gli spettatori. */
async function gameComment(c, r) {
  const speech = speechSession(c) || captionSession(c, null)
  speech.end(r.comment)
  c.markActivity()
  gameLastComment = { by: c.personaId, text: r.comment, at: Date.now() }
  rememberSaid(c, r.comment)
  if (liveSession.state().on) {
    liveContext.push({ role: 'user', content: '[Modalità gioco] La scena: ' + r.scene }, { role: 'assistant', content: r.comment, speaker: c.personaId })
    if (liveContext.length > LIVE_CONTEXT) liveContext = liveContext.slice(-LIVE_CONTEXT)
  }
  // Ogni tanto un altro companion sul desktop aggiunge una battuta, quando il primo ha finito.
  const others = companions.filter(o => o !== c && o.alive() && o.win.isVisible() && !o.busy)
  if (!others.length || Math.random() >= gameSecondChance) return
  await waitForSpeech()
  if (gameWatcher() !== c || gameBusy()) return
  const o = others[Math.floor(Math.random() * others.length)]
  const extra = await spokenReply(o, '[Modalità gioco] ' + nameOf(c) + ' ha appena detto: "' + r.comment + '". La scena: ' + r.scene, { context: [], prompt: GAME_REACT_PROMPT })
  if (extra) { gameLastComment = { by: o.personaId, text: extra, at: Date.now(), reaction: true }; rememberSaid(o, extra) }
}

/** Quello detto ad alta voce della partita: per 5 minuti nel prompt di chi l'ha detto. */
function rememberSaid(c, text) {
  gameSaid.push({ by: c.personaId, text, at: Date.now() })
  if (gameSaid.length > 12) gameSaid = gameSaid.slice(-12)
}

/** A fine partita: una riga nella memoria di chi guardava (a cosa, per quanto, com'e' andata). */
async function rememberGame(c, summary, scenes) {
  const minutes = (summary.endedAt - summary.startedAt) / 60000
  const title = summary.title === 'lo schermo' ? '' : summary.title
  let text = ''
  const cfg = loadConfig()
  const apiKey = cfg.keys?.[cfg.provider] || ''
  if (cfg.provider === 'ollama' || apiKey) {
    try {
      const result = await route({
        provider: cfg.provider, model: cfg.model, apiKey, jsonMode: false, maxTokens: 300,
        systemPrompt: Personas.systemPrompt(c.persona(), GameMode.SUMMARY_PROMPT),
        history: [{ role: 'user', content: GameMode.sessionText({ title, minutes, scenes }) }],
      })
      text = String((result && result.reply) || '').split('\n')[0].trim()
    } catch (e) { console.warn('[gioco] riassunto della partita non riuscito:', e.message) }
  }
  const line = GameMode.memoryLine({ title, minutes, summary: text })
  if (c.memory) await c.memory.addTurn(line, 'user')
  gameMemory = line
  console.log('[gioco] una riga nella memoria di ' + c.personaId)
}

const gameLoop = createGameLoop({
  // "Quanto parla" e il tipo di modello: sul PC si guarda molto piu' spesso.
  config: () => GameMode.gameTiming(GameMode.gameConfig(loadConfig()), gameModel),
  sigCapture: () => gameSignature(),
  busy: () => gameBusy(),
  // Scena ancora uguale: resta valida come contesto oltre i 2 minuti.
  onSame: () => { if (gameScene) gameScene.at = Date.now() },
  look: () => gameLook(),
  onResult: (r, info) => gameResult(r, info),
  onState: () => {
    // Lo schermo intero esclusivo: lo si dice una volta, nel fumetto.
    const w = gameWatcher()
    if (w && gameLoop.state().paused === 'fullscreen' && !gameWarned) {
      gameWarned = true
      w.send('companion-bubble', { text: 'Non vedo il gioco: mettilo in finestra senza bordi', ms: 8000 })
    }
    sendSettings('game-state', gameStatus())
    if (hudShown && hudFor) sendHud({ game: gameHud(hudFor) })
  },
})

/** Lo stato per la pagina Visione. */
function gameStatus() {
  const st = gameLoop.state()
  const c = companions.find(x => x.personaId === st.watcher)
  return { ...st, ended: gameEnded, text: GameMode.statusText(st, { name: c ? nameOf(c) : '', cost: gameModel ? gameModel.cost : null }) }
}

/** Il pulsante della pillola per il companion c: acceso se guarda lui. */
function gameHud(c) {
  const st = gameLoop.state()
  const mine = st.on && st.watcher === c.personaId
  const watcher = st.on && !mine ? companions.find(x => x.personaId === st.watcher) : null
  return {
    on: mine, paused: mine && !!st.paused, looks: mine ? st.looks : 0,
    title: mine ? 'Modalità gioco: ' + gameStatus().text + '. Clic per spegnere'
      : watcher ? 'Modalità gioco: guarda ' + nameOf(watcher) + '. Clic per farla guardare a ' + nameOf(c)
        : 'Modalità gioco: guarda la partita e la commenta',
  }
}

/** Accende la modalita' gioco per c (o la spegne, se guarda gia' lui). */
async function toggleGame(c) {
  c = c && c.alive() ? c : chatTarget()
  const st = gameLoop.state()
  if (st.on) {
    const same = !c || st.watcher === c.personaId
    endGame()
    if (same) return gameLoop.state()
  }
  if (!c) return gameLoop.state()
  const cfg = loadConfig()
  const g = GameMode.gameConfig(cfg)
  if (!g.source) {
    openSettings('visione')
    c.send('companion-bubble', { text: 'Scegli prima quale finestra guardare', ms: 3500 })
    return gameLoop.state()
  }
  // Guarda con il modello della chat: deve vedere le immagini.
  const chatCaps = await modelCapsOf(cfg.provider, cfg.model).catch(() => null)
  if (!chatCaps || !chatCaps.vision) {
    openSettings('modello')
    c.send('companion-bubble', { text: 'Il modello della chat non vede le immagini', ms: 4000 })
    return gameLoop.state()
  }
  const vision = { provider: cfg.provider, model: cfg.model }
  if (vision.provider !== 'ollama' && !cfg.keys?.[vision.provider]) {
    openSettings('modello')
    c.send('companion-bubble', { text: 'Manca la chiave del modello della chat', ms: 3500 })
    return gameLoop.state()
  }
  // Un modello di Ollama: Ollama acceso, e il modello (se e' sul PC) scaricato.
  if (vision.provider === 'ollama') {
    const up = await ollamaTools.start()
    const missing = !up.ok ? (up.error || 'Ollama non risponde') : GameMode.isLocalVision(vision) && !(await ollamaTools.installed()).includes(vision.model) ? 'Scarica prima il modello della chat' : ''
    if (missing) {
      openSettings('modello')
      c.send('companion-bubble', { text: missing.slice(0, 80), ms: 4000 })
      return gameLoop.state()
    }
  }
  // Il costo di uno sguardo: Ollama e' gratis, OpenRouter dice i prezzi, gli altri non si sa.
  const caps = vision.provider === 'openrouter' ? await modelCapsOf('openrouter', vision.model).catch(() => null) : null
  gameModel = { ...vision, cost: vision.provider === 'ollama' ? 0 : GameMode.lookCost(caps && caps.price) }
  gameLast = null
  gameScenes = []
  gameErrors = 0
  gameEnded = ''
  gameBlank = 0
  gameWarned = false
  gameLoop.start(c.personaId)
  c.send('companion-bubble', { text: '🎮 Guardo la partita', ms: 2500 })
  console.log('[gioco] acceso per ' + c.personaId + ' (' + vision.provider + ' ' + vision.model + ')')
  return gameLoop.state()
}

/**
 * Spegne la modalita' gioco e la fa ricordare. why: perche' si ferma da sola
 * (per la pagina Visione); bubble: la versione corta per il fumetto (80 caratteri).
 */
function endGame(why = '', bubble = why) {
  const summary = gameLoop.stop()
  if (!summary) return
  gameModel = null
  gameEnded = why
  const scenes = gameScenes
  gameScenes = []
  const c = companions.find(x => x.personaId === summary.watcher && x.alive())
  if (c) c.send('companion-bubble', { text: bubble || 'Fine della partita', ms: why ? 5000 : 2500 })
  console.log('[gioco] spento: ' + summary.looks + ' sguardi' + (why ? ' (' + why + ')' : ''))
  sendSettings('game-state', gameStatus())
  if (c && scenes.length) rememberGame(c, summary, scenes).catch(e => console.error('[gioco] memoria:', e.message))
}

handle('game:state', () => gameStatus())

// Il modello che guarda il gioco e' quello della chat: la pagina Visione dice
// se vede le immagini.
handle('game:chat-sees', async () => {
  const cfg = loadConfig()
  const caps = await modelCapsOf(cfg.provider, cfg.model).catch(() => null)
  return { provider: cfg.provider, model: cfg.model, sees: caps ? !!caps.vision : null }
})

// ─── Kimodo installato dall'app ──────────────────────────────────────────────
// La pagina Movimenti (e l'installer) lo scaricano in <userData>/kimodo
// (kimodo-setup.js): lo zip della release e i pesi da Hugging Face. Se c'e'
// anche quello compilato a mano in %USERPROFILE%\kimodo, vince quello
// dell'app; kimodoDir scritto in config.json vince su tutti.
const ownKimodoDir = () => path.join(app.getPath('userData'), 'kimodo')
function kimodoDirFor(cfg) {
  if (typeof cfg.kimodoDir === 'string' && path.isAbsolute(cfg.kimodoDir)) return cfg.kimodoDir
  if (kimodoSetup.kimodoInstalled(ownKimodoDir())) return ownKimodoDir()
  const dev = path.join(os.homedir(), 'kimodo')
  return fs.existsSync(path.join(dev, 'build', 'release', 'kmd-generate.exe')) ? dev : ownKimodoDir()
}
let kimodoInstall = null     // { abort, progress } mentre si installa
let kimodoError = null
const kimodoStatus = () => ({
  available: !!kimodo && kimodo.available(),
  // Disinstallabile solo quello installato dall'app (non quello compilato a mano).
  managed: !!kimodo && kimodo.dir === ownKimodoDir() && kimodoSetup.kimodoInstalled(ownKimodoDir()),
  installing: kimodoInstall ? kimodoInstall.progress : null,
  error: kimodoError,
  totalBytes: kimodoSetup.TOTAL_BYTES,
})
handle('kimodo:status', () => kimodoStatus())
handle('kimodo:install', async () => {
  if (!kimodo || kimodoInstall) return kimodoStatus()
  const abort = new AbortController()
  kimodoInstall = { abort, progress: { step: 'program', index: 0, count: kimodoSetup.STEPS.length, label: kimodoSetup.STEPS[0].label, done: 0, total: kimodoSetup.TOTAL_BYTES } }
  kimodoError = null
  sendSettings('kimodo-status', kimodoStatus())
  let last = 0
  try {
    await kimodoSetup.installKimodo(ownKimodoDir(), {
      signal: abort.signal,
      onProgress: (p) => {
        kimodoInstall.progress = p
        const now = Date.now()
        if (now - last > 400) { last = now; sendSettings('kimodo-status', kimodoStatus()) }
      },
    })
    kimodo.stop()
    kimodo.dir = ownKimodoDir()
    console.log('[kimodo] installato in ' + kimodo.dir)
    setOption({ kimodo: true })
  } catch (e) {
    kimodoError = abort.signal.aborted ? 'installazione annullata' : e.message
    console.warn('[kimodo] installazione non riuscita: ' + kimodoError)
  } finally {
    kimodoInstall = null
    sendSettings('kimodo-status', kimodoStatus())
  }
  return kimodoStatus()
})
on('kimodo:cancel', () => { if (kimodoInstall) kimodoInstall.abort.abort() })
handle('kimodo:remove', () => {
  if (!kimodoStatus().managed) return kimodoStatus()
  kimodo.stop()
  kimodoSetup.uninstallKimodo(ownKimodoDir())
  kimodo.dir = kimodoDirFor(loadConfig())
  setOption({ kimodo: false })
  return kimodoStatus()
})
on('kimodo:open-license', (_e, which) => {
  const url = typeof which === 'string' && Object.prototype.hasOwnProperty.call(kimodoSetup.LICENSES, which) ? kimodoSetup.LICENSES[which] : null
  if (url) shell.openExternal(url).catch(e => console.error('[app] openExternal:', e.message))
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
async function replyFrom(c, { cfg, apiKey, history, group, others, onDelta = null, signal = null }) {
  c.busy = true
  c.markActivity()
  const mm = c.memory
  try {
    const historyWithMemory = c.withMoodLine(await c.buildHistoryWithMemory(history))
    if (group) historyWithMemory.splice(historyWithMemory.findIndex(m => m.role !== 'system') === -1 ? historyWithMemory.length : historyWithMemory.findIndex(m => m.role !== 'system'), 0, { role: 'system', content: group })

    console.log('[Main] Chiamata route per ' + c.personaId + '...')
    // Il campo motion si spiega al modello solo quando si puo' usare; gli
    // strumenti MCP solo se ce ne sono di ammessi.
    const toolsLine = Mcp.toolsPrompt(cfg.mcpServers)
    const basePrompt = ((await motionsEnabled(c.avatarId())) ? SYSTEM_PROMPT + MOTION_PROMPT : SYSTEM_PROMPT) + toolsLine
    let result = await route({
      provider: cfg.provider,
      model:    cfg.model,
      apiKey,
      history: historyWithMemory,
      systemPrompt: Personas.systemPrompt(c.persona(), basePrompt),
      // In streaming (Blocco 11a), ma non con gli strumenti MCP: la prima
      // risposta li' e' spesso "ora cerco…", e conta quella dopo lo strumento.
      onDelta: toolsLine ? null : onDelta,
      signal,
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
        signal,
      }).catch(err => { if (err && err.aborted) throw err; console.error('[mcp] giro dopo lo strumento fallito:', err.message); return null })
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

// La richiesta in corso per ogni finestra di chat (Blocco 11a): un messaggio
// nuovo, o "ai:cancel-reply", la annulla.
const replyAborts = new Map()
handle('ai:cancel-reply', (e) => {
  const ctrl = replyAborts.get(e.sender.id)
  if (ctrl) ctrl.abort()
  return !!ctrl
})

handle('ai:send-message', async (_e, { history, image, to, mode }) => {
  const sender = _e.sender
  const previous = replyAborts.get(sender.id)
  if (previous) previous.abort()
  const ctrl = new AbortController()
  replyAborts.set(sender.id, ctrl)
  try {
    return await sendMessage(sender, ctrl.signal, { history, image, to, mode })
  } finally {
    if (replyAborts.get(sender.id) === ctrl) replyAborts.delete(sender.id)
  }
})

async function sendMessage(sender, signal, { history, image, to, mode }) {
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
  // Due chat separate (Blocco 9b): quella singola con un companion, e quella
  // di gruppo con tutti quelli sul desktop. Nella singola risponde e ricorda
  // solo lui; nel gruppo risponde chi e' chiamato (group-chat.js) e sentono tutti.
  const group = mode === 'group' && present.length > 1
  const single = !group && (present.find(c => c.personaId === to) || chatTarget() || present[0])
  const ids = single ? [single.personaId]
    : Group.pickResponders(last.content, open, { to: typeof to === 'string' ? to : null, last: lastSpeakerId || (chatTarget() || {}).personaId })
  const responders = ids.map(id => present.find(c => c.personaId === id)).filter(Boolean)
  const hearers = single ? [single] : present
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
  for (const c of hearers) {
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
  // Streaming (Blocco 11a): la chat scrive mentre arriva, la voce parte alla
  // prima frase. Senza streaming (strumenti MCP, tool call forzata, una
  // scorta) arriva tutto alla fine, e la voce dice tutto come prima.
  const speech = speechSession(first) || captionSession(first, BrowserWindow.fromWebContents(sender))
  const started = Date.now()
  let firstText = 0
  const onDelta = (text) => {
    if (!firstText) { firstText = Date.now(); console.log('[stream] primo testo dopo ' + (firstText - started) + ' ms') }
    try { sender.send('reply-delta', { text, personaId: first.personaId, name: names[first.personaId] }) } catch (_) {}
    if (speech) speech.push(text)
  }
  let result
  try {
    result = await replyFrom(first, { cfg, apiKey, history: historyOf(first), group: group ? groupFor(first) : '', others: hearers, onDelta, signal })
  } catch (err) {
    if (err && err.aborted) return { ok: false, aborted: true }
    if (speech) speech.end('')
    console.error('[Main] Errore in route():', err)
    return { ok: false, error: describeError(err, cfg.provider) }
  }
  if (speech) speech.end(result?.reply || '')

  // Il secondo, se c'e', reagisce al primo: arriva dopo, quando il primo ha finito di parlare.
  const second = responders[1]
  if (second && result?.reply) {
    const extra = [{ role: 'assistant', content: result.reply, speaker: first.personaId }]
    replyFrom(second, { cfg, apiKey, history: historyOf(second, extra), group: groupFor(second, names[first.personaId]), others: hearers, signal })
      .then(async (r) => {
        if (!r || !r.reply || turnId !== groupTurn) return
        await waitForSpeech()
        if (turnId !== groupTurn) return
        // La seconda risposta va dove e' stata la prima: chat di gruppo o singola.
        const w = group ? groupChat() : chatOf(single)
        if (w) {
          try { w.webContents.send('group-reply', { ...r, personaId: second.personaId, name: names[second.personaId] }) } catch (_) {}
          countUnread(w)
        }
        speakReply(second, r.reply)
      })
      .catch(err => { if (!err || !err.aborted) console.error('[gruppo] seconda risposta non riuscita:', err.message) })
  }
  return { ok: true, result: { ...result, personaId: first.personaId, name: names[first.personaId] }, group }
}

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
  // Mani libere (Blocco 11b): 'handsfree' in ascolto, 'hearing' mentre parli,
  // 'transcribing' mentre trascrive; 'idle' dalla sua chat vuol dire spento.
  const fromHands = handsFree && liveWin(handsFree.win) && _e.sender === handsFree.win.webContents
  if (fromHands) {
    const c = handsFree.c
    // Mentre parli la modalita' gioco non guarda (Blocco 12b).
    handsFree.hearing = state === 'hearing' || state === 'transcribing'
    if (state === 'hearing') {
      // Parli tu: il companion tace (succede solo con le cuffie, o se ha appena finito).
      if (voiceService) voiceService.stop()
      c.markActivity()
      c.send('companion-bubble', { text: '🎙 …', ms: 31000 })
      handsFree.bubble = true
    } else if (state === 'transcribing') {
      c.send('companion-bubble', { text: '…', ms: 30000 })
      handsFree.bubble = true
    } else if (state === 'handsfree') {
      if (handsFree.bubble) { c.send('companion-bubble', { text: '' }); handsFree.bubble = false }
    } else if (state === 'idle') {
      handsFree.bubble = false
      stopHandsFree()
    }
    if (hudShown && hudFor) sendHud(hudState(hudFor))
    return
  }
  micBusy = state === 'listening' || state === 'transcribing'
  if (hudShown && hudFor) sendHud(hudState(hudFor))
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
// La memoria di una chat singola e' quella del suo companion.
const chatMemory = (e) => { const c = chatOwnerOf(e) || chatTarget(); return c ? c.memory : null }
handle('memory:stats', (e) => {
  const mm = chatMemory(e)
  return mm ? mm.getStats() : { error: 'memory not initialized' }
})

handle('memory:get-context', async (e) => {
  const mm = chatMemory(e)
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
  const c = companionOf(e) || chatOwnerOf(e) || chatTarget()
  return c ? c.publicMood() : null
})

handle('memory:compact-now', async (e) => {
  const mm = chatMemory(e)
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

handle('memory:clear', async (e) => {
  const c = chatOwnerOf(e) || chatTarget()
  if (!c || !c.memory) return { ok: false, error: 'memory not initialized' }
  try {
    // Dimenticare tutto vale anche per come si sentiva, per il rapporto e il diario.
    await c.forget()
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

// Avatar library — la scelta del file e la copia avvengono nel main process.
// Questo impedisce al renderer di trasformare un path arbitrario in un URL locale.
handle('avatars:list', async () => avatarLibrary ? avatarLibrary.withThumbs(await avatarLibrary.list()) : [])
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
  return avatarLibrary.commit(token, candidateId).then((record) => { sendAvatarsChanged(); return record })
})
handle('avatars:remove', (_event, ids) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new Error('Selezione avatar non valida')
  return avatarLibrary.remove(ids).then((removed) => { sendAvatarsChanged(); return removed })
})
/** Elenco o miniature cambiati: le gallerie delle Impostazioni e i visi nelle chat. */
function sendAvatarsChanged() {
  sendSettings('avatars-changed')
  sendAllChats('avatars-changed')
}

// Miniature del viso (Blocco 9c): le scatta il companion la prima volta che
// mostra un avatar, le Impostazioni le leggono da avatar://thumbs/.
handle('avatars:thumb-needed', (e, id) => {
  if (!companionOf(e) || !avatarLibrary || typeof id !== 'string' || !id || id.length > 200) return false
  return !fs.existsSync(avatarLibrary.thumbPath(id))
})
handle('avatars:save-thumb', async (e, id, png) => {
  if (!companionOf(e) || !avatarLibrary || typeof id !== 'string') return { ok: false }
  const buf = checkThumbPng(png)
  if (!buf || !(await avatarLibrary.list()).some(a => a.id === id)) return { ok: false }
  await avatarLibrary.saveThumb(id, buf)
  sendAvatarsChanged()
  return { ok: true }
})
// "Usa" nella galleria: l'avatar va a un companion sul desktop (di base quello
// della chat), che lo carica come dal suo menu e lo ricorda per la sua persona.
handle('avatars:use', async (_e, id, personaId) => {
  const c = companions.find(x => x.personaId === personaId && x.alive()) || chatTarget()
  if (!c || !avatarLibrary || typeof id !== 'string' || !(await avatarLibrary.list()).some(a => a.id === id)) return { ok: false }
  c.send('menu-command', { cmd: 'avatar', id })
  return { ok: true, name: (c.persona() || {}).name || '' }
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
  // Mangiare e bere davvero (Blocco 10b): sazia, la clip, il cibo in mano.
  if (action.animation === 'eat' || action.animation === 'drink') {
    const item = foodForAction(action)
    if (item && c.feed(item)) return
  }
  // Giocare dalla chat (Blocco 10e): "giochiamo a palla", "prendi il gomitolo".
  if (action.animation === 'play' || action.animation === 'fetch') {
    const said = typeof action.item === 'string' ? action.item.slice(0, 60) : ''
    const throwables = objectItems().filter(o => o.type === 'throw')
    const obj = Objects.findObject(throwables, said, 'throw') || throwables.find(o => o.id === (action.animation === 'fetch' ? 'gomitolo' : 'pallone')) || throwables[0]
    c.markActivity()
    const done = action.animation === 'play' ? desktopObjects.playWith(c, obj) : desktopObjects.fetchFor(c, obj)
    if (!done) c.animate({ type: 'none', animation: 'happy' })
    return
  }
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
  if (initiativeBusy || exchanging || paused) return
  const returned = returnedAt > 0 && now - returnedAt < RETURN_VALID_MS
  const typing = allChats().some(w => w.isFocused())
  const enabled = loadConfig().initiative
  // In ordine sparso, cosi' non parla sempre lo stesso; uno per controllo.
  // Anche gli ospiti della stanza (finestra nascosta, ma presenti).
  const order = companions.filter(c => c.alive() && (c.win.isVisible() || guestHost(c))).sort(() => Math.random() - 0.5)
  for (const c of order) {
    const s = initiativeOf(c.personaId)
    const peers = order.filter(o => o !== c)
    const kind = Initiative.occasion(s, { now, returned, lastChatAt, systemIdleMs, peers: peers.length, needs: c.worstNeed() })
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
    // Con fame o sete, qualche cibo vero del catalogo da poter chiedere (Blocco 10e).
    const wanted = kind === 'hungry' ? 'food' : kind === 'thirsty' ? 'drink' : null
    const foods = wanted ? foodItems().filter(f => f.kind === wanted).map(f => f.name.toLowerCase()).sort(() => Math.random() - 0.5) : []
    history.push({ role: 'user', content: Initiative.prompt(kind, peerOf, { foods }) })
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
    // I commenti fra companion vanno nella chat di gruppo, il resto in quella singola.
    const between = (kind === 'peer' || kind === 'peer-reply' || kind === 'hello') && companions.length > 1
    const target = between ? ensureGroupChat() : ensureChatFor(c)
    if (target) {
      try { target.webContents.send('companion-initiative', { reply, personaId: c.personaId, name, kind }) } catch (_) {}
      countUnread(target)
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
  const others = companions.filter(o => o !== c && o.alive() && (o.win.isVisible() || guestHost(o)))
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
    // Il cursore finto dell'audit (test:peek) vale anche per sguardo e HUD.
    const cursor = testCursor || screen.getCursorScreenPoint()
    // Chi ascolta guarda chi sta parlando (Blocco 8d).
    const speaker = speakingCompanion && speakingCompanion.alive() && speakingCompanion.win.isVisible() && Date.now() < speechEndsAt ? speakingCompanion : null
    const head = speaker && speaker.viewMode === 'desktop' ? Companions.headPoint(speaker.bounds) : null
    for (const c of companions) c.cursorTick(cursor, head && c !== speaker && c.viewMode === 'desktop' ? head : null)
    hudTick(cursor)
    itemsTick(cursor)
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
    return { bounds: c.win.getBounds(), workArea: c.workArea(), peek: c.peekState(), displays: screen.getAllDisplays().map(d => d.workArea), fullscreen: c.fullscreenNow() }
  })
  // Un commento fra i primi due companion, subito (Blocco 8d).
  handle('test:peer', async () => {
    if (companions.length < 2) return false
    await peerExchange(companions[0], companions[1])
    return true
  })
  // Lo scatto della modalita' gioco (Blocco 12a), senza l'immagine.
  handle('test:game-capture', async () => {
    const r = await captureGame()
    return { ok: r.ok, state: r.state, title: r.title || '', app: r.app || '', size: r.picture ? r.picture.getSize() : null, jpeg: r.image ? r.image.length : 0 }
  })
  // La modalita' gioco (Blocco 12b): lo stato, l'ultimo sguardo e il pulsante.
  // Il companion e' sopra la finestra del gioco? (ordine z di Windows, Blocco 12d)
  handle('test:game-zorder', async () => {
    const r = await captureGame(64)
    const order = winWindows.listWindows().map(w => w.hwnd)
    const c = companions[0]
    const own = c && c.alive() ? winWindows.handleOf(c.win.getNativeWindowHandle()) : 0
    return { game: order.indexOf(r.hwnd || 0), companion: order.indexOf(own) }
  })
  handle('test:game', (_e, cmd) => {
    if (cmd && cmd.off === true) endGame()
    if (cmd && Number.isFinite(cmd.react)) gameSecondChance = cmd.react
    return { status: gameStatus(), last: gameLast, model: gameModel, hud: hudFor ? gameHud(hudFor) : null,
      scene: gameScene, line: GameMode.sceneLine(gameScene, Date.now()), comment: gameLastComment, memory: gameMemory, said: gameSaid }
  })
  // La finestra di chat che chiede: mostrata o nascosta davvero (Blocco 11b,
  // sottotitoli senza voce); la pagina non lo sa con certezza.
  handle('test:chat-shown', (e, show) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return null
    if (show === true) w.show()
    else if (show === false) w.hide()
    return w.isVisible()
  })
  // Un cibo lasciato in un punto dello schermo (Blocco 10b), come dal pannello.
  handle('test:drop', (_e, msg) => {
    if (!msg || !startItemDrag(String(msg.id || ''))) return null
    const c = endItemDrag({ x: Number(msg.x) || 0, y: Number(msg.y) || 0 })
    return c ? c.personaId : null
  })
  // Oggetti sul desktop (Blocco 10c): metterne uno, lanciarlo, lasciarlo su
  // un companion, leggere lo stato, riporre tutto.
  handle('test:objects', (_e, msg) => {
    const op = msg && msg.op
    if (op === 'spawn') {
      const obj = objectItems().find(o => o.id === msg.id)
      const e = obj && desktopObjects.spawn(obj, { x: Number(msg.x) || 0, y: Number(msg.y) || 0 })
      return e ? e.uid : null
    }
    const e = desktopObjects.get(Number(msg && msg.uid))
    if (op === 'throw' && e) return desktopObjects.release(e, null, { vx: Number(msg.vx) || 0, vy: Number(msg.vy) || 0 })
    if (op === 'drop-on' && e) {
      const c = companions.find(x => x.personaId === msg.personaId) || companions[0]
      const b = c && c.bounds
      return b ? desktopObjects.release(e, { x: b.x + b.width / 2, y: b.y + b.height / 2 }) : null
    }
    if (op === 'touch' && msg.personaId) {
      const c = companions.find(x => x.personaId === msg.personaId)
      return c ? desktopObjects.touched(c) : false
    }
    // Pallavolo (Blocco 10d): la battuta, un colpo al volo, l'ultima partita, il record.
    if (op === 'serve' && e) return desktopObjects.testServe(e)
    // Gioca da solo (Blocco 10e), con il modo scelto: kick, juggle o toss.
    if (op === 'play-alone') return desktopObjects.playAlone(companions.find(x => x.personaId === msg.personaId) || companions[0], { mode: msg.mode })
    if (op === 'hit' && e) return desktopObjects.testHit(e)
    if (op === 'last-game') return { ...desktopObjects.lastGame, best: Object.fromEntries(companions.map(c => [c.personaId, c.volleyBest])) }
    if (op === 'clear') desktopObjects.storeAll()
    if (op === 'panel') { openItemsPanel(companions[0], msg.mode); return itemsMode }
    return desktopObjects.state()
  })
  // Fame e sete a un valore preciso (Blocco 10a), per il companion che chiede.
  handle('test:needs', (e, values) => {
    const c = companions.find(x => values && x.personaId === values.personaId) || companionOf(e) || chatTarget()
    if (!c || !values || typeof values !== 'object') return null
    c.updateNeeds(() => Needs.createNeeds(values))
    return c.publicMood().needs
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
  prefs.hudPinned = cfg.hudPinned === true
  // Fame e sete (Blocco 10a): accese di base. Spente o riaccese, HUD e chat
  // mostrano o nascondono gli anelli.
  const needsBefore = prefs.needs
  prefs.needs = cfg.needs !== false
  if (needsBefore !== prefs.needs) for (const c of companions) c.broadcastMood()
  syncAppShortcuts(cfg)
  applyDance(cfg)
  // Spento Kimodo, la memoria video si libera subito.
  if (!cfg.kimodo && kimodo) kimodo.stop()
  for (const c of companions) c.applyWindowOptions(cfg)
}

/** Manda la config a chat e Impostazioni: intestazione, pulsante del microfono, interruttori. */
function sendChatConfig(cfg) {
  if (handsFree) { handsFree.headphones = !!voiceConfig(cfg).headphones; syncDeaf() }
  const pub = publicConfig(cfg)
  sendAllChats('config-changed', pub)
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
handle('companion:touch', (e, input) => {
  // Nella stanza il tocco puo' essere per un ospite (Blocco 8e).
  const guest = input && typeof input.guest === 'string' && guestIds.has(input.guest) ? companions.find(x => x.personaId === input.guest) : null
  const c = guest || companionOf(e)
  if (c && !guest && desktopObjects.touched(c)) return null
  // A mani libere un clic mentre parla lo zittisce (Blocco 11b), senza reazione.
  if (handsFree && input && input.kind === 'poke' && speechEndsAt > Date.now()) { interruptSpeech(); return null }
  return c ? c.onTouch(input) : null
})
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
  // Oggetti importati per la borsa (ObjectLibrary, Blocco 10c).
  {
    scheme: 'object',
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
//
// Dall'installer: con la casella del Cubism Core spuntata, il setup lancia
// l'app con --install-live2d-core. Niente finestre: scarica e controlla il
// Core come la pagina Live2D, segna la licenza come accettata (l'utente l'ha
// accettata nel setup) e chiude, con 0 se e' andata e 1 se no (si rifa'
// dalle Impostazioni).
const SETUP_LIVE2D = process.argv.includes('--install-live2d-core')
if (SETUP_LIVE2D) {
  app.whenReady().then(async () => {
    let code = 0
    try {
      if (!live2dCore.coreInstalled(live2dDir())) await live2dCore.installCore(live2dDir(), { signal: AbortSignal.timeout(10 * 60 * 1000) })
      saveConfig(mergeConfig(loadConfig(), { live2dAccepted: true }))
      console.log('[live2d] Cubism Core installato dal setup')
    } catch (e) {
      console.warn('[live2d] dal setup non riuscito: ' + e.message)
      code = 1
    }
    app.exit(code)
  })
}

// Dall'installer, pagina "Componenti facoltativi": con le caselle spuntate il
// setup lancia l'app con --install-components=xtts,stt,kimodo e aspetta. Si
// apre una finestra con l'avanzamento (setup.html), si installa come dalle
// Impostazioni (le licenze l'utente le ha accettate nel setup), poi l'app si
// chiude: 0 se e' andato tutto, 1 se no (si rifa' dalle Impostazioni).
const SETUP_COMPONENTS = SetupComponents.parseComponents(process.argv)
if (SETUP_COMPONENTS.length) app.whenReady().then(() => runSetupComponents(SETUP_COMPONENTS))

async function runSetupComponents(list) {
  setupLogging(path.join(app.getPath('userData'), 'logs'))
  const win = new BrowserWindow({
    width: 560, height: 400, title: 'CompanionAI · componenti', resizable: false, maximizable: false,
    autoHideMenuBar: true, backgroundColor: '#151416', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  })
  win.once('ready-to-show', () => win.show())
  await win.loadFile(path.join(__dirname, '../renderer/setup.html'))
  const send = (data) => { if (!win.isDestroyed()) win.webContents.send('setup-progress', data) }
  send({ list: list.map(id => ({ id, label: SetupComponents.LABELS[id] })) })
  const results = {}
  const done = (id, ok, text = '') => { results[id] = { ok, text }; send({ id, ok, text }) }
  const gpu = list.some(id => id !== 'kimodo') ? await xttsSetup.nvidiaGpu().catch(() => null) : null
  for (const id of list) {
    send({ id, running: true })
    try {
      if (id === 'xtts' || id === 'stt') {
        if (!gpu) { done(id, false, 'Serve una scheda video NVIDIA.'); continue }
        if (id === 'stt' && results.xtts && !results.xtts.ok) { done(id, false, 'Serve prima la voce XTTS.'); continue }
        if (!voiceService) initVoice({ sync: false })
        const installed = () => (id === 'xtts' ? voiceService.status().xtts.installed : voiceService.status().stt.installed)
        if (installed()) { done(id, true, 'Era già installato.'); continue }
        if (id === 'xtts') saveConfig(mergeConfig(loadConfig(), { voice: { cpmlAccepted: true } }))
        const timer = setInterval(() => {
          const s = voiceService.status()
          const p = id === 'xtts' ? s.xtts.installing : s.stt.installing
          if (p) send({ id, progress: p })
        }, 500)
        let st
        try { st = id === 'xtts' ? await voiceService.installXtts() : await voiceService.installStt() } finally { clearInterval(timer) }
        if (!installed()) { done(id, false, (id === 'xtts' ? st.xtts.error : st.stt.error) || 'Non riuscito.'); continue }
        // Il microfono si accende; la voce XTTS la sceglie l'utente (serve un campione o una voce).
        if (id === 'stt') saveConfig(mergeConfig(loadConfig(), { voice: { micEnabled: true } }))
        done(id, true, id === 'xtts' ? 'Scegli la voce in Impostazioni > Voce.' : 'Il microfono è acceso.')
      } else if (id === 'kimodo') {
        if (kimodoSetup.kimodoInstalled(ownKimodoDir())) { done(id, true, 'Era già installato.'); continue }
        await kimodoSetup.installKimodo(ownKimodoDir(), { onProgress: (p) => send({ id, progress: p }) })
        saveConfig(mergeConfig(loadConfig(), { kimodo: true }))
        done(id, true, 'Chiedi in chat un movimento che non c\'è.')
      }
    } catch (e) {
      done(id, false, e.message)
    }
  }
  try { if (voiceService) { voiceService.stop(); if (voiceService.xtts) voiceService.xtts.stop() } } catch (_) {}
  const allOk = list.every(id => results[id] && results[id].ok)
  console.log('[setup] componenti dall\'installer: ' + JSON.stringify(results))
  send({ finished: true, allOk })
  // Tutto bene: si chiude da sola. Se no resta aperta finche' non si chiude (al massimo 15 minuti).
  const close = () => app.exit(allOk ? 0 : 1)
  if (allOk) setTimeout(close, 3000)
  else { on('setup:close', close); setTimeout(close, 15 * 60 * 1000).unref() }
  win.on('closed', close)
}

const SETUP_MODE = SETUP_LIVE2D || SETUP_COMPONENTS.length > 0
const isPrimaryInstance = !SETUP_MODE && app.requestSingleInstanceLock()
if (SETUP_MODE) {
  // Nessuna finestra e nessun blocco: solo lo scaricamento qui sopra.
} else if (!isPrimaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    for (const c of companions) if (c.alive()) c.win.show()
    const w = currentChat()
    if (w && !w.isVisible()) toggleChat(w)
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
  objectLibrary = new ObjectLibrary(path.join(app.getPath('userData'), 'objects'))
  refreshImportedObjects()
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
    dir: kimodoDirFor(startCfg),
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

  // Come scene://, per gli oggetti importati e le loro miniature.
  protocol.handle('object', async (request) => {
    try {
      const url = new URL(request.url)
      const file = await objectLibrary.resolve(url.hostname, decodeURIComponent(url.pathname.slice(1)))
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
  ensureGroupChat()
  createHudWindow()
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
    for (const c of companions) ensureChatFor(c)
  }
})
