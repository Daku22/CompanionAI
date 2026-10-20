// faces.js — pezzi comuni a chat e HUD (Blocco 9d): la foto del viso di un
// companion (o le sue iniziali colorate) e il valore dell'anello dell'umore.
//
// Script classico e non modulo: lo caricano chat.html e hud.html prima dei
// loro script.

(function (root) {
  /** Un colore per nome, sempre lo stesso (come le pastiglie del gruppo). */
  function hueOf(name) {
    let h = 0
    for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360
    return h
  }

  /** Le iniziali di un nome: al massimo due, maiuscole. */
  function initials(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] || '').join('').toUpperCase() || '?'
  }

  /**
   * Il viso di un companion: la miniatura del suo avatar (avatar://thumbs/,
   * Blocco 9c) o, finche' non c'e', le iniziali con il colore del nome.
   * @param {{ thumb?: string } | null | undefined} avatar
   */
  function face(avatar, name, cls = 'face') {
    const box = document.createElement('span')
    box.className = cls
    box.title = name || ''
    if (avatar && avatar.thumb) {
      const img = document.createElement('img')
      img.src = avatar.thumb
      img.alt = ''
      img.draggable = false
      box.append(img)
    } else {
      box.classList.add('initials')
      box.style.setProperty('--hue', String(hueOf(name)))
      box.textContent = initials(name)
    }
    return box
  }

  /**
   * L'avatar che indossa una persona: il suo, o il predefinito se non c'e'
   * (piu'). personas e avatars come da personasGet e listAvatars.
   */
  function avatarOf(personaId, personas, avatars) {
    const p = (personas || []).find(x => x.id === personaId)
    const list = avatars || []
    return list.find(a => p && a.id === p.avatarModel) || list.find(a => a.default) || list[0] || null
  }

  /** Umore da 0 (giu') a 1 (su), dalle emozioni del companion: l'anello. */
  function moodValue(m) {
    const e = (m && m.emotions) || {}
    const v = 0.5 + ((e.joy || 0) + (e.affection || 0) * 0.6 + (e.calm || 0) * 0.3 - (e.sadness || 0) - (e.annoyance || 0)) / 2
    return Math.max(0.04, Math.min(1, v))
  }

  /**
   * Fame e sete (Blocco 10a) per gli anelli di HUD e chat: valore (pieno =
   * sazio), tooltip e low con "molta". null se i bisogni sono spenti.
   */
  function needsRings(n) {
    if (!n) return null
    const words = { ok: 'nessuna', some: "un po'", much: 'molta' }
    return [
      { kind: 'hunger', label: 'Fame', full: 'sazietà', value: 1 - n.hunger, level: n.hungerLevel },
      { kind: 'thirst', label: 'Sete', full: 'idratazione', value: 1 - n.thirst, level: n.thirstLevel },
    ].map(x => ({ kind: x.kind, value: x.value, low: x.level === 'much',
      title: x.label + ': ' + (words[x.level] || words.ok) + ' · ' + x.full + ' ' + Math.round(x.value * 100) + '%' }))
  }

  root.CompanionFaces = { hueOf, initials, face, avatarOf, moodValue, needsRings }
})(window)
