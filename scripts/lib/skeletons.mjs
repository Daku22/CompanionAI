// skeletons.mjs — scheletri finti per i test e per audit.mjs.
//
// mixamoSource: una sorgente scomoda (nomi Mixamo come li lascia three,
// centimetri, A-pose, rivolta verso -Z). vrmTarget: un umanoide VRM minimo in
// T-pose, 1.0 o 0.x, con VRMHumanoid vero di three-vrm.

import * as THREE from 'three'
import { VRMHumanoid } from '@pixiv/three-vrm'

export const v = (x, y, z) => new THREE.Vector3(x, y, z)
export const wp = (o) => o.getWorldPosition(new THREE.Vector3())
export const dir = (a, b) => wp(b).sub(wp(a)).normalize()
export const S = Math.SQRT1_2

/** Costruisce ossa da [nome, genitore, offset] e restituisce il contenitore. */
export function buildSkeleton(spec) {
  const root = new THREE.Group()
  const bones = {}
  for (const [name, parent, offset] of spec) {
    const b = new THREE.Bone()
    b.name = name
    b.position.copy(offset)
    ;(parent ? bones[parent] : root).add(b)
    bones[name] = b
  }
  root.updateMatrixWorld(true)
  return { root, bones }
}

// Sorgente: Mixamo in centimetri, rivolto verso -Z (la sua sinistra e' -X),
// braccia in A-pose a 45 gradi.
export function mixamoSource() {
  const L = -1 // sinistra del modello
  // Nomi come li lasciano i loader di three: senza i due punti.
  const n = (s) => THREE.PropertyBinding.sanitizeNodeName('mixamorig:' + s)
  const spec = [
    [n('Hips'), null, v(0, 100, 0)],
    [n('Spine'), n('Hips'), v(0, 10, 0)], [n('Spine1'), n('Spine'), v(0, 10, 0)], [n('Spine2'), n('Spine1'), v(0, 10, 0)],
    [n('Neck'), n('Spine2'), v(0, 15, 0)], [n('Head'), n('Neck'), v(0, 10, 0)],
  ]
  for (const [side, sx] of /** @type {[string, number][]} */ ([['Left', L], ['Right', -L]])) {
    spec.push(
      [n(side + 'Shoulder'), n('Spine2'), v(5 * sx, 12, 0)],
      [n(side + 'Arm'), n(side + 'Shoulder'), v(10 * sx, 0, 0)],
      [n(side + 'ForeArm'), n(side + 'Arm'), v(25 * S * sx, -25 * S, 0)],
      [n(side + 'Hand'), n(side + 'ForeArm'), v(25 * S * sx, -25 * S, 0)],
      [n(side + 'UpLeg'), n('Hips'), v(9 * sx, -5, 0)],
      [n(side + 'Leg'), n(side + 'UpLeg'), v(0, -45, 0)],
      [n(side + 'Foot'), n(side + 'Leg'), v(0, -42, 0)],
    )
  }
  return buildSkeleton(spec)
}

// Bersaglio: umanoide VRM in T-pose, rivolto verso +Z (VRM 1.0) o -Z (0.x).
export function vrmTarget(metaVersion) {
  const s = metaVersion === '0' ? -1 : 1  // sul 0.x la sinistra e' -X
  const spec = [
    ['hips', null, v(0, 0.9, 0)], ['spine', 'hips', v(0, 0.1, 0)], ['chest', 'spine', v(0, 0.1, 0)],
    ['upperChest', 'chest', v(0, 0.1, 0)], ['neck', 'upperChest', v(0, 0.12, 0)], ['head', 'neck', v(0, 0.1, 0)],
  ]
  for (const [side, sx] of /** @type {[string, number][]} */ ([['left', s], ['right', -s]])) {
    spec.push(
      [side + 'Shoulder', 'upperChest', v(0.04 * sx, 0.1, 0)], [side + 'UpperArm', side + 'Shoulder', v(0.08 * sx, 0, 0)],
      [side + 'LowerArm', side + 'UpperArm', v(0.24 * sx, 0, 0)], [side + 'Hand', side + 'LowerArm', v(0.22 * sx, 0, 0)],
      [side + 'UpperLeg', 'hips', v(0.08 * sx, -0.05, 0)], [side + 'LowerLeg', side + 'UpperLeg', v(0, -0.4, 0)],
      [side + 'Foot', side + 'LowerLeg', v(0, -0.38, 0)],
    )
  }
  const { root, bones } = buildSkeleton(spec)
  const humanoid = new VRMHumanoid(/** @type {any} */ (Object.fromEntries(Object.entries(bones).map(([k, node]) => [k, { node }]))))
  root.add(humanoid.normalizedHumanBonesRoot)
  // Come fa l'app: il VRM 0.x si gira di mezzo giro verso la camera.
  if (metaVersion === '0') root.rotation.y = Math.PI
  root.updateMatrixWorld(true)
  return /** @type {any} */ ({ scene: root, humanoid, meta: { metaVersion }, bones, update() { humanoid.update() } })
}
