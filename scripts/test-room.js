// test-room.js — dimensioni della stanza, bordi, chat agganciata.

const assert = require('node:assert/strict')
const { ROOM_MIN, ROOM_DEFAULT, CHAT_WIDTH, CHAT_INSET, TITLE_BAR, roomBounds, resizeBounds, chatDock, parseScenes } = require('../src/main/room')

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

const AREA = { x: 0, y: 0, width: 1920, height: 1032 }

test('senza stanza salvata: dimensione predefinita, al centro', () => {
  const r = roomBounds(undefined, AREA)
  assert.equal(r.width, ROOM_DEFAULT.width)
  assert.equal(r.height, ROOM_DEFAULT.height)
  assert.equal(r.x, (1920 - ROOM_DEFAULT.width) / 2)
  assert.equal(r.y, (1032 - ROOM_DEFAULT.height) / 2)
})

test('stanza salvata: torna dov\'era', () => {
  assert.deepEqual(roomBounds({ x: 100, y: 80, width: 900, height: 600 }, AREA), { x: 100, y: 80, width: 900, height: 600 })
})

test('stanza salvata su uno schermo che non c\'e\' piu\': al centro', () => {
  const r = roomBounds({ x: 3000, y: 80, width: 900, height: 600 }, AREA)
  assert.equal(r.x, (1920 - ROOM_DEFAULT.width) / 2)
})

test('un po\' fuori dallo schermo: rientra', () => {
  assert.deepEqual(roomBounds({ x: 1200, y: -40, width: 900, height: 600 }, AREA), { x: 1020, y: 0, width: 900, height: 600 })
})

test('mai sotto il minimo, mai oltre l\'area', () => {
  assert.deepEqual(roomBounds({ x: 10, y: 10, width: 100, height: 50 }, AREA), { x: 10, y: 10, width: ROOM_MIN.width, height: ROOM_MIN.height })
  const small = { x: 0, y: 0, width: 800, height: 500 }
  const r = roomBounds({ x: 0, y: 0, width: 5000, height: 5000 }, small)
  assert.equal(r.width, 800)
  assert.equal(r.height, 500)
  // Schermo piu' piccolo del minimo: vince lo schermo.
  const tiny = roomBounds(undefined, { x: 0, y: 0, width: 500, height: 300 })
  assert.equal(tiny.width, 500)
  assert.equal(tiny.height, 300)
})

test('dati salvati rovinati: si ignorano', () => {
  for (const bad of [null, 'x', { x: 1 }, { x: NaN, y: 0, width: 800, height: 600 }]) {
    assert.equal(roomBounds(bad, AREA).width, ROOM_DEFAULT.width)
  }
})

test('bordi: destro e basso allargano, sinistro e alto tengono fermo il lato opposto', () => {
  const start = { x: 100, y: 100, width: 800, height: 600 }
  assert.deepEqual(resizeBounds(start, 'se', 50, 30), { x: 100, y: 100, width: 850, height: 630 })
  assert.deepEqual(resizeBounds(start, 'w', -40, 999), { x: 60, y: 100, width: 840, height: 600 })
  assert.deepEqual(resizeBounds(start, 'n', 999, 20), { x: 100, y: 120, width: 800, height: 580 })
  assert.deepEqual(resizeBounds(start, 'bogus', 50, 50), start)
})

test('bordi: al minimo il lato opposto non si muove', () => {
  const start = { x: 100, y: 100, width: 800, height: 600 }
  const r = resizeBounds(start, 'nw', 2000, 2000)
  assert.equal(r.width, ROOM_MIN.width)
  assert.equal(r.height, ROOM_MIN.height)
  assert.equal(r.x + r.width, 900)
  assert.equal(r.y + r.height, 700)
})

test('chat agganciata: a destra, sotto la barra, dentro la stanza', () => {
  const room = { x: 100, y: 100, width: 1000, height: 700 }
  const c = chatDock(room)
  assert.equal(c.width, CHAT_WIDTH)
  assert.ok(c.x + c.width <= room.x + room.width)
  assert.ok(c.y >= room.y + TITLE_BAR)
  assert.ok(c.y + c.height <= room.y + room.height)
  assert.ok(room.x + room.width - c.x <= CHAT_INSET)
})

test('scene HDRI: solo voci valide, con i file che esistono', () => {
  const files = new Set(['parco_day_1k.hdr', 'parco_night_1k.hdr', 'interno_1k.hdr'])
  const exists = (f) => files.has(f)
  const list = parseScenes({ scenes: [
    { id: 'parco', label: 'Parco', outdoor: true, height: 1.7, variants: { day: 'parco_day_1k.hdr', night: 'parco_night_1k.hdr', dusk: 'manca.hdr' } },
    { id: 'interno', variants: { day: 'interno_1k.hdr' }, height: 999, radius: 10 },
    { id: 'parco', variants: { day: 'parco_day_1k.hdr' } },
    { id: '../fuori', variants: { day: 'interno_1k.hdr' } },
    { id: 'studio', variants: { day: 'interno_1k.hdr' } },
    { id: 'senza-giorno', variants: { night: 'parco_night_1k.hdr' } },
    { id: 'percorso', variants: { day: '../../x.hdr' } },
  ] }, exists)
  assert.deepEqual(list.map(s => s.id), ['parco', 'interno'])
  assert.deepEqual(list[0].variants, { day: 'parco_day_1k.hdr', night: 'parco_night_1k.hdr' })
  assert.equal(list[0].outdoor, true)
  assert.equal(list[1].label, 'interno')
  assert.equal(list[1].height, 1.6, 'altezza assurda: quella tipica')
  assert.equal(list[1].radius, 10)
  assert.equal(list[0].radius, 100, 'senza raggio: quello da esterno')
  assert.deepEqual(parseScenes(null, exists), [])
  assert.deepEqual(parseScenes({ scenes: 'x' }, exists), [])
})

console.log('\n=== ' + passed + ' test superati ===')
