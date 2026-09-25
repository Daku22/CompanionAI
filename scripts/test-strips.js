// test-strips.js — verifica l'avatar 2D integrato: manifest e PNG combaciano.
//
// Manifest e immagini li genera scripts/build-strips.js: se uno dei due viene
// rigenerato o ritoccato senza l'altro, i fotogrammi escono tagliati o sfasati
// e nessun altro test se ne accorgerebbe. Le dimensioni si leggono
// dall'intestazione PNG, senza decodificare l'immagine.
//
// L'app puo' essere distribuita senza avatar 2D integrato (sprites.js vale
// null finche' l'arte non c'e'): in quel caso nella cartella non devono
// restare PNG orfani, che finirebbero nel pacchetto per niente.

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'strips')
// Oltre questa altezza i fotogrammi sprecano memoria video: vedi build-strips.js.
const MAX_FRAME_HEIGHT = 480

function pngSize(file) {
  const buf = fs.readFileSync(file)
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', path.basename(file) + ' non e-` un PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const sandbox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(DIR, 'sprites.js'), 'utf8'), sandbox)
const pack = sandbox.window.COMPANION_SPRITES
const pngs = fs.readdirSync(DIR).filter(f => f.endsWith('.png'))

if (pack === null) {
  assert.deepEqual(pngs, [], 'nessun avatar 2D integrato, ma ci sono PNG nel pacchetto: ' + pngs.join(', '))
  console.log('=== Strip 2D: nessun avatar 2D integrato (sprites.js = null) ===')
} else {
  assert.equal(pack.format, 'companion-sprites/1', 'formato del manifest sconosciuto')
  assert.ok(pack.animations && pack.animations.idle, 'manca l-animazione idle, obbligatoria')
  let checked = 0
  for (const [name, meta] of Object.entries(pack.animations)) {
    const size = pngSize(path.join(DIR, meta.file))
    assert.deepEqual(size, { width: meta.sw, height: meta.sh }, name + ': il PNG non corrisponde al manifest')
    assert.equal(meta.frames.length, meta.count, name + ': numero di fotogrammi incoerente')
    for (const [x, y, w, h] of meta.frames) {
      assert.ok(x >= 0 && y >= 0 && x + w <= size.width && y + h <= size.height, name + ': fotogramma fuori dal PNG')
      assert.ok(h <= MAX_FRAME_HEIGHT, name + ': fotogramma alto ' + h + ' px, oltre ' + MAX_FRAME_HEIGHT)
    }
    checked++
  }
  const used = new Set(Object.values(pack.animations).map(m => m.file))
  const extra = pngs.filter(f => !used.has(f))
  assert.deepEqual(extra, [], 'PNG non usati nel pacchetto: ' + extra.join(', '))
  console.log('=== Strip 2D: ' + checked + ' animazioni di "' + pack.name + '" coerenti con il manifest ===')
}
