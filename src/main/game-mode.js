// game-mode.js — la modalita' gioco (Blocco 12): il companion guarda la
// finestra del gioco e commenta la partita. Funzioni pure, con test.
//
// 12a: cosa guardare (una finestra scelta nella pagina Visione, o tutto lo
// schermo del companion) e con quale modello. La finestra si ricorda per
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
function findSource(windows, choice) {
  if (!choice || choice.kind !== 'window') return null
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
  const both = windows.find(w => choice.title && choice.app && w.title === choice.title && same(w.app, choice.app))
  if (both) return both
  const byTitle = windows.find(w => choice.title && w.title === choice.title)
  if (byTitle) return byTitle
  const byApp = windows.filter(w => choice.app && same(w.app, choice.app))
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

module.exports = { GAME_DEFAULTS, cleanSource, gameConfig, mergeGame, findSource, visionModel, describeSource }
