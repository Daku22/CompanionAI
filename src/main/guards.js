// guards.js — controlli su cio' che arriva dal modello o dal renderer.
//
// Le azioni le propone un modello, la configurazione la manda un renderer:
// nessuno dei due e' fidato. Qui stanno le regole, separate da main.js perche'
// non dipendono da Electron e si possono verificare da Node
// (scripts/test-guards.js).

const fs = require('fs')
const path = require('path')
const { PROVIDERS, DIRECTIONS, DISTANCES } = require('./ai-router')

const ALLOWED_URL_PROTO = ['https:', 'http:']

// Estensioni che Windows esegue invece di aprire in un programma. Aprirle con
// shell.openPath equivale a lanciarle.
const EXECUTABLE_EXT = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.msi', '.msp', '.scr', '.pif', '.hta', '.cpl', '.jar', '.reg',
  '.msc', '.inf', '.scf', '.appref-ms', '.application', '.gadget', '.lnk', '.url',
])

// Le scorciatoie sul Desktop sono il modo normale di aprire un programma, e le
// ha messe li' l'utente: per open-desktop-item restano ammesse.
const DESKTOP_SHORTCUT_EXT = new Set(['.lnk', '.url'])

// Programmi ammessi da run-command e che argomento accettano. Il nome va
// confrontato per intero: "C:\qualsiasi\notepad.exe" non e' notepad.
//   file   - un file da aprire (notepad e mspaint non eseguono cio' che aprono)
//   folder - una cartella esistente: explorer lancia anche gli eseguibili
//   none   - nessun argomento
const SAFE_COMMANDS = {
  notepad:  'file',
  mspaint:  'file',
  calc:     'none',
  explorer: 'folder',
}

function isSafeUrl(u) {
  try {
    return ALLOWED_URL_PROTO.includes(new URL(u).protocol)
  } catch (_) { return false }
}

function isExecutable(file) {
  return EXECUTABLE_EXT.has(path.extname(String(file)).toLowerCase())
}

