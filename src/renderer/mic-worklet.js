// mic-worklet.js — gira nel thread audio: passa alla pagina i campioni del
// microfono a blocchi di 2048 (128 alla volta sarebbero troppi messaggi).
// Lo carica mic-recorder.js con audioWorklet.addModule.

const BLOCK = 2048

class MicTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(BLOCK)
    this.fill = 0
    this.port.onmessage = (e) => {
      // La pagina chiude: quello che resta nel blocco a meta'.
      if (e.data === 'flush') { this.port.postMessage(this.buf.slice(0, this.fill)); this.fill = 0 }
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      let i = 0
      while (i < ch.length) {
        const n = Math.min(ch.length - i, BLOCK - this.fill)
        this.buf.set(ch.subarray(i, i + n), this.fill)
        this.fill += n
        i += n
        if (this.fill === BLOCK) { this.port.postMessage(this.buf.slice(0)); this.fill = 0 }
      }
    }
    return true
  }
}

registerProcessor('mic-tap', MicTap)
