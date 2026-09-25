// ── Accesso al bridge sicuro ────────────────────────────────────────────────
const api = window.companion

// ── State ───────────────────────────────────────────────────────────────────
let config = {}
let conversationHistory = []
let selectedProvider = 'openrouter'
let selectedModel    = ''

const PROVIDER_ICONS = {
  claude:  '🟠',
  openai:  '🟢',
  grok:    '⚫',
  gemini:  '🔵',
  mistral: '🔴',
  ollama:  '🟣',
  openrouter: '⚡',
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const setupOverlay   = document.getElementById('setup-overlay')
const providerGrid   = document.getElementById('provider-grid')
const modelSelect    = document.getElementById('model-select')
const apiKeyInput    = document.getElementById('api-key-input')
const ollamaNote     = document.getElementById('ollama-note')
const keySection     = document.getElementById('key-section')
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
const keyHelp        = document.getElementById('key-help')
const modelNote      = document.getElementById('model-note')
const loginRow       = document.getElementById('login-row')
const loginItem      = document.getElementById('login-item')
const setupCancel    = document.getElementById('setup-cancel')

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    if (!api || !api.getConfig) throw new Error('bridge companion mancante')
    config = await api.getConfig()
  } catch (e) {
    messagesEl.insertAdjacentHTML('beforeend', '<div class="msg error">Bridge Electron non disponibile (apri via npm start).</div>')
    config = { provider: 'openrouter', model: '', keyConfigured: {}, providers: {} }
  }
  selectedProvider = config.provider || 'openrouter'
  // Nessun id di modello codificato qui: la lista arriva dal router via config,
  // cosi' la UI non puo' proporre un modello che il backend non conosce.
  selectedModel    = config.model
    || config.providers?.[selectedProvider]?.models?.[0]?.id
    || ''

  buildProviderGrid()
  updateModelSelect()
  updateKeyField()
  updateBadge()
  updateMemoryFooter()
  initLoginItem()

  // Mostra setup solo se non c'è key per il provider attivo
  setupCancel.classList.toggle('hidden', !isConfigured())
  if (isConfigured()) {
    setupOverlay.classList.add('hidden')
  }
}

function isConfigured() {
  return config.provider === 'ollama' || !!config.keyConfigured?.[config.provider]
}

// "Avvia con Windows" esiste solo nell'app installata: in sviluppo la riga resta nascosta.
async function initLoginItem() {
  try {
    const state = await api.getLoginItem()
    loginRow.classList.toggle('hidden', !state.supported)
    loginItem.checked = !!state.enabled
  } catch (_) { loginRow.classList.add('hidden') }
}
loginItem.addEventListener('change', async () => {
  try { loginItem.checked = !!(await api.setLoginItem(loginItem.checked)).enabled } catch (_) {}
})

// La pagina della chiave la apre il main: qui si indica solo il provider.
keyHelp.addEventListener('click', () => { api.openKeyPage(selectedProvider).catch(() => {}) })
setupCancel.addEventListener('click', () => setupOverlay.classList.add('hidden'))

