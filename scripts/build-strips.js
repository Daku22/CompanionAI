// build-strips.js — genera le strip di un avatar 2D dalle immagini master.
//
// Ogni fotogramma viene ritagliato sul personaggio, ridotto in modo che il piu'
// alto della strip misuri FRAME_HEIGHT, e affiancato agli altri con un margine
// che evita sbavature fra fotogrammi quando la GPU usa le mipmap. Prima il
// renderer caricava strip quasi vuote da 1671x941 (raddoppiate sopra il 125% di
// scala) per un personaggio alto 200 px: ~300 MB di memoria video.
//
// Due modi di leggere le master, scelti da cosa c'e' nella cartella:
//   - con strips.json: coordinate dei fotogrammi gia' note (formato storico,
//     master "<anim>@2x.png" e coordinate @1x);
//   - senza: un "<anim>.png" per animazione, e i fotogrammi vengono trovati da
//     soli (sprite-frames.js), purche' separati da spazio vuoto. E' il modo
//     previsto per l'arte nuova: vedi docs/avatar-brief.md.
//
// Due uscite:
//   - avatar integrato (predefinito): PNG + sprites.js in src/renderer/assets/strips/,
//     caricato dalla pagina con un <script> perche' fetch non legge file://;
//   - --pack: PNG + sprites.json in una cartella qualsiasi, da importare
//     dall'app con "Importa avatar". Serve per gli avatar che non si possono
//     pubblicare e restano sul proprio PC.
//
// Uso:
//   npm run strips -- --masters <cartella> [--out <cartella>] [--pack] [--name "Nome"]
//
// Usa nativeImage di Electron per ritaglio e ridimensionamento: nessuna
// dipendenza in piu'.

const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const { trimToCharacter, detectFrames } = require('./lib/sprite-frames')

const ROOT = path.join(__dirname, '..')
const BUILTIN_OUT = path.join(ROOT, 'src', 'renderer', 'assets', 'strips')
const FORMAT = 'companion-sprites/1'

// A dimensione standard la finestra mostra il personaggio alto ~200 px CSS:
// 480 px coprono schermi fino a oltre il 200% di scala, e lasciano margine se
// la finestra viene ingrandita.
const FRAME_HEIGHT = 480
const PAD = 4

// Animazioni previste e velocita' (fotogrammi per tick a 60 fps). Idle e'
// obbligatoria: il renderer ripiega su di lei per quelle che mancano.
const ANIMATIONS = {
  idle: 0.09, walk: 0.14, run: 0.22, wave: 0.1, think: 0.07,
  sit: 0.05, smoke: 0.06, click: 0.1, happy: 0.1,
}

// Pulizia dei fotogrammi, solo dove serve. La master di CLICK di Yanineko
// contiene etichette ("1 CLICK (IDLE)") attaccate alle scarpe dei primi quattro
// fotogrammi e pezzi del fotogramma vicino nei riquadri: si vedevano nell'app.
// Le altre strip restano ritagliate come da manifest: regole generiche
// toglievano anche parti vere, come le nuvolette di THINK.
const CLEANUP = {
  click: { labelledFrames: [0, 1, 2, 3] },
}

function parseArgs(argv) {
  const args = { masters: null, out: null, pack: false, name: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--masters') args.masters = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--name') args.name = argv[++i]
    else if (a === '--pack') args.pack = true
  }
  if (!args.masters) throw new Error('indica la cartella delle master con --masters <cartella>')
  args.masters = path.resolve(args.masters)
  args.out = path.resolve(args.out || (args.pack ? path.join(args.masters, 'sprite-pack') : BUILTIN_OUT))
  return args
}

// Dal buffer, non dal percorso: con createFromPath Electron legge il suffisso
// "@2x" come fattore di scala e riporta dimensioni dimezzate rispetto ai pixel.
function loadMaster(file) {
  const image = nativeImage.createFromBuffer(fs.readFileSync(file))
  if (image.isEmpty()) throw new Error('master illeggibile: ' + file)
  return image
}

function trimRect(master, rect, opts) {
  const bitmap = master.crop(rect).toBitmap()
  const r = trimToCharacter(bitmap, rect.width, rect.height, opts)
  return r ? { x: rect.x + r.x, y: rect.y + r.y, width: r.width, height: r.height } : rect
}

// Dove una scarpa e' piu' bassa dell'altra, il taglio orizzontale lascia un
// lembo di etichetta accanto alla scarpa alta. Nella fascia bassa si cancellano
// i pixel del suo blu saturo, del testo bianco e del bordo sfumato. Pantaloni
// (blu grigio, opachi) e scarpe (toni caldi) non rientrano in nessuno dei tre.
function eraseLabelRemnant(image) {
  const { width, height } = image.getSize()
  const bitmap = Buffer.from(image.toBitmap())
  for (let y = Math.floor(height * 0.88); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2]
      const labelBlue = r < 30 && b > 70 && b - g > 30
      const coolWhite = r > 140 && b >= r
      const faintEdge = bitmap[i + 3] < 200 && b > r + 20
      if (labelBlue || coolWhite || faintEdge) bitmap.fill(0, i, i + 4)
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height })
}