function sanitizeDesktopName(name) {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('\0')) return null
  const base = path.basename(name.trim())
  if (!base || base === '.' || base === '..') return null
  if (/[<>:"|?*]/.test(base)) return null
  if (base.length > 128) return null
  return base
}

/**
 * open-path: solo percorsi assoluti esistenti che non siano eseguibili.
 * @returns {{ path: string } | { error: string }}
 */
function checkOpenPath(p) {
  if (typeof p !== 'string' || !p) return { error: 'percorso mancante' }
  const norm = path.normalize(p)
  if (!path.isAbsolute(norm)) return { error: 'percorso non assoluto' }
  if (isExecutable(norm)) return { error: 'file eseguibile: aprirlo lo lancerebbe' }
  if (!fs.existsSync(norm)) return { error: 'percorso inesistente' }
  return { path: norm }
}

/**
 * open-desktop-item: un elemento dentro il Desktop. Senza nome, o se il nome
 * non esiste, si apre il Desktop stesso.
 * @returns {{ path: string } | { error: string }}
 */
function checkDesktopItem(name, desktopPath) {
  const safe = sanitizeDesktopName(name || '')
  if (!safe) return { path: desktopPath }
  const target = path.normalize(path.join(desktopPath, safe))
  if (!target.startsWith(desktopPath + path.sep)) return { error: 'percorso fuori dal Desktop' }
  if (!fs.existsSync(target)) return { path: desktopPath }
  const ext = path.extname(target).toLowerCase()
  if (isExecutable(target) && !DESKTOP_SHORTCUT_EXT.has(ext)) {
    return { error: 'file eseguibile sul Desktop: aprilo tu, se ti fidi' }
  }
  return { path: target }
}

/**
 * run-command: programma in allowlist, con l'argomento che il suo tipo ammette.
 * L'argomento e' tutto cio' che segue il programma, cosi' i percorsi con spazi
 * restano interi.
 * @param {string} cmd
 * @param {{ allowUnsafe?: boolean }} [opts]
 * @returns {{ program: string, args: string[] } | { error: string }}
 */
function parseCommand(cmd, { allowUnsafe = false } = {}) {
  if (typeof cmd !== 'string' || !cmd.trim()) return { error: 'comando vuoto' }
  const [program, ...rest] = cmd.trim().split(/\s+/)
  if (allowUnsafe) return { program, args: rest }

  const name = program.toLowerCase().replace(/\.exe$/, '')
  const kind = /[\\/:]/.test(program) ? undefined : SAFE_COMMANDS[name]
  if (!kind) return { error: 'non in allowlist: ' + program }

  const arg = rest.join(' ').replace(/^"(.*)"$/, '$1')
  if (!arg) return { program: name, args: [] }
  if (kind === 'none') return { error: name + ' non accetta argomenti' }
  if (kind === 'folder') {
    let isDir = false
    try { isDir = path.isAbsolute(arg) && fs.statSync(arg).isDirectory() } catch (_) {}
    if (!isDir) return { error: 'explorer accetta solo una cartella esistente' }
  }
  return { program: name, args: [arg] }
}

/**
 * Verso e distanza di una camminata proposta dal modello. Passano solo i
 * valori del contratto: il resto dell'azione viene dal modello e non e' fidato.
 * @param {any} action
 * @returns {{ direction?: string, distance?: string }}
 */
function checkMotion(action) {
  const out = {}
  if (!action || typeof action !== 'object') return out
  if (DIRECTIONS.includes(action.direction)) out.direction = action.direction
  if (DISTANCES.includes(action.distance)) out.distance = action.distance
  return out
}

/**
 * Fonde la configurazione inviata dal renderer con quella salvata.
 *
 * Solo i campi che la UI puo' davvero cambiare passano. Tutto il resto, per
 * esempio allowUnsafeCommands, si imposta a mano in config.json: altrimenti
 * basterebbe una chiamata a setConfig dal renderer per aprire l'esecuzione di
 * comandi arbitrari. Le chiavi vengono fuse, non sostituite.
 */
// Dimensioni della finestra del companion, scelte dal menu col tasto destro.
// Al posto del ridimensionamento dai bordi: con i clic che attraversano i
// pixel vuoti i bordi della finestra non si possono piu' afferrare.
const WINDOW_SCALES = {
  s:  { label: 'Piccola', width: 140, height: 200 },
  m:  { label: 'Media', width: 180, height: 260 },
  l:  { label: 'Grande', width: 240, height: 346 },
  xl: { label: 'Molto grande', width: 320, height: 460 },
}

function mergeConfig(current, incoming) {
  const merged = { ...current, keys: { ...(current.keys || {}) } }
  if (!incoming || typeof incoming !== 'object') return merged
  if (typeof incoming.provider === 'string' && PROVIDERS[incoming.provider]) merged.provider = incoming.provider
  if (typeof incoming.model === 'string' && incoming.model.trim()) merged.model = incoming.model.trim()
  if (typeof incoming.avatarModel === 'string' && incoming.avatarModel.trim()) merged.avatarModel = incoming.avatarModel.trim()
  if (typeof incoming.idleLife === 'boolean') merged.idleLife = incoming.idleLife
  if (typeof incoming.followMouse === 'boolean') merged.followMouse = incoming.followMouse
  if (typeof incoming.alwaysOnTop === 'boolean') merged.alwaysOnTop = incoming.alwaysOnTop
  // Solo l'interruttore: la cartella di Kimodo (kimodoDir) si scrive a mano.
  if (typeof incoming.kimodo === 'boolean') merged.kimodo = incoming.kimodo
  if (typeof incoming.perch === 'boolean') merged.perch = incoming.perch
  if (typeof incoming.scale === 'string' && Object.prototype.hasOwnProperty.call(WINDOW_SCALES, incoming.scale)) merged.scale = incoming.scale
  if (incoming.keys && typeof incoming.keys === 'object') {
    for (const [provider, value] of Object.entries(incoming.keys)) {
      if (PROVIDERS[provider] && typeof value === 'string' && value.trim()) merged.keys[provider] = value.trim()
    }
  }
  return merged
}

/**
 * Chiavi da scrivere su disco. Quelle che non si sono potute decifrare restano
 * com'erano, cifrate: prima venivano tolte dalla config in memoria, e il primo
 * salvataggio (anche solo un interruttore) le cancellava dal disco per sempre.
 * Una chiave nuova per lo stesso provider sostituisce quella illeggibile.
 * @param {Record<string, string>} keys chiavi in chiaro
 * @param {Record<string, string>} unreadable chiavi cifrate non decifrabili
 * @param {((value: string) => string) | null} encrypt null se la cifratura non e' disponibile
 */
function keysForDisk(keys, unreadable, encrypt) {
  const out = {}
  for (const [provider, value] of Object.entries(keys || {})) out[provider] = encrypt ? encrypt(value) : value
  // Senza cifratura le chiavi illeggibili non si possono conservare accanto a
  // quelle in chiaro: il file le segnerebbe come testo.
  if (encrypt) {
    for (const [provider, blob] of Object.entries(unreadable || {})) if (!(provider in out)) out[provider] = blob
  }
  return out
}

/**
 * Provider a cui va la chiave del vecchio formato di config.json: un solo
 * `apiKey` in chiaro, senza provider. Il codice non lo leggeva piu', ma il
 * salvataggio lo ricopiava com'era: una chiave in chiaro accanto a quelle
 * cifrate. Decide il prefisso, il piu' lungo ("sk-ant-" prima di "sk-"); senza
 * prefisso noto va al provider che non ne ha uno (Mistral). Se quel provider ha
 * gia' una chiave leggibile, quella vecchia non serve.
 * @param {unknown} legacy valore di `apiKey`
 * @param {Record<string, string>} keys chiavi leggibili
 * @returns {string|null} null se la chiave va solo tolta dal file
 */
function legacyKeyProvider(legacy, keys) {
  if (typeof legacy !== 'string' || !legacy.trim()) return null
  const value = legacy.trim()
  let target = null
  let best = 0
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (p.keyPrefix && value.startsWith(p.keyPrefix) && p.keyPrefix.length > best) { target = name; best = p.keyPrefix.length }
  }
  if (!target) target = Object.keys(PROVIDERS).find(name => PROVIDERS[name].keyPrefix === '') || null
  if (!target || (keys && keys[target])) return null
  return target
}

/**
 * Un messaggio IPC viene accettato solo dalle pagine del renderer del progetto.
 * Oggi l'app non apre altre pagine, ma ogni handler esegue azioni del main:
 * se un domani una pagina esterna finisse in una finestra (un link, un
 * iframe), non deve poter salvare chiavi o lanciare comandi.
 * @param {string|undefined} senderUrl URL della pagina che ha inviato il messaggio
 * @param {string} rendererDirUrl URL file:// della cartella src/renderer/, con la barra finale
 */
function isTrustedSender(senderUrl, rendererDirUrl) {
  if (typeof senderUrl !== 'string' || !senderUrl.startsWith('file:')) return false
  // Windows non distingue maiuscole e minuscole nei percorsi: nemmeno qui.
  return senderUrl.toLowerCase().startsWith(rendererDirUrl.toLowerCase()) && !senderUrl.includes('..')
}

module.exports = {
  isTrustedSender,
  SAFE_COMMANDS,
  isSafeUrl,
  isExecutable,
  sanitizeDesktopName,
  checkOpenPath,
  checkDesktopItem,
  parseCommand,
  mergeConfig,
  WINDOW_SCALES,
  checkMotion,
  keysForDisk,
  legacyKeyProvider,
}
