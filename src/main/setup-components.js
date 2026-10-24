// setup-components.js — i componenti che l'installer chiede di scaricare.
//
// Con le caselle spuntate nella pagina "Componenti facoltativi" il setup
// lancia l'app con --install-components=xtts,stt,kimodo: l'app apre una
// finestra con l'avanzamento, scarica e installa quei componenti (come dalle
// Impostazioni) e si chiude. Puro, con test.

const COMPONENTS = ['xtts', 'stt', 'kimodo']   // in quest'ordine: il microfono usa il Python di XTTS

const LABELS = {
  xtts: 'Voce realistica (XTTS)',
  stt: 'Microfono',
  kimodo: 'Movimenti nuovi (Kimodo)',
}

/**
 * I componenti chiesti dalla riga di comando, validi e in ordine; il
 * microfono si porta dietro XTTS. [] se il parametro non c'e'.
 * @param {string[]} argv
 */
function parseComponents(argv) {
  const arg = (argv || []).find(a => typeof a === 'string' && a.startsWith('--install-components='))
  if (!arg) return []
  const want = new Set(arg.slice('--install-components='.length).split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  if (want.has('stt')) want.add('xtts')
  return COMPONENTS.filter(c => want.has(c))
}

module.exports = { COMPONENTS, LABELS, parseComponents }
