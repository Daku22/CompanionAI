// test-animation.js — verifica il player di pose VRM senza aprire una finestra.
//
// Il modulo non dipende da three: le ossa arrivano da un accessor, quindi qui
// bastano oggetti finti. Cio' che conta e' il comportamento del player: che le
// clip entrino ed escano in dissolvenza, che quelle a durata finita tornino a
// idle, e che nessuna posa lasci residui sull'osso di un'altra.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  createVRMAnimator, CLIPS, CLIP_ALIAS, TOUCHED_BONES, REST_POSE, mergePose,
  createBlinker, createGaze, nextSaccade, moodExpressions, MOOD_MAX, MOOD_EXPRESSIONS,
  distributeLook, LOOK_LIMITS, LOOK_WEIGHT,
} from '../src/renderer/vrm-animation.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

// Scheletro finto: un nodo per osso, con rotazione e posizione.
function fakeVrm() {
  const bones = {}
  for (const name of TOUCHED_BONES) {
    bones[name] = { rotation: { x: 0, y: 0, z: 0 }, position: { y: 1 }, userData: {} }
  }
  return { bones, scene: { rotation: { x: 0, y: 0, z: 0 } } }
}
const accessor = (vrm, name) => vrm.bones[name] || null
const makeAnimator = () => createVRMAnimator(accessor)

// Avanza il tempo a passi da 1/60 di secondo, come farebbe il loop di render.
function advance(anim, vrm, seconds, step = 1 / 60) {
  let last = null
  for (let t = 0; t < seconds; t += step) last = anim.update(vrm, step)
  return last
}

console.log('=== Player animazioni VRM ===\n')

test('ogni alias punta a una clip che esiste', () => {
  for (const [alias, target] of Object.entries(CLIP_ALIAS)) {
    assert.ok(CLIPS[target], 'alias "' + alias + '" punta a "' + target + '", che non esiste')
  }
})

test('la libreria delle clip .vrma conosce gli stessi gesti del player', () => {
  const { ANIMATION_SLOTS } = createRequire(process.argv[1])('../src/main/AnimationLibrary.js')
  assert.deepEqual([...ANIMATION_SLOTS].sort(), Object.keys(CLIPS).sort())
})

test('le animazioni del contratto AI sono tutte gestite', () => {
  // Stesso vocabolario dichiarato in ai-router.js: se le due liste divergono,
  // l'AI puo' chiedere un movimento che l'avatar non sa fare.
  const daRouter = ['idle', 'walk-to', 'run-to', 'think', 'wave', 'sit', 'smoke',
                    'click', 'happy', 'scroll', 'open-file', 'search']
  for (const nome of daRouter) {
    assert.ok(CLIP_ALIAS[nome], 'animazione "' + nome + '" senza alias nel player')
  }
})

test('un nome sconosciuto ricade su idle invece di rompere', () => {
  const anim = makeAnimator()
  assert.equal(anim.play('teletrasporto'), 'idle')
})

test('una clip entra in dissolvenza invece che di scatto', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('wave')
  const subito = anim.update(vrm, 1 / 60)
  assert.ok(subito.weight > 0 && subito.weight < 0.3,
    'primo frame a peso ' + subito.weight.toFixed(3) + ': dovrebbe partire quasi da zero')
  const dopo = advance(anim, vrm, 0.5)
  assert.ok(dopo.weight > 0.99, 'dopo mezzo secondo il peso dovrebbe essere pieno')
})

test('cambiare clip riparte da peso zero', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('wave')
  advance(anim, vrm, 1.0)
  assert.ok(anim.debug().clipWeight > 0.99)
  anim.play('think')
  assert.equal(anim.debug().clipWeight, 0, 'la clip nuova erediterebbe il peso della precedente')
})

test('una clip a durata finita torna da sola a idle', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('wave')                       // dura 2.6 s
  const meta = advance(anim, vrm, 1.0)
  assert.equal(meta.clip, 'wave')
  const fine = advance(anim, vrm, 3.0)    // oltre durata piu' dissolvenza
  assert.equal(fine.clip, 'idle', 'dopo la durata la clip deve rilasciare il controllo')
})

