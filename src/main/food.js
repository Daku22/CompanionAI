// food.js — il catalogo di cibi e bevande (Blocco 10b).
//
// Il catalogo sta in modelli-3d/food/food.json, accanto ai modelli (Food Kit di
// Kenney, CC0). Qui si legge e si controlla, si cerca un cibo per nome (le
// parole della chat: "ti preparo un tè"), e si dice cosa fa a chi lo mangia.
// Funzioni pure tranne loadCatalog.

const fs = require('fs')
const path = require('path')

const ID_RE = /^[a-z0-9-]{1,32}$/
const KINDS = ['food', 'drink']
const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '')

/** Minuscolo e senza accenti, per confrontare parole. */
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Le voci valide del catalogo, ripulite: un file scritto a mano o rotto non
 * deve rompere il pannello.
 * @param {any} data
 */
function cleanCatalog(data) {
  const items = data && Array.isArray(data.items) ? data.items : []
  const seen = new Set()
  const out = []
  for (const it of items) {
    if (!it || !ID_RE.test(it.id) || seen.has(it.id) || !KINDS.includes(it.kind)) continue
    const name = text(it.name, 40)
    if (!name) continue
    seen.add(it.id)
    out.push({
      id: it.id, name, a: text(it.a, 60) || name.toLowerCase(), kind: it.kind,
      hunger: clamp01(it.hunger), thirst: clamp01(it.thirst), joy: clamp01(it.joy), energy: clamp01(it.energy),
      size: typeof it.size === 'number' && it.size > 0.01 && it.size < 1 ? it.size : 0.1,
      words: (Array.isArray(it.words) ? it.words : []).map(w => fold(text(w, 40))).filter(Boolean).slice(0, 12),
    })
  }
  return out
}

/** Il catalogo dalla cartella (food.json); vuoto se manca o e' rotto. */
function loadCatalog(dir) {
  try { return cleanCatalog(JSON.parse(fs.readFileSync(path.join(dir, 'food.json'), 'utf8'))) } catch (_) { return [] }
}

/**
 * Il cibo di cui parla un testo ("ti preparo un tè", "drink: caffe"), o
 * null. kind restringe a cibi o bevande. Parole intere, senza accenti; vince
 * la parola piu' lunga ("polpetta di riso" prima di "riso").
 */
function findFood(catalog, said, kind = null) {
  const t = ' ' + fold(said).replace(/[^a-z0-9]+/g, ' ') + ' '
  let best = null
  let bestLen = 0
  for (const it of catalog) {
    if (kind && it.kind !== kind) continue
    for (const w of [fold(it.id), fold(it.name), ...it.words]) {
      const key = ' ' + w.replace(/[^a-z0-9]+/g, ' ').trim() + ' '
      if (key.length > 2 && t.includes(key) && key.length > bestLen) { best = it; bestLen = key.length }
    }
  }
  return best
}

/** Cosa fa a chi lo mangia: fame, sete (per needs.feed), allegria, energia. */
function effectsOf(item) {
  return { hunger: item.hunger || 0, thirst: item.thirst || 0, joy: item.joy || 0, energy: item.energy || 0 }
}

// Ringraziamenti brevi, senza chiamare il modello.
const THANKS = {
  food: ['Grazie! Che buono!', 'Gnam! Grazie!', 'Buonissimo, grazie!', 'Mmm, ci voleva!'],
  drink: ['Grazie! Ci voleva!', 'Ahh, che bello, grazie!', 'Grazie, avevo proprio sete!'],
  treat: ['Un dolcetto! Grazie!', 'Che bontà, grazie!', 'Mi vizi! Grazie!'],
}
function thanks(item, rand = Math.random) {
  const list = item.kind === 'drink' ? THANKS.drink : item.joy >= 0.12 ? THANKS.treat : THANKS.food
  return list[Math.floor(rand() * list.length) % list.length]
}

/** La riga per la memoria: cosi' se lo ricorda. */
function memoryLine(item) {
  return "[L'utente ti ha dato " + (item.kind === 'drink' ? 'da bere: ' : 'da mangiare: ') + item.a + ']'
}

/** Cio' che vede il pannello del cibo. */
function publicItem(item) {
  return { id: item.id, name: item.name, kind: item.kind }
}

module.exports = { cleanCatalog, loadCatalog, findFood, effectsOf, thanks, memoryLine, publicItem, fold }
