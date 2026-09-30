// test-voice-assets.js — file della voce scaricati al primo uso (src/main/voice-assets.js).
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { KOKORO_FILES, packStatus, downloadPack, removePack } = require('../src/main/voice-assets')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== File della voce ===')
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'companion-voice-'))

  // Un "pacchetto" piccolo, servito da un server locale.
  const big = crypto.randomBytes(300 * 1024)
  const small = Buffer.from('ciao')
  const served = { 'm/modello.bin': big, 'm/testo.txt': small, 'm/rotto.bin': Buffer.from('non e\' lui') }
  const server = http.createServer((req, res) => {
    const body = served[decodeURIComponent(req.url.slice(1))]
    if (!body) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-length': body.length })
    // A pezzi, come una rete vera.
    let i = 0
    const next = () => { if (i >= body.length) return res.end(); res.write(body.subarray(i, i + 64 * 1024)); i += 64 * 1024; setImmediate(next) }
    next()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/'
  const pack = [
    { path: 'm/modello.bin', url: 'https://esempio.invalid/modello.bin', size: big.length, sha256: sha(big) },
    { path: 'm/testo.txt', url: 'https://esempio.invalid/testo.txt', size: small.length, sha256: sha(small) },
  ]

  try {
    await t('i file ufficiali hanno dimensione e hash, e indirizzi fissati', () => {
      assert.ok(KOKORO_FILES.length >= 6)
      for (const f of KOKORO_FILES) {
        assert.match(f.sha256, /^[0-9a-f]{64}$/)
        assert.ok(f.size > 0)
        assert.ok(/^https:\/\/(huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\/|cdn\.jsdelivr\.net\/npm\/[^/]+\/[^/]+@\d)/.test(f.url), f.url)
      }
    })

    await t('prima del download: niente installato', () => {
      const s = packStatus(dir, pack)
      assert.equal(s.installed, false)
      assert.deepEqual(s.missing, ['m/modello.bin', 'm/testo.txt'])
      assert.equal(s.total, big.length + small.length)
    })

    await t('scarica, verifica e segnala l\'avanzamento', async () => {
      const progress = []
      const s = await downloadPack(dir, pack, { baseUrl, onProgress: p => progress.push(p) })
      assert.equal(s.installed, true)
      assert.ok(fs.readFileSync(path.join(dir, 'm/modello.bin')).equals(big))
      assert.ok(progress.length > 2)
      assert.equal(progress[progress.length - 1].done, s.total)
      assert.ok(progress.every((p, i) => i === 0 || p.done >= progress[i - 1].done), 'l\'avanzamento non torna indietro')
    })

    await t('un file gia\' presente non si riscarica', async () => {
      let calls = 0
      const counting = (url, o) => { calls++; return fetch(url, o) }
      await downloadPack(dir, pack, { baseUrl, fetchImpl: counting })
      assert.equal(calls, 0)
    })

    await t('un file con l\'hash sbagliato non resta su disco', async () => {
      const bad = [{ path: 'm/rotto.bin', url: 'x', size: served['m/rotto.bin'].length, sha256: sha(Buffer.from('altro')) }]
      await assert.rejects(downloadPack(dir, bad, { baseUrl }), /diverso da quello atteso/)
      assert.equal(fs.existsSync(path.join(dir, 'm/rotto.bin')), false)
      assert.equal(fs.existsSync(path.join(dir, 'm/rotto.bin.part')), false)
    })

    await t('una risposta 404 da\' un errore chiaro', async () => {
      const gone = [{ path: 'm/manca.bin', url: 'x', size: 1, sha256: '0'.repeat(64) }]
      await assert.rejects(downloadPack(dir, gone, { baseUrl }), /risposta 404/)
    })

    await t('elimina solo i file del pacchetto', async () => {
      fs.writeFileSync(path.join(dir, 'm', 'altro.txt'), 'resta')
      const s = await removePack(dir, pack)
      assert.equal(s.installed, false)
      assert.equal(fs.existsSync(path.join(dir, 'm', 'altro.txt')), true)
    })
  } finally {
    server.close()
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
  console.log('=== ' + passed + ' test superati ===')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
