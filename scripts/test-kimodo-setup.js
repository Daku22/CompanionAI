// test-kimodo-setup.js — installare Kimodo (kimodo-setup.js) e i componenti
// chiesti dall'installer (setup-components.js).
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const K = require('../src/main/kimodo-setup')
const { parseComponents } = require('../src/main/setup-components')

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Installare Kimodo ===')

  await t('programma e pesi a versioni fisse, con SHA-256 e misura', () => {
    assert.match(K.ZIP.url, /^https:\/\/github\.com\/Daku22\/CompanionAI\/releases\/download\/v[\d.]+\/kimodo-win-x64-vulkan\.zip$/)
    for (const f of [K.ZIP, ...K.WEIGHT_FILES]) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path)
      assert.ok(f.size > 0, f.path)
      assert.ok(!f.path.includes('..') && !path.isAbsolute(f.path), f.path)
    }
    // I pesi da Hugging Face a un commit, non da "main" (che puo' cambiare).
    for (const f of K.WEIGHT_FILES) assert.match(f.url, /^https:\/\/huggingface\.co\/LocalAI-io\/[\w.-]+\/resolve\/[0-9a-f]{40}\//, f.path)
    // Proprio i file che kimodo-service.js cerca.
    const paths = K.WEIGHT_FILES.map(f => f.path)
    assert.ok(paths.includes('weights/models/kimodo-soma-rp-v1.1-f32.gguf') && paths.includes('weights/Llama-3-Kimodo-Q4_K.gguf') && paths.includes('weights/tokenizer.gguf'))
    assert.ok(K.TOTAL_BYTES > 5.4e9 && K.TOTAL_BYTES < 5.7e9, 'circa 5,5 GB: ' + K.TOTAL_BYTES)
  })

  await t('l\'installazione scarica, apre lo zip, prende i pesi e segna; poi niente di nuovo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-setup-'))
    try {
      const content = { 'pack.zip': Buffer.from('zip finto'), 'weights/a.gguf': Buffer.from('pesi A'), 'weights/b.gguf': Buffer.from('pesi B piu lunghi') }
      const file = (p) => ({ path: p, url: 'https://example.test/' + p, size: content[p].length, sha256: crypto.createHash('sha256').update(content[p]).digest('hex') })
      const files = { zip: file('pack.zip'), weights: [file('weights/a.gguf'), file('weights/b.gguf')] }
      const asked = []
      const fetchImpl = async (url) => {
        const p = url.replace('https://example.test/', '')
        asked.push(p)
        return { ok: true, status: 200, body: (async function * () { yield content[p] })() }
      }
      const extract = async (zip, dest) => {
        assert.ok(fs.existsSync(zip), 'lo zip c\'e\' quando si apre')
        fs.mkdirSync(path.join(dest, 'build', 'release'), { recursive: true })
        fs.writeFileSync(path.join(dest, 'build', 'release', 'kmd-generate.exe'), 'exe')
      }
      const progress = []
      await K.installKimodo(dir, { files, fetchImpl, extract, onProgress: (p) => progress.push(p) })
      assert.deepEqual(asked, ['pack.zip', 'weights/a.gguf', 'weights/b.gguf'])
      assert.ok(!fs.existsSync(path.join(dir, 'pack.zip')), 'lo zip non resta')
      assert.ok(fs.existsSync(path.join(dir, 'installed.json')))
      const last = progress[progress.length - 1]
      assert.equal(last.done, last.total, 'la barra arriva in fondo')
      assert.deepEqual([...new Set(progress.map(p => p.step))], ['program', 'weights'])
      // Una seconda volta: programma e pesi ci sono gia', non si scarica niente.
      asked.length = 0
      await K.installKimodo(dir, { files, fetchImpl, extract })
      assert.deepEqual(asked, [])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await t('un file diverso da quello atteso si rifiuta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-setup-'))
    try {
      const good = Buffer.from('zip vero')
      const files = { zip: { path: 'pack.zip', url: 'https://example.test/pack.zip', size: good.length, sha256: crypto.createHash('sha256').update(good).digest('hex') }, weights: [] }
      const fetchImpl = async () => ({ ok: true, status: 200, body: (async function * () { yield Buffer.from('zip male') })() })
      await assert.rejects(() => K.installKimodo(dir, { files, fetchImpl, extract: async () => {} }), /diverso da quello atteso/)
      assert.equal(K.kimodoInstalled(dir), false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await t('installato solo con il segno, il programma e i pesi', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-setup-'))
    try {
      assert.equal(K.kimodoInstalled(dir), false)
      fs.mkdirSync(path.join(dir, 'build', 'release'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'build', 'release', 'kmd-generate.exe'), 'exe')
      for (const f of K.WEIGHT_FILES) { fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true }); fs.writeFileSync(path.join(dir, f.path), 'x') }
      assert.equal(K.kimodoInstalled(dir), false, 'senza il segno no')
      fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ version: K.INSTALL_VERSION }))
      assert.equal(K.kimodoInstalled(dir), true)
      fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ version: K.INSTALL_VERSION + 1 }))
      assert.equal(K.kimodoInstalled(dir), false, 'una versione diversa si reinstalla')
      K.uninstallKimodo(dir)
      assert.ok(!fs.existsSync(dir))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await t('dall\'installer: i componenti chiesti, in ordine, il microfono con XTTS', () => {
    assert.deepEqual(parseComponents(['app.exe']), [])
    assert.deepEqual(parseComponents(['app.exe', '--install-components=kimodo,xtts,']), ['xtts', 'kimodo'])
    assert.deepEqual(parseComponents(['app.exe', '--install-components=stt']), ['xtts', 'stt'], 'il microfono usa il Python di XTTS')
    assert.deepEqual(parseComponents(['app.exe', '--install-components=boh,../x,KIMODO']), ['kimodo'], 'solo quelli conosciuti')
  })

  console.log('=== ' + passed + ' test superati ===')
}

main().catch((err) => { console.error('  FALLITO  ' + err.message); process.exitCode = 1 })
