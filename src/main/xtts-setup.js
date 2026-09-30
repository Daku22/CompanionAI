// xtts-setup.js — installa la voce XTTS-v2 al primo uso.
//
// XTTS gira con PyTorch, cioe' Python: niente di tutto questo sta
// nell'installer dell'app. Dalle Impostazioni, dopo che l'utente ha accettato
// la licenza del modello (CPML, solo uso non commerciale), si installa in
// %APPDATA%\CompanionAI\voice\xtts:
//   1. uv (Astral), un solo eseguibile, versione e SHA-256 fissati;
//   2. Python 3.10, un'installazione sua che non tocca quella del sistema;
//   3. i pacchetti di requirements.txt, tutti a versione fissa e con hash
//      (--require-hashes: un pacchetto diverso da quello atteso non entra);
//   4. il modello, da Hugging Face a un commit fisso, con SHA-256;
//   5. una prima accensione del servizio, che dice se c'e' la GPU.
// "Disinstalla" cancella la cartella. I campioni della voce restano.
//
// Il microfono (faster-whisper) si aggiunge dopo, se l'utente lo vuole, nello
// stesso ambiente: pochi pacchetti in piu' (requirements-stt.txt) e il modello
// Whisper large-v3-turbo, anch'esso a un commit fisso e con SHA-256.

