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

## Fase C2 e fase K: serie di base e movimenti dalla chat (2026-09-27)

**C2, la serie di base.** Le 20 clip di `docs/kimodo-prompts.md` si generano
in locale in circa 5 minuti (`scripts/kimodo-series.json`). Vanno in
`private-assets/animations/`, solo nella copia privata, finché non si
confermano i termini sulle uscite di Kimodo.
- Entrata, ciclo e uscita di un gesto sono una sola richiesta a sequenza:
  kimodo.cpp raccorda i segmenti (5 fotogrammi) e poi si tagliano.
- I cicli si tagliano dove si ripetono meglio (`findLoop`) e si chiudono
  sfumando la coda verso il primo fotogramma (`closeLoop`).
- Errore trovato guardando le anteprime: la posa di riposo prendeva l'altezza
  del bacino del primo fotogramma. Le clip che partono sedute (ciclo seduto,
  rialzarsi) finivano all'altezza di chi sta in piedi, e "rialzarsi" arrivava
  quasi a 2 m. Ora il riposo è la T-pose in piedi sul pavimento vero (Kimodo:
  y = 0, caviglia a 7 cm, misurata), e `retargetClip` rialza il riposo quando
  il riferimento è seduto. Test con una clip seduta dal primo fotogramma.
- "Seduto sul bordo" ora è "seduto su una sedia": Kimodo non vede oggetti e
  con "ledge" si sedeva a terra.

**K, i movimenti nuovi dalla chat.**
- Contratto: `action.motion`, facoltativo, spiegato al modello solo se Kimodo
  è attivo (`MOTION_PROMPT`). Senza, il prompt resta quello di prima.
- `src/main/kimodo-service.js`: server avviato alla prima richiesta, coda,
  tempo massimo, chiusura dopo 5 minuti di inattività, cache di 100 file.
  Testato con un processo finto che parla lo stesso protocollo
  (`scripts/test-kimodo-service.js`).
- La conversione resta nel renderer, che ha three: il main manda l'uscita
  grezza e riceve il .vrma per la cache. `motions:store` accetta solo chiavi
  che il main ha appena generato.
- Slot `generated` nel player (`GENERATED` in `vrm-animation.js`), fuori da
  `ANIMATION_SLOTS`: nessun file della libreria lo usa.
- Sicurezza: la cartella di kimodo.cpp si sceglie solo a mano in
  `config.json` (`kimodoDir`), mai dalla UI; la frase del modello va in un
  file di prompt, non sulla riga di comando.

## Prova dal vivo con computer use (2026-09-27)

L'app è stata provata sul desktop vero: mouse, menu, cambio di avatar, chat con
OpenRouter e Ollama, Kimodo dalla chat. Funziona:
- clic sul vuoto;
- trascinamento;
- sguardo verso il cursore;
- sottomenu;
- passaggio da 3D a 2D;
- inchino generato da Kimodo in 16,7 s (120 fotogrammi) e riprodotto.

Difetti trovati e corretti:
- **Chiave in chiaro:** un `apiKey` del vecchio formato di `config.json` restava
  su disco accanto alle chiavi cifrate, perché il salvataggio ricopiava i campi
  sconosciuti. Ora `legacyKeyProvider` (`guards.js`) lo assegna al provider del
  suo prefisso, e il primo `loadConfig` lo cifra e lo toglie dal file. Nel caso
  vero era una chiave Anthropic vecchia, già rifiutata dall'API.
- **Chiave che sembrava persa:** il campo mostrava sempre l'esempio "sk-or-...".
  Ora, se la chiave c'è, mostra "chiave salvata" con una nota.
- **Ollama:** qualunque errore diventava "non raggiungibile", anche il timeout
  di 30 s. Mistral 7B a freddo ha risposto in 48 s. Ora il limite è 120 s e il
  timeout ha un messaggio suo (`ollamaFailure`).
- **Log:** l'avviso per una chiave illeggibile veniva scritto a ogni
  `loadConfig`: 287 righe. Ora compare una volta per chiave.

Restano aperti:
- Laguna S 2.1 gratuito risponde fuori formato in circa metà dei messaggi;
- la chat si apre sopra l'avatar ed è molto trasparente;
- nelle risposte in prosa gli asterischi del markdown restano visibili.

