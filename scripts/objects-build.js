// objects-build.js — gli oggetti inclusi (Blocco 10c): pallone, gomitolo,
// orsetto e cuscino, costruiti con three (objects-build.html) e salvati in
// modelli-3d/objects/<nome>.glb. Sono nostri: CC0 come le clip di Kimodo.
//
// Uso: npx electron scripts/objects-build.js   (poi: npx electron scripts/food-icons.js objects)

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'modelli-3d', 'objects')
const NAMES = ['pallone', 'gomitolo', 'orsetto', 'cuscino']

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 64, height: 64, show: false })
  await win.loadFile(path.join(__dirname, 'objects-build.html'))
  for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript('!!window.buildReady')); i++) await new Promise(r => setTimeout(r, 100))
  fs.mkdirSync(DIR, { recursive: true })
  for (const name of NAMES) {
    const b64 = await win.webContents.executeJavaScript('buildGlb(' + JSON.stringify(name) + ')')
    fs.writeFileSync(path.join(DIR, name + '.glb'), Buffer.from(b64, 'base64'))
    console.log('  ' + name + '.glb')
  }
  app.quit()
})
