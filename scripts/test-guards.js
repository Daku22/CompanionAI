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
  isSafeUrl, checkOpenPath, checkDesktopItem, parseCommand, mergeConfig, isTrustedSender, checkMotion, keysForDisk, legacyKeyProvider, WINDOW_SCALES,
  voiceConfig, VOICE_DEFAULTS, allowPermission, MIC_SHORTCUTS,
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

test('Kimodo: la UI accende e spegne, ma non sceglie la cartella da eseguire', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {}, kimodoDir: 'D:/kimodo' }
  assert.equal(mergeConfig(base, { kimodo: true }).kimodo, true)
  assert.equal(mergeConfig(base, { kimodo: 'si' }).kimodo, undefined)
  const merged = mergeConfig(base, { kimodoDir: 'C:/Windows/System32' })
  assert.equal(merged.kimodoDir, 'D:/kimodo', 'kimodoDir si scrive solo a mano in config.json')
})

test('stanza: scena e meteo dalla UI, modalita\' e posto della stanza no', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {}, view: 'room', roomBounds: { x: 1, y: 2, width: 800, height: 600 } }
  const ok = mergeConfig(base, { roomScene: 'giardino', weather: true, weatherCity: '  Reggio \n Emilia ' })
  assert.equal(ok.roomScene, 'giardino')
  assert.equal(ok.weather, true)
  assert.equal(ok.weatherCity, 'Reggio Emilia')
  const bad = mergeConfig(base, { roomScene: '../x', weather: 'si', weatherCity: 7, view: 'desktop', roomBounds: { x: 0 } })
  assert.equal(bad.roomScene, undefined)
  assert.equal(bad.weather, undefined)
  assert.equal(bad.weatherCity, undefined)
  assert.equal(bad.view, 'room', 'la modalita\' la cambia solo il main')
  assert.deepEqual(bad.roomBounds, base.roomBounds)
  assert.equal(mergeConfig(base, { weatherCity: 'x'.repeat(300) }).weatherCity.length, 80)
})

test('voce: spenta di base, solo valori ammessi, i campi mancanti restano', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {} }
  assert.deepEqual(voiceConfig(base), VOICE_DEFAULTS)
  assert.equal(VOICE_DEFAULTS.enabled, false)
  const on = mergeConfig(base, { voice: { enabled: true, kokoroVoice: 'im_nicola', speed: 1.1 } })
  assert.deepEqual(on.voice, { ...VOICE_DEFAULTS, enabled: true, kokoroVoice: 'im_nicola', speed: 1.1 })
  const bad = mergeConfig(on, { voice: { enabled: 'si', engine: 'inventato', kokoroVoice: '../x', speed: 9, volume: -3, extra: 1 } })
  assert.equal(bad.voice.enabled, true, 'un valore non booleano non cambia niente')
  assert.equal(bad.voice.engine, 'kokoro')
  assert.equal(bad.voice.kokoroVoice, 'im_nicola')
  assert.equal(bad.voice.speed, 1.4, 'velocita\' nei limiti')
  assert.equal(bad.voice.volume, 0)
  assert.equal(bad.voice.extra, undefined)
  assert.equal(mergeConfig(on, { voice: 'on' }).voice.enabled, true, 'voce non oggetto: ignorata')
})

test('voce XTTS: motore, voce inclusa o campione, licenza; il file del campione no', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {}, voice: { xttsSample: 'voce-123456789.wav' } }
  const ok = mergeConfig(base, { voice: { engine: 'xtts', xttsSpeaker: 'Ana Florence', cpmlAccepted: true } })
  assert.equal(ok.voice.engine, 'xtts')
  assert.equal(ok.voice.xttsSpeaker, 'Ana Florence')
  assert.equal(ok.voice.cpmlAccepted, true)
  assert.equal(ok.voice.xttsSample, 'voce-123456789.wav', 'il campione salvato resta')
  const bad = mergeConfig(ok, { voice: { xttsSpeaker: '../../x', xttsSample: 'C:/Windows/win.ini', cpmlAccepted: 'si' } })
  assert.equal(bad.voice.xttsSpeaker, 'Ana Florence')
  assert.equal(bad.voice.xttsSample, 'voce-123456789.wav', 'lo sceglie solo il main')
  assert.equal(bad.voice.cpmlAccepted, true)
  assert.equal(mergeConfig(base, { voice: { xttsSpeaker: 'sample' } }).voice.xttsSpeaker, 'sample')
})

