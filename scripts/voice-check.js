#!/usr/bin/env node
// voice-check.js — prova la voce Kokoro senza aprire l'app.
//
// Avvia kokoro-worker.js come processo Node, sintetizza qualche frase italiana
// e dice quanto ci mette. Serve la cartella con i file scaricati dall'app
// (%APPDATA%\CompanionAI\voice) o una con la stessa struttura.
//
// Uso: node scripts/voice-check.js [cartella] [--wav uscita.wav]

const { fork } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { packStatus, KOKORO_FILES } = require('../src/main/voice-assets')
const { cleanForSpeech, splitSentences } = require('../src/main/speech-text')

const args = process.argv.slice(2)
const wavAt = args.indexOf('--wav')
const wavOut = wavAt >= 0 ? args[wavAt + 1] : null
const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && i !== wavAt + 1) || path.join(process.env.APPDATA || os.homedir(), 'CompanionAI', 'voice'))

const TEXT = 'Ciao! Sono contenta di vederti 😊. Com\'è andata la giornata? Ieri sera ho guardato le stelle dalla finestra: erano bellissime, sai? Gli gnocchi, la zucchina e lo sciopero... che strano pomeriggio!'

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

async function main() {
  const status = packStatus(dir, KOKORO_FILES)
  if (!status.installed) {
    console.error('Mancano file in ' + dir + ': ' + status.missing.join(', ') + '\nScaricali dalle Impostazioni dell\'app (Voce).')
    process.exit(1)
  }
  const worker = fork(path.join(__dirname, '..', 'src', 'main', 'kokoro-worker.js'), [dir], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' })
  const pending = new Map()
  worker.on('message', (msg) => { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg) } })
  const ask = (msg) => new Promise(resolve => { pending.set(msg.id, resolve); worker.send(msg) })

  const ready = await ask({ type: 'load', id: 'load' })
  if (ready.type === 'error') throw new Error(ready.message)
  console.log('caricata in ' + ready.ms + ' ms')
  const parts = []
  let audio = 0
  const start = Date.now()
  let first = null
  for (const [i, sentence] of splitSentences(cleanForSpeech(TEXT)).entries()) {
    const t = Date.now()
    const res = await ask({ type: 'synth', id: i, text: sentence, voice: 'if_sara', speed: 1 })
    if (res.type === 'error') throw new Error(res.message)
    const pcm = Float32Array.from(res.pcm)
    if (first === null) first = Date.now() - t
    audio += pcm.length / res.rate
    parts.push(pcm)
    console.log('  ' + (pcm.length / res.rate).toFixed(1) + ' s in ' + (Date.now() - t) + ' ms: ' + sentence)
  }
  const took = (Date.now() - start) / 1000
  console.log(audio.toFixed(1) + ' s di voce in ' + took.toFixed(1) + ' s (x' + (audio / took).toFixed(1) + '), prima frase in ' + first + ' ms')
  if (wavOut) {
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) { all.set(p, o); o += p.length }
    fs.writeFileSync(wavOut, wav(all, 24000))
    console.log('scritto ' + wavOut)
  }
  worker.kill()
}
main().catch(e => { console.error('Prova fallita:', e.message); process.exit(1) })
