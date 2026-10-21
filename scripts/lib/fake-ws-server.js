// fake-ws-server.js — un server WebSocket minimo per le prove (Blocco 11c):
// la stretta di mano e i messaggi di testo, niente estensioni. Lo usano
// test-twitch-chat.js e audit.mjs per fingere l'IRC di Twitch, senza
// dipendenze in piu'.

const http = require('http')
const crypto = require('crypto')

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function frame(opcode, payload) {
  const len = payload.length
  const head = len < 126 ? Buffer.from([0x80 | opcode, len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b })()
  return Buffer.concat([head, payload])
}

/**
 * @param {(client: { send: (text: string) => void, close: () => void, onText: ((text: string) => void) | null, onClose: (() => void) | null }) => void} onConnection
 * @returns {import('http').Server}
 */
function createFakeWsServer(onConnection) {
  const server = http.createServer((_req, res) => { res.writeHead(426); res.end() })
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + MAGIC).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    let closed = false
    const client = {
      onText: null,
      onClose: null,
      send(text) { if (!closed) socket.write(frame(1, Buffer.from(text, 'utf8'))) },
      close() { if (closed) return; closed = true; try { socket.write(frame(8, Buffer.alloc(0))) } catch (_) {} socket.end() },
    }
    let buf = Buffer.alloc(0)
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        const masked = (buf[1] & 0x80) !== 0
        const maskAt = off
        if (masked) off += 4
        if (buf.length < off + len) return
        let payload = buf.subarray(off, off + len)
        if (masked) { const mask = buf.subarray(maskAt, maskAt + 4); payload = Buffer.from(payload.map((x, i) => x ^ mask[i % 4])) }
        const opcode = buf[0] & 0x0f
        buf = buf.subarray(off + len)
        if (opcode === 1 && client.onText) client.onText(payload.toString('utf8'))
        else if (opcode === 8) { client.close() }
        else if (opcode === 9) socket.write(frame(10, payload))
      }
    })
    socket.on('close', () => { closed = true; if (client.onClose) client.onClose() })
    socket.on('error', () => {})
    onConnection(client)
  })
  return server
}

module.exports = { createFakeWsServer }
