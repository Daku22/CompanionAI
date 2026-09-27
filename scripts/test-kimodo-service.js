// test-kimodo-service.js — il servizio che fa generare i movimenti a Kimodo.
//
// Al posto di kmd-generate c'e' un processo finto che parla lo stesso
// protocollo (una riga di campi separati da tab, risposta OK/ERR) e scrive
// l'uscita grezza nella cartella chiesta. Si controllano: avvio pigro, una
// richiesta alla volta, errori, tempo scaduto, chiusura per inattivita',
// cache e ripulitura del testo proposto dal modello.

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const { KimodoService, motionPrompt, cacheKey, MAX_PROMPT } = require('../src/main/kimodo-service')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + (err.stack || err.message))
    process.exitCode = 1
  }
}

const JOINTS = 30
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Cartella di Kimodo finta: eseguibile e pesi esistono, vuoti. */
function fakeInstall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-test-'))
  for (const f of ['build/release/kmd-generate.exe', 'weights/models/kimodo-soma-rp-v1.1-f32.gguf', 'weights/Llama-3-Kimodo-Q4_K.gguf']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), '')
  }
  return dir
}

/**
 * spawn finto. behave(fields) decide la risposta: 'ok', 'err', 'silent'.
 * @param {(fields: string[]) => string} [behave]
 * @returns {{ spawn: any, spawned: any[], lines: string[] }}
 */
function fakeSpawn(behave = () => 'ok') {
  const spawned = []
  const lines = []
  /** @param {string} exe @param {string[]} args @param {any} options */
  const spawn = (exe, args, options) => {
    const proc = /** @type {any} */ (new EventEmitter())
    proc.stdout = new PassThrough()
    proc.stdin = new PassThrough()
    proc.args = args
    proc.options = options
    proc.killed = false
    proc.ended = false
    proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit('exit', null)) }
    proc.stdin.on('finish', () => { proc.ended = true; setImmediate(() => proc.emit('exit', 0)) })
    let buffer = ''
    proc.stdin.on('data', (/** @type {Buffer} */ chunk) => {
      buffer += chunk
      let n
      while ((n = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, n)
        buffer = buffer.slice(n + 1)
        lines.push(line)
        const fields = line.split('\t')
        const what = behave(fields)
        if (what === 'silent') continue
        if (what === 'err') { proc.stdout.write('ERR\tprompt troppo strano\n'); continue }
        const frames = Number(fields[4])
        const root = new Float32Array(frames * 3).fill(0.9)
        const rot = new Float32Array(frames * JOINTS * 4)
        for (let i = 0; i < frames * JOINTS; i++) rot[i * 4 + 3] = 1
        fs.writeFileSync(path.join(fields[3], 'root_positions.f32'), Buffer.from(root.buffer))
        fs.writeFileSync(path.join(fields[3], 'local_rotations_xyzw.f32'), Buffer.from(rot.buffer))
        proc.stdout.write('OK\t' + frames + '\t' + JOINTS + '\n')
      }
    })
    spawned.push(proc)
    return proc
  }
  return { spawn, spawned, lines }
}

