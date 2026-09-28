const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, protocol, net, dialog, safeStorage, session, powerMonitor } = require('electron')
const path  = require('path')
const { spawn } = require('child_process')
const fs    = require('fs')
const os    = require('os')
const { route, PROVIDERS, describeError, listModels, EMOTIONS, SYSTEM_PROMPT, MOTION_PROMPT } = require('./ai-router')
const { MemoryManager } = require('../memory/MemoryManager')
const { AvatarLibrary } = require('./AvatarLibrary')
const { AnimationLibrary, isGlb } = require('./AnimationLibrary')
const { KimodoService, motionPrompt, cacheKey } = require('./kimodo-service')
const winWindows = require('./win-windows')
const { findWindowSeat, findTaskbarSeat, taskbarEdge, perchPosition, staysSeated } = require('./perch')
const { builtinAvatars } = require('./builtin-avatars')
const { isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender, checkMotion, keysForDisk, legacyKeyProvider, WINDOW_SCALES } = require('./guards')
const { walkTarget } = require('./walk-target')
const { setupLogging } = require('./logger')
const moodLib = require('./mood')
const { decideIdle } = require('./idle-life')

let companionWindow = null
let chatWindow      = null
let tray            = null
let memoryManager   = null
let avatarLibrary   = null
let animationLibrary = null
let kimodo = null

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.desktop-companion', 'config.json')

