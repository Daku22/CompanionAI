// food-icons.js — le icone dei pannelli del cibo e degli oggetti (Blocchi 10b, 10c).
//
// Per ogni voce di modelli-3d/food/food.json (o, con "objects",
// modelli-3d/objects/objects.json) disegna il modello in 256x256 su fondo
// trasparente (food-icons.html, three) e lo salva in <cartella>/icons/<id>.png.
// Le anteprime del Food Kit sono di 64 px: nelle card verrebbero sfocate. Si
// rifa' solo quando cambia il catalogo.
//
// Uso: npx electron scripts/food-icons.js [objects]

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const OBJECTS = process.argv.includes('objects')
const DIR = path.join(__dirname, '..', 'modelli-3d', OBJECTS ? 'objects' : 'food')
const ids = () => JSON.parse(fs.readFileSync(path.join(DIR, OBJECTS ? 'objects.json' : 'food.json'), 'utf8')).items.map(i => i.id)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, webPreferences: { offscreen: true } })
  await win.loadFile(path.join(__dirname, 'food-icons.html'))
  for (let i = 0; i < 50 && !(await win.webContents.executeJavaScript('!!window.iconsReady')); i++) await new Promise(r => setTimeout(r, 100))
  fs.mkdirSync(path.join(DIR, 'icons'), { recursive: true })
  const resourcePath = pathToFileURL(DIR).href + '/'
  for (const id of ids()) {
    const b64 = fs.readFileSync(path.join(DIR, id + '.glb')).toString('base64')
    const url = await win.webContents.executeJavaScript('renderIcon(' + JSON.stringify(b64) + ', ' + JSON.stringify(resourcePath) + ')')
    fs.writeFileSync(path.join(DIR, 'icons', id + '.png'), Buffer.from(url.split(',')[1], 'base64'))
    console.log('  ' + id)
  }
  app.quit()
})
