// test-humanoid-map.mjs — riconoscimento delle ossa umanoidi da scheletri veri.
//
// Il riferimento migliore sono i VRM: dichiarano da soli quale osso e' quale.
// Si toglie la dichiarazione, si passa il solo scheletro e il risultato deve
// coincidere. Gli altri programmi si provano con scheletri scritti a mano con
// i loro nomi reali.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mapHumanoid, classify, tokenize, REQUIRED_BONES } from '../src/renderer/humanoid-map.js'

// argv[1] e non import.meta: il controllo dei tipi tratta gli script come CommonJS.
const ROOT = path.join(path.dirname(process.argv[1]), '..')

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

/** Scheletro da una lista [nome, genitore]. */
const skel = (pairs) => pairs.map(([name, parent]) => ({ name, parent: parent ?? null }))

/** Catena lineare: ogni osso figlio del precedente. */
function chain(names, parent) {
  const out = []
  let p = parent
  for (const n of names) { out.push([n, p]); p = n }
  return out
}

/** Legge nodi e dichiarazione umanoide da un .vrm (0.x o 1.0). */
function readVrm(file) {
  const b = fs.readFileSync(file)
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString())
  const parent = new Map()
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)))
  const bones = json.nodes.map((n, i) => ({ name: n.name, parent: parent.has(i) ? json.nodes[parent.get(i)].name : null }))
  const declared = {}
  if (json.extensions.VRMC_vrm) {
    for (const [k, v] of Object.entries(json.extensions.VRMC_vrm.humanoid.humanBones)) declared[k] = json.nodes[v.node].name
  } else {
    // VRM 0.x: nomi quasi uguali, pollice diverso (Intermediate -> Proximal).
    const rename = (n) => n.replace(/Thumb(Proximal|Intermediate)/, (m, s) => s === 'Proximal' ? 'ThumbMetacarpal' : 'ThumbProximal')
    for (const hb of json.extensions.VRM.humanoid.humanBones) declared[rename(hb.bone)] = json.nodes[hb.node].name
  }
  return { bones, declared }
}

function compareWithDeclared(file) {
  const { bones, declared } = readVrm(file)
  const found = mapHumanoid(bones)
  assert.ok(found.ok, 'mancano: ' + found.missing.join(', '))
  const wrong = Object.entries(declared)
    .filter(([k, v]) => found.bones[k] !== undefined && found.bones[k] !== v)
    .map(([k, v]) => k + ': atteso ' + v + ', trovato ' + found.bones[k])
  assert.deepEqual(wrong, [])
  for (const k of REQUIRED_BONES) assert.equal(found.bones[k], declared[k], k)
  return found
}

// ── Scheletri dei programmi piu' diffusi ─────────────────────────────────────

