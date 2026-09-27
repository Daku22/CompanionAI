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
  // Seduto su un bordo (finestra, taskbar): come sit, con le gambe che dondolano.
  'sit-edge': {
    duration: 0,
    pose: (t) => ({
      leftUpperLeg:  { x: -1.45 },
      rightUpperLeg: { x: -1.45 },
      leftLowerLeg:  { x: 1.25 + Math.sin(t * 1.7) * 0.22 },
      rightLowerLeg: { x: 1.25 - Math.sin(t * 1.7) * 0.22 },
      leftUpperArm:  { z: -0.18 },
      rightUpperArm: { z:  0.18 },
      spine: { x: 0.08 },
      chest: { x: Math.sin(t * 1.8) * 0.025 },
    }),
  },
  // Braccia in alto, busto all'indietro, e giu' di nuovo.
  stretch: {
    duration: 3.2,
    pose: (t) => {
      const c = Math.sin(Math.PI * Math.min(1, t / 3.2))
      return {
        rightUpperArm: { z: 2.3 * c, x: -0.1 * c },
        leftUpperArm:  { z: -2.3 * c, x: -0.1 * c },
        rightLowerArm: { z: 0.2 * c },
        leftLowerArm:  { z: -0.2 * c },
        chest: { x: -0.1 * c },
        head:  { x: 0.15 * c },
      }
    },
  },
  // Mano alla bocca e testa all'indietro.
  yawn: {
    duration: 2.8,
    pose: (t) => {
      const c = Math.sin(Math.PI * Math.min(1, t / 2.8))
      return {
        rightUpperArm: { z: 0.62 * c, x: -0.30 * c },
        rightLowerArm: { z: 1.30 * c },
        head:  { x: 0.25 * c },
        chest: { x: -0.05 * c },
      }
    },
  },
  // Sonnecchia in piedi: testa che ciondola.
  doze: {
    duration: 0,
    pose: (t) => ({
      head:  { x: -0.35 + Math.sin(t * 0.8) * 0.04, z: 0.06 },
      chest: { x: Math.sin(t * 1.1) * 0.02 },
    }),
  },
  dance: {
    duration: 0,
    pose: (t) => {
      const s = Math.sin(t * 4.0)
      return {
        hips:  { y: Math.abs(s) * 0.04 },
        chest: { y: s * 0.15 },
        rightUpperArm: { z: 0.5 + 0.4 * s },
        leftUpperArm:  { z: -(0.5 - 0.4 * s) },
        head:  { z: s * 0.08 },
      }
    },
  },
  // Preso in braccio: gambe che penzolano sciolte, braccia un po' aperte.
  // Ripiego procedurale finche' la Fase C non porta una clip vera.
  dangle: {
    duration: 0,
    pose: (t) => {
      const s = Math.sin(t * 2.4)
      return {
        leftUpperLeg:  { x: -0.18 + s * 0.08, z:  0.05 },
        rightUpperLeg: { x: -0.10 - s * 0.08, z: -0.05 },
        leftLowerLeg:  { x: 0.40 + s * 0.06 },
        rightLowerLeg: { x: 0.30 - s * 0.06 },
        leftUpperArm:  { z: -0.12, x: -0.10 },
        rightUpperArm: { z:  0.12, x: -0.10 },
        spine: { x: 0.04 },
      }
    },
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
  drag: 'dangle', dangle: 'dangle',
  'sit-edge': 'sit-edge', stretch: 'stretch', yawn: 'yawn',
  doze: 'doze', sleep: 'doze', dance: 'dance',
}

// Ossa che il player tocca. Vengono riscritte a ogni frame, cosi' una clip non
// puo' lasciare residui su quella successiva.
export const TOUCHED_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
]

// ─── Sguardo che segue il mouse ────────────────────────────────────────────
// Limiti e ripartizione fra busto, collo e testa come li descrive Mate Engine
// (AvatarMouseTracking: testa ±45° di lato e ±30° in verticale, busto ±15°);
// numeri presi come idea, codice nostro. Gli angoli sono nella convenzione
// delle pose (VRM 0.x): y positivo gira il volto verso la destra dello
// schermo, x positivo lo alza. applyPose li specchia per i VRM 1.0.

const DEG = Math.PI / 180
export const LOOK_LIMITS = {
  headYaw: 45 * DEG, headPitch: 30 * DEG,
  spineYaw: 15 * DEG, spinePitch: 8 * DEG,
}
// Quanto segue il mouse durante ogni clip: pieno a riposo, per niente mentre
// cammina, siede o penzola, dove girare la testa sembrerebbe un difetto.
export const LOOK_WEIGHT = { idle: 1, wave: 0.6, happy: 0.6, think: 0.3, smoke: 0.3, click: 0.5 }
const LOOK_RATE = 7          // inseguimento del bersaglio, 1/s
const LOOK_WEIGHT_RATE = 3   // entrata e uscita del peso, 1/s

