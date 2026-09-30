# CompanionAI

Un companion desktop con avatar animato che vive sopra le altre finestre,
cammina sullo schermo, esegue azioni reali sul sistema (chiedendo sempre
conferma) e ricorda le conversazioni tra un avvio e l'altro.

Avatar 3D in formato VRM su Three.js, oppure 2D a strip animate su PixiJS.
Sette provider AI dietro un router unico. Tutto dentro Electron e Node: nessun
processo esterno, nessun sidecar, nessuna inferenza locale obbligatoria.

Questa è la documentazione tecnica, in italiano. Per installare e usare l'app
parti dal [README in inglese](README.md).

## Avvio rapido

Serve Node.js 22 o superiore, su Windows, e una chiave API. OpenRouter ha
modelli gratuiti ed è il provider predefinito, quindi è il modo più rapido per
partire. Con Ollama non serve nessuna chiave: basta che `ollama serve` sia in
esecuzione.

```bash
npm install
npm start
```

Al primo avvio la chat chiede provider, modello e chiave. In alternativa, per
lo sviluppo, copia `.env.example` in `.env` e compila le variabili che ti servono.

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia l'app |
| `npm run dev` | Avvia con i DevTools aperti |
| `npm run check` | Controllo dei tipi più tutti i test |
| `npm test` | Tutte le suite di test, senza rete né finestre |
| `npm run smoke` | Avvia l'app vera e la controlla dall'interno: errori, CSP, ogni avatar |
| `npm run audit` | Avvia l'app con dati e OpenRouter finti e verifica che le richieste in chat muovano davvero l'avatar |
| `npm run preview -- clip.vrma=wave` | Mostra delle clip su un avatar vero, con dati finti, e salva le schermate |
| `npm run bench -- --max 20` | Misura quanto ogni modello gratuito di OpenRouter rispetta il formato della risposta, con la tua chiave salvata; poche chiamate al giorno, si riprende da dove si era rimasti |
| `npm run kimodo -- --out clip.vrma "prompt"` | Genera una clip con Kimodo in locale (vedi [docs/kimodo-locale.md](docs/kimodo-locale.md)). `--series scripts/kimodo-series.json --out <cartella>` genera tutta la serie di base |
| `npm run build` | Installer Windows (NSIS). `npm run dist` produce solo la cartella |
| `npm run strips -- --masters <cartella>` | Genera un avatar 2D dalle immagini master |
| `npm run check:publish` | Verifica che non si pubblichino asset privati o segreti |
| `npm run assets` | Rigenera librerie del renderer e icona |

`start`, `dev`, `smoke` e `build` rigenerano gli asset da soli.

## Com'è fatto

```
chat.html ──ai:send-message──> main.js ──> ai-router ──> provider LLM
    ▲                            │  ▲
    │                            │  ├── MemoryManager (contesto in ingresso)
    └──────mood-changed──────────┤  └── mood.js (umore, ora, tempo trascorso)
                                 ▼
companion.html <──trigger-animation── main.js ──> azioni OS + camminata finestra
                                         ▲
                                         └── idle-life.js (gesti a riposo, ogni 5 s)
```

Il renderer non ha accesso a Node: `contextIsolation` e `sandbox` sono attivi,
`nodeIntegration` è disattivato, e l'unico ponte è `preload.js`. Ogni canale
IPC accetta messaggi solo dalle pagine di `src/renderer/`. Le azioni sul
sistema operativo vengono eseguite soltanto nel processo main.

Le pagine hanno una Content Security Policy che accetta solo script del
progetto: niente script inline, niente `eval`, niente dalla rete. L'unica
eccezione è l'importmap di `companion.html`, ammessa per hash: se la cambi,
`npm test` fallisce e stampa l'hash nuovo da mettere nella policy. Pixi 7 di
suo vorrebbe `unsafe-eval`, e `@pixi/unsafe-eval`, copiato da `vendor.js`, gliene
toglie il bisogno.

```
src/
  main/      main.js (finestre, IPC, azioni OS, camminata), ai-router.js, preload.js,
             guards.js (regole su azioni, config e mittenti IPC), AvatarLibrary.js,
             builtin-avatars.js, AnimationLibrary.js (clip .vrma), mood.js (umore),
             idle-life.js (gesti a riposo),
             write-atomic.js, logger.js
  memory/    MemoryManager.js + types.ts
  renderer/  companion.html + companion-2d.js + companion-3d.js, chat.html + chat.js,
             companion-input.js (mouse sull'avatar), sway.js (oscillazione in braccio),
             humanoid-map.js, motion-retarget.js, clip-layer.js (clip .vrma su ogni umanoide),
             vrm-animation.js, assets/strips (avatar 2D integrato), vendor/ (generata)
scripts/     vendor.js, make-icon.js, build.js, build-strips.js, lib/sprite-frames.js,
             smoke.mjs, check-publish.js, e le suite test-*.js
modelli-3d/  Fred, servito dal protocollo vrm://
docs/        brief dell'avatar 2D, note di progetto
```

`src/renderer/vendor/` e `build/icon.png` sono generati e non versionati.

## Avatar

L'elenco degli avatar integrati nasce dai file presenti (`builtin-avatars.js`),
non da una lista scritta a mano. Si pubblicano solo modelli con una licenza di
ridistribuzione: oggi Fred. Il primo dell'elenco è il predefinito: l'avatar 2D
integrato, quando le sue strip ci sono, altrimenti Fred.

Gli avatar importati stanno in `<userData>/avatars`, serviti dal protocollo
`avatar://`:

