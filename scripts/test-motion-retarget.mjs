// test-motion-retarget.mjs — una clip da uno scheletro qualsiasi a un VRM.
//
// Il percorso e' quello vero: scheletro sorgente scomodo (nomi Mixamo,
// centimetri, A-pose, rivolto verso -Z), clip che alza il braccio sinistro,
// conversione in .vrma, rilettura con il lettore ufficiale di three-vrm e
// riproduzione su un umanoide VRM 1.0 e su uno 0.x. Si confronta dove punta il
// braccio nel mondo: deve essere dove puntava nella sorgente.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { retargetClip, writeVRMA, prepareHumanoid } from '../src/renderer/motion-retarget.js'
import { createClipLayer } from '../src/renderer/clip-layer.js'
import { kimodoClip, SOMA30 } from '../src/renderer/kimodo-raw.js'
import { TOUCHED_BONES } from '../src/renderer/vrm-animation.js'
import { v, wp, dir, S, buildSkeleton, mixamoSource, vrmTarget } from './lib/skeletons.mjs'

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + (err.stack || err.message))
    process.exitCode = 1
  }
}

const near = (a, b, eps = 0.03) => assert.ok(a.distanceTo(b) < eps, a.toArray().map(n => n.toFixed(3)) + ' invece di ' + b.toArray().map(n => n.toFixed(3)))

async function loadVRMA(buffer) {
  const loader = new GLTFLoader()
  loader.register(parser => new VRMAnimationLoaderPlugin(parser))
  const gltf = await loader.parseAsync(buffer, '')
  assert.ok(gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0], 'il lettore di three-vrm non trova l-animazione')
  return gltf.userData.vrmAnimations[0]
}

function pose(vrm, clip, t) {
  const mixer = new THREE.AnimationMixer(vrm.scene)
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  mixer.setTime(t)
  vrm.humanoid.update()
  vrm.scene.updateMatrixWorld(true)
  return vrm.bones
}