const { spawn, execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { downloadPack, packStatus } = require('./voice-assets')

const INSTALL_VERSION = 1            // se cambiano pacchetti o modello, si reinstalla
const PYTHON_VERSION = '3.10.21'
const UV_VERSION = '0.12.21'
const XTTS_REV = '6c2b0d75eae4b7047358e3b6bd9325f857d43f77'
const HF = 'https://huggingface.co/coqui/XTTS-v2/resolve/' + XTTS_REV + '/'
const PYPI = 'https://pypi.org/simple'
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu124'
// Quanto scaricano i pacchetti (PyTorch con CUDA e il resto), per la barra.
const PACKAGES_BYTES = 3.2e9
const STT_VERSION = 1                // se cambiano pacchetti o modello del microfono, si reinstalla
const WHISPER_REV = '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf'
const HF_WHISPER = 'https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/resolve/' + WHISPER_REV + '/'
const STT_PACKAGES_BYTES = 1.7e8

/** @type {import('./voice-assets').AssetFile[]} */
const UV_FILES = [
  { path: 'xtts/uv/uv.zip', url: 'https://github.com/astral-sh/uv/releases/download/' + UV_VERSION + '/uv-x86_64-pc-windows-msvc.zip', size: 17992232, sha256: '5d223efa0bf00208c3853246af09420419dfbd352536aa6bb8163d6170e23890' },
]

/** @type {import('./voice-assets').AssetFile[]} */
const XTTS_FILES = [
  { path: 'xtts/model/model.pth', url: HF + 'model.pth', size: 1867929118, sha256: 'c7ea20001c6a0a841c77e252d8409f6a74fb423e79b3206a0771ba5989776187' },
  { path: 'xtts/model/speakers_xtts.pth', url: HF + 'speakers_xtts.pth', size: 7754818, sha256: 'f0f6137c19a4eab0cbbe4c99b5babacf68b1746e50da90807708c10e645b943b' },
  { path: 'xtts/model/vocab.json', url: HF + 'vocab.json', size: 361219, sha256: '928260878a59da8a72a2a5b7687fea29d5106137669d90945430fe17e415304a' },
  { path: 'xtts/model/config.json', url: HF + 'config.json', size: 4368, sha256: 'ef262b1454dd2a77e1461b0b2cd53e19b8a7624cc131b837d36df67356bc75e8' },
  { path: 'xtts/model/LICENSE.txt', url: HF + 'LICENSE.txt', size: 4014, sha256: '190f6d7c19b8984f91b97712b94ce92d2b2e640fc677dacab966e955ece9d043' },
]

/** @type {import('./voice-assets').AssetFile[]} */
const WHISPER_FILES = [
  { path: 'xtts/whisper/model.bin', url: HF_WHISPER + 'model.bin', size: 1617884929, sha256: 'e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da' },
  { path: 'xtts/whisper/config.json', url: HF_WHISPER + 'config.json', size: 2263, sha256: 'b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e' },
  { path: 'xtts/whisper/preprocessor_config.json', url: HF_WHISPER + 'preprocessor_config.json', size: 340, sha256: '7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711' },
  { path: 'xtts/whisper/tokenizer.json', url: HF_WHISPER + 'tokenizer.json', size: 2710337, sha256: '297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd' },
  { path: 'xtts/whisper/vocabulary.json', url: HF_WHISPER + 'vocabulary.json', size: 1068114, sha256: 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1' },
]

const STT_STEPS = [
  { id: 'packages', label: 'Installo faster-whisper' },
  { id: 'model', label: 'Scarico il modello Whisper' },
  { id: 'check', label: 'Accendo il microfono per la prima volta' },
]

const STEPS = [
  { id: 'uv', label: 'Scarico uv' },
  { id: 'python', label: 'Installo Python 3.10' },
  { id: 'packages', label: 'Installo PyTorch e XTTS' },
  { id: 'model', label: 'Scarico il modello XTTS-v2' },
  { id: 'check', label: 'Accendo la voce per la prima volta' },
]

const root = (voiceDir) => path.join(voiceDir, 'xtts')
const uvExe = (voiceDir) => path.join(root(voiceDir), 'uv', 'uv.exe')
const envPython = (voiceDir) => path.join(root(voiceDir), 'env', 'Scripts', 'python.exe')
const markerPath = (voiceDir) => path.join(root(voiceDir), 'installed.json')
const sttMarkerPath = (voiceDir) => path.join(root(voiceDir), 'stt.json')

/**
 * Ambiente per uv: tutto dentro la cartella della voce, e nessuna
 * configurazione dell'utente (uv.toml, variabili UV_*) che cambi cosa si
 * installa.
 */
function uvEnv(voiceDir, base = process.env) {
  const env = {}
  for (const [k, v] of Object.entries(base)) if (!/^(UV_|PIP_|PYTHON|VIRTUAL_ENV|CONDA)/i.test(k)) env[k] = v
  return {
    ...env,
    UV_NO_CONFIG: '1',
    UV_CACHE_DIR: path.join(root(voiceDir), 'cache'),
    UV_PYTHON_INSTALL_DIR: path.join(root(voiceDir), 'python'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_LINK_MODE: 'copy',
    UV_NO_PROGRESS: '1',
  }
}

/**
 * I comandi di uv, in ordine (argomenti, senza l'eseguibile).
 * sttPackages: i pacchetti del microfono, senza dipendenze (sono gia' quelle di
 * XTTS) e senza l'indice di PyTorch, che qui non serve.
 */
function uvCommands(voiceDir, requirements, sttRequirements = requirements) {
  return {
    python: ['python', 'install', PYTHON_VERSION],
    venv: ['venv', path.join(root(voiceDir), 'env'), '--python', PYTHON_VERSION],
    // --compile-bytecode: senza, Python compila tutti i pacchetti al primo
    // avvio del servizio, e la prima accensione durava quasi tre minuti.
    packages: ['pip', 'install', '--python', envPython(voiceDir), '--require-hashes', '-r', requirements,
      '--index-url', PYPI, '--extra-index-url', TORCH_INDEX, '--index-strategy', 'unsafe-best-match', '--compile-bytecode'],
    sttPackages: ['pip', 'install', '--python', envPython(voiceDir), '--require-hashes', '--no-deps', '-r', sttRequirements,
      '--index-url', PYPI, '--compile-bytecode'],
  }
}

function readMarker(voiceDir) {
  try { return JSON.parse(fs.readFileSync(markerPath(voiceDir), 'utf8')) } catch (_) { return null }
}

/** XTTS e' installato e completo (dimensioni del modello comprese). */
function xttsInstalled(voiceDir) {
  const marker = readMarker(voiceDir)
  return !!marker && marker.version === INSTALL_VERSION && fs.existsSync(envPython(voiceDir)) && packStatus(voiceDir, XTTS_FILES).installed
}

/** Il microfono e' installato: XTTS, i suoi pacchetti e il modello Whisper completo. */
function sttInstalled(voiceDir) {
  let marker = null
  try { marker = JSON.parse(fs.readFileSync(sttMarkerPath(voiceDir), 'utf8')) } catch (_) { /* assente */ }
  return !!marker && marker.version === STT_VERSION && xttsInstalled(voiceDir) && packStatus(voiceDir, WHISPER_FILES).installed
}

/** Spazio occupato da una cartella, in byte (per la barra dei pacchetti). */
function folderBytes(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { continue }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else { try { total += fs.statSync(full).size } catch (_) { /* sparito */ } }
    }
  }
  return total
}

/** Una scheda NVIDIA, dal suo nvidia-smi: { name, memoryMB } o null. */
function nvidiaGpu() {
  const candidates = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ]
  const exe = candidates.find(p => fs.existsSync(p))
  if (!exe) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(exe, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const [name, mem] = String(stdout).split(/\r?\n/)[0].split(',').map(s => s.trim())
      resolve(name ? { name, memoryMB: Number(mem) || 0 } : null)
    })
  })
}

