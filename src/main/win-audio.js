// win-audio.js — quali programmi stanno suonando, letto dal mixer di Windows.
//
// Il ballo con la musica (Blocco 5c) parte solo se a suonare e' un'app che
// l'utente ammette (Spotify, un browser...), come in Mate Engine. Electron
// non lo sa dire: servono le sessioni audio di Windows (WASAPI), interfacce
// COM chiamate con koffi attraverso la loro vtable.
//
//   CoCreateInstance(MMDeviceEnumerator) -> GetDefaultAudioEndpoint(uscita)
//   -> Activate(IAudioSessionManager2) -> GetSessionEnumerator -> per ogni
//   sessione: IAudioSessionControl2 (processo, stato) e
//   IAudioMeterInformation (picco del suono in questo momento).
//
// Si legge e basta: niente audio catturato, niente cambiato nel mixer. Ogni
// oggetto COM ottenuto si rilascia (Release) appena letto.
//
// Se koffi o COM non vanno, available() e' false e sessions() restituisce
// un elenco vuoto: il ballo ripiega su "c'e' un'app ammessa aperta".

const S_OK = 0
const S_FALSE = 1
const CLSCTX_ALL = 0x17
const E_RENDER = 0          // dispositivi di uscita
const E_MULTIMEDIA = 1      // ruolo: musica e film
const AUDIO_SESSION_ACTIVE = 1
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PTR = 8               // solo x64: l'app esce solo per Windows x64

const CLSID_MMDeviceEnumerator = 'BCDE0395-E52F-467C-8E3D-C4579291692E'
const IID_IMMDeviceEnumerator = 'A95664D2-9614-4F35-A746-DE8DB63617E6'
const IID_IAudioSessionManager2 = '77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F'
const IID_IAudioSessionControl2 = 'BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D'
const IID_IAudioMeterInformation = 'C02216F6-8C67-4B5B-9D00-D008E73E0064'

// Posizioni nella vtable (IUnknown occupa 0, 1, 2).
const VT = {
  QueryInterface: 0, Release: 2,
  GetDefaultAudioEndpoint: 4,   // IMMDeviceEnumerator
  Activate: 3,                  // IMMDevice
  GetSessionEnumerator: 5,      // IAudioSessionManager2
  GetCount: 3, GetSession: 4,   // IAudioSessionEnumerator
  GetState: 3,                  // IAudioSessionControl
  GetProcessId: 14, IsSystemSoundsSession: 15,   // IAudioSessionControl2
  GetPeakValue: 3,              // IAudioMeterInformation
}

/** @type {any} */
let api = null
/** @type {Error|null} */
let loadError = null

function guid(text) {
  const h = text.replace(/-/g, '')
  const bytes = []
  for (let i = 16; i < 32; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16))
  return { Data1: parseInt(h.slice(0, 8), 16), Data2: parseInt(h.slice(8, 12), 16), Data3: parseInt(h.slice(12, 16), 16), Data4: bytes }
}

function load() {
  if (api || loadError) return api
  if (process.platform !== 'win32' || process.arch !== 'x64') { loadError = new Error('solo su Windows x64'); return null }
  try {
    const koffi = require('koffi')
    const ole32 = koffi.load('ole32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    koffi.struct('WA_GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) })
    const P = (sig) => koffi.proto(sig)
    api = {
      koffi,
      CoInitializeEx: ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 model)'),
      CoCreateInstance: ole32.func('int32 __stdcall CoCreateInstance(const WA_GUID *clsid, void *outer, uint32 ctx, const WA_GUID *iid, _Out_ void **out)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ char16_t *name, _Inout_ uint32 *size)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
      proto: {
        QueryInterface: P('int32 __stdcall WA_QI(void *self, const WA_GUID *iid, _Out_ void **out)'),
        Release: P('uint32 __stdcall WA_Release(void *self)'),
        GetDefaultAudioEndpoint: P('int32 __stdcall WA_GDAE(void *self, int flow, int role, _Out_ void **device)'),
        Activate: P('int32 __stdcall WA_Activate(void *self, const WA_GUID *iid, uint32 ctx, void *params, _Out_ void **out)'),
        GetSessionEnumerator: P('int32 __stdcall WA_GSE(void *self, _Out_ void **out)'),
        GetCount: P('int32 __stdcall WA_GetCount(void *self, _Out_ int *count)'),
        GetSession: P('int32 __stdcall WA_GetSession(void *self, int index, _Out_ void **out)'),
        GetState: P('int32 __stdcall WA_GetState(void *self, _Out_ int *state)'),
        GetProcessId: P('int32 __stdcall WA_GetProcessId(void *self, _Out_ uint32 *pid)'),
        IsSystemSoundsSession: P('int32 __stdcall WA_IsSystem(void *self)'),
        GetPeakValue: P('int32 __stdcall WA_GetPeak(void *self, _Out_ float *peak)'),
      },
      iid: {
        MMDeviceEnumerator: guid(CLSID_MMDeviceEnumerator),
        IMMDeviceEnumerator: guid(IID_IMMDeviceEnumerator),
        IAudioSessionManager2: guid(IID_IAudioSessionManager2),
        IAudioSessionControl2: guid(IID_IAudioSessionControl2),
        IAudioMeterInformation: guid(IID_IAudioMeterInformation),
      },
    }
    // Il thread principale di Electron ha gia' COM inizializzato (STA): la
    // risposta "modalita' diversa" va bene, COM e' comunque pronto.
    api.CoInitializeEx(null, 2)
  } catch (e) {
    loadError = e
    api = null
  }
  return api
}