async function main() {
  console.log('=== Conversione delle clip in .vrma ===\n')

  // Clip sorgente: al secondo 1 il braccio sinistro punta dritto in alto.
  const src = mixamoSource()
  const armRest = dir(src.bones.mixamorigLeftArm, src.bones.mixamorigLeftForeArm)
  const raise = new THREE.Quaternion().setFromUnitVectors(armRest, v(0, 1, 0))
  const clip = new THREE.AnimationClip('alza', 1, [
    new THREE.QuaternionKeyframeTrack('mixamorigLeftArm.quaternion', [0, 1], [0, 0, 0, 1, ...raise.toArray()]),
    new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 100, 0, 30, 90, 0]),
  ])
  const motion = retargetClip(src.root, clip, { fps: 30 })
  const file = writeVRMA(motion)
  const vrmAnimation = await loadVRMA(file)

  await test('il file .vrma si rilegge con il lettore di three-vrm', async () => {
    assert.ok(Math.abs(vrmAnimation.duration - 1) < 1e-6)
    assert.ok(vrmAnimation.humanoidTracks.rotation.has('leftUpperArm'))
    assert.ok(vrmAnimation.humanoidTracks.translation.has('hips'))
    assert.ok(vrmAnimation.restHipsPosition.y > 0.8 && vrmAnimation.restHipsPosition.y < 1.2, 'bacino a ' + vrmAnimation.restHipsPosition.y + ' m')
  })

  for (const meta of ['1', '0']) {
    await test(`VRM ${meta === '1' ? '1.0' : '0.x'}: la A-pose resta A-pose, il braccio alzato punta in alto`, async () => {
      const vrm = vrmTarget(meta)
      const anim = createVRMAnimationClip(vrmAnimation, vrm)
      let b = pose(vrm, anim, 0)
      // La sorgente guardava verso -Z: nel mondo del VRM (rivolto alla camera)
      // la sua sinistra e' +X.
      near(dir(b.leftUpperArm, b.leftLowerArm), v(S, -S, 0))
      near(dir(b.rightUpperArm, b.rightLowerArm), v(-S, -S, 0))
      b = pose(vrm, anim, 1)
      near(dir(b.leftUpperArm, b.leftLowerArm), v(0, 1, 0))
      near(dir(b.rightUpperArm, b.rightLowerArm), v(-S, -S, 0))
      near(dir(b.leftUpperLeg, b.leftLowerLeg), v(0, -1, 0))
    })
  }

  await test('lo spostamento orizzontale del bacino si toglie, quello verticale resta', async () => {
    const vrm = vrmTarget('1')
    const anim = createVRMAnimationClip(vrmAnimation, vrm)
    const h0 = wp(pose(vrm, anim, 0).hips)
    const h1 = wp(pose(vrm, anim, 1).hips)
    assert.ok(Math.abs(h1.x - h0.x) < 1e-3, 'il bacino si e-` spostato di lato di ' + (h1.x - h0.x))
    // 10 cm giu' su un bacino a 1 m, riportati all'altezza del VRM (0,9 m).
    assert.ok(Math.abs((h0.y - h1.y) - 0.09) < 0.01, 'discesa ' + (h0.y - h1.y))
  })

  await test('con inPlace false lo spostamento orizzontale resta', async () => {
    const s = mixamoSource()
    const m = retargetClip(s.root, clip, { inPlace: false })
    const x0 = m.hips[0]
    const x1 = m.hips[m.hips.length - 3]
    assert.ok(Math.abs(Math.abs(x1 - x0) - 0.3) < 0.01, 'spostamento ' + (x1 - x0))
  })

  await test('uno scheletro non umano viene rifiutato con l-elenco di cio- che manca', async () => {
    const { root } = buildSkeleton([['root', null, v(0, 0, 0)], ['tail', 'root', v(0, 0, -1)]])
    assert.throws(() => prepareHumanoid(root), /mancano: hips/)
  })

  await test('BVH (come le esportazioni di Kimodo): stessa strada, stesso risultato', async () => {
    // Scheletro SOMA ridotto, in centimetri, braccia in T-pose; al secondo
    // fotogramma il braccio sinistro ruota di 90 gradi verso il basso.
    const joint = (name, off, body) => `JOINT ${name}\n{\nOFFSET ${off}\nCHANNELS 3 Zrotation Xrotation Yrotation\n${body}}\n`
    const end = 'End Site\n{\nOFFSET 0 5 0\n}\n'
    const arm = (s, x) => joint(`${s}Shoulder`, `${x * 5} 12 0`, joint(`${s}Arm`, `${x * 10} 0 0`, joint(`${s}ForeArm`, `${x * 25} 0 0`, joint(`${s}Hand`, `${x * 22} 0 0`, end))))
    const leg = (s, x) => joint(`${s}UpLeg`, `${x * 9} -5 0`, joint(`${s}Leg`, '0 -45 0', joint(`${s}Foot`, '0 -42 0', end)))
    const text = 'HIERARCHY\nROOT Hips\n{\nOFFSET 0 100 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation\n' +
      joint('Spine1', '0 10 0', joint('Spine2', '0 10 0', joint('Chest', '0 10 0', joint('Neck1', '0 15 0', joint('Head', '0 10 0', end)) + arm('Left', 1) + arm('Right', -1)))) +
      leg('Left', 1) + leg('Right', -1) + '}\n' +
      'MOTION\nFrames: 2\nFrame Time: 1\n'
    const channels = 6 + 3 * (text.match(/CHANNELS 3/g) || []).length
    const frame = (leftArmZ) => {
      const values = new Array(channels).fill(0)
      values[1] = 100
      // Ordine dei canali: Hips(6), Spine1, Spine2, Chest, Neck1, Head, LeftShoulder, LeftArm...
      values[6 + 3 * 6] = leftArmZ
      return values.join(' ')
    }
    const bvh = new BVHLoader().parse(text + frame(0) + '\n' + frame(-90) + '\n')
    const root = new THREE.Group()
    root.add(bvh.skeleton.bones[0])
    const m = retargetClip(root, bvh.clip)
    const vrm = vrmTarget('1')
    const clip2 = createVRMAnimationClip(await loadVRMA(writeVRMA(m)), vrm)
    let b = pose(vrm, clip2, 0)
    near(dir(b.leftUpperArm, b.leftLowerArm), v(1, 0, 0))
    b = pose(vrm, clip2, 1)
    near(dir(b.leftUpperArm, b.leftLowerArm), v(0, -1, 0))
  })

  await test('Kimodo vero (SOMA, posa zero non umana): da in piedi a seduto a terra', async () => {
    // Estratto di un BVH esportato dalla demo di Kimodo: la posa zero ha ogni
    // osso lungo il proprio asse X, il corpo esiste solo nei fotogrammi.
    const text = fs.readFileSync(path.join(path.dirname(process.argv[1]), 'fixtures', 'kimodo-soma77-sit.bvh'), 'utf8')
    const bvh = new BVHLoader().parse(text)
    const root = new THREE.Group()
    root.add(bvh.skeleton.bones[0])
    const anim = await loadVRMA(writeVRMA(retargetClip(root, bvh.clip)))
    for (const meta of ['1', '0']) {
      const vrm = vrmTarget(meta)
      const clip = createVRMAnimationClip(anim, vrm)
      let b = pose(vrm, clip, 0)
      assert.ok(wp(b.hips).y > 0.85, meta + ': all-inizio in piedi (bacino ' + wp(b.hips).y.toFixed(2) + ')')
      assert.ok(dir(b.leftUpperLeg, b.leftLowerLeg).y < -0.95, meta + ': gamba verticale')
      assert.ok(dir(b.leftUpperArm, b.leftLowerArm).y < -0.9, meta + ': braccia lungo i fianchi')
      assert.ok(wp(b.leftUpperArm).sub(wp(b.rightUpperArm)).normalize().x > 0.95, meta + ': rivolto verso la camera')
      b = pose(vrm, clip, anim.duration)
      const knee = dir(b.leftUpperLeg, b.leftLowerLeg).angleTo(dir(b.leftLowerLeg, b.leftFoot)) * 180 / Math.PI
      assert.ok(wp(b.hips).y < 0.25, meta + ': alla fine seduto a terra (bacino ' + wp(b.hips).y.toFixed(2) + ')')
      assert.ok(knee > 90, meta + ': ginocchia piegate (' + knee.toFixed(0) + ' gradi)')
      assert.ok(dir(b.hips, b.head).y > 0.85, meta + ': busto dritto')
    }
  })

  await test('livello delle clip: entra in dissolvenza, dura quanto la clip, poi lascia la posa procedurale', async () => {
    const vrm = vrmTarget('1')
    const layer = createClipLayer()
    layer.setLibrary(new Map([['wave', [{ name: 'wave-test.vrma', animation: vrmAnimation }]]]))
    layer.attach(vrm)
    assert.ok(layer.has('wave') && !layer.has('sit'))
    assert.ok(Math.abs(layer.prepare('wave') - 1) < 1e-6, 'la durata deve essere quella della clip')
    // Il player procedurale riscrive le sue ossa a ogni frame: qui a riposo.
    const procedural = () => {
      for (const n of TOUCHED_BONES) { const b = vrm.humanoid.getNormalizedBoneNode(n); if (b) b.quaternion.identity() }
    }
    const step = (slot, seconds) => {
      let w = 0
      for (let t = 0; t < seconds; t += 1 / 60) {
        procedural()
        w = layer.update(1 / 60, slot)
        vrm.humanoid.update()
        vrm.scene.updateMatrixWorld(true)
      }
      return w
    }
    assert.ok(step('wave', 0.1) < 0.5, 'deve entrare in dissolvenza')
    assert.equal(step('wave', 1), 1)
    near(dir(vrm.bones.leftUpperArm, vrm.bones.leftLowerArm), v(0, 1, 0))
    // Finita la clip il player torna a idle, che non ha una clip: torna la posa procedurale.
    assert.equal(step('idle', 0.6), 0)
    near(dir(vrm.bones.leftUpperArm, vrm.bones.leftLowerArm), v(1, 0, 0))
    assert.equal(layer.debug().clip, null)
  })

  await test('uscita grezza di kimodo.cpp (SOMA 30): T-pose, braccio abbassato, bacino', async () => {
    // Due fotogrammi: fermo in T-pose, poi braccio sinistro giu' e bacino piu' basso.
    const frames = 2
    const joints = SOMA30.names.length
    const rot = new Float32Array(frames * joints * 4)
    for (let i = 0; i < frames * joints; i++) rot[i * 4 + 3] = 1
    const down = new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), -Math.PI / 2)
    rot.set(down.toArray(), (1 * joints + SOMA30.names.indexOf('LeftArm')) * 4)
    const roots = new Float32Array([0, 0.95, 0, 0, 0.75, 0])
    const { root, clip } = kimodoClip(roots, rot)
    assert.ok(Math.abs(clip.duration - 1 / 30) < 1e-6)
    const anim = await loadVRMA(writeVRMA(retargetClip(root, clip, { fps: 60 })))
    const vrm = vrmTarget('1')
    const c = createVRMAnimationClip(anim, vrm)
    let b = pose(vrm, c, 0)
    near(dir(b.leftUpperArm, b.leftLowerArm), v(1, 0, 0), 0.08)
    near(dir(b.leftUpperLeg, b.leftLowerLeg), v(0, -1, 0), 0.08)
    const h0 = wp(b.hips).y
    b = pose(vrm, c, anim.duration)
    near(dir(b.leftUpperArm, b.leftLowerArm), v(0, -1, 0), 0.08)
    assert.ok(wp(b.hips).y < h0 - 0.1, 'il bacino deve scendere')
    assert.throws(() => kimodoClip(new Float32Array(6), new Float32Array(10)), /non valida/)
  })

  await test('fasi: il "sedersi" di Kimodo resta seduto, e l-uscita passa prima dello slot nuovo', async () => {
    const text = fs.readFileSync(path.join(path.dirname(process.argv[1]), 'fixtures', 'kimodo-soma77-sit.bvh'), 'utf8')
    const bvh = new BVHLoader().parse(text)
    const root = new THREE.Group()
    root.add(bvh.skeleton.bones[0])
    const sitDown = await loadVRMA(writeVRMA(retargetClip(root, bvh.clip)))
    const vrm = vrmTarget('1')
    const layer = createClipLayer()
    layer.setLibrary(new Map([
      ['sit', [{ name: 'sit-enter-kimodo.vrma', animation: sitDown, phase: 'enter' }, { name: 'sit-exit-prova.vrma', animation: vrmAnimation, phase: 'exit' }]],
    ]))
    layer.attach(vrm)
    // sit e' uno slot ciclico: nessuna durata da dare al player.
    assert.equal(layer.prepare('sit'), undefined)
    const run = (slot, seconds) => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        for (const n of TOUCHED_BONES) { const b = vrm.humanoid.getNormalizedBoneNode(n); if (b) b.quaternion.identity() }
        layer.update(1 / 30, slot)
        vrm.humanoid.update()
        vrm.scene.updateMatrixWorld(true)
      }
    }
    run('sit', sitDown.duration + 3)
    assert.equal(layer.debug().kind, 'enter')
    assert.ok(wp(vrm.bones.hips).y < 0.25, 'tre secondi dopo la fine deve essere ancora seduto (bacino ' + wp(vrm.bones.hips).y.toFixed(2) + ')')
    run('idle', 0.5)
    assert.equal(layer.debug().kind, 'exit')
    assert.equal(layer.debug().clip, 'sit-exit-prova.vrma')
    run('idle', vrmAnimation.duration + 1)
    assert.equal(layer.debug().clip, null, 'finita l-uscita, idle senza clip: resta la posa procedurale')
    assert.equal(layer.debug().weight, 0)
  })

  await test('livello delle clip su un modello senza umanoide: non fa nulla', async () => {
    const layer = createClipLayer()
    layer.attach(/** @type {any} */ ({ scene: new THREE.Group() }))
    assert.equal(layer.update(1 / 60, 'wave'), 0)
    assert.equal(layer.prepare('wave'), undefined)
  })

  console.log('\n=== ' + passed + ' test superati ===')
}

main()
