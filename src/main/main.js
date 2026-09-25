const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, protocol, net, dialog, safeStorage, session } = require('electron')
const path  = require('path')
const { spawn } = require('child_process')
const fs    = require('fs')
const os    = require('os')
const { route, PROVIDERS, describeError, listModels } = require('./ai-router')
const { MemoryManager } = require('../memory/MemoryManager')
const { AvatarLibrary } = require('./AvatarLibrary')
const { builtinAvatars } = require('./builtin-avatars')
const { isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender } = require('./guards')
const { setupLogging } = require('./logger')

let companionWindow = null
let chatWindow      = null
let tray            = null
let memoryManager   = null
let avatarLibrary   = null

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
const DEFAULT_CONFIG = { provider: 'openrouter', model: DEFAULT_MODEL, avatarModel: '', keys: {} }

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
  if (cfg.keysEncrypted && cfg.keys && typeof cfg.keys === 'object') {
    for (const [provider, value] of Object.entries(cfg.keys)) {
      try { cfg.keys[provider] = safeStorage.decryptString(Buffer.from(value, 'base64')) } catch (_) { delete cfg.keys[provider] }
    }
  }
  cfg.provider = typeof cfg.provider === 'string' ? cfg.provider : DEFAULT_CONFIG.provider
  cfg.model = typeof cfg.model === 'string' ? cfg.model : DEFAULT_CONFIG.model
  cfg.avatarModel = typeof cfg.avatarModel === 'string' ? cfg.avatarModel : DEFAULT_CONFIG.avatarModel
  if (!PROVIDERS[cfg.provider]) { cfg.provider = DEFAULT_CONFIG.provider; cfg.model = DEFAULT_CONFIG.model }

  // Fallback: se manca la key salvata per il provider attivo, usa l'env var
  cfg.keys = (cfg.keys && typeof cfg.keys === 'object') ? cfg.keys : {}
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
    const stored = { ...cfg, keys: { ...(cfg.keys || {}) } }
    if (safeStorage.isEncryptionAvailable()) {
      for (const [provider, value] of Object.entries(stored.keys)) {
        stored.keys[provider] = safeStorage.encryptString(value).toString('base64')
      }
      stored.keysEncrypted = true
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2))
  } catch (e) { console.error('[config] salvataggio fallito:', e.message) }
}

