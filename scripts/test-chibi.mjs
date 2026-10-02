// test-chibi.mjs — testa grande e corpo piccolo (src/renderer/chibi.js).
//
// Su un umanoide VRM minimo con il VRMHumanoid vero di three-vrm: scale nel
// mondo, piedi a terra, pose che restano le stesse, raggi dei capelli, e
// ritorno esatto alla misura piena.

import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CHIBI, chibiScales, setChibi, chibiOf } from '../src/renderer/chibi.js'
import { vrmTarget, wp, dir } from './lib/skeletons.mjs'

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
const near = (a, b, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) < eps, what + ' ' + a + ' invece di ' + b)
const worldScale = (node) => node.getWorldScale(new THREE.Vector3()).x

/** Un umanoide di prova, con un capello sulla testa e una sfera di collisione. */
function model(metaVersion = '1') {
  const vrm = vrmTarget(metaVersion)
  const head = vrm.bones.head
  const hair = new THREE.Bone()
  hair.position.set(0, 0.1, 0)
  head.add(hair)
  const collider = new THREE.Object3D()
  head.add(collider)
  const resets = []
  vrm.springBoneManager = {
    colliders: [{ ...collider, shape: { radius: 0.09 }, matrixWorld: collider.matrixWorld }],
    joints: [{ bone: hair, settings: { hitRadius: 0.02 } }],
    reset() { resets.push(Date.now()) },
  }
  vrm.resets = resets
  vrm.update()
  vrm.scene.updateMatrixWorld(true)
  return vrm
}

console.log('=== Chibi ===')

t('scale: corpo e gambe al corpo, testa compensata lungo la catena', () => {
  const plan = chibiScales(['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperLeg'])
  near(plan.bones.hips, CHIBI.BODY)
  near(plan.bones.hips * plan.bones.head, CHIBI.HEAD)
  near(plan.root, CHIBI.BODY)
  near(plan.headRatio, CHIBI.HEAD / CHIBI.BODY)
  assert.deepEqual(Object.keys(plan.bones).sort(), ['head', 'hips'])
})

t('scale: si leggono anche da una mappa nome -> nodo, senza le ossa assenti', () => {
  assert.ok(chibiScales({ hips: {}, head: {}, neck: null }))
  assert.equal(chibiScales({ hips: {}, head: null }), null)
  assert.equal(chibiScales(['spine', 'head']), null)
  assert.equal(chibiScales(['hips', 'head'], { head: 0 }), null)
})

t('scale: si scelgono testa e corpo', () => {
  const plan = chibiScales(['hips', 'head'], { head: 2, body: 0.5 })
  near(plan.bones.head, 4)
  near(plan.headRatio, 4)
})

for (const version of ['1', '0']) {
  t('VRM ' + version + '.x: testa e corpo nel mondo come voluto', () => {
    const vrm = model(version)
    assert.equal(setChibi(vrm, true), true)
    near(worldScale(vrm.bones.hips), CHIBI.BODY, 1e-6, 'bacino')
    near(worldScale(vrm.bones.head), CHIBI.HEAD, 1e-6, 'testa')
    near(worldScale(vrm.bones.leftFoot), CHIBI.BODY, 1e-6, 'piede')
    near(worldScale(vrm.bones.leftHand), CHIBI.BODY, 1e-6, 'mano')
  })

  t('VRM ' + version + '.x: il bacino scende con le gambe, i piedi restano a terra', () => {
    const vrm = model(version)
    const foot = wp(vrm.bones.leftFoot).y
    const hips = wp(vrm.bones.hips).y
    setChibi(vrm, true)
    near(wp(vrm.bones.hips).y, hips * CHIBI.BODY, 1e-6, 'bacino')
    near(wp(vrm.bones.leftFoot).y, foot * CHIBI.BODY, 1e-6, 'piede')
  })

  t('VRM ' + version + '.x: le pose restano le stesse (braccio alzato, seduto)', () => {
    const plain = model(version)
    const chibi = model(version)
    setChibi(chibi, true)
    for (const vrm of [plain, chibi]) {
      vrm.humanoid.getNormalizedBoneNode('leftUpperArm').rotation.set(0, 0, 1.0)
      // Seduto: il bacino normalizzato scende di 0,4.
      vrm.humanoid.getNormalizedBoneNode('hips').position.y -= 0.4
      vrm.update()
      vrm.scene.updateMatrixWorld(true)
    }
    const a = dir(plain.bones.leftUpperArm, plain.bones.leftLowerArm)
    const b = dir(chibi.bones.leftUpperArm, chibi.bones.leftLowerArm)
    assert.ok(a.distanceTo(b) < 1e-6, 'braccio ' + a.toArray() + ' / ' + b.toArray())
    // Il bacino scende in proporzione alle gambe: seduto resta seduto.
    near(wp(chibi.bones.hips).y, wp(plain.bones.hips).y * CHIBI.BODY, 1e-6, 'bacino seduto')
  })
}

t('capelli: i raggi crescono con la testa, poi le catene ripartono', () => {
  const vrm = model()
  setChibi(vrm, true)
  near(vrm.springBoneManager.colliders[0].shape.radius, 0.09 * CHIBI.HEAD, 1e-6, 'sfera')
  near(vrm.springBoneManager.joints[0].settings.hitRadius, 0.02 * CHIBI.HEAD, 1e-6, 'giunto')
  assert.equal(vrm.resets.length, 1)
})

t('spento torna esattamente com\'era, e acceso due volte non raddoppia', () => {
  const vrm = model()
  const before = Object.fromEntries(['hips', 'head', 'leftFoot'].map(n => [n, wp(vrm.bones[n]).toArray()]))
  setChibi(vrm, true)
  setChibi(vrm, true)
  near(worldScale(vrm.bones.head), CHIBI.HEAD, 1e-6, 'due volte')
  assert.ok(chibiOf(vrm))
  setChibi(vrm, false)
  assert.equal(chibiOf(vrm), null)
  for (const [n, p] of Object.entries(before)) assert.ok(wp(vrm.bones[n]).distanceTo(new THREE.Vector3(...p)) < 1e-9, n)
  near(worldScale(vrm.bones.head), 1, 1e-9, 'testa')
  near(vrm.humanoid.normalizedHumanBonesRoot.scale.x, 1, 1e-9, 'radice')
  near(vrm.springBoneManager.colliders[0].shape.radius, 0.09, 1e-12, 'sfera')
  assert.equal(vrm.resets.length, 2)
})

t('senza umanoide non fa niente', () => {
  assert.equal(setChibi({ scene: new THREE.Group() }, true), false)
  assert.equal(setChibi(null, true), false)
  assert.equal(chibiOf(null), null)
})

console.log(`\n=== ${passed} test superati ===`)
