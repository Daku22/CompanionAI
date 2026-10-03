// personas.js — le Persone (Blocco 6a): nome, personalità, avatar e voce.
// Ognuna ha la sua memoria (MemoryManager con l'id come conversationId) e il
// suo umore. La persona "default" è quella di prima del Blocco 6: la sua
// memoria e il suo umore restano dove erano.
//
// Avatar e voce non si scelgono qui: la persona ricorda quelli in uso quando
// la si lascia (snapshot) e li rimette quando torna attiva.

const fs = require('fs')
const path = require('path')
const { writeAtomic } = require('./write-atomic')

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_NAME = 40
const MAX_PROMPT = 2000
const MAX_PERSONAS = 20
// Della voce la persona tiene solo come parla: accensione, volume e microfono
// restano dell'app.
const VOICE_KEYS = ['engine', 'kokoroVoice', 'speed', 'xttsSpeaker', 'xttsSample']
const pickVoice = (v) => (v && typeof v === 'object' ? Object.fromEntries(VOICE_KEYS.filter(k => k in v).map(k => [k, v[k]])) : null)

const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
const cleanPrompt = (text) => String(text || '').trim().slice(0, MAX_PROMPT)

function cleanPersona(p) {
  if (!p || typeof p !== 'object' || !ID_RE.test(p.id)) return null
  return {
    id: p.id,
    name: cleanName(p.name) || p.id,
    prompt: cleanPrompt(p.prompt),
    avatarModel: typeof p.avatarModel === 'string' ? p.avatarModel : '',
    voice: pickVoice(p.voice),
  }
}

/**
 * Stato valido da quello letto da disco (o null). Senza persone nasce
 * "default" con l'avatar e la voce di oggi.
 * @param {*} data
 * @param {{ avatarModel?: string, voice?: object }} [current]
 */
function normalize(data, current = {}) {
  const seen = new Set()
  const list = (Array.isArray(data && data.list) ? data.list : [])
    .map(cleanPersona)
    .filter(p => p && !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_PERSONAS)
  if (!list.length) {
    list.push({ id: 'default', name: 'Companion', prompt: '', avatarModel: current.avatarModel || '', voice: pickVoice(current.voice) })
  }
  const activeId = list.some(p => p.id === data?.activeId) ? data.activeId : list[0].id
  return { activeId, list }
}

const active = (state) => state.list.find(p => p.id === state.activeId)

/** Un id nuovo dal nome: minuscole, trattini, unico. */
function newId(state, name) {
  const base = cleanName(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'persona'
  let id = base
  for (let n = 2; state.list.some(p => p.id === id); n++) id = base + '-' + n
  return id
}

/** @returns {{ state, id } | null} null se il nome è vuoto o sono troppe */
function create(state, name, prompt = '') {
  const clean = cleanName(name)
  if (!clean || state.list.length >= MAX_PERSONAS) return null
  const id = newId(state, clean)
  const base = active(state)
  // La persona nuova parte con l'avatar e la voce di quella attiva.
  const p = { id, name: clean, prompt: cleanPrompt(prompt), avatarModel: base.avatarModel, voice: base.voice }
  return { state: { ...state, list: [...state.list, p] }, id }
}

/** Cambia nome, personalità e/o voce; null se l'id non c'è o il nome è vuoto. */
function update(state, id, { name, prompt, voice } = {}) {
  const p = state.list.find(x => x.id === id)
  if (!p) return null
  const next = { ...p }
  if (name !== undefined) { if (!cleanName(name)) return null; next.name = cleanName(name) }
  if (prompt !== undefined) next.prompt = cleanPrompt(prompt)
  if (voice !== undefined) next.voice = pickVoice(voice)
  return { ...state, list: state.list.map(x => (x.id === id ? next : x)) }
}

/** Mai l'ultima. Se era attiva, diventa attiva la prima rimasta. */
function remove(state, id) {
  if (state.list.length <= 1 || !state.list.some(p => p.id === id)) return null
  const list = state.list.filter(p => p.id !== id)
  return { activeId: state.activeId === id ? list[0].id : state.activeId, list }
}

/** Ricorda nella persona attiva l'avatar e la voce in uso. */
function snapshot(state, { avatarModel, voice } = {}) {
  return { ...state, list: state.list.map(p => (p.id === state.activeId ? { ...p, avatarModel: avatarModel || '', voice: pickVoice(voice) } : p)) }
}

function activate(state, id) {
  return state.list.some(p => p.id === id) ? { ...state, activeId: id } : null
}

/** La personalità davanti al prompt di base. */
function systemPrompt(persona, base) {
  if (!persona || !persona.prompt) return base
  return `Ti chiami ${persona.name}. La tua personalità, decisa dall'utente:\n${persona.prompt}\n\n` + base
}

/** Dove stanno umore (e poi livello e diario) della persona. */
const personaDir = (root, id) => (id === 'default' ? root : path.join(root, 'personas', id))

// Sincrona: serve all'avvio, prima della memoria.
function load(file, current) {
  try { return normalize(JSON.parse(fs.readFileSync(file, 'utf8')), current) } catch (_) { return normalize(null, current) }
}

const save = (file, state) => writeAtomic(file, JSON.stringify(state, null, 2))

module.exports = { ID_RE, MAX_PROMPT, MAX_PERSONAS, normalize, active, create, update, remove, snapshot, activate, systemPrompt, personaDir, load, save }
