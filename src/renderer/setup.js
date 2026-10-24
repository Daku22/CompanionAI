// setup.js — la finestra dei componenti scelti nell'installer (main.js,
// runSetupComponents): una riga per componente, con la barra e com'e' andata.

(function () {
  const api = window.companion
  const $ = (id) => document.getElementById(id)
  const rows = {}
  const gb = (bytes) => (bytes / 1e9).toFixed(1).replace('.', ',') + ' GB'

  function row(id, label) {
    const el = document.createElement('div')
    el.className = 'item'
    const head = document.createElement('div')
    head.className = 'head'
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: label })
    const state = Object.assign(document.createElement('span'), { className: 'state', textContent: 'in attesa' })
    head.append(name, state)
    const bar = document.createElement('div')
    bar.className = 'bar hidden'
    const fill = document.createElement('div')
    bar.append(fill)
    const note = Object.assign(document.createElement('div'), { className: 'note hidden' })
    el.append(head, bar, note)
    rows[id] = { el, state, bar, fill, note }
    return el
  }

  function show(d) {
    if (d.list) { $('items').replaceChildren(...d.list.map(c => row(c.id, c.label))); return }
    if (d.finished) {
      $('end').classList.remove('hidden')
      $('end-text').textContent = d.allOk
        ? 'Fatto. L\'installazione sta finendo.'
        : 'Qualcosa non è andato: puoi riprovare quando vuoi dalle Impostazioni (Voce, Microfono, Movimenti).'
      $('close').classList.toggle('hidden', d.allOk)
      return
    }
    const r = rows[d.id]
    if (!r) return
    if (d.running) { r.state.textContent = 'comincio…'; r.bar.classList.remove('hidden') }
    if (d.progress) {
      const p = d.progress
      const part = p.total > 0 ? Math.min(1, p.done / p.total) : null
      r.fill.style.width = part === null ? '8%' : Math.round(part * 100) + '%'
      r.state.textContent = (p.label || '') + (part === null ? '' : ' · ' + Math.round(part * 100) + '%' + (p.total > 1e8 ? ' di ' + gb(p.total) : ''))
    }
    if (typeof d.ok === 'boolean') {
      r.el.classList.add(d.ok ? 'ok' : 'err')
      r.state.textContent = d.ok ? 'fatto' : 'non riuscito'
      r.fill.style.width = d.ok ? '100%' : r.fill.style.width
      if (d.text) { r.note.textContent = d.text; r.note.classList.remove('hidden') }
    }
  }

  if (api && api.onSetupProgress) api.onSetupProgress(show)
  $('close').addEventListener('click', () => { if (api && api.setupClose) api.setupClose() })
})()
