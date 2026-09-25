// test-sprite-frames.js — verifica il ritaglio automatico dei fogli di sprite.
//
// L'arte nuova arrivera' come fogli senza coordinate: build-strips.js trova i
// fotogrammi da solo. Qui i fogli sono bitmap costruite a mano, cosi' ogni
// caso e' esatto e non serve Electron.

const assert = require('node:assert/strict')
const { detectFrames, trimToCharacter, findIslands } = require('./lib/sprite-frames')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

// Foglio vuoto con rettangoli pieni. Colore BGRA: blu=b, verde=g, rosso=r.
function sheet(width, height, rects, bgra = [120, 120, 120, 255]) {
  const data = Buffer.alloc(width * height * 4, 0)
  for (const [x, y, w, h, color] of rects) {
    const c = color || bgra
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) data.set(c, (yy * width + xx) * 4)
    }
  }
  return data
}

console.log('=== Ritaglio dei fogli di sprite ===\n')

test('trova i fotogrammi di una riga, da sinistra a destra', () => {
  const data = sheet(300, 100, [[200, 10, 40, 80], [10, 10, 40, 80], [110, 20, 30, 70]])
  assert.deepEqual(detectFrames(data, 300, 100).map(f => f.x), [10, 110, 200])
})

test('legge le righe dall-alto e ogni riga da sinistra', () => {
  const data = sheet(200, 220, [[120, 120, 40, 80], [10, 10, 40, 80], [10, 120, 40, 80], [120, 10, 40, 80]])
  assert.deepEqual(detectFrames(data, 200, 220).map(f => [f.x, f.y]), [[10, 10], [120, 10], [10, 120], [120, 120]])
})

test('una nuvoletta staccata resta nel fotogramma del personaggio', () => {
  // Corpo + nuvoletta a 2 px di distanza: un fotogramma solo, che li contiene entrambi.
  const data = sheet(400, 120, [[10, 30, 40, 80], [52, 5, 20, 20], [200, 30, 40, 80]])
  const frames = detectFrames(data, 400, 120)
  assert.equal(frames.length, 2)
  assert.deepEqual(frames[0], { x: 10, y: 5, width: 62, height: 105 })
})

test('la polvere non diventa un fotogramma', () => {
  const data = sheet(300, 100, [[10, 10, 40, 80], [150, 50, 2, 2], [200, 10, 40, 80]])
  assert.equal(detectFrames(data, 300, 100).length, 2)
})

test('un foglio trasparente non ha fotogrammi', () => {
  assert.deepEqual(detectFrames(Buffer.alloc(50 * 50 * 4), 50, 50), [])
})

test('gli aloni quasi trasparenti non contano come disegno', () => {
  const data = sheet(100, 100, [[10, 10, 30, 30], [60, 60, 30, 30, [120, 120, 120, 40]]])
  assert.equal(findIslands(data, 100, 100).length, 1)
})

test('il ritaglio scarta il frammento del fotogramma vicino tagliato dal bordo', () => {
  // Personaggio al centro, frammento in alto che tocca il bordo: via.
  const data = sheet(100, 200, [[30, 40, 40, 150], [0, 0, 20, 4]])
  assert.deepEqual(trimToCharacter(data, 100, 200), { x: 29, y: 40, width: 42, height: 150 })
})

test('con cutLabel l-etichetta sotto le scarpe viene tolta', () => {
  // Scarpe calde (rosso alto) sopra un'etichetta blu attaccata.
  const shoes = [0, 150, 220, 255]   // BGRA: arancione
  const label = [100, 42, 5, 255]    // BGRA: blu dell'etichetta
  const data = sheet(100, 200, [[30, 20, 40, 120], [30, 140, 40, 10, shoes], [35, 150, 30, 30, label]])
  const r = trimToCharacter(data, 100, 200, { cutLabel: true })
  assert.equal(r.y + r.height - 1, 149, 'il taglio deve cadere sull-ultima riga delle scarpe')
})

console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
