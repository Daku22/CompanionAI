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
  // Sostituisce il codice che Pixi genera con new Function (shader, uniform):
  // senza, la CSP dovrebbe permettere 'unsafe-eval' a tutta la pagina. Si
  // installa da solo, caricato dopo pixi.min.js.
  'pixi.js/dist/packages/unsafe-eval.min.js':        'pixi-unsafe-eval.min.js',
  // Avatar Live2D (Cubism 3, 4 e 5) su Pixi 8: libreria MIT con dentro il
  // Cubism Framework (Live2D Open Software License). Il Cubism Core no: lo
  // scarica l'utente (live2d-core.js). companion-live2d.js la carica dopo il
  // Core, che deve esserci gia'.
  'untitled-pixi-live2d-engine/dist/cubism.min.js':  'pixi-live2d.min.js',
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
  // Texture TGA degli FBX (fbx-textures.js): i browser non le leggono.
  'three/examples/jsm/loaders/TGALoader.js':         'three-addons/loaders/TGALoader.js',
  // Destro o centrale + trascina ruotano la camera 3D, la rotella zooma.
  'three/examples/jsm/controls/OrbitControls.js':    'three-addons/controls/OrbitControls.js',
  // Stanza (room-scene.js): cielo con il sole dell'ora, foto HDRI proiettate
  // su un pavimento, e il loro caricatore.
  'three/examples/jsm/objects/Sky.js':               'three-addons/objects/Sky.js',
  'three/examples/jsm/objects/GroundedSkybox.js':    'three-addons/objects/GroundedSkybox.js',
  'three/examples/jsm/loaders/RGBELoader.js':        'three-addons/loaders/RGBELoader.js',
  // Scene importate (room-scene.js): OBJ con i suoi .mtl, e una stanza
  // generata come luce riflessa per i materiali metallici.
  'three/examples/jsm/loaders/OBJLoader.js':         'three-addons/loaders/OBJLoader.js',
  'three/examples/jsm/loaders/MTLLoader.js':         'three-addons/loaders/MTLLoader.js',
  'three/examples/jsm/environments/RoomEnvironment.js': 'three-addons/environments/RoomEnvironment.js',
}

// Correzioni ai file copiati: [testo originale, testo nuovo]. Se three cambia
// e il testo non c'e' piu', vendor si ferma: la correzione va rivista.
const PATCHES = {
  // FBX con un osso e una mesh con lo stesso nome (Pomni: l'osso "EyeL" e
  // l'occhio "EyeL" con le forme "Big", "Closed"...). getObjectByName trova
  // l'osso, che non ha forme, e il caricamento si ferma con "reading 'Big'".
  // Si cerca la mesh che ha la forma; se il nome e' condiviso la traccia
  // punta al suo uuid, e senza mesh la traccia si salta.
  'three/examples/jsm/loaders/FBXLoader.js': [
    [
      "const morphNum = sceneGraph.getObjectByName( rawTracks.modelName ).morphTargetDictionary[ rawTracks.morphName ];",
      "let mesh = null;\n" +
      "\t\tsceneGraph.traverse( function ( o ) {\n\n" +
      "\t\t\tif ( ! mesh && o.name === rawTracks.modelName && o.morphTargetDictionary && o.morphTargetDictionary[ rawTracks.morphName ] !== undefined ) mesh = o;\n\n" +
      "\t\t} );\n" +
      "\t\tif ( ! mesh ) return undefined;\n" +
      "\t\tconst node = sceneGraph.getObjectByName( rawTracks.modelName ) === mesh ? rawTracks.modelName : mesh.uuid;\n" +
      "\t\tconst morphNum = mesh.morphTargetDictionary[ rawTracks.morphName ];",
    ],
    [
      "return new NumberKeyframeTrack( rawTracks.modelName + '.morphTargetInfluences[' + morphNum + ']', curves.times, values );",
      "return new NumberKeyframeTrack( node + '.morphTargetInfluences[' + morphNum + ']', curves.times, values );",
    ],
  ],
}

function copyOne(from, to) {
  const src = path.join(MODULES, from)
  const dst = path.join(OUT, to)
  if (!fs.existsSync(src)) throw new Error('manca in node_modules: ' + from + ' (esegui npm install)')
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  if (PATCHES[from]) {
    let code = fs.readFileSync(src, 'utf8')
    for (const [before, after] of PATCHES[from]) {
      if (!code.includes(before)) throw new Error('correzione non applicabile a ' + from + ': ' + before.slice(0, 60) + '...')
      code = code.replace(before, () => after)
    }
    fs.writeFileSync(dst, code)
  } else fs.copyFileSync(src, dst)
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
