// audit.mjs — verifica dall'interno dell'app vera, senza toccare i dati veri.
//
// smoke.mjs controlla che ogni avatar si carichi. Questo script controlla che
// le funzioni facciano davvero cio' che promettono: una richiesta in chat
// deve muovere l'avatar nel verso chiesto, con qualunque tipo di modello.
//
// Home, cartella dati e OpenRouter sono finti: un server locale imita quattro
// modelli (schema JSON, modalita' JSON, soli tools come Laguna S 2.1, sola
// prosa) e risponde in base al messaggio. OPENROUTER_URL lo accetta solo verso
// 127.0.0.1, vedi openRouterUrl() in ai-router.js.
//
// Uso:
//   npm run audit                    schermate nella temp di sistema
//   npm run audit -- --out <cartella>
//   npm run audit -- --vrm Neko      il 3D con un altro modello (predefinito Fred)
//   npm run audit -- --bvh <file>    la clip "sedersi" da un BVH di Kimodo (predefinita:
//                                    scripts/fixtures/kimodo-soma77-sit.bvh)
//   npm run audit -- --kimodo <dir>  anche un movimento generato davvero da Kimodo
//                                    (kimodo.cpp e pesi in <dir>, docs/kimodo-locale.md)
//   npm run audit -- --voice <dir>   la voce Kokoro (cartella voice con i suoi file)
//   npm run audit -- --xtts <dir>    XTTS installato (cartella voice dell'app)
//   npm run audit -- --xtts <dir> --mic [--mic-wav <file>]
//                                    anche il microfono (installato con XTTS): il
//                                    microfono finto di Chromium dice una frase
//                                    italiana, di base generata con la voce
//                                    italiana di Windows (System.Speech)
//
// Esce con codice 1 se un controllo fallisce.

import { spawn, execFileSync } from 'node:child_process'
import { killTree } from './lib/kill-tree.mjs'
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { retargetClip, writeVRMA } from '../src/renderer/motion-retarget.js'
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import { mixamoSource, dir, v } from './lib/skeletons.mjs'
import { SOMA30 } from '../src/renderer/kimodo-raw.js'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { AvatarLibrary } = require('../src/main/AvatarLibrary.js')
const { SceneLibrary } = require('../src/main/SceneLibrary.js')
const PORT = 9336
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] }
const VRM = opt('--vrm') || 'Fred'
const KIMODO = opt('--kimodo') ? path.resolve(opt('--kimodo')) : null
// La voce Kokoro: i suoi file (180 MB) non stanno nel repo, quindi la prova e'
// facoltativa. Cartella con la struttura di %APPDATA%\CompanionAI\voice.
const VOICE = opt('--voice') ? path.resolve(opt('--voice')) : null
// XTTS installato (circa 7 GB): la cartella voice dell'app, con xtts\ e
// samples\. Non si copia: si collega con una junction.
const XTTS = opt('--xtts') ? path.resolve(opt('--xtts')) : null
// Il microfono vive nell'ambiente di XTTS: serve --xtts.
const MIC = argv.includes('--mic')
if (MIC && !XTTS) { console.error('--mic richiede --xtts <cartella voice>'); process.exit(2) }
const OUT = path.resolve(opt('--out') || path.join(os.tmpdir(), 'companion-audit'))
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-audit-'))
const HOME = path.join(WORK, 'home')
const USER_DATA = path.join(WORK, 'userdata')
fs.mkdirSync(OUT, { recursive: true })

// ── Modelli finti ────────────────────────────────────────────────────────────
const MODELS = {
  'audit/schema:free': ['structured_outputs', 'response_format', 'max_tokens'],
  'audit/json:free': ['response_format', 'max_tokens'],
  'audit/tools:free': ['tools', 'tool_choice', 'reasoning', 'max_tokens'],   // come Laguna S 2.1
  'audit/prosa:free': ['max_tokens'],
}
// Cosa risponderebbe un modello ben fatto a ogni richiesta.
const REPLIES = {
  'corri fino al bordo sinistro': { reply: 'Corro!', emotion: 'joy', action: { type: 'none', animation: 'run-to', direction: 'left', distance: 'edge' } },
  'cammina verso destra': { reply: 'Vado a destra.', emotion: 'calm', action: { type: 'none', animation: 'walk-to', direction: 'right', distance: 'medium' } },
  'siediti qui': { reply: 'Mi siedo.', emotion: 'calm', action: { type: 'none', animation: 'sit' } },
  'salutami': { reply: 'Ciao!', emotion: 'joy', action: { type: 'none', animation: 'wave' } },
  // Una risposta lunga, da interrompere parlando nel microfono.
  'raccontami una storia': { reply: 'C\'era una volta una piccola barca che voleva vedere il mare aperto. Ogni mattina guardava l\'orizzonte e sognava isole lontane, pesci colorati e tramonti rossi. Un giorno il vento cambiò, e la barca finalmente partì.', emotion: 'joy', action: { type: 'none', animation: 'idle' } },
  'fai un inchino': { reply: 'Ci provo!', emotion: 'joy', action: { type: 'none', animation: 'idle', motion: 'A person does a deep, polite bow.' } },
}
const requests = []
const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/v1/models') {
      res.end(JSON.stringify({ data: Object.entries(MODELS).map(([id, params]) => ({ id, name: id, supported_parameters: params })) }))
      return
    }
    const payload = JSON.parse(body)
    requests.push(payload)
    const last = [...payload.messages].reverse().find(m => m.role === 'user')?.content || ''
    const answer = REPLIES[last.trim().toLowerCase()] || { reply: 'Ok.', action: { type: 'none', animation: 'idle' } }
    let message
    if (payload.model === 'audit/tools:free') {
      message = { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'rispondi_companion', arguments: JSON.stringify(answer) } }] }
    } else if (payload.model === 'audit/prosa:free') {
      message = { content: answer.reply + ' (in prosa, senza JSON)' }
    } else {
      message = { content: JSON.stringify(answer) }
    }
    res.end(JSON.stringify({ choices: [{ message }] }))
  })
})
await new Promise(r => fake.listen(0, '127.0.0.1', () => r(null)))
const FAKE_URL = 'http://127.0.0.1:' + /** @type {import('net').AddressInfo} */ (fake.address()).port

