// test-weather.js — meteo per la stanza, con un fetch finto: nessuna rete.

const assert = require('node:assert/strict')
const { WeatherService, cleanCity, geocodeUrl, parseGeocode, forecastUrl, parseForecast, REFRESH_MS } = require('../src/main/weather')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const ROMA = { results: [{ name: 'Roma', country: 'Italia', latitude: 41.89, longitude: 12.51 }] }
const SUNNY = { current: { weather_code: 0, cloud_cover: 5, temperature_2m: 24.5, is_day: 1 } }

function fakeFetch(routes) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const hit = routes.find(([prefix]) => url.startsWith(prefix))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => hit[1] }
  }
  return { fn, calls }
}

async function main() {
  await test('citta\': spazi e caratteri di controllo tolti, lunghezza limitata', () => {
    assert.equal(cleanCity('  Reggio \n Emilia  '), 'Reggio Emilia')
    assert.equal(cleanCity(42), '')
    assert.equal(cleanCity('x'.repeat(200)).length, 80)
  })

  await test('URL: solo la citta\' o le coordinate, niente altro', () => {
    const g = new URL(geocodeUrl('San Donà di Piave'))
    assert.equal(g.hostname, 'geocoding-api.open-meteo.com')
    assert.equal(g.searchParams.get('name'), 'San Donà di Piave')
    const f = new URL(forecastUrl({ latitude: 41.8912345, longitude: 12.5123 }))
    assert.equal(f.hostname, 'api.open-meteo.com')
    assert.equal(f.searchParams.get('latitude'), '41.891')
    assert.deepEqual([...f.searchParams.keys()].sort(), ['current', 'latitude', 'longitude', 'timezone'])
  })

  await test('risposte: lette se valide, null se strane', () => {
    assert.deepEqual(parseGeocode(ROMA), { name: 'Roma', country: 'Italia', latitude: 41.89, longitude: 12.51 })
    assert.equal(parseGeocode({}), null)
    assert.equal(parseGeocode({ results: [{ latitude: 200, longitude: 0 }] }), null)
    assert.deepEqual(parseForecast(SUNNY), { code: 0, cloudCover: 5, temperature: 24.5, isDay: true })
    assert.equal(parseForecast({ current: { weather_code: 'x' } }), null)
    assert.equal(parseForecast({ current: { weather_code: 3, cloud_cover: 250 } }).cloudCover, 100)
  })

  await test('servizio: coordinate e meteo, poi 30 minuti senza rete', async () => {
    let now = 1000
    const fake = fakeFetch([['https://geocoding-api', ROMA], ['https://api.open-meteo', SUNNY]])
    const w = new WeatherService({ fetch: fake.fn, now: () => now })
    const first = await w.get('Roma')
    assert.equal(first.place.name, 'Roma')
    assert.equal(first.weather.code, 0)
    assert.equal(fake.calls.length, 2)
    now += REFRESH_MS - 1
    await w.get('roma')
    assert.equal(fake.calls.length, 2, 'stessa citta\' entro 30 minuti: dalla memoria')
    now += 2
    await w.get('Roma')
    assert.equal(fake.calls.length, 3, 'dopo 30 minuti solo il meteo, non di nuovo la citta\'')
    await w.get('Roma', { force: true })
    assert.equal(fake.calls.length, 4)
  })

  await test('servizio: citta\' vuota o sconosciuta, rete che sbaglia', async () => {
    const fake = fakeFetch([['https://geocoding-api', { results: [] }]])
    const w = new WeatherService({ fetch: fake.fn })
    await assert.rejects(w.get('   '), /Nessuna città/)
    await assert.rejects(w.get('Atlantide'), /non trovata/)
    const down = new WeatherService({ fetch: fakeFetch([]).fn })
    await assert.rejects(down.get('Roma'), /404/)
  })

  console.log('\n=== ' + passed + ' test superati ===')
}

main()