test('le clip cicliche non scadono da sole', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('walk-to')
  const dopo = advance(anim, vrm, 30)
  assert.equal(dopo.clip, 'walk-to', 'la camminata deve durare finche' + "'" + ' non arriva un altro trigger')
})

test('nessuna posa lascia residui sulle ossa della precedente', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('sit')                        // muove molto le gambe
  advance(anim, vrm, 1.0)
  const gambaPiegata = vrm.bones.leftUpperLeg.rotation.x
  assert.ok(Math.abs(gambaPiegata) > 0.5, 'sit dovrebbe piegare le gambe')

  anim.play('wave')                       // non tocca le gambe
  advance(anim, vrm, 1.0)
  assert.ok(Math.abs(vrm.bones.leftUpperLeg.rotation.x) < 0.01,
    'la gamba e-` rimasta a ' + vrm.bones.leftUpperLeg.rotation.x.toFixed(3) + ' dopo il cambio clip')
})

test('a riposo le braccia stanno lungo i fianchi, non in T-pose', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.reset(vrm)
  assert.equal(vrm.bones.rightUpperArm.rotation.z, REST_POSE.rightUpperArm.z)
  assert.equal(vrm.bones.leftUpperArm.rotation.z, REST_POSE.leftUpperArm.z)
})

test('gli angoli restano in un intervallo plausibile per un corpo umano', () => {
  // Guardia contro un refuso nella tabella: un valore in gradi al posto dei
  // radianti darebbe rotazioni assurde e sarebbe difficile da diagnosticare.
  const anim = makeAnimator()
  const vrm = fakeVrm()
  for (const nome of Object.keys(CLIPS)) {
    anim.play(nome)
    for (let i = 0; i < 240; i++) {
      anim.update(vrm, 1 / 60)
      for (const osso of TOUCHED_BONES) {
        for (const asse of ['x', 'y', 'z']) {
          const v = vrm.bones[osso].rotation[asse]
          assert.ok(Number.isFinite(v), nome + '/' + osso + '.' + asse + ' non e-` un numero')
          assert.ok(Math.abs(v) <= Math.PI,
            nome + '/' + osso + '.' + asse + ' = ' + v.toFixed(2) + ' rad, oltre mezzo giro')
        }
      }
    }
  }
})

test('il sobbalzo del bacino muove la posizione, non la rotazione', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  const baseY = vrm.bones.hips.position.y
  anim.play('run-to')
  advance(anim, vrm, 1.0)
  assert.equal(vrm.bones.hips.rotation.y, 0, 'il bacino non deve ruotare per un sobbalzo')
  assert.ok(vrm.bones.hips.position.y >= baseY, 'il sobbalzo parte dalla Y di riposo')
  assert.ok(vrm.bones.hips.position.y - baseY <= 0.05, 'sobbalzo troppo ampio')
})

test('il verso della marcia gira l-avatar e idle lo raddrizza', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('walk-to')
  anim.setFacing(1)
  const destra = advance(anim, vrm, 1.0)
  assert.ok(destra.yaw > 0.4, 'imbardata a destra insufficiente: ' + destra.yaw.toFixed(2))

  anim.setFacing(-1)
  const sinistra = advance(anim, vrm, 1.0)
  assert.ok(sinistra.yaw < -0.4, 'imbardata a sinistra insufficiente: ' + sinistra.yaw.toFixed(2))

  anim.play('idle')
  const dritto = advance(anim, vrm, 2.0)
  assert.ok(Math.abs(dritto.yaw) < 0.05, 'da fermo deve tornare di fronte')
})

test('setFacing ignora valori che non siano 1 o -1', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.play('walk-to')
  anim.setFacing(0)
  anim.setFacing('destra')
  anim.setFacing(99)
  const dopo = advance(anim, vrm, 1.0)
  assert.ok(Math.abs(dopo.yaw) < 0.01, 'un verso non valido non deve girare l-avatar')
})