// ── Dati finti: config, un avatar PNG importato ──────────────────────────────
fs.mkdirSync(path.join(HOME, '.desktop-companion'), { recursive: true })
fs.writeFileSync(path.join(HOME, '.desktop-companion', 'config.json'), JSON.stringify({
  provider: 'openrouter', model: 'audit/tools:free', idleLife: false, keys: { openrouter: 'sk-or-audit' },
  ...(KIMODO ? { kimodo: true, kimodoDir: KIMODO } : {}),
}))
if (VOICE) fs.cpSync(VOICE, path.join(USER_DATA, 'voice'), { recursive: true })
if (XTTS) {
  fs.mkdirSync(path.join(USER_DATA, 'voice'), { recursive: true })
  for (const sub of ['xtts', 'samples']) {
    if (fs.existsSync(path.join(XTTS, sub))) fs.symlinkSync(path.join(XTTS, sub), path.join(USER_DATA, 'voice', sub), 'junction')
  }
}
const png = path.join(WORK, 'immagine-importata.png')
fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), png)
const library = new AvatarLibrary(path.join(USER_DATA, 'avatars'))
const scan = await library.scan(png)
const imported = await library.commit(scan.token, scan.candidates[0].id)

// Una scena importata come quelle di Sketchfab: OBJ con il suo .mtl, in
// centimetri, con un tavolo al centro. Stanza 6 x 3 x 6 m nelle unita' vere.
function objRoom() {
  const lines = ['# stanza per l\'audit', 'mtllib stanza audit.mtl']
  let base = 1
  const box = (name, material, [x0, y0, z0], [x1, y1, z1]) => {
    lines.push('o ' + name, 'usemtl ' + material)
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) lines.push(`v ${x} ${y} ${z}`)
    // Vertici: indice = x*4 + y*2 + z (0 o 1), piu' base.
    const f = (...ids) => lines.push('f ' + ids.map(i => i + base).join(' '))
    f(0, 1, 3, 2); f(4, 6, 7, 5); f(0, 4, 5, 1); f(2, 3, 7, 6); f(0, 2, 6, 4); f(1, 5, 7, 3)
    base += 8
  }
  box('pavimento', 'legno', [-300, -2, -300], [300, 0, 300])
  box('parete-n', 'muro', [-300, 0, -310], [300, 300, -300])
  box('parete-s', 'muro', [-300, 0, 300], [300, 300, 310])
  box('parete-o', 'muro', [-310, 0, -300], [-300, 300, 300])
  box('parete-e', 'muro', [300, 0, -300], [310, 300, 300])
  box('tavolo', 'legno', [-80, 0, -45], [80, 75, 45])
  return lines.join('\n') + '\n'
}
const sceneDir = path.join(WORK, 'scena-audit')
fs.mkdirSync(sceneDir, { recursive: true })
fs.writeFileSync(path.join(sceneDir, 'stanza audit.obj'), objRoom())
fs.writeFileSync(path.join(sceneDir, 'stanza audit.mtl'), 'newmtl legno\nKd 0.55 0.36 0.2\nnewmtl muro\nKd 0.8 0.78 0.72\n')
const sceneLibrary = new SceneLibrary(path.join(USER_DATA, 'scenes'))
const sceneScan = await sceneLibrary.scan(sceneDir)
const importedScene = await sceneLibrary.commit(sceneScan.token, sceneScan.candidates[0].id)

// Una clip "wave" in .vrma, convertita da uno scheletro Mixamo in A-pose: il
// braccio sinistro si alza dritto e resta su per quattro secondi.
const src = mixamoSource()
const up = new THREE.Quaternion().setFromUnitVectors(dir(src.bones.mixamorigLeftArm, src.bones.mixamorigLeftForeArm), v(0, 1, 0))
const waveClip = new THREE.AnimationClip('audit-wave', 4, [
  new THREE.QuaternionKeyframeTrack('mixamorigLeftArm.quaternion', [0, 0.4, 4], [0, 0, 0, 1, ...up.toArray(), ...up.toArray()]),
])
fs.mkdirSync(path.join(USER_DATA, 'animations'), { recursive: true })
fs.writeFileSync(path.join(USER_DATA, 'animations', 'wave-audit.vrma'), Buffer.from(writeVRMA(retargetClip(src.root, waveClip))))

// Il "sedersi" di Kimodo come entrata dello slot sit: si siede e resta seduto.
const sitBvh = new BVHLoader().parse(fs.readFileSync(path.resolve(opt('--bvh') || path.join(ROOT, 'scripts', 'fixtures', 'kimodo-soma77-sit.bvh')), 'utf8'))
const sitRoot = new THREE.Group()
sitRoot.add(sitBvh.skeleton.bones[0])
const sitMotion = retargetClip(sitRoot, sitBvh.clip)
fs.writeFileSync(path.join(USER_DATA, 'animations', 'sit-enter-kimodo.vrma'), Buffer.from(writeVRMA(sitMotion)))

// Fred senza le estensioni VRM: un glTF qualsiasi con scheletro umano, come
// quelli esportati da Blender. Deve animarsi lo stesso.
function stripVrm(file, out) {
  const b = fs.readFileSync(file)
  const jsonLength = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + jsonLength).toString())
  const binStart = 20 + jsonLength
  const bin = b.subarray(binStart + 8, binStart + 8 + b.readUInt32LE(binStart))
  const noVrm = (ext) => { if (ext) for (const k of Object.keys(ext)) if (k.startsWith('VRMC_') || k === 'VRM') delete ext[k] }
  noVrm(json.extensions)
  for (const item of [...(json.materials || []), ...(json.nodes || [])]) noVrm(item.extensions)
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (json[key]) json[key] = json[key].filter(e => !e.startsWith('VRMC_') && e !== 'VRM')
  let text = Buffer.from(JSON.stringify(json))
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)])
  const pad = Buffer.alloc((4 - (bin.length % 4)) % 4)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length + pad.length, 8)
  const chunk = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c }
  fs.writeFileSync(out, Buffer.concat([header, chunk(text.length, 0x4e4f534a), text, chunk(bin.length + pad.length, 0x004e4942), bin, pad]))
}
const plainGlb = path.join(WORK, 'umanoide-gltf.glb')
stripVrm(path.join(ROOT, 'modelli-3d', 'Fred', 'Fred_optimized.vrm'), plainGlb)
const gltfScan = await library.scan(plainGlb)
const gltfAvatar = await library.commit(gltfScan.token, gltfScan.candidates[0].id)

