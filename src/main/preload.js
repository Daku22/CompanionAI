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
  // Ballo con la musica (Blocco 5c): chi sta suonando, e se sta ballando.
  getMusicState:    ()       => ipcRenderer.invoke('music:state'),
  setDancing:       (on)     => ipcRenderer.send('companion:dancing', on === true),
  onMusicState: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('music-state', handler)
    return () => ipcRenderer.removeListener('music-state', handler)
  },
  // Un tocco sull'avatar: zona e tipo ('poke', 'pat'), e se la voce sta gia'
  // parlando (allora la battuta resta nel fumetto). Torna la reazione da
  // recitare, { off: true } se i tocchi sono spenti, o null.
  touch:            (zone, kind, speaking) => ipcRenderer.invoke('companion:touch', { zone: String(zone), kind: String(kind), speaking: speaking === true }),
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
  // page: la scheda da mostrare ('modello', 'generale', 'voce', 'microfono', 'live2d')
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
  // Live2D: il Cubism Core, scaricato dopo l'accettazione della licenza
  live2dStatus:     ()       => ipcRenderer.invoke('live2d:status'),
  live2dInstall:    ()       => ipcRenderer.invoke('live2d:install'),
  live2dCancel:     ()       => ipcRenderer.send('live2d:cancel'),
  live2dRemove:     ()       => ipcRenderer.invoke('live2d:remove'),
  live2dOpenLicense: ()      => ipcRenderer.send('live2d:open-license'),
  // Il modello Live2D in vista (gruppi ed espressioni) e le scelte di abbinamento
  live2dReportModel: (m)     => ipcRenderer.send('live2d:report-model', m && typeof m === 'object'
    ? { id: m.id, name: m.name, groups: m.groups, expressions: m.expressions } : null),
  live2dModel:      ()       => ipcRenderer.invoke('live2d:model'),
  // L'avatar caricato e se ha uno scheletro umano; risponde { chibi } (Blocco 5d)
  reportAvatar:     (info)   => ipcRenderer.invoke('avatar:report', info && typeof info === 'object'
    ? { id: info.id, kind: info.kind, humanoid: info.humanoid } : null),
  // Chibi per l'avatar in vista: { available, reason, on }
  chibiState:       ()       => ipcRenderer.invoke('avatar:chibi-state'),
  setChibi:         (on)     => ipcRenderer.invoke('avatar:set-chibi', on === true),
  // Sbircia dal bordo: dove tagliare e dove sta la testa (px della finestra), e il doppio clic che lo fa uscire
  peekGeometry:     (g)      => ipcRenderer.send('companion:peek-geometry', g && typeof g === 'object'
    ? { side: g.side, cut: g.cut, headX: g.headX, headY: g.headY } : null),
  peekOut:          ()       => ipcRenderer.send('companion:peek-out'),
  // Batti cinque: 'offer' | 'cancel' | 'slap' | 'missed'; risponde con la reazione
  highFive:         (event, speaking) => ipcRenderer.invoke('companion:highfive', { event: String(event), speaking: speaking === true }),
  // Solo per audit.mjs: il main risponde solo con COMPANION_TEST_HOOKS=1
  testPeek:         (cmd)    => ipcRenderer.invoke('test:peek', cmd),
  live2dSetChoices: (id, choices) => ipcRenderer.invoke('live2d:set-choices', id, choices),
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
  // Scelte di abbinamento Live2D cambiate (tutte, per avatar)
  onLive2DChoices: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('live2d-choices', handler)
    return () => ipcRenderer.removeListener('live2d-choices', handler)
  },
  // Il modello Live2D in vista e le sue scelte, per la scheda Live2D
  onLive2DModel: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('live2d-model', handler)
    return () => ipcRenderer.removeListener('live2d-model', handler)
  },
  // Chibi acceso o spento per un avatar ({ id, on }), al companion
  onChibi: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('avatar-chibi', handler)
    return () => ipcRenderer.removeListener('avatar-chibi', handler)
  },
  // Sbircia dal bordo ({ side: 'left' | 'right' }) o esce ({ side: null, reason })
  onEdgePeek: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('edge-peek', handler)
    return () => ipcRenderer.removeListener('edge-peek', handler)
  },
  // Chibi per l'avatar in vista ({ available, reason, on }), alle Impostazioni
  onChibiState: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('chibi-state', handler)
    return () => ipcRenderer.removeListener('chibi-state', handler)
  },
  // Stato del Cubism Core: installato, avanzamento, errore
  onLive2DStatus: (cb) => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('live2d-status', handler)
    return () => ipcRenderer.removeListener('live2d-status', handler)
  },
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
