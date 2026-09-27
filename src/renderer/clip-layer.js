// clip-layer.js — le clip .vrma sopra le pose procedurali.
//
// Il player di vrm-animation.js resta chi decide cosa fa l'avatar (idle,
// wave, sit...). Se per quel nome esiste una clip .vrma, questo livello la
// riproduce e la fonde con la posa procedurale: entra ed esce in dissolvenza,
// passa da una clip all'altra in dissolvenza, e dove manca una clip resta la
// posa calcolata.
//
// Le clip arrivano gia' nello spazio umanoide normalizzato, quindi valgono per
// ogni modello con un umanoide: VRM, e glTF o FBX con scheletro umano
// (motion-retarget.js). createVRMAnimationClip le lega al modello di turno.
//
// Le tracce si campionano qui a ogni frame, senza AnimationMixer: il mixer
// riscrive un osso solo quando il valore della clip cambia, e una clip ferma
// sull'ultimo fotogramma veniva cancellata dalla posa procedurale del frame
// dopo senza essere piu' riapplicata.

import * as THREE from 'three'
import { createVRMAnimationClip, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import { CLIPS, TOUCHED_BONES } from './vrm-animation.js'

const FADE_S = 0.3

/** Clip procedurali che girano in loop: le .vrma per loro si ripetono. */
export function isLoopSlot(slot) {
  return !!CLIPS[slot] && CLIPS[slot].duration === 0
}

/**
 * Una clip legata a un modello: per ogni traccia, il nodo e l'interpolante.
 * @param {THREE.AnimationClip} clip
 * @param {THREE.Object3D} root
 */
function bindClip(clip, root) {
  const channels = []
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.')
    const node = root.getObjectByName(track.name.slice(0, dot))
    const property = track.name.slice(dot + 1)
    if (!node || (property !== 'quaternion' && property !== 'position')) continue
    // Senza argomento l'interpolante crea il suo buffer del risultato.
    channels.push({ node, property, interpolant: /** @type {any} */ (track).createInterpolant() })
  }
  return { duration: clip.duration, channels }
}