// Il microfono finto: una frase italiana, poi 3 s di silenzio (Chromium
// ripete il file finche' il microfono e' aperto).
const MIC_PHRASE = 'Ciao, come stai oggi? Raccontami qualcosa di bello sul mare.'
function micWav() {
  const wav = path.join(WORK, 'microfono.wav')
  if (opt('--mic-wav')) fs.copyFileSync(path.resolve(opt('--mic-wav')), wav)
  else {
    execFileSync('powershell', ['-NoProfile', '-Command', [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'it*' } | Select-Object -First 1",
      "if (-not $v) { throw 'nessuna voce italiana di Windows: usa --mic-wav' }",
      '$s.SelectVoice($v.VoiceInfo.Name)',
      '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
      `$s.SetOutputToWaveFile('${wav}', $f)`,
      `$s.Speak('${MIC_PHRASE.replace(/'/g, "''")}')`,
      '$s.Dispose()',
    ].join('; ')], { stdio: 'inherit' })
  }
  const b = fs.readFileSync(wav)
  const at = b.indexOf('data') + 8
  const padded = Buffer.concat([b, Buffer.alloc(b.readUInt32LE(28) * 3)])
  padded.writeUInt32LE(padded.length - 8, 4)
  padded.writeUInt32LE(padded.length - at, at - 4)
  fs.writeFileSync(wav, padded)
  return wav
}
const micArgs = MIC ? ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + micWav()] : []

const app = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + USER_DATA, ...micArgs], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, USERPROFILE: HOME, HOME, OPENROUTER_URL: FAKE_URL, COMPANION_ONLY_USER_CLIPS: "1" },
})

// ── Protocollo DevTools ──────────────────────────────────────────────────────
function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } else events.push(msg)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(method + ': nessuna risposta')) }, 20000)
    pending.set(n, (msg) => { clearTimeout(timer); resolve(msg) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
    return r.result.result.value
  }
  return new Promise(resolve => { ws.onopen = () => resolve({ send, evaluate, events }) })
}
const IGNORED = [/Electron Security Warning/]
const problems = (events) => events.map(e => {
  if (e.method === 'Runtime.exceptionThrown') return e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') return e.params.entry.text
  if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') return e.params.args.map(a => a.value ?? a.description).join(' ')
  return null
}).filter(t => t && !IGNORED.some(re => re.test(t)))

const results = []
const check = (ok, text) => { results.push({ ok, text }); console.log((ok ? 'ok  ' : 'NO  ') + text) }

let comp, chat
async function say(text) {
  const before = await chat.evaluate(`document.querySelectorAll('.msg.assistant').length`)
  await comp.evaluate('window.__trig = []')
  await chat.evaluate(`document.getElementById('input').value = ${JSON.stringify(text)}; document.getElementById('send-btn').click(); true`)
  for (let i = 0; i < 80; i++) {
    if (await chat.evaluate(`document.querySelectorAll('.msg.assistant').length`) > before) break
    await sleep(250)
  }
  await sleep(400)
  return comp.evaluate('window.__trig.filter(a => a.animation !== "think")')
}
async function waitIdle(ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if ((await comp.evaluate('window.__trig')).some(a => a.animation === 'idle')) return true
    await sleep(300)
  }
  return false
}
const screenX = () => comp.evaluate('window.screenX')
const setModel = (model) => chat.evaluate(`window.companion.setConfig({ model: ${JSON.stringify(model)} }).then(c => c.model)`)
const shot = async (name) => {
  const s = await comp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'))
}
const bubble = () => comp.evaluate(`document.getElementById('bubble').textContent`)

// ── Microfono (solo con --mic) ───────────────────────────────────────────────
// Clic veri (Input.dispatchMouseEvent) sul pulsante, tenuto premuto.
async function press(page, sel) {
  const at = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 })
  return at
}
const release = (page, at) => page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 })
const speaking = async () => (await comp.evaluate('window.__companion3DTest.voice()')).speaking
async function newUserMessage(before, ms) {
  for (let t = 0; t < ms; t += 100) {
    const all = await chat.evaluate(`[...document.querySelectorAll('.msg.user')].map(m => m.textContent)`)
    if (all.length > before) return all[all.length - 1]
    await sleep(100)
  }
  return null
}
async function auditMic() {
  await chat.evaluate(`window.companion.setConfig({ voice: { micEnabled: true, micDevice: '' } }).then(c => c.voice.micEnabled)`)
  let st = null
  for (let i = 0; i < 120 && !(st && st.stt.ready); i++) { await sleep(500); st = await chat.evaluate('window.companion.voiceStatus()') }
  check(!!st && st.stt.ready, 'microfono: Whisper pronto nel servizio (' + (st ? st.xtts.loaded.join(', ') : '?') + ')')
  if (!st || !st.stt.ready) return
  if (await chat.evaluate('document.visibilityState !== "visible"')) { await chat.evaluate('window.companion.toggleChat(); true'); await sleep(800) }
  const users = async () => (await chat.evaluate(`document.querySelectorAll('.msg.user').length`))

  // Tieni premuto 🎙, parla, lascia.
  let before = await users()
  let at = await press(chat, '#mic-btn')
  await sleep(1500)
  const b = await bubble()
  check(/ascolto/i.test(b), 'microfono: mentre ascolta il companion dice "' + b + '"')
  await sleep(4500)
  const released = Date.now()
  await release(chat, at)
  let got = await newUserMessage(before, 30000)
  check(/mare/i.test(got || ''), 'microfono: "' + got + '" in chat ' + (Date.now() - released) + ' ms dopo il rilascio')
  check(requests.some(r => JSON.stringify(r.messages).toLowerCase().includes('mare')), 'microfono: il modello riceve quello che hai detto')

  // Mentre racconta una storia lunga si preme 🎙: tace subito, e ascolta.
  await sleep(2000)
  await say('raccontami una storia')
  let talking = false
  for (let i = 0; i < 300 && !talking; i++) { talking = await speaking(); if (!talking) await sleep(50) }
  check(talking, 'microfono: la storia si sente')
  await sleep(1500)
  before = await users()
  at = await press(chat, '#mic-btn')
  const pressed = Date.now()
  let quiet = null
  for (let i = 0; i < 60 && quiet === null; i++) { if (!(await speaking())) quiet = Date.now() - pressed; else await sleep(50) }
  check(quiet !== null, 'microfono: premuto 🎙 il companion tace dopo ' + quiet + ' ms')
  await sleep(6000)
  await release(chat, at)
  got = await newUserMessage(before, 30000)
  check(/mare/i.test(got || ''), 'microfono: dopo averlo interrotto il messaggio parte')

  // Impostazioni, scheda Microfono: il menu dei microfoni (quelli finti di Chromium).
  await chat.evaluate('window.companion.openSettings(); true')
  let settings = null
  for (let i = 0; i < 40 && !settings; i++) {
    const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.url.includes('settings.html'))
    if (t) settings = await connect(t); else await sleep(250)
  }
  await settings.send('Runtime.enable')
  await settings.send('Log.enable')
  await sleep(1500)
  await settings.evaluate(`document.querySelector('nav .item[data-page="microfono"]').click(); true`)
  let options = []
  for (let i = 0; i < 20 && options.length < 3; i++) { await sleep(250); options = await settings.evaluate(`[...document.getElementById('mic-device').options].map(o => o.textContent)`) }
  check(options.length >= 3 && options.every(o => o), 'Impostazioni, scheda Microfono: ' + options.length + ' voci nel menu (' + options.join(' | ') + ')')
  const s = await settings.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, '4a-microfono-impostazioni.png'), Buffer.from(s.result.data, 'base64'))
  const found = problems(settings.events)
  check(found.length === 0, 'impostazioni: nessun errore in console' + (found.length ? ':\n      - ' + found.join('\n      - ') : ''))
}

