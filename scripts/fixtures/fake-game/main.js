// fake-game/main.js — un "gioco" finto per le prove della modalita' gioco
// (Blocco 12): una finestra di un altro processo, con un titolo fisso e una
// scena che cambia a comando. Si comanda via HTTP su 127.0.0.1 (lo stdin di
// Electron su Windows non arriva):
//   /scene/<n>    disegna la scena n (colori e forme diversi)
//   /minimize     riduce a icona;  /restore  la riporta
//   /title/<t>    cambia il titolo (come un gioco che ci scrive gli FPS)
//   /quit         chiude
// Uso: electron scripts/fixtures/fake-game/main.js --port=<porta> [--title=<titolo>]
const { app, BrowserWindow } = require('electron')
const http = require('http')

const TITLE = process.argv.find(a => a.startsWith('--title='))?.slice(8) || 'Gioco di prova'
const PORT = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7)) || 0
const SCENES = [
  ['#1b3a2a', '#e2c044', 'Livello 1'],
  ['#3a1b1b', '#44c0e2', 'Il boss'],
  ['#1b1f3a', '#e24485', 'Vittoria!'],
]
let win = null
const page = (n) => {
  const [bg, fg, label] = SCENES[n % SCENES.length]
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><title>${TITLE}</title>
<body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh;font:700 48px sans-serif;color:${fg}">
<div style="text-align:center"><div style="width:180px;height:180px;margin:auto;border-radius:${n % 2 ? '50%' : '12px'};background:${fg}"></div>${label}</div>`)
}

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 640, height: 400, x: 80, y: 80, title: TITLE, show: true, autoHideMenuBar: true, webPreferences: { sandbox: true } })
  win.on('page-title-updated', (e) => e.preventDefault())
  win.loadURL(page(0))
  win.setTitle(TITLE)
  http.createServer((req, res) => {
    const [, cmd, ...rest] = decodeURIComponent(req.url || '').split('/')
    const arg = rest.join('/')
    if (cmd === 'scene') win.loadURL(page(Number(arg) || 0))
    else if (cmd === 'minimize') win.minimize()
    else if (cmd === 'restore') { win.restore(); win.showInactive() }
    else if (cmd === 'title') win.setTitle(arg)
    else if (cmd === 'quit') setTimeout(() => app.quit(), 50)
    res.end('ok ' + cmd)
  }).listen(PORT, '127.0.0.1')
})
app.on('window-all-closed', () => app.quit())
