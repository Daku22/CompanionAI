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

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Scelta del microfono ===')

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