/** Chiama il metodo `name` di un oggetto COM attraverso la sua vtable. */
function method(obj, name, ...args) {
  const vtbl = api.koffi.decode(obj, 'void *')
  const fn = api.koffi.decode(vtbl, VT[name] * PTR, 'void *')
  return api.koffi.call(fn, api.proto[name], obj, ...args)
}

function release(obj) {
  if (obj) try { method(obj, 'Release') } catch (_) { /* gia' rilasciato */ }
}

const nameCache = new Map()

/** Nome dell'eseguibile di un processo ("spotify.exe"), o null. */
function processName(pid) {
  if (!pid) return null
  if (nameCache.has(pid)) return nameCache.get(pid)
  let name = null
  const h = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (h) {
    try {
      const buf = Buffer.alloc(1040)
      const size = [520]
      if (api.QueryFullProcessImageNameW(h, 0, buf, size)) {
        const full = buf.toString('utf16le', 0, size[0] * 2)
        name = full.slice(full.lastIndexOf('\\') + 1).toLowerCase()
      }
    } finally { api.CloseHandle(h) }
  }
  // I pid si riusano: la cache resta piccola e si svuota ogni tanto.
  if (nameCache.size > 200) nameCache.clear()
  nameCache.set(pid, name)
  return name
}

function available() { return !!load() }

/** Perche' non e' disponibile, per il log; null se funziona. */
function unavailableReason() {
  load()
  return loadError ? loadError.message : null
}

/**
 * Le sessioni audio del dispositivo di uscita predefinito, esclusi i suoni di
 * sistema: processo, se la sessione e' attiva e il picco del suono (0..1)
 * in questo momento.
 * @returns {{ pid: number, name: string|null, active: boolean, peak: number }[]}
 */
function sessions() {
  if (!load()) return []
  const out = []
  let enumerator = null, device = null, manager = null, list = null
  try {
    const ppv = [null]
    if (api.CoCreateInstance(api.iid.MMDeviceEnumerator, null, CLSCTX_ALL, api.iid.IMMDeviceEnumerator, ppv) !== S_OK) return out
    enumerator = ppv[0]
    const dev = [null]
    if (method(enumerator, 'GetDefaultAudioEndpoint', E_RENDER, E_MULTIMEDIA, dev) !== S_OK) return out
    device = dev[0]
    const mgr = [null]
    if (method(device, 'Activate', api.iid.IAudioSessionManager2, CLSCTX_ALL, null, mgr) !== S_OK) return out
    manager = mgr[0]
    const en = [null]
    if (method(manager, 'GetSessionEnumerator', en) !== S_OK) return out
    list = en[0]
    const count = [0]
    if (method(list, 'GetCount', count) !== S_OK) return out
    for (let i = 0; i < count[0]; i++) {
      let control = null, control2 = null, meter = null
      try {
        const c = [null]
        if (method(list, 'GetSession', i, c) !== S_OK) continue
        control = c[0]
        const c2 = [null]
        if (method(control, 'QueryInterface', api.iid.IAudioSessionControl2, c2) !== S_OK) continue
        control2 = c2[0]
        if (method(control2, 'IsSystemSoundsSession') === S_OK) continue
        const pid = [0]
        const state = [0]
        method(control2, 'GetProcessId', pid)
        method(control, 'GetState', state)
        const m = [null]
        let peak = 0
        if (method(control, 'QueryInterface', api.iid.IAudioMeterInformation, m) === S_OK) {
          meter = m[0]
          const v = [0]
          if (method(meter, 'GetPeakValue', v) === S_OK && Number.isFinite(v[0])) peak = v[0]
        }
        out.push({ pid: pid[0], name: processName(pid[0]), active: state[0] === AUDIO_SESSION_ACTIVE, peak })
      } finally {
        release(meter); release(control2); release(control)
      }
    }
  } catch (e) {
    loadError = loadError || null
    console.warn('[win-audio] sessioni non lette: ' + e.message)
  } finally {
    release(list); release(manager); release(device); release(enumerator)
  }
  return out
}

// Il suono del companion stesso (la sua voce) passa da questi processi: non
// e' musica da ballare.
const SELF_NAMES = ['companionai.exe', 'electron.exe']
const MIN_PEAK = 0.01

/**
 * L'app ammessa che sta suonando adesso, o null. Puro: lo provano i test.
 * @param {{ name: string|null, active: boolean, peak: number }[]} list
 * @param {string[]} allowed nomi di eseguibili, minuscoli ("spotify.exe")
 */
function musicApp(list, allowed) {
  const ok = new Set((allowed || []).map(a => String(a).toLowerCase()))
  const hit = (list || []).find(s => s && s.active && s.peak >= MIN_PEAK && s.name && ok.has(s.name) && !SELF_NAMES.includes(s.name))
  return hit ? hit.name : null
}

module.exports = { available, unavailableReason, sessions, musicApp, SELF_NAMES, MIN_PEAK, S_FALSE }
