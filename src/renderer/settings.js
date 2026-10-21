// settings.js — la finestra Impostazioni: una pagina per voce della barra
// laterale (SETTINGS_PAGES in guards.js), da Generale a Tasti rapidi.
//
// Il Modello si salva con il suo pulsante, come nella chat al primo avvio
// (provider-form.js e' la stessa scheda). Il resto si salva subito (config,
// controllata da guards.js). I file e l'installazione di XTTS e del microfono
// li gestisce il main: qui si mostrano stato e avanzamento, che il main manda
// da solo mentre cambiano (voice-status).

(function () {
  const api = window.companion
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  // Un colore per nome, sempre lo stesso: le icone sono iniziali, non loghi.
  const hueOf = (name) => [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const enabled = $('voice-enabled')
  const speed = $('voice-speed')
  const volume = $('voice-volume')
  const engines = [...document.querySelectorAll('input[name="engine"]')]
  const radios = [...document.querySelectorAll('input[name="kokoro-voice"]')]
  const cpml = $('cpml')
  const speakerSel = $('xtts-speaker')

  // Pagine. La chat apre Modello (#modello nell'indirizzo, o settings-page
  // con la finestra gia' aperta); altrimenti si riapre sull'ultima scelta.
  const tabs = [...document.querySelectorAll('nav .item[data-page]')]
  function showPage(name) {
    if (name === 'persone') name = 'personaggi'   // il nome di prima del Blocco 9c
    if (!tabs.some(t => t.dataset.page === name)) name = 'generale'
    for (const t of tabs) {
      t.classList.toggle('active', t.dataset.page === name)
      if (t.dataset.page === name) t.setAttribute('aria-current', 'page')
      else t.removeAttribute('aria-current')
    }
    for (const p of document.querySelectorAll('.page')) p.classList.toggle('hidden', p.id !== 'page-' + name)
    try { localStorage.setItem('settings-page', name) } catch (_) { /* niente memoria: si riparte da Modello */ }
    // Le pagine che si aggiornano quando si aprono (Visione: le finestre aperte).
    document.dispatchEvent(new CustomEvent('settings-page-shown', { detail: name }))
  }
  for (const t of tabs) t.addEventListener('click', () => showPage(t.dataset.page))
  // Rimandi da una pagina all'altra ("si sceglie in Tasti rapidi").
  for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => showPage(b.dataset.goto))
  let lastPage = location.hash.slice(1)
  if (!lastPage) try { lastPage = localStorage.getItem('settings-page') || '' } catch (_) {}
  showPage(lastPage)
  if (api.onSettingsPage) api.onSettingsPage(showPage)

  // ─── Personaggi (Blocco 9c; le persone dal Blocco 6a) ─────────────────────
  // Due schede a card con la foto del viso: le persone e gli avatar. Il main
  // tiene gli elenchi (personas.js, AvatarLibrary); qui si crea, si rinomina,
  // si scrive la personalita', si attiva, si mette sul desktop e si veste.
  const personaName = $('persona-name')
  const personaPrompt = $('persona-prompt')
  const personaState = $('persona-state')
  const avatarForSel = $('avatar-for')
  let personaData = null
  let personaId = ''   // la persona aperta nel dettaglio; '' = la galleria
  let avatars = []     // dal main, con la miniatura di chi ce l'ha
  let rapport = {}     // id della persona -> { level, label, levels }
  const KIND = { vrm: 'VRM', gltf: '3D', fbx: '3D', live2d: 'Live2D', 'sprite-pack': '2D', sprite: '2D' }

  /** L'avatar di una persona: il suo, o il predefinito se non c'e' (piu'). */
  const avatarOf = (id) => avatars.find(a => a.id === id) || avatars.find(a => a.default) || avatars[0] || null
  const initials = (name) => String(name).trim().split(/\s+/).slice(0, 2).map(w => Array.from(w)[0] || '').join('').toUpperCase() || '?'
  /** La foto del viso dell'avatar, o le iniziali colorate di name. */
  function faceOf(avatar, name) {
    if (avatar && avatar.thumb) {
      const img = el('img')
      img.src = avatar.thumb
      img.alt = ''
      img.draggable = false
      return img
    }
    const d = el('div', 'initials', initials(name))
    d.style.setProperty('--hue', hueOf(name))
    return d
  }
  const rapportLine = (id) => {
    const r = rapport[id]
    return r ? 'Rapporto: ' + r.label.toLowerCase() + ' (' + (r.level + 1) + ' di ' + r.levels + ')' : ''
  }

  function personaCard(p) {
    const open = personaData.open || []
    const max = personaData.maxOpen || 3
    const isActive = p.id === personaData.activeId
    const isOpen = open.includes(p.id)
    const card = el('article', 'card' + (isActive ? ' current' : ''))
    const media = el('button', 'card-media')
    media.type = 'button'
    media.setAttribute('aria-label', 'Modifica ' + p.name)
    media.append(faceOf(avatarOf(p.avatarModel), p.name))
    if (isActive) media.append(el('span', 'badge', 'Attiva'))
    media.addEventListener('click', () => openPersona(p.id))
    const body = el('div', 'card-body')
    body.append(el('div', 'card-title', p.name), el('div', 'card-meta', rapportLine(p.id)))
    const actions = el('div', 'card-actions')
    const sw = el('label', 'mini')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = isOpen
    box.disabled = isOpen ? open.length <= 1 : open.length >= max
    sw.title = box.disabled ? (isOpen ? 'È l\'unico sul desktop: almeno uno resta.' : 'Sul desktop ce ne sono già ' + open.length + '.') : 'Sul desktop, con il suo avatar e la sua voce'
    box.addEventListener('change', () => changePersona({ op: box.checked ? 'open' : 'close', id: p.id }, box.checked ? p.name + ' è sul desktop.' : p.name + ' non è più sul desktop.'))
    sw.append(box, 'Sul desktop')
    actions.append(sw)
    if (!isActive) {
      const act = el('button', '', 'Attiva')
      act.type = 'button'
      act.title = 'La chat e le Impostazioni parlano di lei'
      act.addEventListener('click', () => changePersona({ op: 'activate', id: p.id }, 'Attiva: ' + p.name + '.'))
      actions.append(act)
    }
    body.append(actions)
    card.append(media, body)
    return card
  }
  function renderPersonaCards() {
    if (!personaData) return
    const add = el('button', 'card-add')
    add.type = 'button'
    add.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    add.append('Nuova persona')
    add.addEventListener('click', newPersona)
    $('persona-cards').replaceChildren(...personaData.list.map(personaCard), add)
  }
  function openPersona(id) {
    personaId = id
    $('persona-gallery').classList.add('hidden')
    $('persona-detail').classList.remove('hidden')
    $('persona-cards-state').textContent = ''
    personaState.textContent = ''
    showPersona(true)
  }
  function closePersona() {
    personaId = ''
    $('persona-detail').classList.add('hidden')
    $('persona-gallery').classList.remove('hidden')
    renderPersonaCards()
  }
  $('persona-back').addEventListener('click', closePersona)
  async function newPersona() {
    const before = new Set(personaData.list.map(p => p.id))
    if (!(await changePersona({ op: 'create', name: 'Nuova persona' }, ''))) return
    const made = personaData.list.find(p => !before.has(p.id))
    if (!made) return
    openPersona(made.id)
    personaState.textContent = 'Creata: dalle un nome e una personalità.'
    personaName.focus()
    personaName.select()
  }

  // Avatar: le card di tutti, e "Usa" su un companion sul desktop.
  function renderAvatarFor() {
    if (!personaData) return
    const open = personaData.open || []
    const names = Object.fromEntries(personaData.list.map(p => [p.id, p.name]))
    const keep = avatarForSel.value || personaData.activeId
    avatarForSel.replaceChildren(...open.map(id => new Option(names[id] || id, id)))
    avatarForSel.value = open.includes(keep) ? keep : open.includes(personaData.activeId) ? personaData.activeId : (open[0] || '')
    avatarForSel.disabled = open.length < 2
    renderAvatarCards()
  }
  function renderAvatarCards() {
    const who = personaData && personaData.list.find(p => p.id === avatarForSel.value)
    const wearing = who ? (avatarOf(who.avatarModel) || {}).id : null
    $('avatar-cards').replaceChildren(...avatars.map(a => {
      const inUse = a.id === wearing
      const card = el('article', 'card' + (inUse ? ' current' : ''))
      const media = el('button', 'card-media')
      media.type = 'button'
      media.setAttribute('aria-label', (inUse ? '' : 'Usa ') + a.name)
      media.append(faceOf(a, a.name), el('span', 'badge quiet kind', KIND[a.kind] || '3D'))
      if (inUse) media.append(el('span', 'badge', 'In uso'))
      media.addEventListener('click', () => { if (!inUse) useAvatar(a) })
      const body = el('div', 'card-body')
      body.append(el('div', 'card-title', a.name), el('div', 'card-meta', a.builtin ? 'Integrato' : 'Importato'))
      const actions = el('div', 'card-actions')
      if (inUse) actions.append(el('span', 'on-label', 'Lo indossa ' + who.name))
      else {
        const use = el('button', 'primary', 'Usa')
        use.type = 'button'
        use.addEventListener('click', () => useAvatar(a))
        actions.append(use)
      }
      if (!a.builtin) {
        const del = el('button', 'danger', 'Elimina')
        del.type = 'button'
        del.addEventListener('click', (e) => removeAvatar(a, e.currentTarget))
        actions.append(del)
      }
      body.append(actions)
      card.append(media, body)
      return card
    }))
  }
  avatarForSel.addEventListener('change', renderAvatarCards)
  function avatarNote(text, error) {
    const s = $('avatar-state')
    s.className = 'state' + (error ? ' error' : '')
    s.textContent = text
  }
  async function useAvatar(a) {
    const r = await api.useAvatar(a.id, avatarForSel.value).catch(() => null)
    // La card "In uso" si aggiorna quando il companion l'ha caricato (config-changed).
    avatarNote(r && r.ok ? r.name + ' indossa ' + a.name + '.' : 'Non riuscito: nessun companion sul desktop.', !(r && r.ok))
  }
  async function removeAvatar(a, btn) {
    if (!confirmClick(btn, 'Clicca di nuovo per eliminare ' + a.name + ' da questo PC.')) return
    try { await api.removeAvatars([a.id]); avatarNote(a.name + ' eliminato.') } catch (e) { avatarNote('Non eliminato: ' + e.message, true) }
    refreshAvatars()
  }
  $('avatar-import').addEventListener('click', async () => {
    avatarNote('')
    $('avatar-candidates').classList.add('hidden')
    let scan
    try { scan = await api.scanAvatarImport() } catch (e) { avatarNote('Importazione non riuscita: ' + e.message, true); return }
    if (!scan || scan.canceled) return
    const choices = scan.candidates || []
    if (choices.length === 1) { commitImport(scan.token, choices[0]); return }
    // Piu' modelli nella cartella: si sceglie qui quale.
    $('avatar-candidate-list').replaceChildren(...choices.map(c => {
      const b = el('button', '', c.name + ' (' + (KIND[c.kind] || c.kind) + ')')
      b.type = 'button'
      b.addEventListener('click', () => { $('avatar-candidates').classList.add('hidden'); commitImport(scan.token, c) })
      return b
    }))
    $('avatar-candidates').classList.remove('hidden')
  })
  $('avatar-candidates-cancel').addEventListener('click', () => $('avatar-candidates').classList.add('hidden'))
  async function commitImport(token, candidate) {
    avatarNote('Importo ' + candidate.name + '…')
    try {
      const a = await api.commitAvatarImport({ token, candidateId: candidate.id })
      await refreshAvatars()
      const r = await api.useAvatar(a.id, avatarForSel.value).catch(() => null)
      avatarNote(r && r.ok ? 'Importato: ' + r.name + ' lo indossa già.' : 'Importato.')
    } catch (e) { avatarNote('Importazione non riuscita: ' + e.message, true) }
  }
  async function refreshAvatars() {
    try { avatars = await api.listAvatars() } catch (_) { /* restano quelli di prima */ }
    renderPersonaCards()
    renderAvatarCards()
    if (personaId) showPersona()
  }
  async function refreshPersonaggi() {
    try { rapport = await api.personasRapport() } catch (_) { /* senza rapporto le card restano */ }
    refreshAvatars()
  }
  if (api.onAvatarsChanged) api.onAvatarsChanged(refreshAvatars)
  for (const t of tabs) if (t.dataset.page === 'personaggi') t.addEventListener('click', refreshPersonaggi)

  // Le due schede, con le frecce da tastiera come una tablist.
  const segTabs = [...document.querySelectorAll('.seg [role=tab]')]
  function showTab(name) {
    for (const t of segTabs) {
      t.setAttribute('aria-selected', String(t.dataset.tab === name))
      t.tabIndex = t.dataset.tab === name ? 0 : -1
    }
    $('tab-persone').classList.toggle('hidden', name !== 'persone')
    $('tab-avatar').classList.toggle('hidden', name !== 'avatar')
  }
  for (const t of segTabs) {
    t.addEventListener('click', () => showTab(t.dataset.tab))
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const next = segTabs[(segTabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + segTabs.length) % segTabs.length]
      next.focus()
      showTab(next.dataset.tab)
    })
  }
  showTab('persone')

  function showPersonas(data) {
    if (!data) return
    personaData = data
    if (personaId && !data.list.some(p => p.id === personaId)) closePersona()
    renderPersonaCards()
    if (personaId) showPersona()
    renderAvatarFor()
    // Memoria: un selettore suo, che tiene la scelta fatta li'.
    const memKeep = memorySel.value || data.activeId
    memorySel.replaceChildren(...data.list.map(p => new Option(p.name + (p.id === data.activeId ? ' (attiva)' : ''), p.id)))
    memorySel.value = data.list.some(p => p.id === memKeep) ? memKeep : data.activeId
    showMemoryPage()
  }
  const memorySel = $('memory-persona')
  function showMemoryPage() {
    if (!memorySel.value) return
    showDiary(memorySel.value)
    showMemory(memorySel.value)
  }
  memorySel.addEventListener('change', () => { $('memory-state').textContent = ''; showMemoryPage() })
  for (const t of tabs) if (t.dataset.page === 'memoria') t.addEventListener('click', showMemoryPage)
  // Le voci sono quelle della scheda Voce: Kokoro e, se XTTS e' installato,
  // le sue (il campione e le voci del modello).
  const personaVoice = $('persona-voice')
  function fillPersonaVoices(v) {
    const group = (label, items) => {
      const g = document.createElement('optgroup')
      g.label = label
      g.append(...items.map(([value, text]) => new Option(text, value)))
      return g
    }
    const xtts = [...speakerSel.options].map(o => ['xtts:' + o.value, o.textContent])
    if (v.xttsSpeaker && !xtts.some(([value]) => value === 'xtts:' + v.xttsSpeaker)) xtts.push(['xtts:' + v.xttsSpeaker, v.xttsSpeaker])
    personaVoice.replaceChildren(
      group('Kokoro', radios.map(r => ['kokoro:' + r.value, r.parentElement.textContent.trim()])),
      group('XTTS-v2', xtts))
    personaVoice.value = v.engine === 'xtts' ? 'xtts:' + v.xttsSpeaker : 'kokoro:' + v.kokoroVoice
  }
  // Le voci di XTTS arrivano dopo l'avvio (loadSpeakers): il menu si rifa'
  // tenendo la scelta, senza toccare nome e personalita' gia' scritti.
  function refreshPersonaVoices() {
    if (!personaData || !personaVoice.value) return
    const keep = personaVoiceChoice()
    fillPersonaVoices({ engine: keep.engine, kokoroVoice: keep.kokoroVoice, xttsSpeaker: keep.xttsSpeaker })
  }
  $('persona-voice-test').addEventListener('click', async () => {
    const note = $('persona-voice-note')
    const btn = $('persona-voice-test')
    note.textContent = 'Preparo la voce…'
    btn.disabled = true
    try {
      const res = await api.voiceTest(personaVoiceChoice())
      note.textContent = res && res.ok ? '' : 'Non ha parlato: ' + ((res && res.error) || 'errore sconosciuto')
    } catch (e) { note.textContent = 'Non ha parlato: ' + e.message }
    btn.disabled = false
  })
  function personaVoiceChoice() {
    const [engine, ...rest] = personaVoice.value.split(':')
    const name = rest.join(':')
    return engine === 'xtts' ? { engine, xttsSpeaker: name } : { engine: 'kokoro', kokoroVoice: name }
  }
  /** Il dettaglio della persona aperta; fill riscrive anche i campi (all'apertura e dopo il salvataggio). */
  function showPersona(fill) {
    const p = personaData.list.find(x => x.id === personaId)
    if (!p) return
    if (fill) {
      personaName.value = p.name
      personaPrompt.value = p.prompt
      fillPersonaVoices(p.voice)
    }
    $('persona-title').textContent = p.name
    $('persona-face').replaceChildren(faceOf(avatarOf(p.avatarModel), p.name))
    const isActive = p.id === personaData.activeId
    // Sul desktop (Blocco 8b): fino a maxOpen insieme, almeno uno.
    const open = personaData.open || []
    const isOpen = open.includes(p.id)
    const toggle = $('persona-open')
    toggle.checked = isOpen
    toggle.disabled = isOpen ? open.length <= 1 : open.length >= (personaData.maxOpen || 3)
    $('persona-open-note').textContent = isOpen && open.length <= 1 ? 'È l\'unico sul desktop: almeno uno resta.'
      : !isOpen && toggle.disabled ? 'Sul desktop ce ne sono già ' + open.length + ': toglierne uno per mettere questo.'
        : 'Fino a ' + (personaData.maxOpen || 3) + ' companion insieme, ognuno con il suo avatar, la sua voce e la sua memoria.'
    $('persona-activate').classList.toggle('hidden', isActive)
    $('persona-remove').disabled = isActive
    $('persona-remove').title = isActive ? 'Per eliminarla, attiva prima un\'altra persona' : ''
    $('persona-active').textContent = [isActive ? 'Attiva: la chat e le Impostazioni parlano di lei.' : '', rapportLine(p.id)].filter(Boolean).join(' ')
  }
  /** Una modifica alle persone; il messaggio va dove si guarda (dettaglio o galleria). */
  async function changePersona(input, done) {
    const out = personaId ? personaState : $('persona-cards-state')
    out.className = 'state'
    out.textContent = ''
    const r = await api.personasChange(input).catch(() => null)
    if (!r || !r.ok) {
      out.classList.add('error')
      out.textContent = (r && r.error) || 'Non riuscito.'
      showPersonas(personaData)
      return false
    }
    showPersonas(r.personas)
    out.textContent = done
    return true
  }
  // Diario della persona scelta: sola lettura, la pagina piu' recente in alto.
  async function showDiary(id) {
    const entries = await api.personasDiary(id).catch(() => [])
    if (id !== memorySel.value) return
    const fmt = (day) => new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    $('diary-list').replaceChildren(...entries.map(e => {
      const a = document.createElement('article')
      const h = document.createElement('h3')
      h.textContent = fmt(e.day) + (e.kind === 'live' ? ' · dopo la live' : '')
      const p = document.createElement('p')
      p.textContent = e.text
      a.append(h, p)
      return a
    }))
    $('diary-empty').classList.toggle('hidden', entries.length > 0)
  }
  // Connettori MCP (Blocco 7f), come in Claude: i tuoi connettori, quello
  // personalizzato (nome e URL) e il catalogo dei piu' usati.
  const badge = (name) => {
    const b = el('span', 'mcp-badge', String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?')
    b.style.setProperty('--hue', hueOf(name))
    b.setAttribute('aria-hidden', 'true')
    return b
  }
  // Il messaggio sta sotto i tuoi connettori: se si e' premuto qualcosa in fondo al catalogo, lo si porta in vista.
  const state = (text) => {
    $('mcp-state').textContent = text
    if (text) $('mcp-state').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  let mcpBusy = false

  async function run(label, task) {
    if (mcpBusy) return null
    mcpBusy = true
    document.body.classList.add('mcp-busy')
    state(label)
    try { return await task() } catch (e) { return { ok: false, error: e.message } } finally {
      mcpBusy = false
      document.body.classList.remove('mcp-busy')
    }
  }
  const loginNote = (name) => 'Collego ' + name + '… se si apre il browser, accedi e autorizza CompanionAI: ti aspetto qui.'

  function showMcp(servers) {
    $('mcp-empty').classList.toggle('hidden', servers.length > 0)
    $('mcp-list').replaceChildren(...servers.map(s => {
      const box = el('div', 'server')
      const head = el('div', 'head')
      const on = el('label', 'switch')
      const onBox = el('input')
      onBox.type = 'checkbox'
      onBox.checked = s.enabled
      onBox.setAttribute('aria-label', 'Acceso')
      onBox.addEventListener('change', async () => { const r = await api.mcpUpdate({ id: s.id, enabled: onBox.checked }); showMcp(r.servers) })
      on.append(onBox)
      const where = s.url ? new URL(s.url).host : 'Sul tuo PC'
      const title = el('div', 'title')
      title.append(el('b', '', s.name), el('span', 'status', where + ' · ' + (!s.enabled ? 'spento'
        : s.auth === 'oauth' && !s.signedIn ? 'da ricollegare'
        : s.allowed.length ? 'acceso, ' + s.allowed.length + (s.allowed.length === 1 ? ' azione permessa' : ' azioni permesse')
        : 'acceso, ma nessuna azione permessa')))
      const del = el('button', 'danger', 'Rimuovi')
      del.addEventListener('click', async (e) => {
        if (!confirmClick(e.currentTarget, 'Clicca di nuovo per rimuovere ' + s.name + (s.url ? ' (si scollega anche il tuo account)' : '') + '.')) return
        const r = await api.mcpRemove(s.id)
        showMcp(r.servers)
        refreshCatalog()
      })
      head.append(badge(s.name), title, on, del)
      box.append(head)

      const details = el('details', 'tools')
      details.append(el('summary', '', 'Cosa può fare'))
      const group = (label, list) => {
        if (!list.length) return
        details.append(el('div', 'group', label))
        for (const t of list) {
          const row = el('label', 'tool')
          const check = el('input')
          check.type = 'checkbox'
          check.checked = s.allowed.includes(t.name)
          check.addEventListener('change', async () => {
            const allowed = check.checked ? [...s.allowed, t.name] : s.allowed.filter(n => n !== t.name)
            const r = await api.mcpUpdate({ id: s.id, allowed })
            showMcp(r.servers)
          })
          const text = el('span')
          text.append(el('b', '', t.label))
          if (s.trusted.includes(t.name)) {
            const again = el('button', 'link', 'non chiede più · chiedi di nuovo')
            again.type = 'button'
            again.addEventListener('click', async (e) => {
              e.preventDefault()
              const r = await api.mcpUpdate({ id: s.id, trusted: s.trusted.filter(n => n !== t.name) })
              showMcp(r.servers)
            })
            text.append(' ', again)
          }
          if (t.description) text.append(el('small', '', t.description))
          row.append(check, text)
          details.append(row)
        }
      }
      group('Legge (non cambia niente)', s.tools.filter(t => t.readOnly))
      group('Modifica (attenzione: cambia i tuoi file o dati)', s.tools.filter(t => !t.readOnly))
      const again = el('button', 'link', s.auth === 'oauth' ? 'Accedi di nuovo' : 'Aggiorna l\'elenco')
      again.type = 'button'
      again.addEventListener('click', async () => {
        const r = await run(loginNote(s.name), () => api.mcpConnect(s.id))
        if (!r) return
        state(r.ok ? '✓ ' + s.name + ' collegato.' : '✗ ' + s.name + ': ' + r.error)
        if (r.ok) showMcp(r.servers)
      })
      details.append(el('div', 'cmd', s.url || [s.command, ...s.args].join(' ')), again)
      box.append(details)
      return box
    }))
  }

  // Il catalogo: una scheda per connettore, "Aggiungi" o "Collega".
  function tile(c) {
    const t = el('div', 'mcp-tile')
    const what = el('div', 'what')
    what.append(el('b', '', c.name), el('span', '', c.description))
    const btn = el('button', c.added ? 'done' : '', c.added ? 'Aggiunto ✓' : c.auth === 'none' ? 'Aggiungi' : 'Collega')
    btn.disabled = c.added
    t.append(badge(c.name), what, btn)
    if (c.auth === 'token' && !c.added) {
      // GitHub e simili: il token si crea sul sito, poi si incolla qui.
      const form = el('div', 'mcp-token hidden')
      const input = el('input', 'pf-input pf-mono')
      input.type = 'password'
      input.placeholder = 'Incolla il token'
      const make = el('button', 'link', 'Crea il token ↗')
      make.type = 'button'
      make.addEventListener('click', () => api.mcpOpenTokenPage(c.id))
      const go = el('button', 'primary', 'Collega')
      form.append(el('span', '', c.tokenHelp), make, input, go)
      what.append(form)
      btn.addEventListener('click', () => {
        const open = form.classList.toggle('hidden') === false
        btn.textContent = open ? 'Chiudi' : 'Collega'
        if (open) input.focus()
      })
      go.addEventListener('click', async () => {
        const r = await run('Collego ' + c.name + '…', () => api.mcpAddConnector({ id: c.id, token: input.value }))
        if (!r) return
        state(r.ok ? '✓ ' + c.name + ' collegato: ora puoi chiederglielo in chat.' : '✗ ' + c.name + ': ' + r.error)
        if (r.ok) { showMcp(r.servers); refreshCatalog() }
      })
    } else if (!c.added) {
      btn.addEventListener('click', async () => {
        const r = await run(c.auth === 'oauth' ? loginNote(c.name) : 'Aggiungo ' + c.name + '…', () => api.mcpAddConnector({ id: c.id }))
        if (!r) return
        state(r.ok ? '✓ ' + c.name + ' collegato: ora puoi chiederglielo in chat.' : '✗ ' + c.name + ': ' + r.error)
        if (r.ok) { showMcp(r.servers); refreshCatalog() }
      })
    }
    return t
  }
  async function refreshCatalog() {
    const list = await api.mcpCatalog().catch(() => [])
    $('mcp-grid-none').replaceChildren(...list.filter(c => c.auth === 'none').map(tile))
    $('mcp-grid-account').replaceChildren(...list.filter(c => c.auth !== 'none').map(tile))
  }

  // Connettore personalizzato: nome e URL.
  const custom = $('mcp-custom')
  $('mcp-custom-open').addEventListener('click', () => { custom.classList.remove('hidden'); $('mcp-remote-name').focus() })
  $('mcp-custom-cancel').addEventListener('click', () => custom.classList.add('hidden'))
  $('mcp-remote-add').addEventListener('click', async () => {
    const name = $('mcp-remote-name').value.trim()
    const r = await run(loginNote(name || 'il connettore'), () => api.mcpAddRemote({ name, url: $('mcp-remote-url').value, token: $('mcp-remote-token').value }))
    if (!r) return
    state(r.ok ? '✓ ' + name + ' collegato: in "Cosa può fare" vedi le sue azioni.' : '✗ ' + r.error)
    if (r.ok) {
      showMcp(r.servers)
      for (const id of ['mcp-remote-name', 'mcp-remote-url', 'mcp-remote-token']) $(id).value = ''
      custom.classList.add('hidden')
    }
  })

  // Sul PC: prima si controlla che ci sia Node.js.
  const filesBtn = $('mcp-files-add')
  async function checkNode() {
    const version = await api.mcpNode().catch(() => null)
    $('mcp-node-missing').classList.toggle('hidden', !!version)
    filesBtn.disabled = !version
    return version
  }
  $('mcp-node-get').addEventListener('click', () => api.mcpOpenNodePage())
  filesBtn.addEventListener('click', async () => {
    const r = await run('Scegli la cartella… poi preparo il connettore (la prima volta può volerci un minuto).', () => api.mcpAddFiles({ write: $('mcp-files-write').checked }))
    if (!r) return
    state(r.canceled ? '' : r.ok ? '✓ Pronto: ora puoi chiedergli dei file di quella cartella.' : '✗ Non sono riuscito: ' + r.error)
    if (r.ok) { $('mcp-files-write').checked = false; showMcp(r.servers) }
  })
  $('mcp-add').addEventListener('click', async () => {
    const lines = (id) => $(id).value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const r = await run('Avvio il programma e leggo le sue azioni…', () => api.mcpAdd({ name: $('mcp-name').value, command: $('mcp-command').value, args: lines('mcp-args'), env: lines('mcp-env') }))
    if (!r) return
    state(r.ok ? '✓ Aggiunto: in "Cosa può fare" scegli cosa permettergli.' : '✗ Non sono riuscito: ' + r.error)
    if (r.ok) { showMcp(r.servers); for (const id of ['mcp-name', 'mcp-command', 'mcp-args', 'mcp-env']) $(id).value = '' }
  })
  api.mcpList().then(showMcp).catch(() => {})
  refreshCatalog()
  checkNode()
  for (const t of tabs) if (t.dataset.page === 'strumenti') t.addEventListener('click', checkNode)

  // Movimenti generati con Kimodo (Blocco 7d): nome, prova, eliminazione.
  async function showMotions() {
    const list = await api.motionsList().catch(() => [])
    $('motions-empty').classList.toggle('hidden', list.length > 0)
    $('motions-list').replaceChildren(...list.map((m, i) => {
      const row = document.createElement('div')
      row.className = 'motion'
      const name = document.createElement('input')
      name.className = 'pf-input'
      name.maxLength = 60
      name.value = m.name || ''
      name.placeholder = m.prompt || 'movimento generato ' + (i + 1)
      name.setAttribute('aria-label', 'Nome del movimento')
      let savedName = name.value
      const save = document.createElement('button')
      save.className = 'save'
      save.textContent = 'Salva'
      save.disabled = true
      name.addEventListener('input', () => { save.disabled = name.value.trim() === savedName.trim() })
      save.addEventListener('click', async () => {
        const ok = await api.motionsRename(m.key, name.value).catch(() => false)
        if (ok) { savedName = name.value; save.disabled = true }
        $('motions-state').textContent = ok ? '✓ Nome salvato: lo trovi così nel menu "Prova i movimenti di Kimodo".' : 'Non riuscito.'
      })
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !save.disabled) save.click() })
      const play = document.createElement('button')
      play.textContent = 'Prova'
      play.addEventListener('click', () => api.motionsPreview(m.key))
      const del = document.createElement('button')
      del.className = 'danger'
      del.textContent = 'Elimina'
      del.addEventListener('click', async (e) => {
        if (!confirmClick(e.currentTarget, 'Clicca di nuovo per eliminare questo movimento.')) return
        const ok = await api.motionsRemove(m.key).catch(() => false)
        $('motions-state').textContent = ok ? 'Movimento eliminato.' : 'Non riuscito.'
        showMotions()
      })
      const prompt = document.createElement('div')
      prompt.className = 'prompt'
      prompt.textContent = m.prompt ? '“' + m.prompt + '”' : ''
      row.append(name, save, play, del, prompt)
      return row
    }))
  }
  showMotions()
  for (const t of tabs) if (t.dataset.page === 'movimenti') t.addEventListener('click', showMotions)

  // Memoria della persona scelta (Blocco 6e): riassunto da correggere e
  // ricordi da eliminare, i piu' recenti in alto.
  async function showMemory(id) {
    const m = await api.memoryView(id).catch(() => null)
    if (id !== memorySel.value) return
    $('memory-summary').value = m ? m.summary : ''
    const name = (personaData.list.find(p => p.id === id) || {}).name || 'Companion'
    const when = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }
    const item = (t) => {
      const row = document.createElement('div')
      row.className = 'memo'
      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = when(t.timestamp) + ' · ' + (t.speaker === 'assistant' ? name : 'Tu')
      const text = document.createElement('div')
      text.className = 'text'
      text.textContent = t.content
      const del = document.createElement('button')
      del.className = 'danger'
      del.textContent = 'Elimina'
      del.addEventListener('click', async (e) => {
        if (!confirmClick(e.currentTarget, 'Clicca di nuovo per eliminare questo ricordo.')) return
        const r = await api.memoryEdit({ id, op: 'delete', turnId: t.id }).catch(() => null)
        $('memory-state').textContent = r && r.ok ? 'Ricordo eliminato.' : (r && r.error) || 'Non riuscito.'
        showMemory(id)
      })
      row.append(meta, del, text)
      return row
    }
    const head = (text) => { const h = document.createElement('h3'); h.textContent = text; return h }
    const parts = []
    if (m && m.recent.length) parts.push(head('Recenti (' + m.recent.length + ')'), ...m.recent.map(item))
    if (m && m.archive.length) parts.push(head('In archivio (' + m.archived + (m.archived > m.archive.length ? ', qui gli ultimi ' + m.archive.length : '') + ')'), ...m.archive.map(item))
    if (!parts.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Nessun ricordo.'; parts.push(p) }
    $('memory-list').replaceChildren(...parts)
  }
  $('memory-summary-save').addEventListener('click', async () => {
    const r = await api.memoryEdit({ id: memorySel.value, op: 'summary', text: $('memory-summary').value }).catch(() => null)
    $('memory-state').textContent = r && r.ok ? 'Riassunto salvato.' : (r && r.error) || 'Non riuscito.'
  })
  if (api.onDiaryChanged) api.onDiaryChanged((id) => { if (id === memorySel.value) showDiary(id) })
  $('persona-save').addEventListener('click', async () => {
    if (await changePersona({ op: 'update', id: personaId, name: personaName.value, prompt: personaPrompt.value, voice: personaVoiceChoice() }, 'Salvata.')) showPersona(true)
  })
  $('persona-activate').addEventListener('click', () => changePersona({ op: 'activate', id: personaId }, 'Attivata.'))
  $('persona-open').addEventListener('change', (e) => changePersona({ op: e.target.checked ? 'open' : 'close', id: personaId }, e.target.checked ? 'Ora è sul desktop.' : 'Tolta dal desktop.'))
  $('persona-remove').addEventListener('click', async (e) => {
    if (!confirmClick(e.currentTarget, 'Clicca di nuovo per eliminare questa persona, con la sua memoria e il suo umore.')) return
    const name = personaName.value
    if (!(await changePersona({ op: 'remove', id: personaId }, ''))) return
    closePersona()
    $('persona-cards-state').textContent = (name || 'La persona') + ' è stata eliminata.'
  })
  api.personasGet().then(d => showPersonas(d)).catch(() => {})
  refreshPersonaggi()

  // Conferma con un secondo clic, al posto di confirm(): il primo arma il
  // pulsante e scrive l'avviso sotto la sua riga, il secondo (entro 5
  // secondi) agisce. Restituisce true solo al secondo clic.
  function confirmClick(btn, warning) {
    const row = btn.closest('.row, .card-actions') || btn
    let note = row.nextElementSibling
    if (!note || !note.classList.contains('confirm-note')) {
      note = document.createElement('p')
      note.className = 'confirm-note'
      note.setAttribute('role', 'alert')
      row.after(note)
    }
    const disarm = () => {
      clearTimeout(btn._disarm)
      btn.classList.remove('armed')
      btn.textContent = btn._label
      note.textContent = ''
    }
    if (btn.classList.contains('armed')) { disarm(); return true }
    btn._label = btn.textContent
    btn.classList.add('armed')
    btn.textContent = 'Sicuro? Clic di nuovo'
    note.textContent = warning
    btn._disarm = setTimeout(disarm, 5000)
    return false
  }

  // ─── Modello ───────────────────────────────────────────────────────────────
  const providerForm = window.ProviderForm.mount($('provider-form'), { api })
  const pfState = $('pf-state')
  let formShown = ''      // provider, modello e chiavi mostrati nella scheda
  const formKey = (cfg) => JSON.stringify([cfg.provider, cfg.model, cfg.keyConfigured, cfg.keyUnreadable])
  function loadForm(cfg) {
    formShown = formKey(cfg)
    providerForm.load(cfg)
  }
  $('pf-save').addEventListener('click', async () => {
    pfState.className = 'state'
    pfState.textContent = ''
    const saved = await providerForm.save()
    if (!saved) return
    formShown = formKey(saved)
    pfState.classList.add('ok')
    pfState.textContent = 'Salvato. La chat usa già questo modello.'
    setTimeout(() => { if (pfState.classList.contains('ok')) { pfState.textContent = ''; pfState.className = 'state' } }, 4000)
  })

  // ─── Tasti rapidi (Blocco 9c) ──────────────────────────────────────────────
  // La chat e i companion: scorciatoie dell'app (shortcuts nella config). Il
  // microfono sta con la voce (voice.micShortcut): la sua riga e' piu' sotto.
  const KEY_NOTES = { chat: 'L\'ultima chat che hai usato.', hide: 'Tutti insieme, con i loro comandi.', handsfree: 'Accende e spegne l\'ascolto continuo del microfono.', live: 'Accende e spegne la live su Twitch (pagina Streaming).', game: 'Guarda la partita con il companion della chat (pagina Visione).' }
  const KEYS = ['chat', 'hide', 'handsfree', 'live', 'game']
  function showKeys(cfg) {
    const choices = cfg.appShortcuts || []
    const want = cfg.shortcuts || {}
    for (const key of KEYS) {
      const sel = $('key-' + key)
      if (sel.options.length !== choices.length) sel.replaceChildren(...choices.map(s => new Option(s.label, s.id)))
      sel.value = want[key] || 'off'
      // Quelle delle altre azioni non si scelgono: due azioni sullo stesso tasto no.
      const others = KEYS.filter(k => k !== key).map(k => want[k])
      for (const o of sel.options) o.disabled = o.value !== 'off' && others.includes(o.value)
      const busy = sel.value !== 'off' && (cfg.shortcutsActive || {})[key] !== sel.value
      const note = $('key-' + key + '-note')
      note.classList.toggle('warn', busy)
      note.textContent = busy ? 'La usa già un altro programma: scegline un\'altra.' : KEY_NOTES[key]
    }
  }
  for (const key of KEYS) {
    $('key-' + key).addEventListener('change', async (e) => {
      try { showKeys(await api.setConfig({ shortcuts: { [key]: e.target.value } })) } catch (_) {}
    })
  }

  // ─── Il gioco (Blocco 12a) ─────────────────────────────────────────────────
  // La finestra che la modalita' gioco guarda (o tutto lo schermo) e il modello
  // che guarda: quello della chat se vede le immagini, o uno scelto qui.
  let game = null
  let gameCfg = null
  const gameCard = (choice, label, sub, thumb) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'game-win'
    b.setAttribute('role', 'radio')
    const same = game && game.source && choice && game.source.kind === choice.kind && (choice.kind === 'screen' || (game.source.title === choice.title && game.source.app === choice.app))
    b.setAttribute('aria-checked', String(!!same))
    const shot = document.createElement('span')
    shot.className = 'shot'
    if (thumb) shot.style.backgroundImage = 'url("' + thumb + '")'
    else shot.textContent = choice.kind === 'screen' ? 'Schermo' : 'ridotta a icona'
    const t = document.createElement('span')
    t.className = 't'
    t.textContent = label
    const a = document.createElement('span')
    a.className = 'a'
    a.textContent = sub
    b.append(shot, t, a)
    b.title = label + (sub ? ' — ' + sub : '')
    b.addEventListener('click', () => saveGame({ source: choice }))
    return b
  }
  async function loadGameWindows() {
    $('game-windows-note').textContent = 'Leggo le finestre aperte…'
    let list = []
    try { list = await api.visionSources() } catch (_) {}
    const cards = list.map(w => gameCard({ kind: 'window', title: w.title, app: w.app }, w.title, w.app + (w.minimized ? ' · ridotta a icona' : ''), w.thumb))
    cards.push(gameCard({ kind: 'screen' }, 'Tutto lo schermo', 'Quello su cui sta il companion', ''))
    $('game-windows').replaceChildren(...cards)
    $('game-windows-note').textContent = list.length ? '' : 'Nessun\'altra finestra aperta: apri il gioco e premi Aggiorna.'
  }
  function showGame(cfg) {
    if (!cfg || !cfg.game) return
    game = cfg.game
    gameCfg = cfg
    const s = game.source
    $('game-choice').textContent = !s ? 'Nessuna finestra scelta: scegli il gioco qui sotto.'
      : s.kind === 'screen' ? 'Guarda: tutto lo schermo del companion.'
        : 'Guarda: ' + (s.title || s.app) + (s.app && s.title ? ' (' + s.app + ')' : '')
    for (const b of document.querySelectorAll('#game-windows .game-win')) b.setAttribute('aria-checked', 'false')
    $('game-interval').value = String(game.intervalS)
    $('game-per-hour').value = String(game.perHour)
    showGameOutputs()
    showGameModel().catch(() => {})
  }
  // Quanto spesso guarda (Blocco 12b): l'intervallo minimo e il tetto all'ora.
  function showGameOutputs() {
    const s = Number($('game-interval').value)
    $('game-interval-out').textContent = 'ogni ' + (s < 60 ? s + ' s' : s % 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s / 60 + ' min')
    $('game-per-hour-out').textContent = $('game-per-hour').value + ' sguardi all\'ora'
  }
  for (const [id, key] of [['game-interval', 'intervalS'], ['game-per-hour', 'perHour']]) {
    $(id).addEventListener('input', showGameOutputs)
    $(id).addEventListener('change', () => saveGame({ [key]: Number($(id).value) }))
  }
  function showGameState(st) {
    if (!st) return
    const line = $('game-status')
    line.className = 'state' + (st.on && !st.paused ? ' ok' : '')
    line.textContent = st.on ? st.text : st.ended ? 'Si è fermata. ' + st.ended + '.' : 'Spenta: si accende con il pulsante "gioco" nella barra del companion o con il suo tasto rapido.'
    if (!st.on && st.ended) line.className = 'state error'
  }
  if (api.onGameState) api.onGameState(showGameState)
  if (api.gameState) api.gameState().then(showGameState, () => {})
  async function saveGame(partial) {
    try {
      const cfg = await api.setConfig({ game: partial })
      showGame(cfg)
      if ('source' in partial) loadGameWindows()
    } catch (_) {}
  }
  // I provider con la chiave (e Ollama), e i loro modelli che vedono le immagini.
  async function showGameModel() {
    const cfg = gameCfg
    if (!cfg) return
    const sel = $('game-provider')
    const providers = Object.keys(cfg.keyConfigured || {}).filter(p => cfg.keyConfigured[p]).concat('ollama').filter((p, i, a) => a.indexOf(p) === i)
    const want = game.vision ? game.vision.provider : ''
    sel.replaceChildren(new Option('Come la chat', ''), ...providers.map(p => new Option(p === 'openrouter' ? 'OpenRouter' : p === 'claude' ? 'Claude' : p === 'openai' ? 'OpenAI' : 'Ollama', p)))
    sel.value = want
    $('game-model-row').classList.toggle('hidden', !want)
    const note = $('game-model-note')
    if (!want) {
      let sees = null
      try { const m = (await api.listModels(cfg.provider)).models.find(x => x.id === cfg.model); sees = m && m.caps ? !!m.caps.vision : null } catch (_) {}
      note.textContent = 'Usa il modello della chat (' + cfg.model + ')' + (sees === true ? ', che vede le immagini.' : sees === false ? ', ma non vede le immagini: scegline uno qui (su OpenRouter ce ne sono di gratuiti).' : '. Con "Prova" vedi se vede le immagini.')
      return
    }
    note.textContent = 'Solo per guardare il gioco; la chat resta con il suo modello.'
    const models = $('game-model')
    models.replaceChildren(new Option('Carico i modelli…', ''))
    let list = []
    try { list = (await api.listModels(want)).models.filter(m => m.caps && m.caps.vision) } catch (_) {}
    // Quello salvato resta scelto anche se l'elenco non lo da' fra quelli che vedono.
    const saved = game.vision && game.vision.provider === want && game.vision.model !== '-' ? game.vision.model : ''
    if (saved && !list.some(m => m.id === saved)) list.unshift({ id: saved, label: saved + ' (da provare)' })
    models.replaceChildren(...list.map(m => new Option(m.label || m.id, m.id)))
    if (!list.length) models.replaceChildren(new Option('Nessun modello che vede le immagini', ''))
    if (game.vision && list.some(m => m.id === game.vision.model)) models.value = game.vision.model
    else if (list[0]) saveGame({ vision: { provider: want, model: list[0].id } })
  }
  $('game-provider').addEventListener('change', () => {
    const p = $('game-provider').value
    saveGame({ vision: p ? { provider: p, model: (game.vision && game.vision.provider === p && game.vision.model) || '-' } : null })
  })
  $('game-model').addEventListener('change', () => { if ($('game-model').value) saveGame({ vision: { provider: $('game-provider').value, model: $('game-model').value } }) })
  $('game-refresh').addEventListener('click', loadGameWindows)
  $('game-test').addEventListener('click', async () => {
    const note = $('game-test-note')
    const vision = game && game.vision ? game.vision : gameCfg ? { provider: gameCfg.provider, model: gameCfg.model } : null
    if (!vision) return
    note.textContent = 'Gli mostro un quadrato rosso…'
    $('game-test').disabled = true
    try {
      const r = await api.gameTestVision(vision)
      note.textContent = !r.ok ? 'Non riuscita: ' + r.error : r.sees ? 'Vede le immagini: ha detto "' + r.said + '" (' + (r.ms / 1000).toFixed(1).replace('.', ',') + ' s).' : 'Non sembra vedere le immagini: ha detto "' + r.said + '".'
    } catch (e) { note.textContent = 'Non riuscita: ' + e.message }
    $('game-test').disabled = false
  })
  document.addEventListener('settings-page-shown', (e) => { if (e.detail === 'visione') loadGameWindows() })
  if (!$('page-visione').classList.contains('hidden')) loadGameWindows()

  // ─── Streaming (Blocco 11c) ────────────────────────────────────────────────
  // Le impostazioni della live (config.stream), "In diretta" e il registro.
  const STREAM_STATES = { off: 'Spenta.', connecting: 'Mi collego…', connected: 'In diretta: leggo la chat di #', retry: 'Collegamento perso: riprovo fra ' }
  const OUTCOMES = { risposto: ['risposto', 'ok'], scelto: ['scelto', 'ok'], scartato: ['scartato', 'no'], evento: ['evento', ''], 'non riuscito': ['non riuscito', 'no'], inizio: ['', ''], fine: ['', ''] }
  function showStreamConfig(s) {
    if (!s) return
    if (document.activeElement !== $('stream-channel')) $('stream-channel').value = s.channel
    if (document.activeElement !== $('stream-command')) $('stream-command').value = s.command
    $('stream-per-minute').value = String(s.perMinute)
    $('stream-cooldown').value = String(s.userCooldownS)
    $('stream-spontaneous').value = String(s.spontaneousMin)
    if (document.activeElement !== $('stream-bots')) $('stream-bots').value = s.bots.join(', ')
    showStreamOutputs()
  }
  function showStreamOutputs() {
    $('stream-per-minute-out').textContent = $('stream-per-minute').value + ' al minuto'
    const cd = Number($('stream-cooldown').value)
    $('stream-cooldown-out').textContent = cd ? cd + ' s' : 'nessuna'
    const sp = Number($('stream-spontaneous').value)
    $('stream-spontaneous-out').textContent = sp ? 'ogni ' + sp + ' min' : 'spenti'
  }
  function showStreamState(st) {
    if (!st) return
    $('stream-live').checked = !!st.on
    const status = st.status || {}
    const line = $('stream-status')
    line.className = 'state' + (status.state === 'connected' ? ' ok' : '')
    line.textContent = !st.on ? '' : status.state === 'connected' ? STREAM_STATES.connected + status.channel + '.'
      : status.state === 'retry' ? STREAM_STATES.retry + status.retryIn + ' s.' + (status.note ? ' ' + status.note : '')
        : (status.note || STREAM_STATES[status.state] || '')
    const c = st.counts || {}
    $('stream-counts').replaceChildren(...[['ricevuti', c.received], ['risposte', c.answered], ['scartati', c.discarded], ['eventi', c.events]].map(([k, v]) => {
      const span = document.createElement('span')
      const b = document.createElement('b')
      b.textContent = String(v || 0)
      span.append(b, ' ' + k)
      return span
    }))
    const items = (st.log || []).map((e) => {
      const li = document.createElement('li')
      const time = document.createElement('time')
      time.textContent = new Date(e.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
      const body = document.createElement('span')
      body.className = 'what'
      if (e.user) { const who = document.createElement('span'); who.className = 'who'; who.textContent = e.user; body.append(who) }
      body.append(e.text || '')
      const [label, kind] = OUTCOMES[e.outcome] || [e.outcome, '']
      if (label) {
        const tag = document.createElement('span')
        tag.className = 'tag' + (kind ? ' ' + kind : '')
        tag.textContent = label + (e.by ? ' da ' + e.by : '') + (e.reason ? ': ' + e.reason : '')
        body.append(tag)
      }
      li.append(time, body)
      return li
    })
    $('stream-log').replaceChildren(...items)
    $('stream-log-empty').classList.toggle('hidden', items.length > 0)
  }
  async function saveStream(partial) {
    try { showStreamConfig((await api.setConfig({ stream: partial })).stream) } catch (_) {}
  }
  $('stream-channel').addEventListener('change', () => saveStream({ channel: $('stream-channel').value }))
  $('stream-command').addEventListener('change', () => saveStream({ command: $('stream-command').value }))
  for (const [id, key] of [['stream-per-minute', 'perMinute'], ['stream-cooldown', 'userCooldownS'], ['stream-spontaneous', 'spontaneousMin']]) {
    $(id).addEventListener('input', showStreamOutputs)
    $(id).addEventListener('change', () => saveStream({ [key]: Number($(id).value) }))
  }
  $('stream-bots').addEventListener('change', () => saveStream({ bots: $('stream-bots').value.split(/[\s,;]+/).filter(Boolean) }))
  $('stream-live').addEventListener('change', async () => {
    const want = $('stream-live').checked
    if (want) await saveStream({ channel: $('stream-channel').value })
    const r = await api.streamLive(want)
    showStreamState(r.state)
    if (!r.ok) { const line = $('stream-status'); line.className = 'state err'; line.textContent = r.error }
  })
  if (api.onStreamState) api.onStreamState(showStreamState)
  api.streamState().then(showStreamState).catch(() => {})

  // ─── Generale ──────────────────────────────────────────────────────────────
  // Si salva subito: niente pulsante. Il main cerca la citta' del meteo e
  // risponde con weatherStatus (trovata, o perche' no).
  const loginRow = $('login-row')
  const loginItem = $('login-item')
  const idleLife = $('idle-life')
  const touchReactions = $('touch-reactions')
  const danceMusic = $('dance-music')
  const danceApps = $('dance-apps')
  const weatherOn = $('weather-on')
  const weatherCity = $('weather-city')
  function showGeneral(cfg) {
    idleLife.checked = cfg.idleLife !== false
    $('needs-on').checked = cfg.needs !== false
    touchReactions.checked = cfg.touchReactions !== false
    $('initiative').checked = cfg.initiative !== false
    $('active-app').checked = cfg.activeApp === true
    $('active-app-section').classList.toggle('hidden', cfg.activeApp !== true)
    if (document.activeElement !== $('active-app-ignore')) $('active-app-ignore').value = (cfg.activeAppIgnore || []).join(', ')
    $('initiative-voice').checked = cfg.initiativeVoice === true
    $('hud-pinned').checked = cfg.hudPinned === true
    danceMusic.checked = cfg.danceMusic === true
    $('dance-section').classList.toggle('hidden', !danceMusic.checked)
    if (document.activeElement !== danceApps) danceApps.value = (cfg.danceApps || []).join(', ')
    weatherOn.checked = cfg.weather === true
    $('weather-section').classList.toggle('hidden', !weatherOn.checked)
    if (document.activeElement !== weatherCity) weatherCity.value = cfg.weatherCity || ''
    $('weather-status').textContent = cfg.weather && cfg.weatherStatus ? '→ ' + cfg.weatherStatus : ''
    showKeys(cfg)
    showStreamConfig(cfg.stream)
    showGame(cfg)
  }
  async function saveGeneral(partial) {
    try { showGeneral(await api.setConfig(partial)) } catch (_) {}
  }
  // "Avvia con Windows" esiste solo nell'app installata: in sviluppo la riga resta nascosta.
  ;(async () => {
    try {
      const state = await api.getLoginItem()
      loginRow.classList.toggle('hidden', !state.supported)
      loginItem.checked = !!state.enabled
    } catch (_) { loginRow.classList.add('hidden') }
  })()
  loginItem.addEventListener('change', async () => {
    try { loginItem.checked = !!(await api.setLoginItem(loginItem.checked)).enabled } catch (_) {}
  })
  idleLife.addEventListener('change', () => saveGeneral({ idleLife: idleLife.checked }))
  $('needs-on').addEventListener('change', (e) => saveGeneral({ needs: e.target.checked }))
  touchReactions.addEventListener('change', () => saveGeneral({ touchReactions: touchReactions.checked }))
  $('initiative').addEventListener('change', (e) => saveGeneral({ initiative: e.target.checked }))
  $('active-app').addEventListener('change', (e) => {
    $('active-app-section').classList.toggle('hidden', !e.target.checked)
    saveGeneral({ activeApp: e.target.checked })
  })
  $('active-app-ignore').addEventListener('change', (e) => saveGeneral({ activeAppIgnore: e.target.value.split(/[,;\n]+/) }))
  $('active-app-ignore').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur() })
  $('initiative-voice').addEventListener('change', (e) => saveGeneral({ initiativeVoice: e.target.checked }))
  $('hud-pinned').addEventListener('change', (e) => saveGeneral({ hudPinned: e.target.checked }))
  danceMusic.addEventListener('change', () => saveGeneral({ danceMusic: danceMusic.checked }))
  danceApps.addEventListener('change', () => saveGeneral({ danceApps: danceApps.value.split(/[,;\n]+/) }))
  danceApps.addEventListener('keydown', (e) => { if (e.key === 'Enter') danceApps.blur() })
  weatherOn.addEventListener('change', () => saveGeneral({ weather: weatherOn.checked, weatherCity: weatherCity.value }))
  weatherCity.addEventListener('change', () => saveGeneral({ weatherCity: weatherCity.value }))
  weatherCity.addEventListener('keydown', (e) => { if (e.key === 'Enter') weatherCity.blur() })

  // Chibi, per l'avatar in vista: lo sa il main, dopo che il companion l'ha
  // caricato. Grigio, con il motivo, per Live2D, 2D e modelli senza scheletro.
  const chibi = $('chibi')
  const CHIBI_NOTE = $('chibi-note').textContent
  function showChibi(state) {
    const s = state || { available: false, reason: 'nessun avatar in vista', on: false }
    chibi.checked = !!s.on
    chibi.disabled = !s.available
    $('chibi-row').classList.toggle('disabled', !s.available)
    $('chibi-note').textContent = s.available ? CHIBI_NOTE : 'Non disponibile: ' + s.reason + '.'
  }
  if (api.chibiState) api.chibiState().then(showChibi).catch(() => showChibi(null))
  if (api.onChibiState) api.onChibiState(showChibi)
  chibi.addEventListener('change', async () => {
    try { showChibi(await api.setChibi(chibi.checked)) } catch (_) {}
  })

  // Config cambiata altrove (chat, menu sull'avatar, o questa finestra): gli
  // interruttori si allineano. La scheda Modello si ricarica solo se provider,
  // modello o chiavi sono cambiati davvero, per non perdere una scelta a meta'.
  if (api.onConfigChanged) api.onConfigChanged((cfg) => {
    if (!cfg) return
    showGeneral(cfg)
    if (formKey(cfg) !== formShown) loadForm(cfg)
    // Altra persona, o voce cambiata dalla scheda Voce: la scheda Persone si rilegge.
    if (personaData) api.personasGet().then(d => showPersonas(d)).catch(() => {})
  })

  const micEnabled = $('mic-enabled')
  const shortcutSel = $('mic-shortcut')

  let voice = { enabled: false, engine: 'kokoro', kokoroVoice: 'if_sara', speed: 1, volume: 0.9, xttsSpeaker: 'sample', xttsSample: null, cpmlAccepted: false, micEnabled: false, micShortcut: 'Ctrl+Alt+M', micDevice: '', micDeviceLabel: '' }
  let status = null
  let check = null        // { gpu, freeBytes } dal main
  let speakersLoaded = false
  let micShortcutActive = null   // la scorciatoia registrata davvero dal main

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0) + ' MB'
  const gb = (bytes) => (bytes / 1024 / 1024 / 1024).toFixed(1).replace('.', ',') + ' GB'
  const size = (bytes) => (bytes >= 1024 * 1024 * 1024 ? gb(bytes) : mb(bytes))
  const XTTS_NEEDS = 10 * 1024 * 1024 * 1024   // durante l'installazione, cache compresa

  function showChoices() {
    enabled.checked = !!voice.enabled
    for (const r of engines) r.checked = r.value === voice.engine
    for (const r of radios) r.checked = r.value === voice.kokoroVoice
    cpml.checked = !!voice.cpmlAccepted
    if (![...speakerSel.options].some(o => o.value === voice.xttsSpeaker)) {
      const o = document.createElement('option')
      o.value = voice.xttsSpeaker
      o.textContent = voice.xttsSpeaker
      speakerSel.appendChild(o)
    }
    speakerSel.value = voice.xttsSpeaker
    speed.value = String(voice.speed)
    volume.value = String(voice.volume)
    $('speed-out').textContent = Number(speed.value).toFixed(2) + '×'
    $('volume-out').textContent = Math.round(Number(volume.value) * 100) + '%'
    $('sample-note').textContent = voice.xttsSample ? 'Campione pronto.' : 'Nessun campione: 10-30 secondi di una sola voce, senza musica.'
    micEnabled.checked = !!voice.micEnabled
    shortcutSel.value = voice.micShortcut
    $('mic-sensitivity').value = String(voice.micSensitivity == null ? 0.5 : voice.micSensitivity)
    $('mic-sensitivity-out').textContent = Math.round(Number($('mic-sensitivity').value) * 100) + '%'
    $('mic-headphones').checked = !!voice.headphones
  }

  function showStt(s, x) {
    const installing = s.installing
    const line = $('stt-line')
    line.className = 'state'
    if (!x.available) line.textContent = 'Non disponibile in questa versione.'
    else if (installing) line.textContent = 'Installazione in corso: puoi chiudere questa finestra, continua lo stesso.'
    else if (!x.installed) line.textContent = 'Prima installa XTTS (scheda Voce): il microfono usa il suo Python e la sua scheda video.'
    else if (!s.installed) line.textContent = 'Non installato.'
    else if (s.ready) { line.textContent = 'Pronto: ti ascolto quando vuoi.'; line.classList.add('ok') }
    else if (s.loading || (voice.micEnabled && x.state === 'loading')) line.textContent = 'Si sta accendendo…'
    else line.textContent = voice.micEnabled ? 'Installato.' : 'Installato. Accendilo qui sopra per parlare.'
    if (s.error && !installing) { line.textContent += ' Errore: ' + s.error; line.classList.remove('ok'); line.classList.add('error') }

    $('stt-step').classList.toggle('hidden', !installing)
    $('stt-bar').classList.toggle('hidden', !installing)
    if (installing) {
      const bytes = installing.total ? ' (' + size(installing.done) + ' di ' + size(installing.total) + ')' : ''
      $('stt-step').textContent = 'Passo ' + (installing.index + 1) + ' di ' + installing.count + ': ' + installing.label + bytes
      const part = installing.total ? installing.done / installing.total : 0
      $('stt-bar-fill').style.width = Math.round(100 * (installing.index + part) / installing.count) + '%'
    }
    const busy = !!installing || !!x.installing
    $('stt-install').classList.toggle('hidden', s.installed || !!installing)
    $('stt-install').disabled = !x.installed || busy
    $('stt-cancel').classList.toggle('hidden', !installing)
    $('stt-remove').classList.toggle('hidden', !s.installed || !!installing)
    for (const el of document.querySelectorAll('.mic-ready')) el.classList.toggle('hidden', !s.installed)
    $('mic-test').disabled = !voice.micEnabled
    const note = $('shortcut-note')
    const taken = s.installed && voice.micEnabled && voice.micShortcut !== 'off' && micShortcutActive !== voice.micShortcut
    shortcutSel.disabled = !s.installed
    note.classList.toggle('warn', taken)
    if (!s.installed) note.textContent = 'Serve il microfono: si installa nella pagina Microfono.'
    else if (!voice.micEnabled) note.textContent = 'Accendi il microfono (pagina Microfono) per usarla.'
    else if (voice.micShortcut === 'off') note.textContent = 'Parli solo con il pulsante del microfono nella chat.'
    else if (taken) note.textContent = 'La usa già un altro programma: scegline un\'altra.'
    else note.textContent = 'Tieni premuto, parla, lascia: funziona anche con la chat chiusa.'
  }

  function showKokoro(s) {
    const downloading = !!s.downloading
    $('files-line').textContent = s.installed
      ? 'File installati (' + mb(s.total) + ').'
      : downloading ? 'Scaricamento: ' + mb(s.downloading.done) + ' di ' + mb(s.downloading.total)
        : 'Da scaricare: ' + mb(s.total - s.have) + (s.have ? ' (ne restano da prima ' + mb(s.have) + ')' : '') + '.'
    $('bar').classList.toggle('hidden', !downloading)
    if (downloading) $('bar-fill').style.width = Math.round(100 * s.downloading.done / Math.max(1, s.downloading.total)) + '%'
    $('download-btn').classList.toggle('hidden', s.installed || downloading)
    $('cancel-btn').classList.toggle('hidden', !downloading)
    $('remove-btn').disabled = downloading || (!s.installed && !s.have)
    const state = $('engine-state')
    state.className = 'state'
    if (s.error) { state.textContent = 'Errore: ' + s.error; state.classList.add('error') }
    else if (s.engine === 'loading') state.textContent = 'Kokoro si sta caricando…'
    else if (s.engine === 'ready') { state.textContent = 'Kokoro pronto.'; state.classList.add('ok') }
    else state.textContent = s.installed ? 'Si carica alla prima frase, e si ferma dopo qualche minuto di silenzio.' : ''
  }

  function showXtts(x) {
    const installing = x.installing
    const line = $('xtts-line')
    line.className = 'state'
    if (!x.available) line.textContent = 'Non disponibile in questa versione.'
    else if (installing) line.textContent = 'Installazione in corso: puoi chiudere questa finestra, continua lo stesso.'
    else if (!x.installed) line.textContent = 'Non installato.'
    else if (x.state === 'ready') { line.textContent = 'Pronto' + (x.info && x.info.gpu ? ' su ' + x.info.gpu : '') + '.'; line.classList.add('ok') }
    else if (x.state === 'loading') line.textContent = 'Si sta accendendo (circa 30 secondi)…'
    else line.textContent = 'Installato. Si accende quando la voce è attiva e usa XTTS.'
    if (x.error && !installing) { line.textContent += ' Errore: ' + x.error; line.classList.remove('ok'); line.classList.add('error') }

    $('xtts-step').classList.toggle('hidden', !installing)
    $('xtts-bar').classList.toggle('hidden', !installing)
    if (installing) {
      const bytes = installing.total ? ' (' + size(installing.done) + ' di ' + size(installing.total) + ')' : ''
      $('xtts-step').textContent = 'Passo ' + (installing.index + 1) + ' di ' + installing.count + ': ' + installing.label + bytes
      const part = installing.total ? installing.done / installing.total : 0
      $('xtts-bar-fill').style.width = Math.round(100 * (installing.index + part) / installing.count) + '%'
    }

    const req = []
    if (check) {
      req.push(check.gpu ? 'Scheda video: ' + check.gpu.name + (check.gpu.memoryMB ? ', ' + gb(check.gpu.memoryMB * 1024 * 1024) : '') + '.' : 'Nessuna scheda NVIDIA trovata: XTTS non si può usare.')
      if (!x.installed && check.freeBytes !== null) req.push('Spazio libero: ' + gb(check.freeBytes) + (check.freeBytes < XTTS_NEEDS ? ', ne servono circa 10 durante l\'installazione.' : '.'))
    }
    $('xtts-req').textContent = req.join(' ')

    const canInstall = x.available && !x.installed && !installing && cpml.checked && !!(check && check.gpu)
    $('xtts-install').classList.toggle('hidden', x.installed || !!installing)
    $('xtts-install').disabled = !canInstall
    $('xtts-cancel').classList.toggle('hidden', !installing)
    $('xtts-remove').classList.toggle('hidden', !x.installed || !!installing)
    for (const el of document.querySelectorAll('.xtts-voice')) el.classList.toggle('hidden', !x.installed)
    // Solo con XTTS caricato: acceso per il solo microfono, l'elenco non c'e'.
    if (x.installed && x.state === 'ready' && (x.loaded || []).includes('tts') && !speakersLoaded) loadSpeakers()
  }

  function showStatus() {
    if (!status) return
    showKokoro(status)
    if (status.xtts) showXtts(status.xtts)
    if (status.stt && status.xtts) showStt(status.stt, status.xtts)
    const usable = status.installed || (status.xtts && status.xtts.installed)
    $('test-btn').disabled = !usable
    $('enable-note').textContent = voice.enabled && !usable ? 'Per sentirla, installa XTTS o scarica Kokoro (qui sotto).' : ''
  }

  async function loadSpeakers() {
    speakersLoaded = true
    try {
      const names = await api.voiceXttsSpeakers()
      if (!names.length) { speakersLoaded = false; return }
      speakerSel.replaceChildren(new Option('La mia voce (campione)', 'sample'), ...names.map(n => new Option(n, n)))
      speakerSel.value = voice.xttsSpeaker
      refreshPersonaVoices()
    } catch (_) { speakersLoaded = false }
  }

  async function save(partial) {
    try {
      const cfg = await api.setConfig({ voice: partial })
      voice = { ...voice, ...(cfg.voice || {}) }
      micShortcutActive = cfg.micShortcutActive || null
    } catch (e) { $('test-note').textContent = 'Salvataggio non riuscito: ' + e.message }
    showChoices()
    showStatus()
  }

  enabled.addEventListener('change', () => save({ enabled: enabled.checked }))
  for (const r of engines) r.addEventListener('change', () => { if (r.checked) save({ engine: r.value }) })
  for (const r of radios) r.addEventListener('change', () => { if (r.checked) save({ kokoroVoice: r.value }) })
  cpml.addEventListener('change', () => save({ cpmlAccepted: cpml.checked }))
  speakerSel.addEventListener('change', () => save({ xttsSpeaker: speakerSel.value }))
  speed.addEventListener('input', () => { $('speed-out').textContent = Number(speed.value).toFixed(2) + '×' })
  speed.addEventListener('change', () => save({ speed: Number(speed.value) }))
  volume.addEventListener('input', () => { $('volume-out').textContent = Math.round(Number(volume.value) * 100) + '%' })
  volume.addEventListener('change', () => save({ volume: Number(volume.value) }))
  $('license-link').addEventListener('click', (e) => { e.preventDefault(); api.voiceOpenLicense() })

  $('test-btn').addEventListener('click', async () => {
    const note = $('test-note')
    note.textContent = 'Preparo la voce…'
    $('test-btn').disabled = true
    try {
      const res = await api.voiceTest({ engine: voice.engine, kokoroVoice: voice.kokoroVoice, xttsSpeaker: voice.xttsSpeaker, speed: Number(speed.value), volume: Number(volume.value) })
      note.textContent = res && res.ok ? '' : 'Non ha parlato: ' + ((res && res.error) || 'errore sconosciuto')
    } catch (e) { note.textContent = 'Non ha parlato: ' + e.message }
    showStatus()
  })
  $('stop-btn').addEventListener('click', () => api.voiceStop())

  $('download-btn').addEventListener('click', async () => {
    $('download-btn').disabled = true
    try { status = await api.voiceDownload() } catch (e) { $('engine-state').textContent = 'Errore: ' + e.message }
    $('download-btn').disabled = false
    showStatus()
  })
  $('cancel-btn').addEventListener('click', () => api.voiceCancelDownload())
  $('remove-btn').addEventListener('click', async () => {
    if (!confirmClick($('remove-btn'), 'Si cancellano i file di Kokoro. Si possono riscaricare quando vuoi.')) return
    try { status = await api.voiceRemove() } catch (_) { /* lo stato arriva comunque */ }
    showStatus()
  })

  $('xtts-install').addEventListener('click', async () => {
    if (check && check.freeBytes !== null && check.freeBytes < XTTS_NEEDS &&
      !confirmClick($('xtts-install'), 'Lo spazio libero sembra poco: servono circa 10 GB. Clic di nuovo per provare lo stesso.')) return
    try { status = await api.voiceXttsInstall() } catch (e) { $('xtts-line').textContent = 'Errore: ' + e.message }
    speakersLoaded = false
    showStatus()
  })
  $('xtts-cancel').addEventListener('click', () => api.voiceXttsCancel())
  $('xtts-remove').addEventListener('click', async () => {
    if (!confirmClick($('xtts-remove'), 'Si cancellano Python, i pacchetti e il modello (circa 7 GB), e con loro il microfono. Il campione della tua voce resta.')) return
    try { status = await api.voiceXttsRemove() } catch (_) { /* lo stato arriva comunque */ }
    speakersLoaded = false
    showStatus()
  })
  $('sample-btn').addEventListener('click', async () => {
    const note = $('sample-note')
    note.textContent = status && status.xtts && status.xtts.state === 'ready' ? 'Preparo il campione…' : 'Preparo il campione (prima si accende XTTS: circa 30 secondi)…'
    $('sample-btn').disabled = true
    try {
      const res = await api.voiceImportSample()
      if (res && res.ok) {
        voice = { ...voice, ...(res.config.voice || {}) }
        showChoices()
        note.textContent = 'Campione pronto: ' + String(res.seconds).replace('.', ',') + ' secondi di voce.'
      } else showChoices()
    } catch (e) { note.textContent = 'Campione non importato: ' + e.message }
    $('sample-btn').disabled = false
  })

  // ─── Microfono ─────────────────────────────────────────────────────────────
  micEnabled.addEventListener('change', async () => { await save({ micEnabled: micEnabled.checked }); loadDevices() })
  // Mani libere (Blocco 11b): la soglia del rilevatore e le cuffie.
  $('mic-sensitivity').addEventListener('input', () => { $('mic-sensitivity-out').textContent = Math.round(Number($('mic-sensitivity').value) * 100) + '%' })
  $('mic-sensitivity').addEventListener('change', () => save({ micSensitivity: Number($('mic-sensitivity').value) }))
  $('mic-headphones').addEventListener('change', () => save({ headphones: $('mic-headphones').checked }))
  shortcutSel.addEventListener('change', () => save({ micShortcut: shortcutSel.value }))

  // I microfoni di Windows. I nomi li da' Chromium solo con il permesso, cioe'
  // con il microfono acceso: spento, il menu mostra solo la scelta salvata.
  const deviceSel = $('mic-device')
  const DEFAULT_NAME = 'Predefinito di Windows'
  async function loadDevices() {
    const saved = voice.micDevice ? new Option(voice.micDeviceLabel || 'Microfono scelto', voice.micDevice) : new Option(DEFAULT_NAME, '')
    if (!window.MicRecorder || !voice.micEnabled) {
      deviceSel.replaceChildren(saved)
      deviceSel.disabled = true
      $('device-note').textContent = ''
      return
    }
    let list = { devices: [], defaultLabel: '' }
    try { list = await MicRecorder.listInputs() } catch (_) { /* elenco vuoto: solo il predefinito */ }
    const pick = MicRecorder.pickInput(list.devices, { id: voice.micDevice, label: voice.micDeviceLabel })
    const options = [new Option(DEFAULT_NAME + (list.defaultLabel ? ' (' + list.defaultLabel + ')' : ''), '')]
    for (const d of list.devices) options.push(new Option(d.label || 'Microfono senza nome', d.id))
    if (pick.missing) options.push(new Option((voice.micDeviceLabel || 'Microfono scelto') + ' (non collegato)', voice.micDevice))
    deviceSel.replaceChildren(...options)
    deviceSel.value = pick.missing ? voice.micDevice : (pick.id || '')
    deviceSel.disabled = false
    $('device-note').textContent = pick.missing ? 'Il microfono scelto non è collegato: finché non torna uso quello predefinito.' : ''
    // Ritrovato per nome con un id nuovo: si salva quello nuovo.
    if (voice.micDevice && pick.id && pick.id !== voice.micDevice) save({ micDevice: pick.id, micDeviceLabel: voice.micDeviceLabel })
  }
  deviceSel.addEventListener('change', async () => {
    const option = deviceSel.selectedOptions[0]
    const label = deviceSel.value && option ? option.textContent.replace(/ \(non collegato\)$/, '') : ''
    await save({ micDevice: deviceSel.value, micDeviceLabel: label })
    loadDevices()
  })
  // Un microfono collegato o staccato mentre la finestra e' aperta.
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => loadDevices())
  $('stt-install').addEventListener('click', async () => {
    try { status = await api.voiceSttInstall() } catch (e) { $('stt-line').textContent = 'Errore: ' + e.message }
    try { micShortcutActive = (await api.getConfig()).micShortcutActive || null } catch (_) {}
    showStatus()
  })
  $('stt-cancel').addEventListener('click', () => api.voiceSttCancel())
  $('stt-remove').addEventListener('click', async () => {
    if (!confirmClick($('stt-remove'), 'Si cancella il modello Whisper (1,6 GB). Si può reinstallare quando vuoi.')) return
    try { status = await api.voiceSttRemove() } catch (_) { /* lo stato arriva comunque */ }
    micShortcutActive = null
    showStatus()
  })

  // Prova: tieni premuto, parla, lascia. Il testo si mostra qui, non va in chat.
  const testBtn = $('mic-test')
  const testNote = $('mic-test-note')
  const level = $('mic-level')
  let recorder = null
  let testing = false
  testBtn.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0 || testing || !window.MicRecorder) return
    testing = true
    try { testBtn.setPointerCapture(e.pointerId) } catch (_) {}
    api.voiceStop()
    recorder = recorder || new MicRecorder({ onLevel: (l) => { $('mic-level-fill').style.width = Math.round(l * 100) + '%' } })
    testBtn.classList.add('listening')
    $('mic-level-fill').style.width = '0%'
    level.classList.remove('hidden')
    testNote.textContent = 'Ti ascolto…'
    try {
      await recorder.start({ deviceId: voice.micDevice, deviceLabel: voice.micDeviceLabel })
      if (recorder.missing) testNote.textContent = 'Ti ascolto dal microfono predefinito (quello scelto non è collegato)…'
    } catch (err) {
      testing = false
      testBtn.classList.remove('listening')
      level.classList.add('hidden')
      testNote.textContent = 'Microfono non disponibile: ' + (err.message || err.name)
    }
  })
  const testRelease = async () => {
    if (!testing || !recorder) return
    testBtn.classList.remove('listening')
    level.classList.add('hidden')
    const pcm = await recorder.stop()
    if (pcm.length < 16000 * 0.3) { testing = false; testNote.textContent = 'Troppo breve: tieni premuto mentre parli.'; return }
    const ready = status && status.stt && status.stt.ready
    testNote.textContent = ready ? 'Trascrivo…' : 'Trascrivo (prima si accende Whisper: qualche secondo)…'
    try {
      const res = await api.micTranscribe(pcm)
      const secs = (n) => String(n).replace('.', ',')
      testNote.textContent = !res.ok ? 'Errore: ' + res.error
        : res.text ? 'Ho sentito: «' + res.text + '» (' + secs(res.seconds) + ' s di audio in ' + secs(res.took) + ' s)'
          : 'Non ho sentito parole. Prova più vicino al microfono.'
    } catch (err) { testNote.textContent = 'Errore: ' + err.message }
    testing = false
  }
  testBtn.addEventListener('pointerup', testRelease)
  testBtn.addEventListener('pointercancel', testRelease)

  // ─── Live2D: il Cubism Core ────────────────────────────────────────────────
  // Si scarica solo con la licenza accettata (live2dAccepted, ricontrollata dal
  // main). Lo stato arriva da solo mentre cambia (live2d-status).
  const l2dLicense = $('l2d-license')
  let l2dAccepted = false
  let l2d = null
  function showLive2D() {
    if (!l2d) return
    const installing = l2d.installing
    const line = $('l2d-line')
    line.className = 'state'
    if (installing) line.textContent = 'Scaricamento in corso: puoi chiudere questa finestra, continua lo stesso.'
    else if (l2d.installed) { line.textContent = 'Cubism Core installato (SDK ' + l2d.sdk + '): gli avatar Live2D si possono usare.'; line.classList.add('ok') }
    else line.textContent = 'Cubism Core non installato: gli avatar Live2D non si possono mostrare.'
    if (l2d.error && !installing) { line.textContent += ' Errore: ' + l2d.error; line.classList.remove('ok'); line.classList.add('error') }
    $('l2d-step').classList.toggle('hidden', !installing)
    $('l2d-bar').classList.toggle('hidden', !installing)
    if (installing) {
      const bytes = installing.total ? ' (' + size(installing.done) + ' di ' + size(installing.total) + ')' : ''
      $('l2d-step').textContent = 'Passo ' + (installing.index + 1) + ' di ' + installing.count + ': ' + installing.label + bytes
      const part = installing.total ? installing.done / installing.total : 0
      $('l2d-bar-fill').style.width = Math.round(100 * (installing.index + part) / installing.count) + '%'
    }
    l2dLicense.checked = l2dAccepted
    $('l2d-install').classList.toggle('hidden', l2d.installed || !!installing)
    $('l2d-install').disabled = !l2dAccepted
    $('l2d-cancel').classList.toggle('hidden', !installing)
    $('l2d-remove').classList.toggle('hidden', !l2d.installed || !!installing)
  }
  l2dLicense.addEventListener('change', async () => {
    try { l2dAccepted = (await api.setConfig({ live2dAccepted: l2dLicense.checked })).live2dAccepted === true } catch (_) {}
    showLive2D()
  })
  $('l2d-license-link').addEventListener('click', (e) => { e.preventDefault(); api.live2dOpenLicense() })
  $('l2d-install').addEventListener('click', async () => {
    try { l2d = await api.live2dInstall() } catch (e) { l2d = { ...(l2d || {}), error: e.message } }
    showLive2D()
  })
  $('l2d-cancel').addEventListener('click', () => api.live2dCancel())
  $('l2d-remove').addEventListener('click', async () => {
    if (!confirmClick($('l2d-remove'), 'Si cancella il Cubism Core: gli avatar Live2D non si vedranno finché non lo riscarichi.')) return
    try { l2d = await api.live2dRemove() } catch (_) { /* lo stato arriva comunque */ }
    showLive2D()
  })
  if (api.onLive2DStatus) api.onLive2DStatus((s) => { l2d = s; showLive2D() })

  // Movimenti ed espressioni del modello in vista: per ogni gesto e ogni
  // emozione "Automatico" (la proposta dai nomi, live2d-map.js), un gruppo
  // o un'espressione del modello, o "Nessuno".
  const GESTURE_LABELS = {
    wave: 'Saluto', happy: 'Felice', click: 'Clic sull\'avatar', dance: 'Ballo', think: 'Pensa', stretch: 'Si stiracchia', yawn: 'Sbadiglio', search: 'Cerca',
    pat: 'Carezza', flinch: 'Sussulto', giggle: 'Risatina', hop: 'Saltello', shy: 'Imbarazzo', scold: 'Rimprovero', turnaway: 'Si gira di spalle',
  }
  const EMOTION_LABELS = { joy: 'Allegria', affection: 'Affetto', sadness: 'Malinconia', annoyance: 'Fastidio', curiosity: 'Curiosità', calm: 'Calma' }
  let l2dModel = null   // { model: { id, name, groups, expressions }, choices: { motions, expressions } }
  function choiceRows(host, labels, proposed, names, chosen, kind) {
    const rows = Object.keys(labels).map((key) => {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('label')
      label.className = 'name'
      label.textContent = labels[key]
      const select = document.createElement('select')
      select.id = 'l2d-' + kind + '-' + key
      label.htmlFor = select.id
      select.append(new Option('Automatico' + (proposed[key] ? ' (' + proposed[key] + ')' : ' (nessuno)'), '__auto'), new Option('Nessuno', ''), ...names.map(n => new Option(n, n)))
      select.value = Object.prototype.hasOwnProperty.call(chosen, key) ? chosen[key] : '__auto'
      select.addEventListener('change', saveChoices)
      row.append(label, select)
      return row
    })
    host.replaceChildren(...rows)
  }
  function readChoices(kind, labels) {
    const out = {}
    for (const key of Object.keys(labels)) {
      const value = $('l2d-' + kind + '-' + key).value
      if (value !== '__auto') out[key] = value
    }
    return out
  }
  async function saveChoices() {
    if (!l2dModel) return
    const st = $('l2d-choice-state')
    st.className = 'state'
    try {
      l2dModel.choices = await api.live2dSetChoices(l2dModel.model.id, {
        motions: readChoices('motion', GESTURE_LABELS),
        expressions: l2dModel.model.expressions.length ? readChoices('expression', EMOTION_LABELS) : {},
      })
      st.textContent = 'Salvato.'
      st.classList.add('ok')
    } catch (e) { st.textContent = 'Non salvato: ' + e.message; st.classList.add('error') }
  }
  function showLive2DModel() {
    const has = !!(l2dModel && l2dModel.model)
    $('l2d-model-none').classList.toggle('hidden', has)
    $('l2d-model-box').classList.toggle('hidden', !has)
    if (!has) return
    const { model, choices } = l2dModel
    $('l2d-model-name').textContent = model.name + ': ' + model.groups.length + ' gruppi di movimenti' +
      (model.expressions.length ? ', ' + model.expressions.length + ' espressioni.' : ', nessuna espressione (l\'umore piega la bocca).')
    choiceRows($('l2d-motions'), GESTURE_LABELS, window.Live2DMap.proposeMotionMap(model.groups), model.groups, (choices && choices.motions) || {}, 'motion')
    if (model.expressions.length) choiceRows($('l2d-expressions'), EMOTION_LABELS, window.Live2DMap.proposeExpressionMap(model.expressions), model.expressions, (choices && choices.expressions) || {}, 'expression')
    else $('l2d-expressions').replaceChildren()
  }
  if (api.onLive2DModel) api.onLive2DModel((m) => { l2dModel = m; showLive2DModel() })
  ;(async () => {
    try { l2dModel = await api.live2dModel() } catch (_) { l2dModel = null }
    showLive2DModel()
  })()
  ;(async () => {
    try { l2dAccepted = (await api.getConfig()).live2dAccepted === true } catch (_) {}
    try { l2d = await api.live2dStatus() } catch (_) { l2d = { installed: false, installing: null, error: null, sdk: '' } }
    showLive2D()
  })()

  if (api.onVoiceStatus) api.onVoiceStatus((s) => { status = s; showStatus() })

  ;(async () => {
    try {
      const cfg = await api.getConfig()
      loadForm(cfg)
      showGeneral(cfg)
      voice = { ...voice, ...(cfg.voice || {}) }
      micShortcutActive = cfg.micShortcutActive || null
      shortcutSel.replaceChildren(...(cfg.micShortcuts || []).map(s => new Option(s.label, s.id)))
    } catch (_) { /* restano i predefiniti */ }
    showChoices()
    loadDevices()
    try { status = await api.voiceStatus() } catch (_) { status = null }
    showStatus()
    try { check = await api.voiceXttsCheck() } catch (_) { check = null }
    showStatus()
  })()
})()
