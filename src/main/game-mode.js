// game-mode.js — la modalita' gioco (Blocco 12): il companion guarda la
// finestra del gioco e commenta la partita. Funzioni pure, con test.
//
// 12a: cosa guardare (una finestra scelta nella pagina Visione, o tutto lo
// schermo del companion) e con quale modello.
// 12b: quando guardare. Ogni 5 s un'impronta minuscola della scena (grigi
// 32x18), che non chiama nessun modello; il modello si chiama solo se la
// scena e' cambiata, e' passato l'intervallo e il tetto all'ora lo permette. La finestra si ricorda per
// titolo e programma, perche' gli id di Windows cambiano a ogni avvio: al
// riavvio si ritrova dal titolo, o dal programma se il titolo e' cambiato
// (molti giochi ci scrivono il livello o gli FPS).

const GAME_DEFAULTS = {
  source: null,      // { kind: 'window', title, app } | { kind: 'screen' } | null
  vision: null,      // { provider, model } | null: quello della chat, se vede le immagini
  intervalS: 30,     // almeno tanti secondi fra due sguardi al modello (12b)
  perHour: 20,       // al massimo tanti sguardi all'ora (12b)
}
const EXE_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,80}\.exe$/i
const MODEL_RE = /^[^\u0000-\u001f]{1,200}$/

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '')
const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(min, Math.min(max, v))) : def)

/** La finestra scelta, controllata; null se non va. */
function cleanSource(v) {
  if (!v || typeof v !== 'object') return null
  if (v.kind === 'screen') return { kind: 'screen' }
  if (v.kind !== 'window') return null
  const title = text(v.title, 200)
  const app = typeof v.app === 'string' && EXE_RE.test(v.app.trim()) ? v.app.trim() : ''
  return title || app ? { kind: 'window', title, app } : null
}

/**
 * Le impostazioni della modalita' gioco (config.game), controllate.
 * @param {any} cfg
 * @param {string[]} [providers] i provider ammessi (PROVIDERS del router)
 */
function gameConfig(cfg, providers = null) {
  const g = cfg && cfg.game && typeof cfg.game === 'object' ? cfg.game : {}
  const v = g.vision && typeof g.vision === 'object' ? g.vision : null
  const vision = v && typeof v.provider === 'string' && (!providers || providers.includes(v.provider)) && typeof v.model === 'string' && MODEL_RE.test(v.model)
    ? { provider: v.provider, model: v.model.trim() } : null
  return {
    source: cleanSource(g.source),
    vision,
    intervalS: num(g.intervalS, 30, 300, GAME_DEFAULTS.intervalS),
    perHour: num(g.perHour, 5, 30, GAME_DEFAULTS.perHour),
  }
}

/** Unisce le impostazioni nuove: passa solo cio' che e' valido; null toglie la scelta. */
function mergeGame(current, incoming, providers = null) {
  const base = gameConfig({ game: current }, providers)
  if (!incoming || typeof incoming !== 'object') return base
  const merged = { ...base }
  for (const k of ['source', 'vision', 'intervalS', 'perHour']) if (k in incoming) merged[k] = incoming[k]
  return gameConfig({ game: merged }, providers)
}

/**
 * La finestra da guardare fra quelle aperte: stesso titolo e programma, poi
 * stesso titolo, poi lo stesso programma (se ce n'e' una sola di quel
 * programma, o la piu' grande). null se non c'e'.
 * @param {{ id: string, title: string, app: string, area?: number }[]} windows
 * @param {{ kind: string, title?: string, app?: string } | null} choice
 */
function findSource(windows, choice, { exact = false } = {}) {
  if (!choice || choice.kind !== 'window') return null
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
  const both = windows.find(w => choice.title && choice.app && w.title === choice.title && same(w.app, choice.app))
  if (both) return both
  const byTitle = windows.find(w => choice.title && w.title === choice.title)
  if (byTitle) return byTitle
  // exact: solo per titolo (Blocco 12b: prima di ripiegare sul programma si
  // guarda se la finestra giusta e' ridotta a icona, se no si prenderebbe il
  // launcher o un'altra finestra dello stesso programma).
  if (exact) return null
  // Dal programma solo se il titolo comincia allo stesso modo (gli FPS che
  // cambiano): con un browser, chiuso il gioco, non si guarda un'altra pagina.
  const lower = String(choice.title || '').toLowerCase()
  const similar = (t) => {
    const s = String(t || '').toLowerCase()
    let i = 0
    while (i < s.length && i < lower.length && s[i] === lower[i]) i++
    return i >= Math.min(6, lower.length)
  }
  const byApp = windows.filter(w => choice.app && same(w.app, choice.app) && similar(w.title))
  if (!byApp.length) return null
  return byApp.sort((a, b) => (b.area || 0) - (a.area || 0))[0]
}

/**
 * Il modello che guarda: quello scelto nella pagina Visione, o quello della
 * chat se vede le immagini; null se nessuno dei due.
 * @param {{ vision: { provider: string, model: string } | null }} game
 * @param {{ provider: string, model: string }} chat
 * @param {boolean} chatSees il modello della chat vede le immagini
 */
