// kokoro-worker.js — la voce Kokoro, in un processo a parte.
//
// Il main lo avvia con utilityProcess (voice.js): il modello occupa qualche
// centinaio di MB e la sintesi tiene occupata la CPU, e se qualcosa va storto
// cade questo processo, non l'app. Qui gira anche espeak-ng, scaricato al
// primo uso: mai nel main.
//
// ONNX Runtime nativo sulla CPU con il modello fp16: misurato su un Ryzen 5
// 5600G, 2,7 volte il tempo reale. In WebAssembly lo stesso modello andava a
// 0,5-0,8, e WebGPU (2,6) impiegava 5 s per la prima frase.
//
// Messaggi (ogni risposta riporta l'id della richiesta):
//           { type: 'load', id } -> { type: 'ready', id, ms }
//           { type: 'synth', id, text, voice, speed } -> { type: 'audio', id, pcm, rate }
//           errori -> { type: 'error', id, message }
// Gira anche con child_process.fork, per le prove senza Electron.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { phonemize, tokenize, styleFor } = require('./kokoro-text')

const DIR = process.argv[2]
const RATE = 24000
const VOICES = new Set(['if_sara', 'im_nicola'])

const port = process.parentPort
const send = (msg) => (port ? port.postMessage(msg) : process.send(msg))
const onMessage = (fn) => (port ? port.on('message', (e) => fn(e.data)) : process.on('message', fn))

let loading = null
let ort, session, espeak, vocab
const voices = new Map()

function ipa(text) {
  const r = espeak.synthesize_ipa(text)
  return r && r.ipa !== undefined ? r.ipa : String(r || '')
}

async function run(text, voiceName, speed) {
  const ids = tokenize(phonemize(text, ipa), vocab)
  if (ids.length <= 2) return new Float32Array(0)
  let voice = voices.get(voiceName)
  if (!voice) {
    const buf = fs.readFileSync(path.join(DIR, 'kokoro', 'voices', voiceName + '.bin'))
    voice = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
    voices.set(voiceName, voice)
  }
  const out = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    style: new ort.Tensor('float32', styleFor(voice, ids.length), [1, 256]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  })
  return out.waveform.data
}

function load() {
  if (!loading) {
    loading = (async () => {
      const start = Date.now()
      ort = require('onnxruntime-node')
      vocab = JSON.parse(fs.readFileSync(path.join(DIR, 'kokoro', 'tokenizer.json'), 'utf8')).model.vocab
      const { default: init } = await import(pathToFileURL(path.join(DIR, 'espeak', 'espeak-ng.mjs')).href)
      const m = await init()
      espeak = new m.eSpeakNGWorker()
      espeak.set_voice('it')
      session = await ort.InferenceSession.create(path.join(DIR, 'kokoro', 'model_fp16.onnx'), { executionProviders: ['cpu'] })
      // La prima inferenza prepara la memoria: meglio qui che sulla prima frase.
      await run('Ciao.', 'if_sara', 1)
      return Date.now() - start
    })()
  }
  return loading
}

onMessage(async (msg) => {
  if (!msg || typeof msg !== 'object') return
  try {
    if (msg.type === 'load') {
      send({ type: 'ready', id: msg.id, ms: await load() })
    } else if (msg.type === 'synth') {
      await load()
      const voice = VOICES.has(msg.voice) ? msg.voice : 'if_sara'
      const speed = Number.isFinite(msg.speed) ? Math.max(0.7, Math.min(1.4, msg.speed)) : 1
      const pcm = await run(String(msg.text || ''), voice, speed)
      send({ type: 'audio', id: msg.id, pcm, rate: RATE })
    }
  } catch (error) {
    // Un caricamento fallito si riprova alla prossima richiesta.
    if (msg.type === 'load' || !session) loading = null
    send({ type: 'error', id: msg.id, message: error && error.message ? error.message : String(error) })
  }
})
