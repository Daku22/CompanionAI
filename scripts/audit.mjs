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
//
// Esce con codice 1 se un controllo fallisce.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { AvatarLibrary } = require('../src/main/AvatarLibrary.js')
const PORT = 9336
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] }
const VRM = opt('--vrm') || 'Fred'
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
}))
const png = path.join(WORK, 'immagine-importata.png')
fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), png)
const library = new AvatarLibrary(path.join(USER_DATA, 'avatars'))
const scan = await library.scan(png)
const imported = await library.commit(scan.token, scan.candidates[0].id)

const app = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + USER_DATA], {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, USERPROFILE: HOME, HOME, OPENROUTER_URL: FAKE_URL },
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
  app.kill()
  fake.close()
  await sleep(1000)
  try { fs.rmSync(WORK, { recursive: true, force: true }) } catch (_) {}
}
const failed = results.filter(r => !r.ok)
console.log('\n=== audit: ' + (results.length - failed.length) + '/' + results.length + ' controlli superati, schermate in ' + OUT + ' ===')
process.exit(failed.length ? 1 : 0)