## Prova dei modelli gratuiti (2026-09-28)

`npm run bench` (`scripts/bench-models.js`) manda gli stessi 6 messaggi a ogni
modello gratuito di OpenRouter. Gira dentro Electron per decifrare la chiave
salvata con una copia della Local State dell'app, e non la stampa mai.
- Ogni modello è misurato da solo: `route` ha `fallback: false` (nessun
  modello di scorta) e `retries: 0`. Gli errori temporanei si rifanno alla
  sessione successiva.
- L'account senza credito ha circa 50 richieste al giorno sui gratuiti, in
  comune fra tutti i modelli: la prova procede 20 chiamate al giorno e riprende
  dal file in `%APPDATA%\CompanionAI\bench`.

Trovati nel primo giro:
- **Limite giornaliero:** il router ritentava tre volte e poi passava agli
  altri modelli, consumando richieste per nulla. Ora `dailyLimitReached` si
  ferma subito e la chat dice di riprovare domani.
- **403:** Inkling risponde "only available on agentic harnesses", e l'app lo
  presentava come chiave rifiutata. Il 403 ora ha il suo messaggio, e Inkling
  è uscito dalla lista di scorta.

Primi risultati (un messaggio per modello, "cammina verso destra"): Nemotron 3
Super, Nemotron 3 Ultra, LFM 2.5, Ling Sante, North Mini Code e i due Laguna
rispondono nel formato con l'azione giusta. Dots 3 Note arriva a 142 s. I
numeri completi alla fine della prova.

## Fase B, seconda parte: seduta su finestre e taskbar (2026-09-28)

**koffi nell'installer.** Il rischio della fase era koffi con le Fuses
(`onlyLoadAppFromAsar`, integrita' dell'asar). Il binario sta in
`@koromix/koffi-win32-x64`; electron-builder lo estrae da solo in
`app.asar.unpacked`, e il pacchetto ha letto 10 finestre al primo avvio. Lo
script di installazione di koffi, bloccato dalle "allow-scripts" di npm, non
serve: prova il binario gia' pronto e compila solo se manca.

**Come funziona.**
- `win-windows.js` legge le finestre con user32 e dwmapi: il bordo visibile
  vero, le finestre nascoste da DWM, lo stato di una sola finestra per
  seguirla, e `placeAbove` per l'ordine z.
- `perch.js` (funzioni pure, 8 test) decide dove sedersi, dove stare mentre
  la finestra si muove e quando scendere. Regole e numeri come idea da
  AvatarWindowHandler di Mate Engine:
  - scarta le finestre senza titolo, piccole, trasparenti ai clic, strumenti,
    ridotte, massimizzate o a schermo intero;
  - il bordo sotto l'ancora non deve essere coperto da finestre piu' in alto.
- L'ancora e' l'ombra ai piedi, idea dell'utente: si vede mentre lo si
  trascina e mostra dove atterrera'. Al rilascio sta in piedi sul bordo, dopo
  1,2 s si siede e la finestra scende finche' il bacino poggia sul bordo. Il
  renderer manda entrambe le altezze (`feet` e `seat`).

**Difetti trovati provandolo.**
- **Tolleranza:** con 24 px anche sotto il bordo, posarlo "chiaramente li'"
  non bastava. Ora vale 24 px sopra e 48 sotto.
- **Taskbar:** con la regola delle finestre ogni rilascio in basso lo faceva
  sedere. Ora conta solo con l'ombra sulla taskbar stessa.
- **Pose di seduta sbagliate da sempre:** per un arto che pende, x positivo lo
  porta in avanti. `sit` e `sit-edge` avevano le cosce a -1,45, cioe'
  all'indietro, e le ginocchia piegate al contrario; nessuno se n'era
  accorto, perche' nella copia privata la seduta a terra usa la clip di
  Kimodo. Controllato con schermate su Fred (VRM 1.0), Neko (VRM 0.x) e Dust.
- **Mani:** le dita non venivano mai toccate e restavano tese come nella
  T-pose. Ora in `REST_POSE` c'e' una piega leggera.
- **Ombra tagliata e ombra 2D invisibile:** con la camera a 35° il pavimento
  cadeva sul bordo basso della finestra, e l'ombra ai piedi restava tagliata:
  ora la camera e' a 38°. Nel 2D l'ombra aveva 0,18 di alpha nel riempimento
  e di nuovo 0,18 a ogni frame, cioe' il 3%.
