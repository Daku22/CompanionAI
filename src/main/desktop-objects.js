// desktop-objects.js — gli oggetti della borsa sul desktop (Blocco 10c).
//
// Ogni oggetto vive in una finestrella trasparente (object.html) e qui si
// muove: la fisica di physics.js a ogni giro del cursore (33 ms), la presa e
// il lancio con il mouse, e quello che ci fanno i companion:
// - Da lanciare: lanciato forte, il companion libero piu' vicino lo insegue,
//   lo raccoglie (clip "pickup") e lo riporta vicino al mouse;
// - Da abbracciare: lasciato su un companion, lo tiene in braccio (clip "hug")
//   e ci sonnecchia; dopo un po', o con un clic su di lui, lo posa;
// - Cibo e Bevanda: lasciati su un companion, li mangia (feed);
// - Decorazione: resta dove la lasci, senza gravita'.
// Un 3D con lo scheletro tiene l'oggetto nella scena (companion-prop) e la
// finestrella si nasconde; un 2D o un Live2D se la porta dietro accanto a se'.
// Gli oggetti sono di tutti: chi insegue lo decide la distanza, uno alla volta.
//
// Pallavolo (Blocco 10d), con gli oggetti Da lanciare: un clic sul pallone
// fermo lo manda al companion piu' vicino, che gli corre sotto e lo ribatte
// verso il mouse (clip "volley"); tu lo ribatti cliccandolo in aria. Con piu'
// companion se lo passano anche fra loro. Si contano i palleggi (il numero sul
// pallone); quando tocca terra la partita finisce, e il record e' per persona.
//
// Da solo (Blocco 10e): annoiato, il companion va al giocattolo piu' vicino e
// lo calcia e lo insegue, o palleggia per conto suo (se lo colpisci tu, la
// partita diventa vostra). Dalla chat: "giochiamo a palla" (lo tira fuori se
// non c'e' e te lo lancia), "prendi il gomitolo" (lo insegue e te lo riporta).

const { BrowserWindow, screen } = require('electron')
const path = require('path')
const P = require('./physics')
const Objects = require('./objects')
const moodLib = require('./mood')
const winWindows = require('./win-windows')

const MAX_ON_DESK = 5
const PX_PER_M = 1.25 / 1.6     // per l'altezza della finestra del companion: un po' piu' grandi del vero, per prenderli
const MIN_PX = 36
const MAX_PX = 220
const THROW_SPEED = 400         // px/s: sotto e' posato, non lanciato
const FETCH_SPEED = 240         // px/s: la corsa dietro al pallone
const CARRY_SPEED = 90          // px/s: il ritorno, a passo svelto
const PICK_AT_MS = 1100         // nella clip "pickup", quando la mano arriva a terra
const PICKUP_MS = 2600
const STUCK_MS = 1500           // fermo senza camminare (una risposta in chat l'ha interrotto): si riparte
const FETCH_MAX_MS = 30000
const HUG_MS = 20000
const DOZE_MS = 8000
const THANKS = ['Eccola!', 'Ecco qua!', 'Presa!', 'Di nuovo?']
const VOLLEY = {
  FLIGHT_MIN: 0.95,       // s: un passaggio corto
  FLIGHT_MAX: 1.6,        // s: uno lungo, da una parte all'altra dello schermo
  FLIGHT_PER_PX: 1 / 1600,
  SWING_EARLY: 0.6,       // s prima del pallone parte la clip (le mani arrivano su in 0,6 s)
  CLICK_PX: 8,            // un clic, non un trascinamento
  CLICK_MS: 350,
  PASS_CHANCE: 0.5,       // con un altro companion in gioco, quante volte lo passa a lui
  USER_FLOOR_GAP: 170,    // px: verso il mouse arriva almeno cosi' in alto, per avere il tempo di cliccare
  COUNT_MS: 2500,         // il numero resta sul pallone dopo la fine
  ENERGY_PER_HIT: 0.01,
}
const SOLO = {
  KICKS: [1, 3],          // quante volte lo calcia e lo rincorre
  KICK_VX: [550, 900],    // px/s
  KICK_VY: -380,
  JUGGLES: [3, 8],        // palleggi da solo prima di lasciarlo cadere
  WALL_GAP: 300,          // px: piu' vicino a un muro, calcia dall'altra parte
}
const randIn = ([a, b]) => a + Math.random() * (b - a)

const pick = (list) => list[Math.floor(Math.random() * list.length)]
const centerOf = (c) => c.bounds.x + c.bounds.width / 2

