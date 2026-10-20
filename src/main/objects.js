// objects.js — gli oggetti della borsa (Blocco 10c): quelli inclusi
// (modelli-3d/objects/objects.json) e quelli importati dall'utente
// (ObjectLibrary), con il loro tipo.
//
// Il tipo dice cosa fa un oggetto, e lo sceglie l'utente all'import:
//   throw  da lanciare: gravita' e rimbalzi, il companion lo insegue e lo riporta;
//   hug    da abbracciare: il companion lo tiene in braccio;
//   food   cibo, drink bevanda: finiscono anche nel pannello del cibo;
//   decor  decorazione: resta dove lo lasci.
// Funzioni pure tranne loadIncluded.

const fs = require('fs')
const path = require('path')

const TYPES = ['throw', 'hug', 'food', 'drink', 'decor']
const TYPE_LABELS = { throw: 'Da lanciare', hug: 'Da abbracciare', food: 'Cibo', drink: 'Bevanda', decor: 'Decorazione' }
// Quanto rimbalza, se il file non lo dice.
const BOUNCE = { throw: 0.6, hug: 0.15, food: 0.2, drink: 0.15, decor: 0.1 }
// Quanto sazia o disseta un cibo importato (food.js).
const FOOD_DEFAULTS = { food: { hunger: 0.3, joy: 0.08 }, drink: { thirst: 0.4, joy: 0.05 } }
const ID_RE = /^[a-z0-9-]{1,64}$/
const SIZE_MIN = 0.03
const SIZE_MAX = 2

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '')
const sizeOf = (v, fallback) => (typeof v === 'number' && v >= SIZE_MIN && v <= SIZE_MAX ? Math.round(v * 1000) / 1000 : fallback)

/**
 * Tipo, nome e dimensione di un oggetto importato, controllati. null se il
 * tipo non e' fra quelli ammessi.
 * @returns {{ type: string, name: string, size: number } | null}
 */
function cleanMeta(v, fallbackName = 'Oggetto') {
  if (!v || typeof v !== 'object' || !TYPES.includes(v.type)) return null
  return { type: v.type, name: text(v.name, 40) || fallbackName, size: sizeOf(v.size, 0.3) }
}

/** Il catalogo incluso (objects.json), ripulito. */
function cleanIncluded(data) {
  const items = data && Array.isArray(data.items) ? data.items : []
  const seen = new Set()
  const out = []
  for (const it of items) {
    if (!it || !ID_RE.test(it.id) || seen.has(it.id) || !TYPES.includes(it.type)) continue
    const name = text(it.name, 40)
    if (!name) continue
    seen.add(it.id)
    out.push({
      id: it.id, name, a: text(it.a, 60) || name.toLowerCase(), type: it.type, size: sizeOf(it.size, 0.3),
      bounce: typeof it.bounce === 'number' ? Math.max(0, Math.min(0.95, it.bounce)) : BOUNCE[it.type],
      builtin: true, url: 'vrm://objects/' + it.id + '.glb', format: 'gltf', icon: 'vrm://objects/icons/' + it.id + '.png',
    })
  }
  return out
}

function loadIncluded(dir) {
  try { return cleanIncluded(JSON.parse(fs.readFileSync(path.join(dir, 'objects.json'), 'utf8'))) } catch (_) { return [] }
}

/**
 * Un oggetto importato (record di ObjectLibrary) nella forma degli inclusi.
 * Senza tipo (appena importato) e' una decorazione finche' l'utente non sceglie.
 */
function fromRecord(rec) {
  const meta = cleanMeta(rec.meta, rec.name) || { type: 'decor', name: text(rec.name, 40) || 'Oggetto', size: 0.3 }
  return {
    id: rec.id, name: meta.name, a: meta.name.toLowerCase(), type: meta.type, size: meta.size, bounce: BOUNCE[meta.type],
    builtin: false, url: rec.url, format: rec.kind, textures: rec.textures || [], icon: rec.thumb || null, typed: !!cleanMeta(rec.meta),
  }
}

/**
 * Un oggetto di tipo cibo o bevanda come voce del catalogo del cibo (food.js),
 * cosi' si mangia come gli altri.
 */
function asFood(obj) {
  if (obj.type !== 'food' && obj.type !== 'drink') return null
  return { id: obj.id, name: obj.name, a: obj.a, kind: obj.type, hunger: 0, thirst: 0, joy: 0, energy: 0, ...FOOD_DEFAULTS[obj.type],
    size: Math.min(0.25, obj.size), words: [], url: obj.url, format: obj.format, textures: obj.textures, icon: obj.icon }
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * L'oggetto nominato in una frase della chat ("giochiamo a palla", "prendi il
 * gomitolo"), fra quelli del tipo dato: basta che una parola abbia le stesse
 * prime 4 lettere del nome ("palla" -> Pallone). null se nessuno.
 */
function findObject(objects, said, type = null) {
  const words = fold(said).split(/[^a-z0-9]+/).filter(w => w.length >= 4)
  if (!words.length) return null
  const pool = type ? objects.filter(o => o.type === type) : objects
  return pool.find(o => fold(o.name).split(/[^a-z0-9]+/).some(n => n.length >= 4 && words.some(w => w.slice(0, 4) === n.slice(0, 4)))) || null
}

/** Cio' che vede il pannello degli oggetti. */
function publicObject(obj) {
  return { id: obj.id, name: obj.name, type: obj.type, typeLabel: TYPE_LABELS[obj.type], size: obj.size, builtin: obj.builtin, icon: obj.icon, typed: obj.typed !== false }
}

module.exports = { TYPES, TYPE_LABELS, BOUNCE, cleanMeta, cleanIncluded, loadIncluded, fromRecord, asFood, findObject, publicObject, SIZE_MIN, SIZE_MAX }
