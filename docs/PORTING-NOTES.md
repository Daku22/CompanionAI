# Porting Notes

> Registro storico dello sviluppo. Cita cartelle e asset che non fanno parte
> della versione pubblica: `research/` (repository di terzi usati come
> riferimento, mai inclusi) e gli avatar Yanineko, Dust e Neko, tolti perche'
> le loro licenze non ne permettono la ridistribuzione (vedi ASSETS-LICENSE.md).

## Decisione architetturale (2026-09-12): standalone, no Hermes
- Hermes/OpenClaw scartati come dipendenze runtime: progetto unico senza sidecar esterno.
- Memoria, router, animazioni restano 100% in `src/` (Electron + Node). Nessun `import` da `research/repos` a runtime.
- L'app deve restare leggera: deve girare anche su macchine modeste.

## Strip 2D da PNG con alpha (2026-09-12)
- Sorgente: `reference-yanineko/spritesheet/*.png` (9 animazioni, griglia 4x2; CLICK 4x3, WALK 8x1).
- Assembly: slice da manifest, chiusi buchi testa (WAVE/IDLE/SMOKE/CLICK), export `src/renderer/assets/strips/` @1x + @2x Lanczos (Real-ESRGAN non installabile su Python 3.14 per `basicsr`) + `strips.json`.
- Loader `companion.html`: manifest inline, skip `removeBackground` su PNG con alpha, anchor piedi da bbox, @2x oltre dpr 1.25 o altezza >500px, mipmaps + filtro lineare.

## Riordino strutturale (2026-09-13)

Non e' un porting da una repo esterna, ma va tracciato qui perche' tocca tutto.

- **Controllo di versione**: il progetto non era in git, il versionamento
  avveniva copiando cartelle. Ora c'e' un repository con
  `.gitignore` che esclude `node_modules`, `research/`, `data/` e i `.env`.
- **Memoria collegata al prompt**: `MemoryManager` scriveva senza che nessuno
  rileggesse. `buildHistoryWithMemory()` in `main.js` antepone riassunto e turni
  non ancora presenti in chat; `prepare()` nel router estrae i messaggi di
  sistema, altrimenti Anthropic e Gemini li scartavano insieme alla memoria.
- **ID modelli**: la lista Anthropic conteneva id 4.x inesistenti e il default
  OpenRouter era un modello morto, quindi ogni installazione nuova falliva al
  primo messaggio. Liste verificate; nessun id resta codificato in UI o test.
- **Output vincolato**: schema JSON su Anthropic, json mode altrove. Il parser
  di recupero resta solo per i provider che non supportano il vincolo.
- **Un solo MemoryManager**: il gemello `.ts` divergeva dal `.js` su quali
  metodi fossero asincroni. Rimosso; al suo posto `allowJs` + `checkJs`
  controllano l'implementazione vera, con i tipi agganciati da `types.ts`.
- **Animazioni 3D**: aggiunte pose procedurali con fusione. Prima la modalita'
  VRM rispondeva solo con le espressioni facciali.
- **Camminata reale**: `walk-to` e `run-to` spostano la finestra sull'area di
  lavoro invece di far scorrere lo sprite dentro il riquadro.
- **Pacchetto**: le librerie del renderer vengono copiate in
  `src/renderer/vendor/` da `scripts/vendor.js`. electron-builder escludeva le
  cartelle `examples` di node_modules, quindi il 3D si rompeva solo nella build.
  Il controllo di chiusura degli import ha subito trovato `three.core.js`, che
  mancava anche prima.
- **Build fuori dalle cartelle sincronizzate**: la sincronizzazione bloccava l'exe durante
  `rcedit`. `scripts/build.js` scrive sotto la temp di sistema.
- **Icona**: generata da `scripts/make-icon.js` con zlib, senza dipendenze.
- **Asset**: `modelli 2d` e `reference yanineko` erano in gran parte identiche,
  fuse in `reference-yanineko`. Rimosse sette immagini in
  `src/renderer/assets/` che nessuno caricava e che finivano nel pacchetto.
