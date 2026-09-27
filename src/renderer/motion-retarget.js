// motion-retarget.js — da uno scheletro qualsiasi all'umanoide VRM, e al .vrma.
//
// Due usi, stesso cuore:
// - un modello glTF o FBX con scheletro umano diventa animabile come un VRM
//   (prepareHumanoid + VRMHumanoid in companion-3d.js);
// - una clip glTF, FBX o BVH diventa un file .vrma (retargetClip + writeVRMA),
//   l'unico formato di animazione che il player conosce.
//
// Il passaggio chiave e' la T-pose. Nello spazio "normalizzato" di three-vrm
// ogni osso a riposo ha rotazione nulla con il corpo in T-pose, rivolto verso
// +Z, in piedi lungo +Y. Uno scheletro che arriva in A-pose (braccia a V), o
// sdraiato lungo Z, o in centimetri, viene prima portato li': solo allora le
// rotazioni di una clip valgono per qualunque modello.
//
// Funziona anche in Node (i test): usa three ma nessuna API del browser.

import * as THREE from 'three'
import { VRMHumanBoneParentMap } from '@pixiv/three-vrm'
import { mapHumanoid } from './humanoid-map.js'

const Y = new THREE.Vector3(0, 1, 0)
const wp = (o) => o.getWorldPosition(new THREE.Vector3())
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion())

/**
 * Trova l'umanoide sotto root.
 * @param {THREE.Object3D} root
 * @returns {{ ok: boolean, missing: string[], nodes: Record<string, THREE.Object3D> }}
 */
export function findHumanoid(root) {
  const all = []
  root.traverse(o => { if (o !== root) all.push(o) })
  // Con uno scheletro vero contano solo le ossa: mesh e luci hanno nomi come
  // "Body" o "Head_Mesh" che non devono finire nell'abbinamento.
  const candidates = all.some(o => o.isBone) ? all.filter(o => o.isBone) : all
  const inSet = new Set(candidates)
  const list = candidates.map(o => ({ name: o.name, parent: o.parent && inSet.has(o.parent) ? o.parent.name : null }))
  const found = mapHumanoid(list)
  const byName = new Map()
  for (const o of candidates) if (!byName.has(o.name)) byName.set(o.name, o)
  const nodes = {}
  for (const [vrmName, name] of Object.entries(found.bones)) nodes[vrmName] = byName.get(name)
  return { ok: found.ok, missing: found.missing, nodes }
}

/** Genitore umanoide piu' vicino che esiste, come lo cerca three-vrm. */
export function humanParent(name, nodes) {
  let p = VRMHumanBoneParentMap[name]
  while (p && !nodes[p]) p = VRMHumanBoneParentMap[p]
  return p || null
}

/**
 * Raddrizza lo scheletro: in piedi lungo +Y, rivolto verso +Z, in metri, con
 * i piedi a terra. Agisce solo su root, che deve essere un contenitore.
 */
export function orientUpright(root, nodes) {
  root.updateMatrixWorld(true)
  const up = wp(nodes.head).sub(wp(nodes.hips)).normalize()
  root.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(up, Y))
  root.updateMatrixWorld(true)
  // Rivolto verso +Z significa la sinistra del modello verso +X.
  const side = wp(nodes.leftUpperArm).sub(wp(nodes.rightUpperArm))
  root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(side.z, side.x)))
  root.updateMatrixWorld(true)

  // Unita': dalla testa ai piedi un umano e' fra 1 e 2 m. In centimetri (FBX,
  // Mixamo, BVH) sarebbe fra 100 e 200, in millimetri oltre 1000.
  const feetY = Math.min(wp(nodes.leftFoot).y, wp(nodes.rightFoot).y)
  const height = wp(nodes.head).y - feetY
  const scale = height > 1000 ? 0.001 : height > 10 ? 0.01 : 1
  if (scale !== 1) { root.scale.multiplyScalar(scale); root.updateMatrixWorld(true) }

  // A terra: il player scala lo spostamento del bacino con la sua altezza.
  const ground = Math.min(wp(nodes.leftFoot).y, wp(nodes.rightFoot).y) - 0.08 * (height * scale)
  root.position.y -= ground
  const hips = wp(nodes.hips)
  root.position.x -= hips.x
  root.position.z -= hips.z
  root.updateMatrixWorld(true)
}