// Movimento del mouse finto sulla pagina: companion-input.js decide se catturarlo.
const hover = async (x, y) => {
  await comp.evaluate(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y} })); true`)
  await sleep(250)
  return comp.evaluate(`document.body.classList.contains('hover-avatar')`)
}
const size = () => comp.evaluate('[window.innerWidth, window.innerHeight]')
async function pickAvatar(prefix) {
  await comp.evaluate(`document.getElementById('switch-zone').click(); true`)
  await sleep(300)
  await comp.evaluate(`[...document.querySelectorAll('#avatar-list .menu-item')].find(i => i.textContent.startsWith(${JSON.stringify(prefix)})).click(); true`)
}

try {
  let list = []
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() } catch (_) {}
    if (list.some(t => t.url.includes('companion.html')) && list.some(t => t.url.includes('chat.html'))) break
    await sleep(500)
  }
  comp = await connect(list.find(t => t.url.includes('companion.html')))
  chat = await connect(list.find(t => t.url.includes('chat.html')))
  for (const c of [comp, chat]) { await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable') }
  await sleep(3500)
  await comp.evaluate(`window.__trig = []; window.companion.onTriggerAnimation(a => window.__trig.push(a)); window.__companionTest = true; true`)
  const avatars = await comp.evaluate('window.companion.listAvatars()')
  const avatar2d = avatars.find(a => a.kind === 'sprite-pack') || avatars.find(a => a.kind === 'sprite')
  console.log('avatar: ' + avatars.map(a => a.name + ' (' + a.kind + ')').join(', ') + ' | 2D in prova: ' + avatar2d.name)
  await pickAvatar(avatar2d.name)
  await sleep(2500)

  // 1. Modello a soli tools (come Laguna): camminata nel verso chiesto.
  check(await setModel('audit/tools:free') === 'audit/tools:free', 'modello a soli tools selezionato')
  let x0 = await screenX()
  let trig = await say('corri fino al bordo sinistro')
  const run = trig.find(a => a.animation === 'run-to')
  check(run && run.direction === 'left', 'soli tools: "corri fino al bordo sinistro" arriva come run-to verso sinistra')
  check(requests.at(-1).tools && !requests.at(-1).response_format, 'soli tools: la richiesta usa una tool call, non response_format')
  check(requests.at(-1).max_tokens >= 8192 && requests.at(-1).reasoning, 'soli tools: modello che ragiona, budget pieno')
  await waitIdle(20000)
  let x1 = await screenX()
  console.log('    x: ' + x0 + ' -> ' + x1)
  check(x1 < x0 - 200, 'la finestra e-` andata davvero a sinistra')
  x0 = x1
  trig = await say('cammina verso destra')
  const walk = trig.find(a => a.animation === 'walk-to')
  check(walk && walk.direction === 'right', '"cammina verso destra" arriva come walk-to verso destra')
  await waitIdle(15000)
  x1 = await screenX()
  console.log('    x: ' + x0 + ' -> ' + x1)
  check(x1 > x0 + 300, 'la finestra e-` andata davvero a destra (circa 400 px)')
  trig = await say('siediti qui')
  check(trig.some(a => a.animation === 'sit'), '"siediti qui" fa sedere l-avatar')
  await shot('1-seduto-2d')

  // 1b. Il mouse sull'avatar 2D: pixel pieni catturano, vuoti lasciano passare.
  await say('salutami')
  await waitIdle(4000)
  const [w2, h2] = await size()
  check(await comp.evaluate(`window.hitTest2D(${w2 / 2}, ${h2 * 0.6})`) === true, '2D: il centro del corpo e-` sull-avatar')
  check(await comp.evaluate('window.hitTest2D(3, 3)') === false, '2D: l-angolo vuoto non e-` sull-avatar')
  check(await hover(w2 / 2, h2 * 0.6) === true, '2D: sopra l-avatar il mouse viene catturato')
  check(await hover(3, h2 - 3) === false, '2D: sul vuoto i clic passano sotto')
  await comp.evaluate('window.companion.startDrag(); true')
  await sleep(1200)
  await shot('1b-in-braccio-2d')
  check(await bubble() !== '', '2D: preso in braccio reagisce (' + await bubble() + ')')
  await comp.evaluate('window.companion.endDrag(); true')
  await sleep(600)
  const sizes = []
  for (const scale of ['l', 'm']) {
    await chat.evaluate(`window.companion.setConfig({ scale: '${scale}' })`)
    await sleep(500)
    sizes.push((await size()).join('x'))
  }
  check(sizes[0] === '240x346' && sizes[1] === '180x260', 'dimensione dal menu: grande e poi media (' + sizes.join(', ') + ')')

  // 2. Gli altri tipi di modello.
  for (const [model, expect] of [['audit/schema:free', 'json_schema'], ['audit/json:free', 'json_object']]) {
    await setModel(model)
    trig = await say('salutami')
    check(trig.some(a => a.animation === 'wave'), model + ': "salutami" fa salutare')
    check(requests.at(-1).response_format?.type === expect, model + ': richiesta con ' + expect)
  }
  check(/Nya|👋/.test(await bubble()), '2D: il fumetto del saluto viene dal pacchetto (' + await bubble() + ')')

  await setModel('audit/prosa:free')
  trig = await say('salutami')
  check(!trig.some(a => a.animation === 'wave'), 'solo prosa: nessuna animazione inventata')
  check(await chat.evaluate(`[...document.querySelectorAll('.msg.system')].some(m => m.textContent.includes('non ha risposto nel formato'))`),
    'solo prosa: la chat avvisa che il modello non manda azioni')

  // 3. Immagine importata: nessun "Nya" di Yanineko.
  await setModel('audit/json:free')
  await pickAvatar(imported.name)
  await sleep(2500)
  await say('salutami')
  const b = await bubble()
  check(!/Nya/.test(b), 'immagine importata: fumetti neutri (' + b + ')')

  // 4. 3D.
  await pickAvatar(VRM)
  await sleep(8000)
  check(await comp.evaluate('window.__threeVisible') === true, '3D: ' + VRM + ' caricato')
  trig = await say('salutami')
  check(trig.some(a => a.animation === 'wave'), '3D: "salutami" arriva al modello 3D')
  await sleep(1200)
  await shot('2-saluto-3d')

  // 4a-bis. Voce (solo con --voice): la risposta si sente e la bocca si muove.
  if (VOICE) {
    await chat.evaluate(`window.companion.setConfig({ voice: { enabled: true } }).then(c => c.voice.enabled)`)
    const asked = Date.now()
    await say('salutami')
    let heard = null
    let open = 0
    for (let i = 0; i < 200; i++) {
      const v = await comp.evaluate('window.__companion3DTest.voice()')
      if (v.speaking && heard === null) heard = Date.now() - asked
      open = Math.max(open, v.aa || 0)
      if (heard !== null && !v.speaking) break
      await sleep(50)
    }
    check(heard !== null && open > 0.2, 'voce: la risposta si sente dopo ' + heard + ' ms e la bocca si apre (' + open.toFixed(2) + ')')
    await chat.evaluate(`window.companion.setConfig({ voice: { enabled: false } }).then(c => c.voice.enabled)`)
  }

  // 4a-ter. XTTS (solo con --xtts): il servizio si accende e la risposta si sente.
  if (XTTS) {
    const sample = fs.existsSync(path.join(XTTS, 'samples')) ? fs.readdirSync(path.join(XTTS, 'samples')).find(f => /^voce-\d+\.wav$/.test(f)) : null
    const speaker = sample ? 'sample' : 'Ana Florence'
    await chat.evaluate(`window.companion.setConfig({ voice: { enabled: true, engine: 'xtts', xttsSpeaker: ${JSON.stringify(speaker)}, cpmlAccepted: true } }).then(c => c.voice.engine)`)
    let state = null
    for (let i = 0; i < 240 && state !== 'ready' && state !== 'error'; i++) { await sleep(500); state = (await chat.evaluate('window.companion.voiceStatus()')).xtts.state }
    check(state === 'ready', 'xtts: il servizio si accende (' + state + ')')
    const asked = Date.now()
    await say('salutami')
    let heard = null
    for (let i = 0; i < 300 && heard === null; i++) {
      if ((await comp.evaluate('window.__companion3DTest.voice()')).speaking) heard = Date.now() - asked
      else await sleep(50)
    }
    check(heard !== null, 'xtts: la risposta si sente con ' + (sample ? 'la voce del campione' : speaker) + ' dopo ' + heard + ' ms')
    await sleep(3000)
    if (MIC) await auditMic()
    await chat.evaluate(`window.companion.setConfig({ voice: { enabled: false, engine: 'kokoro', micEnabled: false } }).then(c => c.voice.enabled)`)
  }

  // 4b. Il mouse sul 3D: pixel del modello, sguardo, presa in braccio.
  await waitIdle(6000)
  const [w3, h3] = await size()
  check(await hover(w3 / 2, h3 * 0.45) === true, '3D: sopra il modello il mouse viene catturato')
  check(await hover(4, 4) === false, '3D: sul vuoto i clic passano sotto')
  for (const [name, x] of [['sinistra', -600], ['destra', w3 + 600]]) {
    await comp.evaluate(`window.__companion3DTest.cursor({ x: ${x}, y: ${h3 * 0.2}, follow: true }); true`)
    await sleep(1800)
    const look = await comp.evaluate('window.__companion3DTest.animator()')
    const ok = look.lookWeight > 0.9 && (name === 'sinistra' ? look.look.yaw < -0.3 : look.look.yaw > 0.3)
    check(ok, '3D: la testa segue il mouse a ' + name + ' (yaw ' + look.look.yaw.toFixed(2) + ')')
    await shot('2b-guarda-' + name)
  }
  for (const [name, y] of [['in-alto', -800], ['in-basso', h3 + 800]]) {
    await comp.evaluate(`window.__companion3DTest.cursor({ x: ${w3 / 2}, y: ${y}, follow: true }); true`)
    await sleep(1800)
    const look = await comp.evaluate('window.__companion3DTest.animator()')
    const ok = name === 'in-alto' ? look.look.pitch > 0.3 : look.look.pitch < -0.3
    check(ok, '3D: la testa segue il mouse ' + name + ' (pitch ' + look.look.pitch.toFixed(2) + ')')
    await shot('2b-guarda-' + name)
  }
  await comp.evaluate('window.__companion3DTest.cursor({ x: 90, y: 60, follow: false }); true')
  await comp.evaluate('window.companion.startDrag(); true')
  await sleep(1200)
  check((await comp.evaluate('window.__companion3DTest.animator()')).clipName === 'dangle', '3D: preso in braccio penzola')
  await shot('2c-in-braccio-3d')
  await comp.evaluate('window.companion.endDrag(); true')
  await sleep(800)
  check((await comp.evaluate('window.__companion3DTest.animator()')).clipName === 'idle', '3D: posato torna a riposo')

  // 4c. Camera: destro + trascina gira senza aprire il menu, destro fermo apre
  // il menu, la rotella zooma, doppio clic centrale rimette la camera.
  const mouse = (type, x, y, button = 'none', buttons = 0) => comp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 })
  const camera = () => comp.evaluate('window.__companion3DTest.camera()')
  const [cx, cy] = [Math.round(w3 / 2), Math.round(h3 * 0.45)]
  await comp.evaluate('window.__menuOpened = 0; true')
  const cam0 = await camera()
  await mouse('mouseMoved', cx, cy)
  await mouse('mousePressed', cx, cy, 'right', 2)
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', cx + i * 12, cy, 'right', 2); await sleep(30) }
  await mouse('mouseReleased', cx + 96, cy, 'right', 0)
  await sleep(800)
  const cam1 = await camera()
  check(Math.abs(cam1.azimuth - cam0.azimuth) > 0.3 && await comp.evaluate('window.__menuOpened') === 0,
    '3D: destro + trascina gira la camera senza aprire il menu (azimut ' + cam0.azimuth.toFixed(2) + ' -> ' + cam1.azimuth.toFixed(2) + ')')
  await shot('2d-camera-ruotata')
  await mouse('mousePressed', cx, cy, 'right', 2)
  await mouse('mouseReleased', cx, cy, 'right', 0)
  await sleep(300)
  check(await comp.evaluate('window.__menuOpened') === 1, '3D: destro senza trascinare apre il menu')
  await comp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -400 })
  await sleep(800)
  const cam2 = await camera()
  check(cam2.distance < cam1.distance - 0.2, '3D: la rotella avvicina la camera (' + cam1.distance.toFixed(2) + ' -> ' + cam2.distance.toFixed(2) + ')')
  for (let i = 0; i < 2; i++) { await mouse('mousePressed', cx, cy, 'middle', 4); await mouse('mouseReleased', cx, cy, 'middle', 0); await sleep(80) }
  await sleep(800)
  const cam3 = await camera()
  check(Math.abs(cam3.azimuth - cam0.azimuth) < 0.02 && Math.abs(cam3.distance - cam0.distance) < 0.05, '3D: doppio clic centrale rimette la camera')
  check(await comp.evaluate('window.__menuOpened') === 1, '3D: il centrale non apre il menu')

  // 4d. Stanza: la finestra diventa grande, la scena cambia con l'ora e il
  // meteo, la chat si aggancia a destra, un avatar 2D sta sopra la scena.
  const room = () => comp.evaluate('window.__companion3DTest.room()')
  await pickAvatar(VRM)
  await sleep(2500)
  await comp.evaluate(`window.companion.setView('room'); true`)
  await sleep(2500)
  const [rw, rh] = await size()
  let r = await room()
  check(r.mode === true && r.active === true && rw >= 560 && rh >= 380, 'stanza: finestra grande (' + rw + 'x' + rh + ') con la scena ' + r.scene)
  check(await comp.evaluate(`getComputedStyle(document.getElementById('room-bar')).display`) === 'flex', 'stanza: barra del titolo visibile')
  await comp.evaluate(`window.__companion3DTest.roomTime('2026-06-21T12:00:00'); true`)
  await sleep(3000)
  await shot('4a-stanza-studio')
  await chat.evaluate('window.companion.toggleChat(); true')
  await sleep(1200)
  r = await room()
  check(r.chatInset > 0, 'stanza: la chat si aggancia e la scena le lascia il lato destro (' + r.chatInset + ' px)')
  await shot('4b-stanza-con-chat')
  await chat.evaluate('window.companion.toggleChat(); true')
  await comp.evaluate(`window.__companion3DTest.roomScene('giardino'); true`)
  const lights = {}
  for (const [name, iso] of [['mezzogiorno', '2026-06-21T12:00:00'], ['tramonto', '2026-06-21T19:15:00'], ['notte', '2026-06-21T23:50:00']]) {
    await comp.evaluate(`window.__companion3DTest.roomTime(${JSON.stringify(iso)}); true`)
    await sleep(3500)
    lights[name] = await room()
    await shot('4c-giardino-' + name)
  }
  check(lights.mezzogiorno.scene === 'giardino' && lights.mezzogiorno.sun > lights.tramonto.sun && lights.tramonto.sun > lights.notte.sun,
    'giardino: il sole cala dal mezzogiorno alla notte (' + ['mezzogiorno', 'tramonto', 'notte'].map(k => lights[k].sun.toFixed(2)).join(' > ') + ')')
  check(lights.notte.night === 1 && lights.mezzogiorno.night === 0, 'giardino: di notte e\' notte, a mezzogiorno no')
  await comp.evaluate(`window.__companion3DTest.roomTime('2026-06-21T16:00:00'); window.__companion3DTest.roomWeather({ code: 63, cloudCover: 95 }, null); true`)
  await sleep(3500)
  r = await room()
  check(r.rain === true && r.snow === false, 'giardino: con la pioggia piove')
  await shot('4d-giardino-pioggia')
  await comp.evaluate(`window.__companion3DTest.roomWeather(null, null); true`)
  // Scene HDRI (modelli-3d/scenes): la foto giusta per l'ora.
  for (const [sceneId, name, iso, expect] of [
    ['collina', 'mezzogiorno', '2026-06-21T12:00:00', 'qwantani_noon_2k.hdr'],
    ['collina', 'tramonto', '2026-06-21T19:15:00', 'qwantani_sunset_2k.hdr'],
    ['collina', 'notte', '2026-06-21T23:50:00', 'qwantani_night_2k.hdr'],
    ['stanza', 'giorno', '2026-06-21T12:00:00', 'small_empty_room_1_2k.hdr'],
    ['stanza', 'notte', '2026-06-21T23:50:00', 'small_empty_room_2_2k.hdr'],
  ]) {
    await comp.evaluate(`window.__companion3DTest.roomScene(${JSON.stringify(sceneId)}); window.__companion3DTest.roomTime(${JSON.stringify(iso)}); true`)
    let variant = null
    for (let i = 0; i < 40 && variant !== expect; i++) { await sleep(250); variant = (await room()).variant }
    await sleep(1500)
    check(variant === expect, sceneId + ' (' + name + '): foto ' + variant)
    await shot('4f-' + sceneId + '-' + name)
  }
  // Scena importata (OBJ in centimetri): si carica, la stima di scala e
  // posto si salva, e l'avatar non finisce sul tavolo.
  await comp.evaluate(`window.__companion3DTest.roomScene(${JSON.stringify(importedScene.id)}); window.__companion3DTest.roomTime('2026-06-21T12:00:00'); true`)
  for (let i = 0; i < 60 && !(r = await room()).model; i++) await sleep(250)
  check(r.model === true && Math.abs(r.fit.scale - 4 / 300) < 1e-6, 'scena importata: caricata, scala stimata ' + (r.fit ? r.fit.scale.toFixed(4) : '?') + ' (centimetri)')
  const [ox, , oz] = r.fit.offset.map(n => n / r.fit.scale)
  check(Math.abs(ox) > 80 || Math.abs(oz) > 45, 'scena importata: l\'avatar non sta sul tavolo (' + (-ox).toFixed(0) + ', ' + (-oz).toFixed(0) + ' cm)')
  await sleep(700)
  const savedScene = () => JSON.parse(fs.readFileSync(path.join(USER_DATA, 'scenes', 'library.json'), 'utf8')).find(s => s.id === importedScene.id).settings
  check(!!savedScene(), 'scena importata: la stima e\' salvata nella libreria')
  await comp.evaluate('window.__companion3DTest.resetCamera(); true')
  await sleep(1200)
  await shot('4g-scena-importata')
  // Alt + destro sposta la camera invece di girarla, e non apre il menu.
  await comp.evaluate('window.__menuOpened = 0; true')
  const [sx, sy] = [Math.round(rw * 0.35), Math.round(rh * 0.5)]
  const altMouse = (type, x, y, button = 'none', buttons = 0) => comp.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1, modifiers: 1 })
  const pan0 = await camera()
  await altMouse('mouseMoved', sx, sy)
  await altMouse('mousePressed', sx, sy, 'right', 2)
  for (let i = 1; i <= 8; i++) { await altMouse('mouseMoved', sx + i * 15, sy, 'right', 2); await sleep(30) }
  await altMouse('mouseReleased', sx + 120, sy, 'right', 0)
  await sleep(800)
  const pan1 = await camera()
  const moved = Math.hypot(pan1.target[0] - pan0.target[0], pan1.target[2] - pan0.target[2])
  check(moved > 0.1 && Math.abs(pan1.azimuth - pan0.azimuth) < 0.02 && await comp.evaluate('window.__menuOpened') === 0,
    'stanza: Alt + destro sposta la camera (' + moved.toFixed(2) + ' m) senza girarla ne\' aprire il menu')
  await comp.evaluate('window.__companion3DTest.resetCamera(); true')
  // "Sistema la scena": la grandezza cambia dal vivo e si salva.
  await comp.evaluate(`document.getElementById('room-adjust').click(); true`)
  await sleep(300)
  await comp.evaluate(`{ const s = document.getElementById('adj-scale'); s.value = '1'; s.dispatchEvent(new Event('input')); } true`)
  await sleep(900)
  r = await room()
  check(Math.abs(r.fit.scale - 8 / 300) < 1e-6 && Math.abs(savedScene().scale - 8 / 300) < 1e-6, 'sistema la scena: grandezza x2 applicata e salvata')
  await shot('4h-scena-x2')
  await comp.evaluate(`document.getElementById('adj-done').click(); true`)

  // Avatar 2D nella stanza: disegnato sopra la scena, che resta viva.
  await pickAvatar('immagine-importata')
  await sleep(2500)
  const layers = await comp.evaluate(`[getComputedStyle(document.getElementById('three-mount')).display, getComputedStyle(document.getElementById('pixi-mount')).display, window.__threeVisible]`)
  check(layers[0] === 'block' && layers[1] === 'block' && layers[2] === false, 'stanza: avatar 2D sopra la scena 3D')
  await shot('4e-stanza-2d')
  await pickAvatar(VRM)
  await sleep(2500)
  await comp.evaluate(`window.__companion3DTest.roomTime(null); window.companion.setView('desktop'); true`)
  await sleep(2000)
  const [dw, dh] = await size()
  r = await room()
  check(r.mode === false && r.active === false && dw === w3 && dh === h3, 'stanza chiusa: torna la finestra piccola (' + dw + 'x' + dh + ') e trasparente')

  // 4c. Le clip .vrma: su questo VRM e su un glTF senza dati VRM.
  const armUp = () => comp.evaluate("window.__companion3DTest.boneDir('leftUpperArm', 'leftLowerArm')")
  await sleep(1000)
  await say('salutami')
  await sleep(1200)
  let clipState = await comp.evaluate('window.__companion3DTest.clips()')
  let arm = await armUp()
  check(clipState.clip === 'wave-audit.vrma' && arm && arm[1] > 0.8,
    VRM + ': "salutami" usa la clip .vrma (' + clipState.clip + ', braccio y ' + (arm ? arm[1].toFixed(2) : '?') + ')')
  await shot('3-clip-vrma-' + VRM)
  await sleep(4500)
  arm = await armUp()
  check((await comp.evaluate('window.__companion3DTest.clips()')).clip === null && arm && arm[1] < 0, 'finita la clip torna la posa a riposo (braccio y ' + (arm ? arm[1].toFixed(2) : '?') + ')')

  // 4c'. "Siediti qui" con la clip di Kimodo: si siede a terra e ci resta.
  const standing = await comp.evaluate('window.__companion3DTest.hipsY()')
  await say('siediti qui')
  for (const [label, wait] of [['inizio', 300], ['meta', sitMotion.duration * 500], ['fine', sitMotion.duration * 500 + 1500]]) {
    await sleep(wait)
    await shot('3a-seduta-' + label + '-' + VRM)
  }
  const seated = await comp.evaluate('window.__companion3DTest.hipsY()')
  const sitState = await comp.evaluate('window.__companion3DTest.clips()')
  check(sitState.clip === 'sit-enter-kimodo.vrma' && seated < standing * 0.45,
    VRM + ': "siediti qui" con la clip di Kimodo, seduto a terra (bacino ' + standing.toFixed(2) + ' -> ' + seated.toFixed(2) + ' m)')
  await sleep(2000)
  check(await comp.evaluate('window.__companion3DTest.hipsY()') < standing * 0.45, VRM + ': resta seduto dopo la fine della clip')

  // 4c''. Movimento generato da Kimodo. Prima il percorso del renderer, con
  // un'uscita sintetica (braccio sinistro che scende in due secondi); poi, con
  // --kimodo, la catena vera: chat -> campo motion -> kimodo.cpp -> clip.
  await say('alzati')
  await sleep(1500)
  const joints = SOMA30.names.length
  const frames = 60
  const rotations = new Array(frames * joints * 4).fill(0)
  const rootPositions = []
  const armDown = new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), -Math.PI / 2)
  for (let f = 0; f < frames; f++) {
    rootPositions.push(0, 1.008, 0)
    for (let j = 0; j < joints; j++) rotations[(f * joints + j) * 4 + 3] = 1
    const q = new THREE.Quaternion().slerp(armDown, Math.min(1, f / 20))
    q.toArray(rotations, (f * joints + SOMA30.names.indexOf('LeftArm')) * 4)
  }
  await comp.evaluate(`window.__companion3DTest.generated({ key: '${'0'.repeat(32)}.vrma', prompt: 'audit', rootPositions: ${JSON.stringify(rootPositions)}, rotations: ${JSON.stringify(rotations)}, play: true }).then(() => true)`)
  await sleep(1200)
  const genState = await comp.evaluate('window.__companion3DTest.clips()')
  const genArm = await comp.evaluate(`window.__companion3DTest.boneDir('leftUpperArm', 'leftLowerArm')`)
  await shot('3a-generato-' + VRM)
  check(genState.slot === 'generated' && genState.clip === '0'.repeat(32) + '.vrma' && genArm && genArm[1] < -0.6,
    VRM + ': movimento generato (uscita di Kimodo) convertito e riprodotto, braccio giu' + "'" + ' (y ' + (genArm ? genArm[1].toFixed(2) : '?') + ')')
  await sleep(1500)
  check((await comp.evaluate('window.__companion3DTest.clips()')).slot !== 'generated', 'finito il movimento generato torna a riposo')
  const lastSystem = () => requests[requests.length - 1].messages.filter(m => m.role === 'system').map(m => m.content).join(' ')
  if (!KIMODO) {
    await say('fai un inchino')
    check(!lastSystem().includes('Movimenti nuovi'), 'senza Kimodo il campo motion non si spiega al modello')
    await sleep(1500)
    check((await comp.evaluate('window.__companion3DTest.clips()')).slot !== 'generated', 'senza Kimodo un motion nella risposta non fa nulla')
  } else {
    await say('fai un inchino')
    check(lastSystem().includes('Movimenti nuovi'), 'con Kimodo il modello sa del campo motion')
    const started = Date.now()
    let state = null
    while (Date.now() - started < 180000) {
      state = await comp.evaluate('window.__companion3DTest.clips()')
      if (state.slot === 'generated' && state.clip) break
      await sleep(500)
    }
    const took = (Date.now() - started) / 1000
    await sleep(1500)
    await shot('3a-kimodo-inchino-' + VRM)
    check(state && state.slot === 'generated' && !!state.clip, VRM + ': "fai un inchino" generato da Kimodo e riprodotto in ' + took.toFixed(0) + ' s')
    await sleep(4000)
    await say('fai un inchino')
    const again = Date.now()
    while (Date.now() - again < 10000) {
      state = await comp.evaluate('window.__companion3DTest.clips()')
      if (state.slot === 'generated' && state.clip) break
      await sleep(200)
    }
    check(state.slot === 'generated' && Date.now() - again < 5000, 'la seconda volta il movimento arriva dalla cache (' + ((Date.now() - again) / 1000).toFixed(1) + ' s)')
    await sleep(4500)
  }

  await pickAvatar(gltfAvatar.name)
  await sleep(8000)
  check(await comp.evaluate('window.__companion3DTest.humanoid()') === true, 'glTF senza VRM: scheletro umano riconosciuto e animabile')
  await shot('3b-gltf-riposo')
  await say('salutami')
  await sleep(1200)
  arm = await armUp()
  check(arm && arm[1] > 0.8, 'glTF senza VRM: la stessa clip .vrma alza il braccio (y ' + (arm ? arm[1].toFixed(2) : '?') + ')')
  await shot('3c-gltf-clip')
  const [wg, hg] = await size()
  check(await hover(wg / 2, hg * 0.45) === true, 'glTF senza VRM: il mouse lo prende')

  // 4d. Import di una clip dentro l'app: conversione da glb e salvataggio.
  const glbBytes = JSON.stringify([...fs.readFileSync(path.join(USER_DATA, 'animations', 'wave-audit.vrma'))])
  const saved = await comp.evaluate(`(async () => {
    const data = await window.__companion3DTest.convert('glb', new Uint8Array(${glbBytes}))
    const entry = await window.companion.saveAnimation({ slot: 'happy', name: 'convertita.glb', data })
    return entry.name
  })()`)
  const listed = await comp.evaluate('window.companion.listAnimations()')
  check(saved === 'happy-convertita.vrma' && listed.some(a => a.slot === 'happy' && a.name === saved), 'import: glb convertito in .vrma e salvato (' + saved + ')')

  // 5. Umore, memoria.
  const chip = await chat.evaluate(`document.getElementById('mood-chip').textContent`)
  check(chip && chip !== '·', 'umore mostrato nella chat (' + chip + ')')
  const compact = await chat.evaluate('window.companion.memoryCompactNow()')
  check(compact && compact.ok === true, 'compatta memoria')
  const forget = await chat.evaluate('window.companion.memoryClear()')
  check(forget && forget.ok === true, 'dimentica tutto')

  // 6. Eliminazione dell'avatar importato dal menu.
  await comp.evaluate(`document.getElementById('switch-zone').click(); true`)
  await sleep(300)
  await comp.evaluate(`document.getElementById('btn-manage-avatars').click(); true`)
  await sleep(300)
  await comp.evaluate(`document.querySelector('#avatar-list label.check').click(); true`)
  await comp.evaluate(`document.querySelector('#avatar-list .danger').click(); true`)
  await sleep(1500)
  const after = await comp.evaluate('window.companion.listAvatars()')
  check(!after.some(a => a.id === imported.id) && !fs.existsSync(path.join(USER_DATA, 'avatars', imported.id)), 'avatar importato eliminato')

  for (const [name, c] of [['companion', comp], ['chat', chat]]) {
    const found = problems(c.events)
    check(found.length === 0, name + ': nessun errore in console' + (found.length ? ':\n      - ' + found.join('\n      - ') : ''))
  }
} catch (error) {
  check(false, 'audit interrotto: ' + error.message)
} finally {
  killTree(app)
  fake.close()
  await sleep(1000)
  // Prima le junction di --xtts, da sole: la cancellazione della cartella di
  // lavoro non deve mai scendere nell'installazione vera.
  for (const sub of ['xtts', 'samples']) {
    const link = path.join(USER_DATA, 'voice', sub)
    try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link) } catch (_) {}
  }
  try { fs.rmSync(WORK, { recursive: true, force: true }) } catch (_) {}
}
const failed = results.filter(r => !r.ok)
console.log('\n=== audit: ' + (results.length - failed.length) + '/' + results.length + ' controlli superati, schermate in ' + OUT + ' ===')
process.exit(failed.length ? 1 : 0)
