// ── Accesso al bridge sicuro ────────────────────────────────────────────────
const api = window.companion

// ── State ───────────────────────────────────────────────────────────────────
let config = {}

// ── Conversazioni (Blocco 9b) ───────────────────────────────────────────────
// Una per ogni companion (la chat singola: 'p:<id>') e una di gruppo
// ('group'), ognuna con la sua cronologia e i suoi messaggi; a schermo c'e'
// quella corrente. Le risposte che arrivano tardi vanno nella loro, anche se
// nel frattempo l'utente e' passato a un'altra.
const conversations = new Map()
let currentKey = null
const singleKey = (id) => 'p:' + id
const isGroupKey = (key) => key === 'group'
function conv(key = currentKey) {
  if (!conversations.has(key)) conversations.set(key, { history: [], items: [] })
  return conversations.get(key)
}
function pushHistory(key, entry) {
  const c = conv(key)
  c.history.push(entry)
  // Cap history: ultime 40 voci per evitare payload enormi / 400 provider
  if (c.history.length > 40) c.history = c.history.slice(-40)
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const setupOverlay   = document.getElementById('setup-overlay')
const saveBtn        = document.getElementById('save-btn')
const messagesEl     = document.getElementById('messages')
const inputEl        = document.getElementById('input')
const sendBtn        = document.getElementById('send-btn')
const providerBadge  = document.getElementById('provider-badge')
const settingsBtn    = document.getElementById('settings-btn')
const clearBtn       = document.getElementById('clear-btn')
const closeBtn       = document.getElementById('close-btn')
const memoryFooter   = document.getElementById('memory-footer')
const memoryInfo     = document.getElementById('memory-info')
const compactBtn     = document.getElementById('compact-btn')
const forgetBtn      = document.getElementById('forget-btn')
const moreBtn        = document.getElementById('more-btn')
const moreMenu       = document.getElementById('more-menu')
const Faces          = window.CompanionFaces

// Provider, modello e chiave: la stessa scheda della pagina Modello nelle
// Impostazioni (provider-form.js). Qui serve solo al primo avvio, finche'
// manca la chiave; dopo si cambia tutto dalle Impostazioni.
const providerForm = window.ProviderForm.mount(document.getElementById('provider-form'), { api })

// L'elenco dal vivo ha i nomi leggibili dei modelli di OpenRouter.
document.getElementById('provider-form').addEventListener('models', () => updateBadge())

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    if (!api || !api.getConfig) throw new Error('bridge companion mancante')
    config = await api.getConfig()
  } catch (e) {
    messagesEl.insertAdjacentHTML('beforeend', '<div class="msg error">Bridge Electron non disponibile (apri via npm start).</div>')
    config = { provider: 'openrouter', model: '', keyConfigured: {}, providers: {} }
  }

  providerForm.load(config)
  // Quale chat e' questa finestra (Blocco 9b): quella di gruppo, o quella
  // singola di un companion, dall'indirizzo che le ha dato il main.
  const params = new URLSearchParams(location.search)
  currentKey = params.get('mode') === 'group' ? 'group' : singleKey(params.get('persona') || (config.persona ? config.persona.id : 'default'))
  document.body.classList.toggle('group-chat', isGroupKey(currentKey))
  if (isGroupKey(currentKey)) document.getElementById('welcome')?.remove()
  updateBadge()
  loadFaces()
  updateMemoryFooter()
  showMicButton()
  if (api && api.getMood) api.getMood().then(showMood).catch(() => {})

  // La configurazione si mostra solo se non c'e' la chiave del provider attivo.
  setupOverlay.classList.toggle('hidden', isConfigured())
}

function isConfigured() {
  return config.provider === 'ollama' || !!config.keyConfigured?.[config.provider]
}

function showSetup() {
  providerForm.load(config)
  setupOverlay.classList.remove('hidden')
}

// Provider o modello cambiati dalle Impostazioni (o altre opzioni dal menu
// sull'avatar): l'intestazione si aggiorna, e con la chiave arrivata la
// configurazione si chiude da sola.
if (api && api.onConfigChanged) api.onConfigChanged((cfg) => {
  if (!cfg) return
  // Ogni finestra resta la sua chat: cambia solo se il suo companion passa a
  // un'altra persona (chat-mode dal main).
  config = { ...config, ...cfg }
  updateBadge()
  // Un avatar cambiato arriva da qui: il viso nell'intestazione lo segue.
  loadFaces()
  if (isConfigured() && !setupOverlay.classList.contains('hidden')) {
    setupOverlay.classList.add('hidden')
    inputEl.focus()
  }
})

