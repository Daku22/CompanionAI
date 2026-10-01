// live2d-core.js — il Cubism Core di Live2D, scaricato al primo uso.
//
// Gli avatar Live2D (Cubism 3, 4 e 5) hanno bisogno del Cubism Core, un file
// JavaScript di Live2D Inc. sotto la Live2D Proprietary Software License: non
// sta nell'app ne' nel repo. Dalle Impostazioni, dopo che l'utente ha accettato
// la licenza, si scarica lo zip ufficiale del Cubism SDK for Web a una
// versione fissa (il nome dello zip contiene la versione, quindi il suo
// SHA-256 non cambia), se ne estrae solo il Core con la sua licenza e lo zip
// si cancella. Il Core resta in <userData>/live2d, e la pagina del companion
// lo carica da live2d://core/, servito dal main dopo aver ricontrollato
// l'hash (coreFileIfValid).
//
// Il Cubism Framework, il resto del codice Live2D, sta invece nella libreria
// untitled-pixi-live2d-engine (Live2D Open Software License), copiata da
// vendor.js.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { downloadPack } = require('./voice-assets')

const SDK_VERSION = '5-r.5'
const SDK_DIR = 'CubismSdkForWeb-' + SDK_VERSION
/** @type {import('./voice-assets').AssetFile[]} */
const SDK_ZIP = [
  { path: 'download/' + SDK_DIR + '.zip', url: 'https://cubism.live2d.com/sdk-web/bin/' + SDK_DIR + '.zip', size: 20708681, sha256: '67064a7fb1812cf502f5c4a03bfe12cc638c75a621bb4acf06bb28763df06ba0' },
]
// Il Core dentro lo zip: Core 06.00.0001.
const CORE = { name: 'live2dcubismcore.min.js', size: 228042, sha256: '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47' }
const LICENSE_URL = 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'
const STEPS = [
  { id: 'download', label: 'Scarico il Cubism SDK for Web ' + SDK_VERSION },
  { id: 'extract', label: 'Estraggo il Cubism Core' },
]

const corePath = (dir) => path.join(dir, CORE.name)
const markerPath = (dir) => path.join(dir, 'installed.json')

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Il Core e' installato: il segno e un file della dimensione giusta (l'hash lo controlla chi lo serve). */
function coreInstalled(dir) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath(dir), 'utf8'))
    return marker.sdk === SDK_VERSION && fs.statSync(corePath(dir)).size === CORE.size
  } catch (_) { return false }
}

// L'hash si ricalcola solo se il file cambia: si serve a ogni avatar Live2D.
let checked = { mtime: 0, ok: false }
/** Il percorso del Core se e' proprio quello atteso, altrimenti null. */
function coreFileIfValid(dir) {
  const file = corePath(dir)
  let stat
  try { stat = fs.statSync(file) } catch (_) { return null }
  if (stat.size !== CORE.size) return null
  if (checked.mtime !== stat.mtimeMs) checked = { mtime: stat.mtimeMs, ok: sha256File(file) === CORE.sha256 }
  return checked.ok ? file : null
}

/** tar.exe di Windows: legge anche gli zip (quello di Git Bash no). */
function extract(zip, outDir, entries, signal) {
  return new Promise((resolve, reject) => {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const child = spawn(tar, ['-xf', zip, '-C', outDir, ...entries], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    const abort = () => { try { child.kill() } catch (_) { /* gia' uscito */ } }
    if (signal) signal.addEventListener('abort', abort, { once: true })
    child.on('error', (e) => reject(new Error('tar non si avvia: ' + e.message)))
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', abort)
      if (signal && signal.aborted) return reject(new Error('installazione annullata'))
      if (code === 0) resolve()
      else reject(new Error('estrazione non riuscita (' + code + '): ' + err.trim().split(/\r?\n/).slice(-1)[0]))
    })
  })
}

/**
 * Scarica lo zip, ne estrae Core e licenza, controlla l'hash del Core.
 * @param {string} dir <userData>/live2d
 * @param {{ onProgress?: (p: any) => void, signal?: AbortSignal, baseUrl?: string,
 *   pack?: import('./voice-assets').AssetFile[], core?: { name: string, size: number, sha256: string } }} [opts]
 *   baseUrl, pack, core: solo per i test (fonte, zip e Core finti)
 */
async function installCore(dir, opts = {}) {
  const pack = opts.pack || SDK_ZIP
  const core = opts.core || CORE
  const report = (id, done = 0, total = 0) => {
    const index = STEPS.findIndex(s => s.id === id)
    if (opts.onProgress) opts.onProgress({ step: id, index, count: STEPS.length, label: STEPS[index].label, done, total })
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.rmSync(markerPath(dir), { force: true })
  report('download', 0, pack[0].size)
  await downloadPack(dir, pack, { signal: opts.signal, baseUrl: opts.baseUrl, onProgress: ({ done, total }) => report('download', done, total) })

  report('extract')
  const tmp = path.join(dir, 'tmp')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  try {
    const zip = path.join(dir, pack[0].path)
    await extract(zip, tmp, [SDK_DIR + '/Core/' + core.name, SDK_DIR + '/Core/LICENSE.md', SDK_DIR + '/Core/RedistributableFiles.txt'], opts.signal)
    const got = path.join(tmp, SDK_DIR, 'Core', core.name)
    if (!fs.existsSync(got) || sha256File(got) !== core.sha256) throw new Error('il Cubism Core nello zip non e\' quello atteso')
    fs.copyFileSync(got, corePath(dir))
    fs.copyFileSync(path.join(tmp, SDK_DIR, 'Core', 'LICENSE.md'), path.join(dir, 'LICENSE.md'))
    fs.copyFileSync(path.join(tmp, SDK_DIR, 'Core', 'RedistributableFiles.txt'), path.join(dir, 'RedistributableFiles.txt'))
    fs.writeFileSync(markerPath(dir), JSON.stringify({ sdk: SDK_VERSION, core: core.sha256, date: new Date().toISOString() }, null, 2))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    // Lo zip (20 MB) serviva solo per il Core (230 KB).
    fs.rmSync(path.join(dir, 'download'), { recursive: true, force: true })
  }
}

/** Toglie il Core: gli avatar Live2D non si potranno mostrare finche' non torna. */
function removeCore(dir) {
  fs.rmSync(markerPath(dir), { force: true })
  for (const f of [CORE.name, 'LICENSE.md', 'RedistributableFiles.txt']) fs.rmSync(path.join(dir, f), { force: true })
  fs.rmSync(path.join(dir, 'download'), { recursive: true, force: true })
  checked = { mtime: 0, ok: false }
}

module.exports = { installCore, removeCore, coreInstalled, coreFileIfValid, SDK_ZIP, CORE, SDK_VERSION, STEPS, LICENSE_URL }
