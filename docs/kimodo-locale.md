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

Serie di base: `npm run kimodo -- --series scripts/kimodo-series.json --out
<cartella> --keep-raw`. Venti clip in circa 5 minuti. Con `--keep-raw` salva
anche l'uscita grezza in `raw/`, e `--from-raw <cartella>/raw --series
scripts/kimodo-series.json --out <cartella>` riconverte senza scheda video
(serve quando cambia la conversione).

- **Sequenze.** Il server accetta più frasi nella stessa richiesta, con 5
  fotogrammi di raccordo: entrata, ciclo e uscita di un gesto escono insieme
  e si tagliano dopo, così le fasi si raccordano. I fotogrammi totali sono la
  somma dei segmenti.
- **Cicli.** `findLoop` cerca i due fotogrammi più simili (rotazioni e altezza
  del bacino) a distanza di almeno metà clip, `closeLoop` sfuma gli ultimi 10
  verso il primo: la ripartenza non salta.
- **Pavimento.** In Kimodo il pavimento è a y = 0 e, in piedi, la caviglia sta
  a 7 cm. La posa di riposo della clip è la T-pose in piedi su quel pavimento:
  prendendo il primo fotogramma, una clip che parte seduta veniva rialzata
  all'altezza di chi sta in piedi.
- **Seduto sul bordo.** Kimodo non vede oggetti: "sul bordo di un ripiano" lo
  fa sedere a terra. "Seduto su una sedia" dà la posa giusta (cosce
  orizzontali, gambe giù), e il bordo lo metterà la finestra (Fase B2).

## Nell'app: movimenti nuovi dalla chat (fase K)

1. L'utente chiede un movimento che non è fra i gesti ("fai un inchino").
2. Il modello risponde con `action.motion`, una frase in inglese ("A person
   does a deep, polite bow."). Il campo si spiega al modello (`MOTION_PROMPT`
   in `ai-router.js`) solo quando Kimodo è acceso, installato e l'avatar è 3D.
3. Il main (`src/main/kimodo-service.js`) ripulisce la frase (una riga, al
   massimo 200 caratteri) e guarda la cache. Se non c'è, l'avatar fa "pensa"
   con il fumetto "Provo il movimento…" e parte `kmd-generate --server`, se
   non è già acceso. Le richieste passano una alla volta; 4 minuti di tempo
   al primo avvio, 2 dopo.
4. L'uscita grezza va al renderer, che la converte in .vrma come un import,
   la riproduce nello slot `generated` e la rimanda al main (`motions:store`:
   solo chiavi appena generate, solo file glTF validi). Cache in
   `<userData>/generated-motions`, al massimo 100 file.
5. Dopo 5 minuti senza richieste il server si chiude e la memoria video torna
   libera. Spegnendo l'interruttore si chiude subito.

Si accende dal menu col tasto destro: "Movimenti nuovi con Kimodo" (se
kimodo.cpp o i pesi mancano, la voce dice "non installato"). La cartella è
`%USERPROFILE%\kimodo`; per un'altra si scrive `"kimodoDir"` a mano in
`config.json`. Dalla UI non si cambia: è la cartella di un eseguibile da
avviare.

Verifica: `npm run audit -- --kimodo %USERPROFILE%\kimodo` chiede "fai un
inchino" con Kimodo vero, controlla che la clip arrivi e che la seconda volta
esca dalla cache.

Chi scarica l'app pubblica installa kimodo.cpp e i pesi a parte. I pesi
occupano 5,5 GB e hanno licenze proprie (NVIDIA Open Model License, Meta
Llama 3), con condizioni come il credito e la copia della licenza, quindi non
entrano nell'installer.