// ── Visi (Blocco 9d) ────────────────────────────────────────────────────────
// La miniatura dell'avatar di ogni companion (Blocco 9c), o le sue iniziali:
// nell'intestazione, nel benvenuto e, nel gruppo, accanto ai suoi fumetti.
let faceInfo = { personas: [], avatars: [] }
async function loadFaces() {
  try {
    const [p, a] = await Promise.all([api.personasGet(), api.listAvatars()])
    faceInfo = { personas: (p && p.list) || [], avatars: a || [] }
  } catch (_) { /* restano le iniziali */ }
  renderFaces()
}
if (api && api.onAvatarsChanged) api.onAvatarsChanged(loadFaces)
const ownId = () => (currentKey && !isGroupKey(currentKey) ? currentKey.slice(2) : '')
function nameOf(id) {
  const c = (config.companions || []).find(x => x.id === id) || faceInfo.personas.find(x => x.id === id)
  return (c && c.name) || (config.persona && config.persona.id === id ? config.persona.name : 'Companion')
}
const faceOf = (id) => Faces.face(Faces.avatarOf(id, faceInfo.personas, faceInfo.avatars), nameOf(id))
function renderFaces() {
  const ids = isGroupKey(currentKey) ? (config.companions || []).slice(0, 3).map(c => c.id) : [ownId()]
  document.getElementById('faces').replaceChildren(...ids.map(faceOf))
  fillWelcome()
}
/** Il benvenuto della chat vuota: il viso e il nome di chi ti parla. */
function fillWelcome() {
  const w = messagesEl.querySelector('.welcome')
  if (!w || isGroupKey(currentKey)) return
  w.querySelector('.welcome-face').replaceChildren(faceOf(ownId()))
  w.querySelector('.welcome-title').textContent = 'Ciao, sono ' + nameOf(ownId()) + '.'
}

// Umore, energia e rapporto del companion: tre anelli accanto alla memoria,
// con il dettaglio nel tooltip. Li decide il main: qui si mostrano.
function ring(id, value, title) {
  const el = document.getElementById(id)
  el.style.setProperty('--value', String(Math.max(0, Math.min(1, value))))
  el.title = title
}
function showMood(mood) {
  if (!mood) return
  const energy = mood.energy >= 0.7 ? 'piena' : mood.energy >= 0.4 ? 'normale' : 'bassa'
  ring('r-mood', Faces.moodValue(mood), 'Umore: ' + mood.label + (mood.icon && mood.icon !== '·' ? ' ' + mood.icon : ''))
  ring('r-energy', mood.energy || 0, 'Energia ' + energy + ' (' + Math.round((mood.energy || 0) * 100) + '%)')
  // Rapporto (Blocco 6b): livello, giorni insieme e serie.
  const r = mood.rapport
  document.getElementById('r-bond').hidden = !r
  if (r) ring('r-bond', (r.level + 1) / r.levels, 'Rapporto: ' + r.label + ' (livello ' + (r.level + 1) + ' di ' + r.levels + ')' +
    ' · insieme da ' + r.days + (r.days === 1 ? ' giorno' : ' giorni') + ' · serie di ' + r.streak)
  // Fame e sete (Blocco 10a): l'anello pieno e' la pancia piena; spente, spariscono.
  const needs = Faces.needsRings(mood.needs)
  for (const kind of ['hunger', 'thirst']) {
    const el = document.getElementById('r-' + kind)
    const n = needs && needs.find(x => x.kind === kind)
    el.hidden = !n
    if (!n) continue
    ring('r-' + kind, n.value, n.title)
    el.classList.toggle('low', n.low)
  }
}
if (api && api.onMoodChanged) api.onMoodChanged(showMood)

async function updateMemoryFooter() {
  try {
    const stats = await api.memoryStats()
    if (!stats || stats.error) return
    memoryFooter.classList.remove('hidden')
    // Il pie' di pagina e' stretto: il conto corto qui, il dettaglio nel tooltip.
    memoryInfo.textContent = `Memoria · ${stats.rawTurns + stats.archivedTurns} turni`
    memoryInfo.title = `Riassunto: ${stats.hasSummary ? 'sì' : 'non ancora'} · ${stats.rawTurns} turni in buffer · ${stats.archivedTurns} archiviati`
  } catch(e) { /* memoria non disponibile: nascondi footer */ }
}

// Il menu "⋯": Compatta e Dimentica tutto. Si chiude con Esc o cliccando fuori.
function setMenu(open) {
  moreMenu.classList.toggle('hidden', !open)
  moreBtn.setAttribute('aria-expanded', String(open))
  if (!open && forgetBtn.classList.contains('armed')) disarmForget()
}
moreBtn.addEventListener('click', () => {
  const open = moreMenu.classList.contains('hidden')
  setMenu(open)
  if (open) compactBtn.focus()
})
document.addEventListener('click', (e) => {
  if (!moreMenu.classList.contains('hidden') && !e.target.closest('#more-menu, #more-btn')) setMenu(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !moreMenu.classList.contains('hidden')) { setMenu(false); moreBtn.focus() }
})