| Tipo | Cosa si importa |
|---|---|
| `vrm` | Il file `.vrm` |
| `gltf` | `.glb`, oppure `.gltf` con i soli buffer e texture che dichiara. Con uno scheletro umano si anima come un VRM, senza resta un'anteprima statica |
| `fbx` | Il file `.fbx` e le immagini accanto, fino a due livelli di cartelle (le texture non hanno un indice leggibile). Animato se ha uno scheletro umano |
| `sprite-pack` | Una cartella con `sprites.json` (formato `companion-sprites/1`) e le strip che dichiara. Il campo facoltativo `bubbles` porta i fumetti del personaggio (`hello`, `wave`, `think`, `sit`, `smoke`, `happy`, `grab`, `drop`); senza, i fumetti sono neutri. `build-strips.js` lo prende da un `bubbles.json` accanto alle master |
| `sprite` | Un'immagine singola, mostrata ferma in 2D |

Dal menu, "Elimina importati" permette di spuntare gli avatar importati e
cancellarli, record e cartella. Gli integrati non compaiono e il main li
rifiuta comunque; se si elimina l'avatar in scena torna il predefinito.

Un avatar che non si può pubblicare, come un personaggio di un'opera altrui,
diventa un pacchetto di sprite con `npm run strips -- --masters <cartella>
--pack` e si importa dall'app: resta sul proprio PC, fuori dal repository.

In alternativa, nella propria copia del progetto, lo si mette in
`private-assets/`, che `.gitignore` esclude e `npm run check:publish` rifiuta.
I pacchetti di sprite (`sprites.json`) e i `.vrm` che l'app trova lì dentro,
fino a tre livelli di cartelle, diventano avatar integrati della copia locale.
I pacchetti 2D privati vanno in testa all'elenco, quindi il primo è il
predefinito; i VRM privati vanno in coda. Li serve `vrm://private/…`, che nel
pacchetto pubblico risponde 404.

## Memoria

Il companion ricorda perché `MemoryManager` scrive ogni turno su disco in
`~/.desktop-companion/memory`, e il main rilegge quel contesto prima di ogni
chiamata al modello. Il riassunto entra come messaggio di sistema, e i turni
recenti non ancora presenti nella chat vengono anteposti alla conversazione.

I turni più vecchi di sette giorni sfumano in un riassunto in prima persona
generato dal modello, mentre l'originale resta in `archive/*.jsonl` senza
perdite. La compattazione parte da sola ogni ora, oppure dal pulsante nella
chat. Oltre duecento turni i più vecchi vengono riassunti subito, in
background, invece di essere scartati. Il testo da riassumere viene diviso in
blocchi che stanno nel limite del router. Dopo ogni compattazione
`turns.jsonl` contiene solo i turni non ancora riassunti.

Nella chat, ↺ pulisce solo lo schermo: il companion continua a ricordare.
"Dimentica tutto", nel footer della memoria, chiede conferma e cancella
riassunto, turni e archivio dal disco.

Il limite di quaranta messaggi vale solo per il dialogo: la memoria arriva al
router come messaggi di sistema e non viene mai tagliata insieme alla chat.

## Umore e vita a riposo

**Umore** (`src/main/mood.js`). Sei emozioni fra 0 e 1, ognuna con la propria
emivita: fastidio 1 ora, curiosità 3, allegria 6, calma 12, malinconia 24.
L'affetto non decade e cresce piano. C'è poi un'energia che cala a ogni
messaggio e si ricarica col riposo. L'idea del decadimento per emozione viene
da companion-emergence.

La risposta del modello porta un campo facoltativo `emotion`, nello schema come
`action`. Il main accetta solo i valori del contratto e sposta l'umore di
conseguenza. Prima di ogni chiamata il modello riceve un messaggio di sistema
con umore, energia, ora del giorno e tempo dall'ultimo messaggio.

Lo stato sta in `~/.desktop-companion/memory/mood.json` e "Dimentica tutto" lo
azzera. La chat lo mostra accanto alla memoria, e nel 3D colora il volto con
pesi bassi (al massimo 0,3) sotto le espressioni di reazione.

**Vita a riposo** (`src/main/idle-life.js`). Ogni 5 secondi il main chiede a una
funzione pura se fare un gesto. Regole:
- mai nei primi 15 secondi di quiete, e almeno 20 secondi fra un gesto e l'altro;
- la probabilità cresce con l'attesa, in media un gesto ogni due minuti circa;
- con l'utente lontano dal PC per 5 minuti il companion si addormenta, e al
  ritorno saluta;
- di notte o con poca energia sonnecchia;
- l'umore sposta i pesi: con allegria canticchia e passeggia, con curiosità si
  guarda attorno.

I gesti usano solo le animazioni del contratto, fermano la loro camminata entro
300 px, non chiamano nessun modello e si spengono con "Vita autonoma" nelle
impostazioni (`idleLife` in config). Le soglie vengono da Kokoro-Engine.

**Occhi.** Nel 3D il battito di ciglia dipende dal tempo e non dal frame rate:
uno ogni 1–6 secondi, lungo 0,2 secondi. Lo sguardo fa piccoli salti attorno
alla camera. I tempi vengono da airi.

## Provider e modelli

Le chiavi API stanno in `~/.desktop-companion/config.json`, cifrate con
`safeStorage` di Electron. La chiave principale di quella cifratura sta nella
cartella dati dell'app (`<userData>/Local State`). Una chiave scritta da
un'altra installazione, o prima che quella cartella venisse ricreata, qui non
si decifra. In quel caso:
- resta nel file e non viene cancellata dal primo salvataggio;
- la schermata di configurazione dice di reinserirla (`keyUnreadable` in
  `publicConfig`).


Un provider nuovo si aggiunge con una voce in `PROVIDERS` e un `case` in
`route()`, dentro `src/main/ai-router.js`. Nient'altro cambia.

