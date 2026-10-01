// test-live2d-core.js — il Cubism Core scaricato al primo uso (src/main/live2d-core.js).
// Zip finto con la struttura dello SDK, servito da un server locale: niente rete.
const assert = require('node:assert/strict')
const { execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { installCore, removeCore, coreInstalled, coreFileIfValid, SDK_ZIP, CORE, SDK_VERSION } = require('../src/main/live2d-core')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Cubism Core di Live2D ===')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-live2d-'))
  // Lo zip finto: la stessa struttura di CubismSdkForWeb-5-r.4.zip.
  const src = path.join(work, 'src')
  const coreDir = path.join(src, 'CubismSdkForWeb-' + SDK_VERSION, 'Core')
  fs.mkdirSync(coreDir, { recursive: true })
  const coreText = Buffer.from('var Live2DCubismCore = {}; // finto\n')
  fs.writeFileSync(path.join(coreDir, CORE.name), coreText)
  fs.writeFileSync(path.join(coreDir, 'LICENSE.md'), 'licenza finta\n')
  fs.writeFileSync(path.join(coreDir, 'RedistributableFiles.txt'), 'live2dcubismcore.min.js\n')
  const zip = path.join(work, 'sdk.zip')
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', src, 'CubismSdkForWeb-' + SDK_VERSION])
  const zipBuf = fs.readFileSync(zip)
  const pack = [{ ...SDK_ZIP[0], size: zipBuf.length, sha256: sha(zipBuf) }]
  const core = { name: CORE.name, size: coreText.length, sha256: sha(coreText) }

  const server = http.createServer((req, res) => {
    if (req.url === '/' + pack[0].path) { res.end(zipBuf); return }
    res.statusCode = 404; res.end()
  })
  await new Promise(r => server.listen(0, '127.0.0.1', () => r(null)))
  const baseUrl = 'http://127.0.0.1:' + /** @type {import('net').AddressInfo} */ (server.address()).port + '/'
  const dir = path.join(work, 'live2d')
  try {
    await t('indirizzo e hash fissati, versione nel nome dello zip', () => {
      assert.match(SDK_ZIP[0].url, /^https:\/\/cubism\.live2d\.com\/sdk-web\/bin\/CubismSdkForWeb-5-r\.4\.zip$/)
      assert.match(SDK_ZIP[0].sha256, /^[0-9a-f]{64}$/)
      assert.match(CORE.sha256, /^[0-9a-f]{64}$/)
    })

    await t('prima di installarlo non c\'e\'', () => {
      assert.equal(coreInstalled(dir), false)
      assert.equal(coreFileIfValid(dir), null)
    })

    await t('installazione: Core e licenza estratti, lo zip cancellato', async () => {
      const steps = []
      await installCore(dir, { baseUrl, pack, core, onProgress: p => steps.push(p.step) })
      assert.ok(steps.includes('download') && steps.includes('extract'))
      assert.deepEqual(fs.readFileSync(path.join(dir, CORE.name)), coreText)
      assert.ok(fs.existsSync(path.join(dir, 'LICENSE.md')))
      assert.ok(!fs.existsSync(path.join(dir, 'download')), 'lo zip non resta')
      assert.ok(!fs.existsSync(path.join(dir, 'tmp')))
    })

    await t('il Core si serve solo se l\'hash e\' quello atteso', () => {
      // Il Core finto ha un altro hash da quello vero: coreFileIfValid lo rifiuta.
      assert.equal(coreFileIfValid(dir), null)
      // Al suo posto uno della misura giusta ma diverso: rifiutato anche lui.
      fs.writeFileSync(path.join(dir, CORE.name), Buffer.alloc(CORE.size, 0x20))
      assert.equal(coreFileIfValid(dir), null)
      assert.equal(coreInstalled(dir), true, 'installato (misura giusta), ma non servito')
    })

    await t('uno zip diverso da quello atteso non si installa', async () => {
      removeCore(dir)
      const bad = [{ ...pack[0], sha256: 'f'.repeat(64) }]
      await assert.rejects(installCore(dir, { baseUrl, pack: bad, core }), /diverso da quello atteso/)
      assert.equal(coreInstalled(dir), false)
    })

    await t('un Core diverso dentro lo zip non si installa', async () => {
      await assert.rejects(installCore(dir, { baseUrl, pack, core: { ...core, sha256: '0'.repeat(64) } }), /non e' quello atteso/)
      assert.equal(coreInstalled(dir), false)
      assert.ok(!fs.existsSync(path.join(dir, CORE.name)))
    })

    await t('rimozione: via Core, licenza e segno', async () => {
      await installCore(dir, { baseUrl, pack, core })
      removeCore(dir)
      assert.equal(coreInstalled(dir), false)
      assert.ok(!fs.existsSync(path.join(dir, CORE.name)))
      assert.ok(!fs.existsSync(path.join(dir, 'LICENSE.md')))
    })
  } finally {
    server.close()
    fs.rmSync(work, { recursive: true, force: true })
  }
  console.log('=== ' + passed + ' test superati ===')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
