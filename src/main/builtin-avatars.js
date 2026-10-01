// builtin-avatars.js — avatar inclusi nell'app.
//
// Si pubblica solo cio' che ha una licenza di ridistribuzione (vedi
// ASSETS-LICENSE.md). L'elenco nasce dai file presenti, non da una lista
// scritta a mano: prima menu e codice nominavano modelli che non si potevano
// distribuire, e togliere un file rompeva il menu invece di farlo sparire.
//
// Accanto agli avatar pubblici ci sono quelli privati: se nella cartella del
// progetto esiste private-assets/ (esclusa da .gitignore e rifiutata da
// check:publish), i suoi pacchetti di sprite e i suoi VRM diventano avatar
// integrati della copia locale. E' cosi' che una copia privata tiene Yanineko,
// Dust e Neko senza che finiscano nel repository o nell'installer pubblico.
//
// Ordine, e quindi predefinito (il primo): 2D privati, 2D integrato, Live2D
// privati, Fred, poi i VRM privati.

const fs = require('fs')
const path = require('path')

const SPRITES_SCRIPT = path.join('src', 'renderer', 'assets', 'strips', 'sprites.js')
const PRIVATE_DIR = 'private-assets'
// Profondita' massima della ricerca in private-assets/: bastano cartelle come
// yanineko/sprite-pack/sprites.json o modelli-3d/Dust/DUST.vrm.
const PRIVATE_DEPTH = 3

const MODELS_3D = [
  // Fred di Swampazzo (VRoid Hub): licenza VRM 1.0 con ridistribuzione e
  // modifiche permesse, credito non richiesto ma riportato in ASSETS-LICENSE.md.
  { id: 'Fred', name: 'Fred', file: 'Fred/Fred_optimized.vrm' },
]

/**
 * Legge il manifest dell'avatar 2D integrato da sprites.js, che assegna
 * window.COMPANION_SPRITES. null se l'app viene distribuita senza avatar 2D.
 */
function readBuiltinSprites(appRoot) {
  const file = path.join(appRoot, SPRITES_SCRIPT)
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  const marker = 'window.COMPANION_SPRITES ='
  const start = text.indexOf(marker)
  if (start === -1) return null
  try {
    const manifest = JSON.parse(text.slice(start + marker.length).trim().replace(/;$/, ''))
    return manifest && manifest.animations && manifest.animations.idle ? manifest : null
  } catch (_) { return null }
}

/**
 * @typedef {{ id: string, name: string, kind: string, builtin: boolean,
 *             capabilities: string[], url: string|null, default?: boolean,
 *             private?: boolean }} BuiltinAvatar
 */

/** URL vrm:// di un file dentro private-assets/, servito dal main. */
function privateUrl(relative) {
  return 'vrm://private/' + relative.split(/[\\/]/).map(encodeURIComponent).join('/')
}

function walkPrivate(dir, depth, out) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && depth < PRIVATE_DEPTH) walkPrivate(full, depth + 1, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * Avatar di private-assets/: pacchetti di sprite (sprites.json), modelli
 * Live2D (.model3.json) e VRM.
 * @returns {{ sprites: BuiltinAvatar[], live2d: BuiltinAvatar[], models: BuiltinAvatar[] }}
 */
function privateAvatars(appRoot) {
  const root = path.join(appRoot, PRIVATE_DIR)
  /** @type {BuiltinAvatar[]} */ const sprites = []
  /** @type {BuiltinAvatar[]} */ const models = []
  /** @type {BuiltinAvatar[]} */ const live2d = []
  if (!fs.existsSync(root)) return { sprites, live2d, models }
  for (const file of walkPrivate(root, 0, [])) {
    const relative = path.relative(root, file)
    const base = path.basename(file).toLowerCase()
    if (base === 'sprites.json') {
      let manifest = null
      try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) {}
      if (!manifest || !manifest.animations || !manifest.animations.idle) continue
      const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : path.basename(path.dirname(file))
      sprites.push({
        // Id minuscolo: e' quello che la configurazione salvava prima ("yanineko").
        id: name.toLowerCase(), name, kind: 'sprite-pack', builtin: true, private: true,
        capabilities: ['animation', 'walk'], url: privateUrl(relative),
      })
    } else if (base.endsWith('.model3.json')) {
      // Nome della cartella del modello, senza "runtime" (la cartella che
      // l'editor di Live2D esporta).
      let dir = path.dirname(file)
      if (/^runtime$/i.test(path.basename(dir))) dir = path.dirname(dir)
      const folder = path.basename(dir)
      const name = folder.charAt(0).toUpperCase() + folder.slice(1)
      live2d.push({
        id: 'live2d-' + folder.toLowerCase(), name, kind: 'live2d', builtin: true, private: true,
        capabilities: ['animation', 'expressions'], url: privateUrl(relative),
      })
    } else if (base.endsWith('.vrm')) {
      // Nome della cartella del modello: "Dust", "Neko", come nelle versioni precedenti.
      const name = path.basename(path.dirname(file))
      models.push({
        id: name, name, kind: 'vrm', builtin: true, private: true,
        capabilities: ['animation', 'expressions', 'walk'], url: privateUrl(relative),
      })
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  return { sprites: sprites.sort(byName), live2d: live2d.sort(byName), models: models.sort(byName) }
}

/**
 * @param {string} appRoot cartella che contiene src/, modelli-3d/ ed eventualmente private-assets/
 * @returns {BuiltinAvatar[]}
 */
function builtinAvatars(appRoot) {
  const priv = privateAvatars(appRoot)
  /** @type {BuiltinAvatar[]} */
  const list = [...priv.sprites]
  const sprites = readBuiltinSprites(appRoot)
  if (sprites) {
    list.push({
      id: 'builtin-2d', name: sprites.name || 'Companion', kind: 'sprite-pack', builtin: true,
      capabilities: ['animation', 'walk'], url: null, // il renderer lo trova gia' caricato da sprites.js
    })
  }
  list.push(...priv.live2d)
  for (const model of MODELS_3D) {
    if (!fs.existsSync(path.join(appRoot, 'modelli-3d', model.file))) continue
    list.push({
      id: model.id, name: model.name, kind: 'vrm', builtin: true,
      capabilities: ['animation', 'expressions', 'walk'], url: 'vrm://' + model.file,
    })
  }
  list.push(...priv.models)

  // Un id ripetuto (due pacchetti con lo stesso nome) renderebbe ambigua la
  // scelta salvata: vince il primo.
  const seen = new Set()
  const unique = list.filter(a => (seen.has(a.id) ? false : seen.add(a.id)))
  if (unique.length) unique[0] = { ...unique[0], default: true }
  return unique
}

module.exports = { builtinAvatars, readBuiltinSprites, PRIVATE_DIR }
