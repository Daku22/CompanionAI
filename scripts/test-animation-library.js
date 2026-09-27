// test-animation-library.js — la cartella delle clip .vrma, senza Electron.

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { AnimationLibrary, ANIMATION_SLOTS, slotOf, slug, isGlb } = require('../src/main/AnimationLibrary')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

/** Il glTF binario piu' piccolo possibile: intestazione e un blocco JSON. */
function tinyGlb() {
  const json = Buffer.from('{"asset":{"version":"2.0"}}   ')
  const out = Buffer.alloc(20 + json.length)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20)
  return new Uint8Array(out)
}

async function main() {
  console.log('=== Libreria delle animazioni ===\n')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-anim-test-'))
  const builtin = path.join(work, 'builtin')
  const user = path.join(work, 'user')
  fs.mkdirSync(builtin)
  fs.writeFileSync(path.join(builtin, 'idle.vrma'), tinyGlb())
  fs.writeFileSync(path.join(builtin, 'walk-to-2.vrma'), tinyGlb())
  fs.writeFileSync(path.join(builtin, 'ballo.vrma'), tinyGlb())      // nessuno slot
  fs.writeFileSync(path.join(builtin, 'wave.txt'), 'non una clip')
  const lib = new AnimationLibrary([{ id: 'builtin', dir: builtin }, { id: 'private', dir: path.join(work, 'assente') }, { id: 'user', dir: user }])

  await test('il nome del file dice il gesto, varianti comprese', () => {
    assert.equal(slotOf('idle.vrma'), 'idle')
    assert.equal(slotOf('walk-to-2.vrma'), 'walk-to')
    assert.equal(slotOf('Wave_Hello.vrma'), 'wave')
    assert.equal(slotOf('walkabout.vrma'), null)
    assert.equal(slotOf('ballo.vrma'), null)
  })

  await test('elenco: solo .vrma con un gesto, cartelle assenti ignorate', async () => {
    const list = await lib.list()
    assert.deepEqual(list.map(a => a.slot + ':' + a.name), ['idle:idle.vrma', 'walk-to:walk-to-2.vrma'])
    assert.equal(list[0].url, 'motion://builtin/idle.vrma')
  })

  await test('resolve accetta solo nomi di file semplici dentro la cartella', () => {
    assert.ok(lib.resolve('builtin', 'idle.vrma'))
    assert.equal(lib.resolve('builtin', '../builtin/idle.vrma'), null)
    assert.equal(lib.resolve('builtin', 'wave.txt'), null)
    assert.equal(lib.resolve('altro', 'idle.vrma'), null)
    assert.equal(lib.resolve('builtin', 'manca.vrma'), null)
  })

  await test('salvataggio: nome ripulito, varianti senza sovrascrivere', async () => {
    const a = await lib.save('wave', 'Saluto Allegro!.fbx', tinyGlb())
    const b = await lib.save('wave', 'Saluto Allegro!.fbx', tinyGlb())
    assert.equal(a.name, 'wave-saluto-allegro.vrma')
    assert.equal(b.name, 'wave-saluto-allegro-2.vrma')
    assert.equal(a.url, 'motion://user/wave-saluto-allegro.vrma')
    assert.ok(fs.existsSync(path.join(user, b.name)))
    assert.equal(slug('../../x'), 'x')
  })

  await test('salvataggio rifiutato: gesto sconosciuto o file che non e- un glTF', async () => {
    await assert.rejects(lib.save('volare', 'x', tinyGlb()), /gesto sconosciuto/)
    await assert.rejects(lib.save('idle', 'x', new Uint8Array(Buffer.from('ciao mondo, non sono un glb'))), /non e' un .vrma/)
    assert.equal(isGlb(new Uint8Array(4)), false)
  })

  await test('gli slot sono tutti gesti del player', () => {
    assert.ok(ANIMATION_SLOTS.includes('idle') && ANIMATION_SLOTS.includes('dangle'))
  })

  fs.rmSync(work, { recursive: true, force: true })
  console.log('\n=== ' + passed + ' test superati ===')
}

main()
