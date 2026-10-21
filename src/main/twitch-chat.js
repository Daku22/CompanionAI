// twitch-chat.js — il collegamento alla chat di Twitch (Blocco 11c), solo in
// lettura: IRC su WebSocket come "justinfan<numero>", l'utente anonimo che
// Twitch ammette per leggere. Nessun account, nessun token, niente si scrive.
//
// Le righe le legge parseIrc (live-chat.js). Qui: PING/PONG, RECONNECT,
// riconnessione con attesa crescente (2 s, 4 s, ... fino a 60 s), e un
// controllo del silenzio: senza niente per 6 minuti (Twitch manda un PING
// ogni 5) si riapre. Lo stato si vede nella pagina Streaming.

const { parseIrc } = require('./live-chat')

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const IDLE_MS = 6 * 60 * 1000
const JOIN_WAIT_MS = 10 * 1000
const RETRY_MAX_MS = 60 * 1000

// TWITCH_IRC_URL serve solo alle prove con un server finto, ed e' accettato
// solo su questo PC.
function ircUrl() {
  const o = process.env.TWITCH_IRC_URL
  return o && /^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(o) ? o : IRC_URL
}

class TwitchChat {
  /**
   * @param {{ onLine: (m: any) => void, onStatus?: (s: any) => void, WebSocketImpl?: any }} opts
   *   onLine: ogni riga letta (messaggi, eventi); onStatus: { state, channel, retryIn, note }
   *   state: 'off' | 'connecting' | 'connected' | 'retry'
   */
  constructor({ onLine, onStatus, WebSocketImpl }) {
    this.onLine = onLine
    this.onStatus = onStatus || (() => {})
    this.WebSocketImpl = WebSocketImpl || globalThis.WebSocket
    this.ws = null
    this.wanted = false
    this.channel = ''
    this.attempt = 0
    this.timers = { retry: null, idle: null, join: null }
    this.status = { state: 'off', channel: '', retryIn: 0, note: '' }
  }

  start(channel) {
    this.stop()
    this.channel = channel
    this.wanted = true
    this.attempt = 0
    this._open()
  }

  stop() {
    this.wanted = false
    this._clearTimers()
    const ws = this.ws
    this.ws = null
    if (ws) try { ws.close() } catch (_) { /* gia' chiuso */ }
    this._status('off')
  }

  _clearTimers() {
    for (const k of Object.keys(this.timers)) { clearTimeout(this.timers[k]); this.timers[k] = null }
  }

  _open() {
    this._status('connecting', 0, 'Mi collego a Twitch…')
    let ws
    try { ws = new this.WebSocketImpl(ircUrl()) } catch (e) { this._retry(undefined, 'Collegamento non riuscito: ' + e.message); return }
    this.ws = ws
    const nick = 'justinfan' + (10000 + Math.floor(Math.random() * 89999))
    ws.onopen = () => {
      if (this.ws !== ws) return
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send('NICK ' + nick)
      ws.send('JOIN #' + this.channel)
      this._status('connecting', 0, 'Collegato, entro nel canale…')
      this._kick()
      clearTimeout(this.timers.join)
      this.timers.join = setTimeout(() => {
        if (this.ws === ws && this.status.state === 'connecting') this._status('connecting', 0, 'Il canale non risponde: controlla il nome.')
      }, JOIN_WAIT_MS)
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws) return
      this._kick()
      for (const line of String(event.data).split('\r\n')) {
        const m = parseIrc(line)
        if (!m) continue
        if (m.type === 'ping') { try { ws.send('PONG :' + m.arg) } catch (_) {} continue }
        if (m.type === 'reconnect') { this._retry(0, 'Twitch chiede di ricollegarsi…'); return }
        if (m.type === 'joined') {
          this.attempt = 0
          clearTimeout(this.timers.join)
          this._status('connected', 0, '')
        }
        try { this.onLine(m) } catch (e) { console.error('[twitch] riga non gestita:', e.message) }
      }
    }
    ws.onclose = () => { if (this.ws === ws && this.wanted) this._retry(undefined, 'Collegamento perso.') }
    ws.onerror = () => { /* segue onclose */ }
  }

  /** Riprova dopo un'attesa che cresce (2, 4, 8 … 60 s); delay 0: subito. */
  _retry(delay, note = '') {
    if (!this.wanted) return
    const ws = this.ws
    this.ws = null
    if (ws) try { ws.close() } catch (_) {}
    this._clearTimers()
    const wait = delay != null ? delay : Math.min(RETRY_MAX_MS, 2000 * 2 ** this.attempt++)
    this._status('retry', wait, note)
    this.timers.retry = setTimeout(() => { if (this.wanted) this._open() }, wait)
  }

  _kick() {
    clearTimeout(this.timers.idle)
    this.timers.idle = setTimeout(() => this._retry(0, 'Nessuna notizia da Twitch da 6 minuti: mi ricollego.'), IDLE_MS)
  }

  _status(state, retryMs = 0, note = '') {
    this.status = { state, channel: this.channel, retryIn: Math.round(retryMs / 1000), note }
    try { this.onStatus(this.status) } catch (_) {}
  }
}

module.exports = { TwitchChat, ircUrl, IRC_URL }