// Mappa provider → nome variabile d'ambiente per la chiave API
const ENV_KEY_MAP = {
  claude:     'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  grok:       'XAI_API_KEY',
  gemini:     'GEMINI_API_KEY',
  mistral:    'MISTRAL_API_KEY',
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
const DEFAULT_CONFIG = {
  provider: 'openrouter', model: DEFAULT_MODEL, avatarModel: '', idleLife: true,
  followMouse: true, alwaysOnTop: true, scale: 'm', kimodo: false, perch: true, keys: {},
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
  const { keys, unreadableKeys, kimodoDir, ...safe } = cfg
  return {
    ...safe,
    keyConfigured: Object.fromEntries(Object.entries(keys || {}).map(([name, value]) => [name, !!value])),
    // Solo i nomi dei provider: la chat spiega perche' la chiave va reinserita.
    keyUnreadable: Object.fromEntries(Object.keys(unreadableKeys || {}).filter(name => !(keys || {})[name]).map(name => [name, true])),
    providers: PROVIDERS,
    kimodoAvailable: !!kimodo && kimodo.available(),
  }
}

// ─── Memoria (fading memory + lossless archive) ──────────────────────────────

const MEMORY_PATH = path.join(os.homedir(), '.desktop-companion', 'memory')

// Budget di contesto riservato alla memoria a lungo termine, in token stimati.
const MEMORY_CONTEXT_TOKENS = 1500

// Per il riassunto usa il provider configurato. Senza chiave il MemoryManager
// ripiega su un riassunto deterministico invece di bloccarsi.
function memoryModelFrom(cfg) {
  return {
    provider: cfg.provider || 'openrouter',
    model: cfg.model || DEFAULT_MODEL,
    apiKey: cfg.keys?.[cfg.provider] || null,
  }
}

// ─── Umore ───────────────────────────────────────────────────────────────────
// Lo stato d'animo vive accanto alla memoria e sparisce con "Dimentica tutto".
// Le regole stanno in mood.js; qui si carica, si salva e si avvisano le finestre.

const MOOD_PATH = path.join(MEMORY_PATH, 'mood.json')
let mood = moodLib.createMood()
let moodSave = Promise.resolve()

async function initMood() {
  mood = await moodLib.loadMood(MOOD_PATH)
  broadcastMood()
}

function broadcastMood() {
  const data = moodLib.publicMood(mood)
  for (const win of [companionWindow, chatWindow]) {
    if (win && !win.isDestroyed()) try { win.webContents.send('mood-changed', data) } catch (_) {}
  }
}

/** Applica una trasformazione pura all'umore, poi salva e avvisa. */
function updateMood(change) {
  mood = change(mood)
  // In coda: due salvataggi ravvicinati non devono superarsi a vicenda.
  const snapshot = mood
  moodSave = moodSave.then(() => moodLib.saveMood(MOOD_PATH, snapshot))
    .catch(e => console.error('[mood] salvataggio fallito:', e.message))
  broadcastMood()
}

function initMemory() {
  memoryManager = new MemoryManager('default', MEMORY_PATH, memoryModelFrom(loadConfig()))

  // Carica subito lo stato su disco: senza questo la memoria del boot precedente
  // arriverebbe solo al primo turno, in ritardo rispetto alla prima domanda.
  memoryManager.loadState()
    .then(loaded => console.log('[memory] stato caricato:', loaded ? 'si' : 'nessuno su disco'))
    .catch(e => console.error('[memory] loadState fallito:', e.message))

  // Auto-compaction: i turni piu' vecchi di 7 giorni sfumano in summary
  // (fading memory, ispirato a companion-emergence). Ogni 60 minuti.
  if (global.__memoryTimer) clearInterval(global.__memoryTimer)
  global.__memoryTimer = setInterval(() => {
    if (!memoryManager) return
    memoryManager.compact(7).then(did => {
      if (did) console.log('[memory] auto-compaction completata')
    }).catch(() => {})
  }, 60 * 60 * 1000)
  if (global.__memoryTimer.unref) global.__memoryTimer.unref()
}

// Costruisce la history effettiva unendo memoria di lungo periodo e chat corrente.
//
// Senza questo passaggio il MemoryManager sarebbe solo un logger: la chat manda
// unicamente il proprio array in RAM, azzerato a ogni riavvio, e il companion
// ricomincerebbe da zero ogni volta. Qui il riassunto entra come messaggio di
// sistema e i turni piu' vecchi non ancora presenti nella chat vengono anteposti.
async function buildHistoryWithMemory(rendererHistory) {
  const history = Array.isArray(rendererHistory) ? rendererHistory : []
  if (!memoryManager) return history

  let context = []
  try {
    context = await memoryManager.getContext(MEMORY_CONTEXT_TOKENS)
  } catch (e) {
    console.error('[memory] getContext fallito, procedo senza memoria:', e.message)
    return history
  }

  const known = new Set(history.map(m => (m.content || '').trim()))
  const preface = []

  const summary = context.find(c => c.speaker === 'summary')
  if (summary?.content) {
    preface.push({
      role: 'system',
      content:
        'MEMORIA A LUNGO TERMINE (tue conversazioni passate con questo utente, ' +
        'gia\' riassunte). Usala per dare continuita\', non citarla alla lettera:\n' +
        summary.content,
    })
  }

  for (const item of context) {
    if (item.speaker === 'summary') continue
    const content = (item.content || '').trim()
    if (!content || known.has(content)) continue // gia' nella chat corrente
    known.add(content)
    preface.push({ role: item.speaker === 'assistant' ? 'assistant' : 'user', content })
  }

  if (preface.length) console.log('[memory] iniettati', preface.length, 'elementi di contesto')
  return [...preface, ...history]
}

// Umore, ora del giorno e tempo dall'ultimo messaggio entrano come messaggio di
// sistema subito dopo la memoria: prepare() nel router li unisce in ordine.
function withMoodLine(history) {
  const line = { role: 'system', content: moodLib.promptLine(mood) }
  const firstDialog = history.findIndex(m => m.role !== 'system')
  if (firstDialog === -1) return [...history, line]
  return [...history.slice(0, firstDialog), line, ...history.slice(firstDialog)]
}

// ─── Companion Window ────────────────────────────────────────────────────────

function createCompanionWindow() {
  // workArea e non workAreaSize: con la taskbar in alto o a sinistra l'area
  // utile non parte da 0,0 e l'avatar nasceva spostato di quanto e' larga.
  const area = screen.getPrimaryDisplay().workArea
  const cfg = loadConfig()
  const size = WINDOW_SCALES[cfg.scale]

  companionWindow = new BrowserWindow({
    width: size.width, height: size.height,
    x: area.x + area.width - size.width - 40, y: area.y + area.height - size.height,
    transparent: true,
    frame: false,
    alwaysOnTop: cfg.alwaysOnTop,
    skipTaskbar: true,
    // Le dimensioni si scelgono dal menu: con i clic che attraversano i pixel
    // vuoti i bordi non si possono afferrare comunque.
    resizable: false,
    minWidth: 140,
    minHeight: 200,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  companionWindow.loadFile(path.join(__dirname, '../renderer/companion.html'))
  if (cfg.alwaysOnTop) companionWindow.setAlwaysOnTop(true, 'screen-saver')
  // I clic sui pixel vuoti passano alle finestre sotto. forward: true lascia
  // arrivare i movimenti del mouse alla pagina, che decide quando catturarli
  // (companion-input.js).
  companionWindow.setIgnoreMouseEvents(true, { forward: true })

  if (process.argv.includes('--dev')) {
    companionWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── Camminata sul desktop ───────────────────────────────────────────────────
// L'avatar vive sul desktop, quindi "walk-to" deve spostare la finestra, non solo
// far scorrere lo sprite dentro un riquadro di 180x260. Il movimento sta nel main
// perche' solo qui si conosce l'area di lavoro reale dello schermo.

const WALK_TICK_MS  = 33          // ~30 fps, abbastanza fluido e leggero sulla CPU
const WALK_SPEED    = 55          // px al secondo
const RUN_SPEED     = 150

let walkTimer = null

function stopWalk() {
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null }
}

// Area di lavoro dello schermo su cui sta il companion. Con lo schermo
// principale fisso, su un secondo monitor la camminata riportava la finestra
// dentro i limiti orizzontali del primo e l'avatar saltava di schermo.
function companionWorkArea() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    return screen.getDisplayMatching(companionWindow.getBounds()).workArea
  }
  return screen.getPrimaryDisplay().workArea
}

// Il ciclo di passo nel renderer dura finche' il main non manda idle: ogni
// uscita di startWalk che non avvia il timer deve mandarlo, o l'avatar
// camminerebbe sul posto per sempre.
function sendIdle() {
  try { companionWindow.webContents.send('trigger-animation', { type: 'none', animation: 'idle' }) } catch (_) {}
}

// La meta' la sceglie walk-target.js: verso e distanza chiesti dal modello, o
// a caso. maxDistance limita i gesti a riposo a due passi.
/** @param {{ run?: boolean, direction?: string, distance?: string, maxDistance?: number }} [opts] */
function startWalk({ run = false, direction, distance, maxDistance = Infinity } = {}) {
  if (!companionWindow || companionWindow.isDestroyed()) return
  stopWalk()
  // In braccio non si cammina: la finestra la sta muovendo l'utente.
  if (drag) { sendIdle(); return }

  const area = companionWorkArea()
  const [x, y] = companionWindow.getPosition()
  const [w]    = companionWindow.getSize()
  const cursorX = direction === 'toward-cursor' ? screen.getCursorScreenPoint().x : undefined
  const targetX = walkTarget({ x, width: w, area, direction, distance, cursorX, maxDistance })
  if (targetX === null) { sendIdle(); return }
  const minX = Math.min(x, targetX)
  const maxX = Math.max(x, targetX)

  const dir   = targetX > x ? 1 : -1
  const speed = run ? RUN_SPEED : WALK_SPEED
  const step  = (speed * WALK_TICK_MS) / 1000

  try { companionWindow.webContents.send('companion-facing', { dir }) } catch (_) {}

  let current = x
  walkTimer = setInterval(() => {
    if (!companionWindow || companionWindow.isDestroyed()) { stopWalk(); return }
    current += step * dir
    const done = dir > 0 ? current >= targetX : current <= targetX
    const next = done ? targetX : Math.round(current)
    try {
      moveCompanion(Math.max(minX, Math.min(maxX, next)), y)
    } catch (_) { stopWalk(); return }
    if (done) {
      stopWalk()
      sendIdle()
    }
  }, WALK_TICK_MS)
  if (walkTimer.unref) walkTimer.unref()
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

  if (process.argv.includes('--dev')) {
    chatWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ─── Tray Icon ───────────────────────────────────────────────────────────────

function createTray() {
  // L'icona la genera scripts/make-icon.js (npm run icon), lanciato dagli hook
  // prestart/prebuild. Il vecchio fallback silenzioso a createEmpty() lasciava
  // un quadratino invisibile nella barra di sistema senza dire perche'.
  let icon = nativeImage.createEmpty()
  try {
    const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png')
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    } else {
      console.warn('[tray] icona assente: esegui "npm run icon" per generarla')
    }
  } catch (e) { console.warn('[tray] icona non caricata:', e.message) }
  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mostra companion',  click: () => { if (companionWindow) companionWindow.show() } },
    { label: 'Apri chat',         click: () => toggleChat() },
    { type: 'separator' },
    { label: 'Apri cartella dei log', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')).catch(() => {}) },
    { type: 'separator' },
    { label: 'Esci',              click: () => app.quit() },
  ])

  tray.setToolTip('CompanionAI')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => toggleChat())
}

// ─── Toggle Chat ─────────────────────────────────────────────────────────────

function toggleChat() {
  if (!chatWindow || chatWindow.isDestroyed()) return
  if (chatWindow.isVisible()) {
    chatWindow.hide()
  } else {
    try {
      // In alto a sinistra del companion, ma dentro lo schermo su cui si trova:
      // con il companion vicino al bordo la chat finiva in parte fuori vista.
      const pos = (companionWindow && !companionWindow.isDestroyed()) ? companionWindow.getPosition() : [100, 100]
      const area = companionWorkArea()
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
handle('config:get', () => {
  return publicConfig(loadConfig())
})

handle('config:set', (_e, newCfg) => {
  const current = loadConfig()
  const merged  = mergeConfig(current, newCfg || {})
  saveConfig(merged)
  // La chiave inserita adesso deve servire anche ai riassunti, non solo dal
  // prossimo avvio. loadConfig riapplica il fallback sulle variabili d'ambiente.
  if (memoryManager) memoryManager.setModel(memoryModelFrom(loadConfig()))
  applyWindowOptions(merged)
  return publicConfig(merged)
})

// AI Router
handle('ai:send-message', async (_e, { history }) => {
  const cfg = loadConfig()
  const apiKey = cfg.keys?.[cfg.provider] || ''
  const safeHistory = Array.isArray(history) ? history.filter(m => m && typeof m.content === 'string').slice(-40) : []
  if (safeHistory.length === 0) return { ok: false, error: 'history vuota o non valida' }
  if (cfg.provider !== 'ollama' && !apiKey) return { ok: false, error: `Manca API key per ${cfg.provider}` }
  console.log('[Main] Ricevuta richiesta sendMessage, provider:', cfg.provider)

  // Mentre si aspetta la risposta il companion non fa gesti per conto suo.
  awaitingReply = true
  markActivity()
  updateMood(m => moodLib.onUserMessage(m))
  try {
    const lastUser = [...(history || [])].reverse().find(m => m.role === 'user')
    if (lastUser?.content && memoryManager) {
      await memoryManager.addTurn(lastUser.content, 'user').catch(() => {})
    }

    const historyWithMemory = withMoodLine(await buildHistoryWithMemory(safeHistory))

    console.log('[Main] Chiamata route...')
    const result = await route({
      provider: cfg.provider,
      model:    cfg.model,
      apiKey,
      history: historyWithMemory,
      // Il campo motion si spiega al modello solo quando si puo' usare.
      systemPrompt: (await motionsEnabled(cfg)) ? SYSTEM_PROMPT + MOTION_PROMPT : undefined,
    })
    console.log('[Main] route() completato, reply length:', result?.reply?.length)

    // Da che strada e' arrivata la risposta: con 'fallback' il modello non ha
    // rispettato il formato e l'azione non c'e'. Il testo grezzo resta nel log.
    console.log('[Main] risposta via ' + (result?.via || '?') + (result?.retried ? ' (secondo tentativo)' : '') + (result?.action?.animation ? ', animazione ' + result.action.animation : ''))
    if (result?.via === 'fallback') console.warn('[Main] risposta fuori formato da ' + cfg.model + ': ' + JSON.stringify(result.raw || ''))
    if (result) delete result.raw

    // Il campo arriva da un modello: solo i valori del contratto passano.
    if (result && !EMOTIONS.includes(result.emotion)) delete result.emotion
    if (result?.emotion) updateMood(m => moodLib.react(moodLib.decay(m), result.emotion))

    if (result?.reply && memoryManager) {
      await memoryManager.addTurn(result.reply, 'assistant').catch(() => {})
      // Oltre la soglia i turni piu' vecchi vanno riassunti. In background: la
      // risposta all'utente non deve aspettare il riassunto.
      if (memoryManager.needsCompaction()) {
        memoryManager.compact().catch(e => console.error('[memory] compattazione per soglia fallita:', e.message))
      }
    }

    return { ok: true, result }
  } catch(err) {
    console.error('[Main] Errore in route():', err)
    return { ok: false, error: describeError(err, cfg.provider) }
  } finally {
    awaitingReply = false
    markActivity()
  }
})

// Elenco modelli: dal vivo per OpenRouter e Ollama, statico per gli altri.
handle('models:list', (_e, provider) => {
  if (typeof provider !== 'string' || !PROVIDERS[provider]) return { models: [], live: false }
  return listModels(provider)
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
handle('memory:stats', () => {
  return memoryManager ? memoryManager.getStats() : { error: 'memory not initialized' }
})

handle('memory:get-context', async () => {
  return memoryManager ? await memoryManager.getContext() : []
})

handle('mood:get', () => moodLib.publicMood(moodLib.decay(mood)))

handle('memory:compact-now', async () => {
  if (!memoryManager) return { ok: false, error: 'memory not initialized' }
  try {
    const did = await memoryManager.compact()
    return { ok: true, compacted: did }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

handle('memory:clear', async () => {
  if (!memoryManager) return { ok: false, error: 'memory not initialized' }
  try {
    await memoryManager.clear()
    // Dimenticare tutto vale anche per come si sentiva.
    updateMood(() => moodLib.createMood())
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
handle('animations:pick', async () => {
  const parent = (companionWindow && !companionWindow.isDestroyed()) ? companionWindow : null
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
on('os:execute', async (_e, action) => {
  if (!action?.type) return

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
      message: 'Il companion vuole eseguire un’azione esterna',
      detail: plan.label,
    }
    const parent = (companionWindow && !companionWindow.isDestroyed()) ? companionWindow : null
    const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
    if (answer.response !== 1) return
    plan.run()
  }

  // Triggera animazione companion. Passano solo tipo e animazione: il resto
  // dell'oggetto arriva dal modello e non deve finire nel fumetto.
  if (action.animation) {
    markActivity()
    const motion = checkMotion(action)
    animateCompanion({ type: action.type, animation: action.animation, ...motion }, motion)
    // Una posa chiesta dall'utente ("siediti") resta per un po': i gesti a
    // riposo non devono farlo alzare dopo venti secondi.
    requestedPoseUntil = action.animation === 'sit' ? Date.now() + REQUESTED_POSE_MS : 0
  }
  const motion = motionPrompt(action.motion)
  if (motion) requestGeneratedMotion(motion).catch(e => console.error('[kimodo]', e.message))
})

// ─── Movimenti generati (Kimodo) ─────────────────────────────────────────────
// Il modello descrive in action.motion un movimento che non e' fra le
// animazioni; kimodo-service.js lo genera sulla scheda video. Il renderer
// converte l'uscita in .vrma, la riproduce una volta e la rimanda qui per la
// cache: la stessa frase, la volta dopo, parte subito.

const MOTION_SECONDS = 4
let motionJob = 0
// Chiavi di cache che il renderer puo' salvare: solo quelle appena generate.
const expectedMotions = new Set()

/** Kimodo attivo, installato, e un avatar 3D (il 2D ha solo sprite). */
async function motionsEnabled(cfg = loadConfig()) {
  if (!cfg.kimodo || !kimodo || !kimodo.available()) return false
  let avatars = []
  try { avatars = avatarLibrary ? await avatarLibrary.list() : [] } catch (_) { return false }
  const current = avatars.find(a => a.id === cfg.avatarModel) || avatars.find(a => a.default) || avatars[0]
  return !!current && current.kind !== 'sprite-pack' && current.kind !== 'sprite'
}

/** @param {string} prompt frase gia' ripulita da motionPrompt */
async function requestGeneratedMotion(prompt) {
  if (!(await motionsEnabled())) return
  const job = ++motionJob
  const key = kimodo.cached(prompt, MOTION_SECONDS)
  if (key) {
    sendCompanion('generated-motion', { key, prompt, url: 'motion://generated/' + key, play: true })
    return
  }
  console.log('[kimodo] genero: ' + prompt)
  animateCompanion({ type: 'none', animation: 'think', bubble: 'Provo il movimento…' })
  const started = Date.now()
  try {
    const raw = await kimodo.generate(prompt, { seconds: MOTION_SECONDS })
    const fresh = cacheKey(prompt, MOTION_SECONDS)
    expectedMotions.add(fresh)
    console.log('[kimodo] pronto in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s, ' + raw.frames + ' fotogrammi')
    // Una richiesta piu' recente ha la precedenza: questa va solo in cache.
    sendCompanion('generated-motion', { key: fresh, prompt, rootPositions: raw.rootPositions, rotations: raw.rotations, play: job === motionJob })
  } catch (error) {
    console.error('[kimodo] generazione fallita: ' + error.message)
    if (job === motionJob) animateCompanion({ type: 'none', animation: 'idle', bubble: 'Questo movimento non mi riesce…' })
  }
}

const MAX_MOTION_BYTES = 10 * 1024 * 1024
handle('motions:store', async (_e, payload) => {
  const { key, data } = payload || {}
  if (typeof key !== 'string' || !expectedMotions.has(key)) throw new Error('Movimento non atteso')
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || [])
  if (bytes.length > MAX_MOTION_BYTES || !isGlb(bytes)) throw new Error('Movimento non valido')
  expectedMotions.delete(key)
  await kimodo.store(key, bytes)
  return { url: 'motion://generated/' + key }
})

/**
 * Un gesto, venga dalla chat o dalla vita a riposo. walk-to / run-to muovono
 * la finestra sul desktop, non solo lo sprite.
 * @param {any} action
 * @param {{ maxDistance?: number, direction?: string, distance?: string }} [motion]
 */
function animateCompanion(action, motion = {}) {
  const { maxDistance = Infinity, direction, distance } = motion
  if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null }
  const walking = action.animation === 'walk-to' || action.animation === 'run-to'
  // Per camminare scende prima dal sedile, e parte una volta a terra.
  if (walking && perch && !drag) {
    leavePerch({ fall: true, then: () => animateCompanion(action, motion) })
    return
  }
  try { companionWindow?.webContents.send('trigger-animation', action) } catch (_) {}
  if (walking && !drag) {
    startWalk({ run: action.animation === 'run-to', direction, distance, maxDistance })
  } else {
    stopWalk()
  }
}

// ─── Vita a riposo ───────────────────────────────────────────────────────────
// Quando nessuno scrive, idle-life.js decide ogni IDLE_TICK_MS se fare un
// gesto. Qui si raccolgono i segnali: da quanto non succede nulla, da quanto
// l'utente non tocca il PC, se una risposta e' in arrivo.

const IDLE_TICK_MS = 5000
const REQUESTED_POSE_MS = 3 * 60 * 1000
const IDLE_WALK_MAX_PX = 300
const DRAG_MOOD_EVERY_MS = 30 * 1000

let idleLifeEnabled = true
let idleTimer = null
let gestureTimer = null
let awaitingReply = false
let asleep = false
let lastActivityAt = Date.now()
let lastGestureAt = 0
let lastDragMoodAt = 0
let requestedPoseUntil = 0

function markActivity() {
  lastActivityAt = Date.now()
  asleep = false
}

// Essere presi in braccio fa piacere, ma non a chi stava dormendo.
function onDragged() {
  const wasAsleep = asleep
  markActivity()
  const now = Date.now()
  if (now - lastDragMoodAt < DRAG_MOOD_EVERY_MS) return
  lastDragMoodAt = now
  updateMood(m => moodLib.nudge(moodLib.decay(m, now), wasAsleep ? 'annoyance' : 'joy', wasAsleep ? 0.15 : 0.05))
}

function idleTick() {
  // Seduto su una finestra resta seduto: i gesti a riposo sono pose in piedi.
  if (!idleLifeEnabled || awaitingReply || walkTimer || drag || perch || Date.now() < requestedPoseUntil) return
  if (!companionWindow || companionWindow.isDestroyed() || !companionWindow.isVisible()) return
  // Chi sta scrivendo nella chat non e' assente, anche senza aver inviato.
  if (chatWindow && !chatWindow.isDestroyed() && chatWindow.isFocused()) { markActivity(); return }
  const now = Date.now()
  const decision = decideIdle({
    quietMs: now - lastActivityAt,
    sinceGestureMs: now - lastGestureAt,
    systemIdleMs: powerMonitor.getSystemIdleTime() * 1000,
    asleep,
    mood: moodLib.decay(mood, now),
    hour: new Date(now).getHours(),
  })
  if (!decision) return
  lastGestureAt = now
  if (decision.asleep !== undefined) asleep = decision.asleep
  // Il risveglio e' un ritorno dell'utente: i gesti ripartono dopo la quiete.
  if (decision.name === 'wake') lastActivityAt = now
  animateCompanion({ type: 'none', animation: decision.animation, bubble: decision.bubble, idle: true },
    { maxDistance: IDLE_WALK_MAX_PX })
  if (decision.holdMs > 0) gestureTimer = setTimeout(() => { gestureTimer = null; sendIdle() }, decision.holdMs)
}

function startIdleLife() {
  applyWindowOptions(loadConfig())
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(idleTick, IDLE_TICK_MS)
  if (idleTimer.unref) idleTimer.unref()
}

// ─── Mouse sull'avatar: trascinamento, cursore, menu ────────────────────────
// Alla Mate Engine: l'avatar si prende direttamente, non da una maniglia, e il
// main muove la finestra seguendo il cursore. Cosi' si conosce la velocita',
// che fa oscillare l'avatar (sway.js) e muove capelli e vestiti nel 3D. Prima
// lo spostamento lo faceva Windows con -webkit-app-region: drag, senza dire
// niente sulla velocita', e il tasto destro apriva il menu di sistema.

const DRAG_TICK_MS   = 16     // ~60 Hz, come il cursore
const CURSOR_TICK_MS = 33     // ~30 Hz: lo sguardo e' smorzato, basta
const VELOCITY_SMOOTHING = 0.5

/** @type {{ offX: number, offY: number, x: number, y: number, t: number, vx: number, vy: number, timer: any } | null} */
let drag = null
let cursorTimer = null
let lastCursorKey = ''
let followMouse = true

function sendCompanion(channel, data) {
  if (!companionWindow || companionWindow.isDestroyed()) return
  try { companionWindow.webContents.send(channel, data) } catch (_) {}
}

// setBounds con la dimensione fissa, non setPosition: passando fra schermi con
// scala diversa setPosition lascia a Windows il ricalcolo della dimensione, e
// la finestra cresceva o si stringeva a ogni passaggio.
function moveCompanion(x, y) {
  const [width, height] = companionWindow.getSize()
  companionWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
}

/** Riporta la finestra dentro l'area di lavoro dello schermo su cui si trova. */
function keepOnScreen() {
  if (!companionWindow || companionWindow.isDestroyed()) return
  const b = companionWindow.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  const x = Math.max(area.x, Math.min(b.x, area.x + area.width - b.width))
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - b.height))
  if (x !== b.x || y !== b.y) moveCompanion(x, y)
}

function startDrag() {
  if (drag || !companionWindow || companionWindow.isDestroyed()) return
  // Ripreso in braccio scende dal sedile, senza cadere: lo tiene l'utente.
  leavePerch()
  stopWalk()
  if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null }
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = companionWindow.getPosition()
  drag = { offX: cursor.x - x, offY: cursor.y - y, x, y, t: Date.now(), vx: 0, vy: 0, timer: null }
  onDragged()
  sendCompanion('window-drag-state', { dragging: true })
  drag.timer = setInterval(dragTick, DRAG_TICK_MS)
}

function dragTick() {
  if (!drag) return
  if (!companionWindow || companionWindow.isDestroyed()) { endDrag(); return }
  const cursor = screen.getCursorScreenPoint()
  const x = cursor.x - drag.offX
  const y = cursor.y - drag.offY
  const now = Date.now()
  const dt = Math.max(1, now - drag.t) / 1000
  drag.vx = drag.vx * VELOCITY_SMOOTHING + ((x - drag.x) / dt) * (1 - VELOCITY_SMOOTHING)
  drag.vy = drag.vy * VELOCITY_SMOOTHING + ((y - drag.y) / dt) * (1 - VELOCITY_SMOOTHING)
  if (x !== drag.x || y !== drag.y) {
    try { moveCompanion(x, y) } catch (_) { endDrag(); return }
  }
  drag.x = x; drag.y = y; drag.t = now
  sendCompanion('drag-motion', { vx: Math.round(drag.vx), vy: Math.round(drag.vy) })
}

function endDrag() {
  if (!drag) return
  clearInterval(drag.timer)
  drag = null
  sendCompanion('drag-motion', { vx: 0, vy: 0 })
  sendCompanion('window-drag-state', { dragging: false })
  // Posato con il punto di seduta sul bordo di una finestra si siede; se no,
  // mezzo fuori dallo schermo o dietro la taskbar si perderebbe.
  if (!tryPerch()) keepOnScreen()
  markActivity()
}

// ─── Seduta su finestre e taskbar ────────────────────────────────────────────
// L'ancora e' l'ombra ai piedi: posato con l'ombra sul bordo alto di una
// finestra, o sulla taskbar in basso, l'avatar ci sta in piedi, poi si siede
// con le gambe a penzoloni e la segue. perch.js decide, qui ci sono il timer e
// le chiamate a Windows (win-windows.js). Su una finestra non e' piu' "sempre
// in primo piano": sta subito sopra di lei, e le finestre davanti lo coprono
// come su una scrivania vera.

const PERCH_TICK_MS = 33          // ~30 Hz: segue anche una finestra trascinata
const PERCH_ZORDER_EVERY = 3      // l'ordine z ogni 3 tick, ~10 Hz
const STAND_BEFORE_SIT_MS = 1200  // appena posato sta in piedi, poi si siede
const SIT_DOWN_MS = 450           // il bacino scende sul bordo
const FALL_MS = 280

/** @type {null | (import('./perch').Seat & { timer: any, ticks: number, landedAt: number, sitAt: number })} */
let perch = null
let perchEnabled = true
/**
 * Dove sono ombra e seduta dentro la finestra, dal renderer: x comune, feet
 * l'ombra ai piedi (dove atterra), seat il bacino (dove poggia seduto). Nel 2D
 * coincidono: lo sprite seduto poggia dove poggiava in piedi.
 * @type {{ x: number, feet: number, seat: number } | null}
 */
let seatAnchor = null

/** @param {number} [sit] 0 in piedi, 1 seduto: l'altezza va dall'ombra al bacino */
function currentAnchor(sit = 0) {
  const [w, h] = companionWindow.getSize()
  const a = seatAnchor
  const valid = a && a.x >= 0 && a.x <= w && a.feet >= 0 && a.feet <= h && a.seat >= 0 && a.seat <= h
  const { x, feet, seat } = valid ? a : { x: Math.round(w / 2), feet: h - 12, seat: Math.round(h * 0.55) }
  return { x, y: Math.round(feet + (seat - feet) * sit) }
}

/** Quanto e' seduto adesso, da 0 (appena posato, in piedi) a 1. */
function sitAmount(now = Date.now()) {
  if (!perch || !perch.sitAt) return 0
  return Math.min(1, (now - perch.sitAt) / SIT_DOWN_MS)
}

function displaysInfo() {
  return screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }))
}

// Windows da' pixel fisici, Electron lavora in DIP.
function toDip(rect) {
  return rect ? screen.screenToDipRect(null, rect) : null
}

function ownHandles() {
  return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => winWindows.handleOf(w.getNativeWindowHandle()))
}

/** Al rilascio: se l'ombra cade su un bordo, l'avatar si posa li'. */
function tryPerch() {
  if (!perchEnabled || !winWindows.available() || !companionWindow || companionWindow.isDestroyed()) return false
  const b = companionWindow.getBounds()
  const anchor = currentAnchor(0)
  const shadow = { x: b.x + anchor.x, y: b.y + anchor.y }
  const displays = displaysInfo()
  const windows = winWindows.listWindows().map(w => ({ ...w, bounds: toDip(w.bounds) }))
  const seat = findWindowSeat(windows, shadow, { ownPid: process.pid, displays }) || findTaskbarSeat(shadow, displays)
  if (!seat) {
    console.log('[perch] nessun bordo sotto l\'ombra ' + shadow.x + ',' + shadow.y)
    return false
  }
  console.log('[perch] posato su ' + (seat.kind === 'window' ? 'una finestra' : 'la taskbar') + ', ombra ' + shadow.x + ',' + shadow.y)
  startPerch(seat)
  return true
}

/** @param {import('./perch').Seat} seat */
function startPerch(seat) {
  stopPerch()
  stopWalk()
  perch = { ...seat, timer: null, ticks: 0, landedAt: Date.now(), sitAt: 0 }
  // Sulla taskbar resta in primo piano come prima: la taskbar sta sopra tutto.
  if (seat.kind === 'window' && companionWindow.isAlwaysOnTop()) companionWindow.setAlwaysOnTop(false)
  sendCompanion('perch-state', { perched: true, kind: seat.kind, phase: 'stand' })
  perchTick()
  perch.timer = setInterval(perchTick, PERCH_TICK_MS)
}

/** Bordo su cui stare adesso; null se non si puo' restare seduti. */
function perchEdge() {
  const displays = displaysInfo()
  if (perch.kind === 'window') {
    const state = winWindows.windowState(perch.hwnd)
    const current = state && { ...state, bounds: toDip(state.bounds) }
    if (!staysSeated(current, displays)) return null
    return { x: current.bounds.x, y: current.bounds.y, width: current.bounds.width }
  }
  const display = displays.find(d => d.id === perch.displayId)
  return display ? taskbarEdge(display) : null
}

function perchTick() {
  if (!perch) return
  if (!companionWindow || companionWindow.isDestroyed()) { stopPerch(); return }
  const edge = perchEdge()
  if (!edge) { leavePerch({ fall: true }); return }
  const now = Date.now()
  // Dopo un momento in piedi si siede: la posa cambia nel renderer, e qui la
  // finestra scende finche' il bacino poggia sul bordo al posto dell'ombra.
  if (!perch.sitAt && now - perch.landedAt >= STAND_BEFORE_SIT_MS) {
    perch.sitAt = now
    sendCompanion('perch-state', { perched: true, kind: perch.kind, phase: 'sit' })
  }
  const pos = perchPosition(edge, perch.fraction, currentAnchor(sitAmount(now)))
  const b = companionWindow.getBounds()
  if (pos.x !== b.x || pos.y !== b.y) {
    try { moveCompanion(pos.x, pos.y) } catch (_) { leavePerch(); return }
  }
  if (perch.kind === 'window' && perch.ticks++ % PERCH_ZORDER_EVERY === 0) {
    winWindows.placeAbove(winWindows.handleOf(companionWindow.getNativeWindowHandle()), perch.hwnd, ownHandles())
  }
}

function stopPerch() {
  if (!perch) return
  clearInterval(perch.timer)
  perch = null
}

/**
 * Scende dal sedile. fall: cade fino a terra (la finestra e' sparita, o deve
 * camminare); senza, resta dov'e' perche' l'ha preso in braccio l'utente.
 * @param {{ fall?: boolean, then?: (() => void) | null }} [opts]
 */
function leavePerch({ fall = false, then = null } = {}) {
  if (!perch) { if (then) then(); return }
  stopPerch()
  if (companionWindow && !companionWindow.isDestroyed() && loadConfig().alwaysOnTop !== false && !companionWindow.isAlwaysOnTop()) {
    companionWindow.setAlwaysOnTop(true, 'screen-saver')
  }
  sendCompanion('perch-state', { perched: false })
  if (fall) fallToGround(then)
  else if (then) then()
}

/** Scende fino al bordo basso dell'area di lavoro, accelerando. */
function fallToGround(then) {
  if (!companionWindow || companionWindow.isDestroyed()) return
  const area = companionWorkArea()
  const b = companionWindow.getBounds()
  const x = Math.max(area.x, Math.min(b.x, area.x + area.width - b.width))
  const from = b.y
  const to = area.y + area.height - b.height
  const started = Date.now()
  const timer = setInterval(() => {
    // Ripreso in braccio o seduto di nuovo mentre cadeva: la caduta finisce li'.
    if (!companionWindow || companionWindow.isDestroyed() || drag || perch) { clearInterval(timer); return }
    const k = Math.min(1, (Date.now() - started) / FALL_MS)
    try { moveCompanion(x, from + (to - from) * k * k) } catch (_) { clearInterval(timer); return }
    if (k >= 1) {
      clearInterval(timer)
      if (then) then()
    }
  }, 16)
}

// Il cursore rispetto alla finestra, anche quando e' fuori: la pagina lo usa
// per lo sguardo e per accorgersi che il mouse se n'e' andato.
function cursorTick() {
  if (drag || !companionWindow || companionWindow.isDestroyed() || !companionWindow.isVisible()) return
  const cursor = screen.getCursorScreenPoint()
  const b = companionWindow.getBounds()
  const msg = { x: cursor.x - b.x, y: cursor.y - b.y, follow: followMouse }
  const key = msg.x + ',' + msg.y + ',' + msg.follow
  if (key === lastCursorKey) return
  lastCursorKey = key
  sendCompanion('cursor', msg)
}

function startCursorFeed() {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = setInterval(cursorTick, CURSOR_TICK_MS)
  if (cursorTimer.unref) cursorTimer.unref()
}

/** Ridimensiona tenendo fermi i piedi: centro in basso della finestra. */
function applyScale(scale) {
  const size = WINDOW_SCALES[scale]
  if (!size || !companionWindow || companionWindow.isDestroyed()) return
  const b = companionWindow.getBounds()
  if (b.width === size.width && b.height === size.height) return
  companionWindow.setBounds({
    x: Math.round(b.x + (b.width - size.width) / 2),
    y: b.y + b.height - size.height,
    width: size.width, height: size.height,
  })
  // Seduto, la posizione la rimette perchTick con il punto di seduta nuovo.
  if (!perch) keepOnScreen()
}

/** Applica le opzioni della config che toccano finestra e comportamento. */
function applyWindowOptions(cfg) {
  idleLifeEnabled = cfg.idleLife !== false
  followMouse = cfg.followMouse !== false
  perchEnabled = cfg.perch !== false
  // Spento Kimodo, la memoria video si libera subito.
  if (!cfg.kimodo && kimodo) kimodo.stop()
  if (!companionWindow || companionWindow.isDestroyed()) return
  if (!perchEnabled && perch) leavePerch({ fall: true })
  // Seduto su una finestra sta sotto quelle davanti: "sempre in primo piano"
  // torna quando scende (leavePerch).
  const onTop = cfg.alwaysOnTop !== false && !(perch && perch.kind === 'window')
  if (companionWindow.isAlwaysOnTop() !== onTop) companionWindow.setAlwaysOnTop(onTop, 'screen-saver')
  applyScale(cfg.scale)
}

/** Cambia un'opzione dal menu e avvisa la chat, che mostra gli stessi interruttori. */
function setOption(partial) {
  const merged = mergeConfig(loadConfig(), partial)
  saveConfig(merged)
  applyWindowOptions(merged)
  if (chatWindow && !chatWindow.isDestroyed()) {
    try { chatWindow.webContents.send('config-changed', publicConfig(merged)) } catch (_) {}
  }
}

async function showCompanionMenu() {
  if (!companionWindow || companionWindow.isDestroyed()) return
  const cfg = loadConfig()
  let avatars = []
  try { avatars = avatarLibrary ? await avatarLibrary.list() : [] } catch (_) {}
  const current = avatars.find(a => a.id === cfg.avatarModel) || avatars.find(a => a.default) || avatars[0]
  const kind = (a) => (a.kind === 'sprite-pack' || a.kind === 'sprite') ? '2D' : '3D'
  const command = (data) => sendCompanion('menu-command', data)
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    { label: 'Apri chat', click: () => toggleChat() },
    {
      label: 'Avatar',
      submenu: [
        ...avatars.map(a => ({
          label: a.name + '  (' + kind(a) + ')', type: /** @type {const} */ ('radio'),
          checked: !!current && a.id === current.id,
          click: () => command({ cmd: 'avatar', id: a.id }),
        })),
        { type: 'separator' },
        { label: 'Importa avatar…', click: () => command({ cmd: 'import' }) },
      ],
    },
    {
      label: 'Dimensione',
      submenu: Object.entries(WINDOW_SCALES).map(([id, size]) => ({
        label: size.label, type: /** @type {const} */ ('radio'), checked: cfg.scale === id,
        click: () => setOption({ scale: id }),
      })),
    },
    { type: 'separator' },
    { label: 'Segue il mouse', type: 'checkbox', checked: cfg.followMouse, click: (item) => setOption({ followMouse: item.checked }) },
    { label: 'Vita autonoma', type: 'checkbox', checked: cfg.idleLife, click: (item) => setOption({ idleLife: item.checked }) },
    { label: 'Sempre in primo piano', type: 'checkbox', checked: cfg.alwaysOnTop, click: (item) => setOption({ alwaysOnTop: item.checked }) },
    winWindows.available()
      ? { label: 'Si siede su finestre e taskbar', type: 'checkbox', checked: cfg.perch, click: (item) => setOption({ perch: item.checked }) }
      : { label: 'Si siede su finestre e taskbar (non disponibile)', enabled: false },
    kimodo && kimodo.available()
      ? { label: 'Movimenti nuovi con Kimodo', type: 'checkbox', checked: cfg.kimodo, click: (item) => setOption({ kimodo: item.checked }) }
      : { label: 'Movimenti nuovi con Kimodo (non installato)', enabled: false },
    { type: 'separator' },
    { label: 'Nascondi (torna dall\'icona nella barra)', click: () => { if (companionWindow) companionWindow.hide() } },
    { label: 'Esci', click: () => app.quit() },
  ]
  template.splice(3, 0, {
    label: 'Animazioni',
    submenu: [
      { label: 'Importa animazione (VRMA, glTF, FBX, BVH)…', click: () => command({ cmd: 'import-animation' }) },
      { label: 'Apri la cartella delle animazioni', click: () => openAnimationsFolder() },
    ],
  })
  Menu.buildFromTemplate(template).popup({ window: companionWindow })
}

// Per togliere un'animazione importata basta cancellarne il file.
function openAnimationsFolder() {
  const dir = animationLibrary && animationLibrary.userDir
  if (!dir) return
  fs.promises.mkdir(dir, { recursive: true })
    .then(() => shell.openPath(dir))
    .catch(e => console.error('[animazioni] cartella non aperta:', e.message))
}

on('drag:start', () => startDrag())
on('drag:end', () => endDrag())
on('mouse:capture', (_e, capture) => {
  if (!companionWindow || companionWindow.isDestroyed()) return
  companionWindow.setIgnoreMouseEvents(capture !== true, { forward: true })
})
on('companion:menu', () => { showCompanionMenu().catch(e => console.error('[menu]', e.message)) })
// Ombra e seduta dentro la finestra, in px: solo numeri, la finestra li limita.
on('companion:seat-anchor', (_e, anchor) => {
  if (!anchor || ![anchor.x, anchor.feet, anchor.seat].every(Number.isFinite)) return
  seatAnchor = { x: Math.round(anchor.x), feet: Math.round(anchor.feet), seat: Math.round(anchor.seat) }
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
  // Clip .vrma: motion://builtin, motion://private, motion://user.
  {
    scheme: 'motion',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
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
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.show()
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

  // Nessun permesso del browser: l'app non usa microfono, fotocamera,
  // notifiche o posizione, e una pagina non deve poterli chiedere.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  avatarLibrary = new AvatarLibrary(path.join(app.getPath('userData'), 'avatars'), builtinAvatars(path.join(__dirname, '..', '..')))
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

  initMemory()
  createCompanionWindow()
  createChatWindow()
  createTray()
  initMood().catch(e => console.error('[mood] caricamento fallito:', e.message))
  startIdleLife()
  startCursorFeed()
})

app.on('window-all-closed', () => {
  stopWalk()
  endDrag()
  if (cursorTimer) clearInterval(cursorTimer)
  if (idleTimer) clearInterval(idleTimer)
  if (global.__memoryTimer) clearInterval(global.__memoryTimer)
  if (kimodo) kimodo.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!companionWindow || companionWindow.isDestroyed()) createCompanionWindow()
    if (!chatWindow || chatWindow.isDestroyed()) createChatWindow()
  }
})
