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

// Dita piegate appena, come una mano rilassata: lo scheletro normalizzato le
// ha tese come nella T-pose, e le mani sembravano di legno. z positivo piega
// verso il palmo a sinistra, negativo a destra (stessa convenzione delle
// braccia); il mignolo si piega piu' dell'indice.
const FINGER_CURL = {
  Index:  [0.15, 0.25, 0.20],
  Middle: [0.20, 0.30, 0.20],
  Ring:   [0.25, 0.35, 0.25],
  Little: [0.30, 0.40, 0.30],
}
const FINGER_JOINTS = ['Proximal', 'Intermediate', 'Distal']

function relaxedHands() {
  const pose = {}
  for (const [finger, curls] of Object.entries(FINGER_CURL)) {
    FINGER_JOINTS.forEach((joint, i) => {
      pose['left' + finger + joint] = { z: curls[i] }
      pose['right' + finger + joint] = { z: -curls[i] }
    })
  }
  return pose
}

// Posa di riposo: braccia lungo i fianchi invece della T-pose di default, e
// mani rilassate.
export const REST_POSE = {
  rightUpperArm: { z: -1.22 },
  leftUpperArm:  { z:  1.22 },
  rightLowerArm: { y: -0.15 },
  leftLowerArm:  { y:  0.15 },
  ...relaxedHands(),
}

// Slot dei movimenti generati: non ha file suoi nella libreria delle clip.
export const GENERATED = 'generated'

// La battuta della musica (Blocco 5c), da companion-dance.js: phase 0..1
// dentro la battuta, count le battute contate, amp l'ampiezza. null: niente
// musica, le pose vanno a tempo loro.
let danceBeat = null
export function setDanceBeat(beat) {
  danceBeat = beat && Number.isFinite(beat.phase) && Number.isFinite(beat.count) ? beat : null
}
// Sbircia dal bordo dello schermo (Blocco 5d): side 1 fuori dal bordo destro,
// -1 fuori dal sinistro; headRatio la testa rispetto al corpo (chibi).
const peek = { side: 1, headRatio: 1 }
export function setPeekSide(side, headRatio = 1) {
  peek.side = side === 'left' ? -1 : 1
  peek.headRatio = Number.isFinite(headRatio) && headRatio > 0 ? headRatio : 1
}

// Un ciclo ogni due battute (destra, sinistra): da -1 a 1.
const beatSway = (b) => Math.sin(Math.PI * (b.count + b.phase))
// Il colpo sulla battuta: 1 sulla battuta, 0 a meta'.
const beatBounce = (b) => Math.abs(Math.cos(Math.PI * b.phase))

// Seduto su un bordo: cosce in avanti, gambe che dondolano, bacino fermo, mani
// appoggiate sul bordo accanto ai fianchi. Per un arto che pende, x positivo
// lo porta in avanti (vedi applyPose): prima le cosce avevano -1.45 e andavano
// indietro, con il ginocchio piegato al contrario.
function sittingOnEdge(t) {
  // Con la musica le gambe dondolano a tempo e la testa annuisce sulla battuta.
  const b = danceBeat
  const swing = b ? beatSway(b) * 0.3 * b.amp : Math.sin(t * 1.7) * 0.22
  const nod = b ? -0.1 * beatBounce(b) * b.amp : 0
  return {
    head: { x: nod },
    leftUpperLeg:  { x: 1.45 },
    rightUpperLeg: { x: 1.45 },
    leftLowerLeg:  { x: -1.25 + swing },
    rightLowerLeg: { x: -1.25 - swing },
    leftUpperArm:  { x: 0.15, z: -0.08 },
    rightUpperArm: { x: 0.15, z:  0.08 },
    leftLowerArm:  { y: -0.25 },
    rightLowerArm: { y:  0.25 },
    spine: { x: 0.08 },
    chest: { x: Math.sin(t * 1.8) * 0.025 },
  }
}

// Curve per i gesti brevi. smooth: da 0 a 1 senza scatti; envelope: sale in
// `edge` secondi, tiene, scende negli ultimi `edge`; jolt: scatto rapido in
// `attack` secondi, poi si spegne con velocita' `rate`.
const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c) }
const envelope = (t, duration, edge) => smooth(t / edge) * smooth((duration - t) / edge)
const jolt = (t, attack, rate) => (t < attack ? t / attack : Math.exp(-(t - attack) * rate))

