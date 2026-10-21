// live-chat.js — la chat di una live su Twitch (Blocco 11c), in funzioni pure.
//
// - parseIrc legge una riga dell'IRC di Twitch (con i tag IRCv3): messaggi,
//   eventi (abbonamenti, regali, raid), PING, RECONNECT;
// - classify e pickChatMessage scelgono a quale messaggio rispondere: chi
//   nomina un companion o usa il comando passa, con un tetto al minuto e
//   un'attesa per spettatore; bot, link, doppioni e messaggi lunghissimi no;
//   con tanti messaggi vanno prima i mod, chi scrive per la prima volta e le
//   domande, e i vecchi si scartano invece di accodarsi;
// - pickSpontaneous sceglie ogni tanto un messaggio della chat da commentare
//   anche se nessuno lo chiama;
// - foldEvents unisce i regali di abbonamenti a raffica in un ringraziamento.
// Il testo degli spettatori e' un dato da citare, mai un'istruzione: lo dice
// il prompt (11d).

const RULES = {
  MAX_CHARS: 300,
  QUEUE_MS: 45 * 1000,       // una menzione piu' vecchia di cosi' non ha piu' senso
  REPEAT_WINDOW: 30,         // doppioni: confrontati con gli ultimi 30 messaggi
  GIFT_FOLD_MS: 30 * 1000,   // i regali singoli dopo un "regala N abbonamenti" sono gli stessi
}

const STREAM_DEFAULTS = {
  channel: '',
  command: '!chiedi',
  perMinute: 4,
  userCooldownS: 60,
  spontaneousMin: 5,         // 0: spenti
  bots: ['nightbot', 'streamelements', 'moobot', 'streamlabs', 'fossabot', 'wizebot'],
}
const NAME_RE = /^[a-z0-9_]{1,25}$/

/** Il nome di un canale da quello che scrive l'utente: "#Nome", "twitch.tv/nome", un link. */
function cleanChannel(v) {
  const s = String(v || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/^twitch\.tv\//, '').replace(/^#/, '').replace(/[/?#].*$/, '')
  return /^[a-z0-9_]{3,25}$/.test(s) ? s : ''
}

/** Le impostazioni della live, controllate (config.stream). */
function streamConfig(cfg) {
  const s = cfg && cfg.stream && typeof cfg.stream === 'object' ? cfg.stream : {}
  const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : def)
  const command = typeof s.command === 'string' && /^![a-z0-9_]{1,20}$/i.test(s.command.trim()) ? s.command.trim().toLowerCase() : STREAM_DEFAULTS.command
  const spontaneous = num(s.spontaneousMin, 0, 15, STREAM_DEFAULTS.spontaneousMin)
  const bots = Array.isArray(s.bots) ? [...new Set(s.bots.map(b => String(b).trim().toLowerCase()).filter(b => NAME_RE.test(b)))].slice(0, 40) : STREAM_DEFAULTS.bots
  return {
    channel: cleanChannel(s.channel),
    command,
    perMinute: num(s.perMinute, 1, 10, STREAM_DEFAULTS.perMinute),
    userCooldownS: num(s.userCooldownS, 0, 600, STREAM_DEFAULTS.userCooldownS),
    spontaneousMin: spontaneous > 0 && spontaneous < 2 ? 2 : spontaneous,
    bots,
  }
}

/** Unisce le impostazioni nuove a quelle di prima: passa solo cio' che e' valido. */
function mergeStream(current, incoming) {
  const base = streamConfig({ stream: current })
  if (!incoming || typeof incoming !== 'object') return base
  const merged = { ...base }
  if ('channel' in incoming) merged.channel = cleanChannel(incoming.channel)
  for (const k of ['command', 'perMinute', 'userCooldownS', 'spontaneousMin', 'bots']) if (k in incoming) merged[k] = incoming[k]
  return streamConfig({ stream: merged })
}

// ─── IRC ─────────────────────────────────────────────────────────────────────

const unescapeTag = (v) => String(v || '').replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' }[c] || c))