- **Avvio verificato davvero**: fino a qui il controllo era su sintassi, tipi,
  test e contenuto dell'archivio. Lanciando l'app sono emersi due difetti che
  nessuno di quei controlli poteva vedere. Primo: nell'import map i percorsi
  relativi devono iniziare con `./`, altrimenti il browser li blocca con
  "matches but is blocked by a null value" e Three.js non si carica affatto.
  Secondo: Chromium abbassa il maiuscolo dell'host negli URL con schema
  standard, quindi `vrm://Fred/...` arriva al gestore come `vrm://fred/...`.
  Su Windows non si nota, altrove il modello non verrebbe trovato: il gestore
  ora riporta ogni segmento al nome reale della cartella.

## Revisione e correzioni (2026-09-25)

Non e' un porting. Revisione completa del codice, con un test per ogni
correzione che fallisce senza il fix.

- **Memoria persa nelle chat lunghe**: `sanitizeHistory` tagliava a 40 l'intera
  lista, e il riassunto in testa era il primo a sparire. Ora il limite vale
  solo per il dialogo.
- **Dialogo che partiva da "assistant"**: i turni recuperati dalla memoria
  potevano cominciare da una risposta del companion, e Anthropic risponde 400.
  `normalizeDialog` scarta le risposte iniziali e unisce i ruoli ripetuti.
- **UTF-8 spezzato**: i chunk di rete venivano convertiti uno per uno e una
  lettera accentata a cavallo di due chunk diventava "��".
- **Allowlist aggirabile**: `C:\qualsiasi\notepad.exe` passava perche' si
  guardava solo il nome finale, ed `explorer <file>` lanciava eseguibili. Le
  regole sono in `src/main/guards.js`, applicate prima del dialogo di conferma.
  `open-path` non apre piu' eseguibili e script.
- **Config dal renderer**: `setConfig` accettava qualunque campo, compreso
  `allowUnsafeCommands`. Ora passano solo provider, modello, chiavi e avatar.
- **run-command chiudeva Blocco note dopo 15 secondi**: `execFile` con
  `timeout` uccideva il processo. Ora parte staccato con `spawn`.
- **Camminata 2D ferma al primo frame**: la meta' dello sprite coincideva con
  la posizione. Il passo ora dura finche' il main non manda idle.
- **↺ cancellava la memoria permanente**: ora pulisce solo la chat. La
  cancellazione vera e' "Dimentica tutto", con conferma, e rimuove anche
  l'archivio dal disco.
- **Riassunti senza chiave nella prima sessione**: il MemoryManager fissava la
  chiave all'avvio. Ora `setModel` la aggiorna a ogni salvataggio della config.

Seconda parte, stesso giorno:

- **Log attivo mai ripulito**: dopo la compattazione `turns.jsonl` teneva
  tutto, e oltre i 200 turni archiviati il reload reintroduceva i turni vecchi
  come nuovi. Ora viene riscritto con i soli turni non riassunti.
- **Taglio a 200 turni senza riassunto**: oltre la soglia i turni sparivano
  dalla RAM senza passare dal riassunto. Ora la soglia fa partire una
  compattazione in background.
- **Compattazioni grosse riassunte a meta'**: il router taglia ogni messaggio a
  8000 caratteri, quindi il modello vedeva solo l'inizio. Ora il testo va a
  blocchi. Il riassunto di ripiego tiene la coda invece dell'inizio.
- **Compattazioni in parallelo**: timer, pulsante e soglia potevano riassumere
  gli stessi turni due volte. Ora ne gira una sola alla volta, e
  `state.json` / `turns.jsonl` si scrivono in modo atomico.
- **Import avatar**: un `.gltf` o un Live2D copiava l'intera cartella che lo
  conteneva. Ora si copiano solo i file dichiarati, se restano nella cartella
  del modello; la scansione ha limiti di profondita' e di numero di file, e le
  texture dei modelli non compaiono piu' come avatar a se'.