/** Byte liberi sul disco della cartella. */
function freeBytes(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const s = fs.statfsSync(dir)
    return s.bavail * s.bsize
  } catch (_) { return null }
}

/** Un processo che si puo' fermare: le ultime righe di errore finiscono nel messaggio. */
function run(exe, args, env, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('installazione annullata'))
    const child = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail = []
    const keep = (d) => { for (const l of String(d).split(/\r?\n/).filter(Boolean)) { tail.push(l); if (tail.length > 12) tail.shift() } }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const abort = () => { try { child.kill() } catch (_) { /* gia' uscito */ } }
    if (signal) signal.addEventListener('abort', abort, { once: true })
    child.on('error', (e) => reject(new Error(path.basename(exe) + ' non si avvia: ' + e.message)))
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', abort)
      if (signal && signal.aborted) return reject(new Error('installazione annullata'))
      if (code === 0) return resolve()
      const errors = tail.filter(l => /error|errore|failed|not/i.test(l)).slice(-3)
      reject(new Error(path.basename(exe) + ' ' + args[0] + ' non riuscito (' + code + '): ' + (errors.length ? errors : tail.slice(-2)).join(' | ')))
    })
  })
}

/**
 * Installa XTTS. onProgress({ step, index, count, label, done, total }):
 * done e total in byte quando si scarica, altrimenti 0.
 * @param {string} voiceDir
 * @param {{ onProgress?: (p: any) => void, signal?: AbortSignal, baseUrl?: string,
 *   check: () => Promise<void>, requirementsSource?: string }} opts
 *   check: accende il servizio e lo prova (lo fa voice.js con XttsEngine)
 */
async function installXtts(voiceDir, opts) {
  const report = (id, done = 0, total = 0) => {
    const index = STEPS.findIndex(s => s.id === id)
    if (opts.onProgress) opts.onProgress({ step: id, index, count: STEPS.length, label: STEPS[index].label, done, total })
  }
  const signal = opts.signal
  const dir = root(voiceDir)
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true })
  fs.rmSync(markerPath(voiceDir), { force: true })
  const env = uvEnv(voiceDir)

  // 1. uv
  report('uv')
  if (!fs.existsSync(uvExe(voiceDir))) {
    await downloadPack(voiceDir, UV_FILES, { signal, baseUrl: opts.baseUrl, onProgress: ({ done, total }) => report('uv', done, total) })
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    await run(tar, ['-xf', path.join(voiceDir, UV_FILES[0].path), '-C', path.join(dir, 'uv')], process.env, signal)
    if (!fs.existsSync(uvExe(voiceDir))) throw new Error('uv non trovato nell\'archivio scaricato')
  }

  // 2. Python e l'ambiente
  report('python')
  const reqs = path.join(dir, 'app', 'requirements.txt')
  fs.copyFileSync(opts.requirementsSource || path.join(__dirname, 'xtts', 'requirements.txt'), reqs)
  const cmd = uvCommands(voiceDir, reqs)
  await run(uvExe(voiceDir), cmd.python, env, signal)
  if (!fs.existsSync(envPython(voiceDir))) await run(uvExe(voiceDir), cmd.venv, env, signal)

  // 3. pacchetti: la barra segue quanto cresce la cache di uv
  report('packages', 0, PACKAGES_BYTES)
  const cacheDir = env.UV_CACHE_DIR
  const start = folderBytes(cacheDir)
  const timer = setInterval(() => report('packages', Math.min(PACKAGES_BYTES, folderBytes(cacheDir) - start), PACKAGES_BYTES), 2000)
  try { await run(uvExe(voiceDir), cmd.packages, env, signal) } finally { clearInterval(timer) }
  report('packages', PACKAGES_BYTES, PACKAGES_BYTES)

  // 4. modello
  report('model')
  await downloadPack(voiceDir, XTTS_FILES, { signal, baseUrl: opts.baseUrl, onProgress: ({ done, total }) => report('model', done, total) })

  // 5. prima accensione
  report('check')
  await opts.check()

  fs.writeFileSync(markerPath(voiceDir), JSON.stringify({ version: INSTALL_VERSION, python: PYTHON_VERSION, uv: UV_VERSION, model: XTTS_REV, date: new Date().toISOString() }, null, 2))
  // I pacchetti scaricati servivano solo per installare: qualche GB in meno.
  fs.rmSync(cacheDir, { recursive: true, force: true })
  fs.rmSync(path.join(voiceDir, UV_FILES[0].path), { force: true })
}

