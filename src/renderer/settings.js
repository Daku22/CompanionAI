// settings.js — la finestra Impostazioni. Per ora la sezione Voce.
//
// Le scelte si salvano subito (config.voice, controllata da guards.js). I
// file e l'installazione di XTTS li gestisce il main: qui si mostrano stato e
// avanzamento, che il main manda da solo mentre cambiano (voice-status).

(function () {
  const api = window.companion
  const $ = (id) => document.getElementById(id)
  const enabled = $('voice-enabled')
  const speed = $('voice-speed')
  const volume = $('voice-volume')
  const engines = [...document.querySelectorAll('input[name="engine"]')]
  const radios = [...document.querySelectorAll('input[name="kokoro-voice"]')]
  const cpml = $('cpml')
  const speakerSel = $('xtts-speaker')

  let voice = { enabled: false, engine: 'kokoro', kokoroVoice: 'if_sara', speed: 1, volume: 0.9, xttsSpeaker: 'sample', xttsSample: null, cpmlAccepted: false }
  let status = null
  let check = null        // { gpu, freeBytes } dal main
  let speakersLoaded = false

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
    if (x.installed && x.state === 'ready' && !speakersLoaded) loadSpeakers()
  }

  function showStatus() {
    if (!status) return
    showKokoro(status)
    if (status.xtts) showXtts(status.xtts)
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
    } catch (_) { speakersLoaded = false }
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
    if (!confirm('Eliminare i file di Kokoro? Si possono riscaricare quando vuoi.')) return
    try { status = await api.voiceRemove() } catch (_) { /* lo stato arriva comunque */ }
    showStatus()
  })

  $('xtts-install').addEventListener('click', async () => {
    if (check && check.freeBytes !== null && check.freeBytes < XTTS_NEEDS &&
      !confirm('Lo spazio libero sembra poco (servono circa 10 GB). Provare lo stesso?')) return
    try { status = await api.voiceXttsInstall() } catch (e) { $('xtts-line').textContent = 'Errore: ' + e.message }
    speakersLoaded = false
    showStatus()
  })
  $('xtts-cancel').addEventListener('click', () => api.voiceXttsCancel())
  $('xtts-remove').addEventListener('click', async () => {
    if (!confirm('Disinstallare XTTS? Si cancellano Python, i pacchetti e il modello (circa 7 GB). Il campione della tua voce resta.')) return
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

  if (api.onVoiceStatus) api.onVoiceStatus((s) => { status = s; showStatus() })

  ;(async () => {
    try {
      const cfg = await api.getConfig()
      voice = { ...voice, ...(cfg.voice || {}) }
    } catch (_) { /* restano i predefiniti */ }
    showChoices()
    try { status = await api.voiceStatus() } catch (_) { status = null }
    showStatus()
    try { check = await api.voiceXttsCheck() } catch (_) { check = null }
    showStatus()
  })()
})()