Il formato della risposta non è affidato alla buona volontà del modello. Dove
l'API lo permette viene imposto:
- schema JSON su Anthropic;
- modalità JSON su OpenAI, Grok e Mistral;
- `responseMimeType` su Gemini;
- `format: json` su Ollama;
- su OpenRouter, secondo ciò che il modello dichiara nei suoi
  `supported_parameters`: schema JSON se ha `structured_outputs`, modalità JSON
  se ha `response_format`, altrimenti una tool call forzata
  (`rispondi_companion`) se ha i `tools`. Con uno di questi vincoli la
  richiesta porta `provider.require_parameters`, così OpenRouter non la
  affida a un fornitore che lo ignora.

Prima su OpenRouter si mandava sempre `response_format`. Un modello come Laguna
S 2.1, che ha i tools ma non la modalità JSON, se lo vedeva scartare in
silenzio, rispondeva in prosa, e l'avatar non si muoveva.

Se la risposta arriva comunque in prosa (Laguna S 2.1 gratuito a volte ignora
la tool call forzata), il router riprova una volta sola, con la risposta del
modello e un promemoria sul formato.

Il parser di recupero resta per i casi in cui il vincolo non regge. `route()`
dice da che strada è arrivata la risposta (`via`: `schema`, `json`, `tool`,
`prompt`, `fallback`). Con `fallback` il main scrive nel log l'inizio del testo
grezzo, e la chat avvisa una volta per modello che le animazioni non partono.

Gli elenchi di OpenRouter (solo modelli gratuiti) e di Ollama (modelli
installati) si chiedono al servizio, con un'ora di cache. Quelli scritti in
`PROVIDERS` restano come ripiego. I modelli che ragionano prima di rispondere
ricevono almeno 8192 token e 90 secondi (`requestBudget`). Gli errori dei
provider diventano messaggi che dicono cosa fare (`describeError`).

## Animazioni

Vocabolario condiviso tra AI, chat e avatar: `idle`, `walk-to`, `run-to`,
`wave`, `think`, `sit`, `smoke`, `stretch`, `yawn`, `doze`, `dance`, più gli
alias `click`, `happy`, `scroll`, `open-file`, `search`.

Due gesti sono solo interni, usati dal main e dalla vita a riposo: `sit-edge`
(seduto su un bordo) e `dangle` (in braccio). Le clip Kimodo da generare, con
i prompt, sono in [docs/kimodo-prompts.md](docs/kimodo-prompts.md).

**Movimenti nuovi con Kimodo (facoltativo, solo 3D).** Se in chat si chiede un
movimento che non è fra i gesti ("fai un inchino"), il modello lo descrive in
inglese nel campo facoltativo `action.motion` e l'app lo fa generare a Kimodo
sulla scheda video, poi lo riproduce una volta.
- `src/main/kimodo-service.js` avvia `kmd-generate --server` alla prima
  richiesta, passa le richieste una alla volta e lo chiude dopo cinque minuti
  senza richieste, per liberare la memoria video.
- Il renderer converte l'uscita grezza in .vrma (`kimodo-raw.js`, poi
  `retargetClip`), la riproduce nello slot `generated` e la rimanda al main,
  che la tiene in cache (`<userData>/generated-motions`, al massimo 100 file).
  La stessa frase, la volta dopo, parte subito.
- Il campo `motion` si spiega al modello (`MOTION_PROMPT`) solo quando Kimodo
  è acceso, installato e l'avatar è 3D.
- Si accende dal menu col tasto destro, "Movimenti nuovi con Kimodo". La
  cartella di kimodo.cpp è `%USERPROFILE%\kimodo`, oppure `kimodoDir` scritto a
  mano in `config.json`: dalla UI non si può cambiare, perché è un eseguibile
  da avviare.

**2D.** Un avatar è un pacchetto di strip, una per animazione, con i riquadri
dei fotogrammi in un manifest. `scripts/build-strips.js` le genera dalle
immagini master: ritaglia ogni fotogramma sul personaggio, lo riduce a 480
pixel di altezza al massimo e le impacchetta. Se le master non hanno
coordinate, i fotogrammi vengono trovati da soli, purché separati da spazio
vuoto (`scripts/lib/sprite-frames.js`). Le animazioni assenti ripiegano su
idle. Il ticker gira a 30 fps.

**3D.** Sono pose procedurali, perché i VRM del progetto non contengono clip.
Three.js parte solo alla prima scelta di un avatar 3D. Le pose sono scritte
per i VRM 0.x. Sui VRM 1.0, come Fred, il player specchia gli assi e non gira
il modello, che guarda già verso la camera. Vivono in
`src/renderer/vrm-animation.js`, tenuto fuori dall'HTML per poterlo testare: il
player non dipende da Three.js e riceve le ossa da un accessor. Per ritoccare
un movimento si cambiano i numeri della tabella `CLIPS`, che sono radianti. La
camera è fissa.

**Clip .vrma.** Sopra le pose procedurali possono girare clip vere, in un solo
formato: `.vrma`, lo standard VRM per le animazioni umanoidi.
- **Dove stanno.** `modelli-3d/animations` (integrate, pubblicabili),
  `private-assets/animations` (solo nella copia privata) e
  `<userData>/animations` (importate). Il protocollo `motion://` le serve.
- **Il nome del file dice il gesto:** `wave.vrma`, `idle-2.vrma`,
  `sit-bordo.vrma`. La parte prima del trattino è uno dei nomi di `CLIPS`, il
  resto distingue le varianti, scelte a caso (`AnimationLibrary.js`).
- **Fasi**, per gli slot che durano finché non arriva altro (seduto, a riposo,
  camminata):
  - `sit-enter-*.vrma` è l'entrata: si siede, poi passa al ciclo, oppure resta
    fermo sull'ultimo fotogramma;
  - `sit-*.vrma` è il ciclo;
  - `sit-exit-*.vrma` è l'uscita: si rialza prima di passare al gesto dopo.

  All'import l'app chiede la fase e la propone dal nome del file.
- **Seduto a terra** la camera abbassa lo sguardo in proporzione a quanto è
  sceso il bacino, altrimenti le gambe uscirebbero dal fondo della finestra.
