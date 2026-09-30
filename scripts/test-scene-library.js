const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SceneLibrary, sceneSettings, objMaterialFiles } = require('../src/main/SceneLibrary')

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
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-scene-test-'))
  try {
    const library = new SceneLibrary(path.join(base, 'library'))

    // Un .glb da solo: nome leggibile nel menu, URL scene://.
    const lodge = path.join(base, 'lodge'); await file(path.join(lodge, 'twin_peaks_black_lodge.glb'), 'glb')
    const scan = await library.scan(lodge)
    assert.equal(scan.candidates.length, 1)
    assert.equal(scan.candidates[0].name, 'twin peaks black lodge')
    assert.equal(JSON.stringify(scan).includes(lodge), false, 'il renderer non deve ricevere percorsi reali')
    const glb = await library.commit(scan.token, scan.candidates[0].id)
    assert.ok(glb.url.startsWith('scene://' + glb.id + '/'))
    scenari++

    // Un .obj come quelli di Sketchfab: il .mtl dichiarato (nome con spazi),
    // le immagini accanto; mai gli altri file della cartella.
    const school = path.join(base, 'aula', 'source', 'Texture Shool')
    await file(path.join(school, 'anime school.obj'), '# Blender\nmtllib anime school.mtl\no Cube\nv 0 0 0\n')
    await file(path.join(school, 'anime school.mtl'), 'newmtl A\nmap_Kd Books.png\n')
    await file(path.join(school, 'Books.png'), 'png')
    await file(path.join(school, 'Sky Anime Landscape [Scenery - Background] 53.jpg'), 'jpg')
    await file(path.join(school, 'appunti.txt'), 'privato')
    await file(path.join(base, 'aula', 'textures', 'Books.png'), 'png')
    const objScan = await library.scan(path.join(base, 'aula'))
    assert.equal(objScan.candidates.length, 1, 'le immagini non sono scene a se-`')
    assert.equal(objScan.candidates[0].kind, 'obj')
    const obj = await library.commit(objScan.token, objScan.candidates[0].id)
    assert.deepEqual(await listFiles(path.join(base, 'library', obj.id)),
      ['Books.png', 'Sky Anime Landscape [Scenery - Background] 53.jpg', 'anime school.mtl', 'anime school.obj'])
    const listed = (await library.list()).find(s => s.id === obj.id)
    assert.equal(listed.textures.length, 2, 'le immagini copiate vanno al renderer')
    assert.equal(listed.settings, null, 'senza impostazioni le stima il renderer')
    scenari++

    // mtllib con piu' file, e un file fuori dalla cartella che non si copia.
    const multi = path.join(base, 'multi')
    await file(path.join(multi, 'a.mtl')); await file(path.join(multi, 'b.mtl')); await file(path.join(base, 'fuori.mtl'))
    assert.deepEqual(objMaterialFiles('mtllib a.mtl b.mtl\nmtllib ../fuori.mtl\n', multi), ['a.mtl', 'b.mtl'])
    scenari++

    // Impostazioni: salvate e rilette; numeri assurdi rifiutati.
    assert.deepEqual(await library.update(obj.id, { scale: 0.35, rotation: -90, offset: [1, -0.3, 2] }),
      { scale: 0.35, rotation: 270, offset: [1, -0.3, 2] })
    assert.deepEqual((await library.list()).find(s => s.id === obj.id).settings, { scale: 0.35, rotation: 270, offset: [1, -0.3, 2] })
    assert.equal(await library.update(obj.id, { scale: 0, rotation: 0, offset: [0, 0, 0] }), null)
    assert.equal(await library.update('non-esiste', { scale: 1, rotation: 0, offset: [0, 0, 0] }), null)
    assert.equal(sceneSettings({ scale: 1, rotation: 0, offset: [0, NaN, 0] }), null)
    scenari++

    // Elimina: cartella e voce spariscono, l'altra scena resta.
    assert.deepEqual(await library.remove([obj.id, '../fuori']), [obj.id])
    assert.equal(fs.existsSync(path.join(base, 'library', obj.id)), false)
    assert.deepEqual((await library.list()).map(s => s.id), [glb.id])
    scenari++

    // Niente di riconoscibile: un messaggio che dice cosa cercare.
    await file(path.join(base, 'vuota', 'foto.png'), 'png')
    await assert.rejects(library.scan(path.join(base, 'vuota')), /Nessuna scena supportata/)
    scenari++

    console.log('=== SceneLibrary: ' + scenari + ' scenari superati ===')
  } finally { await fs.promises.rm(base, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