test('la fusione interpola fra posa base e clip', () => {
  const base = { head: { x: 0 } }
  const clip = { head: { x: 1 } }
  assert.equal(mergePose(base, clip, 0).head.x, 0)
  assert.equal(mergePose(base, clip, 1).head.x, 1)
  assert.equal(mergePose(base, clip, 0.5).head.x, 0.5)
})

test('un VRM 0.x viene girato verso la camera, un VRM 1.0 no', () => {
  // Fred e' un VRM 1.0: con il mezzo giro fisso di prima compariva di spalle.
  const anim = makeAnimator()
  const vrm0 = fakeVrm(); vrm0.meta = { metaVersion: '0' }
  const vrm1 = fakeVrm(); vrm1.meta = { metaVersion: '1' }
  anim.update(vrm0, 1 / 60)
  assert.ok(Math.abs(vrm0.scene.rotation.y - Math.PI) < 0.01, 'il VRM 0.x deve girare di mezzo giro')
  anim.update(vrm1, 1 / 60)
  assert.ok(Math.abs(vrm1.scene.rotation.y) < 0.01, 'il VRM 1.0 guarda gia-` la camera')
})

test('su un VRM 1.0 la posa di riposo abbassa le braccia come sul 0.x', () => {
  // Il mezzo giro fra i due formati specchia x e z delle ossa: senza la
  // correzione le braccia di Fred salivano sopra la testa.
  const anim = makeAnimator()
  const vrm0 = fakeVrm(); vrm0.meta = { metaVersion: '0' }
  const vrm1 = fakeVrm(); vrm1.meta = { metaVersion: '1' }
  anim.reset(vrm0)
  anim.reset(vrm1)
  assert.equal(vrm1.bones.rightUpperArm.rotation.z, -vrm0.bones.rightUpperArm.rotation.z)
  assert.equal(vrm1.bones.leftUpperArm.rotation.z, -vrm0.bones.leftUpperArm.rotation.z)
})

test('il player regge un vrm senza ossa senza esplodere', () => {
  const anim = createVRMAnimator(() => null)
  const vuoto = { scene: { rotation: { x: 0, y: 0, z: 0 } } }
  anim.play('wave')
  assert.doesNotThrow(() => anim.update(vuoto, 1 / 60))
  assert.doesNotThrow(() => anim.reset(vuoto))
})

// Dado ripetibile: stessa sequenza per ogni frame rate.
function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
}
function countBlinks(fps, seconds = 120) {
  const blinker = createBlinker(seeded(42))
  let blinks = 0
  let prev = 0
  for (let i = 0; i < fps * seconds; i++) {
    const v = blinker.update(1 / fps)
    if (v > 0 && prev === 0) blinks++
    prev = v
  }
  return blinks
}

test('lo sguardo verso il mouse resta nei limiti di testa e busto', () => {
  for (const [yaw, pitch] of [[0, 0], [0.3, 0.1], [3, 2], [-3, -2]]) {
    const d = distributeLook(yaw, pitch)
    assert.ok(Math.abs(d.spine.y) <= LOOK_LIMITS.spineYaw + 1e-9)
    assert.ok(Math.abs(d.spine.x) <= LOOK_LIMITS.spinePitch + 1e-9)
    assert.ok(Math.abs(d.neck.y + d.head.y) <= LOOK_LIMITS.headYaw + 1e-9)
    assert.ok(Math.abs(d.neck.x + d.head.x) <= LOOK_LIMITS.headPitch + 1e-9)
  }
  // Entro i limiti la somma delle parti e' l'angolo chiesto.
  const d = distributeLook(0.4, -0.2)
  assert.ok(Math.abs(d.spine.y + d.neck.y + d.head.y - 0.4) < 1e-9)
  assert.ok(Math.abs(d.spine.x + d.neck.x + d.head.x + 0.2) < 1e-9)
})

