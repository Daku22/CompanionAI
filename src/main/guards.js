// guards.js — controlli su cio' che arriva dal modello o dal renderer.
//
// Le azioni le propone un modello, la configurazione la manda un renderer:
// nessuno dei due e' fidato. Qui stanno le regole, separate da main.js perche'
// non dipendono da Electron e si possono verificare da Node
// (scripts/test-guards.js).

const fs = require('fs')
const path = require('path')
const { PROVIDERS } = require('./ai-router')

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
 * Fonde la configurazione inviata dal renderer con quella salvata.
 *
 * Solo i campi che la UI puo' davvero cambiare passano. Tutto il resto, per
 * esempio allowUnsafeCommands, si imposta a mano in config.json: altrimenti
 * basterebbe una chiamata a setConfig dal renderer per aprire l'esecuzione di
 * comandi arbitrari. Le chiavi vengono fuse, non sostituite.
 */
function mergeConfig(current, incoming) {
  const merged = { ...current, keys: { ...(current.keys || {}) } }
  if (!incoming || typeof incoming !== 'object') return merged
  if (typeof incoming.provider === 'string' && PROVIDERS[incoming.provider]) merged.provider = incoming.provider
  if (typeof incoming.model === 'string' && incoming.model.trim()) merged.model = incoming.model.trim()
  if (typeof incoming.avatarModel === 'string' && incoming.avatarModel.trim()) merged.avatarModel = incoming.avatarModel.trim()
  if (incoming.keys && typeof incoming.keys === 'object') {
    for (const [provider, value] of Object.entries(incoming.keys)) {
      if (PROVIDERS[provider] && typeof value === 'string' && value.trim()) merged.keys[provider] = value.trim()
    }
  }
  return merged
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
}
