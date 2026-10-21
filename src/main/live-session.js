// live-session.js — una live su Twitch (Blocco 11c): fra il collegamento
// (twitch-chat.js) e i companion che rispondono (11d).
//
// Accesa con "In diretta", si collega al canale e smista ogni riga: i
// messaggi da scartare (bot, link, doppioni, troppo lunghi) finiscono nel
// registro con il motivo; le menzioni di un companion e il comando aspettano
// in coda; il resto della chat resta per i commenti spontanei; gli eventi
// (abbonamenti, regali, raid) si ringraziano. Ogni secondo, se nessuno sta
// gia' rispondendo, sceglie la cosa successiva (pickChatMessage, foldEvents,
// pickSpontaneous) e la passa a respond. Spenta, restituisce il riassunto
// della live (per il diario, 11d).

const L = require('./live-chat')
const { TwitchChat } = require('./twitch-chat')

const LOG_MAX = 100
const CHAT_KEEP = 50
const REASONS = { bot: 'un bot', link: 'solo link', lungo: 'troppo lungo', doppione: 'un doppione', vuoto: 'vuoto' }

/** Una riga del registro per un evento: "regala 5 abbonamenti", "raid con 42 spettatori". */
function describeEvent(ev) {
  if (ev.kind === 'raid') return 'raid con ' + ev.count + ' spettatori'
  if (ev.kind === 'submysterygift') return 'regala ' + ev.count + ' abbonament' + (ev.count === 1 ? 'o' : 'i')
  if (ev.kind === 'subgift') return 'regala un abbonamento' + (ev.recipient ? ' a ' + ev.recipient : '')
  if (ev.kind === 'resub') return 'rinnova l\'abbonamento (' + ev.count + ' mesi)'
  return 'si abbona'
}

/**
 * @param {{ config: () => ReturnType<typeof L.streamConfig>, names: () => { id: string, name: string }[],
 *   respond?: ((item: any) => Promise<{ ok: boolean, by?: string, reply?: string, reason?: string } | boolean>) | null,
 *   onState?: (state: any) => void, Client?: any, now?: () => number, tickMs?: number }} ctx
 */