/** Riquadri dei fotogrammi di un'animazione, in pixel della master. */
function frameRects(anim, dir, legacy) {
  if (legacy) {
    const meta = legacy[anim]
    const master = loadMaster(path.join(dir, meta.file2x))
    const k = master.getSize().width / meta.sheetW   // master @2x rispetto alle coordinate @1x
    const cleanup = CLEANUP[anim]
    const rects = meta.frames.map((f, i) => {
      const rect = { x: Math.round(f.x * k), y: Math.round(f.y * k), width: Math.round(f.w * k), height: Math.round(f.h * k) }
      return cleanup ? trimRect(master, rect, { cutLabel: cleanup.labelledFrames.includes(i) }) : rect
    })
    return { master, rects, fps: meta.fps, labelled: cleanup ? cleanup.labelledFrames : [] }
  }
  const master = loadMaster(path.join(dir, anim + '.png'))
  const { width, height } = master.getSize()
  const rects = detectFrames(master.toBitmap(), width, height)
  if (!rects.length) throw new Error(anim + '.png: nessun fotogramma trovato (serve un PNG con trasparenza)')
  return { master, rects, fps: ANIMATIONS[anim], labelled: [] }
}

function buildStrip(anim, dir, legacy, outDir) {
  const { master, rects, fps, labelled } = frameRects(anim, dir, legacy)
  const scale = FRAME_HEIGHT / Math.max(...rects.map(r => r.height))

  const frames = rects.map((r, i) => {
    let crop = master.crop(r)
    if (labelled.includes(i)) crop = eraseLabelRemnant(crop)
    const width = Math.max(1, Math.round(r.width * scale))
    const height = Math.max(1, Math.round(r.height * scale))
    const image = crop.resize({ width, height, quality: 'best' })
    const size = image.getSize()
    const bitmap = image.toBitmap()
    if (bitmap.length !== size.width * size.height * 4) throw new Error(anim + ': bitmap con stride inatteso')
    return { bitmap, width: size.width, height: size.height }
  })

  const sheetW = PAD + frames.reduce((sum, f) => sum + f.width + PAD, 0)
  const sheetH = PAD * 2 + Math.max(...frames.map(f => f.height))
  const sheet = Buffer.alloc(sheetW * sheetH * 4, 0)
  const placed = []
  let x = PAD
  for (const f of frames) {
    // Piedi allineati in basso: l'anchor del renderer e' il centro della base.
    const y = PAD + (sheetH - PAD * 2 - f.height)
    for (let row = 0; row < f.height; row++) {
      f.bitmap.copy(sheet, ((y + row) * sheetW + x) * 4, row * f.width * 4, (row + 1) * f.width * 4)
    }
    placed.push([x, y, f.width, f.height])
    x += f.width + PAD
  }

  const file = anim + '.png'
  const png = nativeImage.createFromBitmap(sheet, { width: sheetW, height: sheetH }).toPNG()
  fs.writeFileSync(path.join(outDir, file), png)
  return { entry: { file, fps, count: placed.length, sw: sheetW, sh: sheetH, frames: placed }, bytes: png.length }
}

app.whenReady().then(() => {
  let code = 0
  try {
    const args = parseArgs(process.argv.slice(2))
    const legacyFile = path.join(args.masters, 'strips.json')
    const legacy = fs.existsSync(legacyFile) ? JSON.parse(fs.readFileSync(legacyFile, 'utf8')).strips : null
    const available = Object.keys(ANIMATIONS).filter(anim =>
      legacy ? legacy[anim] : fs.existsSync(path.join(args.masters, anim + '.png')))
    if (!available.includes('idle')) throw new Error('manca la master di idle in ' + args.masters)

    fs.mkdirSync(args.out, { recursive: true })
    const manifest = { format: FORMAT, name: args.name || path.basename(args.masters), animations: {} }
    let total = 0
    for (const anim of available) {
      const { entry, bytes } = buildStrip(anim, args.masters, legacy, args.out)
      manifest.animations[anim] = entry
      total += bytes
      console.log('  ' + anim.padEnd(8) + String(entry.count).padStart(3) + ' fotogrammi  '
        + (entry.sw + 'x' + entry.sh).padEnd(12) + (bytes / 1024).toFixed(0).padStart(6) + ' KB')
    }
    const missing = Object.keys(ANIMATIONS).filter(a => !available.includes(a))
    if (missing.length) console.log('  (assenti, ripiegano su idle: ' + missing.join(', ') + ')')

    if (args.pack) {
      fs.writeFileSync(path.join(args.out, 'sprites.json'), JSON.stringify(manifest, null, 1) + '\n')
    } else {
      const js = '// Generato da scripts/build-strips.js: non modificare a mano.\n'
        + '// Avatar 2D integrato: coordinate [x, y, w, h] dei fotogrammi nelle strip di questa cartella.\n'
        + 'window.COMPANION_SPRITES = ' + JSON.stringify(manifest, null, 1) + '\n'
      fs.writeFileSync(path.join(args.out, 'sprites.js'), js)
    }
    console.log('[strips] ' + available.length + ' animazioni, ' + (total / 1024 / 1024).toFixed(1) + ' MB in ' + args.out)
  } catch (error) {
    console.error('[strips] ' + error.message)
    code = 1
  }
  app.exit(code)
})