- **Slot `perch` separato da `sit-edge`:** la clip Kimodo "seduto sul bordo"
  e' in realta' una sedia e abbassa il bacino. `perch` e' solo procedurale,
  e l'animatore ha `setRest` per tornare li' dopo ogni gesto.

**Verifica dal vivo** sul Blocco note: l'avatar si posa, si siede, segue la
finestra spostata e scende quando la finestra viene ridotta a icona. La
taskbar di questo PC si nasconde da sola, quindi non ha un bordo su cui
sedersi: quel caso e' coperto solo dai test.

**Dopo, dalla prova dell'utente.** Cliccata la finestra su cui sedeva,
l'avatar perdeva le gambe dietro la sua barra del titolo: Windows non lascia
che un altro processo metta la sua finestra sopra quella attiva con
`HWND_TOP`, quindi `placeAbove` non bastava. Ora, finche' il sedile e' la
finestra attiva, l'avatar torna "sempre in primo piano" (`keepAboveSeat`).
Verificato leggendo l'ordine z ogni secondo: sedile attivato, un attimo
sopra l'avatar, al campione dopo l'avatar e' di nuovo davanti.

## Blocco 2: camera e stanza (2026-09-28)

**2a, OrbitControls.** Tornano, ma sullo strato che riceve il mouse
(`#drag-zone`), non sul canvas, e senza il sinistro, che prende l'avatar.
Destro e centrale ruotano, la rotella zooma; il destro apre il menu solo se
rilasciato senza muoversi (su Windows `contextmenu` arriva dopo il
rilascio, altrove prima: `companion-input.js` gestisce entrambi i casi).
OrbitControls misura la rotazione sull'altezza della finestra, che qui e'
piccola: a velocita' piena 260 px facevano un giro, ora `rotateSpeed` 0,5.
Il piano del cursore per lo sguardo ora sta di fronte alla camera, e il
punto di seduta si riproietta con la camera di adesso: girando la camera da
seduto l'avatar resta sul bordo.

**2b, la stanza.** La stessa finestra cambia modalita' (`room.js` puro, con
test, e le chiamate in `main.js`). Una finestra trasparente non diventa
opaca, e su Windows trasparente e ridimensionabile non vanno d'accordo:
barra del titolo e bordi li disegna la pagina, i bordi li segue il main
come il trascinamento, "Ingrandisci" e' fatto a mano. Verificato dal vivo:
Windows risponde `HTCAPTION` sulla barra (`WM_NCHITTEST`), il bordo in basso
a destra porta la stanza da 1040x680 a 908x601 con l'angolo opposto fermo,
la chat agganciata segue la stanza spostata, la posizione si salva, l'app si
riapre nella stanza e la ✕ riporta la finestra piccola, trasparente e in
primo piano. Il trascinamento dalla barra con computer use non e' stato
possibile: lo strumento non vede la finestra trasparente sotto il cursore e
blocca il movimento. La chat usa `setParentWindow`, e la scena le lascia il
lato destro con `setViewOffset`.

**2c, scene.** Studio e Giardino (Sky.js) senza file; Collina e Stanza vuota
da Poly Haven, CC0, 2k, scelte con l'utente fra 1k, 2k e scaricamento al
primo uso (37 MB nel repo). Sono due serie scattate nello stesso posto a ore
diverse, cosi' la foto cambia con l'ora senza cambiare luogo. `GroundedSkybox`
proietta la foto su un pavimento: con il raggio da esterno (100 m) le pareti
della stanza si curvavano, ora il raggio sta nel manifest (10 m al chiuso).
`*.hdr` e' binario in `.gitattributes`.

