#!/usr/bin/env node
// make-icon.js — genera l'icona dell'app e quella della tray.
//
// Prima il progetto non aveva icona: electron-builder usava quella di default
// di Electron e la tray ripiegava su nativeImage.createEmpty(), cioe' su un
// quadratino invisibile nella barra di sistema.
//
// Se esiste build/icon-src/ usa le icone li' dentro (logo gatto con anello):
//   icon-256.png               eseguibile, ridimensionata da full-master.png
//   icon-32.png                finestre
//   tray-16.png, tray-32.png   tray (normale e schermi al 200%)
// Le versioni a 16 e 32 px sono ritoccate a mano, non ridimensionate: se
// cambi il logo vanno rifatte.
//
// Senza quella cartella l'icona e' disegnata via codice (zlib e' gia' in Node,
// nessuna dipendenza): una sagoma con orecchie da gatto.
//
// Uso: npm run icon

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.join(__dirname, '..')

// ─── Encoder PNG minimo (RGBA, 8 bit) ────────────────────────────────────────

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filtro "none"
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Disegno ─────────────────────────────────────────────────────────────────

const clamp01 = (v) => Math.max(0, Math.min(1, v))
// Antialiasing: copertura stimata dalla distanza con signed distance field.
const coverage = (dist, edge) => clamp01(0.5 - dist / edge)

function roundedBoxDist(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius)
  const dy = Math.abs(py - cy) - (halfH - radius)
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius
}

function triangleDist(px, py, ax, ay, bx, by, cx, cy) {
  // Negativo dentro il triangolo: basta il minimo delle tre semipiani.
  const side = (x1, y1, x2, y2) => (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)
  const s1 = side(ax, ay, bx, by), s2 = side(bx, by, cx, cy), s3 = side(cx, cy, ax, ay)
  const inside = (s1 <= 0 && s2 <= 0 && s3 <= 0) || (s1 >= 0 && s2 >= 0 && s3 >= 0)
  const seg = (x1, y1, x2, y2) => {
    const vx = x2 - x1, vy = y2 - y1
    const t = clamp01(((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy))
    return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy))
  }
  const d = Math.min(seg(ax, ay, bx, by), seg(bx, by, cx, cy), seg(cx, cy, ax, ay))
  return inside ? -d : d
}

function blend(dst, i, r, g, b, a) {
  const sa = a, da = dst[i + 3] / 255
  const out = sa + da * (1 - sa)
  if (out <= 0) return
  dst[i]     = Math.round((r * sa + dst[i]     * da * (1 - sa)) / out)
  dst[i + 1] = Math.round((g * sa + dst[i + 1] * da * (1 - sa)) / out)
  dst[i + 2] = Math.round((b * sa + dst[i + 2] * da * (1 - sa)) / out)
  dst[i + 3] = Math.round(out * 255)
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4, 0)
  const s = size / 256              // tutto e' pensato su una griglia 256
  const edge = Math.max(1, 1.4 * s) // ampiezza dell'antialias
  const cx = 128 * s, cy = 140 * s

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const fx = x + 0.5, fy = y + 0.5

      // Orecchie
      const earL = triangleDist(fx, fy, 52 * s, 96 * s, 84 * s, 30 * s, 110 * s, 78 * s)
      const earR = triangleDist(fx, fy, 204 * s, 96 * s, 172 * s, 30 * s, 146 * s, 78 * s)
      const ear = Math.min(earL, earR)

      // Testa
      const head = roundedBoxDist(fx, fy, cx, cy, 92 * s, 84 * s, 46 * s)

      const body = Math.min(ear, head)
      const cov = coverage(body, edge)
      if (cov > 0) {
        // Gradiente verticale dal violetto all'indaco.
        const t = clamp01((fy - 30 * s) / (200 * s))
        const r = Math.round(150 + (86 - 150) * t)
        const g = Math.round(110 + (92 - 110) * t)
        const b = Math.round(240 + (200 - 240) * t)
        blend(px, i, r, g, b, cov)
      }

      // Occhi
      const eye = (ex) => Math.hypot(fx - ex * s, fy - 132 * s) - 13 * s
      const eyeCov = Math.max(coverage(eye(96), edge), coverage(eye(160), edge))
      if (eyeCov > 0) blend(px, i, 255, 255, 255, eyeCov)

      // Bocca: piccolo sorriso
      const mouth = Math.abs(Math.hypot(fx - cx, fy - 150 * s) - 30 * s) - 4 * s
      const inLower = fy > 168 * s && Math.abs(fx - cx) < 34 * s
      if (inLower) {
        const mCov = coverage(mouth, edge)
        if (mCov > 0) blend(px, i, 255, 255, 255, mCov * 0.9)
      }
    }
  }
  return encodePNG(size, size, px)
}

const SRC = path.join(ROOT, 'build', 'icon-src')

function write(target, size, srcName) {
  const file = path.join(ROOT, target)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const src = path.join(SRC, srcName)
  const buf = fs.existsSync(src) ? fs.readFileSync(src) : drawIcon(size)
  fs.writeFileSync(file, buf)
  console.log('  ' + target.padEnd(40) + size + 'x' + size + '  ' + (buf.length / 1024).toFixed(1) + ' KB')
}

// 256 per electron-builder (la dimensione minima che accetta su Windows),
// 32 per le finestre; la tray ha 16 e 32 (schermi ad alta densita').
// Il nome "tray-2x" evita "@2x", che nativeImage interpreta come fattore di
// scala (vedi docs/PORTING-NOTES.md).
write('build/icon.png', 256, 'icon-256.png')
write('src/renderer/assets/icon.png', 32, 'icon-32.png')
write('src/renderer/assets/tray.png', 16, 'tray-16.png')
write('src/renderer/assets/tray-2x.png', 32, 'tray-32.png')
console.log(fs.existsSync(SRC) ? '[icon] copiate da build/icon-src' : '[icon] generate')
