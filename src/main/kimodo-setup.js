// kimodo-setup.js — installa Kimodo (i movimenti nuovi dalla chat) dall'app o
// dall'installer.
//
// kimodo.cpp non pubblica versioni compilate: CompanionAI ne pubblica una per
// Windows x64 con Vulkan, nella sua release su GitHub (lo zip: kmd-generate,
// le librerie ggml, il runtime di Visual C++ e le licenze; README dentro). I
// pesi arrivano da Hugging Face, a revisioni fisse e con SHA-256: il modello
// del movimento (NVIDIA Open Model License) e il codificatore del testo (Meta
// Llama 3 Community License), con i loro file di licenza. Tutto finisce in
// <userData>/kimodo con la struttura della cartella di kimodo.cpp
// (build/release, weights/), cosi' kimodo-service.js la usa com'e'.
// "Disinstalla" cancella la cartella; i movimenti gia' generati restano.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { downloadPack } = require('./voice-assets')

const INSTALL_VERSION = 1   // se cambiano programma o pesi, si reinstalla
const KIMODO_COMMIT = '5679ff19ba0a522c0b0516e9a9d402fe1af2c027'

/** @type {import('./voice-assets').AssetFile} */
const ZIP = {
  path: 'kimodo-win-x64-vulkan.zip',
  url: 'https://github.com/Daku22/CompanionAI/releases/download/v1.1.0/kimodo-win-x64-vulkan.zip',
  size: 17886299,
  sha256: '692cff54d865894e4d53a6243457343cf7b2c4effbb18a41816a90f5c5f1bd9f',
}

const HF_MOTION = 'https://huggingface.co/LocalAI-io/Kimodo-SOMA-RP-v1.1-GGML/resolve/65f8b8ab34ee7524161cc87b20ae4cb4f5d3a12d/'
const HF_TEXT = 'https://huggingface.co/LocalAI-io/Llama-3-Kimodo-GGML/resolve/3e8d958803beaddb6011ac534f2be972e2710c7d/'

/** @type {import('./voice-assets').AssetFile[]} */
const WEIGHT_FILES = [
  { path: 'weights/models/kimodo-soma-rp-v1.1-f32.gguf', url: HF_MOTION + 'models/kimodo-soma-rp-v1.1-f32.gguf', size: 1133166784, sha256: '3bf1229f4c1eff1d28f5196a854113da2df9a11a5e21c60694630903bf948ee4' },
  { path: 'weights/models/NOTICE', url: HF_MOTION + 'NOTICE', size: 163, sha256: '778107843e1cb26e19aeaabb54977a6c7e6553b099a4b6b7c4c5cfed96c21eb4' },
  { path: 'weights/Llama-3-Kimodo-Q4_K.gguf', url: HF_TEXT + 'Llama-3-Kimodo-Q4_K.gguf', size: 4389729536, sha256: 'b47f3d57c72660df7faa18338749be945e725032f1db467fe3cabf580a80e012' },
  { path: 'weights/tokenizer.gguf', url: HF_TEXT + 'tokenizer.gguf', size: 7295054, sha256: '81614aca62a98846c02b72cc2e5378e5bdce8b4d507b88f96eb1faa90dae607e' },
  { path: 'weights/LICENSE-META-LLAMA-3.txt', url: HF_TEXT + 'LICENSE-META-LLAMA-3.txt', size: 7801, sha256: '475211637354ce4c14b9c3dacccbefbaba735fe1b0db97d6c4fd11cd1356819f' },
  { path: 'weights/NOTICE', url: HF_TEXT + 'NOTICE', size: 148, sha256: '97b5a240c05ff37063fcd1701ab047b2ef51dca2447b215d10735af3bfc97eff' },
]

const TOTAL_BYTES = ZIP.size + WEIGHT_FILES.reduce((n, f) => n + f.size, 0)

