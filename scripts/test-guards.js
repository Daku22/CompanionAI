// test-guards.js — verifica i controlli su azioni OS e configurazione.
//
// Sono le regole che separano "il modello propone" da "il sistema esegue":
// ogni caso qui sotto e' un modo concreto in cui un'azione proposta avrebbe
// potuto lanciare un programma arbitrario.

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender, checkMotion, keysForDisk, WINDOW_SCALES,
} = require('../src/main/guards')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-guards-'))
const desktop = path.join(tmp, 'Desktop')
fs.mkdirSync(desktop)
for (const name of ['note.txt', 'virus.exe', 'script.bat', 'Chrome.lnk']) fs.writeFileSync(path.join(desktop, name), '')

console.log('=== Controlli su azioni e config ===\n')

// ── run-command ─────────────────────────────────────────────────────────────

test('un programma in allowlist chiamato per nome passa', () => {
  assert.deepEqual(parseCommand('notepad'), { program: 'notepad', args: [] })
  assert.deepEqual(parseCommand('CALC.EXE'), { program: 'calc', args: [] })
})

test('un percorso completo non vale come nome in allowlist', () => {
  // Il vecchio controllo guardava solo il nome finale: questo eseguiva
  // un binario qualsiasi, e il dialogo di conferma mostrava "notepad".
  assert.ok('error' in parseCommand('C:\\Users\\Public\\evil\\notepad.exe'))
  assert.ok('error' in parseCommand('./notepad'))
})

test('un programma fuori allowlist viene rifiutato', () => {
  assert.ok('error' in parseCommand('powershell -c "rm -r ~"'))
  assert.ok('error' in parseCommand('cmd /c calc'))
})

test('il file per notepad resta intero anche con gli spazi', () => {
  assert.deepEqual(parseCommand('notepad C:\\Mie Note\\lista.txt'),
    { program: 'notepad', args: ['C:\\Mie Note\\lista.txt'] })
})

test('calc non accetta argomenti', () => {
  assert.ok('error' in parseCommand('calc qualcosa'))
})

test('explorer apre solo cartelle esistenti, mai file', () => {
  // explorer lancia anche gli eseguibili: con un file sarebbe un open-path senza controlli.
  assert.deepEqual(parseCommand('explorer ' + desktop), { program: 'explorer', args: [desktop] })
  assert.ok('error' in parseCommand('explorer ' + path.join(desktop, 'virus.exe')))
  assert.ok('error' in parseCommand('explorer shell:startup'))
})

test('allowUnsafeCommands lascia passare qualunque comando', () => {
  assert.deepEqual(parseCommand('git status', { allowUnsafe: true }), { program: 'git', args: ['status'] })
})

// ── open-path e open-desktop-item ───────────────────────────────────────────

test('open-path apre un file normale', () => {
  assert.deepEqual(checkOpenPath(path.join(desktop, 'note.txt')), { path: path.join(desktop, 'note.txt') })
})

test('open-path non lancia eseguibili, script o scorciatoie', () => {
  for (const name of ['virus.exe', 'script.bat', 'Chrome.lnk']) {
    assert.ok('error' in checkOpenPath(path.join(desktop, name)), name + ' sarebbe stato eseguito')
  }
})

test('open-path rifiuta percorsi relativi o inesistenti', () => {
  assert.ok('error' in checkOpenPath('note.txt'))
  assert.ok('error' in checkOpenPath(path.join(desktop, 'non-esiste.txt')))
})

test('sul Desktop le scorciatoie restano apribili, gli eseguibili no', () => {
  assert.deepEqual(checkDesktopItem('Chrome.lnk', desktop), { path: path.join(desktop, 'Chrome.lnk') })
  assert.ok('error' in checkDesktopItem('virus.exe', desktop))
  assert.ok('error' in checkDesktopItem('script.bat', desktop))
})

test('un nome con ../ resta dentro il Desktop', () => {
  // Il nome viene ridotto al basename: "../../x" diventa "x", che qui non
  // esiste, quindi si apre il Desktop stesso.
  assert.deepEqual(checkDesktopItem('../../note.txt', desktop), { path: path.join(desktop, 'note.txt') })
  assert.deepEqual(checkDesktopItem('../../../Windows', desktop), { path: desktop })
})

test('solo http e https come URL', () => {
  assert.ok(isSafeUrl('https://example.com'))
  assert.ok(!isSafeUrl('file:///C:/Windows/System32/calc.exe'))
  assert.ok(!isSafeUrl('javascript:alert(1)'))
  assert.ok(!isSafeUrl('ms-settings:'))
})

// ── Configurazione dal renderer ─────────────────────────────────────────────

test('il renderer non puo-` attivare i comandi arbitrari', () => {
  const merged = mergeConfig({ provider: 'openrouter', model: 'm', keys: {} },
    { allowUnsafeCommands: true, provider: 'claude' })
  assert.equal(merged.allowUnsafeCommands, undefined)
  assert.equal(merged.provider, 'claude')
})