const COMPACT_LABEL = compactBtn.querySelector('span').textContent
compactBtn.addEventListener('click', async () => {
  compactBtn.disabled = true
  compactBtn.querySelector('span').textContent = 'Compatto…'
  const res = await api.memoryCompactNow()
  setMenu(false)
  if (res?.ok && res.compacted) memoryInfo.textContent = '✓ Memoria compattata'
  else if (res?.ok) memoryInfo.textContent = 'Niente da compattare'
  else memoryInfo.textContent = 'Errore: ' + (res?.error || 'sconosciuto')
  compactBtn.querySelector('span').textContent = COMPACT_LABEL
  compactBtn.disabled = false
  setTimeout(() => { updateMemoryFooter() }, 2000)
})

const headerTitle = document.querySelector('#header-info h1')
function updateBadge() {
  const list = config.companions || []
  if (isGroupKey(currentKey)) headerTitle.textContent = list.map(c => c.name).join(' · ')
  else {
    const id = currentKey ? currentKey.slice(2) : null
    const one = list.find(c => c.id === id)
    headerTitle.textContent = one ? one.name : config.persona ? config.persona.name : 'Companion'
  }
  renderGroupBar()
  const p = (config.providers || {})[config.provider]
  providerBadge.textContent = p ? `${p.name} · ${providerForm.labelOf(config.provider, config.model) || config.model}` : '—'
}

// ── Setup save ──────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const saved = await providerForm.save()
  if (!saved) return
  config = saved
  updateBadge()
  setupOverlay.classList.add('hidden')
  inputEl.focus()
})

// ── Header buttons ───────────────────────────────────────────────────────────
closeBtn.addEventListener('click',    () => api.toggleChat())
settingsBtn.addEventListener('click', () => api.openSettings('modello'))

// ── Chat vuota: i suggerimenti scrivono nel campo, l'invio resta a te ───────
// Il benvenuto si ricrea per ogni conversazione vuota: i clic si ascoltano qui.
const welcomeTemplate = document.getElementById('welcome') ? document.getElementById('welcome').cloneNode(true) : null
messagesEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.welcome .chip')
  if (!chip) return
  inputEl.value = chip.textContent
  inputEl.dispatchEvent(new Event('input'))
  inputEl.focus()
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length)
})
let typingEl = document.getElementById('typing')

/** Ridisegna la conversazione corrente: i suoi messaggi, o il benvenuto. */
function renderConversation() {
  // Preserva il nodo typing: innerHTML lo distruggerebbe e i messaggi dopo il clear fallirebbero
  const typing = document.getElementById('typing') || typingEl
  messagesEl.innerHTML = ''
  const items = conv().items
  if (!items.length && welcomeTemplate && !isGroupKey(currentKey)) messagesEl.appendChild(welcomeTemplate.cloneNode(true))
  fillWelcome()
  for (const it of items) messagesEl.appendChild(messageEl(it))
  if (typing) messagesEl.appendChild(typing)
  typingEl = document.getElementById('typing')
  messagesEl.scrollTop = messagesEl.scrollHeight
}

/**
 * Chat singola con un companion, o di gruppo. La conversazione di ciascuna
 * resta com'era; nel gruppo nessun messaggio "Ora parli con".
 */
function setChatMode(data) {
  const key = data && data.mode === 'group' ? 'group' : singleKey(data && data.personaId ? data.personaId : config.persona ? config.persona.id : 'default')
  if (key === currentKey) return
  currentKey = key
  groupTo = null
  renderConversation()
  updateBadge()
  renderFaces()
  setTyping(sending && sendingKey === currentKey)
}
if (api && api.onChatMode) api.onChatMode(setChatMode)

function resetChatView(notice) {
  const c = conv()
  c.history = []
  c.items = []
  renderConversation()
  document.getElementById('welcome')?.remove()
  if (notice) addMessage('system', notice)
  setTyping(false)
  inputEl.focus()
}

// ↺ pulisce solo lo schermo. Prima cancellava anche la memoria permanente, e
// chi voleva solo ripartire con una chat pulita perdeva tutto senza saperlo.
clearBtn.addEventListener('click', () => {
  resetChatView('Chat pulita. Mi ricordo ancora di te: per cancellare la memoria usa "Dimentica tutto".')
})

