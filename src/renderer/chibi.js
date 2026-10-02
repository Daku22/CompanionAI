// chibi.js — testa grande e corpo piccolo, per gli avatar 3D umanoidi (Blocco 5d).
//
// Si scalano le ossa vere (raw) del modello: il bacino rimpicciolisce tutto il
// corpo, gambe comprese, e la testa si ingrandisce. La scala di un osso passa
// ai figli, quindi quella della testa si compensa lungo la catena: dentro un
// corpo a 0,8 la testa a 1,5 nel mondo vuole 1,5 / 0,8 in locale.
//
// Il bacino lo posiziona three-vrm a ogni frame, copiando quello dello
// scheletro normalizzato (dove girano pose e clip): anche la radice di quello
// prende la scala del corpo. Cosi' il bacino scende quanto si accorciano le
// gambe, i piedi restano a terra, e sedersi o saltellare spostano il bacino
// in proporzione.
//
// Capelli e vestiti (spring bone): la lunghezza dei giunti three-vrm la legge
// dalla posizione nel mondo, ma i raggi delle sfere di collisione no. Si
// scalano con l'osso a cui sono attaccati, poi le catene ripartono da ferme.
//
// Nessun import di three: le ossa si toccano attraverso scale, matrixWorld e i
// metodi di Object3D, e chibiScales si prova da Node.

export const CHIBI = { HEAD: 1.7, BODY: 0.7 }

// Il genitore di ogni osso umanoide (specifica VRM), senza le dita. Un osso
// facoltativo che manca si salta: il genitore e' il primo che c'e'.
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftEye: 'head', rightEye: 'head', jaw: 'head',
  leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot',
}

/**
 * Scale locali delle ossa per il chibi, date le ossa umanoidi del modello.
 * Ogni osso con una scala voluta nel mondo (bacino: corpo; testa) riceve in
 * locale quella divisa per le scale dei suoi antenati.
 * @param {Iterable<string> | Record<string, unknown>} boneMap ossa presenti
 *        (nomi, o una mappa nome -> nodo)
 * @param {{ head?: number, body?: number }} [options]
 * @returns {{ bones: Record<string, number>, root: number, headRatio: number } | null}
 *          bones: per quanto moltiplicare la scala locale di ogni osso; root:
 *          la scala della radice delle ossa normalizzate; headRatio: la testa
 *          rispetto al corpo, per le zone dei tocchi. null senza bacino o testa.
 */
export function chibiScales(boneMap, { head = CHIBI.HEAD, body = CHIBI.BODY } = {}) {
  const names = boneMap && typeof boneMap[Symbol.iterator] === 'function'
    ? new Set(/** @type {Iterable<string>} */ (boneMap))
    : new Set(Object.entries(boneMap || {}).filter(([, node]) => node).map(([name]) => name))
  if (!names.has('hips') || !names.has('head')) return null
  if (!(head > 0) || !(body > 0)) return null
  /** @type {Record<string, number>} */
  const world = { hips: body, head }
  /** @type {Record<string, number>} */
  const bones = {}
  // Il bacino prima della testa: la compensazione legge le scale degli antenati.
  for (const name of ['hips', 'head']) {
    let inherited = 1
    for (let p = PARENT[name]; p; p = PARENT[p]) if (bones[p]) inherited *= bones[p]
    bones[name] = world[name] / inherited
  }
  return { bones, root: body, headRatio: head / body }
}

// ─── Sulle ossa vere ───────────────────────────────────────────────────────
// Lo stato originale di ogni modello: scale delle ossa, della radice, raggi.
const applied = new WeakMap()

const worldScale = (node) => {
  const e = node.matrixWorld.elements
  return Math.hypot(e[0], e[1], e[2]) || 1
}

/** Le ossa umanoidi vere del modello, per nome (solo quelle che ci sono). */
function rawBones(humanoid) {
  /** @type {Record<string, any>} */
  const out = {}
  for (const name of Object.keys(PARENT)) {
    const node = humanoid.getRawBoneNode(name)
    if (node) out[name] = node
  }
  return out
}

/** Raggi delle collisioni dei capelli: [oggetto, campo, valore, scala del suo osso]. */
function springRadii(vrm) {
  const sbm = vrm.springBoneManager
  if (!sbm) return []
  const out = []
  for (const collider of sbm.colliders || []) {
    if (collider.shape && typeof collider.shape.radius === 'number') out.push([collider.shape, 'radius', collider.shape.radius, collider])
  }
  for (const joint of sbm.joints || []) {
    if (joint.settings && typeof joint.settings.hitRadius === 'number') out.push([joint.settings, 'hitRadius', joint.settings.hitRadius, joint.bone])
  }
  return out
}

/** Bacino, matrici e capelli dopo un cambio di scala. */
function settle(vrm) {
  vrm.humanoid.update()
  vrm.scene.updateMatrixWorld(true)
}

/**
 * Accende o spegne il chibi su un modello caricato.
 * @returns {boolean} se il modello lo permette (serve l'umanoide)
 */
export function setChibi(vrm, on, options) {
  const humanoid = vrm && vrm.humanoid
  if (!humanoid || !humanoid.normalizedHumanBonesRoot) return false
  const saved = applied.get(vrm)
  if (!on) {
    if (!saved) return true
    for (const [node, scale] of saved.scales) node.scale.copy(scale)
    for (const [target, key, value] of saved.radii) target[key] = value
    applied.delete(vrm)
    settle(vrm)
    if (vrm.springBoneManager) vrm.springBoneManager.reset()
    return true
  }
  if (saved) return true
  const bones = rawBones(humanoid)
  const plan = chibiScales(bones, options)
  if (!plan) return false
  vrm.scene.updateMatrixWorld(true)
  const radii = springRadii(vrm).map(([target, key, value, node]) => [target, key, value, node, worldScale(node)])
  const root = humanoid.normalizedHumanBonesRoot
  const scales = [[root, root.scale.clone()], ...Object.keys(plan.bones).map(name => [bones[name], bones[name].scale.clone()])]
  for (const [name, factor] of Object.entries(plan.bones)) bones[name].scale.multiplyScalar(factor)
  root.scale.multiplyScalar(plan.root)
  settle(vrm)
  // Ogni raggio cresce o cala con il suo osso, misurato prima e dopo.
  for (const [target, key, value, node, before] of radii) target[key] = value * worldScale(node) / before
  applied.set(vrm, { scales, radii, plan })
  if (vrm.springBoneManager) vrm.springBoneManager.reset()
  return true
}

/** Il chibi attivo su questo modello: { bones, root, headRatio }, o null. */
export function chibiOf(vrm) {
  const saved = vrm && applied.get(vrm)
  return saved ? saved.plan : null
}