**2d, luce.** `scene-light.js` e' puro: sole da data, ora e latitudine
(senza citta', 42 gradi e la longitudine dal fuso), luci per fase, meteo e
tinta dell'umore; 8 test con mezzogiorno d'estate e d'inverno, tramonto e
notte. Il tone mapping ACES serve a cielo e foto, ma cambierebbe l'aspetto
del VRM: i materiali dell'avatar hanno `toneMapped = false`. Meteo da
Open-Meteo (`weather.js`, 5 test con fetch finto), spento di base; provato
una volta contro il servizio vero.

**Audit** 68/68: 5 controlli per la camera e 16 per la stanza, con
schermate a mezzogiorno, al tramonto, di notte e con la pioggia.

## Blocco 2, revisione: modelli di Sketchfab, Alt e scene importate (2026-09-29/30)

**Avatar presi da Sketchfab.** Provati con modelli veri dell'utente (Big Boss
glTF, Shibahu, Pomni FBX):
- texture FBX: `fbx-textures.js` ridirige i nomi di file citati con percorsi
  del PC di chi ha esportato, legge le TGA e ricollega per nome del materiale
  le texture senza nome ("Body_mt" -> "…_body_dif.png"). L'import copia anche
  le cartelle `textures/` accanto a `source/`;
- `gltf-specgloss.js` rimette i materiali `KHR_materials_pbrSpecularGlossiness`,
  che three.js ignora dalla r147 (diventavano metallo pieno, quasi nero);
- `humanoid-map.js` salta il prefisso comune dei nomi ("Shibahu_",
  "ValveBiped.Bip01_"), preferisce "Forearm" a "Elbow" e simili quando ci
  sono entrambi, e non gira piu' all'infinito se un osso risulta figlio di
  se stesso; i piedistalli (mesh piatte senza ossa) si tolgono;