/**
 * Aggiunge il microfono a XTTS gia' installato. onProgress come installXtts.
 * @param {string} voiceDir
 * @param {{ onProgress?: (p: any) => void, signal?: AbortSignal, baseUrl?: string,
 *   check: () => Promise<void>, requirementsSource?: string }} opts
 *   check: carica Whisper nel servizio (lo fa voice.js con XttsEngine)
 */
async function installStt(voiceDir, opts) {
  if (!xttsInstalled(voiceDir)) throw new Error('prima installa XTTS: il microfono usa il suo Python')
  const report = (id, done = 0, total = 0) => {
    const index = STT_STEPS.findIndex(s => s.id === id)
    if (opts.onProgress) opts.onProgress({ step: id, index, count: STT_STEPS.length, label: STT_STEPS[index].label, done, total })
  }
  const signal = opts.signal
  const dir = root(voiceDir)
  fs.rmSync(sttMarkerPath(voiceDir), { force: true })
  const env = uvEnv(voiceDir)

  // 1. pacchetti: la barra segue quanto cresce la cache di uv
  report('packages', 0, STT_PACKAGES_BYTES)
  const reqs = path.join(dir, 'app', 'requirements-stt.txt')
  fs.mkdirSync(path.dirname(reqs), { recursive: true })
  fs.copyFileSync(opts.requirementsSource || path.join(__dirname, 'xtts', 'requirements-stt.txt'), reqs)
  const cacheDir = env.UV_CACHE_DIR
  const start = folderBytes(cacheDir)
  const timer = setInterval(() => report('packages', Math.min(STT_PACKAGES_BYTES, folderBytes(cacheDir) - start), STT_PACKAGES_BYTES), 1000)
  try { await run(uvExe(voiceDir), uvCommands(voiceDir, reqs, reqs).sttPackages, env, signal) } finally { clearInterval(timer) }
  report('packages', STT_PACKAGES_BYTES, STT_PACKAGES_BYTES)

  // 2. modello
  report('model')
  await downloadPack(voiceDir, WHISPER_FILES, { signal, baseUrl: opts.baseUrl, onProgress: ({ done, total }) => report('model', done, total) })

  // 3. prima accensione
  report('check')
  await opts.check()

  fs.writeFileSync(sttMarkerPath(voiceDir), JSON.stringify({ version: STT_VERSION, model: WHISPER_REV, date: new Date().toISOString() }, null, 2))
  fs.rmSync(cacheDir, { recursive: true, force: true })
}

/**
 * Toglie il modello del microfono. I suoi pacchetti restano nell'ambiente di
 * XTTS (circa 170 MB) e se ne vanno con lui. Il servizio deve essere spento:
 * su Windows il modello caricato non si puo' cancellare.
 */
async function uninstallStt(voiceDir) {
  fs.rmSync(sttMarkerPath(voiceDir), { force: true })
  await fs.promises.rm(path.join(root(voiceDir), 'whisper'), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}

/** Toglie XTTS (ambiente, Python, modello). I campioni della voce restano. */
async function uninstallXtts(voiceDir) {
  // Prima il segno di installazione: se qualche file resta bloccato, XTTS
  // risulta comunque non installato e si puo' reinstallare sopra.
  fs.rmSync(markerPath(voiceDir), { force: true })
  await fs.promises.rm(root(voiceDir), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}

module.exports = {
  installXtts, uninstallXtts, xttsInstalled, installStt, uninstallStt, sttInstalled, nvidiaGpu, freeBytes, uvCommands, uvEnv,
  STEPS, STT_STEPS, XTTS_FILES, WHISPER_FILES, UV_FILES, INSTALL_VERSION, STT_VERSION, PYTHON_VERSION,
}