- **Istanza singola** con `requestSingleInstanceLock`.
- **Multi-monitor**: camminata e posizione della chat usano lo schermo su cui
  sta il companion, non sempre il principale.

Terza parte, stesso giorno:

- **Strip 2D**: `scripts/build-strips.js` le rigenera dalle master @2x
  (spostate in `reference-yanineko/strips-master/`, fuori dal pacchetto).
  Fotogrammi ritagliati e alti al massimo 480 px: da 38 MB a 8 MB su disco, da
  ~300 a ~40 MB di memoria video. Nella strip CLICK sono sparite le etichette
  "1 CLICK (IDLE)" e i pezzi del fotogramma vicino, che si vedevano nell'app.
  Attenzione: `nativeImage.createFromPath` legge "@2x" nel nome come fattore
  di scala e dimezza le dimensioni; lo script carica dal buffer.
- **Three.js pigro** e ticker Pixi a 30 fps: in 2D non si apre piu' un secondo
  contesto WebGL. Il cambio rapido di avatar non lascia piu' due modelli in scena.
- **VRM 1.0**: Fred compariva di spalle e con le braccia alzate, perche' pose e
  rotazione erano pensate per i VRM 0.x. Il player ora legge `meta.metaVersion`.
- **CSP** su entrambe le pagine; script estratti dagli HTML in file `.js`.
- **Electron 31 -> 44**, electron-builder 24 -> 26. Pixi 8, TypeScript 7 e
  three 0.186 restano fuori: cambiamenti incompatibili senza guadagni di sicurezza.
- **Modelli che ragionano**: o3, o4-mini, Grok 3 Mini, Gemini 2.5, Claude Opus 5
  e Sonnet 5 ricevono almeno 8192 token e 90 s; su Claude `effort: low`.
- **`npm run build` falliva in silenzio** da Node 18.20: `npx.cmd` senza shell
  da' EINVAL. Ora la CLI di electron-builder parte direttamente con Node.

## Preparazione alla pubblicazione (2026-09-25)

- **Asset**: tolti dal repository Neko (`Redistribution_Prohibited` nei
  metadati), Dust (licenza non verificabile), Yanineko e `reference-yanineko/`.
  Stanno fuori dal repository, e Yanineko resta usabile come pacchetto di
  sprite importato. `npm run check:publish` impedisce che rientrino.
- **Avatar**: elenco degli integrati generato dai file presenti
  (`builtin-avatars.js`), menu dinamico, pacchetti di sprite importabili,
  `build-strips.js` con rilevamento automatico dei fotogrammi per l'arte nuova
  (brief in `docs/avatar-brief.md`).
- **Difetti trovati verificando dal vivo**:
  - le immagini di `avatar://` erano bloccate da CORS in WebGL;
  - `window.prompt` non esiste in Electron, e l'importazione di una cartella
    con piu' modelli non andava avanti;
  - `scan` con un percorso relativo scartava ogni file.
- **Prodotto**: onboarding con link alla pagina della chiave, errori dei
  provider leggibili, elenchi modelli dal vivo, avvio con Windows, log su file,
  maniglia per spostare la finestra in 3D.
- **Sicurezza**: mittente controllato su ogni IPC, permessi del browser negati,
  Electron Fuses, `npm audit` pulito.
- **Distribuzione**: installer NSIS, CI e release su GitHub Actions, licenza
  MIT, documenti per il pubblico in inglese.

