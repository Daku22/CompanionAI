// preload.js — unico bridge sicuro tra main e renderer
// contextIsolation: true + contextBridge = zero accesso diretto a Node dal renderer

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('companion', {

  // ─── UI / Finestre ──────────────────────────────────────────────────────────
  toggleChat:       ()       => ipcRenderer.send('toggle-chat'),

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

  // Avatar locali: il renderer riceve solo metadati e URL avatar://, mai path reali.
  listAvatars:      ()       => ipcRenderer.invoke('avatars:list'),
  scanAvatarImport: ()       => ipcRenderer.invoke('avatars:scan-import'),
  commitAvatarImport: (data) => ipcRenderer.invoke('avatars:commit-import', data),

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
  // Verso della camminata deciso dal main (che conosce l'area di lavoro reale)
  onCompanionFacing: (cb)    => {
    const handler = (_e, data) => { try { cb(data) } catch (_) {} }
    ipcRenderer.on('companion-facing', handler)
    return () => ipcRenderer.removeListener('companion-facing', handler)
  }
})
