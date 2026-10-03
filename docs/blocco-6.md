# Blocco 6 — Persone e relazione

## Contesto
Il Blocco 5 è chiuso (privato `5682734` = pubblico `af084cd`). La roadmap
(`plans/facciamo-un-piano-della-polymorphic-cherny.md`, Blocco 6) chiede: Persone, livelli
che possono calare, diario e giorni insieme, iniziativa con freni, e una
memoria leggibile. Valgono le regole di ogni blocco: codice identico nei due repo,
`check:publish`, test puri, smoke e audit, CHANGELOG e PORTING-NOTES, port, installer 1.1.0.
Il piano dettagliato va copiato in `docs/blocco-6.md` nel repo privato, come per il 5.

## Decisioni dell'utente (3 ottobre)
- **Livelli:** cambiano il tono nel prompt e rendono **più o meno frequenti** le reazioni
  affettuose o infastidite che esistono già (tocchi, batti cinque, gesti a riposo). Non
  sbloccano scene, pose né gesti. Una clip Kimodo nuova si fa solo se serve davvero.
- **Iniziativa:** **accesa di base**, si spegne dalle Impostazioni, al massimo **6 messaggi
  al giorno**, **niente ore di silenzio**: parla a qualsiasi ora purché il companion sia
  sveglio (`asleep` della vita autonoma). La voce sui messaggi spontanei è **un'opzione,
  spenta di base**.
- **Sveglie, timer, pomodoro:** **tolti dal blocco**. Il pomodoro non c'entra, e sveglie e
  timer sono troppo banali per chi apre l'app la prima volta. Se un giorno servono, si
  rivalutano a parte.
- **Diario:** scritto **al primo avvio del giorno**, solo se il giorno prima c'è stata chat.

## Cosa si riusa
- `MemoryManager(conversationId, MEMORY_PATH)` (`src/memory/MemoryManager.js`): la cartella
  di una persona è già `active/<id>` e `archive/<id>`. La persona predefinita usa l'id
  `default`, così la memoria di oggi non si sposta.
- L'umore: `moodLib.loadMood/saveMood` (`src/main/mood.js`) con il percorso
  `MEMORY_PATH/mood.json`. Il percorso diventa per persona, e quello di oggi resta per
  `default`.
- `withMoodLine` (`main.js:319`): la riga di sistema a cui si aggiungono livello e persona.
- `SYSTEM_PROMPT` e `route({ systemPrompt })` (`ai-router.js`): la personalità si antepone
  al prompt di base.
- La validazione di `emotion` nello schema (`ai-router.js:133`): stesso schema per il campo
  nuovo `rapport`.
- `decideIdle`/`gestureWeights` (`idle-life.js`), `idleTick` (`main.js:1340`): l'iniziativa
  si appoggia qui, così eredita già i blocchi (in braccio, seduto, balla, sbircia, chat
  attiva).
- `win-windows.js` per l'app a schermo intero, già usato da edge-peek.
- `touch-react.js` (pesi e probabilità delle reazioni) e `touch-lines.js`: il livello
  scala `chance` e i pesi, senza reazioni nuove.
- `write-atomic.js` per tutti i file nuovi su disco.
- Impostazioni a schede (`settings.html` / `settings.js`, `saveGeneral`).

## Sotto-blocchi (un commit ciascuno, test puri prima)

### 6a — Persone
- `src/main/personas.js` (puro più I/O minimo): elenco in `MEMORY_PATH/personas.json` con
  `{ id, name, avatarId, prompt, voice }` più `activeId`. Se il file manca nasce
  `default` dalla config di oggi (avatar e voce attuali, prompt vuoto). Gli id sono
  validati (`[a-z0-9-]`) perché diventano nomi di cartella.
- In `main.js`, `initMemory`/`initMood` prendono l'id della persona attiva. Cambiare
  persona salva l'umore, ricrea il `MemoryManager`, carica l'umore, applica avatar e voce,
  e avvisa le finestre.
- Prompt: `prompt` della persona, poi `SYSTEM_PROMPT` (limite di 2000 caratteri).
- Impostazioni, scheda "Persone": elenco, crea, rinomina, elimina (mai l'ultima; elimina
  anche la cartella, con conferma), modifica prompt, avatar e voce, attiva.
- Chat: il nome della persona attiva nell'intestazione. Il selettore di persona arriva nel
  Blocco 8.
