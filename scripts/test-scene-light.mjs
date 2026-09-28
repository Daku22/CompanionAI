// test-scene-light.mjs — la luce della stanza a mezzogiorno, al tramonto e
// di notte, il meteo e l'umore. Senza aprire l'app.

import assert from 'node:assert/strict'
import { sunPosition, dayPhase, lightFor, weatherEffect, moodTint } from '../src/renderer/scene-light.js'

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

const DEG = Math.PI / 180
// Ora locale: senza longitudine il sole segue il fuso, quindi mezzogiorno e'
// davvero mezzogiorno qualunque sia il fuso di chi lancia i test.
const at = (month, day, hour, minute = 0) => new Date(2026, month - 1, day, hour, minute)
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a.toFixed(1) + ' invece di ' + b.toFixed(1))

test('mezzogiorno d\'estate e d\'inverno, a 42 gradi di latitudine', () => {
  near(sunPosition(at(6, 21, 12)).elevation / DEG, 71.4, 1.5, 'giugno')
  near(sunPosition(at(12, 21, 12)).elevation / DEG, 24.6, 1.5, 'dicembre')
  near(sunPosition(at(6, 21, 12)).azimuth / DEG, 180, 3, 'a mezzogiorno il sole e\' a sud')
})

test('mezzanotte: sole sotto l\'orizzonte', () => {
  assert.ok(sunPosition(at(6, 21, 0)).elevation < -20 * DEG)
  assert.ok(sunPosition(at(12, 21, 23)).elevation < -30 * DEG)
})

test('mattina a est, sera a ovest, e piu\' a nord si abbassa', () => {
  const morning = sunPosition(at(6, 21, 8))
  const evening = sunPosition(at(6, 21, 16))
  assert.ok(morning.azimuth < Math.PI && evening.azimuth > Math.PI)
  near(morning.elevation, evening.elevation, 0.01, 'simmetria intorno a mezzogiorno')
  assert.ok(sunPosition(at(6, 21, 12), { latitude: 60 }).elevation < sunPosition(at(6, 21, 12), { latitude: 42 }).elevation)
})

test('fasi: giorno, alba o tramonto, notte', () => {
  assert.equal(dayPhase(40 * DEG), 'day')
  assert.equal(dayPhase(3 * DEG, true), 'dawn')
  assert.equal(dayPhase(3 * DEG, false), 'dusk')
  assert.equal(dayPhase(-20 * DEG), 'night')
})

test('luce: mezzogiorno piu\' forte del tramonto, notte piu\' debole ma mai spenta', () => {
  const noon = lightFor(60 * DEG)
  const sunset = lightFor(2 * DEG)
  const night = lightFor(-30 * DEG)
  assert.ok(noon.sunIntensity > sunset.sunIntensity && sunset.sunIntensity > night.sunIntensity)
  assert.ok(night.sunIntensity >= 0.3 && night.hemiIntensity >= 0.4, 'l\'avatar deve restare visibile')
  assert.equal(noon.night, 0)
  assert.equal(night.night, 1)
  // Al tramonto il sole e' arancio: piu' rosso che blu.
  assert.ok(sunset.sunColor[0] - sunset.sunColor[2] > 0.4)
  // Di notte la luce e' fredda: piu' blu che rossa.
  assert.ok(night.sunColor[2] > night.sunColor[0])
})

test('luce: cambia senza salti', () => {
  let prev = lightFor(-20 * DEG)
  for (let deg = -19; deg <= 60; deg++) {
    const next = lightFor(deg * DEG)
    assert.ok(Math.abs(next.sunIntensity - prev.sunIntensity) < 0.15, 'salto a ' + deg + ' gradi')
    prev = next
  }
})

test('meteo: nessuno, pioggia, neve, nuvole', () => {
  assert.deepEqual(weatherEffect(null), { cloud: 0, rain: 0, snow: 0, fog: 0, dim: 1 })
  assert.equal(weatherEffect({ code: 63, cloudCover: 90 }).rain, 0.5)
  assert.equal(weatherEffect({ code: 65, cloudCover: 100 }).rain, 1)
  assert.equal(weatherEffect({ code: 75, cloudCover: 100 }).snow, 1)
  assert.equal(weatherEffect({ code: 45, cloudCover: 20 }).fog, 1)
  near(weatherEffect({ code: 3, cloudCover: 100 }).dim, 0.45, 0.001, 'cielo coperto')
  assert.equal(weatherEffect({ code: 0, cloudCover: 0 }).dim, 1)
  assert.equal(weatherEffect(/** @type {any} */ ({ code: 'x', cloudCover: 'y' })).dim, 1, 'dati strani: nessun effetto')
})

test('umore: neutro nessuna tinta, triste piu\' blu, sempre leggera', () => {
  assert.deepEqual(moodTint(null), [1, 1, 1])
  assert.deepEqual(moodTint({ emotions: {} }), [1, 1, 1])
  const sad = moodTint({ emotions: { sadness: 1 } })
  assert.ok(sad[2] > sad[0])
  const all = moodTint({ emotions: { joy: 1, affection: 1, calm: 1, sadness: 1, annoyance: 1, curiosity: 1 } })
  for (const v of all) assert.ok(v > 0.8 && v < 1.2)
  assert.deepEqual(moodTint({ emotions: { joy: 5 } }), moodTint({ emotions: { joy: 1 } }), 'oltre 1 non conta')
})

console.log('\n=== ' + passed + ' test superati ===')