test('un flag messo a mano in config.json sopravvive al salvataggio', () => {
  const merged = mergeConfig({ provider: 'openrouter', model: 'm', keys: {}, allowUnsafeCommands: true },
    { model: 'altro' })
  assert.equal(merged.allowUnsafeCommands, true)
})

test('un provider sconosciuto viene ignorato, non azzera la scelta', () => {
  const merged = mergeConfig({ provider: 'claude', model: 'm', keys: {} }, { provider: 'inventato' })
  assert.equal(merged.provider, 'claude')
})

test('le chiavi vengono fuse e un campo vuoto non cancella quella salvata', () => {
  const merged = mergeConfig({ provider: 'claude', model: 'm', keys: { claude: 'sk-ant-1' } },
    { keys: { claude: '', openai: 'sk-2', inventato: 'x' } })
  assert.deepEqual(merged.keys, { claude: 'sk-ant-1', openai: 'sk-2' })
})

test('le opzioni della finestra passano solo con valori validi', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {}, scale: 'm' }
  const ok = mergeConfig(base, { followMouse: false, alwaysOnTop: false, scale: 'xl' })
  assert.equal(ok.followMouse, false)
  assert.equal(ok.alwaysOnTop, false)
  assert.equal(ok.scale, 'xl')
  const bad = mergeConfig(base, { followMouse: 'no', alwaysOnTop: 0, scale: 'toString' })
  assert.equal(bad.followMouse, undefined)
  assert.equal(bad.alwaysOnTop, undefined)
  assert.equal(bad.scale, 'm')
  for (const size of Object.values(WINDOW_SCALES)) assert.ok(size.width >= 140 && size.height >= 200)
})

test('verso e distanza passano solo con i valori del contratto', () => {
  assert.deepEqual(checkMotion({ type: 'none', animation: 'walk-to', direction: 'right', distance: 'edge' }), { direction: 'right', distance: 'edge' })
  assert.deepEqual(checkMotion({ direction: 'su', distance: 9000, bubble: 'ciao' }), {})
  assert.deepEqual(checkMotion(null), {})
})

test('una chiave illeggibile non si perde al primo salvataggio', () => {
  const encrypt = (v) => 'cifrata(' + v + ')'
  // Illeggibile e nessuna nuova: resta com'era sul disco.
  assert.deepEqual(keysForDisk({ claude: 'sk-ant-1' }, { openrouter: 'v10vecchia' }, encrypt),
    { claude: 'cifrata(sk-ant-1)', openrouter: 'v10vecchia' })
  // Reinserita: la nuova prende il posto di quella illeggibile.
  assert.deepEqual(keysForDisk({ openrouter: 'sk-or-2' }, { openrouter: 'v10vecchia' }, encrypt),
    { openrouter: 'cifrata(sk-or-2)' })
  // Senza cifratura non si mescolano chiavi cifrate e in chiaro.
  assert.deepEqual(keysForDisk({ claude: 'sk-ant-1' }, { openrouter: 'v10vecchia' }, null), { claude: 'sk-ant-1' })
})

test('la vita autonoma si spegne e si riaccende solo con un booleano', () => {
  const base = { provider: 'claude', model: 'm', keys: {}, idleLife: true }
  assert.equal(mergeConfig(base, { idleLife: false }).idleLife, false)
  assert.equal(mergeConfig({ ...base, idleLife: false }, { idleLife: true }).idleLife, true)
  assert.equal(mergeConfig(base, { idleLife: 'no' }).idleLife, true)
  assert.equal(mergeConfig(base, { provider: 'openai' }).idleLife, true, 'salvare il provider non la tocca')
})

// ── Mittente dei messaggi IPC ───────────────────────────────────────────────

const RENDERER = 'file:///C:/Programmi/CompanionAI/resources/app.asar/src/renderer/'

test('le pagine del progetto possono usare gli IPC', () => {
  assert.ok(isTrustedSender(RENDERER + 'companion.html', RENDERER))
  assert.ok(isTrustedSender(RENDERER + 'chat.html', RENDERER))
  assert.ok(isTrustedSender('file:///c:/programmi/companionai/resources/app.asar/src/renderer/chat.html', RENDERER),
    'Windows non distingue maiuscole e minuscole')
})

test('pagine esterne o fuori da src/renderer no', () => {
  assert.ok(!isTrustedSender('https://example.com/', RENDERER))
  assert.ok(!isTrustedSender('file:///C:/Users/x/Downloads/evil.html', RENDERER))
  assert.ok(!isTrustedSender(RENDERER + '../main/preload.js', RENDERER))
  assert.ok(!isTrustedSender('', RENDERER))
  assert.ok(!isTrustedSender(undefined, RENDERER))
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
