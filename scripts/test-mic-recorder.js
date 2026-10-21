// test-mic-recorder.js — scelta del microfono (src/renderer/mic-recorder.js),
// caricato in Node con una pagina finta: elenco dei dispositivi e quale aprire.
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: 'Predefinito - Microfono (Realtek(R) Audio)' },
  { kind: 'audioinput', deviceId: 'communications', label: 'Comunicazioni - Cuffie (USB Audio)' },
  { kind: 'audioinput', deviceId: 'aaa111', label: 'Microfono (Realtek(R) Audio)' },
  { kind: 'audioinput', deviceId: 'bbb222', label: 'Cuffie (USB Audio)' },
  { kind: 'audiooutput', deviceId: 'ccc333', label: 'Altoparlanti (Realtek(R) Audio)' },
  { kind: 'videoinput', deviceId: 'ddd444', label: 'Webcam' },
]
const window = {}
const navigator = { mediaDevices: { enumerateDevices: async () => DEVICES } }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'mic-recorder.js'), 'utf8'), { window, navigator })
// Gli oggetti nati nel contesto vm hanno altri prototipi: si confrontano semplici.
const plain = (v) => JSON.parse(JSON.stringify(v))
const listInputs = async () => plain(await window.MicRecorder.listInputs())
const pickInput = (...args) => plain(window.MicRecorder.pickInput(...args))

const vadStep = (...args) => plain(window.MicRecorder.vadStep(...args))

/** Una sequenza di livelli, un blocco ogni 128 ms: gli eventi del rilevatore. */
function vadRun(levels, opts = { threshold: 0.2 }) {
  let state = null
  const events = []
  levels.forEach((level, i) => {
    const r = vadStep(state, level, i * 128, typeof opts === 'function' ? opts(i) : opts)
    state = r.state
    if (r.event) events.push(r.event + '@' + i)
  })
  return events
}
const quiet = (n) => Array(n).fill(0.03)
const voice = (n) => Array(n).fill(0.45)

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Scelta del microfono ===')

  await t('mani libere: un turno si apre con la voce e si chiude dopo 0,8 s di silenzio', async () => {
    assert.deepEqual(vadRun([...quiet(3), ...voice(10), ...quiet(10)]), ['start@3', 'end@19'])
    // Una pausa breve fra due parole non chiude il turno.
    assert.deepEqual(vadRun([...voice(5), ...quiet(3), ...voice(5), ...quiet(8)]), ['start@0', 'end@19'])
    // Un colpo sul tavolo (un blocco) e' rumore.
    assert.deepEqual(vadRun([...quiet(2), 0.9, ...quiet(9)]), ['start@2', 'discard@9'])
    // Il rumore di fondo non apre niente.
    assert.deepEqual(vadRun(quiet(30)), [])
  })

  await t('mani libere: sordo mentre il companion parla, e un turno lungo si chiude da solo', async () => {
    // Sordo dal blocco 4 in poi: il turno a meta' si scarta, la sua voce non apre turni.
    assert.deepEqual(vadRun([...voice(10), ...voice(10)], (i) => ({ threshold: 0.2, deaf: i >= 4 })), ['start@0', 'discard@4'])
    const long = vadRun(voice(300), { threshold: 0.2, maxMs: 30000 })
    assert.equal(long[0], 'start@0')
    assert.ok(long[1] && long[1].startsWith('end@'), 'oltre 30 s il turno si chiude: ' + long.join(' '))
  })

  await t('mani libere: la soglia dalla sensibilita\'', async () => {
    const th = window.MicRecorder.thresholdOf
    assert.ok(th(1) < th(0.5) && th(0.5) < th(0), 'piu\' sensibile, soglia piu\' bassa')
    assert.equal(th('x'), th(0.5))
    assert.ok(th(0.5) > 0.03 * 3 && th(0.5) < 0.45, 'sopra il rumore, sotto la voce')
  })

  await t('elenco: solo i microfoni veri, e il nome del predefinito', async () => {
    const list = await listInputs()
    assert.deepEqual(list.devices, [{ id: 'aaa111', label: 'Microfono (Realtek(R) Audio)' }, { id: 'bbb222', label: 'Cuffie (USB Audio)' }])
    assert.equal(list.defaultLabel, 'Microfono (Realtek(R) Audio)')
  })

  const devices = [{ id: 'aaa111', label: 'Microfono (Realtek(R) Audio)' }, { id: 'bbb222', label: 'Cuffie (USB Audio)' }]
  await t('nessuna scelta: il predefinito di Windows', () => {
    assert.deepEqual(pickInput(devices, {}), { id: null, missing: false })
    assert.deepEqual(pickInput(devices, { id: '' }), { id: null, missing: false })
    assert.deepEqual(pickInput(devices, undefined), { id: null, missing: false })
  })
  await t('scelto per id', () => {
    assert.deepEqual(pickInput(devices, { id: 'bbb222', label: 'Cuffie (USB Audio)' }), { id: 'bbb222', missing: false })
  })
  await t('id cambiato (altra porta USB): ritrovato per nome', () => {
    assert.deepEqual(pickInput(devices, { id: 'zzz999', label: 'Cuffie (USB Audio)' }), { id: 'bbb222', missing: false })
  })
  await t('scollegato: il predefinito, e si sa che manca', () => {
    assert.deepEqual(pickInput(devices, { id: 'zzz999', label: 'Microfono Blue Yeti' }), { id: null, missing: true })
    assert.deepEqual(pickInput(devices, { id: 'zzz999', label: '' }), { id: null, missing: true })
    assert.deepEqual(pickInput([{ id: 'x', label: '' }], { id: 'zzz999', label: '' }), { id: null, missing: true }, 'nomi vuoti non combaciano')
  })

  console.log('=== ' + passed + ' test superati ===')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
