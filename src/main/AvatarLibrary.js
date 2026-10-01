const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_IMPORT_BYTES = 250 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg'])
const PENDING_TTL_MS = 5 * 60 * 1000
// Formato dei pacchetti di sprite 2D, generati da scripts/build-strips.js.
const SPRITE_PACK_FORMAT = 'companion-sprites/1'
const SPRITE_PACK_FILE = 'sprites.json'
// Tipi che il renderer sa mostrare. Un record di un tipo sparito (i Live2D
// importati dalle versioni precedenti) non compare nel menu invece di rompersi.
const SUPPORTED_KINDS = new Set(['vrm', 'gltf', 'fbx', 'sprite', 'sprite-pack', 'live2d'])
// Avatar Live2D (Cubism 3, 4 e 5): l'indice e' <nome>.model3.json.
const LIVE2D_SUFFIX = '.model3.json'

// Limiti della scansione: scegliere per sbaglio C:\ o Downloads non deve far
// percorrere al main l'intero disco.
const MAX_SCAN_DEPTH = 5
const MAX_SCAN_FILES = 5000
// File che un singolo modello puo' dichiarare (texture, buffer, strip...).
const MAX_MODEL_FILES = 500

// Un .gltf e un sprites.json sono indici: i dati stanno in file accanto. Si
// copiano solo i file dichiarati, e solo se restano dentro la cartella del
// modello: prima l'import copiava l'intera cartella che conteneva l'indice,
// quindi un modello in Downloads si portava dietro tutto Downloads.

/** Riferimenti di un .gltf: buffer e immagini esterni, esclusi i data: URI. */
function gltfReferences(json) {
  const uris = [...(json.buffers || []), ...(json.images || [])].map(item => item && item.uri)
  return uris.filter(uri => typeof uri === 'string' && !uri.startsWith('data:')).map(uri => decodeURIComponent(uri))
}

/** Riferimenti di un pacchetto di sprite: il PNG di ogni animazione. */
function spritePackReferences(json) {
  if (!json || json.format !== SPRITE_PACK_FORMAT || !json.animations || !json.animations.idle) {
    throw new Error(SPRITE_PACK_FILE + ' non e\' un pacchetto ' + SPRITE_PACK_FORMAT + ' con animazione idle')
  }
  return Object.values(json.animations).map(anim => anim && anim.file).filter(file => typeof file === 'string' && file)
}

/**
 * Riferimenti di un modello Live2D: moc, texture, fisica, posa, espressioni e
 * movimenti dichiarati in FileReferences. I suoni dei movimenti no: il
 * companion parla con la sua voce.
 */
function live2dReferences(json) {
  const refs = json && json.FileReferences
  if (!refs || typeof refs.Moc !== 'string' || !Array.isArray(refs.Textures) || !refs.Textures.length) {
    throw new Error('non e\' un modello Live2D: mancano Moc o Textures')
  }
  const out = [refs.Moc, ...refs.Textures]
  for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (typeof refs[key] === 'string') out.push(refs[key])
  for (const exp of Array.isArray(refs.Expressions) ? refs.Expressions : []) if (exp && typeof exp.File === 'string') out.push(exp.File)
  for (const group of Object.values(refs.Motions && typeof refs.Motions === 'object' ? refs.Motions : {})) {
    for (const motion of Array.isArray(group) ? group : []) if (motion && typeof motion.File === 'string') out.push(motion.File)
  }
  return out.filter(Boolean)
}

// Un FBX non ha un indice leggibile senza un parser: le texture si cercano fra
// le immagini accanto, e nelle cartelle vicine ("textures", "<nome>.fbm").
const FBX_TEXTURE_DEPTH = 2
const FBX_MAX_TEXTURES = 100
// TGA e BMP non sono avatar 2D, ma sono texture FBX comuni (fbx-textures.js
// nel renderer le legge).
const FBX_TEXTURE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.tga', '.bmp'])
// Gli zip di Sketchfab e molti altri mettono il modello in source/ e le
// immagini in una cartella accanto: textures/, Texture/, maps/...
const TEXTURE_DIR = /^(textures?|tex|maps|images)$/i