- Pomni: un osso e una mesh si chiamano entrambi `EyeL`, e `generateMorphTrack`
  di FBXLoader (r177) prendeva l'osso con `getObjectByName` e si fermava con
  "reading 'Big'" (la forma dell'occhio). `vendor.js` ora corregge il file
  copiato (`PATCHES`): cerca la mesh che ha la forma e, se il nome e'
  condiviso, punta la traccia al suo uuid. Se three cambia quel codice,
  `npm run vendor` si ferma invece di ignorare la correzione.

**Alt + trascina sposta la camera**, come chiesto dall'utente ("come i
vecchi OrbitControls"). OrbitControls sposta solo con Ctrl, Meta o Shift: un
ascoltatore `pointerdown` in fase di cattura sceglie PAN o ROTATE per i tasti
prima che lui legga `mouseButtons`. `maxTargetRadius` limita il punto
guardato (60 cm sul desktop, dove la finestra e' stretta, 25 m nella stanza).
`frameSeated` ora sposta lo sguardo della sola differenza, se no annullava
lo spostamento in verticale a ogni frame.

**Scene importate.** Chieste dall'utente con due scene di Sketchfab (CC-BY):
il Black Lodge di Twin Peaks (.glb) e un'aula anime (.obj + .mtl, poi anche
in .glb). `SceneLibrary` estende `AvatarLibrary` (schema dell'URL, tipi e
messaggi diventano proprieta'), protocollo `scene://`, IPC `scenes:*`,
dialoghi di import ed eliminazione nel main. Le scene stanno nell'area dati
dell'utente, mai nei repo.

Nessuno dei due file e' in metri: nel Lodge una poltrona e' alta 7,9 unita',
nell'aula un banco 2,1, e la versione .glb dell'aula e' alta 10,2 "metri".
Nessuna statistica sulle singole mesh funziona su entrambe (l'aula ha 238
pezzi, la mediana delle altezze e' 0,13). Stima scelta: la mesh col box piu'
grande da' l'altezza della stanza, che diventa 4 m se non e' credibile in
metri (glTF fra 2 e 6 m). Lodge 0,084 (poltrone di 66 cm, un po' piccolo),
aula 0,39 (banchi di 82 cm). Il pavimento si cerca nella meta' bassa di quella
mesh, non del modello intero: il piano del cielo fuori dalla finestra
dell'aula alzava la meta' e il soffitto passava per pavimento.

Per il posto dell'avatar c'era prima un raggio per punto: veloce con i soli
piedi (5 raggi), ma col corridoio libero verso la camera l'aula ci metteva
6 s a caricarsi. Ora c'e' una mappa vista dall'alto in un passaggio sui
triangoli (lati e interno proiettati), circa 80 ms. La mappa copre il
modello intero: l'audit l'ha trovata ridotta alla striscia di una parete,
quando la mesh piu' grande era una delle quattro pareti uguali.

Dal vivo (CDP, home e dati finti, i tre file veri): caricamento 0,5-1,3 s,
nessun errore in console. Nel Lodge la camera stava fuori dalle tende (stanza
di 6,6 m, camera a 3,9 m): `keepCameraInside` la porta davanti alla parete,
e conta come parete solo cio' che blocca anche un raggio 80 cm piu' in alto,
se no una sedia fra i banchi la tirava a 80 cm dalla pancia. "Metti l'avatar
qui" su un fianco verticale della cattedra metteva la camera dentro il legno:
ora accetta solo facce con normale verso l'alto. Nell'OBJ dell'aula la
finestra resta bianca dove il .glb mostra il tramonto: probabilmente il vetro,
trasparente nel .glb e opaco nel .mtl; il .glb e' la versione da preferire.

Trappola: gli script Python di modifica su Windows riscrivono i file in CRLF,
e l'hash dell'importmap in `companion.html` (CSP) si calcola sui byte LF, come
vuole `.gitattributes`. `npm test` se ne accorge.

**Audit** 73/73: 5 controlli nuovi con una stanza OBJ generata (centimetri,
tavolo al centro): scala stimata, avatar non sul tavolo, stima salvata,
Alt + destro sposta senza girare ne' aprire il menu, grandezza x2 dal
pannello applicata e salvata.

## Blocco 3a: Impostazioni, voce Kokoro e labiale (2026-09-30)

**Prototipi ascoltati dall'utente** (le stesse quattro frasi, WAV nello
scratchpad): Kokoro Sara e Nicola, Kokoro con i fonemi inglesi, Piper serena,
paola e riccardo, XTTS-v2 e Chatterbox Multilingual con la sua voce clonata
da un campione di 20 s. Scelte: **XTTS-v2 come voce principale** (3b, servizio
Python) e **Kokoro come riserva**, questo passo.
- kokoro-js 1.2.1 ha i file delle voci italiane, ma `phonemize` accetta solo
  "a" e "b" (inglese): il testo italiano diventava inglese. Anche il pacchetto
  `phonemizer` ha i dati di espeak-ng solo per l'inglese; quello con tutte le
  lingue e' `@echogarden/espeak-ng-emscripten` (GPL-3.0).
- XTTS-v2: licenza CPML, non commerciale. Per l'utente va bene (app gratuita
  su GitHub, nessun guadagno): il modello si scarica al primo uso, mai nel
  repo. Sulla RTX 3060: 1,4 volte il tempo reale, 2 GB di memoria video.
  `coqui-tts` 0.27.5 chiede `transformers>=4.57` senza limite, e la 5.x ha tolto
  `isin_mps_friendly`: va fissato `<5`.
- Chatterbox (MIT, italiano, clonazione): 0,15 volte il tempo reale sulla CPU.
  StyleTTS2: modelli solo inglesi (Kokoro e' costruito sulla sua architettura).
  Piper: 10-16 volte il tempo reale, ma l'utente ha preferito Kokoro.

**Dove far girare Kokoro**, misurato con le stesse frasi: q8 in WASM
0,5-0,8 (i thread non aiutano), q8 su WebGPU 0,3 (le operazioni quantizzate
tornano sulla CPU), fp16 su WebGPU 2,6 ma 5 s per la prima frase, ONNX Runtime
nativo fp16 sulla CPU 2,7 con la prima frase in meno di un secondo, DirectML
3,5-4,1. Scelto il nativo sulla CPU: funziona su ogni PC e non contende la GPU
a XTTS e Kimodo, che e' proprio il caso in cui serve la riserva. Gira in un
`utilityProcess`: il main resta libero, e il codice di espeak-ng scaricato non
entra mai nel main. Nessuna pagina ha bisogno di `'wasm-unsafe-eval'`.

**Trappole.** Il file di espeak-ng e' un modulo ES chiamato `.js`: fuori dal
suo pacchetto Node lo tratta da CommonJS, quindi si salva come `.mjs`.
`child_process.fork` serializza in JSON e perde i `Float32Array` (serve
`serialization: 'advanced'`; `utilityProcess` usa gia' il clone strutturato).
Il worker rispondeva a `load` senza l'id della richiesta: il main aspettava
fino al timeout. Il motore finto dei test l'id lo metteva, quindi c'e' ora un
test col processo vero.

**Prova dal vivo** (CDP, dati finti, file serviti da un server locale): 180 MB
scaricati e verificati in 7 richieste, "Prova la voce" suona dopo 3,5 s alla
prima volta (caricamento compreso), la bocca del VRM arriva ad aperta del tutto,
"Basta" zittisce, "Elimina" toglie i file e ferma il processo, nessun errore
nelle pagine. **Audit** 74/74 con `--voice`: una risposta della chat si sente
dopo 3,1 s e apre la bocca.

Non ancora: bocca per gli avatar 2D e glTF senza espressioni, la voce di
XTTS (3b), le voci cloud (3c), il microfono (3d).

## Blocco 3b: XTTS-v2 con la voce clonata (2026-09-30)

**Licenza.** CPML, solo uso non commerciale: l'utente pubblica l'app gratis e
non ci guadagna. Il modello non sta ne' nell'app ne' nel repo; "Installa XTTS"
si abilita solo dopo aver spuntato la licenza, e il main la ricontrolla.

**Fonti fissate.** uv 0.12.21 (SHA-256 dalla release), Python 3.10.21 (uv ha
le sue verifiche), i 98 pacchetti di `src/main/xtts/requirements.txt` con
`--require-hashes`, generati con `uv pip compile` dal `pip freeze`
dell'ambiente del prototipo (quello che ha funzionato), il modello da
Hugging Face al commit `6c2b0d7`. Servono `model.pth`, `config.json`,
`vocab.json`, `speakers_xtts.pth` (le 58 voci) e `LICENSE.txt`; `dvae.pth` e
`mel_stats.pth` servono solo all'addestramento. uv gira senza la
configurazione dell'utente e con cache, Python e ambiente dentro
`voice/xtts`; lo zip si apre con il `tar.exe` di Windows (quello di Git Bash
non legge gli zip).

**Servizio.** HTTP su 127.0.0.1 con token, audio in streaming a pezzi. Misurato
col prototipo: pronto in 29-35 s, campione preparato in meno di un secondo,
primo pezzo di una frase in 0,85-0,9 s, circa 1,1 volte il tempo reale in
streaming (1,4 senza), 2 GB di memoria video. Un'interruzione chiude la
richiesta e la generazione si ferma al pezzo dopo. Trappola: il thread che
guarda stdin (per uscire se l'app muore) avviato subito bloccava gli import
di numpy e torch su Windows, e il servizio restava fermo senza scrivere
nulla: parte ora a modello caricato.

**Prima prova dell'installazione nell'app** (dati finti; uv e modello da un
server locale, pacchetti veri da PyPI e PyTorch): 9 minuti, di cui 5 per i
pacchetti; 7,2 GB alla fine (ambiente 5,2, modello 1,9), la cache di uv si
cancella. Due difetti trovati: la prima accensione durava 170 s perche' Python
compilava tutti i pacchetti al primo import (ora `--compile-bytecode` in
installazione), e "Disinstalla" lasciava la cartella perche' il processo
Python non era ancora uscito e teneva bloccate le sue DLL (ora `stop()`
aspetta l'uscita, fino a 10 s, e la cancellazione riprova).

**Seconda prova**, con le correzioni: 8 minuti e 18 secondi, 7,4 GB. La
prima accensione dopo l'installazione dura ancora 110 s (il servizio misura
24 s dopo gli import: il resto sono gli import, probabilmente l'antivirus che
controlla migliaia di DLL nuove), la seconda circa 45 s, quelle dopo 30-35.
Primo suono di una prova 1,1-1,2 s, con il campione e con Ana Florence;
"Disinstalla" col servizio acceso: 9 s, cartella cancellata, campione
conservato. Ha mostrato un difetto d'uso: il servizio appena acceso per il
campione si spegneva quando si sceglieva il motore a voce ancora spenta, e
si riaccendeva (45 s) quando la si accendeva. Ora quando non serve piu' si
spegne dopo 2 minuti.

**Audit** 74/74 con `--voice` (Kokoro), 75/75 con `--xtts`: una risposta
della chat si sente con XTTS dopo 1,1 s. `--xtts` collega la cartella
dell'installazione con una junction, e la pulizia toglie la junction prima di
cancellare la cartella di lavoro.

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
