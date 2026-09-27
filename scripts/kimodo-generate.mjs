// kimodo-generate.mjs — genera clip con Kimodo in locale e le salva in .vrma.
//
// Usa kmd-generate di kimodo.cpp in modalita' --server: il modello si carica
// una volta, poi ogni riga su stdin e' una richiesta. Il risultato (rotazioni
// locali e bacino, scheletro SOMA 30) passa da kimodo-raw.js, retargetClip e
// writeVRMA: lo stesso percorso dell'import.
//
// Uso:
//   node scripts/kimodo-generate.mjs --out <file.vrma> [--seconds 4] [--steps 100]
//        [--seed 1] [--kimodo %USERPROFILE%\kimodo] "A person waves hello."
//   Piu' prompt di fila: un testo fra virgolette per clip, e --out diventa
//   una cartella.
//
// Stampa i tempi: primo avvio (caricamento del modello) e ogni generazione.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { kimodoClip, KIMODO_FPS } from '../src/renderer/kimodo-raw.js'
import { retargetClip, writeVRMA } from '../src/renderer/motion-retarget.js'

async function main() {
  const argv = process.argv.slice(2)
  /** @type {Record<string, string>} */
  const opts = {}
  const prompts = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]
    else prompts.push(argv[i])
  }
  if (!prompts.length || !opts.out) {
    console.error('uso: node scripts/kimodo-generate.mjs --out <file.vrma|cartella> [--seconds 4] [--steps 100] [--seed 1] "prompt" ...')
    process.exit(2)
  }
  const KIMODO = path.resolve(opts.kimodo || path.join(os.homedir(), 'kimodo'))
  const build = path.join(KIMODO, 'build', 'release')
  const exe = path.join(build, 'kmd-generate.exe')
  const motionModel = path.join(KIMODO, 'weights', 'models', 'kimodo-soma-rp-v1.1-f32.gguf')
  const textModel = path.join(KIMODO, 'weights', 'Llama-3-Kimodo-Q4_K.gguf')
  for (const f of [exe, motionModel, textModel]) if (!fs.existsSync(f)) { console.error('manca ' + f); process.exit(1) }

  const seconds = Number(opts.seconds || 4)
  const steps = Number(opts.steps || 100)
  const seed = Number(opts.seed || 1)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kimodo-'))

  const t0 = Date.now()
  // Le DLL di ggml (Vulkan compreso) stanno in build/release/bin.
  const env = { ...process.env, PATH: path.join(build, 'bin') + path.delimiter + process.env.PATH }
  const server = spawn(exe, ['--server', motionModel, textModel], { cwd: KIMODO, env, stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = readline.createInterface({ input: server.stdout })
  const replies = []
  let waiting = null
  lines.on('line', (line) => { if (waiting) { const w = waiting; waiting = null; w(line) } else replies.push(line) })
  server.on('exit', (code) => { if (waiting) waiting('ERR\tkmd-generate uscito con codice ' + code) })
  const nextReply = () => new Promise(resolve => { if (replies.length) resolve(replies.shift()); else waiting = resolve })

  let first = true
  for (const [n, prompt] of prompts.entries()) {
    const dir = path.join(work, 'clip-' + n)
    fs.mkdirSync(dir)
    const promptFile = path.join(dir, 'prompt.txt')
    fs.writeFileSync(promptFile, prompt)
    const frames = Math.round(seconds * KIMODO_FPS)
    const start = Date.now()
    // transizione, passi, seme, cartella, fotogrammi, file del prompt
    server.stdin.write([5, steps, seed, dir, frames, promptFile].join('\t') + '\n')
    const reply = await nextReply()
    const took = (Date.now() - start) / 1000
    if (!reply.startsWith('OK')) { console.error('Kimodo: ' + reply); continue }
    if (first) { console.log('primo avvio (caricamento + generazione): ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s'); first = false }
    const read = (name) => new Float32Array(new Uint8Array(fs.readFileSync(path.join(dir, name))).buffer)
    const { root, clip } = kimodoClip(read('root_positions.f32'), read('local_rotations_xyzw.f32'), { name: prompt.slice(0, 60) })
    const vrma = Buffer.from(writeVRMA(retargetClip(root, clip)))
    const out = prompts.length > 1 ? path.join(opts.out, 'clip-' + n + '.vrma') : opts.out
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    fs.writeFileSync(out, vrma)
    const [, framesDone, joints] = reply.split('\t')
    console.log(`generata in ${took.toFixed(1)} s: ${framesDone} fotogrammi, ${joints} ossa -> ${out} (${(vrma.length / 1024).toFixed(0)} KB)  "${prompt}"`)
  }
  server.stdin.end()
  await new Promise(r => server.on('exit', r))
  fs.rmSync(work, { recursive: true, force: true })
}

main()
