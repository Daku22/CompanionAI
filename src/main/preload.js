// preload.js — unico bridge sicuro tra main e renderer
// contextIsolation: true + contextBridge = zero accesso diretto a Node dal renderer

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('companion', {

  // ─── UI / Finestre ──────────────────────────────────────────────────────────
  toggleChat:       ()       => ipcRenderer.send('toggle-chat'),

  // ─── Mouse sull'avatar (companion-input.js) ────────────────────────────────
  // Il renderer dice solo quando catturare il mouse e quando inizia o finisce
  // un trascinamento: la posizione della finestra la calcola il main.
  setMouseCapture:  (on)     => ipcRenderer.send('mouse:capture', on === true),
  startDrag:        ()       => ipcRenderer.send('drag:start'),
  endDrag:          ()       => ipcRenderer.send('drag:end'),
  showMenu:         ()       => ipcRenderer.send('companion:menu'),
  // Dove sono l'ombra ai piedi (feet) e il bacino (seat) dentro la finestra:
  // il main posa l'ombra sul bordo di una finestra o della taskbar, e seduto
  // ci mette il bacino.
  setSeatAnchor:    (a)      => ipcRenderer.send('companion:seat-anchor', { x: Number(a && a.x), feet: Number(a && a.feet), seat: Number(a && a.seat) }),

  // ─── Stanza (room.js) ──────────────────────────────────────────────────────
  // La barra del titolo e i bordi li disegna la pagina: qui solo i comandi,
  // e per i bordi quale si e' preso (n, s, e, w e gli angoli).
  setView:          (mode)   => ipcRenderer.send('view:set', mode === 'room' ? 'room' : 'desktop'),
  roomMinimize:     ()       => ipcRenderer.send('room:minimize'),
  roomMaximize:     ()       => ipcRenderer.send('room:maximize'),
  roomResizeStart:  (edge)   => ipcRenderer.send('room:resize-start', String(edge)),
  roomResizeEnd:    ()       => ipcRenderer.send('room:resize-end'),
  // Scene disponibili (HDRI e modelli importati), gia' controllate dal main.
  listScenes:       ()       => ipcRenderer.invoke('scenes:list'),
  // Scala, rotazione e posto dell'avatar di una scena importata.
  updateScene:      (id, settings) => ipcRenderer.invoke('scenes:update', { id, settings }),
  // Scelta del file e conferma dell'eliminazione le fa il main, con i suoi dialoghi.
  importScene:      ()       => ipcRenderer.send('scenes:import'),
  removeScene:      (id)     => ipcRenderer.send('scenes:remove', String(id)),

  // ─── Impostazioni e voce (voice.js) ────────────────────────────────────────
  // page: la scheda da mostrare ('modello', 'generale', 'voce', 'microfono')
  openSettings:     (page)   => ipcRenderer.send('settings:open', typeof page === 'string' ? page : ''),
  onSettingsPage: (cb) => {
    const handler = (_e, page) => { try { cb(page) } catch (_) {} }
    ipcRenderer.on('settings-page', handler)
    return () => ipcRenderer.removeListener('settings-page', handler)
  },
  voiceStatus:      ()       => ipcRenderer.invoke('voice:status'),
  // Scaricamento dei file della voce: gli indirizzi e gli hash li sa il main.
  voiceDownload:    ()       => ipcRenderer.invoke('voice:download'),
  voiceCancelDownload: ()    => ipcRenderer.send('voice:cancel-download'),
  voiceRemove:      ()       => ipcRenderer.invoke('voice:remove'),
  // Una frase di prova con motore, voce e velocita' scelti (non salvati).
  voiceTest:        (opts)   => ipcRenderer.invoke('voice:test', opts && typeof opts === 'object'
    ? { engine: opts.engine, kokoroVoice: opts.kokoroVoice, xttsSpeaker: opts.xttsSpeaker, speed: opts.speed, volume: opts.volume } : {}),
  voiceStop:        ()       => ipcRenderer.send('voice:stop'),
  // XTTS: scheda video e spazio, installazione (dopo la licenza), voci incluse,
  // campione della voce scelto con il dialogo del main.
  voiceXttsCheck:   ()       => ipcRenderer.invoke('voice:xtts-check'),
  voiceXttsInstall: ()       => ipcRenderer.invoke('voice:xtts-install'),
  voiceXttsCancel:  ()       => ipcRenderer.send('voice:xtts-cancel'),
  voiceXttsRemove:  ()       => ipcRenderer.invoke('voice:xtts-remove'),
  voiceXttsSpeakers: ()      => ipcRenderer.invoke('voice:xtts-speakers'),
  voiceImportSample: ()      => ipcRenderer.invoke('voice:import-sample'),
  voiceOpenLicense: ()       => ipcRenderer.send('voice:open-license'),
  // Microfono (faster-whisper nel servizio di XTTS): installazione, e il
  // testo di una registrazione (Float32Array mono a 16 kHz).
  voiceSttInstall:  ()       => ipcRenderer.invoke('voice:stt-install'),
  voiceSttCancel:   ()       => ipcRenderer.send('voice:stt-cancel'),
  voiceSttRemove:   ()       => ipcRenderer.invoke('voice:stt-remove'),
  micTranscribe:    (pcm)    => ipcRenderer.invoke('mic:transcribe', pcm),
  // 'listening' | 'transcribing' | 'idle': il main zittisce la voce e mostra il fumetto
  micState:         (state)  => ipcRenderer.send('mic:state', String(state)),

  // ─── AI Router (renderer → main → provider) ────────────────────────────────
  sendMessage: (payload)     => ipcRenderer.invoke('ai:send-message', payload),

  // ─── Config (API keys, provider attivo) ────────────────────────────────────
  getConfig:   ()            => ipcRenderer.invoke('config:get'),
  setConfig:   (cfg)         => ipcRenderer.invoke('config:set', cfg),
  listModels:  (provider)    => ipcRenderer.invoke('models:list', provider),
  // Solo il nome del provider: l'URL della pagina lo sceglie il main.
  openKeyPage: (provider)    => ipcRenderer.invoke('app:open-key-page', provider),
  getLoginItem: ()           => ipcRenderer.invoke('app:login-item:get'),
  setLoginItem: (enabled)    => ipcRenderer.invoke('app:login-item:set', enabled),

  // ─── Memoria (fading memory) ───────────────────────────────────────────────
  memoryStats:      ()       => ipcRenderer.invoke('memory:stats'),
  memoryGetContext: ()       => ipcRenderer.invoke('memory:get-context'),
  memoryCompactNow: ()       => ipcRenderer.invoke('memory:compact-now'),
  memoryClear:      ()       => ipcRenderer.invoke('memory:clear'),
  // Umore: solo lettura. Lo cambiano le risposte e gli eventi, mai il renderer.
  getMood:          ()       => ipcRenderer.invoke('mood:get'),

  // Avatar locali: il renderer riceve solo metadati e URL avatar://, mai path reali.
  listAvatars:      ()       => ipcRenderer.invoke('avatars:list'),
  scanAvatarImport: ()       => ipcRenderer.invoke('avatars:scan-import'),
  commitAvatarImport: (data) => ipcRenderer.invoke('avatars:commit-import', data),
  // Solo gli id: il main elimina unicamente avatar importati, mai gli integrati.
  removeAvatars:    (ids)    => ipcRenderer.invoke('avatars:remove', ids),

  // Animazioni .vrma: elenco, scelta di un file da importare (il main lo legge e
  // manda solo nome e dati), salvataggio del .vrma convertito dal renderer.
  listAnimations:   ()       => ipcRenderer.invoke('animations:list'),
  pickAnimation:    ()       => ipcRenderer.invoke('animations:pick'),
  saveAnimation:    (data)   => ipcRenderer.invoke('animations:save', data),
  // Movimento generato da Kimodo e convertito qui: il main lo tiene in cache.
  storeGeneratedMotion: (data) => ipcRenderer.invoke('motions:store', data),

  // ─── Azioni OS (solo main le esegue) ───────────────────────────────────────
  executeAction: (action)    => ipcRenderer.send('os:execute', action),

  // ─── Listener eventi dal main (con unsubscribe anti-leak) ─────────────────
  onTriggerAnimation: (cb)   => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('trigger-animation', handler)
    return () => ipcRenderer.removeListener('trigger-animation', handler)
  },
  // Fumetto senza animazione ({ text, ms }; testo vuoto lo toglie)
  onCompanionBubble: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('companion-bubble', handler)
    return () => ipcRenderer.removeListener('companion-bubble', handler)
  },
  // Microfono: 'start' | 'stop' dalla scorciatoia globale (la registrazione la fa la chat)
  onMicCommand: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('mic-command', handler)
    return () => ipcRenderer.removeListener('mic-command', handler)
  },
  onWindowDragState: (cb)    => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('window-drag-state', handler)
    return () => ipcRenderer.removeListener('window-drag-state', handler)
  },
  onMoodChanged: (cb)        => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('mood-changed', handler)
    return () => ipcRenderer.removeListener('mood-changed', handler)
  },
  // Velocita' della finestra mentre la si trascina, in px/s
  onDragMotion: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('drag-motion', handler)
    return () => ipcRenderer.removeListener('drag-motion', handler)
  },
  // Cursore rispetto alla finestra, anche fuori; follow = "Segue il mouse"
  onCursor: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('cursor', handler)
    return () => ipcRenderer.removeListener('cursor', handler)
  },
  // Voci del menu col tasto destro che servono alla pagina (avatar, importa)
  onMenuCommand: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('menu-command', handler)
    return () => ipcRenderer.removeListener('menu-command', handler)
  },
  // Config cambiata altrove (Impostazioni, chat, menu sull'avatar): arriva a
  // chat e Impostazioni, che tengono allineati intestazione e interruttori
  onConfigChanged: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('config-changed', handler)
    return () => ipcRenderer.removeListener('config-changed', handler)
  },
  // Movimento generato da Kimodo: uscita grezza da convertire, o URL in cache
  onGeneratedMotion: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('generated-motion', handler)
    return () => ipcRenderer.removeListener('generated-motion', handler)
  },
  // Seduto su una finestra o sulla taskbar (perched), o sceso
  onPerchState: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('perch-state', handler)
    return () => ipcRenderer.removeListener('perch-state', handler)
  },
  // Desktop o stanza, e quanto spazio a destra occupa la chat agganciata
  onViewMode: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('view-mode', handler)
    return () => ipcRenderer.removeListener('view-mode', handler)
  },
  // Scene importate o eliminate: { select } la nuova da mostrare, { removed }
  onRoomScenes: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('room-scenes', handler)
    return () => ipcRenderer.removeListener('room-scenes', handler)
  },
  // Voce: frasi da suonare ({ type: 'chunk', pcm, rate, ... }) o { type: 'stop' }
  onVoiceAudio: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('voice-audio', handler)
    return () => ipcRenderer.removeListener('voice-audio', handler)
  },
  // Stato della voce: file, avanzamento del download, motore
  onVoiceStatus: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('voice-status', handler)
    return () => ipcRenderer.removeListener('voice-status', handler)
  },
  // Meteo vero per la scena della stanza (weather.js), o null se spento
  onRoomWeather: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('room-weather', handler)
    return () => ipcRenderer.removeListener('room-weather', handler)
  },
  // Verso della camminata deciso dal main (che conosce l'area di lavoro reale)
  onCompanionFacing: (cb)    => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('companion-facing', handler)
    return () => ipcRenderer.removeListener('companion-facing', handler)
  }
})