- **Riproduzione.** `clip-layer.js` segue la clip del player: se per quel
  nome c'è un .vrma lo campiona e lo fonde con la posa procedurale, con
  dissolvenze in entrata, in uscita e fra clip. Il player torna a idle quando
  finisce la clip vera. Lo sguardo verso il mouse si applica sopra.
  - Le tracce si campionano a mano: `AnimationMixer` riscrive un osso solo
    quando il valore cambia, e una clip ferma sull'ultimo fotogramma veniva
    cancellata dalla posa procedurale del frame dopo.
- **Import dal menu** (tasto destro, "Animazioni"): `.vrma`, oppure `.glb`,
  `.gltf`, `.fbx`, `.bvh` (le esportazioni di Kimodo), convertiti nel renderer
  e poi salvati. Si sceglie il gesto, con un suggerimento dal nome del file.
  Per toglierne una si cancella il file ("Apri la cartella delle animazioni").
- **Prova** (tasto destro, "Animazioni → Prova"): ogni clip per nome, divisa
  per gesto, con la fase e la cartella da cui viene, si riproduce una volta
  con il nome nel fumetto. I gesti senza clip mostrano la posa procedurale.
  "Prova i movimenti di Kimodo" elenca quelli in cache con la frase da cui
  sono nati (salvata in `index.json` accanto ai file).

**Uno scheletro per tutti i modelli.** Clip e modelli si incontrano
nell'umanoide VRM normalizzato: ogni osso a riposo ha rotazione nulla, con il
corpo in T-pose, rivolto verso +Z e in piedi lungo +Y.
- `humanoid-map.js` riconosce le ossa dai nomi di Mixamo, VRoid, Unreal,
  Blender Rigify, 3ds Max Biped e Kimodo (SOMA). La colonna e le falangi si
  assegnano per posizione nella gerarchia, perché la numerazione cambia da un
  programma all'altro. Sui VRM veri il risultato coincide con l'abbinamento che
  dichiarano (lo verifica il test).
- `motion-retarget.js` raddrizza lo scheletro: in piedi, rivolto alla camera,
  in metri e con i piedi a terra. Poi porta braccia e gambe in T-pose.
  - Nelle clip raddrizza anche la colonna.
  - Se la posa zero non ha la forma di un corpo (`isHumanShaped`), il
    riferimento è il primo fotogramma. È il caso dei BVH di Kimodo: ogni osso
    punta lungo il proprio asse X e il corpo esiste solo nelle rotazioni.

  Da lì:
  - per un modello glTF o FBX costruisce un `VRMHumanoid` di three-vrm, e il
    modello si anima come un VRM (pose, clip, sguardo, oscillazione);
  - per una clip calcola la rotazione di ogni osso rispetto alla T-pose e la
    scrive in un .vrma con scheletro di riposo neutro. Il bacino perde lo
    spostamento orizzontale, perché la camminata la fa la finestra.

Un modello senza scheletro umano resta un'anteprima statica. I file OBJ non
sono supportati: non hanno ossa da animare.

`walk-to` e `run-to` spostano la finestra vera sull'area di lavoro dello
schermo su cui sta il companion. Il main sceglie la destinazione
(`walk-target.js`) e comunica al renderer il verso, così l'avatar si gira
invece di camminare all'indietro. L'azione può dire dove andare: `direction`
(`left`, `right`, `toward-cursor`) e `distance` (`short` ~150 px, `medium`
~400 px, `edge` fino al bordo). Senza, la meta è a caso. `guards.checkMotion`
lascia passare solo quei valori.

Una posa chiesta in chat, come "siediti", resta per tre minuti: in quel tempo i
gesti a riposo non la interrompono.

## Mouse e finestra

Il mouse funziona come in Mate Engine, da cui vengono le idee e i numeri, non
il codice (è AGPL).

**Clic che attraversano il vuoto.** La finestra parte con
`setIgnoreMouseEvents(true, { forward: true })`: i clic passano alle finestre
sotto, ma i movimenti del mouse arrivano comunque alla pagina.
`companion-input.js` chiede al main di catturare il mouse solo quando il
cursore è su un pixel pieno dell'avatar o su un pulsante:
- nel 2D legge un pixel alla volta dall'immagine della strip, alla posizione
  del cursore nello sprite (`hitTest2D`);
- nel 3D legge il pixel del canvas con `readPixels` subito dopo il disegno,
  quindi la risposta arriva al frame successivo.

I pulsanti 💬 e 🔄 compaiono solo con il mouse sull'avatar.

**Prenderlo in braccio.** Premendo sull'avatar e muovendo di almeno 4 px parte
il trascinamento. La finestra la sposta il main a 60 Hz, seguendo il cursore,
e manda la velocità alla pagina (`drag-motion`):
- `sway.js` è una molla smorzata (2,6 Hz, smorzamento 0,35, al massimo 25° di
  lato e 12° in avanti) spinta da quella velocità;
- nel 2D lo sprite penzola con il perno in alto;
- nel 3D il modello sta in due gruppi, con il perno all'altezza della testa, e
  passa alla posa `dangle`;
- capelli e vestiti: alla gravità di ogni spring bone si somma una forza
  contraria al movimento.

Posato, l'avatar resta dentro l'area di lavoro dello schermo. Prima lo
spostava Windows con `-webkit-app-region: drag`: niente velocità, e il tasto
destro apriva il menu di sistema. La finestra si muove con `setBounds` a
dimensione fissa, perché `setPosition` fra schermi con scala diversa ne
cambiava la dimensione.

**Sedersi su finestre e taskbar.** L'ombra ai piedi fa da mirino: posato con
l'ombra sul bordo alto di una finestra, l'avatar ci sta in piedi e dopo un
secondo si siede, con le gambe a penzoloni davanti alla finestra.
- Segue la finestra quando si sposta o si allarga.
- Scende a terra se la finestra viene ridotta a icona, massimizzata, messa a
  schermo intero o chiusa, e resta dove lo lasci se lo riprendi in braccio.
