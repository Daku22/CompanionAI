// vrm-animation.js — animazioni procedurali per gli avatar VRM.
//
// I file .vrm del progetto non contengono clip di animazione, quindi le pose
// sono calcolate. Prima di questo modulo la modalita' 3D rispondeva ai trigger
// dell'AI solo con le espressioni facciali, e la posa di riposo veniva
// riapplicata a ogni frame: nessun movimento del corpo era possibile, cioe'
// scegliere un avatar 3D disattivava in silenzio le animazioni contestuali.
//
// Il modulo e' separato da companion.html per due motivi: dentro un HTML da
// milleduecento righe questa logica non sarebbe verificabile, e tenere il
// player lontano dai numeri delle pose rende ovvio dove mettere le mani.
//
// Per ritoccare un movimento si cambiano i valori in CLIPS: sono radianti, e
// ampiezze fra 0.1 e 0.7 coprono quasi tutti i casi.
//
// Non dipende da three: le ossa arrivano da un accessor, cosi' il modulo si
// testa da Node con oggetti finti (vedi scripts/test-animation.js).

// Posa di riposo: braccia lungo i fianchi invece della T-pose di default.
export const REST_POSE = {
  rightUpperArm: { z: -1.22 },
  leftUpperArm:  { z:  1.22 },
  rightLowerArm: { y: -0.15 },
  leftLowerArm:  { y:  0.15 },
}

// duration 0 = ciclica finche' non arriva un altro trigger.
// pose(t) restituisce SOLO gli scostamenti dalla posa di riposo.
export const CLIPS = {
  idle: {
    duration: 0,
    pose: (t) => ({
      chest: { x: Math.sin(t * 2.0) * 0.03, y: Math.cos(t * 1.2) * 0.015 },
      head:  { y: Math.sin(t * 0.7) * 0.05 },
    }),
  },
  wave: {
    duration: 2.6,
    pose: (t) => ({
      rightUpperArm: { z: 1.00, x: -0.20 },
      rightLowerArm: { z: Math.sin(t * 7.0) * 0.40 - 0.20 },
      head:  { z: 0.07 },
      chest: { x: Math.sin(t * 2.0) * 0.03 },
    }),
  },
  think: {
    duration: 3.2,
    pose: (t) => ({
      rightUpperArm: { z: 0.45, x: -0.35 },
      rightLowerArm: { z: 1.15, y: -0.35 },
      head:  { x: 0.16, z: -0.10 + Math.sin(t * 1.4) * 0.03 },
      chest: { x: Math.sin(t * 1.6) * 0.02 },
    }),
  },
  'walk-to': {
    duration: 0,
    pose: (t) => {
      const s = Math.sin(t * 6.0)
      const c = Math.cos(t * 6.0)
      return {
        leftUpperLeg:  { x:  s * 0.42 },
        rightUpperLeg: { x: -s * 0.42 },
        leftLowerLeg:  { x: Math.max(0, -s) * 0.55 },
        rightLowerLeg: { x: Math.max(0,  s) * 0.55 },
        leftUpperArm:  { x: -s * 0.30 },
        rightUpperArm: { x:  s * 0.30 },
        spine: { x: 0.05 },
        hips:  { y: Math.abs(c) * 0.02 },
      }
    },
  },
  'run-to': {
    duration: 0,
    pose: (t) => {
      const s = Math.sin(t * 10.0)
      const c = Math.cos(t * 10.0)
      return {
        leftUpperLeg:  { x:  s * 0.72 },
        rightUpperLeg: { x: -s * 0.72 },
        leftLowerLeg:  { x: Math.max(0, -s) * 0.95 },
        rightLowerLeg: { x: Math.max(0,  s) * 0.95 },
        leftUpperArm:  { x: -s * 0.65, z: -0.25 },
        rightUpperArm: { x:  s * 0.65, z:  0.25 },
        leftLowerArm:  { x: -0.90 },
        rightLowerArm: { x: -0.90 },
        spine: { x: 0.16 },
        hips:  { y: Math.abs(c) * 0.035 },
      }
    },
  },
  sit: {
    duration: 0,
    pose: (t) => ({
      leftUpperLeg:  { x: -1.45 },
      rightUpperLeg: { x: -1.45 },
      leftLowerLeg:  { x:  1.35 },
      rightLowerLeg: { x:  1.35 },
      leftUpperArm:  { z: -0.18 },
      rightUpperArm: { z:  0.18 },
      spine: { x: 0.08 },
      chest: { x: Math.sin(t * 1.8) * 0.025 },
    }),
  },
  smoke: {
    duration: 4.0,
    pose: (t) => {
      // Porta la mano alla bocca, la tiene, poi la riabbassa.
      const cycle = (Math.sin(t * 1.2 - Math.PI / 2) + 1) / 2
      return {
        rightUpperArm: { z: 0.62 * cycle, x: -0.30 * cycle },
        rightLowerArm: { z: 1.30 * cycle },
        head:  { x: 0.06 * cycle },
        chest: { x: Math.sin(t * 2.0) * 0.03 },
      }
    },
  },
  happy: {
    duration: 2.0,
    pose: (t) => {
      const bounce = Math.abs(Math.sin(t * 5.0))
      return {
        leftUpperArm:  { z: -0.85, x: -0.25 },
        rightUpperArm: { z:  0.85, x: -0.25 },
        hips:  { y: bounce * 0.05 },
        head:  { x: -0.08 },
        chest: { x: -0.05 },
      }
    },
  },
  click: {
    duration: 1.2,
    pose: (t) => ({
      rightUpperArm: { z: 0.55, x: -0.55 },
      rightLowerArm: { z: 0.35, x: Math.sin(t * 9.0) * 0.20 },
      head: { x: 0.10 },
    }),
  },
  search: {
    duration: 2.8,
    pose: (t) => ({
      rightUpperArm: { z: 0.30, x: -0.45 },
      rightLowerArm: { z: 0.90 },
      head:  { y: Math.sin(t * 1.8) * 0.35 },
      chest: { y: Math.sin(t * 1.8) * 0.10 },
    }),
  },
}

