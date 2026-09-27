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
             builtin-avatars.js, mood.js (umore), idle-life.js (gesti a riposo),
             write-atomic.js, logger.js
  memory/    MemoryManager.js + types.ts
  renderer/  companion.html + companion-2d.js + companion-3d.js, chat.html + chat.js,
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
| `gltf` | `.glb`, oppure `.gltf` con i soli buffer e texture che dichiara |
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
`wave`, `think`, `sit`, `smoke`, più gli alias `click`, `happy`, `scroll`,
`open-file`, `search`.

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
un movimento si cambiano i numeri della tabella `CLIPS`, che sono radianti. In
3D la finestra si sposta dalla maniglia in alto, perché il mouse ruota la camera.

`walk-to` e `run-to` spostano la finestra vera sull'area di lavoro dello
schermo su cui sta il companion. Il main sceglie la destinazione
(`walk-target.js`) e comunica al renderer il verso, così l'avatar si gira
invece di camminare all'indietro. L'azione può dire dove andare: `direction`
(`left`, `right`, `toward-cursor`) e `distance` (`short` ~150 px, `medium`
~400 px, `edge` fino al bordo). Senza, la meta è a caso. `guards.checkMotion`
lascia passare solo quei valori.

Una posa chiesta in chat, come "siediti", resta per tre minuti: in quel tempo i
gesti a riposo non la interrompono.

Il trascinamento finisce all'evento `moved`, cioè quando si rilascia il tasto.
Prima finiva 200 ms dopo l'ultimo movimento, e tenendo fermo l'avatar in mano
compariva il fumetto di quando lo si posa.

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
provider, modello, chiavi e avatar. È sconsigliato, perché apre l'esecuzione
arbitraria di comandi a qualunque cosa il modello decida di produrre.

## Test

`npm test` esegue dieci suite senza chiavi API né finestre:

| Suite | Cosa verifica |
|---|---|
| Memoria | Scrittura, ricarica, compattazione a blocchi, log attivo ripulito, compattazioni concorrenti, cancellazione |
| Router | La memoria raggiunge il modello anche oltre 40 messaggi; dialogo che parte dall'utente; UTF-8; budget per i modelli che ragionano; errori leggibili; elenchi dei modelli |
| Umore | Emivite, affetto che non decade, energia, riga del prompt, file corrotti, contratto `emotion` |
| Vita a riposo | Soglie di quiete, sonno e risveglio, notte e stanchezza, pesi secondo l'umore |
| Controlli | Allowlist dei comandi, percorsi eseguibili, config dal renderer, mittenti IPC |
| Animazioni | Player di pose: dissolvenze, ritorno a idle, nessun residuo fra clip, VRM 0.x e 1.0; ciglia uguali a ogni frame rate, sguardo, pesi dell'umore |
| AvatarLibrary | Importazione di VRM, glTF e pacchetti di sprite, solo i file dichiarati, limiti di scansione, avatar integrati |
| Ritaglio sprite | Rilevamento automatico dei fotogrammi su fogli costruiti nel test |
| Strip | Avatar 2D integrato: manifest e PNG coerenti, oppure assente senza PNG orfani |
| CSP | Policy delle pagine, hash dell'importmap, niente script o gestori inline |

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
- il saluto in 3D, l'umore, la memoria, l'eliminazione di un avatar e la
  console.

## Note pratiche

**Build fuori dalle cartelle sincronizzate.** OneDrive, Dropbox e simili
tengono aperti i file mentre electron-builder ci scrive, e `rcedit` fallisce.
Per questo `npm run build` scrive sotto la temp di sistema. Per cambiare
destinazione usa `COMPANION_BUILD_OUT`.

**Le librerie del renderer sono copie.** `scripts/vendor.js` porta pixi,
three, three-vrm, GLTFLoader e OrbitControls sotto `src/renderer/vendor/`,
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
- router a sette provider con output vincolato ed elenchi dal vivo;
- memoria persistente riletta nel prompt;
- umore che decade nel tempo, gesti autonomi a riposo, ciglia e sguardo nel 3D;
- azioni OS ristrette;
- installer NSIS con Fuses, CI e release automatiche.

Da fare:
- arte dell'avatar 2D originale ([brief](docs/avatar-brief.md));
- interfaccia in inglese;
- firma del codice e aggiornamenti automatici;
- taratura a occhio delle pose 3D e `vrm.lookAt` sul cursore;
- le fasi successive del piano: iniziativa con freni, memoria leggibile,
  presenza sul desktop, clip 3D generate con Kimodo;
- input e sintesi vocale.
