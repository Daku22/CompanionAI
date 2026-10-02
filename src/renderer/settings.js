// settings.js — la finestra Impostazioni: Modello (provider, modello e
// chiave), Generale (avvio, vita autonoma, meteo), Voce e Microfono.
//
// Il Modello si salva con il suo pulsante, come nella chat al primo avvio
// (provider-form.js e' la stessa scheda). Il resto si salva subito (config,
// controllata da guards.js). I file e l'installazione di XTTS e del microfono
// li gestisce il main: qui si mostrano stato e avanzamento, che il main manda
// da solo mentre cambiano (voice-status).

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

  // Schede. La chat apre Modello (#modello nell'indirizzo, o settings-page
  // con la finestra gia' aperta); altrimenti si riapre sull'ultima scelta.
  const tabs = [...document.querySelectorAll('nav .item[data-page]')]
  function showPage(name) {
    if (!tabs.some(t => t.dataset.page === name)) name = 'modello'
    for (const t of tabs) {
      t.classList.toggle('active', t.dataset.page === name)
      if (t.dataset.page === name) t.setAttribute('aria-current', 'page')
      else t.removeAttribute('aria-current')
    }
    for (const p of document.querySelectorAll('.page')) p.classList.toggle('hidden', p.id !== 'page-' + name)
    try { localStorage.setItem('settings-page', name) } catch (_) { /* niente memoria: si riparte da Modello */ }
  }
  for (const t of tabs) t.addEventListener('click', () => showPage(t.dataset.page))
  let lastPage = location.hash.slice(1)
  if (!lastPage) try { lastPage = localStorage.getItem('settings-page') || '' } catch (_) {}
  showPage(lastPage)
  if (api.onSettingsPage) api.onSettingsPage(showPage)

  // Conferma con un secondo clic, al posto di confirm(): il primo arma il
  // pulsante e scrive l'avviso sotto la sua riga, il secondo (entro 5
  // secondi) agisce. Restituisce true solo al secondo clic.
  function confirmClick(btn, warning) {
    const row = btn.closest('.row') || btn
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
    touchReactions.checked = cfg.touchReactions !== false
    danceMusic.checked = cfg.danceMusic === true
    $('dance-section').classList.toggle('hidden', !danceMusic.checked)
    if (document.activeElement !== danceApps) danceApps.value = (cfg.danceApps || []).join(', ')
    weatherOn.checked = cfg.weather === true
    $('weather-section').classList.toggle('hidden', !weatherOn.checked)
    if (document.activeElement !== weatherCity) weatherCity.value = cfg.weatherCity || ''
    $('weather-status').textContent = cfg.weather && cfg.weatherStatus ? '→ ' + cfg.weatherStatus : ''
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
  touchReactions.addEventListener('change', () => saveGeneral({ touchReactions: touchReactions.checked }))
  danceMusic.addEventListener('change', () => saveGeneral({ danceMusic: danceMusic.checked }))
  danceApps.addEventListener('change', () => saveGeneral({ danceApps: danceApps.value.split(/[,;\n]+/) }))
  danceApps.addEventListener('keydown', (e) => { if (e.key === 'Enter') danceApps.blur() })
  weatherOn.addEventListener('change', () => saveGeneral({ weather: weatherOn.checked, weatherCity: weatherCity.value }))
  weatherCity.addEventListener('change', () => saveGeneral({ weatherCity: weatherCity.value }))
  weatherCity.addEventListener('keydown', (e) => { if (e.key === 'Enter') weatherCity.blur() })

  // Config cambiata altrove (chat, menu sull'avatar, o questa finestra): gli
  // interruttori si allineano. La scheda Modello si ricarica solo se provider,
  // modello o chiavi sono cambiati davvero, per non perdere una scelta a meta'.
  if (api.onConfigChanged) api.onConfigChanged((cfg) => {
    if (!cfg) return
    showGeneral(cfg)
    if (formKey(cfg) !== formShown) loadForm(cfg)
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
    if (!voice.micEnabled) note.textContent = 'Accendi il microfono per usare la scorciatoia e la prova.'
    else if (voice.micShortcut === 'off') note.textContent = 'Parli solo con il pulsante del microfono nella chat.'
    else if (micShortcutActive !== voice.micShortcut) note.textContent = 'Questa scorciatoia la usa già un altro programma: scegline un\'altra.'
    else note.textContent = 'Funziona anche con la chat chiusa: tieni premuto, parla, lascia.'
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
