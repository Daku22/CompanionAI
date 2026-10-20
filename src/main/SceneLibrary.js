// SceneLibrary.js — le scene 3D importate per la stanza (room-scene.js).
//
// Stessa libreria degli avatar (AvatarLibrary): la scelta del file e la copia
// le fa il main, il renderer riceve solo metadati e URL scene://. Cambiano i
// formati: glTF, FBX e OBJ con i suoi .mtl, niente immagini singole.
//
// Una scena si sistema a mano (scala, rotazione, dove sta l'avatar): i
// numeri stanno nel record, in settings, e li controlla sceneSettings().

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { AvatarLibrary, fbxFiles, gltfReferences, MAX_IMPORT_BYTES } = require('./AvatarLibrary')

const SCENE_KINDS = new Set(['gltf', 'fbx', 'obj'])
const MAX_MODEL_FILES = 500
const MAX_MTL_BYTES = 2 * 1024 * 1024

/**
 * I .mtl che un .obj dichiara con "mtllib". Una riga puo' elencarne piu' di
 * uno, ma i nomi con spazi sono comuni ("anime school.mtl"): se il nome
 * intero esiste si prende quello, se no si prova parola per parola.
 * @param {string} text contenuto del .obj
 * @param {string} base cartella del .obj
 * @returns {string[]} percorsi relativi a base
 */
function objMaterialFiles(text, base) {
  const out = []
  for (const m of text.matchAll(/^mtllib[ \t]+(.+?)[ \t]*$/gm)) {
    const whole = m[1]
    const names = fs.existsSync(path.resolve(base, whole)) ? [whole] : whole.split(/\s+/)
    for (const name of names) {
      const full = path.resolve(base, name)
      // Solo file dentro la cartella del modello, come per i .gltf.
      if (!full.startsWith(base + path.sep) || !fs.existsSync(full)) continue
      const rel = path.relative(base, full)
      if (!out.includes(rel)) out.push(rel)
    }
  }
  return out
}

/**
 * Il JSON dentro un .glb (il primo blocco, di tipo JSON), o null. Un .glb puo'
 * citare immagini fuori dal file: quelli del Food Kit di Kenney, per esempio,
 * hanno la texture in Textures/colormap.png, e senza copiarla l'oggetto
 * importato restava bianco.
 * @param {Buffer} buf
 */
function glbJson(buf) {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') return null
  const length = buf.readUInt32LE(12)
  if (buf.toString('ascii', 16, 20) !== 'JSON' || 20 + length > buf.length) return null
  try { return JSON.parse(buf.toString('utf8', 20, 20 + length)) } catch (_) { return null }
}

/**
 * Impostazioni di una scena, controllate: scala > 0, rotazione in gradi,
 * offset in metri. Senza impostazioni valide null (il renderer le stima).
 * @param {unknown} value
 * @returns {{ scale: number, rotation: number, offset: number[] } | null}
 */
function sceneSettings(value) {
  if (!value || typeof value !== 'object') return null
  const v = /** @type {any} */ (value)
  const scale = Number(v.scale)
  const rotation = Number(v.rotation)
  const offset = Array.isArray(v.offset) ? v.offset.map(Number) : []
  if (!(scale >= 1e-4 && scale <= 1e4)) return null
  if (!Number.isFinite(rotation)) return null
  if (offset.length !== 3 || !offset.every(n => Number.isFinite(n) && Math.abs(n) <= 1e5)) return null
  return { scale, rotation: ((rotation % 360) + 360) % 360, offset }
}

class SceneLibrary extends AvatarLibrary {
  /** @param {string} root cartella delle scene importate */
  constructor(root) {
    super(root, [])
    this.scheme = 'scene'
    this.kinds = SCENE_KINDS
    this.textureKinds = new Set(['fbx', 'obj'])
    this.tag = '[scene]'
    this.noneFound = 'Nessuna scena supportata: cerca .glb, .gltf, .fbx o .obj'
  }

  async list() {
    const items = await super.list()
    return items.map(item => ({ ...item, settings: sceneSettings(item.settings) }))
  }

