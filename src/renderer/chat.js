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
const moodChip       = document.getElementById('mood-chip')

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
  if (isConfigured() && !setupOverlay.classList.contains('hidden')) {
    setupOverlay.classList.add('hidden')
    inputEl.focus()
  }
})

// Umore del companion accanto alla memoria. Lo decide il main: qui si mostra.
function showMood(mood) {
  if (!mood) return
  moodChip.textContent = mood.icon + ' ' + mood.label
  const energy = mood.energy >= 0.7 ? 'piena' : mood.energy >= 0.4 ? 'normale' : 'bassa'
  moodChip.title = 'Umore del companion: ' + mood.label + ' · energia ' + energy
  // Rapporto (Blocco 6b): livello, giorni insieme e serie.
  const r = mood.rapport
  const chip = document.getElementById('rapport-chip')
  chip.classList.toggle('hidden', !r)
  if (!r) return
  chip.textContent = r.label + (r.days ? ' · ' + r.days + ' g' : '')
  chip.title = 'Rapporto: ' + r.label + ' (livello ' + (r.level + 1) + ' di ' + r.levels + ')' +
    ' · insieme da ' + r.days + (r.days === 1 ? ' giorno' : ' giorni') + ' · serie di ' + r.streak
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

compactBtn.addEventListener('click', async () => {
  compactBtn.disabled = true
  compactBtn.textContent = '…'
  const res = await api.memoryCompactNow()
  if (res?.ok && res.compacted) memoryInfo.textContent = '✓ Memoria compattata'
  else if (res?.ok) memoryInfo.textContent = 'Niente da compattare'
  else memoryInfo.textContent = 'Errore: ' + (res?.error || 'sconosciuto')
  setTimeout(async () => {
    compactBtn.textContent = 'Compatta'
    compactBtn.disabled = false
    await updateMemoryFooter()
  }, 2000)
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
const FORGET_LABEL = forgetBtn.textContent
let forgetTimer = null
function disarmForget() {
  clearTimeout(forgetTimer)
  forgetTimer = null
  forgetBtn.classList.remove('armed')
  forgetBtn.textContent = FORGET_LABEL
  updateMemoryFooter()
}
forgetBtn.addEventListener('click', async () => {
  if (!forgetBtn.classList.contains('armed')) {
    forgetBtn.classList.add('armed')
    forgetBtn.textContent = 'Sicuro? Clic di nuovo'
    memoryInfo.textContent = 'Cancella tutta la memoria, per sempre.'
    memoryInfo.title = 'Riassunto, conversazioni e archivio spariscono dal disco. Non si torna indietro.'
    forgetTimer = setTimeout(disarmForget, 4000)
    return
  }
  clearTimeout(forgetTimer)
  forgetBtn.classList.remove('armed')
  forgetBtn.textContent = FORGET_LABEL
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
/** Un colore per nome, sempre lo stesso. */
function hueOf(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360
  return h
}
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
/** Il fumetto di un messaggio; nel gruppo, con nome e colore di chi parla. */
function messageEl({ role, text, who, group }) {
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
  return el
}

/** Un messaggio nella conversazione key (di base quella a schermo). */
function addMessage(role, text, who, key = currentKey) {
  const item = { role, text: String(text == null ? '' : text), who, group: isGroupKey(key) }
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
    // Una risposta e' ancora in arrivo: quello che hai detto resta da inviare.
    if (fromMic) inputEl.value = (inputEl.value.trim() + ' ' + spoken).trim()
    return
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

  sending = true
  sendingKey = key
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
    addMessage('error', `Errore IPC: ${e.message || e}`, null, key)
    try { api.executeAction({ type: 'none', animation: 'idle' }) } catch (_) {}
    return
  }

  setTyping(false)
  sending = false

  const { ok, result, error } = resp || {}
  if (!ok) {
    addMessage('error', `Errore: ${error || 'risposta vuota'}`, null, key)
    try { api.executeAction({ type: 'none', animation: 'idle' }) } catch (_) {}
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
  addMessage('assistant', result.reply, result.name, key)
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
  addMessage('assistant', reply, data.name, key)
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
  if (!micUsable() || micBusy || micMode) return
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

// La scorciatoia globale: il main sa quando il tasto si preme e si lascia.
if (api && api.onMicCommand) api.onMicCommand((m) => {
  if (!m) return
  if (m.cmd === 'start') micStart('shortcut')
  else if (m.cmd === 'stop' && micMode) micStop()
})

// Microfono acceso, spento, installato o tolto dalle Impostazioni.
if (api && api.onConfigChanged) api.onConfigChanged((cfg) => {
  if (!cfg) return
  if ((cfg.voice && cfg.voice.micDevice) !== (config.voice && config.voice.micDevice)) micMissingSaid = false
  config.voice = cfg.voice
  config.micInstalled = cfg.micInstalled
  showMicButton()
})

// ── Focus ────────────────────────────────────────────────────────────────────
window.addEventListener('focus', () => inputEl.focus())

// ── Boot ─────────────────────────────────────────────────────────────────────
init()
