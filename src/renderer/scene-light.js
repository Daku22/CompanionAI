// scene-light.js — la luce della stanza secondo l'ora, il meteo e l'umore.
//
// Funzioni pure, senza three: numeri e colori [r, g, b] da 0 a 1. Le usa
// room-scene.js, e test-scene-light.mjs le prova a mezzogiorno, al tramonto e
// di notte senza aprire l'app.
//
// Il sole e' un calcolo astronomico semplice (declinazione e angolo orario,
// senza l'equazione del tempo): sbaglia di qualche minuto, non di ore. Senza
// una citta' scelta la latitudine e' quella dell'Italia e la longitudine si
// ricava dal fuso orario.

const DEG = Math.PI / 180
export const DEFAULT_LATITUDE = 42

/**
 * Posizione del sole.
 * @param {Date} date ora locale
 * @param {{ latitude?: number, longitude?: number }} [place]
 * @returns {{ elevation: number, azimuth: number }} in radianti; azimut da nord verso est
 */
export function sunPosition(date, place = {}) {
  const lat = (Number.isFinite(place.latitude) ? place.latitude : DEFAULT_LATITUDE) * DEG
  // getTimezoneOffset e' in minuti, positivo a ovest di Greenwich.
  const tzHours = -date.getTimezoneOffset() / 60
  const lon = Number.isFinite(place.longitude) ? place.longitude : tzHours * 15
  const start = new Date(date.getFullYear(), 0, 0)
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000)
  const decl = 23.44 * DEG * Math.sin(2 * Math.PI * (284 + day) / 365)
  const clock = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const solar = clock + (lon - tzHours * 15) / 15
  const hourAngle = (solar - 12) * 15 * DEG
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle))
  return { elevation, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) }
}

/** Fase del giorno dall'altezza del sole. */
export function dayPhase(elevation, morning = true) {
  const deg = elevation / DEG
  if (deg < -6) return 'night'
  if (deg < 8) return morning ? 'dawn' : 'dusk'
  return 'day'
}

const mix = (a, b, t) => a + (b - a) * t
const mixColor = (a, b, t) => a.map((v, i) => mix(v, b[i], t))
const smooth = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// Colori chiave: luce del sole a mezzogiorno, al tramonto e di notte (luna).
const SUN_DAY = [1.0, 0.97, 0.9]
const SUN_LOW = [1.0, 0.6, 0.35]
const MOON = [0.55, 0.65, 0.95]
const SKY_DAY = [0.75, 0.85, 1.0]
const SKY_LOW = [0.95, 0.65, 0.55]
const SKY_NIGHT = [0.12, 0.16, 0.32]
const GROUND_DAY = [0.45, 0.42, 0.38]
const GROUND_NIGHT = [0.06, 0.06, 0.1]

/**
 * Le luci per un'altezza del sole.
 * @param {number} elevation radianti
 * @returns {{ sunColor: number[], sunIntensity: number, skyColor: number[], groundColor: number[],
 *   hemiIntensity: number, exposure: number, turbidity: number, rayleigh: number, night: number }}
 *   night: 0 di giorno, 1 a notte fonda (stelle, lampada accesa)
 */
export function lightFor(elevation) {
  const deg = elevation / DEG
  // day: 0 all'orizzonte, 1 da 25 gradi in su. night: da -2 a -12 gradi.
  const day = smooth(0, 25, deg)
  const night = smooth(-2, -12, deg)
  const low = 1 - day
  const sunColor = night > 0 ? mixColor(SUN_LOW, MOON, night) : mixColor(SUN_LOW, SUN_DAY, day)
  const skyColor = mixColor(mixColor(SKY_LOW, SKY_DAY, day), SKY_NIGHT, night)
  return {
    sunColor,
    sunIntensity: mix(mix(0.9, 2.2, day), 0.35, night),
    skyColor,
    groundColor: mixColor(GROUND_DAY, GROUND_NIGHT, night),
    hemiIntensity: mix(mix(0.9, 1.4, day), 0.45, night),
    // L'esposizione scende di notte, ma l'avatar deve restare visibile: le sue
    // luci non vanno mai sotto un minimo (vedi sunIntensity e hemiIntensity).
    exposure: mix(mix(0.45, 0.5, day), 0.3, night),
    turbidity: mix(8, 4, day) + low * 2,
    rayleigh: mix(3, 1.5, day),
    night,
  }
}

// Codici meteo WMO usati da Open-Meteo: https://open-meteo.com/en/docs
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const FOG_CODES = new Set([45, 48])

/**
 * Cosa fa il meteo alla scena. Senza meteo (spento o non arrivato) nulla.
 * @param {{ code?: number, cloudCover?: number } | null | undefined} weather
 * @returns {{ cloud: number, rain: number, snow: number, fog: number, dim: number }}
 *   cloud, rain, snow e fog da 0 a 1; dim moltiplica la luce del sole
 */
export function weatherEffect(weather) {
  if (!weather || typeof weather !== 'object') return { cloud: 0, rain: 0, snow: 0, fog: 0, dim: 1 }
  const code = Number(weather.code)
  const cloud = Math.max(0, Math.min(1, (Number(weather.cloudCover) || 0) / 100))
  const heavy = [65, 67, 82, 75, 86, 95, 96, 99].includes(code)
  const rain = RAIN_CODES.has(code) ? (heavy ? 1 : 0.5) : 0
  const snow = SNOW_CODES.has(code) ? (heavy ? 1 : 0.5) : 0
  const fog = FOG_CODES.has(code) ? 1 : 0
  return { cloud, rain, snow, fog, dim: 1 - 0.55 * Math.max(cloud, rain, snow, fog * 0.6) }
}

// Tinta leggera per emozione: moltiplica il colore della luce ambiente.
const MOOD_TINTS = {
  joy: [1.06, 1.02, 0.94],
  affection: [1.07, 0.97, 0.98],
  calm: [0.97, 1.02, 1.03],
  sadness: [0.9, 0.95, 1.08],
  annoyance: [1.06, 0.94, 0.92],
  curiosity: [1.0, 1.03, 1.02],
}

/**
 * Tinta dall'umore: ogni emozione pesa quanto e' forte. Al massimo pochi
 * punti percentuali, deve sentirsi appena.
 * @param {{ emotions?: Record<string, number> } | null | undefined} mood
 * @returns {number[]}
 */
export function moodTint(mood) {
  const e = (mood && mood.emotions) || {}
  const tint = [1, 1, 1]
  for (const [name, color] of Object.entries(MOOD_TINTS)) {
    const w = Math.max(0, Math.min(1, Number(e[name]) || 0))
    for (let i = 0; i < 3; i++) tint[i] *= mix(1, color[i], w)
  }
  return tint
}