function visionModel(game, chat, chatSees) {
  if (game.vision) return game.vision
  return chatSees && chat && chat.provider && chat.model ? { provider: chat.provider, model: chat.model } : null
}

/** Come si mostra la scelta: "Elden Ring (eldenring.exe)", "Tutto lo schermo". */
function describeSource(choice) {
  if (!choice) return ''
  if (choice.kind === 'screen') return 'Tutto lo schermo del companion'
  return [choice.title, choice.app && '(' + choice.app + ')'].filter(Boolean).join(' ')
}

// ─── Quando guardare (Blocco 12b) ────────────────────────────────────────────

const SIG_W = 32
const SIG_H = 18
const HOUR_MS = 60 * 60 * 1000
const LOOK = {
  CHANGE: 10,      // differenza media (0-255) da cui la scena e' "cambiata"
  STALE: 28,       // da qui, un risultato arrivato tardi e' vecchio: niente commento
  TICK_MS: 5000,   // ogni quanto l'impronta
}

/**
 * L'impronta di una scena: i grigi di un'immagine BGRA 32x18 (quella di
 * nativeImage.resize({ width: 32, height: 18 }).toBitmap()). null se non va.
 * @param {Uint8Array|Buffer} bgra
 */
function signature(bgra) {
  const n = SIG_W * SIG_H
  if (!bgra || bgra.length < n * 4) return null
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(0.114 * bgra[i * 4] + 0.587 * bgra[i * 4 + 1] + 0.299 * bgra[i * 4 + 2])
  return out
}

/** Quanto sono diverse due impronte: la differenza media, 0-255 (255 se manca una). */
function changed(a, b) {
  if (!a || !b || a.length !== b.length) return 255
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/**
 * Guardare adesso? state: { lookSig, lastLookAt, looking, looks } (looks:
 * le ore degli sguardi). Niente se uno e' gia' in corso, se la scena e' come
 * all'ultimo sguardo, se stai parlando o scrivendo (busy: il perche'), se non
 * e' passato l'intervallo o se si e' al tetto.
 * @returns {{ look: boolean, reason: string, looks: number[] }}
 */
function nextStep(state, { now, sig, intervalS, perHour, busy = null }) {
  const looks = (state.looks || []).filter(t => now - t < HOUR_MS)
  if (state.looking) return { look: false, reason: 'in corso', looks }
  if (!sig) return { look: false, reason: 'niente da guardare', looks }
  if (state.lookSig && changed(sig, state.lookSig) < LOOK.CHANGE) return { look: false, reason: 'scena uguale', looks }
  if (busy) return { look: false, reason: busy, looks }
  if (state.lastLookAt != null && now - state.lastLookAt < intervalS * 1000) return { look: false, reason: 'troppo presto', looks }
  if (looks.length >= perHour) return { look: false, reason: 'tetto all\'ora', looks }
  return { look: true, reason: state.lookSig ? 'scena cambiata' : 'primo sguardo', looks }
}

/**
 * Quanto costa circa uno sguardo, in dollari, dai prezzi di OpenRouter:
 * l'immagine, circa 1500 token di domanda e 80 di risposta. null se non si
 * sa; 0 se e' gratuito.
 */
function lookCost(price) {
  if (!price) return null
  return price.image + price.prompt * 1500 + price.completion * 80
}

// Perche' la modalita' gioco e' in pausa (lo stato di captureGame, o 'private').
const PAUSE_TEXT = {
  none: 'nessuna finestra scelta',
  missing: 'la finestra del gioco è chiusa',
  minimized: 'il gioco è ridotto a icona',
  empty: 'la finestra del gioco non si vede',
  private: 'in primo piano c\'è un\'app da ignorare',
}

const usd = (v) => v < 0.001 ? 'meno di 0,001 $' : '≈ ' + v.toFixed(3).replace('.', ',') + ' $'

/** Il costo da mostrare: '' se non si sa, 'gratis', o a sguardo e nell'ultima ora. */
function costText(cost, looks) {
  if (cost == null) return ''
  if (cost === 0) return 'gratis'
  return usd(cost) + ' a sguardo' + (looks ? ', ' + usd(cost * looks) + ' nell\'ultima ora' : '')
}

/** Lo stato in una riga, per la barra e la pagina Visione. st: quello di game-loop. */
function statusText(st, { name = '', cost = null } = {}) {
  if (!st || !st.on) return 'Spenta'
  if (st.paused) return 'In pausa: ' + (PAUSE_TEXT[st.paused] || st.paused)
  const title = st.title && st.title.length > 40 ? st.title.slice(0, 40) + '…' : st.title
  const parts = [(name || 'Il companion') + ' guarda ' + (title || 'la partita'), st.looks + (st.looks === 1 ? ' sguardo' : ' sguardi') + ' su ' + st.perHour + ' nell\'ultima ora']
  const c = costText(cost, st.looks)
  if (c) parts.push(c)
  return parts.join(' · ')
}

module.exports = {
  GAME_DEFAULTS, cleanSource, gameConfig, mergeGame, findSource, visionModel, describeSource,
  SIG_W, SIG_H, LOOK, signature, changed, nextStep, lookCost, PAUSE_TEXT, costText, statusText,
}
