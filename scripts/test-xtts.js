// test-xtts.js — voce XTTS: pezzi di audio (xtts-engine.js) e installazione (xtts-setup.js).
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { XttsEngine, createFrameReader } = require('../src/main/xtts-engine')
const { uvCommands, uvEnv, xttsInstalled, XTTS_FILES, UV_FILES, PYTHON_VERSION } = require('../src/main/xtts-setup')

/** Pezzi come li scrive xtts_service.py: uint32 byte + float32, 0 = fine. */
function frame(samples) {
  const data = Buffer.from(new Float32Array(samples).buffer)
  const head = Buffer.alloc(4)
  head.writeUInt32LE(data.length, 0)
  return Buffer.concat([head, data])
}
const END = Buffer.from([0, 0, 0, 0])

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Voce XTTS ===')

  await t('i pezzi si leggono anche spezzati a caso', () => {
    const all = Buffer.concat([frame([0.5, -0.5]), frame([0.25]), END])
    for (const cut of [1, 3, 4, 5, 9, 13, all.length - 1]) {
      const r = createFrameReader()
      const got = [...r.push(all.subarray(0, cut)), ...r.push(all.subarray(cut))]
      assert.deepEqual(got.map(p => [...p]), [[0.5, -0.5], [0.25]], 'taglio a ' + cut)
      assert.equal(r.done, true)
    }
  })

  await t('un pezzo di lunghezza impossibile e\' un errore', () => {
    const bad = Buffer.alloc(8); bad.writeUInt32LE(3, 0)
    assert.throws(() => createFrameReader().push(bad), /non valido/)
  })

  // Il servizio "acceso" a finta: synth parla con un fetch finto.
  function readyEngine(body, status = 200) {
    const calls = []
    const e = new XttsEngine({
      root: os.tmpdir(), samplesDir: os.tmpdir(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        const stream = new ReadableStream({ start(c) { for (const b of body) c.enqueue(new Uint8Array(b)); c.close() } })
        return new Response(status === 200 ? stream : JSON.stringify({ error: 'GPU piena' }), { status, headers: { 'x-sample-rate': '24000' } })
      },
    })
    e.proc = { stdin: { end() {} }, kill() {} }
    e.state = 'ready'
    e.port = 5555
    e.token = 'segreto'
    return { e, calls }
  }

  await t('synth: pezzi in ordine, token e testo nella richiesta', async () => {
    const { e, calls } = readyEngine([frame([0.1, 0.2]), Buffer.concat([frame([0.3]), END])])
    const got = []
    await e.synth('Ciao!', { speaker: { builtin: 'Ana Florence' }, speed: 1.1 }, (pcm, rate) => got.push([[...pcm].map(v => +v.toFixed(2)), rate]))
    assert.deepEqual(got, [[[0.1, 0.2], 24000], [[0.3], 24000]])
    assert.equal(calls[0].url, 'http://127.0.0.1:5555/tts')
    assert.equal(calls[0].init.headers['X-Token'], 'segreto')
    assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Ciao!', language: 'it', speaker: { builtin: 'Ana Florence' }, speed: 1.1 })
  })

  await t('synth: una risposta troncata o un errore del servizio diventano errori', async () => {
    await assert.rejects(readyEngine([frame([0.1])]).e.synth('x', { speaker: {} }, () => {}), /interrotta/)
    await assert.rejects(readyEngine([], 500).e.synth('x', { speaker: {} }, () => {}), /GPU piena/)
  })

  await t('installazione: Python fissato, pacchetti solo con hash, indici fissati', () => {
    const cmd = uvCommands('C:/dati/voice', 'C:/dati/voice/xtts/app/requirements.txt')
    assert.deepEqual(cmd.python, ['python', 'install', PYTHON_VERSION])
    assert.ok(cmd.packages.includes('--require-hashes'))
    assert.ok(cmd.packages.includes('https://download.pytorch.org/whl/cu124'))
    assert.ok(cmd.packages[cmd.packages.indexOf('--python') + 1].endsWith(path.join('env', 'Scripts', 'python.exe')))
  })

  await t('installazione: la configurazione di uv e Python dell\'utente non conta', () => {
    const env = uvEnv('C:/dati/voice', { PATH: 'x', UV_INDEX_URL: 'https://altro', PIP_INDEX_URL: 'https://altro', PYTHONPATH: 'C:/x', VIRTUAL_ENV: 'C:/v' })
    assert.equal(env.PATH, 'x')
    assert.equal(env.UV_INDEX_URL, undefined)
    assert.equal(env.PIP_INDEX_URL, undefined)
    assert.equal(env.PYTHONPATH, undefined)
    assert.equal(env.VIRTUAL_ENV, undefined)
    assert.equal(env.UV_NO_CONFIG, '1')
    assert.ok(env.UV_CACHE_DIR.startsWith(path.join('C:/dati/voice', 'xtts')))
  })

  await t('requirements.txt: ogni pacchetto a versione fissa e con hash', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'xtts', 'requirements.txt'), 'utf8')
    const entries = text.split(/\n(?=[A-Za-z0-9])/).filter(e => !e.startsWith('#') && e.trim())
    assert.ok(entries.length > 50)
    for (const e of entries) {
      assert.match(e, /^[A-Za-z0-9_.-]+(\[[^\]]+\])?==\S+/, 'versione fissa: ' + e.split('\n')[0])
      assert.match(e, /--hash=sha256:[0-9a-f]{64}/, 'hash: ' + e.split('\n')[0])
    }
    assert.match(text, /^torch==2\.6\.0\+cu124 /m)
    assert.match(text, /^coqui-tts==0\.27\.5 /m)
    assert.match(text, /^transformers==4\./m, 'la 5.x rompe coqui-tts 0.27.5')
  })

  await t('file scaricati: indirizzi fissati e hash', () => {
    for (const f of [...XTTS_FILES, ...UV_FILES]) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/)
      assert.ok(/\/resolve\/[0-9a-f]{40}\/|\/releases\/download\/\d+\.\d+\.\d+\//.test(f.url), f.url)
    }
  })

  await t('senza installazione: non installato', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-xtts-'))
    assert.equal(xttsInstalled(dir), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  console.log('=== ' + passed + ' test superati ===')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
