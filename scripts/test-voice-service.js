// test-voice-service.js — la coda della voce nel main (src/main/voice.js), con un motore finto.
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { VoiceService } = require('../src/main/voice')
const { KOKORO_FILES } = require('../src/main/voice-assets')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Motore finto: risponde dopo `delay` ms, con tanti campioni quanti caratteri. */
function fakeEngine({ delay = 5, failOn = null, failLoad = false } = {}) {
  const log = { spawned: 0, killed: 0, synth: [] }
  const spawn = () => {
    log.spawned++
    let handler = null
    let exitHandler = null
    return {
      send(msg) {
        setTimeout(() => {
          if (msg.type === 'load') handler(failLoad ? { type: 'error', id: msg.id, message: 'modello rotto' } : { type: 'ready', id: msg.id, ms: 1 })
          else if (msg.type === 'synth') {
            log.synth.push(msg.text)
            if (failOn && msg.text.includes(failOn)) handler({ type: 'error', id: msg.id, message: 'frase impossibile' })
            else handler({ type: 'audio', id: msg.id, pcm: new Float32Array(msg.text.length), rate: 24000 })
          }
        }, delay)
      },
      onMessage(fn) { handler = fn },
      onExit(fn) { exitHandler = fn },
      kill() { log.killed++; if (exitHandler) exitHandler(0) },
    }
  }
  return { spawn, log }
}

/** Una cartella con file finti della misura giusta: packStatus li da' per installati. */
function installedDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-voice-svc-'))
  for (const f of KOKORO_FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true })
    const fd = fs.openSync(path.join(dir, f.path), 'w')
    fs.ftruncateSync(fd, f.size)
    fs.closeSync(fd)
  }
  return dir
}

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Servizio della voce ===')
  const dir = installedDir()
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-voice-none-'))
  try {
    await t('senza file installati non parla e non avvia niente', async () => {
      const { spawn, log } = fakeEngine()
      const v = new VoiceService({ dir: empty, spawn, play: () => {} })
      assert.equal(await v.speak('Ciao, come stai?'), false)
      assert.equal(log.spawned, 0)
      assert.equal(v.status().installed, false)
    })

    await t('una frase alla volta, nell\'ordine, l\'ultima segnata', async () => {
      const { spawn, log } = fakeEngine()
      const played = []
      const v = new VoiceService({ dir, spawn, play: m => played.push(m) })
      assert.equal(await v.speak('Ciao! 😊 Come stai oggi? Io benissimo, grazie.'), true)
      const chunks = played.filter(m => m.type === 'chunk')
      assert.deepEqual(chunks.map(c => c.text), ['Ciao! Come stai oggi?', 'Io benissimo, grazie.'])
      assert.deepEqual(chunks.map(c => c.last), [false, true])
      assert.ok(chunks.every(c => c.pcm instanceof Float32Array && c.rate === 24000))
      assert.equal(log.spawned, 1)
      assert.equal(v.status().engine, 'ready')
      v.shutdown()
    })

    await t('una risposta nuova interrompe quella in corso', async () => {
      const { spawn } = fakeEngine({ delay: 30 })
      const played = []
      const v = new VoiceService({ dir, spawn, play: m => played.push(m) })
      const first = v.speak('Prima frase lunga da dire. Seconda frase che non deve arrivare. Terza nemmeno.')
      await sleep(80)
      const second = v.speak('Nuova risposta.')
      assert.equal(await first, false)
      assert.equal(await second, true)
      const texts = played.filter(m => m.type === 'chunk').map(c => c.text)
      assert.ok(!texts.includes('Terza nemmeno.'), texts.join(' | '))
      assert.equal(texts[texts.length - 1], 'Nuova risposta.')
      // Il companion riceve lo stop prima dei pezzi della risposta nuova.
      const lastStop = played.map(m => m.type).lastIndexOf('stop')
      assert.ok(lastStop < played.length - 1)
      v.shutdown()
    })

    await t('un errore del motore ferma la frase e finisce nello stato', async () => {
      const { spawn } = fakeEngine({ failOn: 'impossibile' })
      const played = []
      const v = new VoiceService({ dir, spawn, play: m => played.push(m) })
      assert.equal(await v.speak('Questa va bene. Questa invece e\' impossibile. Questa non arriva.'), false)
      assert.equal(v.status().error, 'frase impossibile')
      assert.equal(played[played.length - 1].type, 'stop')
      v.shutdown()
    })

    await t('un modello che non si carica: stato di errore, e si riprova alla volta dopo', async () => {
      const engine = fakeEngine({ failLoad: true })
      const v = new VoiceService({ dir, spawn: engine.spawn, play: () => {} })
      assert.equal(await v.speak('Ciao a tutti quanti.'), false)
      assert.equal(v.status().engine, 'error')
      assert.equal(v.status().error, 'modello rotto')
      v.shutdown()
    })

    await t('dopo il silenzio il processo si chiude, e riparte alla frase dopo', async () => {
      const { spawn, log } = fakeEngine()
      const v = new VoiceService({ dir, spawn, play: () => {}, idleMs: 40 })
      await v.speak('Ciao a tutti quanti.')
      await sleep(80)
      assert.equal(log.killed, 1)
      assert.equal(v.status().engine, 'off')
      await v.speak('Eccomi di nuovo qui.')
      assert.equal(log.spawned, 2)
      v.shutdown()
    })

    await t('il processo vero risponde con l\'id della richiesta (senza file: errore)', async () => {
      const { fork } = require('child_process')
      const worker = fork(path.join(__dirname, '..', 'src', 'main', 'kokoro-worker.js'), [empty], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' })
      try {
        const reply = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('nessuna risposta')), 20000)
          worker.on('message', (m) => { clearTimeout(timer); resolve(m) })
          worker.send({ type: 'load', id: 7 })
        })
        assert.equal(reply.type, 'error')
        assert.equal(reply.id, 7, 'senza id il main non abbina la risposta e aspetta fino al timeout')
      } finally { worker.kill() }
    })

    await t('elimina: ferma il motore e toglie i file', async () => {
      const own = installedDir()
      const { spawn, log } = fakeEngine()
      const v = new VoiceService({ dir: own, spawn, play: () => {} })
      await v.speak('Ciao a tutti quanti.')
      const s = await v.remove()
      assert.equal(s.installed, false)
      assert.equal(log.killed, 1)
      fs.rmSync(own, { recursive: true, force: true })
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(empty, { recursive: true, force: true })
  }
  console.log('=== ' + passed + ' test superati ===')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