## companion-emergence
- Stato: completato + hardened (2026-09-12: loadState, prune turns.jsonl, cap RAM 200, fix Companion/User, getStats unificato TS/JS, getContext maxTokens)
- Cosa portato: 
  - Schema MemoryManager TypeScript con fading memory + lossless archive (ispirato a `brain/chat/compaction.py`)
  - Integrazione con ai-router.js per generazione summary via LLM (stesso provider e modello scelti per la chat)
  - Sistema di compaction con soglia temporale configurabile (default 7 giorni)
  - Persistenza su disco con fs/promises (active turns + archive + state)
  - Integrazione nel main process Electron: registrazione turni chat nella memoria, auto-compaction ogni 60min, IPC `memory:*` (stats, get-context, compact-now, clear), footer memoria + pulsante "Compatta" nella UI chat
- Licenza verificata: MIT (README.md riga 11)
- Note: 
  - Implementazione semplificata rispetto al Python originale (no cursor extraction tracking, no lock mechanism)
  - Summary prompt in italiano, adattabile per il companion
  - File: `src/memory/MemoryManager.js` (CommonJS, usato da main), `src/memory/types.ts` (tipi agganciati via JSDoc). Il gemello `.ts` e' stato rimosso il 13 settembre
  - **LLM gratuito**: provider OpenRouter aggiunto a `ai-router.js` con modelli `:free`: l'elenco attuale e' in `PROVIDERS.openrouter`. Retry+backoff per i 429 dei modelli free. Testato: compaction riassunto OK.
  - Bugfix UI: `config:set` ora ri-inietta `providers` nella risposta al renderer (prima il dropdown modelli si svuotava dopo il primo salvataggio)
- Prossimi passi: integrare emotion tracking, implementare Hebbian connections

## Umore e vita a riposo (2026-09-26)

Fase 1 del piano delle migliorie. Idee da tre repository MIT, codice riscritto:

- **Umore** (`src/main/mood.js`): decadimento esponenziale con un'emivita per
  emozione ed emozioni identitarie che non decadono, da companion-emergence
  (`brain/emotion/decay.py`, `vocabulary.py`). Qui sei emozioni invece di
  ventisei, e un'energia al posto del "corpo".
- **Contratto**: campo facoltativo `emotion` nella risposta, con i valori di
  `mood.REPLY_EMOTIONS`; il main scarta quelli estranei.
- **Contesto nel prompt**: ora del giorno e tempo dall'ultimo messaggio, da
  Kokoro-Engine (`src-tauri/src/ai/heartbeat.rs`).
- **Gesti a riposo** (`src/main/idle-life.js`): soglia di quiete, pausa fra i
  gesti e probabilità crescente da Kokoro-Engine (`idle_behaviors.rs`). Sonno
  con l'utente assente via `powerMonitor.getSystemIdleTime()`. Tolto il "fuma"
  a tempo fisso del 2D, contato in frame: a 30 fps partiva dopo 36 s, non 18.
- **Occhi 3D**: ciglia a tempo (1–6 s, 0,2 s, seno) e salti dello sguardo, da
  airi (`packages/stage-ui-three/src/composables/vrm/animation.ts`). Prima era
  un `Math.random()` per frame, quindi a 144 Hz quasi cinque volte più spesso
  che a 30.
- **Difetto trovato scrivendo i test**: l'affetto cresce di 0,005 a scambio, sotto
  la soglia di rumore di 0,01, e partendo da zero veniva cancellato subito. La
  soglia ora vale solo per il decadimento.
- `writeAtomic` spostato in `src/main/write-atomic.js`, condiviso da
  MemoryManager e umore: importarlo da MemoryManager creava un ciclo di require
  con ai-router.

## Fase A: modelli senza JSON e verifica reale (2026-09-26)

Con Yanineko 2D e Laguna S 2.1 (OpenRouter) "cammina verso destra" e "siediti
qui" non facevano nulla. Le cause:
- **Formato:** Laguna dichiara `tools` e `reasoning` ma non `response_format`.
  Il router mandava solo `response_format`, OpenRouter lo scartava, il modello
  rispondeva in prosa e il parser ripiegava su idle. Ora la strategia dipende
  dai `supported_parameters`: schema, JSON, tool call forzata o solo prompt,
  con `provider.require_parameters`.