// Due clic invece di un confirm(): il primo arma il pulsante e dice cosa
// succede, il secondo (entro qualche secondo) cancella davvero.
const forgetLabel = forgetBtn.querySelector('span')
const FORGET_LABEL = forgetLabel.textContent
let forgetTimer = null
function disarmForget() {
  clearTimeout(forgetTimer)
  forgetTimer = null
  forgetBtn.classList.remove('armed')
  forgetLabel.textContent = FORGET_LABEL
  updateMemoryFooter()
}
forgetBtn.addEventListener('click', async () => {
  if (!forgetBtn.classList.contains('armed')) {
    forgetBtn.classList.add('armed')
    forgetLabel.textContent = 'Sicuro? Clic di nuovo'
    memoryInfo.textContent = 'Cancella tutta la memoria, per sempre.'
    memoryInfo.title = 'Riassunto, conversazioni e archivio spariscono dal disco. Non si torna indietro.'
    forgetTimer = setTimeout(disarmForget, 4000)
    return
  }
  clearTimeout(forgetTimer)
  forgetBtn.classList.remove('armed')
  forgetLabel.textContent = FORGET_LABEL
  setMenu(false)
  const res = await api.memoryClear().catch(e => ({ ok: false, error: e.message }))
  if (!res?.ok) { addMessage('error', 'Cancellazione memoria fallita: ' + (res?.error || 'errore sconosciuto')); return }
  resetChatView('Memoria cancellata. Ripartiamo da zero.')
  await updateMemoryFooter()
})

// ── Chat di gruppo (Blocco 8c) ──────────────────────────────────────────────
// Con piu' companion sul desktop si scrive a tutti; una pastiglia scelta
// manda il messaggio solo a lui. Ogni risposta porta il nome di chi parla.
const groupBar = document.getElementById('group-bar')
let groupTo = null
const isGroup = () => isGroupKey(currentKey)
/** Un colore per nome, sempre lo stesso (faces.js). */
const hueOf = Faces.hueOf
function renderGroupBar() {
  const list = config.companions || []
  // Le pastiglie solo nella chat di gruppo.
  const show = isGroup() && list.length > 1
  groupBar.classList.toggle('hidden', !show)
  if (!show) { groupTo = null; groupBar.replaceChildren(); return }
  if (groupTo && !list.some(c => c.id === groupTo)) groupTo = null
  const chip = (id, label, title) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-pressed', String(groupTo === id))
    b.title = title
    if (id) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.setProperty('--hue', String(hueOf(label)))
      b.append(dot)
    }
    b.append(label)
    b.addEventListener('click', () => { groupTo = groupTo === id ? null : id; renderGroupBar(); inputEl.focus() })
    return b
  }
  groupBar.replaceChildren(chip(null, 'Tutti', 'Scrivi a tutti: risponde chi chiami per nome, o uno di loro'),
    ...list.map(c => chip(c.id, c.name, 'Scrivi solo a ' + c.name)))
}

// ── Messages ─────────────────────────────────────────────────────────────────
/**
 * Il fumetto di un messaggio; nel gruppo, con il viso, il nome e il colore di
 * chi parla. Un errore di invio ha il suo "Riprova".
 */
function messageEl({ role, text, who, group, pid, retry }) {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  if (who && group) {
    const tag = document.createElement('span')
    tag.className = 'who'
    tag.style.setProperty('--hue', String(hueOf(who)))
    tag.textContent = who
    el.append(tag)
  }
  el.append(text)
  if (retry) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'retry'
    b.textContent = 'Riprova'
    el.append(b)
  }
  if (role !== 'assistant' || !group || !pid) return el
  const row = document.createElement('div')
  row.className = 'msg-row'
  row.append(faceOf(pid), el)
  return row
}

/**
 * Un messaggio nella conversazione key (di base quella a schermo). extra:
 * pid (chi parla, per il viso nel gruppo), retry (errore con "Riprova").
 */
function addMessage(role, text, who, key = currentKey, extra = {}) {
  const item = { role, text: String(text == null ? '' : text), who, group: isGroupKey(key), ...extra }
  conv(key).items.push(item)
  if (key !== currentKey) return
  // Il benvenuto lascia il posto alla conversazione appena scrivi.
  if (role === 'user') document.getElementById('welcome')?.remove()
  const el = messageEl(item)
  const typing = document.getElementById('typing')
  if (typing && typing.parentNode === messagesEl) messagesEl.insertBefore(el, typing)
  else messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function setTyping(on) {
  const typing = document.getElementById('typing') || typingEl
  if (typing) typing.classList.toggle('visible', on)
  sendBtn.disabled = on
  if (on) messagesEl.scrollTop = messagesEl.scrollHeight
}

// ── Input ────────────────────────────────────────────────────────────────────
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px'
})

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
})

