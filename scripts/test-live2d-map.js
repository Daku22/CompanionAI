// test-live2d-map.js — gesti, emozioni e test del punto per gli avatar Live2D
// (src/renderer/live2d-map.js).
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

// Script della pagina (src/renderer e' a moduli ES): si carica con una finestra finta.
// Gli oggetti nati li' dentro hanno altri prototipi: si confrontano semplici.
const window = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'live2d-map.js'), 'utf8'), { window })
const plain = (v) => JSON.parse(JSON.stringify(v))
const L = window.Live2DMap
const GESTURES = plain(L.GESTURES)
const proposeMotionMap = (g) => plain(L.proposeMotionMap(g))
const proposeExpressionMap = (e) => plain(L.proposeExpressionMap(e))
const applyChoices = (...a) => plain(L.applyChoices(...a))
const { idleGroup, pointInMesh } = L

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Live2D: gesti, emozioni, test del punto ===')

// I gruppi di Hiyori, il modello d'esempio di Live2D.
const HIYORI = ['Idle', 'Flick', 'FlickDown', 'FlickUp', 'Tap', 'Tap@Body', 'Flick@Body']

t('Hiyori: ogni gesto con movimento trova un gruppo, mai il riposo', () => {
  const map = proposeMotionMap(HIYORI)
  assert.deepEqual(map, {
    wave: 'Tap', happy: 'FlickUp', click: 'Tap@Body', dance: 'Flick@Body',
    think: 'FlickDown', stretch: 'FlickUp', yawn: 'FlickDown', search: null,
    // Reazioni ai tocchi: Hiyori non ha gruppi adatti, si muove da se'.
    pat: null, flinch: null, giggle: null, hop: null, shy: null, scold: null, turnaway: null,
  })
  assert.ok(!Object.values(map).includes('Idle'))
  assert.equal(idleGroup(HIYORI), 'Idle')
})

t('nomi espliciti vincono su quelli generici', () => {
  const map = proposeMotionMap(['idle_loop', 'tap_head', 'Wave', 'Happy', 'Dance'])
  assert.equal(map.wave, 'Wave')
  assert.equal(map.happy, 'Happy')
  assert.equal(map.dance, 'Dance')
  assert.equal(idleGroup(['idle_loop', 'tap_head']), 'idle_loop')
})

t('reazioni ai tocchi: gruppi con nomi espliciti', () => {
  const map = proposeMotionMap(['Idle', 'Tap@Head', 'Laugh', 'Jump', 'Shy', 'Angry', 'TurnAway', 'Surprised'])
  assert.equal(map.pat, 'Tap@Head')
  assert.equal(map.giggle, 'Laugh')
  assert.equal(map.hop, 'Jump')
  assert.equal(map.shy, 'Shy')
  assert.equal(map.scold, 'Angry')
  assert.equal(map.turnaway, 'TurnAway')
  assert.equal(map.flinch, 'Surprised')
})

t('senza gruppi: tutto al riposo', () => {
  const map = proposeMotionMap([])
  assert.deepEqual(Object.keys(map), GESTURES)
  assert.ok(Object.values(map).every(v => v === null))
  assert.equal(idleGroup([]), null)
  assert.equal(idleGroup(undefined), null)
})

t('espressioni: abbinate per nome, assenti se il modello non ne ha', () => {
  const map = proposeExpressionMap(['Smile', 'Sad', 'Angry', 'Surprised', 'Blush'])
  assert.equal(map.joy, 'Smile')
  assert.equal(map.sadness, 'Sad')
  assert.equal(map.annoyance, 'Angry')
  assert.equal(map.curiosity, 'Surprised')
  assert.equal(map.affection, 'Blush')
  assert.equal(map.calm, null)
  assert.ok(Object.values(proposeExpressionMap([])).every(v => v === null))
  assert.ok(Object.values(proposeExpressionMap(['f01', 'f02'])).every(v => v === null), 'nomi senza senso: nessuna')
})

t('le scelte dell\'utente vincono, ma solo con nomi che il modello ha', () => {
  const proposed = proposeMotionMap(HIYORI)
  const out = applyChoices(proposed, { wave: 'Flick', happy: '', dance: 'Inventato', inventato: 'Tap' }, HIYORI)
  assert.equal(out.wave, 'Flick')
  assert.equal(out.happy, null, 'vuoto: nessun movimento, voluto')
  assert.equal(out.dance, 'Flick@Body', 'gruppo inesistente: resta la proposta')
  assert.ok(!('inventato' in out))
  assert.deepEqual(applyChoices(proposed, undefined, HIYORI), proposed)
})

t('test del punto: dentro e fuori da un triangolo, e da un quadrato di due', () => {
  const tri = [0, 0, 10, 0, 0, 10]
  assert.equal(pointInMesh(2, 2, tri, [0, 1, 2]), true)
  assert.equal(pointInMesh(8, 8, tri, [0, 1, 2]), false)
  assert.equal(pointInMesh(0, 5, tri, [0, 1, 2]), true, 'sul bordo conta')
  const quad = [0, 0, 10, 0, 10, 10, 0, 10]
  assert.equal(pointInMesh(8, 8, quad, [0, 1, 2, 0, 2, 3]), true)
  assert.equal(pointInMesh(11, 5, quad, [0, 1, 2, 0, 2, 3]), false)
  assert.equal(pointInMesh(1, 1, quad, []), false)
})

console.log('=== ' + passed + ' test superati ===')
