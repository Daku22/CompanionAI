// settings.js — la finestra Impostazioni. Per ora la sezione Voce.
//
// Le scelte si salvano subito (config.voice, controllata da guards.js). I
// file della voce li scarica e li elimina il main: qui si mostrano stato e
// avanzamento, che il main manda da solo mentre cambiano.

(function () {
  const api = window.companion
  const $ = (id) => document.getElementById(id)
  const enabled = $('voice-enabled')
  const speed = $('voice-speed')
  const volume = $('voice-volume')
  const radios = [...document.querySelectorAll('input[name="kokoro-voice"]')]

  let voice = { enabled: false, engine: 'kokoro', kokoroVoice: 'if_sara', speed: 1, volume: 0.9 }
  let status = null

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0) + ' MB'

  function showChoices() {
    enabled.checked = !!voice.enabled
    for (const r of radios) r.checked = r.value === voice.kokoroVoice
    speed.value = String(voice.speed)
    volume.value = String(voice.volume)
    $('speed-out').textContent = Number(speed.value).toFixed(2) + '×'
    $('volume-out').textContent = Math.round(Number(volume.value) * 100) + '%'
  }

  function showStatus() {
    const s = status
    if (!s) return
    const downloading = !!s.downloading
    $('files-line').textContent = s.installed
      ? 'Installati (' + mb(s.total) + ').'
      : downloading ? 'Scaricamento: ' + mb(s.downloading.done) + ' di ' + mb(s.downloading.total)
        : 'Da scaricare: ' + mb(s.total - s.have) + (s.have ? ' (ne restano da prima ' + mb(s.have) + ')' : '') + '.'
    $('bar').classList.toggle('hidden', !downloading)
    if (downloading) $('bar-fill').style.width = Math.round(100 * s.downloading.done / Math.max(1, s.downloading.total)) + '%'
    $('download-btn').classList.toggle('hidden', s.installed || downloading)
    $('cancel-btn').classList.toggle('hidden', !downloading)
    $('remove-btn').disabled = downloading || (!s.installed && !s.have)
    $('test-btn').disabled = !s.installed
    const state = $('engine-state')
    state.className = 'state'
    if (s.error) { state.textContent = 'Errore: ' + s.error; state.classList.add('error') }
    else if (s.engine === 'loading') state.textContent = 'La voce si sta caricando…'
    else if (s.engine === 'ready') { state.textContent = 'Voce pronta.'; state.classList.add('ok') }
    else state.textContent = s.installed ? 'La voce si carica alla prima frase, e si ferma dopo qualche minuto di silenzio.' : ''
    $('enable-note').textContent = voice.enabled && !s.installed ? 'Per sentirla, scarica prima i file della voce (qui sotto).' : ''
  }

  async function save(partial) {
    try {
      const cfg = await api.setConfig({ voice: partial })
      voice = { ...voice, ...(cfg.voice || {}) }
    } catch (e) { $('test-note').textContent = 'Salvataggio non riuscito: ' + e.message }
    showChoices()
    showStatus()
  }

  enabled.addEventListener('change', () => save({ enabled: enabled.checked }))
  for (const r of radios) r.addEventListener('change', () => { if (r.checked) save({ kokoroVoice: r.value }) })
  speed.addEventListener('input', () => { $('speed-out').textContent = Number(speed.value).toFixed(2) + '×' })
  speed.addEventListener('change', () => save({ speed: Number(speed.value) }))
  volume.addEventListener('input', () => { $('volume-out').textContent = Math.round(Number(volume.value) * 100) + '%' })
  volume.addEventListener('change', () => save({ volume: Number(volume.value) }))

  $('test-btn').addEventListener('click', async () => {
    const note = $('test-note')
    note.textContent = 'Preparo la voce…'
    $('test-btn').disabled = true
    try {
      const res = await api.voiceTest({ voice: voice.kokoroVoice, speed: Number(speed.value), volume: Number(volume.value) })
      note.textContent = res && res.ok ? '' : 'Non ha parlato: ' + ((res && res.error) || 'errore sconosciuto')
    } catch (e) { note.textContent = 'Non ha parlato: ' + e.message }
    $('test-btn').disabled = !(status && status.installed)
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
    if (!confirm('Eliminare i file della voce? Si possono riscaricare quando vuoi.')) return
    try { status = await api.voiceRemove() } catch (_) { /* lo stato arriva comunque */ }
    showStatus()
  })

  if (api.onVoiceStatus) api.onVoiceStatus((s) => { status = s; showStatus() })

  ;(async () => {
    try {
      const cfg = await api.getConfig()
      voice = { ...voice, ...(cfg.voice || {}) }
    } catch (_) { /* restano i predefiniti */ }
    showChoices()
    try { status = await api.voiceStatus() } catch (_) { status = null }
    showStatus()
  })()
})()