sendBtn.addEventListener('click', sendMessage)

// ── Send ─────────────────────────────────────────────────────────────────────
let sending = false
let sendingKey = null
const warnedModels = new Set()
/** @param {string} [spoken] il testo detto nel microfono, al posto di quello scritto */
// ── Guarda lo schermo (Blocco 7b) ───────────────────────────────────────────
// La schermata resta un'anteprima finche' non invii: ✕ la toglie.
const attachEl = document.getElementById('attach')
const lookBtn = document.getElementById('look-btn')
let pendingImage = null
function setAttachment(image) {
  pendingImage = image
  attachEl.classList.toggle('hidden', !image)
  document.getElementById('attach-img').src = image || ''
}
async function lookAtScreen() {
  lookBtn.disabled = true
  const r = await api.visionCapture().catch(e => ({ ok: false, error: e.message }))
  lookBtn.disabled = false
  if (r && r.ok) { setAttachment(r.image); inputEl.focus() }
  else addMessage('error', 'Schermata non riuscita: ' + ((r && r.error) || 'errore sconosciuto'))
}
lookBtn.addEventListener('click', lookAtScreen)
document.getElementById('attach-cancel').addEventListener('click', () => setAttachment(null))

async function sendMessage(spoken) {
  const fromMic = typeof spoken === 'string'
  if (sending) {
    // Una risposta e' ancora in arrivo: il messaggio nuovo la interrompe
    // (Blocco 11a). Resta quello che era arrivato, e si manda il nuovo.
    if (!(fromMic ? spoken.trim() : inputEl.value.trim())) return
    try { await api.cancelReply() } catch (_) {}
    if (replyDone) await replyDone.catch(() => {})
    if (sending) return
  }
  const image = pendingImage
  const text = (fromMic ? spoken.trim() : inputEl.value.trim()) || (image ? 'Cosa vedi sul mio schermo?' : '')
  if (!text) return

  // Controllo key (eccetto ollama) — con try per non bloccare mai la UI
  try {
    const currentConfig = await api.getConfig()
    if (currentConfig.provider !== 'ollama' && !currentConfig.keyConfigured?.[currentConfig.provider]) {
      config = currentConfig
      showSetup()
      return
    }
  } catch (e) {
    addMessage('error', 'Bridge non raggiungibile: avvia con npm start')
    return
  }

  if (!fromMic) {
    inputEl.value = ''
    inputEl.style.height = 'auto'
  }

  // La risposta torna in questa conversazione, anche se nel frattempo si cambia.
  const key = currentKey
  const group = isGroupKey(key)
  const to = group ? groupTo : key.slice(2)
  addMessage('user', image ? text + ' 🖼' : text)
  setAttachment(null)
  // Nella conversazione resta il testo: la schermata va solo con questo messaggio.
  pushHistory(key, { role: 'user', content: (image ? text + ' [immagine dello schermo]' : text).slice(0, 8000) })
  await requestReply(key, to, image)
}

/** Un errore di invio, con "Riprova": rimanda la stessa conversazione. */
function sendFailed(key, to, text) {
  conv(key).retryTo = to
  addMessage('error', text, null, key, { retry: true })
  try { api.executeAction({ type: 'none', animation: 'idle' }) } catch (_) {}
}
messagesEl.addEventListener('click', (e) => {
  if (!e.target.closest('.msg.error .retry') || sending) return
  const c = conv()
  // Solo l'ultimo errore si riprova: gli altri restano come promemoria.
  let i = c.items.length - 1
  while (i >= 0 && !c.items[i].retry) i--
  if (i < 0) return
  c.items.splice(i, 1)
  renderConversation()
  requestReply(currentKey, c.retryTo, null)
})

// ── Streaming (Blocco 11a) ──────────────────────────────────────────────────
// Il testo della risposta mentre arriva, in un fumetto provvisorio che non
// entra nella cronologia: alla fine lo sostituisce la risposta vera.
let replyDone = null
let stream = null   // { el, text, name, pid, key }

function dropStream() {
  const s = stream
  stream = null
  if (s && s.el) s.el.remove()
  return s
}

if (api && api.onReplyDelta) api.onReplyDelta((d) => {
  if (!sending || !d || typeof d.text !== 'string') return
  if (!stream) stream = { el: null, text: '', name: d.name, pid: d.personaId, key: sendingKey }
  stream.text = d.text
  if (stream.key !== currentKey) return
  if (!stream.el || !stream.el.isConnected) {
    setTyping(false)
    stream.el = messageEl({ role: 'assistant', text: d.text, who: d.name, group: isGroupKey(stream.key), pid: d.personaId })
    const bubble = stream.el.classList.contains('msg') ? stream.el : stream.el.querySelector('.msg')
    bubble.classList.add('streaming')
    const typing = document.getElementById('typing')
    if (typing && typing.parentNode === messagesEl) messagesEl.insertBefore(stream.el, typing)
    else messagesEl.appendChild(stream.el)
  }
  const bubble = stream.el.classList.contains('msg') ? stream.el : stream.el.querySelector('.msg')
  bubble.lastChild.textContent = d.text
  messagesEl.scrollTop = messagesEl.scrollHeight
})

