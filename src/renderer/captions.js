// captions.js — i sottotitoli nel fumetto (Blocco 11b).
//
// Mentre la voce legge, il fumetto sopra il companion mostra la frase che sta
// dicendo, in sincrono con l'audio: voice-player.js chiama schedule quando il
// pezzo di una frase nuova parte. Una frase lunga non sta nel fumetto (la
// finestra e' stretta): si divide in pezzi di qualche parola, mostrati uno
// dopo l'altro nel tempo della frase. Senza voce, con la chat chiusa, il main
// manda le frasi della risposta mentre arrivano (queue): restano il tempo di
// leggerle.

(function () {
  const bubble = () => document.getElementById('bubble')
  const READ_CHARS_PER_S = 15    // lettura, e stima della voce quando la durata non si sa
  const LINGER_MS = 1600         // dopo l'ultima frase il fumetto resta un attimo
  const MAX_LINES = 3

  let timers = []                // { id, at }: i pezzi in attesa, con l'ora in cui partono
  let hideTimer = null
  let readUntil = 0              // queue: quando finisce di mostrare l'ultima frase in coda

  /**
   * Una frase in pezzi da al massimo maxChars caratteri, divisi a parole
   * (prima dopo una virgola o un punto, se ce n'e' uno a buon punto). Pura.
   * @param {string} text
   * @param {number} maxChars
   * @returns {string[]}
   */
  function captionParts(text, maxChars) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    const parts = []
    let cur = ''
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w
      if (next.length <= maxChars || !cur) { cur = next; continue }
      // Meglio tagliare dopo la punteggiatura, se il pezzo non resta troppo corto.
      const cut = Math.max(cur.lastIndexOf(', '), cur.lastIndexOf('. '), cur.lastIndexOf('; '), cur.lastIndexOf(': '))
      if (cut > maxChars * 0.5) {
        parts.push(cur.slice(0, cut + 1))
        cur = cur.slice(cut + 2) + ' ' + w
      } else {
        parts.push(cur)
        cur = w
      }
    }
    if (cur) parts.push(cur)
    return parts
  }

  /** Quanti caratteri stanno nel fumetto in questa finestra (3 righe). */
  function maxChars() {
    const perLine = Math.max(14, Math.floor((window.innerWidth - 30) / 6.3))
    return perLine * MAX_LINES
  }

  function show(text) {
    const el = bubble()
    if (!el) return
    clearTimeout(hideTimer)
    el.classList.add('caption', 'show')
    el.textContent = text
  }

  function hideLater(ms) {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      const el = bubble()
      if (el && el.classList.contains('caption')) { el.classList.remove('show'); setTimeout(() => el.classList.remove('caption'), 250) }
    }, ms)
  }

  function later(fn, ms) {
    const at = Date.now() + ms
    const t = { id: setTimeout(() => { timers = timers.filter(x => x !== t); fn() }, ms), at }
    timers.push(t)
  }

  function clear() {
    for (const t of timers) clearTimeout(t.id)
    timers = []
    readUntil = 0
    hideLater(0)
  }

  /**
   * Una frase detta: fra delayS secondi, per durationS secondi. La durata
   * vera vale se c'e' (Kokoro manda la frase intera); se e' molto piu' corta
   * della stima e' solo il primo pezzo di XTTS, e vale la stima. I pezzi
   * della frase prima che partirebbero dopo questa si annullano.
   */
  function schedule(text, delayS, durationS) {
    const parts = captionParts(text, maxChars())
    if (!parts.length) return
    const delay = Math.max(0, (Number(delayS) || 0) * 1000)
    const estimate = String(text).length / READ_CHARS_PER_S
    const real = Number(durationS) || 0
    const total = (real >= estimate * 0.7 ? real : estimate) * 1000
    const startAt = Date.now() + delay
    for (const t of timers.filter(x => x.at >= startAt)) clearTimeout(t.id)
    timers = timers.filter(x => x.at < startAt)
    const chars = parts.reduce((n, p) => n + p.length, 0)
    let at = delay
    for (const part of parts) {
      later(() => show(part), at)
      at += total * (part.length / chars)
    }
    later(() => hideLater(LINGER_MS), at)
  }

  /** Una frase da leggere (senza voce): dopo quelle gia' in coda. */
  function queue(text) {
    const now = Date.now()
    const start = Math.max(now, readUntil)
    const ms = 800 + String(text).length / READ_CHARS_PER_S * 1000
    readUntil = start + ms
    schedule(text, (start - now) / 1000, ms / 1000)
  }

  // Dal main, senza voce: le frasi della risposta mentre arrivano.
  const api = window.companion
  if (api && api.onCompanionCaption) {
    api.onCompanionCaption((c) => {
      if (c && c.clear) clear()
      else if (c && typeof c.text === 'string' && c.text) queue(c.text.slice(0, 400))
    })
  }

  window.CompanionCaption = { schedule, queue, clear, captionParts }
})()