function createLiveSession(ctx) {
  const now = ctx.now || Date.now
  const Client = ctx.Client || TwitchChat
  let s = fresh()

  function fresh() {
    return {
      on: false, client: null, timer: null, busy: false, startedAt: 0,
      mentions: [], chat: [], events: [], recent: [],
      memory: { answeredAt: [], lastByUser: {} },
      lastSpontaneousAt: 0,
      status: { state: 'off', channel: '', retryIn: 0, note: '' },
      counts: { received: 0, answered: 0, discarded: 0, events: 0 },
      log: [], answered: [], eventsSeen: [],
    }
  }

  const state = () => ({ on: s.on, status: s.status, counts: { ...s.counts }, startedAt: s.startedAt, log: s.log.slice(0, 60) })
  const emit = () => { if (ctx.onState) try { ctx.onState(state()) } catch (_) {} }

  function log(entry) {
    s.log.unshift({ at: now(), ...entry })
    if (s.log.length > LOG_MAX) s.log.length = LOG_MAX
    emit()
  }

  function onLine(m) {
    if (!s.on) return
    if (m.type === 'message') {
      s.counts.received++
      const cfg = ctx.config()
      const { verdict, to } = L.classify(m, { ...cfg, names: ctx.names() }, s.recent)
      s.recent.push(L.fold(m.text))
      if (s.recent.length > L.RULES.REPEAT_WINDOW) s.recent.shift()
      if (REASONS[verdict]) {
        s.counts.discarded++
        log({ user: m.user, text: m.text.slice(0, 160), outcome: 'scartato', reason: REASONS[verdict] })
      } else if (verdict === 'menzione') {
        s.mentions.push({ ...m, at: now(), to })
        emit()
      } else {
        s.chat.push({ ...m, at: now() })
        if (s.chat.length > CHAT_KEEP) s.chat.shift()
      }
    } else if (m.type === 'event') {
      s.counts.events++
      s.events.push({ ...m, at: now() })
      log({ user: m.user, text: describeEvent(m), outcome: 'evento' })
    }
  }

  /** La cosa successiva: una menzione, un evento da ringraziare, o un commento spontaneo. */
  function next(t) {
    const cfg = ctx.config()
    const r = L.pickChatMessage(s.mentions, { ...cfg, names: ctx.names() }, s.memory, t)
    s.mentions = r.queue
    for (const d of r.discarded) {
      s.counts.discarded++
      log({ user: d.msg.user, text: d.msg.text.slice(0, 160), outcome: 'scartato', reason: d.reason })
    }
    if (r.pick) return { kind: 'mention', msg: r.pick, to: r.pick.to }
    if (s.events.length) {
      const [first, ...rest] = L.foldEvents(s.events)
      s.events = rest
      return { kind: 'event', event: first }
    }
    const sp = L.pickSpontaneous(s.chat, s.lastSpontaneousAt || s.startedAt, t, cfg.spontaneousMin)
    if (sp) { s.lastSpontaneousAt = t; return { kind: 'spontaneous', msg: sp, to: null } }
    return null
  }

  async function tick() {
    if (!s.on || s.busy) return
    const t = now()
    const item = next(t)
    if (!item) return
    const mine = s
    mine.busy = true
    if (item.kind === 'mention') {
      mine.memory.answeredAt = mine.memory.answeredAt.filter(x => t - x < 60 * 1000).concat(t)
      mine.memory.lastByUser[item.msg.login] = t
    }
    /** @type {{ ok: boolean, by?: string, reply?: string, reason?: string }} */
    let result = { ok: true, by: '' }
    try {
      if (ctx.respond) {
        const r = await ctx.respond(item)
        result = typeof r === 'object' && r ? r : { ok: !!r, by: '' }
      }
    } catch (e) { result = { ok: false, by: '', reason: 'errore' }; console.error('[live] risposta non riuscita:', e.message) }
    mine.busy = false
    if (mine !== s) return
    const who = item.event ? item.event.user : item.msg.user
    const text = item.event ? describeEvent(item.event) : item.msg.text.slice(0, 160)
    if (result.ok) {
      s.counts.answered++
      s.answered.push({ at: t, kind: item.kind, user: who, text, by: result.by || '', reply: String(result.reply || '').slice(0, 400) })
      if (s.answered.length > 200) s.answered.shift()
    }
    log({
      user: who, text, by: result.by || '',
      outcome: !result.ok ? 'non riuscito' : ctx.respond ? 'risposto' : 'scelto',
      reason: !result.ok && result.reason ? result.reason : item.kind === 'spontaneous' ? 'commento spontaneo' : item.kind === 'event' ? 'ringraziamento' : '',
    })
  }

  return {
    /** Accende la live: si collega al canale delle impostazioni. */
    start() {
      if (s.on) return { ok: true, state: state() }
      const cfg = ctx.config()
      if (!cfg.channel) return { ok: false, error: 'Scrivi il nome del canale.', state: state() }
      s = fresh()
      s.on = true
      s.startedAt = now()
      s.client = new Client({ onLine, onStatus: (st) => { s.status = st; emit() } })
      s.client.start(cfg.channel)
      s.timer = setInterval(() => { tick().catch(() => {}) }, ctx.tickMs || 1000)
      if (s.timer.unref) s.timer.unref()
      log({ user: '', text: 'In diretta su #' + cfg.channel, outcome: 'inizio' })
      return { ok: true, state: state() }
    },
    /**
     * Spegne la live. Il riassunto: quando, quanti messaggi, eventi e a chi
     * hanno risposto (per il paragrafo nel diario, 11d). null se era spenta.
     */
    stop() {
      if (!s.on) return null
      const ended = s
      ended.on = false
      clearInterval(ended.timer)
      if (ended.client) ended.client.stop()
      const summary = {
        startedAt: ended.startedAt, endedAt: now(), channel: ended.status.channel,
        counts: { ...ended.counts }, answered: ended.answered.slice(),
        events: ended.log.filter(e => e.outcome === 'evento').map(e => ({ user: e.user, text: e.text })),
      }
      log({ user: '', text: 'Fine della diretta', outcome: 'fine' })
      return summary
    },
    state,
    /** Per i test: una riga come se arrivasse da Twitch, e un passo subito. */
    _line: onLine,
    _tick: tick,
  }
}

module.exports = { createLiveSession, describeEvent }