/** Chiede la risposta per la conversazione key (l'ultimo messaggio e' gia' nella cronologia). */
function requestReply(key, to, image) {
  replyDone = askReply(key, to, image)
  return replyDone
}

async function askReply(key, to, image) {
  const group = isGroupKey(key)
  sending = true
  sendingKey = key
  dropStream()
  setTyping(true)

  // Animazione "think" immediata sul companion (quello scelto, nel gruppo)
  try { api.executeAction({ type: 'none', animation: 'think' }, to || undefined) } catch (_) {}

  let resp
  try {
    const payload = { history: conv(key).history, mode: group ? 'group' : 'single', ...(image ? { image } : {}), ...(to ? { to } : {}) }
    resp = await api.sendMessage(payload)
  } catch (e) {
    setTyping(false)
    sending = false
    dropStream()
    sendFailed(key, to, 'Messaggio non arrivato: ' + (e.message || e))
    return
  }

  setTyping(false)
  sending = false
  const partial = dropStream()

  const { ok, result, error } = resp || {}
  // Interrotta da un messaggio nuovo: resta a schermo quello che era arrivato,
  // ma non entra nella cronologia (il modello non l'ha finita).
  if (resp && resp.aborted) {
    if (partial && partial.text) addMessage('assistant', partial.text + ' …', partial.name, key, { pid: partial.pid })
    return
  }
  if (!ok) {
    sendFailed(key, to, 'Nessuna risposta: ' + (error || 'risposta vuota'))
    return
  }

  showReply(result, key)
  // Il modello ha risposto fuori formato: l'azione e' andata persa. Lo si dice
  // una volta per modello, altrimenti sembra che l'avatar ignori le richieste.
  if (result.via === 'fallback' && !warnedModels.has(config.model)) {
    warnedModels.add(config.model)
    addMessage('system', 'Questo modello non ha risposto nel formato del companion, quindi niente animazione. Se succede spesso, scegline un altro nelle impostazioni (⚙).', null, key)
  }

  runAction(result.action, result.personaId)
}

/** Una risposta nella conversazione key: chi l'ha detta, lo strumento usato, gli avvisi. */
function showReply(result, key = currentKey) {
  pushHistory(key, { role: 'assistant', content: (result.reply || '').slice(0, 8000), ...(result.personaId ? { speaker: result.personaId } : {}) })
  // Lo strumento usato per rispondere, prima della risposta (Blocco 7f).
  if (result.toolNote) addMessage('system', result.toolNote, null, key)
  addMessage('assistant', result.reply, result.name, key, { pid: result.personaId })
  // Uno strumento MCP annullato o rifiutato (Blocco 7f).
  if (result.notice) addMessage('system', result.notice, null, key)
  updateMemoryFooter().catch(() => {})
}

/** L'azione della risposta, fatta dal companion che l'ha data. */
function runAction(action, personaId) {
  action = action || { type: 'none', animation: 'idle' }
  // "Guarda qui": si prepara la schermata, da confermare con Invia (Blocco 7b).
  if (action.type === 'look') {
    lookAtScreen()
    api.executeAction({ type: 'none', animation: action.animation || 'think' }, personaId)
    return
  }
  if (action.type !== 'none') {
    api.toggleChat() // chiude la chat durante l'animazione
    setTimeout(() => api.executeAction(action, personaId), 150)
  } else {
    // L'azione intera, non solo l'animazione: verso e distanza della camminata
    // stanno li'. Il main lascia passare solo i valori del contratto.
    api.executeAction({ ...action, type: 'none', animation: action.animation || 'idle' }, personaId)
  }
}

// La seconda risposta nella chat di gruppo: arriva quando il primo ha finito.
if (api && api.onGroupReply) api.onGroupReply((data) => {
  if (!data || typeof data.reply !== 'string' || !data.reply) return
  showReply(data, 'group')
  runAction(data.action, data.personaId)
})