/**
 * @param {{ companions: () => any[], companionAt: (p: {x: number, y: number}) => any,
 *   cursor: () => {x: number, y: number}, windowHeight: () => number, alwaysOnTop: () => boolean,
 *   preload: string, page: string, onChange: () => void }} ctx
 */
function createDesktopObjects(ctx) {
  /** @type {Map<number, any>} */
  const entries = new Map()
  let nextUid = 1
  let lastTick = Date.now()

  const alive = (e) => e.win && !e.win.isDestroyed()
  const sizePx = (obj) => Math.round(Math.max(MIN_PX, Math.min(MAX_PX, obj.size * ctx.windowHeight() * PX_PER_M)))
  const worldAt = (b) => P.worldOf(screen.getDisplayNearestPoint({ x: Math.round(b.x), y: Math.round(b.y) }).workArea)

  /** Dentro l'area di lavoro dello schermo su cui sta. */
  function clampBody(b) {
    const w = worldAt(b)
    return { ...b, x: Math.max(w.left + b.r, Math.min(w.right - b.r, b.x)), y: Math.max(w.top + b.r, Math.min(w.floor - b.r, b.y)) }
  }

  function place(e) {
    if (!alive(e)) return
    const b = e.body
    try { e.win.setBounds({ x: Math.round(b.x - e.px / 2), y: Math.round(b.y - e.px / 2), width: e.px, height: e.px }) } catch (_) {}
  }

  /** I companion davanti agli oggetti (le decorazioni restano dietro di loro). */
  function raiseCompanions() {
    for (const c of ctx.companions()) if (c.alive() && c.viewMode === 'desktop' && c.win.isVisible()) c.win.moveTop()
  }

  // ─── Sul desktop e nella borsa ─────────────────────────────────────────────
  /**
   * Mette un oggetto sul desktop, centrato in point. Oltre MAX_ON_DESK il piu'
   * vecchio libero torna nella borsa.
   */
  function spawn(obj, point, { vx = 0, vy = 0 } = {}) {
    if (entries.size >= MAX_ON_DESK) {
      const oldest = [...entries.values()].find(e => !e.task && e.state === 'free')
      if (!oldest) return null
      store(oldest)
    }
    const px = sizePx(obj)
    let body = P.createBody({ x: point.x, y: point.y, r: px / 2, bounce: obj.bounce, vx, vy })
    body = clampBody(body)
    if (obj.type === 'decor') body = { ...body, vx: 0, vy: 0, resting: true }
    const top = ctx.alwaysOnTop()
    const win = new BrowserWindow({
      width: px, height: px, x: Math.round(body.x - px / 2), y: Math.round(body.y - px / 2),
      transparent: true, frame: false, alwaysOnTop: top, skipTaskbar: true, resizable: false,
      focusable: false, hasShadow: false, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: ctx.preload },
    })
    if (top) win.setAlwaysOnTop(true, 'floating')
    const e = { uid: nextUid++, obj, win, px, body, state: 'free', grab: null, task: null, spin: 0, game: null }
    entries.set(e.uid, e)
    win.loadFile(ctx.page)
    win.once('ready-to-show', () => {
      if (!alive(e) || e.state === 'hidden') return
      win.showInactive()
      if (obj.type === 'decor') raiseCompanions()
    })
    win.on('closed', () => {
      if (e.task) abortTask(e)
      entries.delete(e.uid)
      ctx.onChange()
    })
    ctx.onChange()
    return e
  }

  /** Torna nella borsa (doppio clic, "Riponi tutti", o un oggetto eliminato). */
  function store(e) {
    if (e.task) abortTask(e)
    if (e.game) endGame(e, { quiet: true })
    entries.delete(e.uid)
    if (alive(e)) e.win.destroy()
    ctx.onChange()
  }

  // ─── Presa e lancio con il mouse ───────────────────────────────────────────
  function grab(e) {
    if (!alive(e) || e.state === 'hidden') return
    // In partita, un clic sul pallone in aria lo ribatte.
    if (e.game && !e.body.resting) { userHit(e); return }
    if (e.task) abortTask(e)
    const cursor = ctx.cursor()
    e.state = 'drag'
    e.grab = { offX: cursor.x - e.body.x, offY: cursor.y - e.body.y, started: Date.now(), trail: [{ x: cursor.x, y: cursor.y, t: Date.now() }] }
    e.body = { ...e.body, vx: 0, vy: 0, resting: false }
    e.win.setAlwaysOnTop(ctx.alwaysOnTop(), 'screen-saver')
    e.win.moveTop()
  }

  /**
   * Lasciato in point con velocita' v: su un companion lo abbraccia o lo
   * mangia; altrove cade (o resta, se e' una decorazione); lanciato forte, il
   * pallone lo va a prendere qualcuno.
   */
  function release(e, point, v = { vx: 0, vy: 0 }) {
    e.state = 'free'
    e.grabbed = e.grab
    e.grab = null
    if (alive(e) && ctx.alwaysOnTop()) e.win.setAlwaysOnTop(true, 'floating')
    // Un clic (non un trascinamento) sul pallone: la battuta.
    if (e.obj.type === 'throw' && isClick(e.grabbed)) return serve(e) ? 'serve' : 'dropped'
    const c = point && ctx.companionAt(point)
    if (c && e.obj.type === 'hug' && hug(e, c)) return 'hug'
    if (c && (e.obj.type === 'food' || e.obj.type === 'drink') && c.feed(Objects.asFood(e.obj))) { store(e); return 'eaten' }
    if (e.obj.type === 'decor') {
      e.body = { ...clampBody(e.body), vx: 0, vy: 0, resting: true }
      place(e)
      raiseCompanions()
      return 'placed'
    }
    e.body = P.push(clampBody(e.body), v.vx, v.vy)
    raiseCompanions()
    if (e.obj.type === 'throw' && Math.hypot(v.vx, v.vy) >= THROW_SPEED) return startFetch(e) ? 'fetch' : 'thrown'
    return 'dropped'
  }

  // ─── Inseguire, raccogliere, riportare ─────────────────────────────────────
  /** Il companion libero piu' vicino a x, o null. */
  function nearestFree(x) {
    const free = ctx.companions().filter(c => c.canPlay())
    free.sort((a, b) => Math.abs(centerOf(a) - x) - Math.abs(centerOf(b) - x))
    return free[0] || null
  }

  function startFetch(e, who = null) {
    const c = who && who.canPlay() ? who : who ? null : nearestFree(P.landing(e.body, worldAt(e.body)).x)
    if (!c) return false
    c.playing = e
    e.task = { c, phase: 'chase', tries: 0, at: Date.now(), started: Date.now(), picked: false }
    chase(e)
    return true
  }

  /** Corre dove il pallone si fermera', con la mano verso di lui. */
  function chase(e) {
    const t = e.task
    const target = e.body.resting ? e.body.x : P.landing(e.body, worldAt(e.body)).x
    const side = target > centerOf(t.c) ? 1 : -1
    t.phase = 'chase'
    t.at = Date.now()
    if (!t.c.goTo(target - side * t.c.bounds.width * 0.2, { run: true, speed: FETCH_SPEED, then: () => { if (e.task === t) t.phase = 'arrived' } })) abortTask(e)
  }

  /** Arrivato: se il pallone e' li' e a terra lo raccoglie, se e' altrove riparte, se e' in aria aspetta. */
  function arrived(e, now) {
    const t = e.task
    const c = t.c
    const w = worldAt(e.body)
    const onFloor = e.body.y + e.body.r >= w.floor - 2
    const near = Math.abs(e.body.x - centerOf(c)) <= c.bounds.width * 0.45 + e.body.r
    if (near && onFloor && (e.body.resting || Math.abs(e.body.vx) < 200)) return pickup(e, now)
    if (!onFloor && near) return // in aria sopra di lui: aspetta che scenda
    if (++t.tries > 8) return abortTask(e)
    chase(e)
  }

  function pickup(e, now) {
    const t = e.task
    t.phase = 'pickup'
    t.at = now
    e.body = { ...e.body, vx: 0, vy: 0, resting: true }
    t.c.send('companion-facing', { dir: e.body.x >= centerOf(t.c) ? 1 : -1 })
    t.c.animate({ type: 'none', animation: 'pickup' })
  }

  /** In mano: un 3D lo tiene nella scena, gli altri se lo portano accanto. */
  function take(e, at, ms) {
    const c = e.task.c
    if (c.holdsProps) {
      e.state = 'hidden'
      if (alive(e)) e.win.hide()
      c.send('companion-prop', { url: e.obj.url, format: e.obj.format, textures: e.obj.textures || [], size: e.obj.size, at, ms })
    } else {
      e.state = 'held'
      e.task.at2 = at
      if (alive(e)) e.win.moveTop()
    }
  }

  /** Dove tiene l'oggetto: davanti alla mano ('hand') o al petto ('arms'). */
  function holdPoint(c, at) {
    const b = c.bounds
    if (at === 'arms') return { x: centerOf(c), y: b.y + b.height * 0.5 }
    return { x: centerOf(c) + c.facing * b.width * 0.18, y: b.y + b.height * 0.58 }
  }

  /** Lo riporta: cammina verso il mouse e si ferma un po' prima. */
  function carry(e, now) {
    const t = e.task
    const c = t.c
    t.phase = 'carry'
    t.at = now
    const cursor = ctx.cursor()
    const cx = centerOf(c)
    const side = cursor.x > cx ? 1 : -1
    const dest = cursor.x - side * (c.bounds.width * 0.6 + 20)
    if (Math.abs(dest - cx) < 40 || !c.goTo(dest, { speed: CARRY_SPEED, then: () => { if (e.task === t) deliver(e) } })) deliver(e)
  }

  /** Posa l'oggetto davanti a se' e torna libero. */
  function letGo(e, at, push = { vx: 0, vy: 0 }) {
    const t = e.task
    const c = t.c
    e.task = null
    c.playing = null
    const p = c.alive() && c.bounds ? holdPoint(c, at) : { x: e.body.x, y: e.body.y }
    if (c.alive()) {
      c.send('companion-prop', null)
      if (!c.dragging) c.animate({ type: 'none', animation: 'idle' })
    }
    e.state = 'free'
    e.body = P.push(clampBody({ ...e.body, x: p.x, y: p.y }), push.vx, push.vy)
    place(e)
    if (alive(e) && !e.win.isVisible()) e.win.showInactive()
    raiseCompanions()
    ctx.onChange()
  }

  function deliver(e) {
    const c = e.task.c
    letGo(e, 'arms', { vx: c.facing * 120, vy: -150 })
    if (!c.alive()) return
    c.send('companion-bubble', { text: pick(THANKS), ms: 2500 })
    const now = Date.now()
    c.updateMood(m => moodLib.nudge(moodLib.decay(m, now), 'joy', 0.04))
    c.markActivity()
  }

  function abortTask(e) {
    if (!e.task) return
    if (e.task.solo) return endSolo(e)
    letGo(e, 'arms')
  }

  // ─── Abbracciare ───────────────────────────────────────────────────────────
  function hug(e, c) {
    if (!c.canPlay()) return false
    const now = Date.now()
    c.playing = e
    e.task = { c, phase: 'hug', at: now, dozed: false }
    e.body = { ...e.body, vx: 0, vy: 0, resting: true }
    c.markActivity()
    c.animate({ type: 'none', animation: 'hug', bubble: 'Che morbido…' })
    take(e, 'arms', HUG_MS + 3000)
    c.updateMood(m => moodLib.nudge(moodLib.nudge(moodLib.decay(m, now), 'affection', 0.03), 'joy', 0.03))
    ctx.onChange()
    return true
  }

  /** Un clic sul companion mentre abbraccia: lo posa. true se l'ha posato. */
  function touched(c) {
    const e = [...entries.values()].find(x => x.task && x.task.c === c && x.task.phase === 'hug')
    if (!e) return false
    letGo(e, 'arms')
    return true
  }

  // ─── Pallavolo (Blocco 10d) ────────────────────────────────────────────────
  /** Una presa breve e quasi ferma. */
  function isClick(g) {
    if (!g || g.trail.length < 1) return false
    const a = g.trail[0]
    const b = g.trail[g.trail.length - 1]
    return Date.now() - g.started <= VOLLEY.CLICK_MS && Math.hypot(b.x - a.x, b.y - a.y) <= VOLLEY.CLICK_PX
  }

  const flight = (from, to) => Math.max(VOLLEY.FLIGHT_MIN, Math.min(VOLLEY.FLIGHT_MAX, VOLLEY.FLIGHT_MIN + Math.abs(to.x - from.x) * VOLLEY.FLIGHT_PER_PX))
  /** Dove il companion prende il pallone: sopra la testa, al centro della finestra. */
  const hitPoint = (c) => ({ x: centerOf(c), y: c.bounds.y + c.bounds.height * 0.1 })
  const inGame = (e, c) => !!e.game && e.game.players.has(c)
  /** Chi puo' giocare: libero, o gia' in questa partita. */
  const canJoin = (e, c) => c.alive() && c.bounds && (c.canPlay() || (inGame(e, c) && !c.dragging && c.viewMode === 'desktop' && c.win.isVisible()))

  function sendPose(e, extra = {}) {
    // Fuori partita il conto non si tocca: il totale resta COUNT_MS, poi lo toglie endGame.
    try { if (alive(e)) e.win.webContents.send('object-pose', { spin: e.spin, ...(e.game ? { count: e.game.hits } : {}), ...extra }) } catch (_) {}
  }

  /** La battuta: un clic sul pallone fermo lo manda al companion piu' vicino. */
  function serve(e) {
    if (e.game || e.task) return false
    const c = ctx.companions().filter(x => canJoin(e, x)).sort((a, b) => Math.abs(centerOf(a) - e.body.x) - Math.abs(centerOf(b) - e.body.x))[0]
    if (!c) return false
    e.game = { hits: 0, by: new Map(), players: new Set(), target: null, plan: null, started: Date.now() }
    if (alive(e)) { e.win.setAlwaysOnTop(ctx.alwaysOnTop(), 'screen-saver'); e.win.moveTop() }
    sendTo(e, c)
    return true
  }

  /** Il pallone verso il companion c: lui va dove scendera' all'altezza delle mani. */
  function sendTo(e, c) {
    const g = e.game
    const to = hitPoint(c)
    const from = { x: e.body.x, y: Math.min(e.body.y, worldAt(e.body).floor - e.body.r - 2) }
    const v = P.aim(from, to, flight(from, to))
    e.body = P.push({ ...e.body, ...from }, v.vx, v.vy)
    if (!g.players.has(c)) { g.players.add(c); c.playing = e }
    g.target = c
    const cross = P.crossing(e.body, worldAt(e.body), to.y)
    g.plan = { c, y: to.y, swung: false }
    if (cross && Math.abs(cross.x - centerOf(c)) > 12) c.goTo(cross.x, { run: true, speed: FETCH_SPEED })
  }

  /** Il pallone verso il mouse, abbastanza in alto da poterlo cliccare. */
  function sendToUser(e) {
    const g = e.game
    const w = worldAt(e.body)
    const cursor = ctx.cursor()
    const to = { x: Math.max(w.left + e.body.r, Math.min(w.right - e.body.r, cursor.x)), y: Math.min(cursor.y, w.floor - VOLLEY.USER_FLOOR_GAP) }
    const from = { x: e.body.x, y: e.body.y }
    const v = P.aim(from, to, flight(from, to))
    e.body = P.push(e.body, v.vx, v.vy)
    g.target = 'user'
    g.plan = null
  }

  /** Il companion ribatte: a un altro companion in gioco, o a te. */
  function companionHit(e, c) {
    const g = e.game
    g.hits++
    g.by.set(c, (g.by.get(c) || 0) + 1)
    const now = Date.now()
    c.updateMood(m => { const d = moodLib.decay(m, now); return { ...d, energy: Math.max(0, d.energy - VOLLEY.ENERGY_PER_HIT) } })
    c.markActivity()
    // Da solo: qualche palleggio sulla testa, poi lo lascia andare di lato.
    if (g.solo) {
      if (g.hits < g.maxHits) sendTo(e, c)
      else {
        e.body = P.push(e.body, (Math.random() < 0.5 ? -1 : 1) * 250, -350)
        g.plan = null
        g.target = null
      }
      sendPose(e)
      return
    }
    const others = ctx.companions().filter(x => x !== c && canJoin(e, x))
    if (others.length && Math.random() < VOLLEY.PASS_CHANCE) sendTo(e, others[Math.floor(Math.random() * others.length)])
    else sendToUser(e)
    sendPose(e)
  }

  /** Tu lo ribatti: al companion piu' vicino al pallone. */
  function userHit(e) {
    const g = e.game
    // Palleggiava da solo e ti sei unito: ora e' una partita vera.
    g.solo = false
    const c = ctx.companions().filter(x => canJoin(e, x)).sort((a, b) => Math.abs(centerOf(a) - e.body.x) - Math.abs(centerOf(b) - e.body.x))[0]
    if (!c) return
    g.hits++
    sendTo(e, c)
    sendPose(e)
  }

  /**
   * Fine partita: il record per ognuno che ha giocato, e la reazione (felice,
   * dispiaciuto se e' caduto subito, entusiasta per un record).
   */
  function endGame(e, { quiet = false } = {}) {
    const g = e.game
    if (!g) return
    e.game = null
    if (alive(e) && ctx.alwaysOnTop()) e.win.setAlwaysOnTop(true, 'floating')
    const results = []
    for (const c of g.players) {
      c.playing = null
      if (!c.alive() || quiet) continue
      // Da solo niente record: quello e' delle partite con te.
      if (g.solo) { c.animate({ type: 'none', animation: 'idle' }); continue }
      const r = c.endVolley(g.hits, g.by.get(c) || 0)
      results.push({ personaId: c.personaId, ...r })
      const now = Date.now()
      if (r.record) {
        c.updateMood(m => moodLib.nudge(moodLib.decay(m, now), 'joy', 0.1))
        c.animate({ type: 'none', animation: 'happy', bubble: 'Nuovo record: ' + g.hits + ' palleggi!' })
      } else if (g.hits < 3) {
        c.animate({ type: 'none', animation: 'idle', bubble: 'Oh no, gia\' finita…' })
      } else {
        c.animate({ type: 'none', animation: 'happy', bubble: 'Bella partita! ' + g.hits + ' palleggi.' })
      }
    }
    lastGame = { hits: g.hits, results, solo: !!g.solo }
    sendPose(e, { count: g.hits })
    setTimeout(() => { if (!e.game) sendPose(e, { count: null }) }, VOLLEY.COUNT_MS)
    raiseCompanions()
  }

  /** A ogni giro: il companion di turno alza le mani in tempo e ribatte. */
  function gameTick(e, hitFloor) {
    const g = e.game
    if (hitFloor) return endGame(e)
    const p = g.plan
    if (!p || !p.c.alive() || !p.c.bounds) return
    const c = p.c
    if (!canJoin(e, c)) return
    const b = e.body
    if (!p.swung && b.vy > 0) {
      const cross = P.crossing(b, worldAt(b), p.y, { maxS: 2 })
      if (cross && cross.t <= VOLLEY.SWING_EARLY) {
        p.swung = true
        c.send('companion-facing', { dir: b.x >= centerOf(c) ? 1 : -1 })
        c.animate({ type: 'none', animation: 'volley' })
      }
    }
    const reach = c.bounds.width * 0.5 + b.r
    if (b.vy > 0 && b.y >= p.y - b.r * 0.5 && b.y <= p.y + c.bounds.height * 0.35 && Math.abs(b.x - centerOf(c)) <= reach) companionHit(e, c)
  }

  // ─── Gioca da solo, e dalla chat (Blocco 10e) ──────────────────────────────
  // 'free' esclude gia' quelli nascosti in mano; appena creato, la finestra
  // non e' ancora visibile (aspetta la pagina) ma il giocattolo c'e' gia'.
  const freeToy = (e) => alive(e) && e.obj.type === 'throw' && e.state === 'free' && !e.task && !e.game
  /** C'e' un oggetto Da lanciare libero sul desktop (la vita a riposo puo' giocarci). */
  const hasToy = () => [...entries.values()].some(freeToy)

  /**
   * Il companion va al giocattolo piu' vicino (o a entry) e ci gioca: lo
   * calcia e lo insegue ('kick'), palleggia da solo ('juggle'), o te lo lancia
   * ('toss', dalla chat). Restituisce il modo, o null se ora non puo'.
   */
  function playAlone(c, { mode, entry } = {}) {
    if (!c.canPlay()) return null
    const e = entry || [...entries.values()].filter(freeToy).sort((a, b) => Math.abs(a.body.x - centerOf(c)) - Math.abs(b.body.x - centerOf(c)))[0]
    if (!e || !freeToy(e)) return null
    const m = mode || (Math.random() < 0.5 ? 'kick' : 'juggle')
    c.playing = e
    e.task = { c, solo: true, mode: m, phase: 'approach', at: Date.now(), started: Date.now(), kicks: Math.round(randIn(SOLO.KICKS)) }
    approach(e)
    return m
  }

  /** Corre al giocattolo, fermandosi accanto. */
  function approach(e) {
    const t = e.task
    const c = t.c
    const side = e.body.x >= centerOf(c) ? 1 : -1
    t.phase = 'approach'
    t.at = Date.now()
    if (!c.goTo(e.body.x - side * c.bounds.width * 0.25, { run: true, speed: FETCH_SPEED, then: () => { if (e.task === t) t.phase = 'reached' } })) endSolo(e)
  }

  function endSolo(e) {
    const t = e.task
    if (!t) return
    e.task = null
    t.c.playing = null
    if (t.c.alive() && !t.c.dragging) t.c.animate({ type: 'none', animation: 'idle' })
  }

  function soloTick(e, now) {
    const t = e.task
    const c = t.c
    if ((t.phase === 'approach' || t.phase === 'chase-kick') && !c.walking && now - t.at > STUCK_MS) t.phase = 'reached'
    if (t.phase !== 'reached') return
    const near = Math.abs(e.body.x - centerOf(c)) <= c.bounds.width * 0.6 + e.body.r
    if (!near) return approach(e)
    if (!e.body.resting && Math.abs(e.body.vx) > 200) return   // gli sta ancora rotolando accanto
    if (t.mode === 'kick') {
      if (t.kicks-- <= 0) return endSolo(e)
      const w = worldAt(e.body)
      let d = e.body.x >= centerOf(c) ? 1 : -1
      if ((d > 0 ? w.right - e.body.x : e.body.x - w.left) < SOLO.WALL_GAP) d = -d
      c.send('companion-facing', { dir: d })
      c.animate({ type: 'none', animation: 'hop' })
      e.body = P.push(e.body, d * randIn(SOLO.KICK_VX), SOLO.KICK_VY)
      t.phase = 'chase-kick'
      t.at = now
      const land = P.landing(e.body, w).x
      c.goTo(land - d * c.bounds.width * 0.25, { run: true, speed: FETCH_SPEED, then: () => { if (e.task === t) t.phase = 'reached' } })
      return
    }
    // Palleggio da solo, o il lancio verso di te: diventa una partita.
    const toss = t.mode === 'toss'
    e.task = null
    e.game = { hits: 0, by: new Map(), players: new Set([c]), target: null, plan: null, started: now, solo: !toss, maxHits: Math.round(randIn(SOLO.JUGGLES)) }
    if (alive(e)) { e.win.setAlwaysOnTop(ctx.alwaysOnTop(), 'screen-saver'); e.win.moveTop() }
    c.animate({ type: 'none', animation: 'volley' })
    if (toss) sendToUser(e)
    else sendTo(e, c)
    sendPose(e)
  }

  /** Dalla chat, "giochiamo a palla": lo tira fuori se non c'e' e te lo lancia. */
  function playWith(c, obj) {
    if (!c.canPlay() || !obj || obj.type !== 'throw') return false
    let e = [...entries.values()].find(x => x.obj.id === obj.id && freeToy(x))
    if (!e) {
      const b = c.bounds
      e = spawn(obj, { x: centerOf(c) + c.facing * b.width * 0.3, y: b.y + b.height })
    }
    return !!(e && playAlone(c, { mode: 'toss', entry: e }))
  }

  /** Dalla chat, "prendi il gomitolo": se non c'e' lo fa rotolare lontano, poi lo insegue e te lo riporta. */
  function fetchFor(c, obj) {
    if (!c.canPlay() || !obj || obj.type !== 'throw') return false
    let e = [...entries.values()].find(x => x.obj.id === obj.id && freeToy(x))
    if (!e) {
      const w = P.worldOf(c.workArea())
      const cx = centerOf(c)
      const d = w.right - cx > cx - w.left ? 1 : -1
      e = spawn(obj, { x: cx + d * c.bounds.width * 0.5, y: c.bounds.y + c.bounds.height * 0.5 }, { vx: d * 900, vy: -500 })
    }
    return !!(e && startFetch(e, c))
  }

  // ─── Il giro del cursore ───────────────────────────────────────────────────
  function taskTick(e, now) {
    const t = e.task
    const c = t.c
    if (!c.alive() || c.dragging || c.viewMode !== 'desktop' || !c.win.isVisible()) return abortTask(e)
    if (t.phase !== 'hug' && now - t.started > FETCH_MAX_MS) return abortTask(e)
    if (t.solo) return soloTick(e, now)
    if (t.phase === 'chase' && !c.walking && now - t.at > STUCK_MS) t.phase = 'arrived'
    if (t.phase === 'arrived') return arrived(e, now)
    if (t.phase === 'pickup') {
      // Fra le due mani: nella destra, camminando, usciva dalla finestra del companion.
      if (!t.picked && now - t.at >= PICK_AT_MS) { t.picked = true; take(e, 'arms', FETCH_MAX_MS) }
      if (now - t.at >= PICKUP_MS) carry(e, now)
    } else if (t.phase === 'carry') {
      if (!c.walking && now - t.at > STUCK_MS) deliver(e)
    } else if (t.phase === 'hug') {
      if (!t.dozed && now - t.at > DOZE_MS) { t.dozed = true; c.send('companion-bubble', { text: 'Zzz…', ms: 4000 }) }
      if (now - t.at > HUG_MS) letGo(e, 'arms')
    }
  }

  function tick(cursor) {
    const now = Date.now()
    const dt = Math.min(0.25, (now - lastTick) / 1000)
    lastTick = now
    for (const e of [...entries.values()]) {
      if (!alive(e)) continue
      if (e.state === 'drag') {
        e.body = { ...e.body, x: cursor.x - e.grab.offX, y: cursor.y - e.grab.offY }
        e.grab.trail.push({ x: cursor.x, y: cursor.y, t: now })
        if (e.grab.trail.length > 12) e.grab.trail.shift()
        place(e)
        const up = winWindows.available() && now - e.grab.started > 120 && !winWindows.isKeyDown(0x01)
        if (up || now - e.grab.started > 60000) release(e, cursor, P.throwVelocity(e.grab.trail))
        continue
      }
      if (e.task) taskTick(e, now)
      if (!e.task && (e.state === 'held' || e.state === 'hidden')) e.state = 'free'
      if (e.state === 'held' && e.task) {
        const p = holdPoint(e.task.c, e.task.at2)
        e.body = { ...e.body, x: p.x, y: p.y }
        place(e)
      } else if (e.state === 'free' && !e.body.resting) {
        const w = worldAt(e.body)
        const r = P.step(e.body, dt, w)
        e.body = r.body
        place(e)
        if (e.game) gameTick(e, r.hit && e.body.y + e.body.r >= w.floor - 0.5)
        if (e.obj.type === 'throw' && Math.abs(e.body.spin - e.spin) > 0.01) {
          e.spin = e.body.spin
          sendPose(e)
        }
      }
    }
  }

  // ─── Per il main ───────────────────────────────────────────────────────────
  const bySender = (sender) => [...entries.values()].find(e => alive(e) && e.win.webContents === sender) || null

  /** Cosa caricare nella finestrella che lo chiede. */
  function info(sender) {
    const e = bySender(sender)
    if (!e) return null
    return { url: e.obj.url, format: e.obj.format || 'gltf', textures: e.obj.textures || [], name: e.obj.name, roll: e.obj.type === 'throw' }
  }

  /** Cambiati tipo, nome o misura di un oggetto: quelli sul desktop si adeguano. */
  function updateObject(obj) {
    for (const e of entries.values()) {
      if (e.obj.id !== obj.id) continue
      if (e.task) abortTask(e)
      e.obj = obj
      e.px = sizePx(obj)
      e.body = clampBody({ ...e.body, r: e.px / 2, bounce: obj.bounce, resting: obj.type === 'decor' })
      place(e)
      if (alive(e)) e.win.webContents.send('object-info', {})
    }
  }

  function storeObject(id) { for (const e of [...entries.values()]) if (e.obj.id === id) store(e) }
  function storeAll() { for (const e of [...entries.values()]) store(e) }

  let lastGame = null
  /** Per l'audit: dove sono e cosa fanno, e com'e' finita l'ultima partita. */
  function state() {
    return [...entries.values()].map(e => ({
      game: e.game ? { hits: e.game.hits, solo: !!e.game.solo, target: e.game.target === 'user' ? 'user' : e.game.target && e.game.target.personaId } : null,
      uid: e.uid, id: e.obj.id, type: e.obj.type, px: e.px, state: e.state,
      x: Math.round(e.body.x), y: Math.round(e.body.y), vx: Math.round(e.body.vx), vy: Math.round(e.body.vy), resting: e.body.resting,
      task: e.task ? { phase: e.task.phase, personaId: e.task.c.personaId, mode: e.task.mode } : null,
      visible: alive(e) && e.win.isVisible(), bounds: alive(e) ? e.win.getBounds() : null,
    }))
  }
  /** Per l'audit: la battuta e il colpo al volo, senza mouse vero. */
  function testServe(e) { return serve(e) }
  function testHit(e) { if (e.game && !e.body.resting) { userHit(e); return true } return false }

  return {
    spawn, store, storeAll, storeObject, grab, release, tick, info, bySender, updateObject, touched, state, testServe, testHit,
    hasToy, playAlone, playWith, fetchFor,
    get lastGame() { return lastGame },
    get count() { return entries.size },
    get(uid) { return entries.get(uid) || null },
    MAX_ON_DESK,
  }
}

module.exports = { createDesktopObjects, MAX_ON_DESK }
