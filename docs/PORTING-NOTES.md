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

## Agentic-Desktop-Pet
- Stato: non iniziato
- Cosa portato: ...
- Licenza verificata: ...
- Note: ...

## Kokoro-Engine
- Stato: non iniziato
- Cosa portato: ...
- Licenza verificata: ...
- Note: ...

## airi
- Stato: non iniziato
- Cosa portato: ...
- Licenza verificata: ...
- Note: ...

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