test('a riposo la testa si gira verso il mouse, camminando no', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.setLookEnabled(true)
  anim.setLook(0.5, 0)
  const idle = advance(anim, vrm, 2)
  assert.ok(idle.lookWeight > 0.95, 'peso a riposo ' + idle.lookWeight)
  assert.ok(vrm.bones.head.rotation.y > 0.1, 'la testa non si e-` girata')
  anim.play('walk-to')
  const walking = advance(anim, vrm, 2)
  assert.equal(LOOK_WEIGHT['walk-to'], undefined)
  assert.ok(walking.lookWeight < 0.01, 'camminando il peso resta ' + walking.lookWeight)
})

test('spento, lo sguardo sfuma e non lascia la testa girata', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  anim.setLookEnabled(true)
  anim.setLook(0.6, 0.3)
  advance(anim, vrm, 2)
  anim.setLookEnabled(false)
  const off = advance(anim, vrm, 3)
  assert.ok(off.lookWeight < 0.001)
  assert.ok(Math.abs(vrm.bones.head.rotation.y - (CLIPS.idle.pose(anim.debug().clipElapsed).head.y)) < 0.01)
})

test('setLook ignora valori non numerici', () => {
  const anim = makeAnimator()
  anim.setLook(0.2, 0.1)
  anim.setLook(NaN, Infinity)
  const vrm = fakeVrm()
  anim.setLookEnabled(true)
  advance(anim, vrm, 2)
  assert.ok(Math.abs(anim.debug().look.yaw - 0.2) < 0.01)
})

test('preso in braccio le gambe penzolano invece di stare dritte', () => {
  const anim = makeAnimator()
  const vrm = fakeVrm()
  assert.equal(anim.play('drag'), 'dangle')
  advance(anim, vrm, 1)
  assert.ok(Math.abs(vrm.bones.leftLowerLeg.rotation.x) > 0.2, 'ginocchio dritto')
})

test('il battito di ciglia ha lo stesso ritmo a 30 e a 144 fps', () => {
  const slow = countBlinks(30)
  const fast = countBlinks(144)
  assert.ok(Math.abs(slow - fast) <= 1, slow + ' battiti a 30 fps, ' + fast + ' a 144')
  // Da 1 a 6 secondi fra un battito e l'altro: fra 17 e 120 in due minuti.
  assert.ok(slow >= 17 && slow <= 120, slow + ' battiti in due minuti')
})

test('il battito resta fra 0 e 1 e dura circa 0,2 s', () => {
  const blinker = createBlinker(() => 0)   // attesa minima: 1 s
  let closed = 0
  for (let i = 0; i < 60 * 1.5; i++) {
    const v = blinker.update(1 / 60)
    assert.ok(v >= 0 && v <= 1)
    if (v > 0) closed++
  }
  assert.ok(closed >= 10 && closed <= 13, closed + ' frame a occhi chiusi')
})

test('lo sguardo salta di pochi centimetri e resta fermo fra un salto e l-altro', () => {
  const gaze = createGaze(seeded(3))
  const seen = new Set()
  for (let i = 0; i < 600; i++) {
    const o = gaze.update(1 / 60)
    assert.ok(Math.abs(o.x) <= 0.12 && Math.abs(o.y) <= 0.06)
    seen.add(o.x + ',' + o.y)
  }
  assert.ok(seen.size >= 2 && seen.size <= 20, seen.size + ' posizioni in 10 s')
  const r = seeded(9)
  for (let i = 0; i < 1000; i++) { const s = nextSaccade(r); assert.ok(s >= 0.6 && s <= 4) }
})

test('l-umore colora il volto senza superare il tetto', () => {
  const full = moodExpressions({ emotions: { joy: 1, calm: 1, sadness: 1, annoyance: 1, curiosity: 1, affection: 1 } })
  for (const name of MOOD_EXPRESSIONS) assert.ok(full[name] >= 0 && full[name] <= MOOD_MAX, name + ' = ' + full[name])
  assert.ok(full.happy > 0 && full.sad > 0)
  const none = moodExpressions(null)
  for (const name of MOOD_EXPRESSIONS) assert.equal(none[name], 0)
})

console.log('\n=== ' + passed + ' test superati ===')
if (process.exitCode) console.error('=== ALCUNI TEST SONO FALLITI ===')
