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
  // Opzioni cambiate dal menu, per tenere allineati gli interruttori della chat
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
  // Verso della camminata deciso dal main (che conosce l'area di lavoro reale)
  onCompanionFacing: (cb)    => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('companion-facing', handler)
    return () => ipcRenderer.removeListener('companion-facing', handler)
  }
})
