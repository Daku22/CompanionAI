// logger.js — errori e avvisi su file, per le segnalazioni.
//
// Chi usa l'installer non vede la console: senza un file, un errore segnalato
// arriva come "non funziona". Qui finiscono solo avvisi ed errori, del main e
// dei renderer, in <userData>/logs/main.log. Niente parte dal PC: nessuna
// telemetria. La cartella si apre dal menu dell'icona nella barra di sistema.

const fs = require('fs')
const path = require('path')

const MAX_BYTES = 1024 * 1024

/**
 * Duplica console.warn e console.error su file. Il file precedente, oltre
 * MAX_BYTES, diventa main.old.log: ne restano al massimo due.
 * @param {string} dir cartella dei log
 * @returns {string} percorso del file
 */
function setupLogging(dir) {
  const file = path.join(dir, 'main.log')
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(dir, 'main.old.log'))
    }
  } catch (_) { return file }

  const write = (level, args) => {
    const text = args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a))).join(' ')
    try { fs.appendFileSync(file, new Date().toISOString() + ' ' + level + ' ' + text + '\n') } catch (_) {}
  }
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => { original(...args); write(level.toUpperCase(), args) }
  }
  process.on('uncaughtException', (error) => console.error('[main] eccezione non gestita:', error))
  process.on('unhandledRejection', (reason) => console.error('[main] promessa rifiutata non gestita:', reason))
  return file
}

function safeJson(value) {
  try { return JSON.stringify(value) } catch (_) { return String(value) }
}

module.exports = { setupLogging }
