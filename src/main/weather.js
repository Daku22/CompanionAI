// weather.js — il meteo vero per la stanza, da Open-Meteo (nessuna chiave).
//
// Facoltativo e spento di base. Quando lo accendi, la citta' che scrivi va al
// servizio di geocodifica di Open-Meteo, e le sue coordinate al servizio
// meteo, al massimo una volta ogni 30 minuti e solo con la stanza aperta.
// Nient'altro esce dal PC. La scena (room-scene.js) ne ricava nuvole,
// pioggia, neve e nebbia; le coordinate servono anche a mettere il sole al
// posto giusto.

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const REFRESH_MS = 30 * 60 * 1000
const TIMEOUT_MS = 10000
const MAX_CITY = 80

/** La citta' come l'ha scritta l'utente, ripulita. '' se non c'e'. */
function cleanCity(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CITY)
}

function geocodeUrl(city) {
  return GEO_URL + '?' + new URLSearchParams({ name: city, count: '1', language: 'it', format: 'json' })
}

/** @returns {{ name: string, country: string, latitude: number, longitude: number } | null} */
function parseGeocode(json) {
  const r = json && Array.isArray(json.results) ? json.results[0] : null
  if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null
  if (Math.abs(r.latitude) > 90 || Math.abs(r.longitude) > 180) return null
  return { name: String(r.name || '').slice(0, 80), country: String(r.country || '').slice(0, 80), latitude: r.latitude, longitude: r.longitude }
}

function forecastUrl(place) {
  return FORECAST_URL + '?' + new URLSearchParams({
    latitude: place.latitude.toFixed(3), longitude: place.longitude.toFixed(3),
    current: 'weather_code,cloud_cover,temperature_2m,is_day', timezone: 'auto',
  })
}

/** @returns {{ code: number, cloudCover: number, temperature: number | null, isDay: boolean } | null} */
function parseForecast(json) {
  const c = json && json.current
  if (!c || !Number.isFinite(c.weather_code)) return null
  return {
    code: c.weather_code,
    cloudCover: Number.isFinite(c.cloud_cover) ? Math.max(0, Math.min(100, c.cloud_cover)) : 0,
    temperature: Number.isFinite(c.temperature_2m) ? c.temperature_2m : null,
    isDay: c.is_day === 1,
  }
}

class WeatherService {
  /** @param {{ fetch?: (url: string, init?: any) => Promise<any>, now?: () => number }} [deps] */
  constructor({ fetch: fetchFn = globalThis.fetch, now = Date.now } = {}) {
    this.fetch = fetchFn
    this.now = now
    /** @type {{ city: string, place: any } | null} */
    this.geo = null
    /** @type {{ at: number, place: any, weather: any } | null} */
    this.last = null
  }

  async getJson(url) {
    const res = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error('Open-Meteo ha risposto ' + res.status)
    return res.json()
  }

  /**
   * Meteo per la citta'. Ricorda coordinate e ultimo meteo: la stessa citta'
   * entro 30 minuti non chiama la rete (force: la chiama comunque).
   * @param {string} cityText
   * @param {{ force?: boolean }} [opts]
   */
  async get(cityText, { force = false } = {}) {
    const city = cleanCity(cityText)
    if (!city) throw new Error('Nessuna città')
    if (!this.geo || this.geo.city.toLowerCase() !== city.toLowerCase()) {
      const place = parseGeocode(await this.getJson(geocodeUrl(city)))
      if (!place) throw new Error('Città non trovata: ' + city)
      this.geo = { city, place }
      this.last = null
    }
    if (!force && this.last && this.now() - this.last.at < REFRESH_MS) return this.last
    const weather = parseForecast(await this.getJson(forecastUrl(this.geo.place)))
    if (!weather) throw new Error('Meteo non leggibile')
    this.last = { at: this.now(), place: this.geo.place, weather }
    return this.last
  }
}

module.exports = { WeatherService, cleanCity, geocodeUrl, parseGeocode, forecastUrl, parseForecast, REFRESH_MS, MAX_CITY }