- **Budget:** i modelli dell'elenco dal vivo non avevano il flag `reasoning` e
  ricevevano 1024 token e 20 s. Ora le capacità arrivano da OpenRouter.
- **Direzione:** `walk-to` non aveva verso. Sono stati aggiunti `direction` e
  `distance`, in `walk-target.js`.
- **Parametri persi:** `chat.js` inoltrava solo l'animazione, e ora inoltra
  l'azione intera.

Altri difetti corretti:
- trascinamento che finiva a tasto ancora premuto;
- fumetti di Yanineko mostrati da ogni avatar 2D;
- camera 3D libera di perdere di vista il modello.

Nuovo `scripts/audit.mjs`.

**Prova con il modello vero (Laguna S 2.1 gratuito):**
- "vai a sinistra di corsa" è arrivato come `run-to` verso sinistra, e la
  finestra si è spostata di 400 px;
- "salutami" è tornato in prosa nonostante la tool call forzata. Da qui il
  secondo tentativo con promemoria.

**Chiavi API illeggibili**, trovate durante la stessa prova:
- le chiavi nel `config.json` dell'utente non si decifrano con nessuna delle
  cartelle dati di Electron presenti sul PC;
- il metodo di verifica è stato provato su un segreto finto;
- a ogni avvio l'app le vedeva assenti e mostrava la configurazione;
- il primo salvataggio le avrebbe cancellate.

Ora restano nel file (`keysForDisk` in `guards.js`) e la chat chiede di
reinserirle. Un ciclo salva, riavvia, rileggi con una chiave finta funziona.

## Fase B, prima parte: il mouse (2026-09-27)

La parte della Fase B che non dipende dalle clip Kimodo. Resta da fare la
seduta su finestre e taskbar, che richiede koffi.
- **Clic che attraversano il vuoto:** `setIgnoreMouseEvents(true, { forward: true })`,
  più una prova del pixel sotto il cursore in `companion-input.js`. Nel 2D si
  legge il pixel dall'immagine della strip con un canvas di 1×1. Nel 3D si usa
  `readPixels` dopo il disegno, e il risultato arriva al frame successivo.
- **Trascinamento nostro:** il main segue il cursore a 60 Hz e manda la
  velocità. `-webkit-app-region: drag`, la maniglia 3D e OrbitControls sono
  stati tolti.
- **`sway.js`:** molla smorzata con i numeri di AvatarSwayController. Nel 3D il
  perno è alla testa grazie a due gruppi (`rig` e `body`). Le spring bone
  ricevono una forza contraria al movimento, sommata alla loro gravità
  (`gravityDir` e `gravityPower` sono in spazio mondo in three-vrm 3).
- **Sguardo:** `distributeLook` e `setLook` in `vrm-animation.js`, sommati
  alla clip con un peso che dipende da essa. Il segno dei due assi è stato
  controllato con schermate su Fred (VRM 1.0) e Neko (VRM 0.x): +y gira il
  volto verso la destra dello schermo, +x lo alza.
- **Menu nativo** col tasto destro e opzioni `followMouse`, `alwaysOnTop` e
  `scale` in config.

Durante l'audit il mouse vero, mosso da chi usa il PC, sovrascriveva il cursore
simulato: tre controlli fallivano a caso. Con `window.__companionTest` la
pagina ignora il cursore vero.

Da provare a mano, perché l'automazione non muove il mouse vero:
- il passaggio dei clic sul vuoto con i movimenti inoltrati da Windows;
- il trascinamento vero, anche fra due schermi;
- il menu nativo.

## Animazioni in un solo formato: .vrma (2026-09-27)

Richiesta: una stessa animazione deve funzionare su modelli glTF, FBX e VRM,
e deve potersi importare anche da file .vrma. OBJ è stato escluso: non ha
scheletro.
- **Formato unico per le clip:** `.vrma`, letto da `@pixiv/three-vrm-animation`
  (MIT). Tutto il resto (glTF, FBX, BVH di Kimodo) viene convertito una volta
  sola, all'import.
