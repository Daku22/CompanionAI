// items.js — il pannello del cibo (Blocco 10b).
//
// Le card dei cibi e delle bevande (food.json, servite dal main). Premendo su
// una card il main apre il "fantasma" che segue il cursore; lasciando il tasto
// sopra un companion, lui lo prende e lo mangia. Il tasto lo segue il main
// (anche fuori da questa finestra); qui si dice solo inizio e fine.

(function () {
  const api = window.companion
  const grid = document.getElementById('grid')
  let items = []
  let kind = ''

  function render() {
    grid.replaceChildren(...items.filter(it => !kind || it.kind === kind).map(it => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'item'
      card.title = 'Trascinalo sul companion'
      const img = document.createElement('img')
      img.src = it.icon
      img.alt = ''
      img.draggable = false
      const name = document.createElement('span')
      name.textContent = it.name
      card.append(img, name)
      card.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return
        e.preventDefault()
        card.setPointerCapture(e.pointerId)
        card.classList.add('dragging')
        api.itemsDrag({ phase: 'start', id: it.id })
      })
      const end = (phase) => () => {
        if (!card.classList.contains('dragging')) return
        card.classList.remove('dragging')
        api.itemsDrag({ phase })
      }
      card.addEventListener('pointerup', end('drop'))
      card.addEventListener('pointercancel', end('cancel'))
      card.addEventListener('lostpointercapture', end('drop'))
      return card
    }))
  }

  for (const b of document.querySelectorAll('.seg [data-kind]')) {
    b.addEventListener('click', () => {
      kind = b.dataset.kind
      for (const o of document.querySelectorAll('.seg [data-kind]')) o.setAttribute('aria-pressed', String(o === b))
      render()
    })
  }
  document.getElementById('close').addEventListener('click', () => api.itemsClose())
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (document.querySelector('.item.dragging')) api.itemsDrag({ phase: 'cancel' })
    else api.itemsClose()
  })

  async function load() {
    try { items = (await api.itemsList()).food || [] } catch (_) { items = [] }
    render()
  }
  load()
})()