/** Ruota bone perche' la direzione verso child diventi dir, in spazio mondo. */
function align(bone, child, dir) {
  if (!bone || !child || !bone.parent) return
  const cur = wp(child).sub(wp(bone))
  if (cur.lengthSq() < 1e-12) return
  const delta = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), dir)
  const world = delta.multiply(wq(bone))
  bone.quaternion.copy(wq(bone.parent).invert().multiply(world))
  bone.updateMatrixWorld(true)
}

/** Porta braccia e gambe in T-pose: braccia orizzontali, gambe dritte. */
export function autoTPose(nodes) {
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const out = new THREE.Vector3(sign, 0, 0)
    const down = new THREE.Vector3(0, -1, 0)
    align(nodes[side + 'UpperArm'], nodes[side + 'LowerArm'], out)
    align(nodes[side + 'LowerArm'], nodes[side + 'Hand'], out)
    align(nodes[side + 'Hand'], nodes[side + 'MiddleProximal'], out)
    align(nodes[side + 'UpperLeg'], nodes[side + 'LowerLeg'], down)
    align(nodes[side + 'LowerLeg'], nodes[side + 'Foot'], down)
  }
}

/**
 * Prepara uno scheletro alla conversione o all'animazione: trova le ossa, lo
 * raddrizza e lo mette in T-pose.
 * @param {THREE.Object3D} root contenitore dello scheletro (viene modificato)
 */
export function prepareHumanoid(root) {
  const found = findHumanoid(root)
  if (!found.ok) {
    throw Object.assign(new Error('scheletro non umanoide, mancano: ' + found.missing.join(', ')), { missing: found.missing })
  }
  orientUpright(root, found.nodes)
  autoTPose(found.nodes)
  root.updateMatrixWorld(true)
  return found.nodes
}

/**
 * Converte una clip nello spazio umanoide normalizzato.
 * @param {THREE.Object3D} root contenitore dello scheletro, a riposo
 * @param {THREE.AnimationClip} clip
 * @param {{ fps?: number, inPlace?: boolean }} [options] inPlace: il bacino
 *        non si sposta in orizzontale (la camminata la fa la finestra)
 */
export function retargetClip(root, clip, { fps = 30, inPlace = true } = {}) {
  // La posa originale serve alle ossa che la clip non muove: una sorgente in
  // A-pose che non tocca il braccio destro lo tiene a V, non in T-pose.
  const original = new Map()
  root.traverse(o => original.set(o, o.quaternion.clone()))
  const nodes = prepareHumanoid(root)
  const names = Object.keys(nodes)
  const rest = {}
  const restPos = {}
  for (const n of names) { rest[n] = wq(nodes[n]); restPos[n] = wp(nodes[n]) }
  for (const [o, q] of original) if (o !== root) o.quaternion.copy(q)
  root.updateMatrixWorld(true)

  const mixer = new THREE.AnimationMixer(root)
  // Una volta sola: in loop, all'ultimo istante il mixer tornerebbe al primo
  // fotogramma e la posa finale andrebbe persa.
  const action = mixer.clipAction(clip)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const duration = Math.max(clip.duration, 1 / fps)
  const frames = Math.max(2, Math.round(duration * fps) + 1)
  const times = new Float32Array(frames)
  const tracks = Object.fromEntries(names.map(n => [n, new Float32Array(frames * 4)]))
  const hips = new Float32Array(frames * 3)
  const delta = {}
  const q = new THREE.Quaternion()

  for (let i = 0; i < frames; i++) {
    const t = Math.min(duration, i / fps)
    times[i] = t
    mixer.setTime(t)
    root.updateMatrixWorld(true)
    // Rotazione di ogni osso rispetto alla sua T-pose, nello spazio del mondo.
    for (const n of names) delta[n] = wq(nodes[n]).multiply(rest[n].clone().invert())
    for (const n of names) {
      const parent = humanParent(n, nodes)
      q.copy(parent ? delta[parent].clone().invert().multiply(delta[n]) : delta[n])
      const out = tracks[n]
      // Stesso emisfero del fotogramma prima: q e -q sono la stessa rotazione,
      // ma interpolando fra i due l'osso farebbe un giro intero.
      if (i > 0 && q.x * out[i * 4 - 4] + q.y * out[i * 4 - 3] + q.z * out[i * 4 - 2] + q.w * out[i * 4 - 1] < 0) {
        q.set(-q.x, -q.y, -q.z, -q.w)
      }
      q.toArray(out, i * 4)
    }
    const h = wp(nodes.hips)
    if (inPlace) { h.x = restPos.hips.x; h.z = restPos.hips.z }
    h.toArray(hips, i * 3)
  }
  mixer.stopAllAction()
  mixer.uncacheRoot(root)

  // Posizioni di riposo per lo scheletro del file .vrma, relative al genitore.
  const skeleton = names.map(n => {
    const parent = humanParent(n, nodes)
    const pos = restPos[n].clone().sub(parent ? restPos[parent] : new THREE.Vector3())
    return { name: n, parent, translation: pos.toArray() }
  })
  return { name: clip.name || 'clip', duration, times, tracks, hips, skeleton }
}