test('microfono: interruttore e scorciatoia solo fra quelle previste', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {} }
  assert.equal(voiceConfig(base).micEnabled, false, 'spento di base')
  const on = mergeConfig(base, { voice: { micEnabled: true, micShortcut: 'F9' } })
  assert.equal(on.voice.micEnabled, true)
  assert.equal(on.voice.micShortcut, 'F9')
  const bad = mergeConfig(on, { voice: { micEnabled: 1, micShortcut: 'Alt+F4' } })
  assert.equal(bad.voice.micEnabled, true)
  assert.equal(bad.voice.micShortcut, 'F9')
  assert.equal(mergeConfig(on, { voice: { micShortcut: 'toString' } }).voice.micShortcut, 'F9', 'niente nomi ereditati')
  for (const [key, s] of Object.entries(MIC_SHORTCUTS)) assert.ok(key === 'off' ? s.vk === 0 : s.vk > 0, key)
})

test('microfono scelto: id di Chromium e nome ripulito; vuoto torna al predefinito', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {} }
  const id = 'a3f09c1be2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e'
  const on = mergeConfig(base, { voice: { micDevice: id, micDeviceLabel: '  Microfono\n(USB   Audio)\u0007 ' } })
  assert.equal(on.voice.micDevice, id)
  assert.equal(on.voice.micDeviceLabel, 'Microfono (USB Audio)')
  assert.equal(mergeConfig(on, { voice: { micDevice: '../../x y', micDeviceLabel: 'altro' } }).voice.micDevice, id, 'id non valido: resta il vecchio')
  assert.equal(mergeConfig(on, { voice: { micDevice: 'x'.repeat(201) } }).voice.micDevice, id)
  assert.equal(mergeConfig(on, { voice: { micDeviceLabel: 'solo il nome' } }).voice.micDeviceLabel, 'Microfono (USB Audio)', 'il nome cambia solo con l\'id')
  const def = mergeConfig(on, { voice: { micDevice: '', micDeviceLabel: 'resto' } })
  assert.equal(def.voice.micDevice, '')
  assert.equal(def.voice.micDeviceLabel, '', 'predefinito: niente nome')
  assert.equal(mergeConfig(base, { voice: { micDevice: id, micDeviceLabel: 'x'.repeat(300) } }).voice.micDeviceLabel.length, 120)
})

test('licenza di Live2D: solo un booleano, spenta di base', () => {
  const base = { provider: 'openrouter', model: 'm', keys: {} }
  assert.equal(mergeConfig(base, {}).live2dAccepted, undefined)
  const yes = mergeConfig(base, { live2dAccepted: true })
  assert.equal(yes.live2dAccepted, true)
  assert.equal(mergeConfig(yes, { live2dAccepted: 'si' }).live2dAccepted, true)
  assert.equal(mergeConfig(yes, { live2dAccepted: false }).live2dAccepted, false)
})

test('permessi: solo il microfono, solo per le pagine dell\'app, solo se acceso', () => {
  const dir = 'file:///C:/app/src/renderer/'
  const chat = 'file:///C:/app/src/renderer/chat.html'
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaTypes: ['audio'] }, dir, true), true)
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaType: 'audio' }, dir, true), true, 'controllo (check handler)')
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaTypes: ['audio'] }, dir, false), false, 'microfono spento')
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaTypes: ['audio', 'video'] }, dir, true), false, 'mai la fotocamera')
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaTypes: [] }, dir, true), false)
  assert.equal(allowPermission('media', { requestingUrl: chat, mediaType: 'video' }, dir, true), false)
  assert.equal(allowPermission('media', { requestingUrl: 'https://esempio.it/', mediaTypes: ['audio'] }, dir, true), false, 'pagina esterna')
  assert.equal(allowPermission('media', { requestingUrl: 'file:///C:/altro/x.html', mediaTypes: ['audio'] }, dir, true), false)
  assert.equal(allowPermission('notifications', { requestingUrl: chat }, dir, true), false)
  assert.equal(allowPermission('geolocation', { requestingUrl: chat }, dir, true), false)
  assert.equal(allowPermission('media', undefined, dir, true), false)
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

test('la chiave in chiaro del vecchio formato va al provider del suo prefisso', () => {
  assert.equal(legacyKeyProvider('sk-ant-1', {}), 'claude', '"sk-ant-" prima di "sk-"')
  assert.equal(legacyKeyProvider('sk-or-1', {}), 'openrouter')
  assert.equal(legacyKeyProvider('sk-proj-1', {}), 'openai')
  assert.equal(legacyKeyProvider(' AIza1 ', {}), 'gemini')
  assert.equal(legacyKeyProvider('senzaprefisso', {}), 'mistral', 'Mistral non ha un prefisso')
  // Una chiave leggibile per lo stesso provider vince: quella vecchia si toglie.
  assert.equal(legacyKeyProvider('sk-ant-vecchia', { claude: 'sk-ant-nuova' }), null)
  assert.equal(legacyKeyProvider('', {}), null)
  assert.equal(legacyKeyProvider(42, {}), null)
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
