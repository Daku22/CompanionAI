// voice-assets.js — i file della voce locale, scaricati al primo uso.
//
// Nell'installer e nel repo non c'e' nessun modello: la voce si scarica
// quando la si accende, dalle Impostazioni, da indirizzi fissati qui. Ogni file
// ha il suo SHA-256: un file diverso (troncato, cambiato alla fonte) viene
// scartato invece di essere usato. Gli indirizzi sono a una versione precisa:
// Hugging Face a un commit, jsDelivr a una versione del pacchetto npm.
//
// Kokoro (Apache-2.0): modello fp16 e le due voci italiane. espeak-ng
// (GPL-3.0) trasforma il testo italiano in fonemi: gira nel processo della
// voce (kokoro-worker.js), mai nel main.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const KOKORO_REV = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/' + KOKORO_REV + '/'
const ESPEAK = 'https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/'

/** @typedef {{ path: string, url: string, size: number, sha256: string }} AssetFile */

/** @type {AssetFile[]} */
const KOKORO_FILES = [
  { path: 'kokoro/model_fp16.onnx', url: HF + 'onnx/model_fp16.onnx', size: 163234740, sha256: 'ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a' },
  { path: 'kokoro/tokenizer.json', url: HF + 'tokenizer.json', size: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'kokoro/voices/if_sara.bin', url: HF + 'voices/if_sara.bin', size: 522240, sha256: '409b69248798fcdc2542330c76953d230710f19b057e59cb82fdc3c4cf71265c' },
  { path: 'kokoro/voices/im_nicola.bin', url: HF + 'voices/im_nicola.bin', size: 522240, sha256: 'bc578e510d52a96d6940d46f12e96d7b3df00905dbea075113226d100e6e1ab0' },
  // .mjs: e' un modulo ES, e fuori dal suo pacchetto npm Node non lo saprebbe.
  { path: 'espeak/espeak-ng.mjs', url: ESPEAK + 'espeak-ng.js', size: 841996, sha256: '3502d997af2640e54518a06845776c8507bfeebd8ff75f80176370e35de9896b' },
  { path: 'espeak/espeak-ng.data', url: ESPEAK + 'espeak-ng.data', size: 24014553, sha256: 'f7f8eff5685c709db9dae81e88a0e0556867d60514f7308ae99e0579369397b5' },
  // La licenza di espeak-ng accompagna il programma, come chiede la GPL.
  { path: 'espeak/COPYING', url: ESPEAK + 'COPYING', size: 35147, sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903' },
]

/**
 * Cosa c'e' su disco. Si guarda solo la dimensione: l'hash si controlla
 * scaricando, rileggere 160 MB a ogni avvio sarebbe lento.
 * @param {string} dir
 * @param {AssetFile[]} files
 */
function packStatus(dir, files) {
  let have = 0
  const missing = []
  for (const f of files) {
    let size = -1
    try { size = fs.statSync(path.join(dir, f.path)).size } catch (_) { /* assente */ }
    if (size === f.size) have += f.size
    else missing.push(f.path)
  }
  const total = files.reduce((n, f) => n + f.size, 0)
  return { installed: missing.length === 0, have, total, missing }
}

/**
 * Scarica i file che mancano. onProgress({ file, done, total }) con i byte di
 * tutto il pacchetto. Un file con l'hash sbagliato non resta su disco.
 * @param {string} dir
 * @param {AssetFile[]} files
 * @param {{ onProgress?: (p: { file: string, done: number, total: number }) => void,
 *   signal?: AbortSignal, fetchImpl?: typeof fetch, baseUrl?: string }} [opts]
 *   baseUrl: solo per i test, sostituisce la fonte (file.path in coda)
 */
async function downloadPack(dir, files, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch
  const status = packStatus(dir, files)
  let done = status.have
  const total = status.total
  const report = (file) => { if (opts.onProgress) opts.onProgress({ file, done, total }) }
  for (const f of files) {
    if (!status.missing.includes(f.path)) continue
    const dest = path.join(dir, f.path)
    const part = dest + '.part'
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })
    const url = opts.baseUrl ? opts.baseUrl + f.path : f.url
    const res = await fetchImpl(url, { signal: opts.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(f.path + ': risposta ' + res.status + ' da ' + new URL(url).host)
    const hash = crypto.createHash('sha256')
    const out = fs.createWriteStream(part)
    const started = done
    let bytes = 0
    try {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk)
        bytes += buf.length
        if (bytes > f.size) throw new Error(f.path + ': piu\' grande del previsto')
        hash.update(buf)
        if (!out.write(buf)) await new Promise(r => out.once('drain', r))
        done = started + bytes
        report(f.path)
      }
      await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())))
      const got = hash.digest('hex')
      if (bytes !== f.size || got !== f.sha256) throw new Error(f.path + ': file diverso da quello atteso (hash ' + got.slice(0, 12) + '…)')
      await fs.promises.rename(part, dest)
    } catch (error) {
      out.destroy()
      await fs.promises.rm(part, { force: true }).catch(() => {})
      throw error
    }
  }
  return packStatus(dir, files)
}

/** Toglie i file del pacchetto (e i .part rimasti), non il resto della cartella. */
async function removePack(dir, files) {
  for (const f of files) {
    const dest = path.join(dir, f.path)
    await fs.promises.rm(dest, { force: true }).catch(() => {})
    await fs.promises.rm(dest + '.part', { force: true }).catch(() => {})
  }
  return packStatus(dir, files)
}

module.exports = { KOKORO_FILES, packStatus, downloadPack, removePack }