/**
 * Una riga dell'IRC di Twitch.
 * @param {string} line
 * @returns {{ type: 'ping', arg: string } | { type: 'reconnect' } | { type: 'joined', channel: string } |
 *   { type: 'message', id: string, login: string, user: string, text: string, mod: boolean, sub: boolean, first: boolean, broadcaster: boolean } |
 *   { type: 'event', kind: string, user: string, count: number, recipient: string, text: string } |
 *   { type: 'notice', text: string } | { type: 'other', command: string } | null}
 */
function parseIrc(line) {
  let rest = String(line || '').replace(/\r?\n$/, '')
  if (!rest) return null
  const tags = {}
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ')
    for (const kv of rest.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=')
      if (eq === -1) tags[kv] = ''
      else tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1))
    }
    rest = rest.slice(sp + 1)
  }
  let prefix = ''
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ')
    prefix = rest.slice(1, sp)
    rest = rest.slice(sp + 1)
  }
  const colon = rest.indexOf(' :')
  const trailing = colon === -1 ? '' : rest.slice(colon + 2)
  const params = (colon === -1 ? rest : rest.slice(0, colon)).split(' ').filter(Boolean)
  const command = (params.shift() || '').toUpperCase()
  const login = prefix.includes('!') ? prefix.slice(0, prefix.indexOf('!')).toLowerCase() : ''

  if (command === 'PING') return { type: 'ping', arg: trailing || params[0] || 'tmi.twitch.tv' }
  if (command === 'RECONNECT') return { type: 'reconnect' }
  if (command === 'ROOMSTATE') return { type: 'joined', channel: String(params[0] || '').replace(/^#/, '') }
  if (command === 'NOTICE') return { type: 'notice', text: trailing }
  if (command === 'PRIVMSG') {
    let text = trailing
    // /me: \x01ACTION testo\x01
    const action = text.match(/^\x01ACTION (.*)\x01$/)
    if (action) text = action[1]
    const badges = String(tags.badges || '')
    return {
      type: 'message',
      id: tags.id || '',
      login,
      user: tags['display-name'] || login,
      text,
      mod: tags.mod === '1' || /(^|,)(moderator|broadcaster)\//.test(badges),
      sub: tags.subscriber === '1',
      first: tags['first-msg'] === '1',
      broadcaster: /(^|,)broadcaster\//.test(badges),
    }
  }
  if (command === 'USERNOTICE') {
    const kind = tags['msg-id'] || ''
    if (!['sub', 'resub', 'subgift', 'submysterygift', 'raid'].includes(kind)) return { type: 'other', command }
    const count = Number(kind === 'raid' ? tags['msg-param-viewerCount'] : kind === 'submysterygift' ? tags['msg-param-mass-gift-count'] : kind === 'resub' ? tags['msg-param-cumulative-months'] : 1) || 1
    return {
      type: 'event', kind,
      user: tags['display-name'] || tags.login || login,
      count,
      recipient: tags['msg-param-recipient-display-name'] || '',
      text: trailing,
    }
  }
  return { type: 'other', command }
}

// ─── Quale messaggio ─────────────────────────────────────────────────────────

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const onlyLinks = (t) => /^(\s*(https?:\/\/|www\.)\S+\s*)+$/i.test(t)

/**
 * Chi nomina il messaggio: l'id del companion il cui nome compare come parola
 * (anche con @), 'command' se comincia con il comando, o null.
 * @param {string} text
 * @param {{ id: string, name: string }[]} names
 * @param {string} command
 */
function addressedTo(text, names, command) {
  const t = fold(text)
  for (const n of names) {
    const name = fold(n.name)
    if (name.length >= 2 && new RegExp('(^|[^a-z0-9])@?' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t)) return n.id
  }
  if (command && (t === command || t.startsWith(command + ' '))) return 'command'
  return null
}

/**
 * Che cosa fare di un messaggio appena arrivato.
 * @returns {{ verdict: 'bot'|'link'|'lungo'|'doppione'|'vuoto'|'menzione'|'chat', to: string|null }}
 */
function classify(msg, rules, recentTexts) {
  if (!msg || !msg.text || !msg.text.trim()) return { verdict: 'vuoto', to: null }
  if (rules.bots.includes(msg.login)) return { verdict: 'bot', to: null }
  if (onlyLinks(msg.text)) return { verdict: 'link', to: null }
  if (msg.text.length > RULES.MAX_CHARS) return { verdict: 'lungo', to: null }
  if (recentTexts.includes(fold(msg.text))) return { verdict: 'doppione', to: null }
  const to = addressedTo(msg.text, rules.names, rules.command)
  return to ? { verdict: 'menzione', to } : { verdict: 'chat', to: null }
}

/** Quanto conta un messaggio quando ce ne sono tanti: mod, prima volta, domande. */
const priority = (m) => (m.mod ? 4 : 0) + (m.first ? 2 : 0) + (/\?\s*$|\?/.test(m.text) ? 1 : 0)

/**
 * A quale menzione rispondere adesso. queue: le menzioni in attesa (con at).
 * memory: answeredAt (ore delle risposte, per il tetto al minuto) e
 * lastByUser (login -> ora dell'ultima risposta). Restituisce la scelta (o
 * null: tetto raggiunto, o niente) e quelle da scartare con il motivo; il
 * resto resta in coda.
 * @returns {{ pick: any, discarded: { msg: any, reason: string }[], queue: any[] }}
 */
function pickChatMessage(queue, rules, memory, now) {
  const discarded = []
  let waiting = []
  for (const m of queue) {
    if (now - m.at > RULES.QUEUE_MS) discarded.push({ msg: m, reason: 'troppi messaggi, era vecchio' })
    else if (rules.userCooldownS > 0 && now - (memory.lastByUser[m.login] || -Infinity) < rules.userCooldownS * 1000) discarded.push({ msg: m, reason: 'gli ha risposto da poco' })
    else waiting.push(m)
  }
  const lastMinute = memory.answeredAt.filter(t => now - t < 60 * 1000).length
  if (!waiting.length || lastMinute >= rules.perMinute) return { pick: null, discarded, queue: waiting }
  waiting = [...waiting].sort((a, b) => priority(b) - priority(a) || a.at - b.at)
  const pick = waiting[0]
  // Dello stesso spettatore ne passa uno: gli altri suoi aspettano l'attesa.
  return { pick, discarded, queue: waiting.slice(1).sort((a, b) => a.at - b.at) }
}

/**
 * Ogni tanto un commento a un messaggio della chat che nessuno ha rivolto ai
 * companion: ogni everyMin minuti, solo se dall'ultimo commento la chat ha
 * scritto. Prima le domande, poi i messaggi con piu' parole.
 * @param {any[]} chat messaggi 'chat' recenti (con at)
 */
function pickSpontaneous(chat, lastAt, now, everyMin) {
  if (!everyMin || now - lastAt < everyMin * 60 * 1000) return null
  const fresh = chat.filter(m => m.at > lastAt && now - m.at < 2 * 60 * 1000)
  if (!fresh.length) return null
  const words = (m) => m.text.trim().split(/\s+/).length
  return [...fresh].sort((a, b) => (/\?/.test(b.text) - /\?/.test(a.text)) || words(b) - words(a) || b.at - a.at)[0]
}

/**
 * Gli eventi da ringraziare: un "regala N abbonamenti" assorbe i regali
 * singoli dello stesso spettatore che seguono (Twitch li manda uno per uno).
 * @param {any[]} events con at
 */
function foldEvents(events) {
  const out = []
  for (const ev of events) {
    const mass = out.find(o => o.kind === 'submysterygift' && o.user === ev.user && ev.at - o.at < RULES.GIFT_FOLD_MS)
    if (ev.kind === 'subgift' && mass) continue
    out.push(ev)
  }
  return out
}

module.exports = {
  RULES, STREAM_DEFAULTS, streamConfig, mergeStream, cleanChannel,
  parseIrc, addressedTo, classify, pickChatMessage, pickSpontaneous, foldEvents, fold,
}