async function imagesNear(base, relative = '', depth = 0, out = []) {
  let entries = []
  try { entries = await fs.promises.readdir(path.join(base, relative), { withFileTypes: true }) } catch (_) { return out }
  for (const entry of entries) {
    if (out.length >= FBX_MAX_TEXTURES) break
    const rel = path.join(relative, entry.name)
    if (entry.isDirectory() && depth < FBX_TEXTURE_DEPTH && !entry.name.startsWith('.')) await imagesNear(base, rel, depth + 1, out)
    else if (entry.isFile() && FBX_TEXTURE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(rel)
  }
  return out
}

/**
 * Texture di un FBX: le immagini accanto al modello o, se non ce ne sono,
 * quelle di una cartella di texture accanto alla sua ("source/x.fbx" e
 * "textures/"). Nel secondo caso la cartella del modello diventa quella che
 * le contiene entrambe. Mai l'intera cartella superiore: solo le cartelle
 * con un nome da texture.
 */
async function fbxFiles(sourcePath) {
  const base = path.dirname(sourcePath)
  const own = await imagesNear(base)
  if (own.length) return { base, files: [path.basename(sourcePath), ...own] }
  const parent = path.dirname(base)
  if (parent === base) return { base, files: [path.basename(sourcePath)] }
  let entries = []
  try { entries = await fs.promises.readdir(parent, { withFileTypes: true }) } catch (_) { entries = [] }
  const images = []
  for (const entry of entries) {
    if (entry.isDirectory() && TEXTURE_DIR.test(entry.name) && entry.name !== path.basename(base)) {
      await imagesNear(parent, entry.name, 1, images)
    }
  }
  if (!images.length) return { base, files: [path.basename(sourcePath)] }
  return { base: parent, files: [path.join(path.basename(base), path.basename(sourcePath)), ...images] }
}

/** URL avatar:// di un file dentro la cartella di un avatar importato. */
function avatarUrl(id, entry, scheme = 'avatar') {
  return scheme + '://' + id + '/' + entry.split('/').map(encodeURIComponent).join('/')
}

class AvatarLibrary {
  /**
   * @param {string} root cartella degli avatar importati
   * @param {object[]} [builtins] avatar inclusi nell'app, gia' con il loro url
   */
  constructor(root, builtins = []) {
    this.root = root
    this.builtins = builtins
    this.manifestPath = path.join(root, 'library.json')
    this.pendingImports = new Map()
    // Quello che cambia per SceneLibrary, che riusa scansione, copia ed eliminazione.
    this.scheme = 'avatar'
    this.kinds = SUPPORTED_KINDS
    // Tipi senza un indice delle texture: il renderer le cerca fra le immagini copiate.
    this.textureKinds = new Set(['fbx'])
    this.tag = '[avatar]'
    this.noneFound = 'Nessun avatar supportato: cerca .vrm, .glb, .gltf, .fbx, .model3.json (Live2D), sprites.json o immagini'
  }

  _url(id, entry) { return avatarUrl(id, entry, this.scheme) }

  async list() {
    const stored = await Promise.all((await this._readManifest())
      .filter(record => this.kinds.has(record.kind))
      .map(async record => {
        const item = { ...record, url: this._url(record.id, record.entry) }
        // Molti FBX (quelli di Sketchfab, per esempio) citano texture senza
        // nome di file: il renderer le ricollega ai materiali per nome, quindi
        // gli servono le immagini importate accanto al modello.
        if (this.textureKinds.has(record.kind)) {
          item.textures = (await imagesNear(path.join(this.root, record.id)))
            .map(rel => this._url(record.id, rel.split(path.sep).join('/')))
        }
        return item
      }))
    return [...this.builtins, ...stored]
  }

  async scan(source) {
    this._purgeExpired()
    // Assoluto: i controlli "resta nella cartella del modello" confrontano percorsi.
    source = path.resolve(source)
    const stat = await fs.promises.stat(source)
    const files = stat.isDirectory() ? await this._walk(source) : [source]
    const scanRoot = stat.isDirectory() ? source : path.dirname(source)
    const found = []
    for (const file of files) {
      try {
        const candidate = await this._scanFile(file, scanRoot)
        if (candidate) found.push(candidate)
      } catch (error) {
        console.warn(this.tag + ' ' + file + ' scartato:', error.message)
      }
    }
    // Le texture di un .gltf e le strip di un pacchetto sono immagini, ma non
    // avatar a se': proporle affollerebbe la scelta con pezzi del modello.
    const usedByModels = new Set(found.flatMap(c => c.files.slice(1).map(f => path.join(c.base, f))))
    const candidates = found.filter(c => !usedByModels.has(path.join(c.base, c.files[0])))
    if (!candidates.length) throw new Error(this.noneFound)
    const token = crypto.randomUUID()
    this.pendingImports.set(token, { candidates, expiresAt: Date.now() + PENDING_TTL_MS })
    // Al renderer vanno solo i metadati: mai i percorsi reali sul disco.
    return { token, candidates: candidates.map(({ id, name, kind, capabilities, entry }) => ({ id, name, kind, capabilities, entry })) }
  }

  async commit(token, candidateId) {
    const pending = this.pendingImports.get(token)
    this.pendingImports.delete(token)
    if (!pending || pending.expiresAt < Date.now()) throw new Error('La selezione è scaduta: ripeti l’importazione')
    const candidate = pending.candidates.find(item => item.id === candidateId)
    if (!candidate) throw new Error('Modello selezionato non valido')

    const id = crypto.randomUUID()
    const target = path.join(this.root, id)
    await fs.promises.mkdir(target, { recursive: true })
    try {
      for (const relative of candidate.files) {
        const dest = path.join(target, relative)
        await fs.promises.mkdir(path.dirname(dest), { recursive: true })
        await fs.promises.copyFile(path.join(candidate.base, relative), dest)
      }
      const record = {
        id, name: candidate.name, kind: candidate.kind,
        entry: candidate.files[0].split(path.sep).join('/'),
        importedAt: new Date().toISOString(), capabilities: candidate.capabilities, license: 'user-supplied',
      }
      const all = await this._readManifest()
      all.push(record)
      await this._writeManifest(all)
      return { ...record, url: this._url(record.id, record.entry) }
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Elimina avatar importati: il record e la loro cartella. Gli integrati non
   * stanno nel manifest, quindi un loro id viene ignorato invece di cancellare
   * qualcosa fuori dalla libreria. Restituisce gli id davvero rimossi.
   */
  async remove(ids) {
    const wanted = new Set(ids.filter(id => typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id)))
    const all = await this._readManifest()
    const removed = all.filter(record => wanted.has(record.id)).map(record => record.id)
    if (!removed.length) return []
    // Prima il manifest: se una cartella non si cancella (file aperto altrove)
    // resta un avanzo su disco, non una voce di menu che non carica.
    await this._writeManifest(all.filter(record => !wanted.has(record.id)))
    for (const id of removed) {
      await fs.promises.rm(path.join(this.root, id), { recursive: true, force: true })
        .catch(error => console.warn(this.tag + ' cartella ' + id + ' non eliminata:', error.message))
    }
    return removed
  }

  async resolve(id, relative = '') {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return null
    const base = path.resolve(this.root, id)
    const target = path.resolve(base, relative)
    return target.startsWith(base + path.sep) && fs.existsSync(target) ? target : null
  }

  _purgeExpired() {
    const now = Date.now()
    for (const [token, pending] of this.pendingImports) {
      if (pending.expiresAt < now) this.pendingImports.delete(token)
    }
  }

  /**
   * Riconosce un file come avatar. files[0] e' sempre il file principale,
   * relativo a base (la cartella del modello).
   */
  async _scanFile(sourcePath, scanRoot) {
    const lower = sourcePath.toLowerCase()
    const ext = path.extname(lower)
    let kind
    let capabilities
    let references = null
    let name = path.basename(sourcePath, path.extname(sourcePath))
    if (path.basename(lower) === SPRITE_PACK_FILE) {
      kind = 'sprite-pack'; capabilities = ['animation', 'walk']; references = spritePackReferences
      name = path.basename(path.dirname(sourcePath))
    }
    else if (lower.endsWith(LIVE2D_SUFFIX)) {
      kind = 'live2d'; capabilities = ['animation', 'expressions']; references = live2dReferences
      name = path.basename(sourcePath).slice(0, -LIVE2D_SUFFIX.length)
      // "runtime" e' la cartella che l'editor di Live2D esporta: il nome vero e' sopra.
      if (/^runtime$/i.test(path.basename(path.dirname(sourcePath)))) name = path.basename(path.dirname(path.dirname(sourcePath)))
    }
    else if (ext === '.vrm') { kind = 'vrm'; capabilities = ['animation', 'expressions', 'walk'] }
    // glTF e FBX si animano se hanno uno scheletro umano (humanoid-map.js):
    // lo decide il renderer al caricamento, altrimenti restano un'anteprima.
    else if (ext === '.glb') { kind = 'gltf'; capabilities = ['animation', 'walk'] }
    else if (ext === '.gltf') { kind = 'gltf'; capabilities = ['animation', 'walk']; references = gltfReferences }
    else if (ext === '.fbx') { kind = 'fbx'; capabilities = ['animation', 'walk'] }
    else if (IMAGE_EXTENSIONS.has(ext)) { kind = 'sprite'; capabilities = ['preview'] }
    else return null

    let base = path.dirname(sourcePath)
    let files = [path.basename(sourcePath)]
    if (kind === 'fbx') ({ base, files } = await fbxFiles(sourcePath))
    if (references) {
      const json = JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'))
      if (kind === 'sprite-pack' && typeof json.name === 'string' && json.name.trim()) name = json.name.trim().slice(0, 64)
      for (const ref of new Set(references(json))) {
        const full = path.resolve(base, ref)
        if (!full.startsWith(base + path.sep)) throw new Error('riferimento fuori dalla cartella del modello: ' + ref)
        if (!fs.existsSync(full)) throw new Error('file dichiarato ma assente: ' + ref)
        files.push(path.relative(base, full))
      }
      if (files.length > MAX_MODEL_FILES) throw new Error('troppi file dichiarati: ' + files.length)
    }

    let bytes = 0
    for (const file of files) bytes += (await fs.promises.stat(path.join(base, file))).size
    if (bytes > MAX_IMPORT_BYTES) throw new Error('modello oltre ' + (MAX_IMPORT_BYTES / 1024 / 1024) + ' MB')

    return {
      id: crypto.randomUUID(),
      name, kind, capabilities,
      entry: path.relative(scanRoot, sourcePath).replace(/\\/g, '/'),
      base, files,
    }
  }

  async _walk(dir, depth = 0, result = []) {
    if (depth > MAX_SCAN_DEPTH) throw new Error('Cartella troppo profonda: scegli direttamente la cartella del modello')
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await this._walk(full, depth + 1, result)
      else if (entry.isFile()) result.push(full)
      if (result.length > MAX_SCAN_FILES) throw new Error('Cartella con troppi file: scegli direttamente la cartella del modello')
    }
    return result
  }

  async _readManifest() {
    try { return JSON.parse(await fs.promises.readFile(this.manifestPath, 'utf8')) } catch (_) { return [] }
  }

  async _writeManifest(value) {
    await fs.promises.mkdir(this.root, { recursive: true })
    await fs.promises.writeFile(this.manifestPath, JSON.stringify(value, null, 2))
  }
}

module.exports = { AvatarLibrary, SPRITE_PACK_FORMAT, avatarUrl, fbxFiles, gltfReferences, live2dReferences, MAX_IMPORT_BYTES }
