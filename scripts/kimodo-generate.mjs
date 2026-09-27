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
//   Una serie: --series scripts/kimodo-series.json --out <cartella>. Ogni voce
//   e' una clip o una sequenza (entrata, ciclo, uscita) generata in una sola
//   richiesta e poi tagliata, cosi' le fasi si raccordano. Le voci con
//   "loop" si tagliano nel tratto che si ripete meglio e si chiudono.
//
//   --keep-raw: salva anche l'uscita grezza (<nome>.root.f32, <nome>.rot.f32)
//   nella sottocartella raw/, per riconvertire senza rigenerare:
//   --from-raw <cartella raw> --out <cartella> converte quei file e basta.
//
// Stampa i tempi: primo avvio (caricamento del modello) e ogni generazione.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { kimodoClip, KIMODO_FPS, sliceMotion, findLoop, closeLoop } from '../src/renderer/kimodo-raw.js'
import { retargetClip, writeVRMA } from '../src/renderer/motion-retarget.js'

// Fotogrammi di raccordo fra i segmenti di una sequenza.
const TRANSITION = 5

async function main() {
  const argv = process.argv.slice(2)
  /** @type {Record<string, string>} */
  const opts = {}
  const prompts = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep-raw') opts['keep-raw'] = 'si'
    else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i]
    else prompts.push(argv[i])
  }
  if (opts['from-raw'] && opts.out) { fromRaw(opts['from-raw'], opts.out); return }
  if ((!prompts.length && !opts.series) || !opts.out) {
    console.error('uso: node scripts/kimodo-generate.mjs --out <file.vrma|cartella> [--seconds 4] [--steps 100] [--seed 1] "prompt" ...')
    console.error('     node scripts/kimodo-generate.mjs --series scripts/kimodo-series.json --out <cartella> [--only nome]')
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

  // Richieste: ognuna e' una lista di segmenti { out, seconds, prompt, loop }.
  /** @type {{ out: string, seconds: number, prompt: string, loop?: boolean }[][]} */
  let requests
  let outDir = null
  if (opts.series) {
    const series = JSON.parse(fs.readFileSync(opts.series, 'utf8'))
    requests = series.clips.map(c => c.sequence || [c])
    if (opts.only) requests = requests.filter(r => r.some(s => s.out.includes(opts.only)))
    outDir = opts.out
  } else {
    requests = prompts.map((prompt, n) => [{ out: prompts.length > 1 ? 'clip-' + n + '.vrma' : opts.out, seconds, prompt }])
    if (prompts.length > 1) outDir = opts.out
  }
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
  let failed = 0
  for (const [n, segments] of requests.entries()) {
    const dir = path.join(work, 'clip-' + n)
    fs.mkdirSync(dir)
    // transizione, passi, seme, cartella, poi coppie fotogrammi / file del prompt
    const fields = [TRANSITION, steps, seed, dir]
    for (const [i, s] of segments.entries()) {
      const promptFile = path.join(dir, 'prompt-' + i + '.txt')
      fs.writeFileSync(promptFile, s.prompt)
      fields.push(Math.round(s.seconds * KIMODO_FPS), promptFile)
    }
    const start = Date.now()
    server.stdin.write(fields.join('\t') + '\n')
    const reply = await nextReply()
    const took = (Date.now() - start) / 1000
    if (!reply.startsWith('OK')) { console.error('Kimodo: ' + reply + '  (' + segments.map(s => s.out).join(', ') + ')'); failed++; continue }
    if (first) { console.log('primo avvio (caricamento + generazione): ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s'); first = false }
    const read = (name) => new Float32Array(new Uint8Array(fs.readFileSync(path.join(dir, name))).buffer)
    const allRoot = read('root_positions.f32')
    const allRot = read('local_rotations_xyzw.f32')
    const total = allRoot.length / 3
    console.log(`generata in ${took.toFixed(1)} s: ${total} fotogrammi`)

    // I segmenti si susseguono: ognuno occupa i suoi fotogrammi, l'ultimo
    // prende anche quelli in piu' o in meno della sequenza.
    let from = 0
    for (const [i, s] of segments.entries()) {
      const count = Math.round(s.seconds * KIMODO_FPS)
      const to = i === segments.length - 1 ? total - 1 : Math.min(total - 1, from + count - 1)
      const { rootPositions, rotations } = sliceMotion(allRoot, allRot, from, to)
      from = to + 1
      const out = outDir ? path.join(outDir, s.out) : s.out
      if (opts['keep-raw'] !== undefined) {
        const raw = path.join(path.dirname(path.resolve(out)), 'raw')
        fs.mkdirSync(raw, { recursive: true })
        const stem = path.join(raw, path.basename(out, '.vrma'))
        fs.writeFileSync(stem + '.root.f32', Buffer.from(rootPositions.buffer))
        fs.writeFileSync(stem + '.rot.f32', Buffer.from(rotations.buffer))
      }
      convert(rootPositions, rotations, out, s.prompt, !!s.loop)
    }
  }
  server.stdin.end()
  await new Promise(r => server.on('exit', r))
  fs.rmSync(work, { recursive: true, force: true })
  console.log('totale: ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s' + (failed ? ', ' + failed + ' richieste fallite' : ''))
  if (failed) process.exitCode = 1
}

/**
 * Uscita grezza -> .vrma. Un ciclo si taglia nel tratto che si ripete meglio
 * e si chiude.
 */
function convert(rootPositions, rotations, out, prompt, loop) {
  let note = ''
  if (loop) {
    const frames = rootPositions.length / 3
    const found = findLoop(rootPositions, rotations, { minFrames: Math.max(30, Math.floor(frames / 2)) })
    ;({ rootPositions, rotations } = sliceMotion(rootPositions, rotations, found.from, found.to))
    closeLoop(rootPositions, rotations)
    note = `, ciclo ${found.from}-${found.to} (scarto ${found.distance.toFixed(3)})`
  }
  const { root, clip } = kimodoClip(rootPositions, rotations, { name: prompt.slice(0, 60) })
  const vrma = Buffer.from(writeVRMA(retargetClip(root, clip)))
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, vrma)
  console.log(`  -> ${out}: ${(rootPositions.length / 3)} fotogrammi${note}, ${(vrma.length / 1024).toFixed(0)} KB  "${prompt}"`)
}

/** Riconverte l'uscita grezza salvata con --keep-raw. Con --series sa quali sono cicli. */
function fromRaw(rawDir, outDir) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--series')
  const loops = new Set()
  const prompts = new Map()
  if (i !== -1) {
    for (const c of JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')).clips) {
      for (const s of c.sequence || [c]) { if (s.loop) loops.add(s.out); prompts.set(s.out, s.prompt) }
    }
  }
  const read = (f) => new Float32Array(new Uint8Array(fs.readFileSync(f)).buffer)
  for (const file of fs.readdirSync(rawDir).filter(f => f.endsWith('.root.f32'))) {
    const name = file.replace(/\.root\.f32$/, '.vrma')
    const stem = path.join(rawDir, file.replace(/\.root\.f32$/, ''))
    convert(read(stem + '.root.f32'), read(stem + '.rot.f32'), path.join(outDir, name), prompts.get(name) || name, loops.has(name))
  }
}

main()
