// companion.js — un companion sul desktop (Blocco 8a): la sua finestra, la
// persona che lo abita, e tutto quello che e' suo: umore, rapporto, memoria,
// diario, vita a riposo, camminata, presa in braccio, sbirciata, seduta su
// finestre e taskbar, tocchi, batti cinque, chibi, la stanza e il menu.
//
// Prima tutto questo stava in main.js con un solo companionWindow globale. Qui
// ogni companion e' un'istanza di createCompanion; main.js tiene quello che e'
// dell'app (config, chat, impostazioni, voce, microfono, connettori, librerie)
// e lo passa in ctx. Le regole pure restano nei loro moduli (mood.js,
// rapport.js, perch.js, edge-peek.js, walk-target.js, room.js, idle-life.js,
// touch-react.js).

const { BrowserWindow, screen, Menu, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const { MemoryManager } = require('../memory/MemoryManager')
const winWindows = require('./win-windows')
const { findWindowSeat, findTaskbarSeat, taskbarEdge, perchPosition, staysSeated } = require('./perch')
const edgePeek = require('./edge-peek')
const room = require('./room')
const { WINDOW_SCALES, chibiUnavailable } = require('./guards')
const { walkTarget } = require('./walk-target')
const moodLib = require('./mood')
const Personas = require('./personas')
const Rapport = require('./rapport')
const Diary = require('./diary')
const ActiveApp = require('./active-app')
const touchReact = require('./touch-react')
const { decideIdle } = require('./idle-life')
const { route } = require('./ai-router')
const { overlaps, blockedWalk, nudgeAside } = require('./companions')

// ─── Aiuti sugli schermi e sulle finestre di Windows (di tutti) ──────────────

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

// ─── Costanti ────────────────────────────────────────────────────────────────

const WALK_TICK_MS  = 33          // ~30 fps, abbastanza fluido e leggero sulla CPU
const WALK_SPEED    = 55          // px al secondo
const RUN_SPEED     = 150
const IDLE_WALK_MAX_PX = 300
const REQUESTED_POSE_MS = 3 * 60 * 1000
const DRAG_MOOD_EVERY_MS = 30 * 1000
const DRAG_TICK_MS   = 16         // ~60 Hz, come il cursore
const VELOCITY_SMOOTHING = 0.5
const PEEK_TICK_MS = 100
const PEEK_SLIDE_MS = 350
const PEEK_OUT_MS = 450
const PEEK_GEOMETRY_WAIT_MS = 1500
const PERCH_TICK_MS = 33          // ~30 Hz: segue anche una finestra trascinata
const PERCH_ZORDER_EVERY = 3      // l'ordine z ogni 3 tick, ~10 Hz
const STAND_BEFORE_SIT_MS = 1200  // appena posato sta in piedi, poi si siede
const SIT_DOWN_MS = 450           // il bacino scende sul bordo
const FALL_MS = 280
const TOUCH_MIN_MS = 300
const MOTION_SECONDS = 4
const CHAT_DESKTOP_SIZE = { width: 380, height: 520 }
const SPOT_SAVE_MS = 800
const ASIDE_MS = 250

/**
 * Un companion. ctx e' quello che main.js condivide: config, chat,
 * impostazioni, voce, librerie, preferenze (vedi createContext in main.js).
 * @param {any} ctx
 * @param {string} personaId
 * @param {{ slot?: number }} [opts]
 */
function createCompanion(ctx, personaId, { slot = 0 } = {}) {
  /** @type {Electron.BrowserWindow | null} */
  let win = null
  const c = {}   // l'interfaccia verso main.js, riempita in fondo

  const persona = () => ctx.persona(personaId)
  const alive = () => !!win && !win.isDestroyed()

  // Ospite nella stanza di un altro (Blocco 8e): gesti, umore e fumetti vanno
  // alla finestra della stanza, che lo disegna nella sua scena.
  const GUEST_CHANNELS = new Set(['trigger-animation', 'mood-changed', 'companion-bubble'])
  function send(channel, data) {
    const host = ctx.guestHost(c)
    if (host) {
      if (GUEST_CHANNELS.has(channel)) host.send('room-guest', { op: 'event', id: personaId, channel, data })
      return
    }
    if (!alive()) return
    try { win.webContents.send(channel, data) } catch (_) {}
  }

  // ─── Umore e rapporto ──────────────────────────────────────────────────────
  // Della persona, accanto alla sua memoria; spariscono con "Dimentica tutto".
  const dir = () => Personas.personaDir(ctx.MEMORY_PATH, personaId)
  const moodPath = () => path.join(dir(), 'mood.json')
  const rapportPath = () => path.join(dir(), 'rapport.json')
  let mood = moodLib.createMood()
  let moodSave = Promise.resolve()
  let rapport = Rapport.createRapport()
  let rapportSave = Promise.resolve()

  async function initMood() {
    mood = await moodLib.loadMood(moodPath())
    rapport = await Rapport.loadRapport(rapportPath())
    broadcastMood()
  }

  function publicMoodNow() {
    return { ...moodLib.publicMood(moodLib.decay(mood)), rapport: Rapport.publicRapport(rapport) }
  }

  function broadcastMood() {
    const data = { ...moodLib.publicMood(mood), rapport: Rapport.publicRapport(rapport) }
    send('mood-changed', data)
    // La chat mostra l'umore di chi le sta parlando.
    const chat = ctx.chat()
    if (chat && ctx.isChatTarget(c)) try { chat.webContents.send('mood-changed', data) } catch (_) {}
  }

  /** Applica una trasformazione pura all'umore, poi salva e avvisa. */
  function updateMood(change) {
    mood = change(mood)
    // In coda: due salvataggi ravvicinati non devono superarsi a vicenda.
    const snapshot = mood
    const file = moodPath()
    moodSave = moodSave.then(() => moodLib.saveMood(file, snapshot))
      .catch(e => console.error('[mood] salvataggio fallito:', e.message))
    broadcastMood()
  }

  /** Come updateMood. Salire di livello fa piacere: un gesto contento. */
  function updateRapport(change) {
    const before = rapport
    rapport = change(rapport)
    if (rapport === before) return
    const snapshot = rapport
    const file = rapportPath()
    rapportSave = rapportSave.then(() => Rapport.saveRapport(file, snapshot))
      .catch(e => console.error('[rapporto] salvataggio fallito:', e.message))
    if (rapport.level !== before.level) {
      console.log('[rapporto] ' + personaId + ': livello ' + Rapport.LEVELS[before.level] + ' -> ' + Rapport.LEVELS[rapport.level])
      if (rapport.level > before.level) animate({ type: 'none', animation: 'happy', bubble: '💞' })
    }
    broadcastMood()
  }

  const bond = () => Rapport.reactionScale(rapport.level)

  // ─── Memoria e diario ──────────────────────────────────────────────────────
  /** @type {MemoryManager | null} */
  let memory = null
  let memoryTimer = null
  let diaryBusy = false

  function initMemory() {
    memory = new MemoryManager(personaId, ctx.MEMORY_PATH, ctx.memoryModel())
    // Carica subito lo stato su disco: senza questo la memoria del boot precedente
    // arriverebbe solo al primo turno, in ritardo rispetto alla prima domanda.
    const mm = memory
    mm.loadState()
      .then(loaded => { console.log('[memory] ' + personaId + ': stato caricato: ' + (loaded ? 'si' : 'nessuno su disco')); maybeWriteDiary() })
      .catch(e => console.error('[memory] loadState fallito:', e.message))
    // Auto-compaction: i turni piu' vecchi di 7 giorni sfumano in summary
    // (fading memory, ispirato a companion-emergence). Ogni 60 minuti.
    if (memoryTimer) clearInterval(memoryTimer)
    memoryTimer = setInterval(() => {
      if (!memory) return
      memory.compact(7).then(did => { if (did) console.log('[memory] auto-compaction completata') }).catch(() => {})
      maybeWriteDiary()
    }, 60 * 60 * 1000)
    if (memoryTimer.unref) memoryTimer.unref()
  }

  // Una voce per l'ultimo giorno in cui vi siete parlati, scritta al primo
  // avvio del giorno dopo (e al cambio di persona, e dal timer orario se l'app
  // resta accesa a cavallo della mezzanotte). Senza chiave o con un errore si
  // salta: riprova la volta dopo.
  async function maybeWriteDiary() {
    const mm = memory
    const p = persona()
    if (diaryBusy || !mm || !p) return
    diaryBusy = true
    try {
      const turns = [...mm.getArchive(), ...mm.getRawTurns()]
      const file = ctx.diaryPath(p.id)
      const day = Diary.dayToWrite(turns, await Diary.loadDiary(file))
      if (!day) return
      const cfg = ctx.loadConfig()
      const apiKey = cfg.keys?.[cfg.provider] || ''
      if (cfg.provider !== 'ollama' && !apiKey) return
      const result = await route({
        provider: cfg.provider, model: cfg.model, apiKey,
        jsonMode: false, maxTokens: Diary.MAX_TOKENS,
        systemPrompt: Diary.systemPrompt(p),
        history: [{ role: 'user', content: 'Il dialogo del ' + day + ':\n' + Diary.transcript(turns, day, p.name) }],
      })
      const text = Diary.cleanEntry(result && result.reply)
      if (!text) return
      await Diary.appendDiary(file, { day, text })
      console.log('[diario] scritta la voce del ' + day + ' per ' + p.id)
      ctx.sendSettings('diary-changed', p.id)
    } catch (e) {
      console.error('[diario] non scritto:', e.message)
    } finally { diaryBusy = false }
  }

  // Costruisce la history effettiva unendo memoria di lungo periodo e chat corrente.
  //
  // Senza questo passaggio il MemoryManager sarebbe solo un logger: la chat manda
  // unicamente il proprio array in RAM, azzerato a ogni riavvio, e il companion
  // ricomincerebbe da zero ogni volta. Qui il riassunto entra come messaggio di
  // sistema e i turni piu' vecchi non ancora presenti nella chat vengono anteposti.
  async function buildHistoryWithMemory(rendererHistory) {
    const history = Array.isArray(rendererHistory) ? rendererHistory : []
    if (!memory) return history
    let context = []
    try {
      context = await memory.getContext(ctx.MEMORY_CONTEXT_TOKENS)
    } catch (e) {
      console.error('[memory] getContext fallito, procedo senza memoria:', e.message)
      return history
    }
    const known = new Set(history.map(m => (m.content || '').trim()))
    const preface = []
    const summary = context.find(x => x.speaker === 'summary')
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
    const touched = touchReact.touchPromptText(lastTouch, Date.now())
    const cfg = ctx.loadConfig()
    const app = cfg.activeApp ? ActiveApp.activeAppLine(ctx.lastForeign(), cfg.activeAppIgnore, process.pid) : null
    const line = { role: 'system', content: moodLib.promptLine(mood) + ' ' + Rapport.promptLine(rapport) + (touched ? ' ' + touched : '') + (app ? ' ' + app : '') }
    const firstDialog = history.findIndex(m => m.role !== 'system')
    if (firstDialog === -1) return [...history, line]
    return [...history.slice(0, firstDialog), line, ...history.slice(firstDialog)]
  }

  /** "Dimentica tutto": memoria, umore, rapporto e diario. */
  async function forget() {
    if (memory) await memory.clear()
    updateMood(() => moodLib.createMood())
    updateRapport(() => Rapport.createRapport())
    await fs.promises.rm(ctx.diaryPath(personaId), { force: true }).catch(() => {})
  }

  // ─── Finestra ──────────────────────────────────────────────────────────────

  function createWindow() {
    const cfg = ctx.loadConfig()
    const size = WINDOW_SCALES[cfg.scale]
    // Dove era l'ultima volta, o un posto libero accanto agli altri (main.js).
    const spot = ctx.spotFor(personaId, size)
    win = new BrowserWindow({
      width: size.width, height: size.height,
      x: spot.x, y: spot.y,
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
      // Nella stanza la finestra compare nella barra delle applicazioni.
      icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
        // La voce parla quando arriva una risposta, non dopo un clic sulla pagina.
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    // slot: 0 e' il primo companion (lo cercano smoke e audit).
    win.loadFile(path.join(__dirname, '../renderer/companion.html'), { query: { slot: String(slot) } })
    if (cfg.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')
    // I clic sui pixel vuoti passano alle finestre sotto. forward: true lascia
    // arrivare i movimenti del mouse alla pagina, che decide quando catturarli
    // (companion-input.js).
    win.setIgnoreMouseEvents(true, { forward: true })
    // Nella stanza la chat segue la finestra, e la stanza si ricorda dov'era.
    win.on('move', () => { onRoomMoved(); saveSpotSoon() })
    win.on('resize', () => onRoomMoved())
    // Aperta l'ultima volta nella stanza: si riapre li'. La pagina deve essere
    // pronta, o non saprebbe della modalita'.
    win.webContents.once('did-finish-load', () => {
      if (cfg.view === 'room' && slot === 0) setView('room')
      else sendViewMode()
    })
    if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' })
  }

  // Area di lavoro dello schermo su cui sta il companion. Con lo schermo
  // principale fisso, su un secondo monitor la camminata riportava la finestra
  // dentro i limiti orizzontali del primo e l'avatar saltava di schermo.
  function workArea() {
    if (alive()) return screen.getDisplayMatching(win.getBounds()).workArea
    return screen.getPrimaryDisplay().workArea
  }

  // setBounds con la dimensione fissa, non setPosition: passando fra schermi con
  // scala diversa setPosition lascia a Windows il ricalcolo della dimensione, e
  // la finestra cresceva o si stringeva a ogni passaggio.
  function moveTo(x, y) {
    const [width, height] = win.getSize()
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
  }

  // Il posto sul desktop si ricorda per persona, poco dopo che si e' fermato.
  let spotTimer = null
  function saveSpotSoon() {
    clearTimeout(spotTimer)
    spotTimer = setTimeout(() => {
      if (alive() && viewMode === 'desktop' && !drag) ctx.saveSpot(personaId, win.getBounds())
    }, SPOT_SAVE_MS)
  }

  /** Posato sopra un altro companion, scivola di lato. */
  function stepAside() {
    if (!alive()) return
    const to = nudgeAside(win.getBounds(), ctx.othersRects(c), workArea())
    if (to) slideTo(to, ASIDE_MS)
  }

  /** Riporta la finestra dentro l'area di lavoro dello schermo su cui si trova. */
  function keepOnScreen() {
    if (!alive()) return
    const b = win.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    const x = Math.max(area.x, Math.min(b.x, area.x + area.width - b.width))
    const y = Math.max(area.y, Math.min(b.y, area.y + area.height - b.height))
    if (x !== b.x || y !== b.y) moveTo(x, y)
  }

  // ─── Camminata sul desktop ─────────────────────────────────────────────────
  // L'avatar vive sul desktop, quindi "walk-to" deve spostare la finestra, non
  // solo far scorrere lo sprite dentro un riquadro di 180x260. Il movimento sta
  // nel main perche' solo qui si conosce l'area di lavoro reale dello schermo.
  let walkTimer = null

  function stopWalk() {
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null }
  }

  // Il ciclo di passo nel renderer dura finche' il main non manda idle: ogni
  // uscita di startWalk che non avvia il timer deve mandarlo, o l'avatar
  // camminerebbe sul posto per sempre.
  function sendIdle() {
    send('trigger-animation', { type: 'none', animation: 'idle' })
  }

  // La meta' la sceglie walk-target.js: verso e distanza chiesti dal modello, o
  // a caso. maxDistance limita i gesti a riposo a due passi.
  /** @param {{ run?: boolean, direction?: string, distance?: string, maxDistance?: number }} [opts] */
  function startWalk({ run = false, direction, distance, maxDistance = Infinity } = {}) {
    if (!alive()) return
    stopWalk()
    // Una camminata chiesta mentre sbircia parte da dentro lo schermo.
    endPeek('walk', 'jump')
    stopSlide()
    // In braccio non si cammina: la finestra la sta muovendo l'utente. Nella
    // stanza nemmeno: la finestra e' la stanza.
    if (drag || viewMode === 'room') { sendIdle(); return }
    const area = workArea()
    const [x, y] = win.getPosition()
    const [w] = win.getSize()
    const cursorX = direction === 'toward-cursor' ? screen.getCursorScreenPoint().x : undefined
    const wanted = walkTarget({ x, width: w, area, direction, distance, cursorX, maxDistance })
    // Si ferma prima di un altro companion, non gli passa sopra.
    const targetX = wanted === null ? null : blockedWalk(win.getBounds(), wanted, ctx.othersRects(c))
    if (targetX === null) { sendIdle(); return }
    const minX = Math.min(x, targetX)
    const maxX = Math.max(x, targetX)
    const dir   = targetX > x ? 1 : -1
    const speed = run ? RUN_SPEED : WALK_SPEED
    const step  = (speed * WALK_TICK_MS) / 1000
    send('companion-facing', { dir })
    let current = x
    walkTimer = setInterval(() => {
      if (!alive()) { stopWalk(); return }
      current += step * dir
      const done = dir > 0 ? current >= targetX : current <= targetX
      const next = done ? targetX : Math.round(current)
      try {
        moveTo(Math.max(minX, Math.min(maxX, next)), y)
      } catch (_) { stopWalk(); return }
      if (done) {
        stopWalk()
        sendIdle()
      }
    }, WALK_TICK_MS)
    if (walkTimer.unref) walkTimer.unref()
  }

  // ─── Gesti e vita a riposo ─────────────────────────────────────────────────
  // Quando nessuno scrive, idle-life.js decide ogni tick se fare un gesto. Qui
  // si raccolgono i segnali: da quanto non succede nulla, da quanto l'utente
  // non tocca il PC, se una risposta e' in arrivo.
  let gestureTimer = null
  let awaitingReply = false
  let asleep = false
  let lastActivityAt = Date.now()
  let lastGestureAt = 0
  let lastDragMoodAt = 0
  let requestedPoseUntil = 0
  let dancingNow = false

  /**
   * Un gesto, venga dalla chat o dalla vita a riposo. walk-to / run-to muovono
   * la finestra sul desktop, non solo lo sprite.
   * @param {any} action
   * @param {{ maxDistance?: number, direction?: string, distance?: string }} [motion]
   */
  function animate(action, motion = {}) {
    const { maxDistance = Infinity, direction, distance } = motion
    if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null }
    const walking = action.animation === 'walk-to' || action.animation === 'run-to'
    // Per camminare scende prima dal sedile, e parte una volta a terra.
    if (walking && perch && !drag) {
      leavePerch({ fall: true, then: () => animate(action, motion) })
      return
    }
    send('trigger-animation', action)
    if (walking && !drag) startWalk({ run: action.animation === 'run-to', direction, distance, maxDistance })
    else stopWalk()
  }

  /** Una posa chiesta dall'utente ("siediti") resta per un po'. */
  function holdPose(animation) {
    requestedPoseUntil = animation === 'sit' ? Date.now() + REQUESTED_POSE_MS : 0
  }

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
    if (!ctx.prefs.idleLife || awaitingReply || walkTimer || drag || perch || peek || dancingNow || highFiveActive || Date.now() < requestedPoseUntil) return
    if (!alive() || !win.isVisible()) return
    // Chi sta scrivendo nella chat non e' assente, anche senza aver inviato.
    const chat = ctx.chat()
    if (chat && chat.isFocused()) { markActivity(); return }
    const now = Date.now()
    const decision = decideIdle({
      quietMs: now - lastActivityAt,
      sinceGestureMs: now - lastGestureAt,
      systemIdleMs: powerMonitor.getSystemIdleTime() * 1000,
      asleep,
      mood: moodLib.decay(mood, now),
      hour: new Date(now).getHours(),
      bond: bond(),
    })
    if (!decision) return
    lastGestureAt = now
    if (decision.asleep !== undefined) asleep = decision.asleep
    // Il risveglio e' un ritorno dell'utente: i gesti ripartono dopo la quiete.
    if (decision.name === 'wake') lastActivityAt = now
    animate({ type: 'none', animation: decision.animation, bubble: decision.bubble, idle: true }, { maxDistance: IDLE_WALK_MAX_PX })
    if (decision.holdMs > 0) gestureTimer = setTimeout(() => { gestureTimer = null; sendIdle() }, decision.holdMs)
  }

  // ─── Movimenti generati (Kimodo) ───────────────────────────────────────────
  // Il modello descrive in action.motion un movimento che non e' fra le
  // animazioni; kimodo-service.js lo genera sulla scheda video. Il renderer
  // converte l'uscita in .vrma, la riproduce una volta e la rimanda al main
  // per la cache: la stessa frase, la volta dopo, parte subito.
  let motionJob = 0

  /** @param {string} prompt frase gia' ripulita da motionPrompt */
  async function requestGeneratedMotion(prompt) {
    if (!(await ctx.motionsEnabled(avatarId()))) return
    const kimodo = ctx.kimodo()
    const job = ++motionJob
    const key = kimodo.cached(prompt, MOTION_SECONDS)
    if (key) {
      send('generated-motion', { key, prompt, url: 'motion://generated/' + key, play: true })
      return
    }
    console.log('[kimodo] genero: ' + prompt)
    animate({ type: 'none', animation: 'think', bubble: 'Provo il movimento…' })
    const started = Date.now()
    try {
      const raw = await kimodo.generate(prompt, { seconds: MOTION_SECONDS })
      const fresh = ctx.expectMotion(prompt, MOTION_SECONDS)
      console.log('[kimodo] pronto in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s, ' + raw.frames + ' fotogrammi')
      // Una richiesta piu' recente ha la precedenza: questa va solo in cache.
      send('generated-motion', { key: fresh, prompt, rootPositions: raw.rootPositions, rotations: raw.rotations, play: job === motionJob })
    } catch (error) {
      console.error('[kimodo] generazione fallita: ' + error.message)
      if (job === motionJob) animate({ type: 'none', animation: 'idle', bubble: 'Questo movimento non mi riesce…' })
    }
  }

  // ─── Avatar, Live2D e chibi ────────────────────────────────────────────────
  // Il companion riporta l'avatar che ha caricato e se ha uno scheletro umano
  // (lo sa solo lui, per glTF e FBX); il main risponde se va in chibi.
  let live2dModel = null   // { id, name, groups, expressions }
  let avatarInfo = null    // { id, kind, humanoid }

  const avatarId = () => (persona() && persona().avatarModel) || ''

  function chibiState() {
    const reason = chibiUnavailable(avatarInfo)
    const on = !reason && ctx.loadConfig().chibiAvatars.includes(avatarInfo.id)
    return { available: !reason, reason, on }
  }

  function reportAvatar(info) {
    avatarInfo = info
    const state = chibiState()
    ctx.sendSettings('chibi-state', state)
    return { chibi: state.on }
  }

  function setChibi(on) {
    if (chibiUnavailable(avatarInfo)) return chibiState()
    const cfg = ctx.loadConfig()
    const others = cfg.chibiAvatars.filter(id => id !== avatarInfo.id)
    cfg.chibiAvatars = on ? [...others, avatarInfo.id].slice(-200) : others
    ctx.saveConfig(cfg)
    send('avatar-chibi', { id: avatarInfo.id, on })
    const state = chibiState()
    ctx.sendSettings('chibi-state', state)
    return state
  }

  // ─── Presa in braccio ──────────────────────────────────────────────────────
  // Alla Mate Engine: l'avatar si prende direttamente, non da una maniglia, e il
  // main muove la finestra seguendo il cursore. Cosi' si conosce la velocita',
  // che fa oscillare l'avatar (sway.js) e muove capelli e vestiti nel 3D.
  /** @type {{ offX: number, offY: number, x: number, y: number, t: number, vx: number, vy: number, timer: any } | null} */
  let drag = null

  function startDrag() {
    if (drag || viewMode === 'room' || !alive()) return
    // Ripreso in braccio scende dal sedile, senza cadere: lo tiene l'utente.
    // Se sbirciava smette, e la finestra resta dove l'ha presa.
    leavePerch()
    endPeek('drag', 'none')
    stopSlide()
    stopWalk()
    if (gestureTimer) { clearTimeout(gestureTimer); gestureTimer = null }
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    drag = { offX: cursor.x - x, offY: cursor.y - y, x, y, t: Date.now(), vx: 0, vy: 0, timer: null }
    onDragged()
    send('window-drag-state', { dragging: true })
    drag.timer = setInterval(dragTick, DRAG_TICK_MS)
  }

  function dragTick() {
    if (!drag) return
    if (!alive()) { endDrag(); return }
    const cursor = screen.getCursorScreenPoint()
    const x = cursor.x - drag.offX
    const y = cursor.y - drag.offY
    const now = Date.now()
    const dt = Math.max(1, now - drag.t) / 1000
    drag.vx = drag.vx * VELOCITY_SMOOTHING + ((x - drag.x) / dt) * (1 - VELOCITY_SMOOTHING)
    drag.vy = drag.vy * VELOCITY_SMOOTHING + ((y - drag.y) / dt) * (1 - VELOCITY_SMOOTHING)
    if (x !== drag.x || y !== drag.y) {
      try { moveTo(x, y) } catch (_) { endDrag(); return }
    }
    drag.x = x; drag.y = y; drag.t = now
    send('drag-motion', { vx: Math.round(drag.vx), vy: Math.round(drag.vy) })
  }

  function endDrag() {
    if (!drag) return
    clearInterval(drag.timer)
    drag = null
    send('drag-motion', { vx: 0, vy: 0 })
    send('window-drag-state', { dragging: false })
    // Posato con il punto di seduta sul bordo di una finestra si siede; oltre
    // meta' fuori da un bordo sbircia; se no, mezzo fuori dallo schermo o
    // dietro la taskbar si perderebbe.
    if (!tryPerch() && !tryPeek()) { keepOnScreen(); stepAside() }
    markActivity()
  }

  // ─── Sbirciare dal bordo (Blocco 5d) ───────────────────────────────────────
  // Lasciato oltre meta' fuori dal bordo sinistro o destro (edge-peek.js), resta
  // li' e sbircia: il renderer mette la posa e dice dove tagliare
  // (peek-geometry), e la finestra scivola finche' il taglio cade sul bordo.
  // Esce con il cursore vicino alla testa, con una risposta in arrivo o con un
  // doppio clic; ripreso in braccio smette e basta. Non sbircia sopra un'app a
  // schermo intero.
  /** @type {{ edge: import('./edge-peek').Edge, anchorX: number, cut: number | null, head: {x: number, y: number} | null, armed: boolean, placed: boolean, wait: any, timer: any } | null} */
  let peek = null
  let slideTimer = null

  function stopSlide() {
    if (slideTimer) { clearInterval(slideTimer); slideTimer = null }
  }

  /** Sposta la finestra con un'accelerazione morbida, in ms. */
  function slideTo(to, ms) {
    stopSlide()
    if (!alive()) return
    const [x0, y0] = win.getPosition()
    const t0 = Date.now()
    slideTimer = setInterval(() => {
      if (!alive()) { stopSlide(); return }
      const k = Math.min(1, (Date.now() - t0) / ms)
      const e = k * k * (3 - 2 * k)
      try { moveTo(x0 + (to.x - x0) * e, y0 + (to.y - y0) * e) } catch (_) { stopSlide(); return }
      if (k >= 1) stopSlide()
    }, DRAG_TICK_MS)
  }

  /** Un'app a schermo intero sul monitor del companion. */
  function fullscreenNow() {
    if (!winWindows.available() || !alive()) return false
    const id = screen.getDisplayMatching(win.getBounds()).id
    const display = displaysInfo().find(d => d.id === id)
    if (!display) return false
    const windows = winWindows.listWindows().map(w => ({ ...w, bounds: toDip(w.bounds) }))
    return edgePeek.fullscreenApp(windows, display, process.pid)
  }

  /** Al rilascio: oltre meta' fuori da un bordo esterno, sbircia. */
  function tryPeek() {
    if (viewMode === 'room' || !alive()) return false
    const bounds = win.getBounds()
    const anchorX = currentAnchor(0).x
    const displays = displaysInfo()
    const edge = edgePeek.edgeState(bounds, anchorX, displays)
    if (!edge) return false
    const display = displays.find(d => d.id === edge.displayId)
    if (winWindows.available() && display) {
      const windows = winWindows.listWindows().map(w => ({ ...w, bounds: toDip(w.bounds) }))
      if (edgePeek.fullscreenApp(windows, display, process.pid)) {
        console.log('[sbircia] app a schermo intero: torna dentro')
        return false
      }
    }
    console.log('[sbircia] dal bordo ' + (edge.side === 'left' ? 'sinistro' : 'destro'))
    stopWalk()
    peek = { edge, anchorX, cut: null, head: null, armed: false, placed: false, wait: null, timer: null }
    send('edge-peek', { side: edge.side })
    // La misura arriva dal renderer quando la posa si e' assestata; se tarda,
    // si taglia con il ripiego.
    peek.wait = setTimeout(() => placePeek(null), PEEK_GEOMETRY_WAIT_MS)
    return true
  }

  /** La finestra va al bordo, con il taglio misurato (o il ripiego). */
  function placePeek(geometry) {
    if (!peek || peek.placed || !alive()) return
    clearTimeout(peek.wait)
    peek.placed = true
    const bounds = win.getBounds()
    const pos = edgePeek.peekPosition(peek.edge, geometry ? geometry.cut : null, bounds, peek.anchorX)
    peek.cut = peek.edge.edgeX - pos.x
    // Senza misura la testa e' sopra il centro dell'avatar, in alto.
    peek.head = geometry ? geometry.head : { x: peek.anchorX, y: Math.round(bounds.height * 0.2) }
    slideTo(pos, PEEK_SLIDE_MS)
    peek.timer = setInterval(peekTick, PEEK_TICK_MS)
  }

  function peekGeometry(g) {
    if (!peek || !g || g.side !== peek.edge.side) return
    const [cut, x, y] = [Number(g.cut), Number(g.headX), Number(g.headY)]
    placePeek([cut, x, y].every(Number.isFinite) ? { cut, head: { x, y } } : null)
  }

  function peekTick() {
    if (!peek || drag || !peek.head) return
    if (!alive() || !win.isVisible()) return
    const b = win.getBounds()
    const spot = { x: b.x + peek.head.x, y: b.y + peek.head.y }
    const next = edgePeek.peekCursor(peek.armed, ctx.testCursor() || screen.getCursorScreenPoint(), spot)
    peek.armed = next.armed
    if (next.exit) endPeek('cursor')
  }

  /**
   * Smette di sbirciare. move: 'slide' esce scivolando dentro lo schermo,
   * 'jump' ci va subito (prima della stanza o di una camminata), 'none' resta
   * dov'e' (in braccio).
   * @param {string} reason cursor, message, dblclick, drag, walk, room, quit
   * @param {'slide' | 'jump' | 'none'} [move]
   */
  function endPeek(reason, move = 'slide') {
    if (!peek) return
    const edge = peek.edge
    clearTimeout(peek.wait)
    clearInterval(peek.timer)
    peek = null
    stopSlide()
    console.log('[sbircia] esce: ' + reason)
    send('edge-peek', { side: null, reason })
    if (move === 'none' || !alive()) return
    const to = edgePeek.outPosition(edge, win.getBounds())
    if (move === 'jump') moveTo(to.x, to.y)
    else slideTo(to, PEEK_OUT_MS)
    markActivity()
  }

  // ─── Seduta su finestre e taskbar ──────────────────────────────────────────
  // L'ancora e' l'ombra ai piedi: posato con l'ombra sul bordo alto di una
  // finestra, o sulla taskbar in basso, l'avatar ci sta in piedi, poi si siede
  // con le gambe a penzoloni e la segue. perch.js decide, qui ci sono il timer e
  // le chiamate a Windows (win-windows.js). Su una finestra non e' piu' "sempre
  // in primo piano": sta subito sopra di lei, e le finestre davanti lo coprono
  // come su una scrivania vera.
  /** @type {null | (import('./perch').Seat & { timer: any, ticks: number, landedAt: number, sitAt: number })} */
  let perch = null
  /**
   * Dove sono ombra e seduta dentro la finestra, dal renderer: x comune, feet
   * l'ombra ai piedi (dove atterra), seat il bacino (dove poggia seduto). Nel 2D
   * coincidono: lo sprite seduto poggia dove poggiava in piedi.
   * @type {{ x: number, feet: number, seat: number } | null}
   */
  let seatAnchor = null

  function setSeatAnchor(anchor) {
    seatAnchor = { x: Math.round(anchor.x), feet: Math.round(anchor.feet), seat: Math.round(anchor.seat) }
  }

  /** @param {number} [sit] 0 in piedi, 1 seduto: l'altezza va dall'ombra al bacino */
  function currentAnchor(sit = 0) {
    const [w, h] = win.getSize()
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

  /** Al rilascio: se l'ombra cade su un bordo, l'avatar si posa li'. */
  function tryPerch() {
    if (!ctx.prefs.perch || !winWindows.available() || !alive()) return false
    const b = win.getBounds()
    const anchor = currentAnchor(0)
    const shadow = { x: b.x + anchor.x, y: b.y + anchor.y }
    const displays = displaysInfo()
    const windows = winWindows.listWindows().map(w => ({ ...w, bounds: toDip(w.bounds) }))
    const seat = findWindowSeat(windows, shadow, { ownPid: process.pid, displays }) || findTaskbarSeat(shadow, displays)
    if (!seat) {
      console.log('[perch] nessun bordo sotto l\'ombra ' + shadow.x + ',' + shadow.y)
      return false
    }
    // Un posto e' di uno solo: se li' c'e' gia' un altro companion, niente.
    const seatWindow = seat.kind === 'window' && windows.find(w => w.hwnd === seat.hwnd)
    const seatDisplay = seat.kind === 'taskbar' && displays.find(d => d.id === seat.displayId)
    const edge = seatWindow ? { x: seatWindow.bounds.x, y: seatWindow.bounds.y, width: seatWindow.bounds.width } : seatDisplay ? taskbarEdge(seatDisplay) : null
    if (edge) {
      const pos = perchPosition(edge, seat.fraction, anchor)
      if (ctx.othersRects(c).some(o => overlaps({ ...pos, width: b.width, height: b.height }, o))) {
        console.log('[perch] posto gia\' occupato da un altro companion')
        return false
      }
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
    // Su una finestra, da qui in poi decide keepAboveSeat.
    if (seat.kind === 'window' && win.isAlwaysOnTop()) win.setAlwaysOnTop(false)
    send('perch-state', { perched: true, kind: seat.kind, phase: 'stand' })
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
    if (!alive()) { stopPerch(); return }
    const edge = perchEdge()
    if (!edge) { leavePerch({ fall: true }); return }
    const now = Date.now()
    // Dopo un momento in piedi si siede: la posa cambia nel renderer, e qui la
    // finestra scende finche' il bacino poggia sul bordo al posto dell'ombra.
    if (!perch.sitAt && now - perch.landedAt >= STAND_BEFORE_SIT_MS) {
      perch.sitAt = now
      send('perch-state', { perched: true, kind: perch.kind, phase: 'sit' })
    }
    const pos = perchPosition(edge, perch.fraction, currentAnchor(sitAmount(now)))
    const b = win.getBounds()
    if (pos.x !== b.x || pos.y !== b.y) {
      try { moveTo(pos.x, pos.y) } catch (_) { leavePerch(); return }
    }
    if (perch.kind === 'window') keepAboveSeat()
  }

  // La finestra attiva sta in cima alle finestre normali, e Windows non lascia
  // salire sopra di lei quella di un altro processo con HWND_TOP: cliccato il
  // sedile, le gambe a penzoloni sparivano dietro la sua barra del titolo.
  // Finche' il sedile e' la finestra attiva l'avatar torna "sempre in primo
  // piano"; attivata un'altra finestra, torna subito sopra il sedile e sotto
  // di lei. La finestra attiva si legge a ogni tick, l'ordine z ogni 3.
  function keepAboveSeat() {
    const seatActive = winWindows.foregroundWindow() === perch.hwnd
    if (win.isAlwaysOnTop() !== seatActive) {
      win.setAlwaysOnTop(seatActive, 'screen-saver')
      perch.ticks = 0
    }
    if (!seatActive && perch.ticks++ % PERCH_ZORDER_EVERY === 0) {
      winWindows.placeAbove(winWindows.handleOf(win.getNativeWindowHandle()), perch.hwnd, ownHandles())
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
    if (alive() && ctx.loadConfig().alwaysOnTop !== false && !win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    send('perch-state', { perched: false })
    if (fall) fallToGround(then)
    else if (then) then()
  }

  /** Scende fino al bordo basso dell'area di lavoro, accelerando. */
  function fallToGround(then) {
    if (!alive()) return
    const area = workArea()
    const b = win.getBounds()
    const x = Math.max(area.x, Math.min(b.x, area.x + area.width - b.width))
    const from = b.y
    const to = area.y + area.height - b.height
    const started = Date.now()
    const timer = setInterval(() => {
      // Ripreso in braccio o seduto di nuovo mentre cadeva: la caduta finisce li'.
      if (!alive() || drag || perch) { clearInterval(timer); return }
      const k = Math.min(1, (Date.now() - started) / FALL_MS)
      try { moveTo(x, from + (to - from) * k * k) } catch (_) { clearInterval(timer); return }
      if (k >= 1) {
        clearInterval(timer)
        if (then) then()
      }
    }, 16)
  }

  // ─── Modalita' stanza ──────────────────────────────────────────────────────
  // La stessa finestra del companion diventa una stanza: grande, con la scena,
  // la barra del titolo disegnata dalla pagina e la chat agganciata a destra.
  // Avatar, WebGL, umore e clip restano quelli. Le regole pure stanno in room.js.
  /** @type {'desktop' | 'room'} */
  let viewMode = 'desktop'
  /** Dove stava l'avatar sul desktop, per tornarci. */
  let desktopSpot = null
  /** @type {{ edge: string, start: Electron.Rectangle, cx: number, cy: number, timer: any } | null} */
  let roomResize = null
  /** Stanza prima di "Ingrandisci", per rimetterla com'era. */
  let roomRestore = null
  let roomSaveTimer = null
  /** Chat prima di agganciarla: dove stava sul desktop. */
  let chatDesktopBounds = null

  function isRoomWindow() {
    return viewMode === 'room' && alive()
  }

  /** Dice alla pagina la modalita' e quanto spazio a destra occupa la chat. */
  function sendViewMode() {
    const chat = ctx.chat()
    const chatShown = !!chat && chat.isVisible()
    send('view-mode', { mode: viewMode, chatInset: viewMode === 'room' && chatShown ? room.CHAT_INSET : 0, maximized: !!roomRestore })
  }

  function dockChat() {
    const chat = ctx.chat()
    if (!isRoomWindow() || !chat) return
    try { chat.setBounds(room.chatDock(win.getBounds())) } catch (_) {}
  }

  /** Salva la stanza poco dopo che si e' fermata: non a ogni pixel. */
  function saveRoomSoon() {
    clearTimeout(roomSaveTimer)
    roomSaveTimer = setTimeout(() => {
      if (!isRoomWindow() || roomRestore) return
      const cfg = ctx.loadConfig()
      cfg.roomBounds = win.getBounds()
      ctx.saveConfig(cfg)
    }, 600)
  }

  function onRoomMoved() {
    if (!isRoomWindow()) return
    dockChat()
    saveRoomSoon()
  }

  /** @param {'desktop' | 'room'} mode */
  function setView(mode) {
    if (!alive()) return
    if (mode === 'room') enterRoom()
    else leaveRoom()
    const cfg = ctx.loadConfig()
    if (cfg.view !== viewMode) { cfg.view = viewMode; ctx.saveConfig(cfg) }
    ctx.onViewChanged()
  }

  function enterRoom() {
    if (viewMode === 'room') return
    endDrag()
    leavePerch()
    // Tornando sul desktop riapparira' qui: dentro lo schermo, non mezzo fuori.
    endPeek('room', 'jump')
    stopSlide()
    stopWalk()
    desktopSpot = win.getBounds()
    viewMode = 'room'
    const area = screen.getDisplayMatching(desktopSpot).workArea
    const bounds = room.roomBounds(ctx.loadConfig().roomBounds, area)
    win.setIgnoreMouseEvents(false)
    win.setAlwaysOnTop(false)
    win.setSkipTaskbar(false)
    win.setMinimumSize(Math.min(room.ROOM_MIN.width, area.width), Math.min(room.ROOM_MIN.height, area.height))
    win.setBounds(bounds)
    win.show()
    win.focus()
    const chat = ctx.chat()
    if (chat) {
      chatDesktopBounds = chat.getBounds()
      // Figlia della stanza: le sta davanti, sparisce quando la stanza si
      // riduce a icona, e non e' piu' sopra le altre app.
      chat.setAlwaysOnTop(false)
      chat.setParentWindow(win)
      dockChat()
    }
    sendViewMode()
    ctx.refreshWeather()
    console.log('[stanza] aperta ' + bounds.width + 'x' + bounds.height)
  }

  function leaveRoom() {
    if (viewMode !== 'room') return
    endRoomResize()
    clearTimeout(roomSaveTimer)
    const cfg = ctx.loadConfig()
    if (!roomRestore) cfg.roomBounds = win.getBounds()
    cfg.view = 'desktop'
    ctx.saveConfig(cfg)
    roomRestore = null
    viewMode = 'desktop'
    const size = WINDOW_SCALES[cfg.scale]
    const spot = desktopSpot || win.getBounds()
    win.setMinimumSize(140, 200)
    win.setBounds({ x: spot.x, y: spot.y, width: size.width, height: size.height })
    win.setSkipTaskbar(true)
    win.setIgnoreMouseEvents(true, { forward: true })
    if (cfg.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')
    const chat = ctx.chat()
    if (chat) {
      chat.setParentWindow(null)
      chat.setAlwaysOnTop(true, 'screen-saver')
      const back = chatDesktopBounds || chat.getBounds()
      chat.setBounds({ x: back.x, y: back.y, ...CHAT_DESKTOP_SIZE })
    }
    keepOnScreen()
    sendViewMode()
    console.log('[stanza] chiusa, torna sul desktop')
  }

  /** "Ingrandisci" disegnato dalla pagina: una finestra trasparente di Windows non si massimizza da sola. */
  function toggleRoomMaximize() {
    if (!isRoomWindow()) return
    if (roomRestore) {
      win.setBounds(roomRestore)
      roomRestore = null
    } else {
      roomRestore = win.getBounds()
      win.setBounds(screen.getDisplayMatching(roomRestore).workArea)
    }
    dockChat()
    sendViewMode()
  }

  /** Un bordo della stanza preso dalla pagina: la finestra segue il cursore. */
  function startRoomResize(edge) {
    if (!isRoomWindow() || roomResize || !room.EDGES.includes(edge)) return
    const cursor = screen.getCursorScreenPoint()
    roomRestore = null
    roomResize = { edge, start: win.getBounds(), cx: cursor.x, cy: cursor.y, timer: null }
    roomResize.timer = setInterval(() => {
      if (!roomResize || !isRoomWindow()) { endRoomResize(); return }
      const p = screen.getCursorScreenPoint()
      const next = room.resizeBounds(roomResize.start, roomResize.edge, p.x - roomResize.cx, p.y - roomResize.cy)
      const b = win.getBounds()
      if (next.x !== b.x || next.y !== b.y || next.width !== b.width || next.height !== b.height) {
        win.setBounds(next)
        dockChat()
      }
    }, DRAG_TICK_MS)
  }

  function endRoomResize() {
    if (!roomResize) return
    clearInterval(roomResize.timer)
    roomResize = null
    saveRoomSoon()
    sendViewMode()
  }

  // ─── Cursore, dimensione, opzioni ──────────────────────────────────────────
  let lastCursorKey = ''
  /** Uno sguardo a un punto dello schermo (un altro companion), fino a until. */
  let glance = null

  function glanceAt(point, ms) {
    glance = { point, until: Date.now() + ms }
  }

  // Il cursore rispetto alla finestra, anche quando e' fuori: la pagina lo usa
  // per lo sguardo e per accorgersi che il mouse se n'e' andato. watch: un
  // punto da guardare al posto del mouse (chi sta parlando, Blocco 8d).
  function cursorTick(cursor, watch = null) {
    if (drag || !alive() || !win.isVisible()) return
    const b = win.getBounds()
    const target = watch || (glance && Date.now() < glance.until ? glance.point : null)
    const msg = target
      ? { x: target.x - b.x, y: target.y - b.y, follow: true }
      : { x: cursor.x - b.x, y: cursor.y - b.y, follow: ctx.prefs.followMouse }
    const key = msg.x + ',' + msg.y + ',' + msg.follow
    if (key === lastCursorKey) return
    lastCursorKey = key
    send('cursor', msg)
  }

  /** Ridimensiona tenendo fermi i piedi: centro in basso della finestra. */
  function applyScale(scale) {
    const size = WINDOW_SCALES[scale]
    if (!size || viewMode === 'room' || !alive()) return
    const b = win.getBounds()
    if (b.width === size.width && b.height === size.height) return
    win.setBounds({
      x: Math.round(b.x + (b.width - size.width) / 2),
      y: b.y + b.height - size.height,
      width: size.width, height: size.height,
    })
    // Seduto, la posizione la rimette perchTick con il punto di seduta nuovo.
    if (!perch) keepOnScreen()
  }

  /** Le opzioni della config che toccano la finestra (le preferenze le tiene ctx.prefs). */
  function applyWindowOptions(cfg) {
    if (!alive()) return
    if (!ctx.prefs.perch && perch) leavePerch({ fall: true })
    // Nella stanza la finestra e' una finestra normale: niente primo piano, e la
    // dimensione la sceglie chi la ridimensiona.
    if (viewMode === 'room') return
    // Seduto su una finestra sta sotto quelle davanti: "sempre in primo piano"
    // torna quando scende (leavePerch).
    const onTop = cfg.alwaysOnTop !== false && !(perch && perch.kind === 'window')
    if (win.isAlwaysOnTop() !== onTop) win.setAlwaysOnTop(onTop, 'screen-saver')
    applyScale(cfg.scale)
  }

  // ─── Menu col tasto destro ─────────────────────────────────────────────────
  async function showMenu() {
    if (!alive()) return
    const cfg = ctx.loadConfig()
    const avatarLibrary = ctx.avatarLibrary()
    let avatars = []
    try { avatars = avatarLibrary ? await avatarLibrary.list() : [] } catch (_) {}
    const mine = avatarId()
    const current = avatars.find(a => a.id === mine) || avatars.find(a => a.default) || avatars[0]
    const kind = (a) => a.kind === 'live2d' ? 'Live2D' : (a.kind === 'sprite-pack' || a.kind === 'sprite') ? '2D' : '3D'
    const command = (data) => send('menu-command', data)
    const is3D = !!current && kind(current) === '3D'
    const inRoom = viewMode === 'room'
    const chibi = chibiState()
    const kimodo = ctx.kimodo()
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const template = [
      { label: 'Apri chat', click: () => ctx.toggleChat() },
      // La stanza: finestra grande con la scena e la chat accanto (room.js).
      { label: 'Stanza', type: 'checkbox', checked: inRoom, click: (item) => setView(item.checked ? 'room' : 'desktop') },
      // Chi sta sul desktop, fino a 3 (Blocco 8b).
      ctx.companionsMenu(),
      { type: 'separator' },
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
        label: 'Animazioni',
        submenu: [
          { label: 'Importa animazione (VRMA, glTF, FBX, BVH)…', click: () => command({ cmd: 'import-animation' }) },
          { label: 'Apri la cartella delle animazioni', click: () => ctx.openAnimationsFolder() },
          { type: 'separator' },
          ...(is3D ? await ctx.previewMenu(command) : [{ label: 'Prova (solo con un avatar 3D)', enabled: false }]),
        ],
      },
      ...(inRoom ? [await ctx.sceneMenu(cfg, command)] : []),
      // Destro o centrale + trascina girano la camera, con Alt la spostano, la rotella zooma.
      ...(is3D || inRoom ? [{ label: 'Rimetti la camera', click: () => command({ cmd: 'camera-reset' }) }] : []),
      // Sul desktop: dimensione della finestra; nella stanza la sceglie chi la ridimensiona.
      ...(inRoom ? [] : [{
        label: 'Dimensione',
        submenu: Object.entries(WINDOW_SCALES).map(([id, size]) => ({
          label: size.label, type: /** @type {const} */ ('radio'), checked: cfg.scale === id,
          click: () => ctx.setOption({ scale: id }),
        })),
      }]),
      // Chibi, per questo avatar: solo i 3D con scheletro umano.
      chibi.available
        ? { label: 'Chibi', type: 'checkbox', checked: chibi.on, click: (item) => setChibi(item.checked) }
        : { label: 'Chibi (solo avatar 3D con scheletro umano)', enabled: false },
      { type: 'separator' },
      { label: 'Segue il mouse', type: 'checkbox', checked: cfg.followMouse, click: (item) => ctx.setOption({ followMouse: item.checked }) },
      { label: 'Vita autonoma', type: 'checkbox', checked: cfg.idleLife, click: (item) => ctx.setOption({ idleLife: item.checked }) },
      ...(inRoom ? [] : /** @type {Electron.MenuItemConstructorOptions[]} */ ([
        { label: 'Sempre in primo piano', type: 'checkbox', checked: cfg.alwaysOnTop, click: (item) => ctx.setOption({ alwaysOnTop: item.checked }) },
        winWindows.available()
          ? { label: 'Si siede su finestre e taskbar', type: 'checkbox', checked: cfg.perch, click: (item) => ctx.setOption({ perch: item.checked }) }
          : { label: 'Si siede su finestre e taskbar (non disponibile)', enabled: false },
      ])),
      kimodo && kimodo.available()
        ? { label: 'Movimenti nuovi con Kimodo', type: 'checkbox', checked: cfg.kimodo, click: (item) => ctx.setOption({ kimodo: item.checked }) }
        : { label: 'Movimenti nuovi con Kimodo (non installato)', enabled: false },
      { type: 'separator' },
      { label: 'Impostazioni…', click: () => ctx.openSettings() },
      { label: 'Nascondi (torna dall\'icona nella barra)', click: () => { if (alive()) win.hide() } },
      { label: 'Esci', click: () => ctx.quit() },
    ]
    Menu.buildFromTemplate(template).popup({ window: win })
  }

  // ─── Tocchi e batti cinque (Blocchi 5b e 5e) ───────────────────────────────
  // Il renderer dice zona e tipo, qui si decide la reazione (touch-react.js),
  // si sposta l'umore e torna cosa recitare. Al massimo un tocco ogni
  // TOUCH_MIN_MS: la pagina non e' fidata, e un ciclo di clic non deve poter
  // far correre l'umore.
  const touchState = touchReact.createTouchState()
  /** @type {Record<string, string>} */
  const touchLines = {}
  let lastTouch = null
  let lastTouchAt = 0
  let highFiveActive = false
  const highFiveState = touchReact.createHighFiveState()
  let lastHighFiveAt = 0

  /** Con la voce accesa la battuta si dice anche, se la voce e' libera. */
  function maybeSay(line, speaking) {
    if (touchReact.shouldSayLine(line, { voiceOn: ctx.voiceOn(), speaking, awaitingReply, listening: ctx.listening() })) ctx.speak(c, line)
  }

  function onTouch(input) {
    if (!ctx.prefs.touch) return { off: true }
    const touch = touchReact.checkTouch(input)
    const now = Date.now()
    if (!touch || now - lastTouchAt < TOUCH_MIN_MS) return null
    lastTouchAt = now
    const scale = bond()
    const result = touchState.onTouch(touch.zone, touch.kind, now, scale.patience)
    if (!result) return null
    const r = touchReact.scaleReaction(touchReact.REACTIONS[result.name], scale)
    updateMood(m => Object.entries(r.mood).reduce((acc, [name, delta]) => moodLib.nudge(acc, name, delta), moodLib.decay(m, now)))
    lastTouch = { name: result.name, zone: result.zone, kind: result.kind, at: now }
    const line = touchReact.pickLine(r.line, r.chance, touchLines)
    // Che stia gia' parlando lo sa la pagina (il main manda l'audio, non lo suona).
    maybeSay(line, input.speaking === true)
    return {
      name: result.name, step: result.step, zone: result.zone, kind: result.kind,
      slot: r.slot, expression: r.expression, weight: r.weight, ms: r.ms, line,
    }
  }

  // La pagina decide quando offrire la mano (touch.js, companion-highfive.js)
  // e lo dice qui: offer chiede il permesso (con i tocchi spenti no) e ferma la
  // vita autonoma finche' la mano e' alzata; slap e missed danno umore,
  // battuta e riga per il prompt.
  function onHighFive(input) {
    const event = input && input.event
    if (!touchReact.HIGHFIVE.EVENTS.includes(event)) return null
    if (event === 'offer') {
      if (!ctx.prefs.touch) return { off: true }
      highFiveActive = true
      markActivity()
      return { ok: true }
    }
    highFiveActive = false
    if (event === 'cancel') return { ok: true }
    const now = Date.now()
    if (now - lastHighFiveAt < TOUCH_MIN_MS) return null
    lastHighFiveAt = now
    const r = touchReact.scaleReaction(touchReact.highFiveReaction(event, event === 'slap' ? highFiveState.onSlap(now) : 1), bond())
    updateMood(m => Object.entries(r.mood).reduce((acc, [name, delta]) => moodLib.nudge(acc, name, delta), moodLib.decay(m, now)))
    lastTouch = { name: event === 'slap' ? 'highfive' : 'missed', zone: 'hand', kind: 'highfive', at: now }
    const line = touchReact.pickLine(r.line, r.chance, touchLines)
    maybeSay(line, input.speaking === true)
    return { slot: r.slot, expression: r.expression, weight: r.weight, ms: r.ms, line }
  }

  // ─── Cambio di persona (finche' c'e' un companion solo) ────────────────────
  /** Questo companion passa a un'altra persona: memoria, umore e avatar suoi. */
  async function setPersona(id) {
    await moodSave
    await rapportSave
    personaId = id
    initMemory()
    await initMood().catch(e => console.error('[mood] caricamento fallito:', e.message))
  }

  /** Chiude tutto quello che gira per conto suo. */
  function shutdown() {
    stopWalk()
    endDrag()
    endPeek('quit', 'none')
    stopSlide()
    stopPerch()
    if (memoryTimer) clearInterval(memoryTimer)
    if (gestureTimer) clearTimeout(gestureTimer)
    clearTimeout(spotTimer)
    if (alive() && viewMode === 'desktop') ctx.saveSpot(personaId, win.getBounds())
  }

  // defineProperties, non Object.assign: i getter devono restare getter
  // (Object.assign ne copierebbe il valore di adesso, cioe' null).
  Object.defineProperties(c, Object.getOwnPropertyDescriptors({
    get personaId() { return personaId },
    get slot() { return slot },
    get win() { return win },
    get bounds() { return alive() ? win.getBounds() : null },
    get perched() { return !!perch },
    get memory() { return memory },
    get viewMode() { return viewMode },
    get dragging() { return !!drag },
    get asleep() { return asleep },
    get busy() { return awaitingReply },
    set busy(v) { awaitingReply = !!v },
    get live2dModel() { return live2dModel },
    set live2dModel(m) { live2dModel = m },
    get dancing() { return dancingNow },
    set dancing(v) { dancingNow = !!v },
    alive, persona, avatarId, send,
    createWindow, initMemory, initMood, setPersona, shutdown, forget,
    updateMood, updateRapport, publicMood: publicMoodNow, broadcastMood, moodSaved: () => Promise.all([moodSave, rapportSave]),
    buildHistoryWithMemory, withMoodLine, maybeWriteDiary,
    animate, holdPose, markActivity, idleTick, sendIdle, requestGeneratedMotion, fullscreenNow,
    reportAvatar, chibiState, setChibi,
    startDrag, endDrag, peekGeometry, endPeek, tryPerch, tryPeek, keepOnScreen, moveTo, workArea, setSeatAnchor,
    peekState: () => peek && { side: peek.edge.side, edgeX: peek.edge.edgeX, cut: peek.cut, placed: peek.placed, armed: peek.armed, head: peek.head },
    setView, isRoomWindow, sendViewMode, dockChat, toggleRoomMaximize, startRoomResize, endRoomResize,
    cursorTick, glanceAt, applyWindowOptions, showMenu, onTouch, onHighFive,
  }))
  return c
}

module.exports = { createCompanion, displaysInfo, toDip }
