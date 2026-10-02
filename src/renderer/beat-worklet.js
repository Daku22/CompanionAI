// beat-worklet.js — gira nel thread audio: il livello dei bassi a blocchi
// fissi, circa 43 al secondo, per beat.js. Prima del worklet c'e' un filtro
// passa-basso (companion-dance.js); qui si fa solo la media del valore
// assoluto di ogni blocco, su tutti i canali. Nessun campione esce di qui:
// alla pagina arriva un numero per blocco.

class BeatBand extends AudioWorkletProcessor {
  constructor() {
    super()
    // sampleRate e' globale nel thread audio: 48000 / 1116 = 43 blocchi al secondo.
    this.block = Math.round(sampleRate / 43)
    this.sum = 0
    this.count = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (input && input.length) {
      const frames = input[0].length
      for (let i = 0; i < frames; i++) {
        let v = 0
        for (let c = 0; c < input.length; c++) v += Math.abs(input[c][i])
        this.sum += v / input.length
        if (++this.count === this.block) {
          this.port.postMessage(this.sum / this.block)
          this.sum = 0
          this.count = 0
        }
      }
    }
    return true
  }
}

registerProcessor('beat-band', BeatBand)
