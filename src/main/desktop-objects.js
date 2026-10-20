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
    const e = { uid: nextUid++, obj, win, px, body, state: 'free', grab: null, task: null, spin: 0 }
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
    entries.delete(e.uid)
    if (alive(e)) e.win.destroy()
    ctx.onChange()
  }

  // ─── Presa e lancio con il mouse ───────────────────────────────────────────
  function grab(e) {
    if (!alive(e) || e.state === 'hidden') return
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
    e.grab = null
    if (alive(e) && ctx.alwaysOnTop()) e.win.setAlwaysOnTop(true, 'floating')
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

  function startFetch(e) {
    const c = nearestFree(P.landing(e.body, worldAt(e.body)).x)
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

  // ─── Il giro del cursore ───────────────────────────────────────────────────
  function taskTick(e, now) {
    const t = e.task
    const c = t.c
    if (!c.alive() || c.dragging || c.viewMode !== 'desktop' || !c.win.isVisible()) return abortTask(e)
    if (t.phase !== 'hug' && now - t.started > FETCH_MAX_MS) return abortTask(e)
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
        const r = P.step(e.body, dt, worldAt(e.body))
        e.body = r.body
        place(e)
        if (e.obj.type === 'throw' && Math.abs(e.body.spin - e.spin) > 0.01) {
          e.spin = e.body.spin
          try { e.win.webContents.send('object-pose', { spin: e.spin }) } catch (_) {}
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

  /** Per l'audit: dove sono e cosa fanno. */
  function state() {
    return [...entries.values()].map(e => ({
      uid: e.uid, id: e.obj.id, type: e.obj.type, px: e.px, state: e.state,
      x: Math.round(e.body.x), y: Math.round(e.body.y), vx: Math.round(e.body.vx), vy: Math.round(e.body.vy), resting: e.body.resting,
      task: e.task ? { phase: e.task.phase, personaId: e.task.c.personaId } : null,
      visible: alive(e) && e.win.isVisible(), bounds: alive(e) ? e.win.getBounds() : null,
    }))
  }

  return {
    spawn, store, storeAll, storeObject, grab, release, tick, info, bySender, updateObject, touched, state,
    get count() { return entries.size },
    get(uid) { return entries.get(uid) || null },
    MAX_ON_DESK,
  }
}

module.exports = { createDesktopObjects, MAX_ON_DESK }