export function createClipLayer() {
  /** @type {Map<string, { name: string, animation: any }[]>} */
  let library = new Map()
  let model = null
  let bound = new Map()     // entry -> clip legata
  let currentSlot = null
  let playing = null        // { entry, clip, time, loop }
  let previous = null       // clip da cui si sta sfumando
  let crossfade = 1         // 0..1 da previous a playing
  let prepared = null
  let weight = 0            // peso delle clip sopra la posa procedurale
  const touched = new Set()
  const identity = new THREE.Quaternion()
  const tmpQ = new THREE.Quaternion()
  const tmpV = new THREE.Vector3()

  function bindingFor(entry) {
    if (!bound.has(entry)) bound.set(entry, bindClip(createVRMAnimationClip(entry.animation, model), model.scene))
    return bound.get(entry)
  }

  function pick(slot) {
    const list = library.get(slot)
    if (!list || !list.length) return null
    return list[Math.floor(Math.random() * list.length)]
  }

  function start(slot) {
    const entry = prepared && prepared.slot === slot ? prepared.entry : pick(slot)
    prepared = null
    currentSlot = slot
    if (!entry) {
      // Nessuna clip: si continua a mostrare quella di prima mentre il peso
      // scende, poi resta solo la posa procedurale.
      if (playing) playing.fading = true
      return
    }
    if (playing && weight > 0) { previous = playing; crossfade = 0 } else { previous = null; crossfade = 1 }
    playing = { entry, clip: bindingFor(entry), time: 0, loop: isLoopSlot(slot), fading: false }
  }

  function advance(state, delta) {
    state.time += delta
    const d = state.clip.duration
    return state.loop && d > 0 ? state.time % d : Math.min(state.time, d)
  }

  /** Valori della clip all'istante t, in una mappa nodo -> valore. */
  function sample(state, t, out) {
    for (const ch of state.clip.channels) {
      const v = ch.interpolant.evaluate(t)
      out.set(ch.node, ch.property === 'quaternion' ? new THREE.Quaternion(v[0], v[1], v[2], v[3]) : new THREE.Vector3(v[0], v[1], v[2]))
    }
    return out
  }

  /** Valore procedurale di un nodo: quello scritto dal player, o il riposo. */
  function procedural(node, property) {
    if (property === 'quaternion') return touched.has(node) ? node.quaternion.clone() : identity.clone()
    const rest = model.humanoid.normalizedRestPose.hips
    const p = node.position.clone()
    if (rest && rest.position) { p.x = rest.position[0]; p.z = rest.position[2] }
    return p
  }

  return {
    /** Sostituisce le clip disponibili: Map slot -> [{ name, animation }]. */
    setLibrary(next) {
      library = next
      bound = new Map()
      currentSlot = null
      playing = null; previous = null; weight = 0
    },

    has(slot) { return (library.get(slot) || []).length > 0 },

    /** Lega il livello a un modello (VRM o umanoide ricostruito), o a nessuno. */
    attach(next) {
      model = next && next.humanoid ? next : null
      bound = new Map()
      currentSlot = null; playing = null; previous = null; prepared = null; weight = 0
      touched.clear()
      if (!model) return
      for (const name of TOUCHED_BONES) {
        const node = model.humanoid.getNormalizedBoneNode(name)
        if (node) touched.add(node)
      }
      // createVRMAnimationClip ne crea uno da sola con un avviso, se manca.
      if (model.lookAt && !model.scene.children.some(o => o instanceof VRMLookAtQuaternionProxy)) {
        const proxy = /** @type {any} */ (new VRMLookAtQuaternionProxy(model.lookAt))
        proxy.name = 'VRMLookAtQuaternionProxy'
        model.scene.add(proxy)
      }
    },

    /**
     * Sceglie in anticipo la clip per uno slot, per dire al player quanto dura.
     * @returns {number | undefined} durata se e' una clip a durata finita
     */
    prepare(slot) {
      const entry = pick(slot)
      prepared = entry ? { slot, entry } : null
      if (!entry || isLoopSlot(slot) || !model) return undefined
      return bindingFor(entry).duration
    },

    /**
     * Dopo che il player ha scritto la posa procedurale: sovrappone la clip.
     * @param {number} delta
     * @param {string} slot clip in corso nel player
     * @returns {number} peso delle clip sopra la posa procedurale
     */
    update(delta, slot) {
      if (!model) return 0
      if (slot !== currentSlot) start(slot)
      const target = playing && !playing.fading ? 1 : 0
      const step = delta / FADE_S
      weight = target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step)
      if (!playing || weight <= 0.001) {
        if (playing && playing.fading) { playing = null; previous = null }
        weight = 0
        return 0
      }

      const now = sample(playing, advance(playing, delta), new Map())
      let pose = now
      if (previous && crossfade < 1) {
        crossfade = Math.min(1, crossfade + step)
        const before = sample(previous, advance(previous, delta), new Map())
        pose = new Map()
        for (const node of new Set([...before.keys(), ...now.keys()])) {
          const property = (now.get(node) || before.get(node)).isQuaternion ? 'quaternion' : 'position'
          const a = before.get(node) || procedural(node, property)
          const b = now.get(node) || procedural(node, property)
          pose.set(node, property === 'quaternion' ? a.clone().slerp(b, crossfade) : a.clone().lerp(b, crossfade))
        }
        if (crossfade >= 1) previous = null
      }

      for (const [node, value] of pose) {
        if (value.isQuaternion) node.quaternion.copy(tmpQ.copy(procedural(node, 'quaternion')).slerp(value, weight))
        else node.position.copy(tmpV.copy(procedural(node, 'position')).lerp(value, weight))
      }
      return weight
    },

    /** Stato, per i test e l'audit. */
    debug() {
      return { slot: currentSlot, clip: playing && !playing.fading ? playing.entry.name : null, weight }
    },
  }
}

/**
 * Applica lo sguardo sopra la posa finale (clip o procedurale). parts arriva
 * da distributeLook, nella convenzione delle pose: su un VRM 1.0 x si specchia.
 */
export function applyLook(model, parts, mirror) {
  if (!parts || !model || !model.humanoid) return
  const e = new THREE.Euler()
  const q = new THREE.Quaternion()
  for (const [name, add] of Object.entries(parts)) {
    const node = model.humanoid.getNormalizedBoneNode(name)
    if (!node) continue
    node.quaternion.multiply(q.setFromEuler(e.set(add.x * mirror, add.y, 0)))
  }
}
