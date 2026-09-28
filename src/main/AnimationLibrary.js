// AnimationLibrary.js — le clip .vrma che l'avatar sa riprodurre.
//
// Tre cartelle, nello stesso formato:
// - modelli-3d/animations: clip integrate, pubblicabili (licenza verificata);
// - private-assets/animations: solo nella copia privata (vedi builtin-avatars.js);
// - <userData>/animations: quelle importate dal menu.
//
// Il nome del file dice a cosa serve la clip: "wave.vrma", "idle-2.vrma",
// "sit-bordo.vrma". All'inizio c'e' uno degli SLOT, cioe' i nomi del player
// di vrm-animation.js; il resto distingue le varianti. Una clip di passaggio
// ha la fase subito dopo lo slot: "sit-enter-kimodo.vrma" (si siede, poi
// resta ferma sull'ultimo fotogramma o passa al ciclo), "sit-exit.vrma" (si
// rialza). Senza fase e' il ciclo, o il gesto intero per gli slot brevi.
// La conversione da glTF, FBX o BVH avviene nel renderer (motion-retarget.js):
// qui arrivano solo file .vrma, controllati e salvati.

const fs = require('fs')
const path = require('path')
const { writeAtomic } = require('./write-atomic')

// Stessi nomi di CLIPS in src/renderer/vrm-animation.js (test-animation.mjs
// controlla che coincidano).
// perch: seduto su una finestra vera. Non ha clip di serie (quella di Kimodo
// per sit-edge abbassa il bacino), ma se ne puo' importare una con quel nome.
const ANIMATION_SLOTS = ['idle', 'wave', 'think', 'walk-to', 'run-to', 'sit', 'sit-edge', 'perch', 'smoke', 'happy', 'click', 'dangle', 'search', 'stretch', 'yawn', 'doze', 'dance']
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.vrma$/i
const MAX_ANIMATION_BYTES = 30 * 1024 * 1024
const SOURCE_RE = /^[a-z]+$/

/** Lo slot di un file: "walk-to-2.vrma" -> "walk-to". null se non ne ha uno. */
function slotOf(file) {
  const base = String(file).toLowerCase().replace(/\.vrma$/, '')
  const matches = ANIMATION_SLOTS.filter(s => base === s || base.startsWith(s + '-') || base.startsWith(s + '_'))
  return matches.sort((a, b) => b.length - a.length)[0] || null
}

const PHASES = ['enter', 'loop', 'exit']

/** Fase di un file: "sit-enter-x.vrma" -> "enter". Senza fase e' "loop". */
function phaseOf(file) {
  const slot = slotOf(file)
  if (!slot) return null
  const rest = String(file).toLowerCase().replace(/\.vrma$/, '').slice(slot.length)
  const m = /^[-_](enter|exit)(?:[-_]|$)/.exec(rest)
  return m ? m[1] : 'loop'
}

/** Parte del nome del file scelta dall'utente, ridotta a lettere e cifre. */
function slug(name) {
  return String(name || '').toLowerCase().replace(/\.[a-z0-9]+$/, '')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Un .vrma e' un glTF binario: "glTF", versione 2, lunghezza coerente. */
function isGlb(bytes) {
  if (bytes.length < 20) return false
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.readUInt32LE(0) === 0x46546c67 && view.readUInt32LE(4) === 2 && view.readUInt32LE(8) === bytes.length
}

class AnimationLibrary {
  /**
   * @param {{ id: string, dir: string }[]} sources cartelle in ordine; id va nell'URL
   * @param {string} userSource id della cartella in cui salvare gli import
   */
  constructor(sources, userSource = 'user') {
    this.sources = sources.filter(s => SOURCE_RE.test(s.id))
    this.userSource = userSource
  }

  get userDir() {
    const s = this.sources.find(x => x.id === this.userSource)
    return s ? s.dir : null
  }

  /** @returns {Promise<{ slot: string, phase: string, name: string, url: string, source: string }[]>} */
  async list() {
    const out = []
    for (const source of this.sources) {
      let files = []
      try { files = await fs.promises.readdir(source.dir) } catch (_) { continue }
      for (const file of files.sort()) {
        const slot = FILE_RE.test(file) ? slotOf(file) : null
        if (!slot) continue
        out.push({ slot, phase: phaseOf(file), name: file, url: 'motion://' + source.id + '/' + encodeURIComponent(file), source: source.id })
      }
    }
    return out
  }

  /** Percorso di un file servito da motion://, o null. */
  resolve(sourceId, file) {
    const source = this.sources.find(s => s.id === sourceId)
    if (!source || !FILE_RE.test(file)) return null
    const full = path.join(source.dir, file)
    return fs.existsSync(full) ? full : null
  }

  /**
   * Salva una clip importata.
   * @param {string} slot uno di ANIMATION_SLOTS
   * @param {string} name nome del file d'origine, per distinguere le varianti
   * @param {Uint8Array} data il .vrma
   * @param {string} [phase] enter, loop (predefinita) o exit
   */
  async save(slot, name, data, phase = 'loop') {
    if (!ANIMATION_SLOTS.includes(slot)) throw new Error('Animazione per un gesto sconosciuto: ' + slot)
    if (!PHASES.includes(phase)) throw new Error('Fase sconosciuta: ' + phase)
    if (!(data instanceof Uint8Array)) throw new Error('Dati dell\'animazione non validi')
    if (data.length > MAX_ANIMATION_BYTES) throw new Error('Animazione oltre ' + (MAX_ANIMATION_BYTES / 1024 / 1024) + ' MB')
    if (!isGlb(data)) throw new Error('Il file non e\' un .vrma valido')
    const dir = this.userDir
    if (!dir) throw new Error('Cartella delle animazioni non disponibile')
    await fs.promises.mkdir(dir, { recursive: true })
    const stem = slot + '-' + (phase === 'loop' ? '' : phase + '-') + (slug(name) || 'clip')
    let file = stem + '.vrma'
    for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = stem + '-' + i + '.vrma'
    await writeAtomic(path.join(dir, file), Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    return { slot, phase, name: file, url: 'motion://' + this.userSource + '/' + encodeURIComponent(file), source: this.userSource }
  }
}

module.exports = { AnimationLibrary, ANIMATION_SLOTS, PHASES, slotOf, phaseOf, slug, isGlb }
