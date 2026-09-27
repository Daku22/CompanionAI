# Kimodo in locale (kimodo.cpp)

Kimodo genera animazioni da una frase ("A person waves hello."). Invece della
demo su Hugging Face, che si usa solo a mano, qui gira sul PC con
[kimodo.cpp](https://github.com/localai-org/kimodo.cpp): Kimodo riscritto in
C++ su ggml, con la scheda video tramite Vulkan. È la base per far generare
le animazioni all'app in sottofondo, a partire da una richiesta in chat.

## Stato: prototipo riuscito (2026-09-27)

Misurato sul PC di sviluppo: RTX 3060 da 12 GB, 15,4 GB di RAM, Windows 11.

| Cosa | Misura |
|---|---|
| Compilazione | Riuscita al primo tentativo con MSVC 14.51 (Build Tools 18), CMake e Ninja di Visual Studio, SDK Vulkan 1.4.357 |
| Pesi | 5,5 GB: modello SOMA RP v1.1 (1,13 GB) e codificatore del testo Llama-3 in Q4_K (4,39 GB), impronte verificate con il manifest |
| Primo avvio | 30 s: caricamento del modello più la prima clip |
| Ogni clip dopo | 15 s per 4 s di animazione (100 passi di campionamento) |
| Memoria video | Picco di 2,4 GB oltre a quella già in uso |
| Scheda video | Vulkan con coopmat2, uso fino al 97% durante la generazione |

Tre clip generate e controllate su Fred con `npm run preview`: seduta a
gambe incrociate, saluto con la mano destra e stiracchiata con le braccia in
alto. Sono tutte corrette. Si trovano in `%USERPROFILE%\kimodo\clips`.

## Installazione (come è stata fatta)

Tutto sta in `%USERPROFILE%\kimodo`, fuori dai repository:

1. `git clone --recursive https://github.com/localai-org/kimodo.cpp kimodo`
   (codice Apache-2.0; ggml come sottomodulo).
2. SDK Vulkan: `winget install KhronosGroup.VulkanSDK`. MSVC, CMake e Ninja
   erano già nei Build Tools di Visual Studio.
3. `build-windows.bat` nella cartella di kimodo: carica l'ambiente di MSVC,
   configura in Release con Vulkan, senza test, e compila `kmd-generate`.
4. Pesi da Hugging Face (`LocalAI-io`), in `weights/`:
   - `models/kimodo-soma-rp-v1.1-f32.gguf`, licenza NVIDIA Open Model License
     (uso commerciale permesso);
   - `Llama-3-Kimodo-Q4_K.gguf` e `tokenizer.gguf`, licenza Meta Llama 3.

   Le impronte SHA-256 vanno confrontate con il `MANIFEST.json` di ciascun
   repository, come fa il loro `scripts/download_gguf_weights.sh`.

## Come si usa

```
npm run kimodo -- --out clip.vrma --seconds 4 "A person sits down cross-legged on the floor."
npm run preview -- clip.vrma=sit-enter
```

- `scripts/kimodo-generate.mjs` avvia `kmd-generate --server`, che carica il
  modello una volta e poi riceve una richiesta per riga. Il protocollo è una
  riga di campi separati da tab: transizione, passi, seme, cartella,
  fotogrammi e file del prompt. Kimodo scrive `root_positions.f32` e
  `local_rotations_xyzw.f32`.
- `src/renderer/kimodo-raw.js` ricostruisce da quei file scheletro SOMA a 30
  ossa e clip, come la demo di kimodo.cpp (30 fotogrammi al secondo, rotazioni
  di riposo nulle). Poi `retargetClip` e `writeVRMA` producono il `.vrma`.
- `scripts/preview-clips.mjs` mostra le clip su un avatar vero, con dati finti
  e schermate.

## Cosa manca per usarlo dall'app

È la fase K del piano:
- un servizio nel main che avvia `kmd-generate --server` alla prima richiesta
  e lo chiude dopo un po' di inattività, per liberare la memoria video;
- un campo nel contratto dell'AI per descrivere un movimento che non esiste
  fra i gesti;
- la cache delle clip già generate;
- l'interruttore nelle impostazioni.

Chi scarica l'app pubblica installa kimodo.cpp e i pesi a parte. I pesi
occupano 5,5 GB e hanno licenze proprie (NVIDIA Open Model License, Meta
Llama 3), con condizioni come il credito e la copia della licenza, quindi non
entrano nell'installer.
