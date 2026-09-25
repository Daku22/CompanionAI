#!/usr/bin/env node
// check-publish.js — controllo prima di pubblicare repository o installer.
//
// Il progetto e' nato con asset che non si possono ridistribuire (Neko ha
// "Redistribution_Prohibited" nei metadati, Dust una licenza non verificabile,
// Yanineko e' un personaggio di un anime) e che ora vivono fuori dal
// repository. Questo script impedisce che rientrino per sbaglio, e che un
// segreto finisca in un commit pubblico.
//
// Controlla i file che git pubblicherebbe (git ls-files) e, se esiste, il
// contenuto dell'app.asar del pacchetto. Esce con codice 1 se trova qualcosa.
//
// Uso: npm run check:publish [-- --asar <percorso di app.asar>]

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

// Nomi che non devono comparire fra i file pubblicati.
const FORBIDDEN_PATHS = [
  /(^|[\\/])reference-yanineko([\\/]|$)/i,
  /(^|[\\/])strips-master([\\/]|$)/i,
  /(^|[\\/])(companion-)?private-assets([\\/]|$)/i,
  /yanineko/i,
  /bikini_neko|(^|[\\/])neko[\\/]/i,
  /(^|[\\/])dust[\\/]|dust\.vrm/i,
  /(^|[\\/])research[\\/]/i,
  /(^|[\\/])\.env$/i,
]
// Gli unici modelli 3D pubblicabili: vedi ASSETS-LICENSE.md.
const ALLOWED_VRM = [/modelli-3d[\\/]Fred[\\/]Fred_optimized\.vrm$/i]
// Chiavi API riconoscibili dal prefisso.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-or-v1-[a-f0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /xai-[A-Za-z0-9]{20,}/,
  /sk-(proj-)?[A-Za-z0-9]{32,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
// Questo file contiene i nomi proibiti come regole, non come asset.
const SELF = new Set(['scripts/check-publish.js', 'ASSETS-LICENSE.md', 'docs/avatar-brief.md'])
const TEXT_EXT = new Set(['.js', '.mjs', '.ts', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.example', ''])

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    // Solo i file presenti su disco: un file tolto dall'albero ma ancora
    // nell'indice sparisce con il prossimo commit, e il repository pubblico
    // nasce dall'albero di lavoro.
    return out.split('\n').filter(Boolean).filter(f => fs.existsSync(path.join(ROOT, f)))
  } catch (_) {
    throw new Error('git non disponibile: il controllo lavora sui file che git pubblicherebbe')
  }
}

function checkPaths(files, where) {
  const problems = []
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/')
    if (SELF.has(normalized)) continue
    if (FORBIDDEN_PATHS.some(re => re.test(normalized))) problems.push(where + ': asset non pubblicabile: ' + file)
    if (/\.vrm$/i.test(normalized) && !ALLOWED_VRM.some(re => re.test(normalized))) {
      problems.push(where + ': modello VRM senza licenza di ridistribuzione registrata: ' + file)
    }
  }
  return problems
}

function checkSecrets(files) {
  const problems = []
  for (const file of files) {
    if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue
    const full = path.join(ROOT, file)
    if (!fs.existsSync(full) || fs.statSync(full).size > 2 * 1024 * 1024) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) problems.push('repository: possibile chiave segreta in ' + file + ' (' + re.source.slice(0, 20) + '…)')
    }
  }
  return problems
}

function asarFiles(asarPath) {
  const asar = require.resolve('@electron/asar/bin/asar.js')
  const out = execFileSync(process.execPath, [asar, 'list', asarPath], { encoding: 'utf8' })
  return out.split('\n').map(l => l.trim()).filter(Boolean)
}

function main() {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--asar')
  const asarPath = i === -1 ? null : path.resolve(argv[i + 1])

  const files = trackedFiles()
  const problems = [...checkPaths(files, 'repository'), ...checkSecrets(files)]
  let summary = files.length + ' file del repository'
  if (asarPath) {
    const packed = asarFiles(asarPath)
    problems.push(...checkPaths(packed, 'app.asar'))
    summary += ', ' + packed.length + ' voci di app.asar'
  }

  if (problems.length) {
    console.error('[check:publish] NON pubblicare:\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  console.log('[check:publish] ok: ' + summary + ', nessun asset privato ne\' segreto')
}

main()