async function updateMemoryFooter() {
  try {
    const stats = await api.memoryStats()
    if (!stats || stats.error) return
    memoryFooter.classList.remove('hidden')
    const summaryDot = stats.hasSummary ? '✓' : '—'
    memoryInfo.textContent = `Memoria: ${summaryDot} riassunto · ${stats.rawTurns} in buffer · ${stats.archivedTurns} archiviati`
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

function buildProviderGrid() {
  providerGrid.innerHTML = ''
  const providers = config.providers || {}

  Object.entries(providers).forEach(([id, p]) => {
    const btn = document.createElement('button')
    btn.className = 'provider-btn' + (id === selectedProvider ? ' active' : '')
    btn.dataset.provider = id
    const icon = document.createElement('span')
    icon.className = 'provider-icon'
    icon.textContent = PROVIDER_ICONS[id] || '●'
    btn.append(icon, p.name)
    btn.addEventListener('click', () => selectProvider(id))
    providerGrid.appendChild(btn)
  })
}

function selectProvider(id) {
  selectedProvider = id
  document.querySelectorAll('.provider-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.provider === id)
  })
  updateModelSelect()
  updateKeyField()
}

// Modelli per provider: prima l'elenco statico del router, poi quello dal vivo
// (OpenRouter e Ollama), che arriva dopo e lo sostituisce.
const liveModels = {}

function fillModelSelect(models) {
  // Opzioni costruite con textContent: nomi e id dei modelli di OpenRouter
  // arrivano dalla rete, e con innerHTML potrebbero iniettare markup.
  const list = [...models]
  if (selectedModel && !list.some(m => m.id === selectedModel) && selectedProvider === config.provider) {
    list.unshift({ id: selectedModel, label: selectedModel + ' (attuale)' })
  }
  modelSelect.replaceChildren(...list.map(m => {
    const option = document.createElement('option')
    option.value = m.id
    option.textContent = m.label
    option.selected = m.id === selectedModel
    return option
  }))
  if (list.length) selectedModel = modelSelect.value
}

function updateModelSelect() {
  const provider = selectedProvider
  fillModelSelect(liveModels[provider] || config.providers?.[provider]?.models || [])
  modelNote.textContent = ''
  api.listModels(provider).then(({ models, live }) => {
    if (selectedProvider !== provider) return
    if (live) {
      liveModels[provider] = models
      fillModelSelect(models)
      modelNote.textContent = provider === 'ollama' ? 'Modelli installati su questo PC.' : 'Elenco aggiornato dei modelli gratuiti.'
    } else if (provider === 'ollama') {
      modelNote.textContent = 'Ollama non risponde: elenco di esempio.'
    }
  }).catch(() => {})
}

function updateKeyField() {
  const providers = config.providers || {}
  const p = providers[selectedProvider]

  if (selectedProvider === 'ollama') {
    keySection.style.opacity = '0.4'
    keySection.style.pointerEvents = 'none'
    apiKeyInput.value = ''
    apiKeyInput.placeholder = 'Non richiesta'
    ollamaNote.style.display = 'block'
    keyHelp.textContent = 'Scarica Ollama ↗'
  } else {
    keyHelp.textContent = 'Come ottengo una chiave? ↗'
    keySection.style.opacity = '1'
    keySection.style.pointerEvents = 'auto'
    ollamaNote.style.display = 'none'
    apiKeyInput.placeholder = p?.keyPlaceholder || 'API key...'
    // Le chiavi non tornano mai dal main process: campo vuoto significa
    // “mantieni la chiave già salvata”, non “cancella la configurazione”.
    apiKeyInput.value = ''
  }
}

function updateBadge() {
  const providers = config.providers || {}
  const p = providers[config.provider]
  const models = liveModels[config.provider] || p?.models || []
  const m = models.find(x => x.id === config.model)
  providerBadge.textContent = p ? `${PROVIDER_ICONS[config.provider] || ''} ${p.name} · ${m?.label || config.model}` : '—'
}

// ── Setup save ──────────────────────────────────────────────────────────────
function isKeyFormatOk(provider, key) {
  const p = (config.providers || {})[provider]
  const prefix = p && p.keyPrefix
  if (!prefix) return true
  return !key || key.startsWith(prefix)
}
saveBtn.addEventListener('click', async () => {
  selectedModel = modelSelect.value
  const key     = apiKeyInput.value.trim()

  if (selectedProvider !== 'ollama' && !key && !config.keyConfigured?.[selectedProvider]) {
    apiKeyInput.focus()
    apiKeyInput.style.borderColor = 'rgba(255,80,80,0.6)'
    return
  }
  if (key && !isKeyFormatOk(selectedProvider, key)) {
    if (!confirm('La key non inizia con il prefisso atteso. Salvare comunque?')) return
  }

  const newKeys = {}
  if (selectedProvider !== 'ollama' && key) {
    newKeys[selectedProvider] = key
  }

  try {
    config = await api.setConfig({
      provider: selectedProvider,
      model:    selectedModel,
      keys:     newKeys,
    })
  } catch (e) {
    addMessage('error', 'Salvataggio config fallito: ' + e.message)
    return
  }

  updateBadge()
  setupCancel.classList.toggle('hidden', !isConfigured())
  setupOverlay.classList.add('hidden')
  inputEl.focus()
})

// ── Header buttons ───────────────────────────────────────────────────────────
closeBtn.addEventListener('click',    () => api.toggleChat())
settingsBtn.addEventListener('click', async () => {
  // Ricarica la config dal main per avere sempre la lista provider/modelli
  config = await api.getConfig()
  selectedProvider = config.provider || 'openrouter'
  selectedModel    = config.model    || config.providers?.[selectedProvider]?.models?.[0]?.id || ''
  buildProviderGrid()
  updateModelSelect()
  updateKeyField()
  setupCancel.classList.toggle('hidden', !isConfigured())
  setupOverlay.classList.remove('hidden')
})
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

forgetBtn.addEventListener('click', async () => {
  if (!confirm('Cancellare tutta la memoria del companion?\n\nRiassunto, conversazioni recenti e archivio vengono eliminati dal disco. Non si torna indietro.')) return
  const res = await api.memoryClear().catch(e => ({ ok: false, error: e.message }))
  if (!res?.ok) { addMessage('error', 'Cancellazione memoria fallita: ' + (res?.error || 'errore sconosciuto')); return }
  resetChatView('Memoria cancellata. Ripartiamo da zero.')
  await updateMemoryFooter()
})

// ── Messages ─────────────────────────────────────────────────────────────────
function addMessage(role, text) {
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
async function sendMessage() {
  if (sending) return
  const text = inputEl.value.trim()
  if (!text) return

  // Controllo key (eccetto ollama) — con try per non bloccare mai la UI
  try {
    const currentConfig = await api.getConfig()
    if (currentConfig.provider !== 'ollama' && !currentConfig.keyConfigured?.[currentConfig.provider]) {
      setupOverlay.classList.remove('hidden')
      return
    }
  } catch (e) {
    addMessage('error', 'Bridge non raggiungibile: avvia con npm start')
    return
  }

  inputEl.value = ''
  inputEl.style.height = 'auto'

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

  // Esegui azione OS + animazione
  const action = result.action || { type: 'none', animation: 'idle' }

  if (action.type !== 'none') {
    api.toggleChat() // chiude la chat durante l'animazione
    setTimeout(() => api.executeAction(action), 150)
  } else {
    api.executeAction({ type: 'none', animation: action.animation || 'idle' })
  }
}

// ── Focus ────────────────────────────────────────────────────────────────────
window.addEventListener('focus', () => inputEl.focus())

// ── Boot ─────────────────────────────────────────────────────────────────────
init()
