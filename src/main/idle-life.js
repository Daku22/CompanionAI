// idle-life.js — cosa fa il companion quando nessuno gli scrive.
//
// Prima, finita una risposta, l'avatar restava fermo fino al messaggio
// successivo; l'unica eccezione era un "fuma" a tempo fisso nel 2D. Qui una
// funzione pura decide, a ogni battito del timer nel main, se fare un gesto e
// quale. Le soglie vengono da Kokoro-Engine (src-tauri/src/ai/idle_behaviors.rs,
// MIT): niente gesti nei primi secondi di quiete, una pausa minima fra un gesto
// e l'altro, e una probabilita' che cresce con l'attesa. Codice riscritto.
//
// Nessuna chiamata a un modello: i gesti costano zero e non escono dal PC.
// Si usano solo animazioni del contratto (ANIMATIONS in ai-router.js), che
// esistono sia nel 2D sia nel 3D.

const QUIET_MIN_MS   = 15 * 1000        // prima di questo il companion e' "in conversazione"
const GESTURE_GAP_MS = 20 * 1000        // pausa minima fra due gesti
const AWAY_MS        = 5 * 60 * 1000    // utente lontano dal PC: il companion si addormenta
const BASE_CHANCE    = 0.04             // per battito da 5 s: un gesto ogni ~2 minuti
const EXTRA_CHANCE   = 0.08             // in piu', raggiunto dopo un'ora di quiete
const HOUR_MS        = 60 * 60 * 1000
const FELT           = 0.4              // un'emozione cambia i gesti da qui in su
const HAPPY          = 0.6              // da qui, contento, ogni tanto offre il batti cinque
const PRESENT_MS     = 60 * 1000        // ...ma solo se l'utente e' al PC

// holdMs: dopo quanto il main riporta a idle. La camminata finisce da sola.
const GESTURES = {
  look:  { animation: 'think',   bubble: '',        holdMs: 4000 },
  walk:  { animation: 'walk-to', bubble: '',        holdMs: 0, walk: true },
  happy: { animation: 'happy',   bubble: '♪',       holdMs: 3000 },
  rest:  { animation: 'sit',     bubble: '',        holdMs: 8000 },
  doze:  { animation: 'doze',    bubble: '💤',      holdMs: 12000 },
  smoke: { animation: 'smoke',   bubble: '🚬 ...',  holdMs: 6000 },
  stretch: { animation: 'stretch', bubble: '',      holdMs: 3500 },
  yawn:  { animation: 'yawn',    bubble: '🥱',      holdMs: 3000 },
  // La mano si abbassa da sola (touch.js, createHighFive): niente holdMs.
  highfive: { animation: 'highfive', bubble: '', holdMs: 0 },
}

function isNight(hour) {
  return hour >= 23 || hour < 6
}

/** Pesi dei gesti secondo umore, energia e ora; present: l'utente e' al PC. */
function gestureWeights(mood, hour, present = false, bond = { affection: 1, annoyance: 1 }) {
  const e = (mood && mood.emotions) || {}
  const tired = isNight(hour) || (mood && mood.energy < 0.35)
  if (tired) return { doze: 4, yawn: 2, look: 1, rest: 1 }
  const w = { look: 3, walk: 2, happy: 1, rest: 1, smoke: 1, stretch: 1 }
  if ((e.joy || 0) >= FELT)       { w.happy += 2; w.walk += 1 }
  if ((e.joy || 0) >= HAPPY && present) w.highfive = 2
  if ((e.curiosity || 0) >= FELT) { w.look += 2; w.walk += 1 }
  if ((e.sadness || 0) >= FELT)   { w.rest += 2; w.happy = 0 }
  if ((e.annoyance || 0) >= FELT) { w.smoke += 1; w.happy = 0 }
  if ((e.calm || 0) >= FELT)      { w.rest += 1 }
  // Il livello del rapporto (rapport.js, reactionScale) rende piu' o meno
  // frequenti i gesti affettuosi e quelli infastiditi.
  w.happy *= bond.affection
  if (w.highfive) w.highfive *= bond.affection
  w.smoke *= bond.annoyance
  return w
}

function pick(weights, rand) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let roll = rand() * total
  for (const [name, w] of entries) {
    roll -= w
    if (roll < 0) return name
  }
  return entries[entries.length - 1][0]
}

/**
 * @param {{ quietMs: number, sinceGestureMs: number, systemIdleMs: number,
 *           asleep: boolean, mood?: { emotions: Record<string, number>, energy: number },
 *           hour: number, rand?: () => number }} input
 *   quietMs: da quanto non succede nulla (messaggi, azioni, trascinamenti);
 *   systemIdleMs: da quanto l'utente non tocca mouse e tastiera.
 * @returns {null | { name: string, animation: string, bubble: string,
 *                    holdMs: number, walk?: boolean, asleep?: boolean }}
 */
function decideIdle({ quietMs, sinceGestureMs, systemIdleMs, asleep, mood, hour, bond, rand = Math.random }) {
  // Utente via: ci si addormenta una volta sola, e si resta cosi' (holdMs 0).
  if (systemIdleMs >= AWAY_MS) {
    return asleep ? null : { name: 'sleep', animation: 'sit', bubble: '💤', holdMs: 0, asleep: true }
  }
  // Utente tornato: il companion si sveglia e lo saluta.
  if (asleep) return { name: 'wake', animation: 'wave', bubble: 'Ehi, ci sei!', holdMs: 3000, asleep: false }

  if (quietMs < QUIET_MIN_MS || sinceGestureMs < GESTURE_GAP_MS) return null
  const chance = BASE_CHANCE + Math.min(EXTRA_CHANCE, (quietMs / HOUR_MS) * EXTRA_CHANCE)
  if (rand() >= chance) return null

  const name = pick(gestureWeights(mood, hour, systemIdleMs < PRESENT_MS, bond), rand)
  return { name, ...GESTURES[name] }
}

module.exports = { decideIdle, gestureWeights, GESTURES, QUIET_MIN_MS, GESTURE_GAP_MS, AWAY_MS }
