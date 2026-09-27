// humanoid-map.js — riconosce le ossa umanoidi di uno scheletro qualsiasi.
//
// Un modello glTF o FBX, o una clip da convertire, arriva con i nomi delle
// ossa del programma che l'ha prodotto: "mixamorig:LeftForeArm" (Mixamo),
// "J_Bip_L_LowerArm" (VRoid), "lowerarm_l" (Unreal), "DEF-forearm.L" (Blender
// Rigify), "Bip01 L Forearm" (3ds Max), "LeftForeArm" (Kimodo, scheletro SOMA).
// Qui diventano i nomi dell'umanoide VRM (leftLowerArm), l'unico scheletro che
// il player conosce: cosi' una clip .vrma gira su qualunque di questi modelli.
//
// Il nome dice cosa e' un osso, la gerarchia dice in che ordine vengono: la
// colonna (spine, chest, upperChest) e le falangi si assegnano per profondita',
// perche' la numerazione cambia da un programma all'altro.
//
// Modulo puro, senza three: riceve [{ name, parent }] e si testa da Node.

/** Ossa senza le quali un umanoide non si anima (come nella specifica VRM). */
export const REQUIRED_BONES = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
]

// Ossa di servizio che non vanno mai scambiate per quelle del corpo.
const SKIP_TOKENS = new Set([
  'end', 'nub', 'twist', 'roll', 'ik', 'pole', 'target', 'ctrl', 'control', 'helper', 'socket',
  'dummy', 'null', 'mch', 'org', 'jiggle', 'prop', 'weapon', 'corrective', 'correction', 'tip',
  'top', 'attach', 'root',
])
// Prefissi e parole che non dicono nulla sul ruolo dell'osso.
// mixamorig resta attaccato al nome quando three toglie i due punti
// (PropertyBinding.sanitizeNodeName: mixamorig:LeftArm -> mixamorigLeftArm).
const NOISE_TOKENS = new Set(['mixamorig', 'j', 'bip', 'bip01', 'bip001', 'def', 'c', 'adj', 'b', 'bn', 'jnt', 'joint', 'bone', 'sk', 'cc', 'base', 'f'])
const LEFT = new Set(['left', 'l', 'lf'])
const RIGHT = new Set(['right', 'r', 'rt'])

const FINGERS = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Little', little: 'Little' }
const THUMB_SEGMENTS = ['Metacarpal', 'Proximal', 'Distal']
const FINGER_SEGMENTS = ['Proximal', 'Intermediate', 'Distal']

