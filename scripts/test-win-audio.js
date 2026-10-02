// test-win-audio.js — quale app sta suonando (src/main/win-audio.js, la
// parte pura) e, su Windows, che il mixer si legga davvero.

const assert = require('node:assert/strict')
const winAudio = require('../src/main/win-audio')

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

console.log('=== Sessioni audio ===')
const ALLOWED = ['spotify.exe', 'chrome.exe']
const s = (name, active, peak) => ({ pid: 1, name, active, peak })

test('suona un\'app ammessa: e\' lei', () => {
  assert.equal(winAudio.musicApp([s('discord.exe', true, 0.5), s('spotify.exe', true, 0.3)], ALLOWED), 'spotify.exe')
})

test('aperta ma in pausa, o muta: niente', () => {
  assert.equal(winAudio.musicApp([s('spotify.exe', false, 0.3)], ALLOWED), null)
  assert.equal(winAudio.musicApp([s('spotify.exe', true, 0)], ALLOWED), null)
})

test('le app non ammesse non contano', () => {
  assert.equal(winAudio.musicApp([s('game.exe', true, 0.9), s('teams.exe', true, 0.6)], ALLOWED), null)
})

test('la voce del companion non e\' musica', () => {
  assert.equal(winAudio.musicApp([s('companionai.exe', true, 0.8)], ['companionai.exe']), null)
  assert.equal(winAudio.musicApp([s('electron.exe', true, 0.8)], ['electron.exe']), null)
})

test('nomi in maiuscolo nell\'elenco, valori mancanti', () => {
  assert.equal(winAudio.musicApp([s('spotify.exe', true, 0.2)], ['Spotify.EXE']), 'spotify.exe')
  assert.equal(winAudio.musicApp([s(null, true, 0.2), null], ALLOWED), null)
  assert.equal(winAudio.musicApp(undefined, ALLOWED), null)
})

test('sul PC: il mixer si legge senza errori', () => {
  if (process.platform !== 'win32') return
  assert.equal(winAudio.available(), true, winAudio.unavailableReason())
  const list = winAudio.sessions()
  assert.ok(Array.isArray(list))
  for (const x of list) {
    assert.equal(typeof x.pid, 'number')
    assert.ok(x.peak >= 0 && x.peak <= 1)
  }
})

console.log('=== ' + passed + ' test superati ===')
