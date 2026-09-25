# Briefing tecnico: integrazione avatar 3D (VRM) nel Desktop Companion

> **Nota per la versione pubblica.** Questo documento è la ricerca iniziale e
> cita DUST, valutato e poi scartato: la sua licenza non è verificabile, e non
> fa parte dell'app. L'unico modello 3D incluso è Fred (vedi ASSETS-LICENSE.md).

> **Stato al 13 settembre 2026.** I punti 1, 2, 3 e 5 dei "prossimi passi" in
> fondo sono stati completati: il protocollo `vrm://` funziona, i modelli si
> caricano in `companion.html` e sono agganciati a `trigger-animation`. Le
> animazioni non usano Kimodo: sono pose procedurali scritte a mano nella
> tabella `CLIPS` di `src/renderer/vrm-animation.js`. La parte su Kimodo e sul retargeting
> SOMA resta ricerca non implementata, conservata qui perche' e' ancora la
> strada piu' promettente se le pose a mano non basteranno.

Contesto per il coding agent: riassunto della sessione di ricerca e decisioni prese riguardo all'introduzione di un layer di avatar 3D animato via Kimodo, a partire dall'esplorazione iniziale del repo kimodo.cpp.

## 1. Kimodo.cpp — cos'è e perché è rilevante

`kimodo.cpp` (github.com/localai-org/kimodo.cpp) è un porting C++/GGML del modello NVIDIA Kimodo per text-to-motion: genera animazioni scheletriche a partire da un prompt testuale, gira su CPU/Vulkan senza stack PyTorch/CUDA.

**Dati tecnici verificati:**
- Modello di diffusione del moto: 282M parametri (~560MB in F16) — leggero.
- Text encoder (LLM2Vec-based, su base tipo Llama): componente pesante, motivo per cui la pipeline Python originale NVIDIA richiede ~17GB VRAM.
- Modelli quantizzati (Q4/Q8): **non ancora implementati** in kimodo.cpp — solo GGUF piena precisione al momento.
- Mitigazione RAM: `kimodo_generate_embedding` accetta embedding testuali precalcolati (vettori F32 4096-dim), bypassando il text encoder pesante a runtime.
- Chunking configurabile del text encoder (`KIMODO_TEXT_LAYER_CHUNK`) per chi vuole comunque farlo girare in locale.

**Scheletri disponibili — differenze chiave:**
| Skeleton | Giunti | Cos'è | Adatto al progetto? |
|---|---|---|---|
| SOMA | 30 (interno) / 77 (espanso, con mani) | Skeleton umano generico | **Sì** — nomi giunti (Hips, Spine1, Chest, Neck1, Head...) semanticamente vicini a rig humanoid standard tipo VRM/Mixamo |
| G1 | 34 | Skeleton del **robot fisico Unitree G1** | No — è robotica, non avatar virtuali |
| SMPL-X | 22 | Standard accademico/CV | Sconsigliato — vedi problema di licenza sotto |

**Licenza — punto critico:**
- Codice del port kimodo.cpp: Apache-2.0 (permissivo).
- Checkpoint SOMA-RP-v1.1 / SOMA-SEED-v1.1 / G1-RP-v1: **NVIDIA Open Model License, commercial-use ready**.
- Checkpoint SMPL-X: **ambiguo** — il README di kimodo.cpp avverte esplicitamente che, nonostante un file LICENSE apparentemente permissivo nel repo upstream, i termini d'accesso reali su Hugging Face indicano una licenza più restrittiva da "uso R&D interno" da considerare vincolante. Inoltre è gated (richiede login/accettazione termini). **Decisione presa: usare SOMA, evitare SMPL-X.**

**Limite importante del modello, indipendente dall'implementazione:**
L'espansione SOMA 30→77 giunti (quella con le dita) è un **pattern fisso "relaxed-hand"**, non un output del modello di diffusione — le dita non sono mai animate in modo espressivo dal prompt testuale, né in kimodo.cpp né nella pipeline Python ufficiale NVIDIA. È solo un padding geometrico per compatibilità di formato, quindi economico da implementare ma non aggiunge vera articolazione delle dita.

**Strategia consigliata per l'hardware target (portatile con 4 GB di RAM e grafica integrata):**
Non far girare Kimodo live dentro l'app in produzione. Usarlo **offline come strumento di generazione contenuti** (sul PC di sviluppo) per pre-generare una libreria di clip comuni (idle, greet, nod, think, wave...), retargettarle una volta sola su VRM, e spedirle come `THREE.AnimationClip` già pronte nel progetto. A runtime il Companion riproduce solo clip precalcolate via `AnimationMixer` — economico anche su hardware debole. L'inferenza live resta un'eventuale modalità "avanzata" futura.

## 2. Architettura avatar: multi-backend dietro un'interfaccia comune

Il progetto ha (o avrà) tre tipi di avatar coesistenti:
- **Spritesheet 2D** — già esistente (generato con Nano Banana/Gemini image gen).
- **Live2D Cubism** — feature futura, da evolvere piano piano nella sezione "modelli 2D" esistente.
- **VRM 3D** — nuova sezione "modelli 3D", oggetto di questa sessione.