/** Spezza un nome in parole minuscole: "mixamorig:LeftUpLeg" -> left up leg. */
export function tokenize(name) {
  let s = String(name || '')
  // Spazio dei nomi di Mixamo, o armatura davanti al nome ("Armature|Hips").
  s = s.split(/[:|]/).pop()
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  s = s.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2')
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Cosa e' un osso, dal solo nome.
 * @returns {{ part: string, side: 'left'|'right'|null, finger?: string, number?: number, metacarpal?: boolean } | null}
 */
export function classify(name) {
  const tokens = tokenize(name)
  if (!tokens.length || tokens.some(t => SKIP_TOKENS.has(t))) return null
  /** @type {'left' | 'right' | null} */
  let side = null
  const words = []
  const numbers = []
  for (const t of tokens) {
    if (LEFT.has(t)) side = 'left'
    else if (RIGHT.has(t)) side = 'right'
    else if (/^\d+$/.test(t)) numbers.push(Number(t))
    else if (!NOISE_TOKENS.has(t)) words.push(t)
  }
  const s = words.join('')
  const number = numbers.length ? numbers[numbers.length - 1] : undefined
  if (!s) return null

  const finger = /(thumb|index|middle|ring|pinky|little)/.exec(s)
  if (finger) {
    const metacarpal = /meta(carpal)?/.test(s)
    return side ? { part: 'finger', side, finger: FINGERS[finger[1]], number, metacarpal } : null
  }
  if (/eye/.test(s) && !/(brow|lid|lash)/.test(s)) return side ? { part: 'eye', side } : null
  if (s === 'head') return { part: 'head', side: null }
  if (/^neck/.test(s)) return { part: 'neck', side: null }
  if (/(hips|^hip$|pelvis)/.test(s)) return side ? null : { part: 'hips', side: null }
  if (/(spine|chest|torso|abdomen|ribcage)/.test(s)) return side ? null : { part: 'spine', side: null }

  let part = null
  if (/(shoulder|clavicle|collar)/.test(s)) part = 'Shoulder'
  else if (/(forearm|lowerarm|elbow)/.test(s)) part = 'LowerArm'
  else if (/(upperarm|uparm)/.test(s) || s === 'arm') part = 'UpperArm'
  else if (/^hand$|wrist/.test(s)) part = 'Hand'
  else if (/(upleg|upperleg|thigh)/.test(s)) part = 'UpperLeg'
  else if (/(lowerleg|calf|shin|knee)/.test(s) || s === 'leg') part = 'LowerLeg'
  else if (/(toe|ball)/.test(s)) part = 'Toes'
  else if (/(foot|ankle)/.test(s)) part = 'Foot'
  if (!part || !side) return null
  return { part, side }
}

/**
 * Abbina uno scheletro all'umanoide VRM.
 * @param {{ name: string, parent: string | null }[]} bones ogni osso col nome del genitore
 * @returns {{ ok: boolean, bones: Record<string, string>, missing: string[] }}
 *          bones: nome VRM -> nome dell'osso nello scheletro dato
 */
export function mapHumanoid(bones) {
  const byName = new Map(bones.map(b => [b.name, b]))
  const children = new Map()
  for (const b of bones) {
    if (!children.has(b.parent)) children.set(b.parent, [])
    children.get(b.parent).push(b.name)
  }
  const depthCache = new Map()
  const depth = (name) => {
    if (depthCache.has(name)) return depthCache.get(name)
    let d = 0
    for (let b = byName.get(name); b && b.parent != null && d < 1000; b = byName.get(b.parent)) d++
    depthCache.set(name, d)
    return d
  }
  const isAncestor = (a, b) => {
    for (let n = byName.get(b); n && n.parent != null; n = byName.get(n.parent)) if (n.parent === a) return true
    return false
  }
  const isLeaf = (name) => !(children.get(name) || []).length

  // Rigify ha ossa di controllo e di deformazione con nomi simili: se ci sono
  // le DEF- contano solo quelle.
  const hasDef = bones.some(b => /^DEF[-_.]/i.test(b.name))
  const usable = hasDef ? bones.filter(b => /^DEF[-_.]/i.test(b.name)) : bones

  const slots = new Map()   // chiave -> [nomi]
  const metacarpals = new Set()
  const push = (key, name) => { if (!slots.has(key)) slots.set(key, []); slots.get(key).push(name) }
  for (const b of usable) {
    const c = classify(b.name)
    if (!c) continue
    if (c.part === 'finger') { push(c.side + c.finger, b.name); if (c.metacarpal) metacarpals.add(b.name) }
    else if (c.part === 'eye') push(c.side + 'Eye', b.name)
    else if (c.side) push(c.side + c.part, b.name)
    else push(c.part, b.name)
  }
  const byDepth = (list) => [...list].sort((a, b) => depth(a) - depth(b))
  const first = (key) => { const l = slots.get(key); return l && l.length ? byDepth(l)[0] : undefined }

  /** @type {Record<string, string>} */
  const out = {}
  const set = (vrmName, name) => { if (name !== undefined) out[vrmName] = name }
  set('hips', first('hips'))
  set('neck', first('neck'))
  set('head', first('head'))

  // Colonna: in ordine dal bacino in su. Spine/Spine1/Spine2 (Mixamo),
  // Spine/Chest/UpperChest (VRoid), Spine1/Spine2/Chest (SOMA), spine_01..05.
  let spine = byDepth(slots.get('spine') || [])
  // Rigify chiama spine anche bacino, collo e testa: spine (bacino), .001-.003
  // (colonna), .004-.005 (collo), .006 (testa).
  if (!out.hips && spine.length) out.hips = spine.shift()
  if (out.hips) spine = spine.filter(n => isAncestor(out.hips, n))
  if (!out.head && spine.length >= 5) {
    out.head = spine.pop()
    if (!out.neck) out.neck = spine[3]
    spine = spine.slice(0, 3)
  }
  if (out.head) spine = spine.filter(n => isAncestor(n, out.head))
  if (spine[0]) out.spine = spine[0]
  if (spine.length >= 2) out.chest = spine[1]
  if (spine.length >= 3) out.upperChest = spine[spine.length - 1]

  for (const side of ['left', 'right']) {
    for (const part of ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes']) {
      set(side + part, first(side + part))
    }
    // Kimodo (SOMA) chiama la coscia "Leg" e lo stinco "Shin": senza un nome
    // da coscia, di due candidati per lo stinco in catena il primo e' la coscia.
    for (const [upper, lower] of [['UpperLeg', 'LowerLeg'], ['UpperArm', 'LowerArm']]) {
      const candidates = byDepth(slots.get(side + lower) || [])
      if (!out[side + upper] && candidates.length >= 2 && isAncestor(candidates[0], candidates[1])) {
        out[side + upper] = candidates[0]
        out[side + lower] = candidates[1]
      }
    }
    set(side + 'Eye', first(side + 'Eye'))
    // Braccio e gamba devono essere catene vere: un "arm" che non contiene
    // l'avambraccio e' un osso d'aiuto, e rovinerebbe ogni clip.
    for (const [a, b] of [['UpperArm', 'LowerArm'], ['LowerArm', 'Hand'], ['UpperLeg', 'LowerLeg'], ['LowerLeg', 'Foot'], ['Shoulder', 'UpperArm']]) {
      if (out[side + a] && out[side + b] && !isAncestor(out[side + a], out[side + b])) {
        delete out[side + (a === 'Shoulder' ? 'Shoulder' : b)]
      }
    }
    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      let chain = byDepth(slots.get(side + finger) || [])
      // Il metacarpo delle altre dita non ha un posto nell'umanoide VRM: se
      // ha il nome (Unreal 5) si toglie; la punta senza figli e' un segnaposto
      // (Mixamo Index4). Il metacarpo senza nome (SOMA Index1) cade per ultimo,
      // tenendo le tre falangi piu' lontane dalla mano.
      if (finger !== 'Thumb') chain = chain.filter(n => !metacarpals.has(n))
      if (chain.length > 3) chain = chain.filter(n => !isLeaf(n))
      const names = finger === 'Thumb' ? THUMB_SEGMENTS : FINGER_SEGMENTS
      if (chain.length > 3) chain = chain.slice(chain.length - 3)
      chain.forEach((n, i) => { out[side + finger + names[i]] = n })
    }
  }

  // Nessun osso puo' coprire due ruoli.
  const seen = new Set()
  for (const [k, v] of Object.entries(out)) { if (seen.has(v)) delete out[k]; else seen.add(v) }

  const missing = REQUIRED_BONES.filter(n => !out[n])
  return { ok: missing.length === 0, bones: out, missing }
}