- Sulla taskbar in basso ci si siede se l'ombra cade sulla taskbar stessa: il
  suo bordo resta il pavimento di sempre.
- Seduto su una finestra non è più "sempre in primo piano": sta subito sopra
  di lei nell'ordine z (`SetWindowPos`), così le finestre davanti lo coprono.
  Finché quella finestra è la finestra attiva torna in primo piano: Windows
  non lascia salire sopra la finestra attiva quella di un altro programma, e
  cliccandola le gambe sparivano dietro la sua barra del titolo.

Le finestre degli altri programmi le legge `src/main/win-windows.js` con koffi
(user32 e dwmapi, anche per il bordo visibile vero); le regole stanno in
`src/main/perch.js`, funzioni pure con test. Se koffi non si carica la
funzione resta spenta e il menu lo dice. Si accende e spegne dal menu col
tasto destro.

**Clic e doppio clic.** Un clic fa sorridere l'avatar, il doppio clic apre la
chat.

**Camera (3D).** Destro o centrale + trascina girano la camera intorno
all'avatar, con Alt premuto la spostano, la rotella zooma (OrbitControls,
sullo strato che riceve il mouse). OrbitControls sposta solo con Ctrl o Shift:
un ascoltatore in fase di cattura sceglie il modo del tasto prima di lui.
Il punto guardato resta entro 60 cm dall'avatar sul desktop e 25 m nella
stanza (`maxTargetRadius`). Il destro apre il menu solo se lo rilasci senza
muoverti. Doppio clic centrale, o "Rimetti la camera" nel menu, riporta la
vista di partenza.

**Segue il mouse.** Il main manda la posizione del cursore rispetto alla
finestra a 30 Hz, anche quando è fuori.
- Nel 3D testa, collo e busto si girano verso il cursore: la testa fino a
  ±45° di lato e ±30° in verticale, il busto fino a ±15°. Gli occhi lo
  seguono con `vrm.lookAt`.
- Il peso dipende dalla clip: pieno a riposo, parziale mentre saluta, nullo
  mentre cammina, siede o penzola. Gli angoli li ripartisce `distributeLook`
  in `vrm-animation.js`.
- Nel 2D lo sprite si volta verso il lato del cursore, se ci resta per 0,7 s.

**Menu col tasto destro** (`showCompanionMenu` in `main.js`):
- chat, "Stanza" e avatar (con "Importa avatar…");
- animazioni: importa, apri la cartella, prova;
- nella stanza, "Scena": quale mostrare, "Importa scena 3D…", "Sistema la
  scena…" ed "Elimina scena";
- "Rimetti la camera" (3D e stanza);
- dimensione: piccola, media, grande, molto grande. Sostituisce il
  ridimensionamento dai bordi, che con i clic che passano non si potrebbero
  afferrare;