  /**
   * Salva scala, rotazione e posizione di una scena importata. Restituisce
   * le impostazioni salvate, o null se la scena non c'e' o i numeri non vanno.
   */
  async update(id, settings) {
    const clean = sceneSettings(settings)
    if (!clean || typeof id !== 'string') return null
    const all = await this._readManifest()
    const record = all.find(r => r.id === id)
    if (!record) return null
    record.settings = clean
    await this._writeManifest(all)
    return clean
  }

  /** Riconosce un file come scena. files[0] e' il file principale, relativo a base. */
  async _scanFile(sourcePath, scanRoot) {
    const ext = path.extname(sourcePath).toLowerCase()
    // "twin_peaks_black_lodge" -> "twin peaks black lodge": il nome va nel menu.
    const name = path.basename(sourcePath, path.extname(sourcePath)).replace(/[_]+/g, ' ').trim().slice(0, 64)
    let kind
    let base = path.dirname(sourcePath)
    let files = [path.basename(sourcePath)]
    if (ext === '.glb' || ext === '.gltf') {
      kind = 'gltf'
      const json = ext === '.glb'
        ? glbJson(await fs.promises.readFile(sourcePath)) || {}
        : JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'))
      for (const ref of new Set(gltfReferences(json))) {
        const full = path.resolve(base, ref)
        if (!full.startsWith(base + path.sep)) throw new Error('riferimento fuori dalla cartella del modello: ' + ref)
        if (!fs.existsSync(full)) throw new Error('file dichiarato ma assente: ' + ref)
        files.push(path.relative(base, full))
      }
    } else if (ext === '.fbx') {
      kind = 'fbx'
      ;({ base, files } = await fbxFiles(sourcePath))
    } else if (ext === '.obj') {
      kind = 'obj'
      // Le immagini si cercano come per un FBX: i .mtl citano spesso percorsi
      // del PC di chi l'ha esportato, e il renderer le ricollega per nome.
      ;({ base, files } = await fbxFiles(sourcePath))
      const text = await fs.promises.readFile(sourcePath, 'utf8')
      const own = path.dirname(sourcePath)
      const prefix = path.relative(base, own)
      for (const mtl of objMaterialFiles(text, own)) {
        if ((await fs.promises.stat(path.join(own, mtl))).size > MAX_MTL_BYTES) continue
        files.push(prefix ? path.join(prefix, mtl) : mtl)
      }
    } else return null
    if (files.length > MAX_MODEL_FILES) throw new Error('troppi file dichiarati: ' + files.length)

    let bytes = 0
    for (const file of files) bytes += (await fs.promises.stat(path.join(base, file))).size
    if (bytes > MAX_IMPORT_BYTES) throw new Error('scena oltre ' + (MAX_IMPORT_BYTES / 1024 / 1024) + ' MB')

    return {
      id: crypto.randomUUID(),
      name, kind, capabilities: [],
      entry: path.relative(scanRoot, sourcePath).replace(/\\/g, '/'),
      base, files,
    }
  }
}

/**
 * Gli oggetti importati per la borsa (Blocco 10c): gli stessi formati delle
 * scene, serviti come object://, e al posto delle impostazioni della scena il
 * tipo, il nome e la misura scelti dall'utente (meta, controllato da
 * objects.js) e la miniatura scattata dal pannello.
 */
class ObjectLibrary extends SceneLibrary {
  /** @param {string} root cartella degli oggetti importati */
  constructor(root) {
    super(root)
    this.scheme = 'object'
    this.tag = '[oggetto]'
    this.noneFound = 'Nessun oggetto supportato: cerca .glb, .gltf, .fbx o .obj'
  }

  async list() {
    return this.withThumbs(await AvatarLibrary.prototype.list.call(this))
  }

  /** Salva il meta gia' controllato (objects.cleanMeta). null se l'oggetto non c'e'. */
  async setMeta(id, meta) {
    if (typeof id !== 'string' || !meta) return null
    const all = await this._readManifest()
    const record = all.find(r => r.id === id)
    if (!record) return null
    record.meta = meta
    await this._writeManifest(all)
    return meta
  }
}

module.exports = { SceneLibrary, ObjectLibrary, sceneSettings, objMaterialFiles, glbJson }
