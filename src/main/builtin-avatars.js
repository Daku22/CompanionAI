// builtin-avatars.js — avatar inclusi nell'app.
//
// Si pubblica solo cio' che ha una licenza di ridistribuzione (vedi
// ASSETS-LICENSE.md). L'elenco nasce dai file presenti, non da una lista
// scritta a mano: prima menu e codice nominavano modelli che non si potevano
// distribuire, e togliere un file rompeva il menu invece di farlo sparire.
//
// Il primo avatar dell'elenco e' quello predefinito: l'avatar 2D integrato,
// se le sue strip ci sono, altrimenti Fred.

const fs = require('fs')
const path = require('path')

const SPRITES_SCRIPT = path.join('src', 'renderer', 'assets', 'strips', 'sprites.js')

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
 *             capabilities: string[], url: string|null, default?: boolean }} BuiltinAvatar
 */

/**
 * @param {string} appRoot cartella che contiene src/ e modelli-3d/
 * @returns {BuiltinAvatar[]}
 */
function builtinAvatars(appRoot) {
  /** @type {BuiltinAvatar[]} */
  const list = []
  const sprites = readBuiltinSprites(appRoot)
  if (sprites) {
    list.push({
      id: 'builtin-2d', name: sprites.name || 'Companion', kind: 'sprite-pack', builtin: true,
      capabilities: ['animation', 'walk'], url: null, // il renderer lo trova gia' caricato da sprites.js
    })
  }
  for (const model of MODELS_3D) {
    if (!fs.existsSync(path.join(appRoot, 'modelli-3d', model.file))) continue
    list.push({
      id: model.id, name: model.name, kind: 'vrm', builtin: true,
      capabilities: ['animation', 'expressions', 'walk'], url: 'vrm://' + model.file,
    })
  }
  if (list.length) list[0] = { ...list[0], default: true }
  return list
}

module.exports = { builtinAvatars, readBuiltinSprites }