// Le licenze, per i link della pagina Movimenti e dell'installer.
const LICENSES = {
  nvidia: 'https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/',
  llama: 'https://www.llama.com/llama3/license/',
  kimodo: 'https://github.com/localai-org/kimodo.cpp/blob/' + KIMODO_COMMIT + '/LICENSE',
}

const STEPS = [
  { id: 'program', label: 'Il programma' },
  { id: 'weights', label: 'I modelli' },
]

const markerPath = (dir) => path.join(dir, 'installed.json')
const exePath = (dir) => path.join(dir, 'build', 'release', 'kmd-generate.exe')

/** Kimodo e' installato qui dall'app (non quello compilato a mano): programma, pesi e segno. */
function kimodoInstalled(dir) {
  try {
    const mark = JSON.parse(fs.readFileSync(markerPath(dir), 'utf8'))
    if (mark.version !== INSTALL_VERSION) return false
  } catch (_) { return false }
  return fs.existsSync(exePath(dir)) && WEIGHT_FILES.every(f => fs.existsSync(path.join(dir, f.path)))
}

/** Lo zip con tar.exe di Windows (c'e' da Windows 10). */
function tarExtract(zip, dest, signal) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xf', zip, '-C', dest], { windowsHide: true, signal })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('tar ha risposto ' + code))))
  })
}

/**
 * Installa Kimodo in dir. onProgress({ step, index, count, label, done, total }),
 * done e total in byte su tutto quello che si scarica.
 * @param {string} dir
 * @param {{ onProgress?: (p: any) => void, signal?: AbortSignal, baseUrl?: string,
 *   fetchImpl?: typeof fetch, extract?: (zip: string, dest: string, signal?: AbortSignal) => Promise<void>,
 *   files?: { zip: import('./voice-assets').AssetFile, weights: import('./voice-assets').AssetFile[] } }} [opts]
 *   files ed extract: per le prove (file finti, niente tar)
 */
async function installKimodo(dir, opts = {}) {
  const zip = opts.files ? opts.files.zip : ZIP
  const weights = opts.files ? opts.files.weights : WEIGHT_FILES
  const total = zip.size + weights.reduce((n, f) => n + f.size, 0)
  const report = (id, done) => {
    const index = STEPS.findIndex(s => s.id === id)
    if (opts.onProgress) opts.onProgress({ step: id, index, count: STEPS.length, label: STEPS[index].label, done, total })
  }
  const pack = { signal: opts.signal, baseUrl: opts.baseUrl, fetchImpl: opts.fetchImpl }
  fs.mkdirSync(dir, { recursive: true })
  fs.rmSync(markerPath(dir), { force: true })

  // 1. il programma: lo zip della release, aperto qui
  report('program', 0)
  if (!fs.existsSync(exePath(dir))) {
    await downloadPack(dir, [zip], { ...pack, onProgress: ({ done }) => report('program', done) })
    await (opts.extract || tarExtract)(path.join(dir, zip.path), dir, opts.signal)
    fs.rmSync(path.join(dir, zip.path), { force: true })
    if (!fs.existsSync(exePath(dir))) throw new Error('kmd-generate.exe non trovato nell\'archivio scaricato')
  }

  // 2. i pesi da Hugging Face
  report('weights', zip.size)
  await downloadPack(dir, weights, { ...pack, onProgress: ({ done }) => report('weights', zip.size + done) })
  report('weights', total)

  fs.writeFileSync(markerPath(dir), JSON.stringify({ version: INSTALL_VERSION, kimodo: KIMODO_COMMIT, date: new Date().toISOString() }, null, 2))
}

/** Toglie Kimodo installato dall'app (la cartella intera). */
function uninstallKimodo(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

module.exports = { INSTALL_VERSION, KIMODO_COMMIT, ZIP, WEIGHT_FILES, TOTAL_BYTES, LICENSES, STEPS, kimodoInstalled, installKimodo, uninstallKimodo }