const clampAbs = (v, lim) => Math.max(-lim, Math.min(lim, v))

/**
 * Ripartisce l'orientamento verso il cursore fra busto, collo e testa.
 * @param {number} yaw radianti, positivo verso la destra dello schermo
 * @param {number} pitch radianti, positivo verso l'alto
 */
export function distributeLook(yaw, pitch) {
  const spineYaw = clampAbs(yaw * 0.25, LOOK_LIMITS.spineYaw)
  const spinePitch = clampAbs(pitch * 0.2, LOOK_LIMITS.spinePitch)
  const headYaw = clampAbs(yaw - spineYaw, LOOK_LIMITS.headYaw)
  const headPitch = clampAbs(pitch - spinePitch, LOOK_LIMITS.headPitch)
  return {
    spine: { x: spinePitch, y: spineYaw },
    neck:  { x: headPitch * 0.4, y: headYaw * 0.4 },
    head:  { x: headPitch * 0.6, y: headYaw * 0.6 },
  }
}

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
  let clipDuration = null   // durata della clip .vrma, se c'e': prevale su CLIPS
  let clipElapsed  = 0
  let clipWeight   = 0
  let clipEnding   = false
  let facingYaw    = 0
  let facingTarget = 0
  let lookTarget   = { yaw: 0, pitch: 0 }
  let look         = { yaw: 0, pitch: 0 }
  let lookWeight   = 0
  let lookEnabled  = false

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
    /** Nome della clip per un nome o alias, senza avviarla. */
    resolve(name) { return CLIP_ALIAS[name] || 'idle' },

    /**
     * Avvia una clip per nome o alias. Sconosciuto significa idle.
     * @param {string} name
     * @param {{ duration?: number }} [options] durata della clip .vrma che la
     *        riproduce (clip-layer.js): il player torna a idle quando finisce lei
     */
    play(name, options = {}) {
      const duration = options.duration
      const resolved = CLIP_ALIAS[name] || 'idle'
      if (resolved === clipName && !clipEnding) return resolved
      clipName    = resolved
      clipDuration = Number.isFinite(duration) && duration > 0 ? duration : null
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

    /**
     * Dove sta il cursore, come angoli dalla testa (vedi distributeLook).
     * Valori non finiti vengono ignorati.
     */
    setLook(yaw, pitch) {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return
      lookTarget = { yaw, pitch }
    },

    /** Accende o spegne lo sguardo che segue il mouse, con dissolvenza. */
    setLookEnabled(enabled) { lookEnabled = enabled === true },

    /** Riporta l'avatar alla sola posa di riposo. */
    reset(vrm) {
      clipName = 'idle'; clipElapsed = 0; clipWeight = 0; clipEnding = false; clipDuration = null
      facingYaw = 0; facingTarget = 0
      look = { yaw: 0, pitch: 0 }; lookWeight = 0
      applyPose(vrm, {})
    },

    /**
     * Avanza di delta secondi e scrive la posa sulle ossa.
     * @param {{ applyLook?: boolean }} [options] applyLook false: lo sguardo
     *        non entra nella posa ma torna in lookParts, per applicarlo sopra
     *        una clip .vrma (clip-layer.js)
     */
    update(vrm, delta, options = {}) {
      const applyLook = options.applyLook !== false
      const clip = CLIPS[clipName] || CLIPS.idle
      const duration = clipDuration !== null ? clipDuration : clip.duration
      clipElapsed += delta
      if (duration > 0 && clipElapsed >= duration) clipEnding = true

      const target = clipEnding ? 0 : 1
      const rate   = target > clipWeight ? delta / BLEND_IN_S : delta / BLEND_OUT_S
      clipWeight  += Math.sign(target - clipWeight) * Math.min(rate, Math.abs(target - clipWeight))

      if (clipEnding && clipWeight <= 0.001) {
        clipName = 'idle'; clipElapsed = 0; clipEnding = false; clipWeight = 0; clipDuration = null
      }

      const active   = CLIPS[clipName] || CLIPS.idle
      const basePose = CLIPS.idle.pose(clipElapsed)
      const clipPose = clipName === 'idle' ? {} : active.pose(clipElapsed)
      const pose     = mergePose(basePose, clipPose, clipWeight)

      // Lo sguardo si somma alla clip: la testa segue il mouse anche mentre
      // saluta, ma il peso dipende dalla clip in corso.
      const lookRate = Math.min(1, delta * LOOK_RATE)
      look.yaw   += (lookTarget.yaw - look.yaw) * lookRate
      look.pitch += (lookTarget.pitch - look.pitch) * lookRate
      const wTarget = lookEnabled ? (LOOK_WEIGHT[clipName] || 0) : 0
      lookWeight += (wTarget - lookWeight) * Math.min(1, delta * LOOK_WEIGHT_RATE)
      const lookParts = lookWeight > 0.001 ? distributeLook(look.yaw * lookWeight, look.pitch * lookWeight) : null
      if (lookParts && applyLook) {
        const parts = lookParts
        for (const [name, add] of Object.entries(parts)) {
          const p = pose[name] = pose[name] || {}
          p.x = (p.x || 0) + add.x
          p.y = (p.y || 0) + add.y
        }
      }

      applyPose(vrm, pose)

      facingYaw += (facingTarget - facingYaw) * Math.min(1, delta * 6)
      if (vrm && vrm.scene) vrm.scene.rotation.y = baseYaw(vrm) + facingYaw

      return { clip: clipName, ending: clipEnding, weight: clipWeight, yaw: facingYaw, pose, lookWeight, lookParts }
    },

    /** Stato interno, per i test. */
    debug() {
      return { clipName, clipElapsed, clipWeight, clipEnding, facingYaw, facingTarget, look, lookWeight }
    },
  }
}