- interruttori: "Segue il mouse", "Vita autonoma", "Sempre in primo piano";
- nascondi (torna dall'icona nella barra) ed esci.

Le opzioni si salvano in config come `followMouse`, `alwaysOnTop` e `scale`, e
`guards.mergeConfig` accetta solo valori validi.

## Stanza

"Stanza" (menu col tasto destro o icona nella barra di sistema) trasforma la
finestra dell'avatar in una stanza: grande, ridimensionabile, nella barra
delle applicazioni, con una scena 3D dietro l'avatar e la chat agganciata a
destra. Avatar, WebGL, umore e clip restano quelli: cambia solo la finestra.
La ✕ della barra del titolo riporta l'avatar sul desktop, dov'era; alla
riapertura dell'app si riparte dalla modalità in cui la si è chiusa.

**La finestra.** È sempre trasparente e senza cornice (non si può cambiare
dopo averla creata), quindi barra del titolo, pulsanti e bordi li disegna la
pagina (`room-ui.js`):
- la barra sposta la finestra con `-webkit-app-region: drag`;
- i bordi dicono al main quale lato si è preso, e il main segue il cursore;
- "Ingrandisci" copre l'area di lavoro: una finestra trasparente di Windows
  non si massimizza da sola;
- dimensioni, bordi e posto della chat sono funzioni pure in `src/main/room.js`,
  con i loro test. La stanza ricorda dove era (`roomBounds` in config).

Nella stanza il sinistro gira la camera (un clic fermo sull'avatar è ancora
una carezza), niente clic che attraversano, niente "sempre in primo piano",
niente camminate né sedute sulle finestre. La scena lascia alla chat il lato
destro spostando la vista (`setViewOffset`), non stringendo il canvas: sotto
la chat la scena continua. Un avatar 2D si disegna sopra la scena, che resta
viva dietro.

**Scene** (menu nella barra del titolo, `room-scene.js`):
- **Studio**: fondale a gradiente e pavimento che sfuma, niente da scaricare;
- **Giardino**: il cielo di `Sky.js` con il sole vero dell'ora, prato, stelle
  di notte;
- **Collina** e **Stanza vuota**: foto HDRI a 360° di Poly Haven (CC0, 2k),
  proiettate su un pavimento con `GroundedSkybox`. C'è una foto per fase del
  giorno, elencate in `modelli-3d/scenes/scenes.json` e controllate dal main;
- le **scene importate** (vedi sotto).

**Scene importate.** Menu → "Scena" → "Importa scena 3D…": `.glb`/`.gltf`,
`.fbx` e `.obj`. Le copia `SceneLibrary.js` in `<userData>/scenes`, con le
stesse regole degli avatar (solo i file dichiarati, le immagini vicine per
FBX e OBJ, i `.mtl` citati da `mtllib`), e il renderer le legge da
`scene://`. Una scena si mette intorno all'avatar con tre numeri salvati nel
record (`settings`): scala, rotazione intorno all'avatar e `offset`.
Alla prima apertura li stima `scene-fit.js`:
- **scala**: la mesh col box più grande (pareti, tende, terreno) dà l'altezza
  della stanza. Un glTF alto fra 2 e 6 m resta in metri, il resto diventa
  alto 4 m (molti file di Sketchfab non sono in metri);
- **pavimento**: la quota con più area di facce orizzontali nella metà bassa
  di quella mesh;
- **posto**: il centro del pavimento o il punto libero più vicino, meglio se
  libero anche verso la camera. Lo cerca una mappa vista dall'alto in celle
  di 10 cm, costruita in un passaggio sui triangoli (con un raggio per punto
  una scena di 300 mila triangoli bloccava la finestra per secondi).

La stima può sbagliare: ⚙ nella barra del titolo apre "Sistema la scena"
(`scene-adjust.js`) con Grandezza (da ×1/8 a ×8), Rotazione, Pavimento (±1 m)
e "Metti l'avatar qui", che prende il prossimo clic su una superficie
orizzontale. Ogni modifica si vede subito e si salva. Se fra l'avatar e la
camera c'è una parete, cioè qualcosa che blocca anche un raggio 80 cm più in
alto, la camera viene avanti fino a starle davanti. Le scene importate usano
`RoomEnvironment` come luce riflessa e niente tone mapping. Degli OBJ di
Blender si ignora il colore `Kd` quando c'è una texture: in Blender la
texture lo sostituisce, qui lo avrebbe scurito. "Elimina scena" chiede
conferma con un dialogo del main e cancella la copia importata.

**Luce.** `scene-light.js`, puro e con i suoi test, calcola il sole da data,
ora e latitudine (quella della città del meteo, altrimenti 42°), e ne ricava
colori, intensità ed esposizione per l'alba, il giorno, il tramonto e la
notte. L'umore aggiunge una tinta di pochi punti percentuali. Il cielo e le
foto usano il tone mapping ACES; i materiali dell'avatar ne restano fuori,
perché resti com'è sul desktop, e lo illuminano le luci della scena.

**Meteo vero (facoltativo, spento di base).** Nelle impostazioni della chat,
"Meteo vero nella stanza" e una città. `src/main/weather.js` chiede a
Open-Meteo, senza chiave, le coordinate della città e il meteo attuale, solo
con la stanza aperta e al massimo ogni 30 minuti. All'aperto le nuvole
velano il cielo, e pioggia, neve e nebbia si vedono davvero.

## Voce

Spenta di base. Si accende dalla finestra **Impostazioni** (menu col tasto
destro o tray, `settings.html`), che per ora ha solo questa sezione.

**Il percorso di una risposta.** `ai:send-message` in `main.js`, a risposta
arrivata, chiama `speakReply`. `speech-text.js` (puro, con test) toglie emoji,
markdown e link e divide il testo in frasi (sotto i 12 caratteri si uniscono
alla seguente, sopra i 220 si spezzano alle virgole). `voice.js` le fa
sintetizzare una alla volta e manda ogni frase al companion (`voice-audio`)
mentre prepara la seguente. Un messaggio nuovo manda uno stop, e le frasi della
risposta vecchia ancora in arrivo si scartano. `voice-player.js`, nella pagina
del companion, le suona in fila con WebAudio e, dal volume prima del
guadagno, calcola quanto aprire la bocca: `companion-3d.js` lo mette
nell'espressione `aa` del VRM a ogni frame.

**Kokoro.** Gira in un processo di utilità di Electron (`kokoro-worker.js`),
avviato alla prima frase e chiuso dopo 5 minuti di silenzio: se cade, cade lui
e non l'app. Il modello è quello fp16 con ONNX Runtime nativo sulla CPU
(`onnxruntime-node`, solo i binari Windows x64 nell'installer). Misurato su un
Ryzen 5 5600G: 2,7 volte il tempo reale, prima frase in meno di un secondo,
caricamento in 2,4 s. Le alternative misurate andavano peggio: q8 in WASM
0,5-0,8×, q8 su WebGPU 0,3×, fp16 su WebGPU 2,6× ma 5 s per la prima frase.
kokoro-js foneticizza solo in inglese: i fonemi italiani li dà espeak-ng
(build Emscripten di Echogarden) e `kokoro-text.js` (puro, con test) li scrive
come li ha visti Kokoro in addestramento (le affricate in un simbolo solo,
come fa misaki).

**File scaricati al primo uso.** `voice-assets.js`: modello, voci e tokenizer
da Hugging Face a un commit fisso, espeak-ng da jsDelivr alla versione 0.3.5,
ognuno con dimensione e SHA-256. Si scarica in un `.part`, l'hash si calcola
durante il download e un file diverso non resta su disco. Lo stato e
l'avanzamento arrivano alla finestra Impostazioni (`voice-status`). espeak-ng è
GPL-3.0: non sta nell'app né nel repo, e gira solo nel processo della voce.

**XTTS-v2, la voce principale (facoltativa).** Clona la voce da un campione
dell'utente, o usa una delle 58 voci del modello; serve una scheda NVIDIA.
Licenza del modello: Coqui Public Model License, solo uso non commerciale
(l'app è gratuita): il pulsante "Installa XTTS" si abilita solo dopo averla
accettata (`voice.cpmlAccepted`, e il main la ricontrolla).
- **Installazione** (`xtts-setup.js`), in `<userData>/voice/xtts`: uv 0.12.21
  (zip da GitHub, SHA-256, aperto con il `tar.exe` di Windows), Python 3.10.21
  suo, i pacchetti di `src/main/xtts/requirements.txt` con `--require-hashes`
  (98 pacchetti, versioni e hash generati con `uv pip compile` dall'ambiente
  provato: `transformers` resta alla 4.x, la 5.x rompe coqui-tts 0.27.5), il
  modello da Hugging Face a un commit fisso con SHA-256, e una prima accensione
  che deve trovare CUDA. uv lavora con `UV_NO_CONFIG` e senza le variabili
  `UV_*`/`PIP_*`/`PYTHON*` dell'utente; la sua cache si cancella alla fine.
  L'avanzamento dei pacchetti è la crescita della cache (circa 3 GB).
- **Servizio** (`xtts/xtts_service.py`, avviato da `xtts-engine.js`): HTTP su
  `127.0.0.1` a una porta scelta dal sistema, con un token casuale nuovo a ogni
  avvio. Carica il modello sulla GPU e fa un giro di prova, poi scrive
  `XTTS_SERVICE_READY {porta}`. `/tts` risponde a pezzi mentre genera
  (`inference_stream`): uint32 byte + float32 a 24 kHz, 0 = fine. Una
  richiesta interrotta dal main ferma la generazione. Se il main muore, stdin
  si chiude e il servizio esce, liberando la GPU. Il thread che guarda stdin
  parte solo a modello caricato: su Windows una lettura di stdin in attesa fin
  dall'avvio bloccava gli import di numpy e torch.
- **Campione:** "Importa un campione…" (dialogo del main); il servizio lo
  converte in WAV mono a 24 kHz (librosa), taglia i silenzi, tiene al massimo
  30 s e ne salva i latenti (`.latents.pt`) accanto. Un campione nuovo
  sostituisce il vecchio.
- **Quando è acceso:** con la voce attiva e XTTS scelto (`syncVoice` a ogni
  salvataggio della config e all'avvio): caricarlo richiede 30-45 secondi
  (circa due minuti la prima volta dopo l'installazione), quindi resta acceso
  e occupa circa 2 GB di memoria video. Quando non serve più si spegne dopo 2
  minuti, non subito: chi sistema le impostazioni lo spegnerebbe e
  riaccenderebbe a ogni clic. Se XTTS non è installato o si guasta, la frase e
  il resto della risposta li dice Kokoro.
- **Misure** (RTX 3060, Ryzen 5 5600G): installazione 8-9 minuti, 7,4 GB;
  primo suono di una frase 1,1-1,2 s; streaming a circa 1,1 volte il tempo
  reale. L'audit lo prova con `--xtts <cartella voice>`.
- Nel companion le frasi di XTTS arrivano a pezzi: `voice-player.js` li mette
  in fila senza buchi, e la pausa fra le frasi è un messaggio a parte (`gap`).

`npm run voice:check -- <cartella>` prova la voce senza aprire l'app.
L'audit la prova con `--voice <cartella>`: una risposta della chat deve
sentirsi e aprire la bocca.

## Azioni sul sistema

| Tipo | Vincolo |
|---|---|
| `open-desktop-item` | Solo dentro il Desktop, nome ridotto al basename, niente `../`. Scorciatoie `.lnk`/`.url` ammesse, eseguibili e script no |
| `open-url` | Solo `http` e `https` |
| `open-path` | Solo percorsi assoluti che esistono e non sono eseguibili, script o scorciatoie |
| `run-command` | Solo `notepad`, `calc`, `mspaint`, `explorer`, chiamati per nome senza percorso. `explorer` accetta solo una cartella, `calc` nessun argomento |
| `none` | Solo testo |

Le regole stanno in `src/main/guards.js`. Il main le applica *prima* di
mostrare il dialogo di conferma, e nel dialogo compare ciò che verrà eseguito
davvero, non la stringa proposta dal modello.

Per togliere il blocco sui comandi si mette `"allowUnsafeCommands": true` in
`~/.desktop-companion/config.json`, a mano: dalla UI si possono cambiare solo
provider, modello, chiavi, avatar e le opzioni del menu col tasto destro. È sconsigliato, perché apre l'esecuzione
arbitraria di comandi a qualunque cosa il modello decida di produrre.

## Test

`npm test` esegue diciannove suite senza chiavi API né finestre:

| Suite | Cosa verifica |
|---|---|
| Memoria | Scrittura, ricarica, compattazione a blocchi, log attivo ripulito, compattazioni concorrenti, cancellazione |
| Router | La memoria raggiunge il modello anche oltre 40 messaggi; dialogo che parte dall'utente; UTF-8; budget per i modelli che ragionano; errori leggibili; elenchi dei modelli |
| Umore | Emivite, affetto che non decade, energia, riga del prompt, file corrotti, contratto `emotion` |
| Vita a riposo | Soglie di quiete, sonno e risveglio, notte e stanchezza, pesi secondo l'umore |
| Controlli | Allowlist dei comandi, percorsi eseguibili, config dal renderer, opzioni della finestra, mittenti IPC |
| Animazioni | Player di pose: dissolvenze, ritorno a idle, nessun residuo fra clip, VRM 0.x e 1.0; ciglia uguali a ogni frame rate, sguardo, pesi dell'umore; testa che segue il mouse nei limiti, posa in braccio |
| Oscillazione | Molla di `sway.js`: verso, limiti, smorzamento, stesso risultato a 30 e 144 fps |
| AvatarLibrary | Importazione di VRM, glTF e pacchetti di sprite, solo i file dichiarati, limiti di scansione, avatar integrati |
| Ritaglio sprite | Rilevamento automatico dei fotogrammi su fogli costruiti nel test |
| Strip | Avatar 2D integrato: manifest e PNG coerenti, oppure assente senza PNG orfani |
| CSP | Policy delle pagine, hash dell'importmap, niente script o gestori inline |
| Ossa umanoidi | Riconoscimento su Fred e sui VRM privati (contro ciò che dichiarano), Mixamo, Unreal, Rigify, Biped, SOMA; scheletri non umani rifiutati |
| Conversione .vrma | Sorgente Mixamo in centimetri, A-pose, girata: il .vrma riletto dal lettore di three-vrm muove le braccia giuste su VRM 1.0 e 0.x; BVH; livello delle clip con dissolvenze |
| Libreria animazioni | Nome del file e gesto, varianti, salvataggio solo di glTF binari validi, un nome per ogni gesto nel menu Prova |
| Seduta | Finestre su cui sedersi, bordo coperto, taskbar, posizione mentre la finestra si muove |
| Kimodo | Avvio, richieste in coda, tempi massimi, cache con la frase in `index.json` |
| Stanza | Dimensioni salvate e di partenza, bordi, chat agganciata, scene HDRI del manifest |
| Luce della stanza | Sole a mezzogiorno, al tramonto e di notte, luci senza salti, meteo, tinta dell'umore |
| Meteo | Richieste a Open-Meteo con un fetch finto: solo città o coordinate, 30 minuti di memoria, errori |

`npm run check` aggiunge il controllo dei tipi. Il progetto è JavaScript, ma
`allowJs` e `checkJs` lo sottopongono comunque a TypeScript, con i tipi
condivisi in `src/memory/types.ts` agganciati via JSDoc.

`npm run smoke` avvia l'app vera con la porta di debug di Chromium e la
controlla dall'interno. Con `--exe` controlla il pacchetto, con `--user-data`
usa una cartella dati separata.

`npm run audit` fa lo stesso con home, cartella dati e OpenRouter finti. Il
server locale imita quattro tipi di modello: schema JSON, modalità JSON, soli
tools (come Laguna S 2.1) e sola prosa. `OPENROUTER_URL` viene accettato solo
se punta a `127.0.0.1` o `localhost`. Lo script verifica:
- che "corri fino al bordo sinistro" e "cammina verso destra" spostino davvero
  la finestra nel verso giusto;
- che "siediti qui" faccia sedere l'avatar;
- la forma di ogni richiesta;
- l'avviso con i modelli in prosa;
- i fumetti neutri per le immagini importate;
- nel 2D e nel 3D, che il mouse venga catturato sull'avatar e non sul vuoto,
  e che l'avatar reagisca quando lo si prende in braccio;
- nel 3D, che la testa segua il cursore a sinistra, a destra, in alto e in
  basso;
- le dimensioni scelte dal menu;
- nel 3D, la camera: destro + trascina gira senza aprire il menu, destro
  fermo apre il menu, la rotella zooma, doppio clic centrale la rimette;
- la stanza: finestra grande, barra del titolo, chat agganciata, il sole che
  cala in giardino da mezzogiorno alla notte, la pioggia, la foto HDRI giusta
  per l'ora, l'avatar 2D sopra la scena e il ritorno sul desktop;
- una clip .vrma, convertita da uno scheletro Mixamo, che alza il braccio sul
  VRM e su una copia di Fred senza dati VRM (un glTF qualsiasi), e la posa di
  riposo quando finisce;
- la conversione di un glb dentro l'app e il salvataggio nella libreria;
- il saluto in 3D, l'umore, la memoria, l'eliminazione di un avatar e la
  console.

Il cursore vero viene ignorato (`window.__companionTest`), così muovere il
mouse durante l'audit non falsa i controlli. `--vrm Neko` prova il 3D con un
altro modello, utile per un VRM 0.x.

## Note pratiche

**Build fuori dalle cartelle sincronizzate.** OneDrive, Dropbox e simili
tengono aperti i file mentre electron-builder ci scrive, e `rcedit` fallisce.
Per questo `npm run build` scrive sotto la temp di sistema. Per cambiare
destinazione usa `COMPANION_BUILD_OUT`.

**Le librerie del renderer sono copie.** `scripts/vendor.js` porta pixi,
three, three-vrm e GLTFLoader sotto `src/renderer/vendor/`,
perché electron-builder esclude le cartelle `examples` di `node_modules`.
Lo script verifica anche che gli import relativi siano tutti soddisfatti.

**`src/renderer/package.json` non è un pacchetto.** Contiene solo
`{"type": "module"}` e serve a far trattare quella cartella come ESM da Node,
così i test possono importare `vrm-animation.js`. I browser lo ignorano.

**Log.** Avvisi ed errori del main e dei renderer finiscono in
`<userData>/logs/main.log`, apribile dal menu dell'icona nella barra di sistema.

## Stato

Fatto:
- avatar 3D con pose procedurali coperte da test;
- pacchetti di sprite 2D importabili, con rilevamento automatico dei fotogrammi;
- camminata sul desktop;
- mouse alla Mate Engine: clic che passano sul vuoto, presa in braccio con
  oscillazione e capelli che si muovono, sguardo che segue il cursore, menu
  col tasto destro;
- seduta su finestre e taskbar, con l'ombra ai piedi come mirino;
- clip .vrma su VRM, glTF e FBX con scheletro umano, import da VRMA, glTF,
  FBX e BVH;
- router a sette provider con output vincolato ed elenchi dal vivo;
- memoria persistente riletta nel prompt;
- umore che decade nel tempo, gesti autonomi a riposo, ciglia e sguardo nel 3D;
- azioni OS ristrette;
- installer NSIS con Fuses, CI e release automatiche.

Da fare:
- arte dell'avatar 2D originale ([brief](docs/avatar-brief.md));
- interfaccia in inglese;
- firma del codice e aggiornamenti automatici;
- taratura a occhio delle pose 3D;
- clip integrate pubblicabili: la serie di base generata con Kimodo è per ora
  solo nella copia privata, finché non si confermano i termini sulle uscite;
- prova con un FBX vero (Mixamo): il percorso è lo stesso del glTF, ma i test
  non hanno un file FBX;
- modalità stanza con scene 3D e camera libera, voce, Live2D: vedi la roadmap
  in `IDEA.md`;
- Fase D: nascondersi ai bordi, chibi, danza con l'audio, mano verso il
  cursore;
- iniziativa con freni, memoria leggibile;
- input e sintesi vocale.