function mixamo(prefix = 'mixamorig:') {
  const n = (s) => prefix + s
  const pairs = [[n('Hips'), null], ...chain(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'].map(n), n('Hips'))]
  for (const side of ['Left', 'Right']) {
    pairs.push(...chain(['Shoulder', 'Arm', 'ForeArm', 'Hand'].map(s => n(side + s)), n('Spine2')))
    for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      pairs.push(...chain([1, 2, 3, 4].map(i => n(side + 'Hand' + f + i)), n(side + 'Hand')))
    }
    pairs.push(...chain(['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'].map(s => n(side + s)), n('Hips')))
  }
  return skel(pairs)
}

function unreal() {
  const pairs = [['root', null], ['pelvis', 'root'], ...chain(['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'head'], 'pelvis'),
    ['ik_hand_root', 'root'], ['ik_hand_l', 'ik_hand_root']]
  for (const s of ['l', 'r']) {
    pairs.push(...chain([`clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`], 'spine_05'))
    pairs.push([`upperarm_twist_01_${s}`, `upperarm_${s}`], [`lowerarm_twist_01_${s}`, `lowerarm_${s}`])
    pairs.push(...chain([`thumb_01_${s}`, `thumb_02_${s}`, `thumb_03_${s}`], `hand_${s}`))
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      pairs.push(...chain([`${f}_metacarpal_${s}`, `${f}_01_${s}`, `${f}_02_${s}`, `${f}_03_${s}`], `hand_${s}`))
    }
    pairs.push(...chain([`thigh_${s}`, `calf_${s}`, `foot_${s}`, `ball_${s}`], 'pelvis'))
    pairs.push([`thigh_twist_01_${s}`, `thigh_${s}`], [`calf_twist_01_${s}`, `calf_${s}`])
  }
  return skel(pairs)
}

function rigify() {
  const pairs = [['root', null], ['DEF-spine', 'root'], ...chain(['DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-spine.004', 'DEF-spine.005', 'DEF-spine.006'], 'DEF-spine'),
    ['ORG-spine', 'root'], ['MCH-torso.parent', 'root'], ['torso', 'root'], ['hips', 'torso'], ['chest', 'torso']]
  for (const s of ['L', 'R']) {
    pairs.push(...chain([`DEF-shoulder.${s}`, `DEF-upper_arm.${s}`, `DEF-upper_arm.${s}.001`, `DEF-forearm.${s}`, `DEF-forearm.${s}.001`, `DEF-hand.${s}`], 'DEF-spine.003'))
    pairs.push(...chain([`DEF-thumb.01.${s}`, `DEF-thumb.02.${s}`, `DEF-thumb.03.${s}`], `DEF-hand.${s}`))
    pairs.push(...chain([`DEF-f_index.01.${s}`, `DEF-f_index.02.${s}`, `DEF-f_index.03.${s}`], `DEF-hand.${s}`))
    pairs.push(...chain([`DEF-thigh.${s}`, `DEF-thigh.${s}.001`, `DEF-shin.${s}`, `DEF-shin.${s}.001`, `DEF-foot.${s}`, `DEF-toe.${s}`], 'DEF-spine'))
    pairs.push([`upper_arm_fk.${s}`, 'root'], [`hand_ik.${s}`, 'root'], [`thigh_fk.${s}`, 'root'])
  }
  return skel(pairs)
}

function biped() {
  const pairs = [['Bip01', null], ['Bip01 Pelvis', 'Bip01'], ...chain(['Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2', 'Bip01 Neck', 'Bip01 Head', 'Bip01 HeadNub'], 'Bip01 Pelvis')]
  for (const s of ['L', 'R']) {
    pairs.push(...chain([`Bip01 ${s} Clavicle`, `Bip01 ${s} UpperArm`, `Bip01 ${s} Forearm`, `Bip01 ${s} Hand`], 'Bip01 Neck'))
    pairs.push(...chain([`Bip01 ${s} Finger0`, `Bip01 ${s} Finger01`, `Bip01 ${s} Finger02`], `Bip01 ${s} Hand`))
    pairs.push(...chain([`Bip01 ${s} Thigh`, `Bip01 ${s} Calf`, `Bip01 ${s} Foot`, `Bip01 ${s} Toe0`], 'Bip01 Spine'))
  }
  return skel(pairs)
}

// SOMA 77 di Kimodo (kimodo/skeleton/definitions.py): nomi in stile Mixamo,
// senza prefisso, colonna Spine1/Spine2/Chest e falangi con il metacarpo.
function soma() {
  const pairs = [['Root', null], ['Hips', 'Root'], ...chain(['Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'HeadEnd'], 'Hips'),
    ['Jaw', 'Head'], ['LeftEye', 'Head'], ['RightEye', 'Head']]
  for (const s of ['Left', 'Right']) {
    pairs.push(...chain([`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`], 'Chest'))
    pairs.push(...chain([1, 2, 3].map(i => `${s}HandThumb${i}`).concat(`${s}HandThumbEnd`), `${s}Hand`))
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      pairs.push(...chain([1, 2, 3, 4].map(i => `${s}Hand${f}${i}`).concat(`${s}Hand${f}End`), `${s}Hand`))
    }
    pairs.push(...chain([`${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}Toe`, `${s}ToeEnd`], 'Hips'))
  }
  return skel(pairs)
}

console.log('=== Riconoscimento delle ossa umanoidi ===\n')

test('i nomi si spezzano in parole', () => {
  assert.deepEqual(tokenize('mixamorig:LeftUpLeg'), ['left', 'up', 'leg'])
  assert.deepEqual(tokenize('J_Bip_L_UpperArm'), ['j', 'bip', 'l', 'upper', 'arm'])
  assert.deepEqual(tokenize('DEF-upper_arm.L.001'), ['def', 'upper', 'arm', 'l', '001'])
  assert.deepEqual(tokenize('Bip01 R Forearm'), ['bip', '01', 'r', 'forearm'])
  assert.deepEqual(tokenize('Armature|spine_01'), ['spine', '01'])
  // Come lo lascia three dopo sanitizeNodeName.
  assert.deepEqual(classify('mixamorigLeftArm'), { part: 'UpperArm', side: 'left' })
})

test('ossa di servizio scartate', () => {
  for (const n of ['upperarm_twist_01_l', 'ik_hand_l', 'HeadTop_End', 'mixamorig:LeftToe_End', 'MCH-forearm_tweak.L', 'Bip01 HeadNub', 'root']) {
    assert.equal(classify(n), null, n)
  }
})

test('Fred (VRM 1.0): stesso abbinamento che dichiara il file', () => {
  compareWithDeclared(path.join(ROOT, 'modelli-3d', 'Fred', 'Fred_optimized.vrm'))
})

const privateDir = path.join(ROOT, 'private-assets')
const privateVrms = fs.existsSync(privateDir)
  ? fs.readdirSync(privateDir, { recursive: true }).map(String).filter(f => f.toLowerCase().endsWith('.vrm')).map(f => path.join(privateDir, f))
  : []
for (const file of privateVrms) {
  test(path.basename(file) + ' (privato): stesso abbinamento che dichiara il file', () => compareWithDeclared(file))
}

for (const [name, build, expect] of /** @type {[string, () => any, Record<string, string>][]} */ ([
  ['Mixamo', () => mixamo(), { leftUpperArm: 'mixamorig:LeftArm', leftLowerLeg: 'mixamorig:LeftLeg', chest: 'mixamorig:Spine1', upperChest: 'mixamorig:Spine2', leftIndexDistal: 'mixamorig:LeftHandIndex3', leftThumbMetacarpal: 'mixamorig:LeftHandThumb1' }],
  ['Mixamo con prefisso mixamorig1:', () => mixamo('mixamorig1:'), { rightHand: 'mixamorig1:RightHand' }],
  ['Unreal', unreal, { hips: 'pelvis', leftUpperArm: 'upperarm_l', leftLowerLeg: 'calf_l', leftToes: 'ball_l', neck: 'neck_01', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_05', leftIndexProximal: 'index_01_l' }],
  ['Blender Rigify', rigify, { hips: 'DEF-spine', spine: 'DEF-spine.001', neck: 'DEF-spine.004', head: 'DEF-spine.006', leftUpperArm: 'DEF-upper_arm.L', leftLowerArm: 'DEF-forearm.L', leftLowerLeg: 'DEF-shin.L' }],
  ['3ds Max Biped', biped, { hips: 'Bip01 Pelvis', leftUpperArm: 'Bip01 L UpperArm', rightLowerLeg: 'Bip01 R Calf' }],
  ['Kimodo SOMA', soma, { hips: 'Hips', spine: 'Spine1', chest: 'Spine2', upperChest: 'Chest', neck: 'Neck1', leftUpperArm: 'LeftArm', leftIndexProximal: 'LeftHandIndex2', leftIndexDistal: 'LeftHandIndex4', leftThumbDistal: 'LeftHandThumb3', leftEye: 'LeftEye' }],
])) {
  test(name + ': umanoide completo e ossa giuste', () => {
    const found = mapHumanoid(build())
    assert.ok(found.ok, 'mancano: ' + found.missing.join(', '))
    for (const [k, v] of Object.entries(expect)) assert.equal(found.bones[k], v, k)
    assert.equal(new Set(Object.values(found.bones)).size, Object.keys(found.bones).length, 'un osso in due ruoli')
  })
}

test('un modello senza scheletro umano non passa per umanoide', () => {
  const dog = skel([['root', null], ['body', 'root'], ['neck', 'body'], ['head', 'neck'], ['tail', 'body'],
    ['leg_front_l', 'body'], ['leg_front_r', 'body'], ['leg_back_l', 'body'], ['leg_back_r', 'body']])
  const found = mapHumanoid(dog)
  assert.equal(found.ok, false)
  assert.ok(found.missing.includes('hips'))
})

test('un braccio che non contiene l-avambraccio viene scartato', () => {
  const pairs = mixamo('').map(b => [b.name, b.parent])
  pairs.push(['LeftArmHelper', 'Hips'])
  const bones = skel(pairs.map(([n, p]) => n === 'LeftArm' ? ['LeftArmX', p] : [n, n === 'LeftForeArm' ? 'LeftArmX' : p]))
  const found = mapHumanoid(bones)
  assert.equal(found.bones.leftUpperArm, undefined)
  assert.equal(found.ok, false)
})

console.log('\n=== ' + passed + ' test superati ===')
