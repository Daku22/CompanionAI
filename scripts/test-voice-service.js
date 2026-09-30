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

    await t('una frase alla volta, nell\'ordine, con una pausa dopo ciascuna', async () => {
      const { spawn, log } = fakeEngine()
      const played = []
      const v = new VoiceService({ dir, spawn, play: m => played.push(m) })
      assert.equal(await v.speak('Ciao! 😊 Come stai oggi? Io benissimo, grazie.'), true)
      const chunks = played.filter(m => m.type === 'chunk')
      assert.deepEqual(chunks.map(c => c.text), ['Ciao! Come stai oggi?', 'Io benissimo, grazie.'])
      assert.deepEqual(played.filter(m => m.type !== 'stop').map(m => m.type), ['chunk', 'gap', 'chunk', 'gap'])
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

    // ── XTTS ────────────────────────────────────────────────────────────────
    /** XTTS finto: pezzi da 3 per frase, o un errore sulle frasi con failOn. */
    function fakeXtts({ failOn = null, device = 'cuda', delay = 5 } = {}) {
      const x = {
        state: 'off', error: null, info: null, onState: null, calls: [], started: 0, stopped: 0, aborted: 0,
        loaded: new Set(), loading: new Map(), heard: [], sttFail: null,
        async start(load = ['tts']) {
          if (x.state === 'ready') return
          x.started++; x.state = 'ready'; x.info = { device }; x.loaded = new Set(load)
        },
        async ensure(kind) { await x.start([kind]); x.loaded.add(kind) },
        async unload(kind) { x.loaded.delete(kind) },
        stop() { x.stopped++; x.state = 'off'; x.loaded = new Set() },
        async transcribe(pcm) {
          await x.ensure('stt')
          if (x.sttFail) throw new Error(x.sttFail)
          x.heard.push(pcm.length)
          return { text: '  Ciao,  come stai? Sottotitoli a cura di QTSS ', seconds: pcm.length / 16000, took: 0.3 }
        },
        async synth(text, opts, onAudio) {
          x.calls.push({ text, speaker: opts.speaker })
          if (failOn && text.includes(failOn)) throw new Error('GPU piena')
          for (let i = 0; i < 3; i++) {
            await sleep(delay)
            if (opts.signal && opts.signal.aborted) { x.aborted++; const e = new Error('interrotta'); e.name = 'AbortError'; throw e }
            onAudio(new Float32Array(10), 24000)
          }
        },
        async speakers() { return ['Ana Florence'] },
        async prepareSample(src, dst) { fs.writeFileSync(dst, 'wav'); return { ok: true, seconds: 12.5 } },
      }
      return x
    }
    const fakeSetup = (installed = true, install = async () => {}, stt = { installed: false, install: async () => {} }) => ({
      xttsInstalled: () => installed, installXtts: install, uninstallXtts: async () => { installed = false }, STEPS: [1, 2, 3, 4, 5],
      sttInstalled: () => installed && stt.installed, installStt: stt.install, STT_STEPS: [1, 2, 3],
      uninstallStt: async () => { stt.installed = false },
    })

    await t('XTTS scelto e installato: pezzi in streaming, pausa a fine frase', async () => {
      const xtts = fakeXtts()
      const played = []
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: m => played.push(m), xtts, setup: fakeSetup() })
      assert.equal(await v.speak('Prima frase detta bene. Seconda frase detta bene.', { engine: 'xtts', speaker: { builtin: 'Ana Florence' } }), true)
      assert.deepEqual(played.filter(m => m.type !== 'stop').map(m => m.type), ['chunk', 'chunk', 'chunk', 'gap', 'chunk', 'chunk', 'chunk', 'gap'])
      assert.deepEqual(xtts.calls.map(c => c.speaker), [{ builtin: 'Ana Florence' }, { builtin: 'Ana Florence' }])
      assert.equal(v.status().xtts.installed, true)
    })

    await t('XTTS non installato: parla Kokoro', async () => {
      const xtts = fakeXtts()
      const engine = fakeEngine()
      const v = new VoiceService({ dir, spawn: engine.spawn, play: () => {}, xtts, setup: fakeSetup(false) })
      assert.equal(await v.speak('Ciao a tutti quanti.', { engine: 'xtts' }), true)
      assert.equal(xtts.calls.length, 0)
      assert.deepEqual(engine.log.synth, ['Ciao a tutti quanti.'])
      v.shutdown()
    })

    await t('XTTS si guasta: la stessa frase e il resto con Kokoro, errore nello stato', async () => {
      const xtts = fakeXtts({ failOn: 'guasta' })
      const engine = fakeEngine()
      const played = []
      const v = new VoiceService({ dir, spawn: engine.spawn, play: m => played.push(m), xtts, setup: fakeSetup() })
      assert.equal(await v.speak('Questa va bene. Qui XTTS si guasta. E questa la dice Kokoro.', { engine: 'xtts' }), true)
      assert.deepEqual(engine.log.synth, ['Qui XTTS si guasta.', 'E questa la dice Kokoro.'])
      assert.equal(v.status().xtts.error, 'GPU piena')
      v.shutdown()
    })

    await t('stop interrompe la frase XTTS in corso', async () => {
      const xtts = fakeXtts({ delay: 40 })
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup() })
      const speaking = v.speak('Una frase lunga che non finira mai.', { engine: 'xtts' })
      await sleep(60)
      v.stop()
      assert.equal(await speaking, false)
      assert.equal(xtts.aborted, 1)
    })

    await t('il servizio XTTS si accende solo se serve, e si spegne un po\' dopo', async () => {
      const xtts = fakeXtts()
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup(), xttsIdleMs: 40 })
      v.syncService({ tts: true })
      assert.equal(xtts.started, 1)
      await sleep(5)
      // Chi cambia le impostazioni lo spegne e riaccende: non si spegne subito.
      v.syncService({ tts: false })
      assert.equal(xtts.stopped, 0)
      v.syncService({ tts: true })
      await sleep(60)
      assert.equal(xtts.stopped, 0, 'riacceso in tempo: resta acceso')
      v.syncService({ tts: false })
      await sleep(60)
      assert.equal(xtts.stopped, 1)
      const off = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup(false) })
      off.syncService({ tts: true, stt: true })
      assert.equal(off.xtts.started, 0, 'non installato: non parte')
    })

    await t('installazione: avanzamento, prova della GPU, errori nello stato', async () => {
      const seen = []
      const ok = new VoiceService({
        dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), onStatus: s => seen.push(s.xtts.installing && s.xtts.installing.step),
        setup: fakeSetup(false, async (_dir, o) => { o.onProgress({ step: 'packages', index: 2, count: 5, done: 1, total: 2 }); await o.check() }),
      })
      const s = await ok.installXtts()
      assert.ok(seen.includes('packages'))
      assert.equal(s.xtts.installing, null)
      assert.equal(s.xtts.error, null)
      const cpu = new VoiceService({
        dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts({ device: 'cpu' }),
        setup: fakeSetup(false, async (_dir, o) => { await o.check() }),
      })
      assert.match((await cpu.installXtts()).xtts.error, /scheda NVIDIA/)
      const cancelled = new VoiceService({
        dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(),
        setup: fakeSetup(false, (_dir, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('x'))))),
      })
      const running = cancelled.installXtts()
      await sleep(10)
      cancelled.cancelXttsInstall()
      assert.equal((await running).xtts.error, 'installazione annullata')
    })

    await t('microfono: il servizio resta acceso per ascoltare, anche se parla Kokoro', async () => {
      const xtts = fakeXtts()
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup(true, undefined, { installed: true, install: async () => {} }), xttsIdleMs: 20 })
      v.syncService({ tts: false, stt: true })
      await sleep(5)
      assert.equal(xtts.started, 1)
      assert.deepEqual([...xtts.loaded], ['stt'], 'solo Whisper: XTTS non si carica per niente')
      assert.equal(v.status().stt.ready, true)
      assert.deepEqual(await v.xttsSpeakers(), [], 'l\'elenco delle voci non carica XTTS')
      assert.deepEqual([...xtts.loaded], ['stt'])
      v.syncService({ tts: false, stt: false })
      await sleep(40)
      assert.equal(xtts.stopped, 1)
      const notInstalled = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup(true) })
      notInstalled.syncService({ stt: true })
      assert.equal(notInstalled.xtts.started, 0, 'microfono non installato: non parte')
    })

    await t('un modello che non serve piu\' si libera, un po\' dopo', async () => {
      const xtts = fakeXtts()
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup(true, undefined, { installed: true, install: async () => {} }), xttsIdleMs: 30 })
      v.syncService({ tts: true, stt: true })
      await sleep(5)
      assert.deepEqual([...xtts.loaded].sort(), ['stt', 'tts'])
      v.syncService({ tts: false, stt: true })   // la voce passa a Kokoro, il microfono resta
      await sleep(10)
      assert.ok(xtts.loaded.has('tts'), 'non subito: chi cambia le impostazioni ci ripensa')
      v.syncService({ tts: true, stt: true })
      await sleep(50)
      assert.ok(xtts.loaded.has('tts'), 'richiesto di nuovo in tempo: resta')
      v.syncService({ tts: false, stt: true })
      await sleep(50)
      assert.deepEqual([...xtts.loaded], ['stt'], 'XTTS liberato, Whisper resta')
      assert.equal(xtts.stopped, 0, 'il servizio resta acceso per il microfono')
    })

    await t('microfono: testo pulito, errori nello stato', async () => {
      const xtts = fakeXtts()
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup(true, undefined, { installed: true, install: async () => {} }) })
      const res = await v.transcribe(new Float32Array(16000))
      assert.deepEqual(res, { text: 'Ciao, come stai?', seconds: 1, took: 0.3 })
      xtts.sttFail = 'microfono: GPU piena'
      await assert.rejects(v.transcribe(new Float32Array(10)), /GPU piena/)
      assert.equal(v.status().stt.error, 'microfono: GPU piena')
      xtts.sttFail = null
      await v.transcribe(new Float32Array(10))
      assert.equal(v.status().stt.error, null, 'un ascolto riuscito toglie l\'errore')
      const none = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup(true) })
      await assert.rejects(none.transcribe(new Float32Array(10)), /prima installa il microfono/)
    })

    await t('microfono: installazione con prova, annullamento, disinstallazione a servizio spento', async () => {
      const stt = { installed: false, install: async (_dir, o) => { o.onProgress({ step: 'model', index: 1, count: 3, done: 1, total: 2 }); await o.check(); stt.installed = true } }
      const xtts = fakeXtts()
      const seen = []
      const v = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts, setup: fakeSetup(true, undefined, stt), onStatus: s => seen.push(s.stt.installing && s.stt.installing.step) })
      const s = await v.installStt()
      assert.ok(seen.includes('model'))
      assert.equal(s.stt.installed, true)
      assert.equal(s.stt.error, null)
      assert.ok(xtts.loaded.has('stt'), 'la prova carica Whisper')
      const removed = await v.removeStt()
      assert.equal(removed.stt.installed, false)
      assert.ok(xtts.stopped >= 1, 'prima di cancellare il modello il servizio si spegne')
      const slow = { installed: false, install: (_dir, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('x')))) }
      const c = new VoiceService({ dir, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup(true, undefined, slow) })
      const running = c.installStt()
      await sleep(5)
      c.cancelSttInstall()
      assert.equal((await running).stt.error, 'installazione annullata')
    })

    await t('campione: uno solo alla volta, nomi e percorsi controllati', async () => {
      const own = installedDir()
      const v = new VoiceService({ dir: own, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup() })
      const first = await v.importSample('C:/qualsiasi/voce.mp3')
      await sleep(5)
      const second = await v.importSample('C:/qualsiasi/altra.mp3')
      assert.match(second.file, /^voce-\d+\.wav$/)
      assert.equal(second.seconds, 12.5)
      assert.equal(v.samplePath(first.file), null, 'il campione vecchio e\' stato tolto')
      assert.ok(v.samplePath(second.file))
      assert.equal(v.samplePath('../../config.json'), null)
      assert.equal(v.samplePath('voce-1.wav'), null)
      const none = new VoiceService({ dir: own, spawn: fakeEngine().spawn, play: () => {}, xtts: fakeXtts(), setup: fakeSetup(false) })
      await assert.rejects(none.importSample('x.mp3'), /prima installa XTTS/)
      fs.rmSync(own, { recursive: true, force: true })
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