// ── Iniziativa (Blocco 6d) ──────────────────────────────────────────────────
// Un messaggio che il companion scrive per primo: entra nella conversazione
// come una sua risposta (il main l'ha gia' salvato in memoria).
if (api && api.onInitiative) api.onInitiative((data) => {
  const reply = data && typeof data.reply === 'string' ? data.reply : ''
  if (!reply) return
  // I commenti fra companion stanno nella chat di gruppo; il resto (buongiorno,
  // bentornato, silenzio) nella chat singola di chi scrive.
  const between = ['peer', 'peer-reply', 'hello'].includes(data.kind) && (config.companions || []).length > 1
  const key = between ? 'group' : singleKey(data.personaId || (config.persona && config.persona.id) || 'default')
  pushHistory(key, { role: 'assistant', content: reply.slice(0, 8000), ...(data.personaId ? { speaker: data.personaId } : {}) })
  addMessage('assistant', reply, data.name, key, { pid: data.personaId })
  updateMemoryFooter().catch(() => {})
})

// ── Microfono ────────────────────────────────────────────────────────────────
// Tieni premuto 🎙 (o la scorciatoia, che il main gira qui) e parla: quando
// lasci, la registrazione va a Whisper nel main e il testo parte come un
// messaggio scritto. Un clic breve lascia il microfono aperto fino al clic
// dopo. Esc annulla. Il pulsante c'e' solo con il microfono installato e acceso.
const micBtn = document.getElementById('mic-btn')
const MIC_TAP_MS = 350
const MIC_MIN_SAMPLES = 16000 * 0.3
const PLACEHOLDER = inputEl.placeholder
let mic = null
let micMode = null    // null | 'hold' | 'toggle' | 'shortcut'
let micDownAt = 0
let micBusy = false
let micMissingSaid = false

function micUsable() {
  return !!(window.MicRecorder && config.voice && config.voice.micEnabled && config.micInstalled)
}
function showMicButton() {
  micBtn.classList.toggle('hidden', !micUsable())
  if (!micUsable() && micMode) micCancel()
}
function micLevel(level) { micBtn.style.setProperty('--level', level.toFixed(2)) }
function micReset() {
  micMode = null
  micBtn.classList.remove('listening', 'busy')
  micLevel(0)
  inputEl.placeholder = PLACEHOLDER
}

async function micStart(mode) {
  if (!micUsable() || micBusy || micMode || hands) return
  mic = mic || new MicRecorder({ onLevel: micLevel, onLimit: () => micStop() })
  micMode = mode
  micBtn.classList.add('listening')
  inputEl.placeholder = mode === 'hold' ? 'Ti ascolto… lascia per inviare' : 'Ti ascolto…'
  api.micState('listening')
  try {
    const voice = config.voice || {}
    await mic.start({ deviceId: voice.micDevice, deviceLabel: voice.micDeviceLabel })
    // Il microfono scelto non c'e': si registra dal predefinito, e lo si dice una volta.
    if (mic.missing && !micMissingSaid) {
      micMissingSaid = true
      addMessage('system', 'Il microfono scelto (' + (voice.micDeviceLabel || 'senza nome') + ') non è collegato: ti ascolto da quello predefinito.')
    }
  } catch (e) {
    micReset()
    api.micState('idle')
    addMessage('error', 'Microfono non disponibile: ' + (e && (e.message || e.name) || 'errore sconosciuto'))
  }
}

function micCancel() {
  if (mic) mic.cancel()
  micReset()
  api.micState('idle')
}

async function micStop() {
  if (!mic || !micMode || micBusy) return
  micBusy = true
  micBtn.classList.add('busy')
  const pcm = await mic.stop()
  micBtn.classList.remove('listening')
  micLevel(0)
  if (pcm.length < MIC_MIN_SAMPLES) { micBusy = false; micReset(); api.micState('idle'); return }
  inputEl.placeholder = 'Trascrivo…'
  api.micState('transcribing')
  let res
  try { res = await api.micTranscribe(pcm) } catch (e) { res = { ok: false, error: e.message } }
  micBusy = false
  micReset()
  api.micState('idle')
  if (!res || !res.ok) { addMessage('error', 'Microfono: ' + ((res && res.error) || 'errore sconosciuto')); return }
  if (!res.text) { addMessage('system', 'Non ho capito. Riprova, magari più vicino al microfono.'); return }
  sendMessage(res.text)
}

micBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  e.preventDefault()
  // A mani libere il microfono e' gia' aperto: il pulsante le spegne.
  if (hands) { handsFreeOff(); api.micState('idle'); return }
  if (micMode === 'toggle' || micMode === 'shortcut') { micStop(); return }
  try { micBtn.setPointerCapture(e.pointerId) } catch (_) {}
  micDownAt = Date.now()
  micStart('hold')
})
const micRelease = () => {
  if (micMode !== 'hold') return
  if (Date.now() - micDownAt < MIC_TAP_MS) {
    micMode = 'toggle'
    inputEl.placeholder = 'Ti ascolto… clic su 🎙 per finire'
    return
  }
  micStop()
}
micBtn.addEventListener('pointerup', micRelease)
micBtn.addEventListener('pointercancel', micRelease)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && micMode && !micBusy) micCancel() })

