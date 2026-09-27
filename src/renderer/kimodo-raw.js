// kimodo-raw.js — l'uscita grezza di Kimodo (kimodo.cpp) come clip di three.
//
// kmd-generate scrive due file float32: root_positions.f32 (fotogrammi x 3,
// il bacino nel mondo) e local_rotations_xyzw.f32 (fotogrammi x ossa x 4,
// rotazioni locali). Lo scheletro e' SOMA a 30 ossa, con rotazioni di riposo
// nulle e gli offset qui sotto, a 30 fotogrammi al secondo: la stessa
// costruzione della demo di kimodo.cpp (demo/main.go, writeSkeletonGLB).
// Da qui retargetClip + writeVRMA portano la clip a .vrma come ogni altra.
//
// Nomi, genitori e offset vengono da kimodo.cpp src/skeleton.hpp (Apache-2.0),
// che li ha presi da NVIDIA Kimodo kimodo/skeleton/definitions.py (Apache-2.0).

import * as THREE from 'three'

export const KIMODO_FPS = 30
// Il pavimento di Kimodo e' a y = 0; in piedi, con i piedi piatti, la
// caviglia (LeftFoot) sta a 7 cm (misurato su "A person stands still.").
const ANKLE_HEIGHT = 0.07

export const SOMA30 = {
  names: [
    'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'Jaw',
    'LeftEye', 'RightEye', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'LeftHandThumbEnd', 'LeftHandMiddleEnd', 'RightShoulder', 'RightArm', 'RightForeArm',
    'RightHand', 'RightHandThumbEnd', 'RightHandMiddleEnd', 'LeftLeg', 'LeftShin', 'LeftFoot',
    'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase',
  ],
  parents: [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28],
  offsets: [
    [0, 0, 0], [-0.00013727, 0.0500376256, -0.00053726669], [-1.86574103e-9, 0.0712530139, -0.000298248546],
    [-5.75188398e-9, 0.0755006305, -0.00815970992], [-0.00181676517, 0.263112953, -0.00553348292],
    [-2.85102231e-8, 0.0770939664, 0.0230258546], [-4.5975437e-8, 0.0612891595, 0.0195370861],
    [2.63687901e-5, 0.0047559225, 0.0309494062], [0.0320638079, 0.0538020513, 0.0758688308],
    [-0.0322244017, 0.05361869, 0.0755823359], [0.0162165175, 0.232371641, 0.0511341324],
    [0.149198457, 2.19397873e-8, -0.0550232576], [0.287393078, 2.50268389e-9, -2.58787737e-5],
    [0.270939812, -7.06625108e-9, 2.60897248e-5], [0.122686267, -0.0322017573, 0.0483306876],
    [0.190119595, -0.00312878387, -0.000339570373], [-0.0138011824, 0.231803086, 0.0521415786],
    [-0.150371962, 1.17387901e-7, -0.0554560437], [-0.287366393, 1.87628082e-8, -2.59709359e-5],
    [-0.271336198, -1.16767401e-9, 2.61269368e-5], [-0.122642483, -0.0321145448, 0.0480403904],
    [-0.190005945, -0.00306615542, -0.0003157343], [0.10043214, -0.0843452671, 0.0259565473],
    [-1e-8, -0.432217537, -0.00802912805], [1e-8, -0.421550959, -0.0348152298],
    [0, -0.0505947206, 0.132315294], [-0.10047278, -0.0829525995, 0.0262031695],
    [1e-8, -0.433622059, -0.00805555828], [2e-8, -0.421173943, -0.0347839785],
    [-3.42907669e-9, -0.0507960932, 0.132841956],
  ],
}

/**
 * Costruisce scheletro e clip dall'uscita di kmd-generate.
 * @param {Float32Array} rootPositions fotogrammi x 3
 * @param {Float32Array} rotations fotogrammi x 30 x 4 (xyzw)
 * @param {{ name?: string, fps?: number }} [options]
 * @returns {{ root: THREE.Group, clip: THREE.AnimationClip, frames: number }}
 */