// Con il braccio lungo il fianco, x sull'omero lo porta avanti (positivo) o
// indietro, e y sull'avambraccio piega il gomito in avanti (positivo a
// destra, negativo a sinistra). z sull'avambraccio lo apre di lato: non e'
// il gomito. y sull'omero lo ruota verso l'interno (positivo a destra,
// negativo a sinistra) e porta le mani verso il centro. Verificato di
// fronte e di profilo su Fred (VRM 1.0).

// Mani davanti alla pancia, con peso c; flex piega il gomito (piu' alto =
// mani piu' in alto).
function handsInFront(c, flex = 1.35) {
  return {
    rightUpperArm: { x: 0.25 * c, z: -0.08 * c, y:  0.75 * c },
    leftUpperArm:  { x: 0.25 * c, z:  0.08 * c, y: -0.75 * c },
    rightLowerArm: { y:  flex * c },
    leftLowerArm:  { y: -flex * c },
  }
}

// Braccia incrociate sul petto, con peso c.
function crossedArms(c) {
  return {
    rightUpperArm: { x: 0.4 * c, z:  0.1 * c, y:  1.0 * c },
    leftUpperArm:  { x: 0.4 * c, z: -0.1 * c, y: -1.0 * c },
    rightLowerArm: { y:  1.9 * c },
    leftLowerArm:  { y: -1.9 * c },
    chest: { x: -0.04 * c },
  }
}