Decisione architetturale: un **Avatar Manager** nel renderer che espone un'interfaccia comune (`load()`, `update()`, futuro `playAction(name)`) e seleziona il backend giusto in base a un manifest per pacchetto avatar:
```json
{ "type": "vrm" | "live2d" | "spritesheet", "assets": {...}, "actions": { "idle": "...", "greet": "..." } }
```
Il layer agentico emette solo eventi semantici (`{action:"greet"}`) — non deve sapere quale backend è attivo. Questo contratto combacia con il sistema di eventi `trigger-animation` main→renderer già presente in `preload.js`/`main.js` (usato oggi dallo spritesheet): il futuro `VRMBackend` si aggancerà allo stesso evento, non ne serve uno nuovo.

**Live2D Cubism — note di licenza per quando si svilupperà quella parte:**
- Cubism Core (runtime proprietario) non è su GitHub, va scaricato a parte dal sito Live2D — rompe il workflow abituale "copia il repo in src/".
- Gratuito anche per uso commerciale sotto i 10 milioni di yen di fatturato annuo (General User / Small-Scale Enterprise) — nessun costo per ora.
- Framework (rendering) è open, su GitHub, in TypeScript/WebGL — coesiste bene con Three.js nello stesso processo Electron.

## 3. Selezione del modello VRM

**Target di leggerezza stabilito** (proxy: avatar VRChat "Quest-compatible", dato che la GPU integrata dell'i3 è paragonabile/inferiore a una GPU mobile):
- Triangoli: ~10.000–15.000 o meno
- 1 solo materiale/atlas texture, non uno per parte
- Texture 512-1024px, non 2K/4K
- Spring bone (fisica capelli/vestiti) ridotti al minimo

**Modelli candidati valutati (dati reali estratti dai file, non dalle descrizioni):**

| Modello | Fonte | Triangoli | Materiali | Texture | Bones | Blend shape | Licenza |
|---|---|---|---|---|---|---|---|
| RadDollV3 (versione full) | Booth.pm (tonomaoo) | — (855MB, non ancora convertito) | — | — | — | — | Da leggere sui termini Booth (giapponese), non verificata |
| DUST | file caricato dall'utente | 20.952 | 15 | 27 | 121 | 560 | VRM 0.x, `licenseName: "Other"` con `otherLicenseUrl` **vuoto** — termini reali non verificabili dal file, **da scartare o approfondire con la fonte originale (Twitter @bab1ecore)** |
| **Fred** ✅ scelto | VRoid Hub (Swampazzo) | 39.334 (poi ottimizzato, vedi sotto) | 11 | 21 | 115 | 456 | **VRM 1.0 completo**: `commercialUsage: "corporation"`, `allowRedistribution: true`, `modification: "allowModificationRedistribution"`, credito non richiesto — licenza chiarissima, nessuna ambiguità |

Nota importante: la descrizione del creatore di Fred lo definiva "simplistic body base" ma i dati misurati mostrano che è in realtà **più pesante** di DUST sui triangoli (39k vs 21k) — le descrizioni testuali non sono affidabili, sempre meglio misurare il file reale.

**Decisione presa: Fred**, per via della licenza nettamente più solida e verificabile, nonostante il poligon count più alto del target ideale.

**Ottimizzazione già applicata a Fred** (script Python, verificata visivamente sulle texture ridotte, nessuna corruzione):
- 3 texture originariamente a 2048×2048 ridotte a 1024×1024 (max-dimension cap, LANCZOS resampling)
- File: 13,09MB → 9,37MB
- Mesh, skinning, blend shape, struttura ossa: **non toccati**, identici all'originale
- File risultante: `Fred_optimized.vrm`, posizionato in `modelli-3d/Fred/Fred_optimized.vrm`

**Non ancora fatto (eventuale prossimo step se il modello risultasse ancora pesante a runtime):** decimazione mesh (39k→~15k triangoli). Non eseguita in automatico perché rischiosa senza controllo visivo — coinvolge 456 blend shape e 115 bone, da fare eventualmente in Blender/VRoid Studio a mano, non con un tool generico.

## 4. Setup di rendering (three.js + @pixiv/three-vrm)

Libreria: `@pixiv/three-vrm` v3.x (MIT license), via `npm install three @pixiv/three-vrm`.

Pattern di caricamento standard:
```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(url, (gltf) => {
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.removeUnnecessaryJoints(gltf.scene);
  scene.add(vrm.scene);
});

// nel loop di animazione:
vrm.update(deltaTime); // aggiorna spring bone, look-at, espressioni
```

**Ottimizzazioni raccomandate per l'hardware target:**
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1))`
- `VRMUtils.removeUnnecessaryVertices` / `removeUnnecessaryJoints` al caricamento (gratis, incluso nella libreria)
- Considerare cap a 30fps invece di 60fps nel loop di rendering

## 5. Problema CORS/file:// e soluzione in corso

**Sintomo riscontrato**: aprendo un HTML di test direttamente (`file://`) in Chrome, `GLTFLoader` (che usa `fetch()` internamente) viene bloccato da CORS — origine `file://` è trattata come "null" e isolata.