export function kimodoClip(rootPositions, rotations, options = {}) {
  const fps = options.fps || KIMODO_FPS
  const joints = SOMA30.names.length
  const frames = rootPositions.length / 3
  if (!Number.isInteger(frames) || frames < 2 || rotations.length !== frames * joints * 4) {
    throw new Error('uscita di Kimodo non valida: ' + rootPositions.length + ' valori di bacino, ' + rotations.length + ' di rotazioni')
  }
  const root = new THREE.Group()
  const bones = SOMA30.names.map((name, i) => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.fromArray(SOMA30.offsets[i])
    return bone
  })
  bones.forEach((bone, i) => (SOMA30.parents[i] < 0 ? root : bones[SOMA30.parents[i]]).add(bone))

  const times = new Float32Array(frames)
  for (let f = 0; f < frames; f++) times[f] = f / fps
  const tracks = [new THREE.VectorKeyframeTrack('Hips.position', times, rootPositions)]
  for (let j = 0; j < joints; j++) {
    const values = new Float32Array(frames * 4)
    for (let f = 0; f < frames; f++) values.set(rotations.subarray((f * joints + j) * 4, (f * joints + j + 1) * 4), f * 4)
    tracks.push(new THREE.QuaternionKeyframeTrack(SOMA30.names[j] + '.quaternion', times, values))
  }
  // Riposo: la T-pose in piedi sul pavimento vero, non l'altezza del primo
  // fotogramma. Con una clip che parte seduta il riposo finiva a terra, e il
  // seduto veniva rialzato all'altezza di chi sta in piedi.
  root.updateMatrixWorld(true)
  const foot = (name) => bones[SOMA30.names.indexOf(name)].getWorldPosition(new THREE.Vector3()).y
  const standing = ANKLE_HEIGHT - Math.min(foot('LeftFoot'), foot('RightFoot'))
  bones[0].position.set(rootPositions[0], standing, rootPositions[2])
  root.updateMatrixWorld(true)
  return { root, clip: new THREE.AnimationClip(options.name || 'kimodo', (frames - 1) / fps, tracks), frames }
}

// ─── Taglio e chiusura dei cicli, sull'uscita grezza ───────────────────────

/**
 * I fotogrammi da from a to (compreso) dell'uscita grezza.
 * @param {Float32Array} rootPositions
 * @param {Float32Array} rotations
 * @param {number} from
 * @param {number} to
 */
export function sliceMotion(rootPositions, rotations, from, to) {
  const joints = SOMA30.names.length
  return {
    rootPositions: rootPositions.slice(from * 3, (to + 1) * 3),
    rotations: rotations.slice(from * joints * 4, (to + 1) * joints * 4),
  }
}

/** Distanza fra due pose: rotazioni delle ossa e altezza del bacino. */
function poseDistance(rootPositions, rotations, a, b) {
  const joints = SOMA30.names.length
  let d = 0
  for (let j = 0; j < joints; j++) {
    const i = (a * joints + j) * 4
    const k = (b * joints + j) * 4
    const dot = rotations[i] * rotations[k] + rotations[i + 1] * rotations[k + 1] + rotations[i + 2] * rotations[k + 2] + rotations[i + 3] * rotations[k + 3]
    d += 1 - Math.min(1, Math.abs(dot))
  }
  return d + Math.abs(rootPositions[a * 3 + 1] - rootPositions[b * 3 + 1])
}

/**
 * Il tratto che si ripete meglio: due fotogrammi il piu' simili possibile, a
 * distanza di almeno minFrames. L'inizio sta nel primo quarto; a parita' di
 * somiglianza vince il tratto piu' lungo.
 * @returns {{ from: number, to: number, distance: number }}
 */
export function findLoop(rootPositions, rotations, { minFrames = 30 } = {}) {
  const frames = rootPositions.length / 3
  let best = { from: 0, to: frames - 1, distance: poseDistance(rootPositions, rotations, 0, frames - 1) }
  let bestCost = Infinity
  for (let a = 0; a <= Math.floor(frames / 4); a++) {
    for (let b = a + minFrames; b < frames; b++) {
      const distance = poseDistance(rootPositions, rotations, a, b)
      const cost = distance + 0.0001 * (frames - (b - a))
      if (cost < bestCost) { bestCost = cost; best = { from: a, to: b, distance } }
    }
  }
  return best
}

/**
 * Chiude un ciclo: gli ultimi blend fotogrammi sfumano verso il primo, cosi'
 * l'ultimo coincide col primo e la ripartenza non salta. Modifica gli array.
 * @param {Float32Array} rootPositions
 * @param {Float32Array} rotations
 * @param {number} [blend] fotogrammi di raccordo
 */
export function closeLoop(rootPositions, rotations, blend = 10) {
  const joints = SOMA30.names.length
  const frames = rootPositions.length / 3
  const n = Math.min(blend, frames - 1)
  const q = new THREE.Quaternion()
  const first = new THREE.Quaternion()
  for (let s = 1; s <= n; s++) {
    const f = frames - 1 - n + s
    const t = s / n
    const w = t * t * (3 - 2 * t)
    for (let j = 0; j < joints; j++) {
      const i = (f * joints + j) * 4
      q.fromArray(rotations, i)
      first.fromArray(rotations, j * 4)
      q.slerp(first, w).toArray(rotations, i)
    }
    for (let c = 0; c < 3; c++) rootPositions[f * 3 + c] += (rootPositions[c] - rootPositions[f * 3 + c]) * w
  }
}