- **Scheletro unico per i modelli:** l'umanoide normalizzato di three-vrm. Un
  glTF o FBX con scheletro umano riceve un `VRMHumanoid` costruito dalle sue
  ossa, dopo averlo raddrizzato e messo in T-pose (`motion-retarget.js`).
- **Riconoscimento delle ossa** (`humanoid-map.js`): nomi di Mixamo, VRoid,
  Unreal, Rigify, Biped e SOMA; colonna e falangi per gerarchia. I nomi SOMA
  vengono da `kimodo/skeleton/definitions.py` (somaskel77): sono in stile
  Mixamo, con il metacarpo come prima falange delle dita.
- **Il lettore .vrma** converte le rotazioni rispetto allo scheletro di riposo
  del file. Scrivendo il .vrma con rotazioni di riposo nulle e la gerarchia di
  `VRMHumanBoneParentMap`, le tracce sono già le rotazioni normalizzate.

Difetti trovati dai test durante il lavoro:
- three toglie i due punti dai nomi (`mixamorig:LeftArm` diventa
  `mixamorigLeftArm`), quindi il riconoscitore deve accettare anche quella forma;
- un'altezza di 147 cm veniva presa per millimetri (soglia sbagliata);
- un'azione in loop, portata all'ultimo istante, torna al primo fotogramma:
  la conversione usa LoopOnce;
- le ossa che la clip non muove restavano nella T-pose di lavoro invece che
  nella posa originale della sorgente;
- `AnimationMixer` riscrive un osso solo quando il valore cambia: una clip
  ferma sull'ultimo fotogramma spariva sotto la posa procedurale. Il livello
  delle clip ora campiona le tracce da sé.

Verifica nell'app (audit, 44 controlli): una clip convertita da uno scheletro
Mixamo in A-pose alza il braccio giusto su Fred (VRM 1.0), su Neko (VRM 0.x)
e su una copia di Fred senza dati VRM, trattata come un glTF qualsiasi. Senza
un file FBX vero il percorso FBX non è ancora provato: il loader è diverso, la
conversione è la stessa.

## Fase C1: il primo BVH vero di Kimodo (2026-09-27)

La prima clip generata sulla demo di Kimodo ("sedersi", 180 fotogrammi, 6 s,
bacino da 99 a 12 cm) non si sarebbe convertita:
- **Gambe SOMA:** coscia `LeftLeg`, stinco `LeftShin`, piede `LeftFoot`,
  punta `LeftToeBase`. Lo scheletro SOMA scritto a mano nei test aveva nomi
  supposti (`LeftUpLeg`), e per questo passava. Ora, se su un lato mancano nomi
  da coscia ma ci sono due candidati da stinco in catena, il primo è la coscia.
- **Posa zero:** ogni osso ha l'offset lungo il proprio asse X (spina,
  braccio e gamba sinistri tutti verso +X). La T-pose costruita da lì era
  sbagliata. `isHumanShaped` se ne accorge e il riferimento diventa il primo
  fotogramma. Nelle clip si raddrizza anche la colonna.

Altri due difetti trovati:
- nel livello delle clip i valori erano indicizzati per nodo, e il bacino (che
  ha rotazione e posizione) perdeva una delle due tracce;
- un errore di sintassi nella pagina 3D si vedeva solo nell'audit: ora
  `test-csp.js` controlla la sintassi di tutti gli script del renderer.

Clip con fasi (entrata, ciclo, uscita) nei nomi dei file. File di test
`scripts/fixtures/kimodo-soma77-sit.bvh`: un estratto di 13 fotogrammi della
clip vera, in entrambi i repo.

Verifica: su Fred e Neko "siediti qui" fa sedere a terra (bacino da 0,90 a
0,13 m) e l'avatar resta seduto dopo la fine della clip. Seduto, la camera
abbassa lo sguardo perché si vedano le gambe.