**Soluzione usata per il test in browser**: servire i file via `http-server` locale (`npx http-server -p 8080`) invece di aprire l'HTML come file — bypassa il problema perché l'origine diventa `http://localhost`. **Funziona**, modelli Fred e DUST testati con successo in questo modo (visualizzazione + `OrbitControls` per ruotare la vista).

**Per la produzione dentro Electron**, lo stesso problema si ripresenta perché le finestre BrowserWindow caricano di default via `file://`. Analizzando `main.js` è emerso che **esiste già un protocollo Electron personalizzato `vrm://`** pensato esattamente per questo, con protezione path-traversal:
```js
protocol.handle('vrm', (request) => {
  const relativePath = request.url.replace('vrm://', '');
  const safeRoot = path.join(__dirname, '..', '..', 'modelli-3d');
  const absolutePath = path.join(safeRoot, relativePath.replace('modelli-3d/', ''));
  if (!absolutePath.startsWith(safeRoot)) return new Response(null, { status: 403 });
  return net.fetch('file://' + absolutePath);
});
```

**Due problemi da verificare/correggere in questo handler, prima di usarlo:**

1. **Path probabilmente sbagliato di un livello**: usa `path.join(__dirname, '..', '..', 'modelli-3d')` (due `..`). Ma altrove nello stesso file, `require('../memory/MemoryManager')` implica che `main.js` sta un solo livello sopra la cartella `memory/` (struttura presumibile: `main.js` in una cartella `main/`, con `renderer/`, `memory/`, `modelli-3d/` tutte sorelle un livello sopra). Se così, il percorso corretto sarebbe `path.join(__dirname, '..', 'modelli-3d')` — un solo `..`. **Da verificare contro la struttura cartelle reale e correggere se necessario.**

2. **Manca la registrazione dei privilegi dello schema**: perché un protocollo custom funzioni pienamente con `fetch()` (usato internamente da `GLTFLoader`), Electron generalmente richiede:
```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'vrm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
```
chiamato a livello di modulo, **prima** di `app.whenReady()`. Non presente nel file attuale — senza, il caricamento potrebbe fallire in modo simile al CORS già visto nel browser. **Da aggiungere e testare.**

**Se il protocollo `vrm://` funziona una volta corretto**, il caricamento nel renderer diventa semplicemente:
```js
loader.load('vrm://Fred/Fred_optimized.vrm', (gltf) => { ... });
```
— nessun bisogno di IPC/preload per questo, il protocollo gestisce già l'accesso sicuro al filesystem.

**Alternativa di fallback** (se il protocollo custom risultasse problematico): passare da IPC, con un handler `avatar:load-model` in `main.js` (stile coerente con gli altri handler già presenti come `config:get`, `memory:stats`) che legge il file con `fs.readFileSync` e lo restituisce come `Uint8Array` al renderer, che poi chiama `loader.parse(arrayBuffer, ...)` invece di `loader.load(url, ...)`. Documentata come piano B, non ancora implementata.

## 6. Stato attuale del progetto (contesto generale)

- Architettura standalone: nessun sidecar esterno, tutto dentro Electron e Node.
- Azioni OS ristrette con allowlist e controlli sui percorsi (`os:execute`).
- Router AI multi-provider: Claude, OpenAI, Grok, Gemini, Mistral, Ollama,
  OpenRouter. Formato della risposta vincolato lato API dove il provider lo
  permette.
- Memoria che sfuma con compattazione automatica, e soprattutto **riletta nel
  prompt** prima di ogni chiamata al modello.
- `preload.js` con `contextBridge` e namespace per dominio (`config:*`,
  `memory:*`, `os:*`). Ogni funzionalita' nuova segue la stessa convenzione.
- Le librerie del renderer stanno in `src/renderer/vendor/`, copiate da
  `scripts/vendor.js`: non caricare piu' nulla da `node_modules` a runtime.

## 7. Prossimi passi

Fatto: protocollo `vrm://` con controllo del traversal, registrazione dello
schema come privilegiato prima di `app.whenReady()`, caricamento verificato
dentro `companion.html`, aggancio a `trigger-animation`, e un livello di pose
procedurali con fusione in entrata e uscita.

Da fare, in ordine di utilita':

1. Ritoccare a occhio i numeri della tabella `CLIPS` in `src/renderer/vrm-animation.js`. Sono
   stati scritti senza poter guardare il risultato: le ampiezze sono
   volutamente contenute, e alcune pose staranno meglio con angoli diversi.
2. `vrm.lookAt` per far seguire il cursore agli occhi. Il bersaglio e' gia'
   impostato sulla camera, va solo spostato sul mouse.
3. Cache dei modelli VRM: oggi ogni cambio di avatar rilegge il file.
4. Solo se le pose a mano si rivelano insufficienti, valutare la generazione
   offline di clip con Kimodo e il retargeting SOMA su bone VRM. E' un salto di
   complessita' grosso: non iniziarlo senza una ragione concreta.