// ── Mani libere (Blocco 11b) ────────────────────────────────────────────────
// Il microfono resta aperto e il rilevatore (MicRecorder.vadStep) sente
// quando inizi e smetti di parlare: ogni turno si trascrive e parte come
// messaggio, e se il companion stava rispondendo lo interrompe (Blocco 11a).
// Il main la rende sorda mentre il companion parla (deaf), tranne con le
// cuffie. Qualche blocco prima dell'inizio resta, per non tagliare la prima
// sillaba.
const PREROLL_BLOCKS = 3
let hands = null   // { rec, vad, deaf, busy, from }

async function handsFreeOn() {
  if (hands) return
  if (!micUsable()) { api.micState('idle'); return }
  if (micMode) micCancel()
  const h = { rec: null, vad: null, deaf: false, busy: false, from: 0 }
  hands = h
  h.rec = new MicRecorder({ onLevel: (level) => handsLevel(h, level), onLimit: () => {} })
  micBtn.classList.add('listening')
  try {
    const voice = config.voice || {}
    await h.rec.start({ deviceId: voice.micDevice, deviceLabel: voice.micDeviceLabel })
  } catch (e) {
    if (hands === h) hands = null
    micBtn.classList.remove('listening')
    api.micState('idle')
    addMessage('error', 'Microfono non disponibile: ' + (e && (e.message || e.name) || 'errore sconosciuto'))
    return
  }
  if (hands !== h) { h.rec.cancel(); return }
  api.micState('handsfree')
}

function handsFreeOff() {
  const h = hands
  hands = null
  micBtn.classList.remove('listening')
  micLevel(0)
  if (h && h.rec) h.rec.cancel()
}

function handsLevel(h, level) {
  if (hands !== h) return
  micLevel(h.deaf ? 0 : level)
  const threshold = MicRecorder.thresholdOf((config.voice || {}).micSensitivity)
  const { state, event } = MicRecorder.vadStep(h.vad, level, Date.now(), { threshold, deaf: h.deaf || h.busy })
  h.vad = state
  if (event === 'start') {
    h.from = Math.max(0, h.rec.blockCount - 1 - PREROLL_BLOCKS)
    api.micState('hearing')
  } else if (event === 'end') {
    handsTurn(h, h.rec.takeFrom(h.from))
  } else if (event === 'discard') {
    api.micState('handsfree')
  }
  // Mentre nessuno parla resta solo l'ultimo attimo, per il turno dopo.
  if (state.phase === 'idle' && event !== 'end') h.rec.trim(PREROLL_BLOCKS + 1)
}

async function handsTurn(h, pcm) {
  h.busy = true
  api.micState('transcribing')
  let res
  try { res = await api.micTranscribe(pcm) } catch (e) { res = { ok: false, error: e.message } }
  h.busy = false
  if (hands !== h) return
  api.micState('handsfree')
  if (res && res.ok && res.text) sendMessage(res.text)
  else if (res && !res.ok) addMessage('error', 'Microfono: ' + (res.error || 'errore sconosciuto'))
}

// La scorciatoia globale: il main sa quando il tasto si preme e si lascia.
// Le mani libere le accende e spegne il main (pillola o tasto rapido).
if (api && api.onMicCommand) api.onMicCommand((m) => {
  if (!m) return
  if (m.cmd === 'start' && !hands) micStart('shortcut')
  else if (m.cmd === 'stop' && micMode) micStop()
  else if (m.cmd === 'handsfree-on') handsFreeOn()
  else if (m.cmd === 'handsfree-off') handsFreeOff()
  else if (m.cmd === 'deaf' && hands) hands.deaf = m.deaf === true
})

// Microfono acceso, spento, installato o tolto dalle Impostazioni.
if (api && api.onConfigChanged) api.onConfigChanged((cfg) => {
  if (!cfg) return
  if ((cfg.voice && cfg.voice.micDevice) !== (config.voice && config.voice.micDevice)) micMissingSaid = false
  config.voice = cfg.voice
  config.micInstalled = cfg.micInstalled
  showMicButton()
  // Microfono spento o tolto nelle Impostazioni: le mani libere si spengono.
  if (hands && !micUsable()) { handsFreeOff(); api.micState('idle') }
})

// ── Focus ────────────────────────────────────────────────────────────────────
window.addEventListener('focus', () => inputEl.focus())

// ── Boot ─────────────────────────────────────────────────────────────────────
init()