// Nomi alternativi usati dall'AI e dalla chat, ricondotti alle clip reali.
export const CLIP_ALIAS = {
  idle: 'idle', none: 'idle', relaxed: 'idle',
  wave: 'wave', hello: 'wave',
  think: 'think',
  walk: 'walk-to', 'walk-to': 'walk-to',
  run: 'run-to', 'run-to': 'run-to',
  sit: 'sit',
  smoke: 'smoke',
  happy: 'happy',
  click: 'click',
  search: 'search', scroll: 'search', 'open-file': 'search',
}

// Ossa che il player tocca. Vengono riscritte a ogni frame, cosi' una clip non
// puo' lasciare residui su quella successiva.
export const TOUCHED_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
]

const BLEND_IN_S  = 0.25
const BLEND_OUT_S = 0.35
const FACING_YAW  = 0.55   // quanto si gira verso la direzione di marcia

// Le pose di CLIPS e REST_POSE sono scritte nella convenzione VRM 0.x. I due
// formati differiscono per un mezzo giro attorno a Y: un VRM 0.x guarda verso
// -Z e va girato per stare di fronte alla camera, un VRM 1.0 guarda gia' verso
// +Z. Lo stesso mezzo giro specchia gli assi x e z delle ossa normalizzate,
// come nell'esempio Mixamo ufficiale di three-vrm. Prima ogni modello veniva
// trattato come 0.x: Fred, che e' un 1.0, compariva di spalle e con le braccia
// alzate invece che lungo i fianchi.
export function isVRM0(vrm) {
  const version = vrm && vrm.meta && vrm.meta.metaVersion
  return version === undefined || version === '0'
}

/** Imbardata di base perche' il modello guardi la camera. */
export function baseYaw(vrm) {
  return isVRM0(vrm) ? Math.PI : 0
}

/** Fonde la posa base idle con la clip attiva, secondo il peso. */
export function mergePose(basePose, clipPose, weight) {
  const merged = {}
  for (const key of Object.keys(basePose)) merged[key] = { ...basePose[key] }
  for (const key of Object.keys(clipPose)) {
    merged[key] = merged[key] || {}
    for (const axis of ['x', 'y', 'z']) {
      if (clipPose[key][axis] === undefined) continue
      merged[key][axis] = (merged[key][axis] || 0) * (1 - weight) + clipPose[key][axis] * weight
    }
  }
  return merged
}

