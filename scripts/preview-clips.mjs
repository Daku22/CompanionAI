// preview-clips.mjs — guarda delle clip .vrma su un avatar vero, con schermate.
//
// Avvia l'app con home e dati finti (come audit.mjs), mette le clip nella
// libreria delle animazioni, sceglie l'avatar e fa eseguire ogni clip,
// salvando tre schermate a tempi diversi. Non tocca config e dati veri.
//
// Uso:
//   node scripts/preview-clips.mjs [--vrm Fred] [--out <cartella>] clip.vrma=wave altra.vrma=sit-enter ...
//   Il nome dopo "=" e' lo slot, con la fase se serve (sit-enter, sit-exit).
//   --play sit,idle: invece di una clip alla volta, esegue questi gesti in
//   ordine (per vedere entrata, ciclo e uscita di fila).
//   --times 600,2000,3600: quando scattare le schermate, in ms dall'avvio.
//
// Esce con codice 1 se una clip non parte.

import { spawn } from 'node:child_process'
import { killTree } from './lib/kill-tree.mjs'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9337
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] }
const VRM = opt('--vrm') || 'Fred'
const OUT = path.resolve(opt('--out') || path.join(os.tmpdir(), 'companion-preview'))
// Lo slot puo' portare la fase: "sit-enter" -> sit-enter-preview-0.vrma, gesto sit.
const TIMES = (opt('--times') || '600,2000,3600').split(',').map(Number)
const clips = argv.filter((a, i) => a.includes('=') && !argv[i - 1]?.startsWith('--')).map((a, i) => {
  const [file, slot] = a.split('=')
  return { file: path.resolve(file), slot, name: slot + '-preview-' + i + '.vrma', animation: slot.replace(/-(enter|exit)$/, '') }
})
if (!clips.length) { console.error('uso: node scripts/preview-clips.mjs [--vrm Fred] clip.vrma=wave ...'); process.exit(2) }

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-preview-'))
const HOME = path.join(WORK, 'home')
const USER_DATA = path.join(WORK, 'userdata')
fs.mkdirSync(path.join(HOME, '.desktop-companion'), { recursive: true })
fs.writeFileSync(path.join(HOME, '.desktop-companion', 'config.json'), JSON.stringify({ provider: 'ollama', model: 'x', idleLife: false, followMouse: false, keys: {} }))
fs.mkdirSync(path.join(USER_DATA, 'animations'), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
for (const c of clips) fs.copyFileSync(c.file, path.join(USER_DATA, 'animations', c.name))
const plays = opt('--play') ? opt('--play').split(',').map(a => ({ slot: a, animation: a, name: null })) : clips

const app = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + USER_DATA], {
  cwd: ROOT, stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME, COMPANION_ONLY_USER_CLIPS: "1" },
})

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } }
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
    return r.result.result.value
  }
  return new Promise(resolve => { ws.onopen = () => resolve({ send, evaluate }) })
}

let failed = 0
try {
  let list = []
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() } catch (_) {}
    if (list.some(t => t.url.includes('companion.html'))) break
    await sleep(500)
  }
  const comp = await connect(list.find(t => t.url.includes('companion.html')))
  await sleep(3000)
  await comp.evaluate('window.__companionTest = true; true')
  await comp.evaluate(`document.getElementById('switch-zone').click(); true`)
  await sleep(300)
  await comp.evaluate(`[...document.querySelectorAll('#avatar-list .menu-item')].find(i => i.textContent.startsWith(${JSON.stringify(VRM)})).click(); true`)
  await sleep(8000)
  const shot = async (name) => {
    const s = await comp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'))
  }
  for (const [i, c] of plays.entries()) {
    await comp.evaluate(`window.companion.executeAction({ type: 'none', animation: ${JSON.stringify(c.animation)} }); true`)
    let last = 0
    for (const t of TIMES) {
      await sleep(t - last)
      last = t
      await shot(`${i}-${c.slot}-${(t / 1000).toFixed(1)}s`)
    }
    const state = await comp.evaluate('window.__companion3DTest.clips()')
    const ok = state.clip === c.name || (state.slot === c.animation && state.clip)
    if (!ok) failed++
    console.log((ok ? 'ok  ' : 'NO  ') + c.slot + ': ' + JSON.stringify(state))
    // Pausa in idle fra una clip e l'altra.
    if (plays === clips) {
      await comp.evaluate(`window.companion.executeAction({ type: 'none', animation: 'idle' }); true`)
      await sleep(1500)
    }
  }
} catch (error) {
  failed++
  console.error('anteprima interrotta: ' + error.message)
} finally {
  killTree(app)
  await sleep(1000)
  try { fs.rmSync(WORK, { recursive: true, force: true }) } catch (_) {}
}
console.log('schermate in ' + OUT)
process.exit(failed ? 1 : 0)