## Kimodo in locale: prototipo (2026-09-27)

Richiesta: le animazioni le deve generare Kimodo in sottofondo, dopo una
richiesta in chat. La demo su Hugging Face è un'app Docker senza API, quindi
serve Kimodo sul PC.

Prototipo con kimodo.cpp (LocalAI, Apache-2.0):
- compilato su Windows al primo tentativo;
- pesi da 5,5 GB con impronte verificate;
- 30 s per il primo avvio, 15 s per ogni clip di 4 s, 2,4 GB di memoria
  video sulla RTX 3060;
- tre clip generate e controllate su Fred, tutte corrette.

Dettagli e comandi in `docs/kimodo-locale.md`.

- `kmd-generate --server` non scrive un GLB ma i dati grezzi (rotazioni locali
  e bacino). Lo scheletro SOMA a 30 ossa è ricostruito in
  `src/renderer/kimodo-raw.js`, con i dati di `src/skeleton.hpp`. Ha le gambe
  `LeftLeg`/`LeftShin` come il SOMA a 77, e il riposo è in T-pose (braccia
  lungo X, verso +Z), quindi non serve il ripiego sul primo fotogramma.
- Strumenti nuovi: `npm run kimodo` (genera) e `npm run preview` (guarda le
  clip su un avatar vero, con dati finti).

## Mate Engine
- Stato: idee e numeri, nessun codice (confronto e piano nel file di piano del
  26 settembre 2026)
- Cosa portato: limiti dello sguardo (testa ±45°/±30°, busto ±15°), molla
  dell'oscillazione (2,6 Hz, 0,35, 25°/12°), forza sulle spring bone contraria
  al movimento, clic che passano sui pixel vuoti. Il codice è scritto da zero
- Licenza verificata: AGPL-3.0 più "MateProv2" (README del progetto), quindi
  niente codice
- Note: letti `AvatarWindowHandler`, `AvatarTaskbarController`,
  `AvatarGravityController`, `AvatarSwayController`, `AvatarMouseTracking`,
  `HandHolder` e altri per capire come si siede sulle finestre, segue il mouse
  e reagisce al trascinamento. Anche Mate Engine sposta la propria finestra
  (`MoveWindow`) invece di usare un overlay a schermo intero.

## Agentic-Desktop-Pet
- Stato: solo idee (umore che decade, legame che cresce)
- Cosa portato: nessuna riga di codice
- Licenza verificata: nessun file di licenza, quindi niente codice
- Note: backend Python con Cognee; troppo pesante per il vincolo "hardware modesto"

## Kokoro-Engine
- Stato: idee portate nella Fase 1 (vedi sopra)
- Cosa portato: soglie dei gesti a riposo, contesto dell'ora del giorno
- Licenza verificata: MIT (LICENSE, Copyright 2026 chyinan)
- Note: da riprendere per la Fase 2 (`initiative.rs`, confidenza che cresce con
  le conversazioni) e la Fase 3 (`memory_extractor.rs`, fatti con importanza)

## airi
- Stato: idee portate nella Fase 1 (ciglia e sguardo)
- Cosa portato: tempi del battito di ciglia e dei salti dello sguardo
- Licenza verificata: MIT (LICENSE, Copyright 2024-PRESENT Neko Ayaka)
- Note: `idle_loop.vrma` non si porta, perché la provenienza non è chiara. Le 7
  animazioni VRoid citate nei loro documenti vietano la ridistribuzione. Per la
  Fase 4 c'è `hit-test.ts` (clic attraverso i pixel trasparenti).

## Open-LLM-VTuber
- Stato: non iniziato
- Cosa portato: ...
- Licenza verificata: ...
- Note: ...

## super-agent-party
- Stato: non iniziato
- Cosa portato: ...
- Licenza verificata: AGPL-3.0 — mai copiare codice
- Note: ...
