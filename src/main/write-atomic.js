// write-atomic.js — scrittura di file che non lascia mai un JSON a meta'.
// Condivisa da MemoryManager e dall'umore (mood.js).

const fs = require('fs')
const crypto = require('crypto')

// Scrittura atomica: un crash a meta' scrittura lascia il file vecchio intatto
// invece di un JSON troncato che al reload farebbe perdere tutto lo stato.
// Il nome temporaneo e' unico perche' un turno e una compattazione possono
// salvare lo stesso file nello stesso momento.
async function writeAtomic(file, data) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'
  await fs.promises.writeFile(tmp, data, 'utf-8')
  try {
    await fs.promises.rename(tmp, file)
  } catch (_) {
    // Su Windows rename fallisce se un altro processo (antivirus, indicizzatore)
    // tiene aperto il file: meglio una scrittura diretta che perdere il dato.
    await fs.promises.writeFile(file, data, 'utf-8')
    await fs.promises.rm(tmp, { force: true })
  }
}

module.exports = { writeAtomic }
