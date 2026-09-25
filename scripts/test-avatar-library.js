const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { AvatarLibrary } = require('../src/main/AvatarLibrary')
const { builtinAvatars } = require('../src/main/builtin-avatars')

async function file(name, contents = '') {
  await fs.promises.mkdir(path.dirname(name), { recursive: true })
  await fs.promises.writeFile(name, contents)
}
async function listFiles(dir) {
  const out = []
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(full)).map(f => entry.name + '/' + f))
    else out.push(entry.name)
  }
  return out.sort()
}

let scenari = 0
async function main() {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-avatar-test-'))
  try {
    const library = new AvatarLibrary(path.join(base, 'library'))

    const one = path.join(base, 'one'); await file(path.join(one, 'hero.vrm'))
    const scanned = await library.scan(one)
    assert.equal(scanned.candidates.length, 1); assert.equal(scanned.candidates[0].kind, 'vrm')
    assert.equal(JSON.stringify(scanned).includes(one), false, 'il renderer non deve ricevere percorsi reali')
    const imported = await library.commit(scanned.token, scanned.candidates[0].id)
    assert.equal(imported.kind, 'vrm'); assert.ok(await library.resolve(imported.id, imported.entry))
    scenari++

    const many = path.join(base, 'many')
    await file(path.join(many, 'a.vrm')); await file(path.join(many, 'b.glb'))
    const choices = await library.scan(many)
    assert.equal(choices.candidates.length, 2, 'una cartella con più modelli deve offrire una scelta')
    scenari++

    // Un .gltf copia solo i file che dichiara, non la cartella che lo contiene:
    // prima un modello in Downloads si portava dietro tutto Downloads.
    const downloads = path.join(base, 'downloads')
    await file(path.join(downloads, 'robot.gltf'), JSON.stringify({
      buffers: [{ uri: 'robot.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
      images: [{ uri: 'textures/pelle%20blu.png' }],
    }))
    await file(path.join(downloads, 'robot.bin'), 'bin')
    await file(path.join(downloads, 'textures', 'pelle blu.png'), 'png')
    await file(path.join(downloads, 'estratto-conto.pdf'), 'privato')
    await file(path.join(downloads, 'foto', 'vacanze.jpg'), 'jpg')
    const gltfScan = await library.scan(path.join(downloads, 'robot.gltf'))
    const gltf = await library.commit(gltfScan.token, gltfScan.candidates[0].id)
    assert.deepEqual(await listFiles(path.join(base, 'library', gltf.id)), ['robot.bin', 'robot.gltf', 'textures/pelle blu.png'])
    assert.ok(await library.resolve(gltf.id, gltf.entry), 'l-entry del gltf deve essere raggiungibile da avatar://')
    scenari++

    // Un riferimento che esce dalla cartella del modello non viene seguito.
    const evil = path.join(base, 'evil')
    await file(path.join(evil, 'model', 'trap.gltf'), JSON.stringify({ buffers: [{ uri: '../../one/hero.vrm' }] }))
    await assert.rejects(() => library.scan(path.join(evil, 'model', 'trap.gltf')), /Nessun avatar supportato/)
    const missing = path.join(base, 'missing')
    await file(path.join(missing, 'broken.gltf'), JSON.stringify({ buffers: [{ uri: 'assente.bin' }] }))
    await assert.rejects(() => library.scan(path.join(missing, 'broken.gltf')), /Nessun avatar supportato/)
    scenari++

    // Pacchetto di sprite: si copiano sprites.json e le strip che dichiara, e
    // le strip non compaiono come avatar a se'. E' cosi' che un avatar non
    // pubblicabile resta sul proprio PC senza stare nel repository.
    const pack = path.join(base, 'pack', 'Micia')
    await file(path.join(pack, 'sprites.json'), JSON.stringify({
      format: 'companion-sprites/1', name: 'Micia',
      animations: { idle: { file: 'idle.png', frames: [[0, 0, 1, 1]] }, walk: { file: 'strips/walk.png', frames: [[0, 0, 1, 1]] } },
    }))
    for (const f of ['idle.png', 'strips/walk.png', 'bozza.psd']) await file(path.join(pack, f))
    const packScan = await library.scan(path.join(base, 'pack'))
    assert.equal(packScan.candidates.length, 1, 'le strip del pacchetto non sono avatar a se-`')
    assert.equal(packScan.candidates[0].kind, 'sprite-pack')
    assert.equal(packScan.candidates[0].name, 'Micia')
    const packed = await library.commit(packScan.token, packScan.candidates[0].id)
    assert.deepEqual(await listFiles(path.join(base, 'library', packed.id)), ['idle.png', 'sprites.json', 'strips/walk.png'])
    assert.equal(packed.url, 'avatar://' + packed.id + '/sprites.json')
    // Con un percorso relativo i controlli di contenimento sbagliavano e
    // scartavano ogni strip come "fuori dalla cartella del modello".
    const relative = await library.scan(path.relative(process.cwd(), pack))
    assert.equal(relative.candidates.length, 1)
    assert.equal(relative.candidates[0].kind, 'sprite-pack')
    const bad = path.join(base, 'badpack')
    await file(path.join(bad, 'sprites.json'), JSON.stringify({ format: 'altro', animations: {} }))
    await assert.rejects(() => library.scan(bad), /Nessun avatar supportato/)
    scenari++

    // Una cartella scelta per sbaglio non deve far percorrere il disco intero.
    let deep = path.join(base, 'deep')
    for (let i = 0; i < 8; i++) deep = path.join(deep, 'livello' + i)
    await file(path.join(deep, 'lontano.vrm'))
    await assert.rejects(() => library.scan(path.join(base, 'deep')), /troppo profonda/)
    scenari++

    const empty = path.join(base, 'empty'); await fs.promises.mkdir(empty)
    await assert.rejects(() => library.scan(empty), /Nessun avatar supportato/)
    assert.equal(await library.resolve(imported.id, '../library.json'), null, 'avatar:// non deve uscire dalla propria cartella')
    scenari++

    // L'elenco porta l'url di ogni avatar e scarta i tipi non piu' supportati
    // (i Live2D importati prima restano su disco ma non rompono il menu).
    const manifestPath = path.join(base, 'library', 'library.json')
    const records = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'))
    records.push({ id: 'vecchio', name: 'Live', kind: 'live2d', entry: 'x.model3.json' })
    await fs.promises.writeFile(manifestPath, JSON.stringify(records))
    const listed = await new AvatarLibrary(path.join(base, 'library'), [{ id: 'Fred', builtin: true, url: 'vrm://Fred/x.vrm' }]).list()
    assert.equal(listed[0].id, 'Fred', 'gli integrati vengono per primi')
    assert.ok(listed.every(a => a.url || a.builtin), 'ogni avatar importato ha il suo url')
    assert.ok(!listed.some(a => a.kind === 'live2d'), 'i Live2D non sono piu-` supportati')
    scenari++

    // Integrati: solo cio' che esiste davvero nel pacchetto. Il 2D c'e' solo se
    // sprites.js contiene un manifest, e in quel caso e' il predefinito.
    const app = path.join(base, 'app')
    await file(path.join(app, 'modelli-3d', 'Fred', 'Fred_optimized.vrm'))
    const spritesJs = path.join(app, 'src', 'renderer', 'assets', 'strips', 'sprites.js')
    await file(spritesJs, '// commento\nwindow.COMPANION_SPRITES = null\n')
    let builtins = builtinAvatars(app)
    assert.deepEqual(builtins.map(a => a.id), ['Fred'])
    assert.equal(builtins[0].default, true, 'senza 2D integrato il predefinito e-` Fred')
    await file(spritesJs, 'window.COMPANION_SPRITES = ' + JSON.stringify({ format: 'companion-sprites/1', name: 'Nuova', animations: { idle: {} } }))
    builtins = builtinAvatars(app)
    assert.deepEqual(builtins.map(a => a.id), ['builtin-2d', 'Fred'])
    assert.equal(builtins[0].name, 'Nuova')
    assert.ok(builtins[0].default && !builtins[1].default)
    assert.deepEqual(builtinAvatars(path.join(base, 'vuota')), [], 'senza file nessun avatar integrato')
    scenari++

    console.log('=== AvatarLibrary: ' + scenari + ' scenari superati ===')
  } finally { await fs.promises.rm(base, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
