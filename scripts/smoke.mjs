// smoke.mjs — prova dal vivo: avvia l'app e la controlla dall'interno.
//
// I test di npm test non aprono finestre, quindi non vedono cio' che si rompe
// solo nell'app vera: una CSP che blocca uno script, un modulo che non si
// carica, un avatar che resta vuoto. Qui l'app parte con la porta di debug di
// Chromium, e dal protocollo DevTools si raccolgono errori e violazioni della
// CSP, si prova ogni avatar dell'elenco e si salva una schermata di ciascuno.
// Alla fine l'avatar scelto dall'utente viene ripristinato e l'app chiusa.
//
// Uso:
//   npm run smoke                        app in sviluppo
//   npm run smoke -- --exe <CompanionAI.exe>   app impacchettata
//   npm run smoke -- --out <cartella>    dove salvare le schermate
//   npm run smoke -- --user-data <cartella>   dati utente separati (avatar importati)
//
// Esce con codice 1 se trova errori.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9333
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] }
const OUT = path.resolve(opt('--out') || path.join(os.tmpdir(), 'companion-smoke'))
const EXE = opt('--exe')
const USER_DATA = opt('--user-data')
fs.mkdirSync(OUT, { recursive: true })

// require('electron') da Node restituisce il percorso dell'eseguibile.
const command = EXE || require('electron')
const args = EXE ? [`--remote-debugging-port=${PORT}`] : ['.', `--remote-debugging-port=${PORT}`]
if (USER_DATA) args.push('--user-data-dir=' + path.resolve(USER_DATA))
const app = spawn(command, args, { cwd: ROOT, stdio: 'ignore' })

async function pages() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const comp = list.find(t => t.url.includes('companion.html'))
      const chat = list.find(t => t.url.includes('chat.html'))
      if (comp && chat) return { comp, chat }
    } catch (_) {}
    await sleep(500)
  }
  throw new Error("le pagine dell'app non sono comparse")
}

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
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(method + ': nessuna risposta')) }, 15000)
    pending.set(n, (msg) => { clearTimeout(timer); resolve(msg) })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
    return r.result.result.value
  }
  return new Promise(resolve => { ws.onopen = () => resolve({ send, evaluate, events, ws }) })
}

// Gli avvisi di sicurezza di Electron compaiono solo in sviluppo: il pacchetto non li mostra.
const IGNORED = [/Electron Security Warning/]
function problems(events) {
  return events.map(e => {
    if (e.method === 'Runtime.exceptionThrown') return e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text
    if (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)) return e.params.entry.text
    if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
      return e.params.args.map(a => a.value ?? a.description).join(' ')
    }
    return null
  }).filter(text => text && !IGNORED.some(re => re.test(text)))
}

let failed = false
let comp = null
let saved = null
try {
  const found = await pages()
  comp = await connect(found.comp)
  const chat = await connect(found.chat)
  for (const c of [comp, chat]) { await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable') }
  // Ricarica per catturare anche gli errori del caricamento, CSP comprese.
  for (const c of [comp, chat]) await c.send('Page.reload', { ignoreCache: true })
  await sleep(5000)

  saved = await comp.evaluate('window.companion.getConfig().then(c => c.avatarModel)')
  const avatars = await comp.evaluate('window.companion.listAvatars()')
  console.log('avatar disponibili: ' + avatars.map(a => a.name + ' (' + a.kind + ')').join(', '))

  for (let i = 0; i < avatars.length; i++) {
    await comp.evaluate(`document.querySelectorAll('#avatar-list .menu-item')[${i}].click()`)
    await sleep(avatars[i].kind === 'vrm' ? 9000 : 4000)
    const state = await comp.evaluate(`({ threeVisible: window.__threeVisible, sprites: Object.keys(stripTextures).length })`)
    const shot = await comp.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT, `${i + 1}-${avatars[i].name.replace(/[^\w-]/g, '_')}.png`)
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    const ok = avatars[i].kind === 'vrm' || avatars[i].kind === 'gltf' ? state.threeVisible : state.sprites > 0
    if (!ok) failed = true
    console.log(`${ok ? 'ok ' : 'NO '} ${avatars[i].name}: ${JSON.stringify(state)} -> ${file}`)
  }

  const chatState = await chat.evaluate(`({ forget: !!document.getElementById('forget-btn'), send: !!document.getElementById('send-btn'), models: document.getElementById('model-select').options.length, note: document.getElementById('model-note').textContent })`)
  console.log('chat: ' + JSON.stringify(chatState))

  for (const [name, c] of [['companion', comp], ['chat', chat]]) {
    const list = problems(c.events)
    if (list.length) { failed = true; console.log(`problemi in ${name}:\n  - ` + list.join('\n  - ')) }
    else console.log(`${name}: nessun errore`)
  }
} catch (error) {
  failed = true
  console.error('smoke: ' + error.message)
} finally {
  // L'avatar scelto dall'utente torna com'era: la prova cambia la configurazione vera.
  if (comp && saved !== null) await comp.evaluate(`window.companion.setConfig({ avatarModel: ${JSON.stringify(saved)} })`).catch(() => {})
  app.kill()
}
process.exit(failed ? 1 : 0)
