#!/usr/bin/env node
// build.js — impacchetta l'app fuori dalla cartella sincronizzata.
//
// Produce l'installer NSIS. Con --dir (npm run dist) solo la cartella
// win-unpacked, piu' veloce per provare il pacchetto. La pubblicazione sulle
// GitHub Releases la fa la CI (.github/workflows/release.yml): in locale non si
// pubblica mai, anche se nell'ambiente c'e' un GH_TOKEN.
//
// Se il progetto sta in una cartella sincronizzata (OneDrive, Dropbox) e
// electron-builder scrive li' dentro, la
// sincronizzazione tiene aperto CompanionAI.exe mentre rcedit prova a scriverne
// icona e metadati, e la build fallisce con "Fatal error: Unable to commit
// changes". Ritenta e alla fine produce un exe, ma senza icona ne' versione.
//
// Scrivendo in una cartella locale il problema sparisce (verificato).
//
// Percorso di destinazione: $COMPANION_BUILD_OUT, altrimenti una cartella
// stabile sotto la temp di sistema. La posizione finale viene stampata a fine
// build, cosi' non bisogna andarla a cercare.

const { spawnSync } = require('child_process')
const os = require('os')
const path = require('path')
const fs = require('fs')

const outDir = process.env.COMPANION_BUILD_OUT || path.join(os.tmpdir(), 'companionai-build')

const extra = process.argv.slice(2)
const args = ['-c.directories.output=' + outDir, ...extra]
if (!extra.some(a => a.startsWith('--publish'))) args.push('--publish', 'never')

// La CLI di electron-builder si lancia con lo stesso Node, non tramite npx.cmd:
// da Node 18.20 / 20.12 avviare un .cmd senza shell fallisce con EINVAL, e la
// build usciva con codice 1 senza stampare niente, lasciando al suo posto il
// pacchetto della build precedente.
const cli = require.resolve('electron-builder/cli.js')

console.log('[build] destinazione: ' + outDir)
const res = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
})

if (res.error) {
  console.error('[build] electron-builder non avviato: ' + res.error.message)
  process.exit(1)
}
if (res.status !== 0) process.exit(res.status || 1)

const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const installer = path.join(outDir, 'CompanionAI-Setup-' + version + '.exe')
const exe = path.join(outDir, 'win-unpacked', 'CompanionAI.exe')
if (!extra.includes('--dir') && fs.existsSync(installer)) console.log('\n[build] installer: ' + installer)
else if (fs.existsSync(exe)) console.log('\n[build] pronto: ' + exe)
else console.log('\n[build] completata, output in ' + outDir)