- Test: `scripts/test-personas.js` (migrazione da nessun file, id non validi, eliminazione
  dell'ultima rifiutata).

### 6b — Relazione e livelli
- `src/main/rapport.js` (puro): `{ score, days, streak, lastSeenDay }` per persona in
  `<persona>/rapport.json`.
  - Il punteggio sale con il `rapport` della risposta (da −2 a +2, campo facoltativo nello
    schema, validato come `emotion`, con un tetto giornaliero) e con i giorni insieme.
  - Cala con le assenze lunghe (oltre 3 giorni, a gradini) e con `rapport` negativo.
  - 6 livelli: Sconosciuto, Conoscente, Amico, Amico stretto, Confidente, Anima gemella,
    con soglie e isteresi così non oscilla al confine.
  - `promptLine(level)` entra in `withMoodLine`.
  - `reactionScale(level, mood)` restituisce i moltiplicatori per le reazioni affettuose e
    per quelle di fastidio. Livello alto vuol dire più affetto e soglie di fastidio più
    lente; livello basso il contrario. Lo leggono `touch-react.js` (chance delle battute e
    gradini del basso ventre) e `idle-life.js` (pesi di `highfive`/`wave`/`happy`).
- La chat mostra giorni insieme, serie e livello nel piè di pagina, accanto al `mood-chip`.
- Una clip Kimodo per la salita di livello si fa solo se `happy` e `wave` non bastano. Da
  decidere guardandole dal vivo.
- Test: `scripts/test-rapport.js` (sale, cala con l'assenza, isteresi, tetto giornaliero,
  serie che si azzera).

### 6c — Diario
- `src/main/diary.js`: al primo avvio del giorno, se ieri ci sono turni in `rawTurns` della
  persona, una sola chiamata `route()` (con `jsonMode` spento e un prompt breve) scrive la
  voce del giorno in `<persona>/diary.jsonl`, una riga per giorno, solo se manca. Senza
  chiave o se la chiamata fallisce si salta in silenzio e si riprova al prossimo avvio.
- Impostazioni, scheda Persone, "Diario": sola lettura, i giorni più recenti in alto.
- Test: la scelta "scrivere o no" (giorni, già scritto, nessun turno) è pura.

### 6d — Iniziativa
- `src/main/initiative.js` (puro):
  - `shouldSpeak({ now, sentToday, max: 6, asleep, fullscreen, typing, lastUserAt, lastSpokeAt, occasion })`;
  - occasioni: buongiorno (il primo risveglio del giorno), rientro dopo un'assenza (idle di
    sistema oltre 2 h e poi attività), silenzio lungo (oltre 3 h senza chat ma utente al
    PC);
  - intervallo minimo di 45 minuti tra un messaggio e l'altro.
  
  Il testo lo scrive il modello con `route()` e una riga d'occasione. Arriva come fumetto e
  messaggio in chat, e passa da `addTurn` così resta in memoria. La voce solo se è accesa
  l'opzione "Leggi i messaggi spontanei".
- Impostazioni, scheda Generale: "Iniziativa" (accesa) e "Leggi i messaggi spontanei"
  (spenta).
- Test: `scripts/test-initiative.js` (limite giornaliero, addormentato, schermo intero,
  mentre scrivi, intervallo minimo, occasioni).

### 6e — Memoria leggibile
- `MemoryManager`: si aggiungono `editSummary(text)`, `deleteTurn(index)` e
  `deleteArchive(index)`, con salvataggio atomico (riusa `writeAtomic` e il salvataggio di
  stato che c'è già).
- Impostazioni, scheda Persone, "Memoria": il riassunto modificabile, i turni recenti e
  l'archivio con il tasto elimina.
- IPC con `isTrustedSender` come gli altri. I testi hanno un limite di lunghezza.
- Test in `src/memory/test-memory.js`.

### 6f — Chiusura
README, README.it, CHANGELOG, PRIVACY (diario e iniziativa usano il provider scelto), IDEA,
PORTING-NOTES; smoke e audit estesi (cambio persona,
diario finto, messaggio spontaneo con l'ora forzata); prova dal vivo; port; installer.

## File principali
Nuovi: `src/main/personas.js`, `rapport.js`, `diary.js`, `initiative.js` e i loro test.
Da modificare: `src/main/main.js`, `ai-router.js` (`rapport`), `touch-react.js`,
`idle-life.js`, `preload.js`,
`src/memory/MemoryManager.js`, `src/renderer/settings.html/js`, `chat.html/js`.

## Verifica
- `npm test` con i test nuovi; `npm run smoke`, `npm run audit`, `check:publish` nel
  pubblico.
- Dal vivo: creare una seconda persona con un altro avatar e prompt, scambiarle (memoria e
  umore separati); forzare l'ora per il buongiorno e il rientro dopo un'assenza; modificare
  ed eliminare un ricordo.

## Rischi
- Cambio di persona a caldo: un `route()` in volo deve finire sulla persona di partenza
  (si cattura l'id all'inizio della richiesta).
- Costi: il diario fa una chiamata al giorno; l'iniziativa al massimo 6 al giorno, e solo
  da sveglio.
- Senza ore di silenzio un messaggio può arrivare di notte: è accettato dall'utente; i
  blocchi su schermo intero e mentre scrivi restano.
