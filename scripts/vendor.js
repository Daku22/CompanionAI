#!/usr/bin/env node
// vendor.js — copia in src/renderer/vendor/ le librerie che il renderer carica.
//
// Perche' esiste: companion.html importava pixi, three e three-vrm con percorsi
// relativi dentro node_modules. Nell'app impacchettata quei percorsi non sono
// garantiti — electron-builder esclude di default le cartelle "examples" dentro
// node_modules, quindi GLTFLoader spariva dall'asar e la
// modalita' 3D si rompeva solo nella build, mai in sviluppo.
//
// Copiando i file sotto src/ entrano nel pacchetto con tutto il resto e il
// renderer non dipende piu' da come e' fatta node_modules.
//
// Girato automaticamente da prestart/predev/prebuild. A mano: npm run vendor

const fs = require('fs')
const path = require('path')

const ROOT   = path.join(__dirname, '..')
const OUT    = path.join(ROOT, 'src', 'renderer', 'vendor')
const MODULES = path.join(ROOT, 'node_modules')

// sorgente in node_modules -> destinazione dentro src/renderer/vendor
const FILES = {
  'pixi.js/dist/pixi.min.js':                        'pixi.min.js',
  // Sostituisce il codice che Pixi 7 genera con new Function: senza, la CSP
  // dovrebbe permettere 'unsafe-eval' a tutta la pagina.
  '@pixi/unsafe-eval/dist/unsafe-eval.min.js':       'pixi-unsafe-eval.min.js',
  'three/build/three.module.js':                     'three.module.js',
  // three.module.js importa ./three.core.js: senza, il modulo non si carica.
  'three/build/three.core.js':                       'three.core.js',
  '@pixiv/three-vrm/lib/three-vrm.module.js':        'three-vrm.module.js',
  'three/examples/jsm/loaders/GLTFLoader.js':        'three-addons/loaders/GLTFLoader.js',
  // Importato da GLTFLoader: senza, il caricamento dei .vrm fallisce.
  'three/examples/jsm/utils/BufferGeometryUtils.js': 'three-addons/utils/BufferGeometryUtils.js',
  // Animazioni .vrma, l'unico formato di clip che il player conosce.
  '@pixiv/three-vrm-animation/lib/three-vrm-animation.module.js': 'three-vrm-animation.module.js',
  // Modelli FBX e clip da convertire (FBX, BVH di Kimodo). FBXLoader importa
  // fflate e le curve NURBS.
  'three/examples/jsm/loaders/FBXLoader.js':         'three-addons/loaders/FBXLoader.js',
  'three/examples/jsm/libs/fflate.module.js':        'three-addons/libs/fflate.module.js',
  'three/examples/jsm/curves/NURBSCurve.js':         'three-addons/curves/NURBSCurve.js',
  'three/examples/jsm/curves/NURBSUtils.js':         'three-addons/curves/NURBSUtils.js',
  'three/examples/jsm/loaders/BVHLoader.js':         'three-addons/loaders/BVHLoader.js',
}

function copyOne(from, to) {
  const src = path.join(MODULES, from)
  const dst = path.join(OUT, to)
  if (!fs.existsSync(src)) throw new Error('manca in node_modules: ' + from + ' (esegui npm install)')
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return { dst, bytes: fs.statSync(dst).size }
}

// Controlla che nessun file copiato importi un file relativo che non abbiamo
// portato dietro: e' proprio cosi' che BufferGeometryUtils era passato inosservato.
function checkClosure() {
  const missing = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.js')) continue
      const code = fs.readFileSync(full, 'utf8')
      for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(full), m[1])
        if (!fs.existsSync(target)) missing.push(path.relative(OUT, full) + ' -> ' + m[1])
      }
    }
  }
  if (fs.existsSync(OUT)) walk(OUT)
  return missing
}

function main() {
  fs.mkdirSync(OUT, { recursive: true })
  let total = 0
  for (const [from, to] of Object.entries(FILES)) {
    const { bytes } = copyOne(from, to)
    total += bytes
    console.log('  ' + to.padEnd(46) + (bytes / 1024).toFixed(0).padStart(5) + ' KB')
  }
  const missing = checkClosure()
  if (missing.length) {
    console.error('\n[vendor] import relativi non risolti:')
    for (const m of missing) console.error('  ' + m)
    console.error('Aggiungi i file mancanti a FILES in scripts/vendor.js')
    process.exit(1)
  }
  console.log('[vendor] ' + Object.keys(FILES).length + ' file, ' + (total / 1024).toFixed(0) + ' KB totali in src/renderer/vendor/')
}

main()