async function main() {
  console.log('=== Kimodo in locale (servizio del main) ===\n')

  await test('il testo proposto dal modello diventa una riga pulita, o niente', () => {
    assert.equal(motionPrompt('  A person\tdoes a\ncartwheel.  '), 'A person does a cartwheel.')
    assert.equal(motionPrompt('x'.repeat(500)).length, MAX_PROMPT)
    assert.equal(motionPrompt(''), null)
    assert.equal(motionPrompt('!!! ...'), null)
    assert.equal(motionPrompt(42), null)
    assert.equal(motionPrompt(undefined), null)
  })

  await test('la chiave di cache ignora maiuscole e punteggiatura, non la durata', () => {
    assert.equal(cacheKey('A person bows.', 4), cacheKey('a person bows', 4))
    assert.notEqual(cacheKey('A person bows.', 4), cacheKey('A person bows.', 5))
    assert.match(cacheKey('A person bows.', 4), /^[a-f0-9]{32}\.vrma$/)
  })

  await test('il server parte alla prima richiesta, una volta sola, e risponde in ordine', async () => {
    const fake = fakeSpawn()
    const k = new KimodoService({ dir: fakeInstall(), cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'kc-')), spawn: fake.spawn })
    assert.equal(fake.spawned.length, 0, 'nessun avvio prima di una richiesta')
    const [a, b] = await Promise.all([k.generate('A person bows.', { seconds: 2 }), k.generate('A person jumps.', { seconds: 1 })])
    assert.equal(fake.spawned.length, 1)
    assert.equal(fake.spawned[0].args[0], '--server')
    assert.equal(a.frames, 60)
    assert.equal(b.frames, 30)
    assert.equal(a.rotations.length, 60 * JOINTS * 4)
    // I campi: transizione, passi, seme, cartella, fotogrammi, file del prompt.
    const fields = fake.lines[0].split('\t')
    assert.equal(fields.length, 6)
    assert.equal(fs.existsSync(fields[3]), false, 'la cartella di lavoro si cancella')
    // Le DLL di ggml vanno nel PATH del processo.
    assert.ok(fake.spawned[0].options.env.PATH.startsWith(path.join(k.dir, 'build', 'release', 'bin')))
    k.stop()
  })

  await test('un errore di Kimodo arriva a chi ha chiesto, e il server resta usabile', async () => {
    let first = true
    const fake = fakeSpawn(() => { if (first) { first = false; return 'err' } return 'ok' })
    const k = new KimodoService({ dir: fakeInstall(), cacheDir: os.tmpdir(), spawn: fake.spawn })
    await assert.rejects(k.generate('A person bows.'), /prompt troppo strano/)
    const ok = await k.generate('A person bows.')
    assert.equal(ok.frames, 120)
    assert.equal(fake.spawned.length, 1)
    k.stop()
  })

  await test('senza risposta in tempo il server si ferma; la richiesta dopo lo riavvia', async () => {
    let silent = true
    const fake = fakeSpawn(() => (silent ? 'silent' : 'ok'))
    const k = new KimodoService({ dir: fakeInstall(), cacheDir: os.tmpdir(), spawn: fake.spawn, timeoutMs: 50, firstTimeoutMs: 50 })
    await assert.rejects(k.generate('A person bows.'), /non ha risposto/)
    assert.equal(fake.spawned[0].killed, true)
    silent = false
    await k.generate('A person bows.')
    assert.equal(fake.spawned.length, 2)
    k.stop()
  })

  await test('dopo un po' + "'" + ' senza richieste il server si chiude e libera la scheda video', async () => {
    const fake = fakeSpawn()
    const k = new KimodoService({ dir: fakeInstall(), cacheDir: os.tmpdir(), spawn: fake.spawn, idleMs: 30 })
    await k.generate('A person bows.')
    assert.equal(fake.spawned[0].ended, false)
    await sleep(80)
    assert.equal(fake.spawned[0].ended, true, 'stdin chiuso: kmd-generate esce da solo')
    assert.equal(k.proc, null)
  })

  await test('senza kimodo.cpp o senza pesi: niente processo, errore chiaro', async () => {
    const fake = fakeSpawn()
    const dir = fakeInstall()
    fs.rmSync(path.join(dir, 'weights', 'Llama-3-Kimodo-Q4_K.gguf'))
    const k = new KimodoService({ dir, cacheDir: os.tmpdir(), spawn: fake.spawn })
    assert.equal(k.available(), false)
    assert.equal(k.missing().length, 1)
    await assert.rejects(k.generate('A person bows.'), /non trovato/)
    assert.equal(fake.spawned.length, 0)
  })

  await test('cache: salva, ritrova, rifiuta nomi strani, tiene al massimo 100 file', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-'))
    const k = new KimodoService({ dir: fakeInstall(), cacheDir, spawn: fakeSpawn().spawn })
    const key = cacheKey('A person bows.', 4)
    assert.equal(k.cached('A person bows.', 4), null)
    await k.store(key, new Uint8Array([1, 2, 3]))
    assert.equal(k.cached('a person bows', 4), key)
    assert.equal(k.resolve(key), path.join(cacheDir, key))
    assert.equal(k.resolve('../config.json'), null)
    assert.equal(k.resolve('wave.vrma'), null)
    await assert.rejects(k.store('../x.vrma', new Uint8Array([1])), /non valido/)
    for (let i = 0; i < 101; i++) await k.store(cacheKey('clip ' + i, 4), new Uint8Array([i]))
    assert.equal(fs.readdirSync(cacheDir).filter(f => f.endsWith('.vrma')).length, 100)
    assert.equal(k.resolve(key), null, 'il piu' + "'" + ' vecchio esce per primo')
  })

  console.log('\n=== ' + passed + ' test superati ===')
}

main()