// ─── Occhi e volto ─────────────────────────────────────────────────────────
// Prima il battito di ciglia era un Math.random() < 0.015 a ogni frame: a
// 144 Hz l'avatar sbatteva le palpebre quasi cinque volte piu' spesso che a
// 30. Qui tutto dipende dal tempo trascorso, non dal numero di frame. I tempi
// (un battito ogni 1-6 s, lungo 0,2 s, a forma di seno) vengono da airi
// (packages/stage-ui-three, MIT); il codice e' riscritto.

const BLINK_MIN_S      = 1
const BLINK_MAX_S      = 6
const BLINK_DURATION_S = 0.2

/**
 * Battito di ciglia a tempo. update(delta) restituisce il peso di "blink".
 * @param {() => number} [rand]
 */
export function createBlinker(rand = Math.random) {
  const nextWait = () => BLINK_MIN_S + rand() * (BLINK_MAX_S - BLINK_MIN_S)
  let wait = nextWait()
  let progress = -1   // -1 = occhi aperti, 0..1 = battito in corso
  return {
    update(delta) {
      if (progress < 0) {
        wait -= delta
        if (wait > 0) return 0
        // Il tempo avanzato oltre la scadenza conta gia' come battito.
        progress = -wait / BLINK_DURATION_S
      } else {
        progress += delta / BLINK_DURATION_S
      }
      if (progress >= 1) { progress = -1; wait = nextWait(); return 0 }
      return Math.sin(Math.PI * progress)
    },
  }
}

// Micro-movimenti dello sguardo: lo sguardo fisso sulla camera sembra vuoto.
// Intervalli esponenziali da 0,6 s in su, spostamenti di pochi centimetri
// attorno al bersaglio (la camera sta a circa 2,7 m).
const SACCADE_MIN_S  = 0.6
const SACCADE_MEAN_S = 1.2
const SACCADE_MAX_S  = 4
const GAZE_X_M = 0.12
const GAZE_Y_M = 0.06

/** Intervallo in secondi prima del prossimo spostamento dello sguardo. */
export function nextSaccade(rand = Math.random) {
  return Math.min(SACCADE_MAX_S, SACCADE_MIN_S - Math.log(1 - rand()) * SACCADE_MEAN_S)
}

/**
 * Sguardo che salta ogni tanto. update(delta) restituisce lo scostamento del
 * bersaglio in metri, costante fra un salto e l'altro.
 * @param {() => number} [rand]
 */
export function createGaze(rand = Math.random) {
  let wait = nextSaccade(rand)
  let offset = { x: 0, y: 0 }
  return {
    update(delta) {
      wait -= delta
      if (wait <= 0) {
        wait = nextSaccade(rand)
        offset = { x: (rand() - 0.5) * 2 * GAZE_X_M, y: (rand() - 0.5) * 2 * GAZE_Y_M }
      }
      return offset
    },
  }
}

// L'umore colora il volto sotto le reazioni: pesi bassi, mai piu' di MOOD_MAX,
// cosi' un'espressione di reazione a 1.0 resta ben distinguibile.
export const MOOD_MAX = 0.3
export const MOOD_EXPRESSIONS = ['happy', 'relaxed', 'sad', 'angry', 'surprised']

/**
 * Pesi delle espressioni VRM per lo stato d'animo (publicMood del main).
 * @param {{ emotions?: Record<string, number> } | null | undefined} mood
 * @returns {Record<string, number>}
 */
export function moodExpressions(mood) {
  const e = (mood && mood.emotions) || {}
  const w = (v) => Math.max(0, Math.min(MOOD_MAX, v))
  return {
    happy:     w(MOOD_MAX * (e.joy || 0) + 0.1 * (e.affection || 0)),
    relaxed:   w(MOOD_MAX * (e.calm || 0)),
    sad:       w(MOOD_MAX * (e.sadness || 0)),
    angry:     w(0.25 * (e.annoyance || 0)),
    surprised: w(0.15 * (e.curiosity || 0)),
  }
}