// duration 0 = ciclica finche' non arriva un altro trigger.
// pose(t) restituisce SOLO gli scostamenti dalla posa di riposo.
// yaw(t), facoltativo: rotazione di tutto il corpo attorno alla verticale
// (turnaway), sommata al verso della marcia e pesata come la clip.
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
      leftUpperLeg:  { x:  1.45 },
      rightUpperLeg: { x:  1.45 },
      leftLowerLeg:  { x: -1.35 },
      rightLowerLeg: { x: -1.35 },
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
    pose: (t) => sittingOnEdge(t),
  },
  // Seduto davvero su una finestra o sulla taskbar (perch.js). Stessa posa di
  // sit-edge, ma senza clip .vrma: quella di Kimodo e' "seduto su una sedia" e
  // abbassa il bacino, mentre qui il bacino deve restare sul bordo, al punto
  // di seduta misurato dal main.
  perch: {
    duration: 0,
    pose: (t) => sittingOnEdge(t),
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
  // Con la musica (danceBeat) va a tempo: sobbalzo sulla battuta, busto e
  // braccia da una parte all'altra ogni due battute. Senza, a tempo suo.
  dance: {
    duration: 0,
    pose: (t) => {
      const b = danceBeat
      const s = b ? beatSway(b) : Math.sin(t * 4.0)
      const bounce = b ? beatBounce(b) : Math.abs(s)
      const a = b ? b.amp : 1
      return {
        hips:  { y: bounce * 0.04 * a },
        chest: { y: s * 0.15 * a },
        rightUpperArm: { z: 0.5 + 0.4 * s * a },
        leftUpperArm:  { z: -(0.5 - 0.4 * s * a) },
        head:  { z: s * 0.08 * a, x: -0.05 * bounce * a },
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
  // ─── Reazioni ai tocchi (touch-react.js nel main, Blocco 5b) ─────────────
  // Ripieghi procedurali: le clip Kimodo, se ci sono, li sostituiscono.
  // Accarezzato: testa inclinata verso la mano, spalle che scendono.
  pat: {
    duration: 2.2,
    pose: (t) => {
      const c = envelope(t, 2.2, 0.35)
      return {
        head:  { z: (0.22 + Math.sin(t * 2.2) * 0.04) * c, x: -0.1 * c },
        neck:  { z: 0.05 * c },
        chest: { x: 0.04 * c },
        rightUpperArm: { z: -0.05 * c },
        leftUpperArm:  { z:  0.05 * c },
      }
    },
  },
  // Toccato sul viso: piccolo scatto indietro della testa.
  flinch: {
    duration: 1.0,
    pose: (t) => {
      const j = jolt(t, 0.1, 4)
      return {
        head:  { x: 0.22 * j },
        chest: { x: -0.08 * j },
        rightUpperArm: { z:  0.25 * j },
        leftUpperArm:  { z: -0.25 * j },
      }
    },
  },
  // Solletico su petto o pancia: si piega e ride a scatti.
  giggle: {
    duration: 1.6,
    pose: (t) => {
      const c = envelope(t, 1.6, 0.2)
      const shake = Math.sin(t * 16) * 0.035 * c
      return {
        ...handsInFront(c),
        spine: { x: 0.06 * c },
        chest: { x: 0.12 * c + shake },
        head:  { x: -0.06 * c + shake },
      }
    },
  },
  // Saltello sul posto: si piega, salta, atterra.
  hop: {
    duration: 0.8,
    pose: (t) => {
      const crouch = t < 0.15 ? t / 0.15 : t < 0.25 ? 1 - (t - 0.15) / 0.1 : t > 0.6 ? Math.max(0, 1 - Math.abs(t - 0.68) / 0.08) : 0
      const air = t >= 0.2 && t <= 0.6 ? Math.sin(Math.PI * (t - 0.2) / 0.4) : 0
      return {
        hips: { y: 0.07 * air - 0.03 * crouch },
        leftUpperLeg:  { x: 0.3 * crouch },
        rightUpperLeg: { x: 0.3 * crouch },
        leftLowerLeg:  { x: -0.55 * crouch },
        rightLowerLeg: { x: -0.55 * crouch },
        rightUpperArm: { z:  0.35 * air },
        leftUpperArm:  { z: -0.35 * air },
      }
    },
  },
  // Imbarazzo: mani davanti, sguardo di lato e in basso.
  shy: {
    duration: 1.8,
    pose: (t) => {
      const c = envelope(t, 1.8, 0.25)
      return {
        ...handsInFront(c, 1.0),
        head:  { y: 0.35 * c, x: -0.14 * c },
        neck:  { y: 0.1 * c },
        chest: { x: 0.05 * c },
      }
    },
  },
  // Rimprovero: braccia incrociate, testa che scuote.
  scold: {
    duration: 2.4,
    pose: (t) => ({ ...crossedArms(envelope(t, 2.4, 0.3)), head: { y: Math.sin(t * 9) * 0.18 * Math.max(0, 1 - t / 1.4), x: -0.04 } }),
  },
  // Offeso: si gira di spalle per qualche secondo (yaw gira tutto il corpo).
  turnaway: {
    duration: 5.0,
    pose: (t) => ({ ...crossedArms(envelope(t, 5.0, 0.4)), head: { x: -0.1 } }),
    yaw: (t) => Math.PI * smooth(t / 0.7) * (1 - smooth((t - 4.2) / 0.7)),
  },
  // Sbircia dal bordo, come una figura che spunta da dietro un muro: il busto
  // si sporge verso lo schermo, la testa si inclina verso il bordo, e la mano
  // del lato del monitor (la destra sul bordo destro) passa davanti al mento
  // e si aggrappa al bordo. Il bacino ruota dall'altra parte, cosi' fianco e
  // gambe restano dietro il bordo. Ciclica: e' il riposo finche' sbircia.
  peek: {
    duration: 0,
    pose: (t) => {
      const s = peek.side
      const hand = s > 0 ? 'right' : 'left'
      // Con la testa grande (chibi) le braccia sono corte: la mano sale un
      // po', e il bacino ruota di piu' perche' il busto si sporge meno.
      const k = Math.max(0, Math.min(1, (peek.headRatio - 1) / 1.4))
      return {
        hips:  { z: (-0.15 - 0.4 * k) * s },
        spine: { z: (-0.22 + 0.4 * k) * s, x: 0.1 },
        chest: { z: -0.28 * s + Math.sin(t * 1.6) * 0.015, x: 0.05 },
        neck:  { z: 0.1 * s },
        head:  { z: 0.5 * s, x: 0.05 + Math.sin(t * 1.1) * 0.02 },
        [hand + 'UpperArm']: { x: 0.6 + 0.3 * k, y: 0.6 * s },
        [hand + 'LowerArm']: { y: 2.3 * s },
      }
    },
    yaw: () => 0.3 * peek.side,
  },
  // Movimento generato da Kimodo su richiesta (kimodo-service.js): la clip
  // vera la mette clip-layer.js; qui solo il respiro sotto, e la durata di
  // ripiego se la clip non arriva.
  [GENERATED]: {
    duration: 4.0,
    pose: (t) => ({ chest: { x: Math.sin(t * 2.0) * 0.03 } }),
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
  'sit-edge': 'sit-edge', perch: 'perch', stretch: 'stretch', yawn: 'yawn',
  doze: 'doze', sleep: 'doze', dance: 'dance', peek: 'peek',
  pat: 'pat', flinch: 'flinch', giggle: 'giggle', hop: 'hop', shy: 'shy', scold: 'scold', turnaway: 'turnaway',
  [GENERATED]: GENERATED,
}

// Ossa che il player tocca. Vengono riscritte a ogni frame, cosi' una clip non
// puo' lasciare residui su quella successiva.
export const TOUCHED_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  // Le dita, per la mano rilassata di REST_POSE. Un modello senza dita le salta.
  ...Object.keys(FINGER_CURL).flatMap(finger => FINGER_JOINTS.flatMap(joint => ['left' + finger + joint, 'right' + finger + joint])),
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
export const LOOK_WEIGHT = { idle: 1, wave: 0.6, happy: 0.6, think: 0.3, smoke: 0.3, click: 0.5, perch: 0.8, pat: 0.2, giggle: 0.3, hop: 0.5, scold: 0.4, dance: 0.3, peek: 0.7 }
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
  // Dove si torna finito un gesto: idle, o perch se e' seduto su una finestra.
  let restName     = 'idle'
  let clipDuration = null   // durata della clip .vrma, se c'e': prevale su CLIPS
  let clipElapsed  = 0
  let clipWeight   = 0
  let clipEnding   = false
  let facingYaw    = 0
  let facingTarget = 0
  let turnYaw      = 0   // giro di tutto il corpo della clip in corso (yaw)
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

  /** Nome della clip per un nome o alias; idle vuol dire la posa di riposo. */
  function resolveClip(name) {
    const resolved = CLIP_ALIAS[name] || 'idle'
    return resolved === 'idle' ? restName : resolved
  }

  function play(name, options = {}) {
    const duration = options.duration
    const resolved = resolveClip(name)
    if (resolved === clipName && !clipEnding && !options.restart) return resolved
    clipName    = resolved
    clipDuration = Number.isFinite(duration) && duration > 0 ? duration : null
    clipElapsed = 0
    clipEnding  = false
    // Il peso riparte da zero: senza, la clip nuova entrerebbe di scatto al
    // peso pieno ereditato dalla precedente e la fusione non servirebbe.
    clipWeight  = 0
    if (resolved === restName) facingTarget = 0
    return resolved
  }

  return {
    /** Nome della clip per un nome o alias, senza avviarla. */
    resolve: resolveClip,

    /**
     * Avvia una clip per nome o alias. Sconosciuto significa idle, cioe' la
     * posa di riposo (setRest).
     * @param {string} name
     * @param {{ duration?: number, restart?: boolean }} [options] duration:
     *        durata della clip .vrma che la riproduce (clip-layer.js), il
     *        player torna a riposo quando finisce lei; restart: riparte anche
     *        se e' gia' in corso
     */
    play,

    /**
     * Posa a cui tornare finito un gesto: 'idle' in piedi, 'perch' seduto su
     * una finestra. Se in quel momento l'avatar e' a riposo, cambia subito.
     * @param {string} name
     */
    setRest(name) {
      const previous = restName
      restName = (CLIP_ALIAS[name] || 'idle')
      if (clipName === previous || clipName === 'idle') play(restName)
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
      clipName = restName; clipElapsed = 0; clipWeight = 0; clipEnding = false; clipDuration = null
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
        clipName = restName; clipElapsed = 0; clipEnding = false; clipWeight = 0; clipDuration = null
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
      const turn = turnYaw = active.yaw && clipName !== 'idle' ? active.yaw(clipElapsed) * clipWeight : 0
      if (vrm && vrm.scene) vrm.scene.rotation.y = baseYaw(vrm) + facingYaw + turn

      return { clip: clipName, ending: clipEnding, weight: clipWeight, yaw: facingYaw + turn, pose, lookWeight, lookParts }
    },

    /** Stato interno, per i test. */
    debug() {
      return { clipName, restName, clipElapsed, clipWeight, clipEnding, facingYaw, facingTarget, turnYaw, look, lookWeight }
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