/**
 * Crea un player di animazione.
 * @param {(vrm: any, bone: string) => any} [getBone] accessor delle ossa;
 *        il default legge lo humanoid VRM. Sostituibile nei test.
 */
export function createVRMAnimator(getBone) {
  const bone = getBone || ((vrm, name) =>
    (vrm && vrm.humanoid) ? vrm.humanoid.getNormalizedBoneNode(name) : null)

  let clipName     = 'idle'
  let clipElapsed  = 0
  let clipWeight   = 0
  let clipEnding   = false
  let facingYaw    = 0
  let facingTarget = 0

  function applyPose(vrm, offsets) {
    const mirror = isVRM0(vrm) ? 1 : -1
    for (const name of TOUCHED_BONES) {
      const node = bone(vrm, name)
      if (!node) continue
      const rest = REST_POSE[name] || {}
      const off  = offsets[name] || {}
      node.rotation.x = ((rest.x || 0) + (off.x || 0)) * mirror
      node.rotation.y = (rest.y || 0) + (off.y || 0)
      node.rotation.z = ((rest.z || 0) + (off.z || 0)) * mirror
    }
    // Per il bacino "y" nelle clip significa un sobbalzo verticale, non una
    // rotazione: va sulla posizione, non sull'angolo.
    const hips = bone(vrm, 'hips')
    if (hips) {
      hips.rotation.y = 0
      if (hips.userData && hips.userData.__baseY === undefined) {
        hips.userData.__baseY = hips.position.y
      }
      const baseY = (hips.userData && hips.userData.__baseY) || 0
      hips.position.y = baseY + ((offsets.hips && offsets.hips.y) || 0)
    }
  }

  return {
    /** Avvia una clip per nome o alias. Sconosciuto significa idle. */
    play(name) {
      const resolved = CLIP_ALIAS[name] || 'idle'
      if (resolved === clipName && !clipEnding) return resolved
      clipName    = resolved
      clipElapsed = 0
      clipEnding  = false
      // Il peso riparte da zero: senza, la clip nuova entrerebbe di scatto al
      // peso pieno ereditato dalla precedente e la fusione non servirebbe.
      clipWeight  = 0
      if (resolved === 'idle') facingTarget = 0
      return resolved
    },

    /** Verso della marcia deciso dal processo main: 1 destra, -1 sinistra. */
    setFacing(dir) {
      if (dir === 1 || dir === -1) facingTarget = dir * FACING_YAW
    },

    /** Riporta l'avatar alla sola posa di riposo. */
    reset(vrm) {
      clipName = 'idle'; clipElapsed = 0; clipWeight = 0; clipEnding = false
      facingYaw = 0; facingTarget = 0
      applyPose(vrm, {})
    },

    /** Avanza di delta secondi e scrive la posa sulle ossa. */
    update(vrm, delta) {
      const clip = CLIPS[clipName] || CLIPS.idle
      clipElapsed += delta
      if (clip.duration > 0 && clipElapsed >= clip.duration) clipEnding = true

      const target = clipEnding ? 0 : 1
      const rate   = target > clipWeight ? delta / BLEND_IN_S : delta / BLEND_OUT_S
      clipWeight  += Math.sign(target - clipWeight) * Math.min(rate, Math.abs(target - clipWeight))

      if (clipEnding && clipWeight <= 0.001) {
        clipName = 'idle'; clipElapsed = 0; clipEnding = false; clipWeight = 0
      }

      const active   = CLIPS[clipName] || CLIPS.idle
      const basePose = CLIPS.idle.pose(clipElapsed)
      const clipPose = clipName === 'idle' ? {} : active.pose(clipElapsed)
      const pose     = mergePose(basePose, clipPose, clipWeight)

      applyPose(vrm, pose)

      facingYaw += (facingTarget - facingYaw) * Math.min(1, delta * 6)
      if (vrm && vrm.scene) vrm.scene.rotation.y = baseYaw(vrm) + facingYaw

      return { clip: clipName, weight: clipWeight, yaw: facingYaw, pose }
    },

    /** Stato interno, per i test. */
    debug() {
      return { clipName, clipElapsed, clipWeight, clipEnding, facingYaw, facingTarget }
    },
  }
}
