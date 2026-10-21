// test-game-mode.js — la modalita' gioco (src/main/game-mode.js, Blocco 12).
const assert = require('node:assert/strict')
const G = require('../src/main/game-mode')

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
console.log('=== Modalita\' gioco ===')

const PROVIDERS = ['openrouter', 'claude', 'openai', 'ollama']

test('12a: impostazioni controllate (finestra, schermo, modello, tempi)', () => {
  assert.deepEqual(G.gameConfig({}), { ...G.GAME_DEFAULTS })
  const g = G.mergeGame({}, { source: { kind: 'window', title: '  Elden Ring\n', app: 'eldenring.exe' }, vision: { provider: 'openrouter', model: 'google/gemma-3-27b-it:free' }, intervalS: 5, perHour: 99 }, PROVIDERS)
  assert.deepEqual(g, { source: { kind: 'window', title: 'Elden Ring', app: 'eldenring.exe' }, vision: { provider: 'openrouter', model: 'google/gemma-3-27b-it:free' }, intervalS: 30, perHour: 30 })
  assert.deepEqual(G.mergeGame(g, { source: { kind: 'screen' } }).source, { kind: 'screen' })
  assert.equal(G.mergeGame(g, { source: null }).source, null, 'null toglie la scelta')
  assert.equal(G.mergeGame(g, { source: { kind: 'window', app: '..\\\\evil.bat' } }).source, null, 'un programma che non e\' un .exe no')
  assert.equal(G.mergeGame(g, { vision: { provider: 'boh', model: 'x' } }, PROVIDERS).vision, null)
  assert.equal(G.mergeGame(g, { intervalS: 'tanto' }).intervalS, 30)
})

test('12a: la finestra si ritrova dal titolo, o dal programma se il titolo cambia', () => {
  const open = [
    { id: 'window:1:0', title: 'Notepad', app: 'notepad.exe', area: 100 },
    { id: 'window:2:0', title: 'Hollow Knight - 59 FPS', app: 'hollow_knight.exe', area: 5000 },
    { id: 'window:3:0', title: 'Launcher', app: 'hollow_knight.exe', area: 200 },
  ]
  assert.equal(G.findSource(open, { kind: 'window', title: 'Hollow Knight - 59 FPS', app: 'hollow_knight.exe' }).id, 'window:2:0')
  assert.equal(G.findSource(open, { kind: 'window', title: 'Hollow Knight - 61 FPS', app: 'Hollow_Knight.exe' }).id, 'window:2:0', 'titolo cambiato: dal programma, la finestra piu\' grande')
  assert.equal(G.findSource(open, { kind: 'window', title: 'Notepad', app: '' }).id, 'window:1:0')
  assert.equal(G.findSource(open, { kind: 'window', title: 'Elden Ring', app: 'eldenring.exe' }), null, 'il gioco non e\' aperto')
  assert.equal(G.findSource(open, { kind: 'screen' }), null)
  assert.equal(G.findSource(open, null), null)
})

test('12a: il modello che guarda: quello scelto, o quello della chat se vede', () => {
  const chat = { provider: 'openrouter', model: 'x/testo:free' }
  assert.equal(G.visionModel({ vision: null }, chat, false), null, 'la chat non vede e non ne hai scelto uno')
  assert.deepEqual(G.visionModel({ vision: null }, chat, true), chat)
  assert.deepEqual(G.visionModel({ vision: { provider: 'ollama', model: 'gemma3' } }, chat, true), { provider: 'ollama', model: 'gemma3' })
  assert.equal(G.describeSource({ kind: 'window', title: 'Hollow Knight', app: 'hollow_knight.exe' }), 'Hollow Knight (hollow_knight.exe)')
  assert.equal(G.describeSource({ kind: 'screen' }), 'Tutto lo schermo del companion')
})

console.log('=== ' + passed + ' test superati ===')
