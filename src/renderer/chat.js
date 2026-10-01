// ── Accesso al bridge sicuro ────────────────────────────────────────────────
const api = window.companion

// ── State ───────────────────────────────────────────────────────────────────
let config = {}
let conversationHistory = []

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
  if (res?.ok && res.compacted) {
    memoryInfo.textContent = '✓ Memoria compattata'
  } else {
    memoryInfo.textContent = 'Niente da compattare o errore'
  }
  setTimeout(async () => {
    compactBtn.textContent = 'Compatta'
    compactBtn.disabled = false
    await updateMemoryFooter()
  }, 2000)
})

function updateBadge() {
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
for (const chip of document.querySelectorAll('.welcome .chip')) {
  chip.addEventListener('click', () => {
    inputEl.value = chip.textContent
    inputEl.dispatchEvent(new Event('input'))
    inputEl.focus()
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length)
  })
}
let typingEl = document.getElementById('typing')
function resetChatView(notice) {
  conversationHistory = []
  // Preserva il nodo typing: innerHTML lo distruggerebbe e i messaggi dopo il clear fallirebbero
  const typing = document.getElementById('typing')
  messagesEl.innerHTML = ''
  addMessage('system', notice)
  if (typing) messagesEl.appendChild(typing)
  typingEl = document.getElementById('typing')
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

// ── Messages ─────────────────────────────────────────────────────────────────
function addMessage(role, text) {
  // Il benvenuto lascia il posto alla conversazione appena scrivi.
  if (role === 'user') document.getElementById('welcome')?.remove()
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
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
const warnedModels = new Set()
/** @param {string} [spoken] il testo detto nel microfono, al posto di quello scritto */
async function sendMessage(spoken) {
  const fromMic = typeof spoken === 'string'
  if (sending) {
    // Una risposta e' ancora in arrivo: quello che hai detto resta da inviare.
    if (fromMic) inputEl.value = (inputEl.value.trim() + ' ' + spoken).trim()
    return
  }
  const text = fromMic ? spoken.trim() : inputEl.value.trim()
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

  addMessage('user', text)
  conversationHistory.push({ role: 'user', content: text.slice(0, 8000) })
  // Cap history: ultime 40 voci per evitare payload enormi / 400 provider
  if (conversationHistory.length > 40) conversationHistory = conversationHistory.slice(-40)

  sending = true
  setTyping(true)

  // Animazione "think" immediata sul companion
  try { api.executeAction({ type: 'none', animation: 'think' }) } catch (_) {}

  let resp
  try {
    resp = await api.sendMessage({ history: conversationHistory })
  } catch (e) {
    setTyping(false)
    sending = false
    addMessage('error', `Errore IPC: ${e.message || e}`)
    try { api.executeAction({ type: 'none', animation: 'idle' }) } catch (_) {}
    return
  }

  setTyping(false)
  sending = false

  const { ok, result, error } = resp || {}
  if (!ok) {
    addMessage('error', `Errore: ${error || 'risposta vuota'}`)
    try { api.executeAction({ type: 'none', animation: 'idle' }) } catch (_) {}
    return
  }

  // Aggiungi risposta alla history
  conversationHistory.push({ role: 'assistant', content: (result.reply || '').slice(0, 8000) })
  if (conversationHistory.length > 40) conversationHistory = conversationHistory.slice(-40)

  addMessage('assistant', result.reply)
  updateMemoryFooter().catch(() => {})
  // Il modello ha risposto fuori formato: l'azione e' andata persa. Lo si dice
  // una volta per modello, altrimenti sembra che l'avatar ignori le richieste.
  if (result.via === 'fallback' && !warnedModels.has(config.model)) {
    warnedModels.add(config.model)
    addMessage('system', 'Questo modello non ha risposto nel formato del companion, quindi niente animazione. Se succede spesso, scegline un altro nelle impostazioni (⚙).')
  }

  // Esegui azione OS + animazione
  const action = result.action || { type: 'none', animation: 'idle' }

  if (action.type !== 'none') {
    api.toggleChat() // chiude la chat durante l'animazione
    setTimeout(() => api.executeAction(action), 150)
  } else {
    // L'azione intera, non solo l'animazione: verso e distanza della camminata
    // stanno li'. Il main lascia passare solo i valori del contratto.
    api.executeAction({ ...action, type: 'none', animation: action.animation || 'idle' })
  }
}

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