// ─── Scrittura del .vrma (glTF binario con VRMC_vrm_animation) ─────────────

/**
 * @param {ReturnType<typeof retargetClip>} motion
 * @returns {ArrayBuffer} il file .vrma
 */
export function writeVRMA(motion) {
  const chunks = []
  let byteLength = 0
  const bufferViews = []
  const accessors = []
  const addAccessor = (array, type, withMinMax) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    chunks.push({ offset: byteLength, bytes })
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length })
    byteLength += bytes.length
    while (byteLength % 4) byteLength++
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const accessor = { bufferView: bufferViews.length - 1, componentType: 5126, count: array.length / size, type }
    if (withMinMax) {
      accessor.min = [array[0]]
      accessor.max = [array[array.length - 1]]
    }
    accessors.push(accessor)
    return accessors.length - 1
  }

  const index = new Map(motion.skeleton.map((b, i) => [b.name, i]))
  /** @type {{ name: string, translation: number[], children?: number[] }[]} */
  const nodes = motion.skeleton.map(b => ({ name: b.name, translation: b.translation }))
  motion.skeleton.forEach((b, i) => {
    if (!b.parent) return
    const p = nodes[index.get(b.parent)]
    ;(p.children = p.children || []).push(i)
  })
  const roots = motion.skeleton.map((b, i) => (b.parent ? -1 : i)).filter(i => i >= 0)

  const input = addAccessor(motion.times, 'SCALAR', true)
  const samplers = []
  const channels = []
  for (const [name, values] of Object.entries(motion.tracks)) {
    samplers.push({ input, output: addAccessor(values, 'VEC4'), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: index.get(name), path: 'rotation' } })
  }
  samplers.push({ input, output: addAccessor(motion.hips, 'VEC3'), interpolation: 'LINEAR' })
  channels.push({ sampler: samplers.length - 1, target: { node: index.get('hips'), path: 'translation' } })

  const json = {
    asset: { version: '2.0', generator: 'CompanionAI motion-retarget' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones: Object.fromEntries(motion.skeleton.map((b, i) => [b.name, { node: i }])) },
      },
    },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
    animations: [{ name: motion.name, channels, samplers }],
  }

  const bin = new Uint8Array(byteLength)
  for (const c of chunks) bin.set(c.bytes, c.offset)
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length
  const out = new ArrayBuffer(total)
  const view = new DataView(out)
  const u8 = new Uint8Array(out)
  view.setUint32(0, 0x46546c67, true)   // "glTF"
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length + jsonPad, true)
  view.setUint32(16, 0x4e4f534a, true)  // "JSON"
  u8.set(jsonBytes, 20)
  u8.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad)
  const binStart = 20 + jsonBytes.length + jsonPad
  view.setUint32(binStart, bin.length, true)
  view.setUint32(binStart + 4, 0x004e4942, true) // "BIN\0"
  u8.set(bin, binStart + 8)
  return out
}