function publicConfig(cfg) {
  const { keys, ...safe } = cfg
  return { ...safe, keyConfigured: Object.fromEntries(Object.entries(keys || {}).map(([name, value]) => [name, !!value])), providers: PROVIDERS }
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

// ─── Companion Window ────────────────────────────────────────────────────────

function createCompanionWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  companionWindow = new BrowserWindow({
    width: 180, height: 260,
    x: width - 220, y: height - 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
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
  companionWindow.setAlwaysOnTop(true, 'screen-saver')

  if (process.argv.includes('--dev')) {
    companionWindow.webContents.openDevTools({ mode: 'detach' })
  }

  let moveTimeout = null
  companionWindow.on('move', () => {
    if (!companionWindow || companionWindow.isDestroyed()) return
    // Durante una camminata autonoma il movimento lo genera il main: non e' un
    // trascinamento dell'utente e non deve mettere in pausa l'animazione.
    if (walkTimer) return
    try { companionWindow.webContents.send('window-drag-state', { dragging: true }) } catch (_) {}
    if (moveTimeout) clearTimeout(moveTimeout)
    moveTimeout = setTimeout(() => {
      if (!companionWindow || companionWindow.isDestroyed()) return
      try { companionWindow.webContents.send('window-drag-state', { dragging: false }) } catch (_) {}
    }, 200)
  })
}

// ─── Camminata sul desktop ───────────────────────────────────────────────────
// L'avatar vive sul desktop, quindi "walk-to" deve spostare la finestra, non solo
// far scorrere lo sprite dentro un riquadro di 180x260. Il movimento sta nel main
// perche' solo qui si conosce l'area di lavoro reale dello schermo.

const WALK_TICK_MS  = 33          // ~30 fps, abbastanza fluido e leggero sulla CPU
const WALK_SPEED    = 55          // px al secondo
const RUN_SPEED     = 150
const MIN_WALK_DIST = 120         // sotto questa soglia lo spostamento non si nota

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

function startWalk({ run = false } = {}) {
  if (!companionWindow || companionWindow.isDestroyed()) return
  stopWalk()

  const area = companionWorkArea()
  const [x, y] = companionWindow.getPosition()
  const [w]    = companionWindow.getSize()
  const minX = area.x
  const maxX = area.x + area.width - w
  if (maxX <= minX) { sendIdle(); return }

  // Sceglie una meta' lontana almeno MIN_WALK_DIST, restando nell'area di lavoro.
  let targetX
  let guard = 0
  do {
    targetX = Math.round(minX + Math.random() * (maxX - minX))
    guard++
  } while (Math.abs(targetX - x) < MIN_WALK_DIST && guard < 12)
  if (Math.abs(targetX - x) < 8) { sendIdle(); return }

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
      companionWindow.setPosition(Math.max(minX, Math.min(maxX, next)), y)
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
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  chatWindow = new BrowserWindow({
    width: 380, height: 520,
    x: width - 420, y: height - 580,
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

  try {
    const lastUser = [...(history || [])].reverse().find(m => m.role === 'user')
    if (lastUser?.content && memoryManager) {
      await memoryManager.addTurn(lastUser.content, 'user').catch(() => {})
    }

    const historyWithMemory = await buildHistoryWithMemory(safeHistory)

    console.log('[Main] Chiamata route...')
    const result = await route({
      provider: cfg.provider,
      model:    cfg.model,
      apiKey,
      history: historyWithMemory,
    })
    console.log('[Main] route() completato, reply length:', result?.reply?.length)

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
    filters: [{ name: 'Avatar supportati', extensions: ['vrm', 'glb', 'gltf', 'png', 'webp', 'jpg', 'jpeg', 'json'] }],
  })
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true }
  return avatarLibrary.scan(picked.filePaths[0])
})
handle('avatars:commit-import', (_event, data) => {
  const { token, candidateId } = data || {}
  if (typeof token !== 'string' || typeof candidateId !== 'string') throw new Error('Selezione avatar non valida')
  return avatarLibrary.commit(token, candidateId)
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

  // Triggera animazione companion
  if (action.animation) {
    companionWindow?.webContents.send('trigger-animation', action)
    // walk-to / run-to muovono la finestra sul desktop, non solo lo sprite
    if (action.animation === 'walk-to' || action.animation === 'run-to') {
      startWalk({ run: action.animation === 'run-to' })
    } else {
      stopWalk()
    }
  }
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
      stream: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'avatar',
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

  // Nessun permesso del browser: l'app non usa microfono, fotocamera,
  // notifiche o posizione, e una pagina non deve poterli chiedere.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  avatarLibrary = new AvatarLibrary(path.join(app.getPath('userData'), 'avatars'), builtinAvatars(path.join(__dirname, '..', '..')))
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
  protocol.handle('vrm', (request) => {
    try {
      let relativePath = request.url.replace(/^vrm:\/\//i, '');
      relativePath = relativePath.replace(/^modelli-3d\//i, '');
      relativePath = decodeURIComponent(relativePath);

      const safeRoot = path.normalize(path.join(__dirname, '..', '..', 'modelli-3d'));
      const realRelative = resolveCaseInsensitive(safeRoot, relativePath);
      const absolutePath = path.normalize(path.join(safeRoot, realRelative));

      console.log('[VRM Protocol] Richiesta:', request.url, '=> File:', absolutePath);

      if (absolutePath !== safeRoot && !absolutePath.startsWith(safeRoot + path.sep)) {
        console.error('[VRM Protocol] Accesso negato:', absolutePath);
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(absolutePath)) {
        console.error('[VRM Protocol] File non trovato:', absolutePath);
        return new Response('File Not Found', { status: 404 });
      }

      const fileUrl = require('url').pathToFileURL(absolutePath).toString();
      return net.fetch(fileUrl);
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

  initMemory()
  createCompanionWindow()
  createChatWindow()
  createTray()
})

app.on('window-all-closed', () => {
  stopWalk()
  if (global.__memoryTimer) clearInterval(global.__memoryTimer)
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!companionWindow || companionWindow.isDestroyed()) createCompanionWindow()
    if (!chatWindow || chatWindow.isDestroyed()) createChatWindow()
  }
})
