# Blocco 7 — Sensi e strumenti

## Contesto
Il Blocco 6 è chiuso (privato `c8ec23d` = pubblico `a9a1084`). La roadmap
(`plans/facciamo-un-piano-della-polymorphic-cherny.md`, Blocco 7) chiede: lo schermo visto a
richiesta, l'app attiva, la modalità foto, la libreria dei movimenti Kimodo e gli strumenti
MCP. Prima della visione l'utente vuole ripensare i provider, perché molti modelli non
funzionano.

La causa è che gli elenchi dei modelli in `PROVIDERS` (`src/main/ai-router.js:24`) sono
scritti a mano e invecchiano (gpt-4o, grok-3, mixtral, gemini-2.5…). Solo OpenRouter e
Ollama li leggono dal vivo. In più ci sono quattro modi di chiamare i provider. Valgono le
regole di ogni blocco: codice identico nei due repo, test puri, smoke e audit, documenti,
port, installer 1.1.0. Il piano va copiato in `docs/blocco-7.md`.

## Decisioni dell'utente (4 ottobre)
- **Provider: rinnovo completo**, come primo pezzo del blocco. Elenchi dal vivo per ogni
  provider, il pulsante "Prova il modello", un solo modo di chiamarli (formato OpenAI) più
  Claude a parte, e per ogni modello si sa se vede le immagini.
- **Visione:** con i due provider rimasti, sopra il rinnovo.
- **MCP:** sì, versione base.
- **Movimenti Kimodo:** nome ed eliminazione. Niente eventi né export.
- **Foto:** versione essenziale.

## Cosa si riusa
- `callOpenAICompatible` (`ai-router.js:564`) diventa la strada unica. `callClaude` resta a
  parte.
- I pezzi già pronti di OpenRouter: `listModels`, `modelCaps`, `openRouterCaps`,
  `capsFromParams`, il cache con TTL (`MODEL_CACHE_MS`).
- `describeError` per i messaggi d'errore della prova.
- `provider-form.js`, la scheda Modello condivisa tra chat e Impostazioni, per il pulsante di
  prova.
- `win-windows.js`: `foregroundWindow()` per l'app attiva.
- `desktopCapturer` (già importato, `main.js:1`) per la schermata. Per la foto,
  `webContents.capturePage`.
- `kimodo-service.js`: `list()` e l'`index.json` dei prompt per i movimenti; il sottomenu
  "Prova" (`main.js:2612`).
- Il dialogo di conferma delle azioni su sistema (`os:execute`, `dialog.showMessageBox`)
  per le chiamate MCP.
- `guards.js` per validare tutto quello che arriva dal renderer o dal modello.

## Sotto-blocchi (un commit ciascuno, test puri prima)

### 7a — Provider rinnovati (deciso il 4 ottobre: solo OpenRouter e Ollama)
- **Restano due provider:** OpenRouter (predefinito: da lì passano anche Claude, GPT, Gemini,
  Grok, Mistral e i gratuiti) e Ollama (locale). Si tolgono Claude, OpenAI, Gemini, Grok e
  Mistral diretti, con il loro codice (`callClaude`, `callGemini`, le varianti).
- **Una strada sola:** tutti e due passano da `callOpenAICompatible` (Ollama con `/v1`).
  Una config che punta a un provider tolto passa da sola a OpenRouter (c'è già il ripiego in
  `loadConfig`).
- **Elenchi dal vivo:** OpenRouter già c'è; Ollama da `/api/tags`. Niente più elenchi
  scritti a mano, tranne il minimo per quando sei offline.
- **Capacità per modello:** `vision` da `architecture.input_modalities` (OpenRouter) e da
  `capabilities` di `/api/show` (Ollama).
- **"Prova il modello"** nella scheda Modello: una richiesta minima con il contratto JSON;
  dice "funziona" (con il tempo, e se risponde nel formato giusto) oppure il motivo leggibile
  da `describeError`.
- Test: `scripts/test-router.js` aggiornato (provider tolti, migrazione della config,
  capacità, prova).

### 7b — Vede lo schermo
- "Guarda qui" (pulsante 👁 nella chat, e la frase in chat che il modello trasforma in
  azione `look`):
  1. Schermata del monitor del companion con `desktopCapturer`, con le finestre del
     companion nascoste per un istante.
  2. Anteprima nella chat con "Invia" / "Annulla". Non parte nulla senza conferma.
  3. L'immagine viene ridimensionata (lato lungo 1568 px, JPEG) e va solo nel messaggio di
     quel turno.
- Router: `sanitizeHistory` accetta per i messaggi utente un contenuto
  `{ text, image: dataUrl }`. La strada unica lo manda come `image_url`. Senza un modello con visione la chat lo dice prima di inviare.
- Memoria: si salva solo il testo più "[immagine dello schermo]". L'immagine non si salva
  mai.
- Test: costruzione dei messaggi con immagine per tutte e due le strade, rifiuto senza
  visione, dataUrl non valido rifiutato.

### 7c — App attiva (facoltativa, spenta di base)
- `foregroundWindow()` dà il titolo e l'eseguibile. C'è un elenco da ignorare, modificabile
  (password manager, `InPrivate`/`Incognito` nel titolo, KeePass, 1Password, Bitwarden).
- Entra come riga di contesto in `withMoodLine` ("L'utente sta usando: …"). Non si salva
  in memoria.
- Interruttore in Impostazioni → Generale; nota in PRIVACY.
- Test: il filtro sull'elenco da ignorare e la riga.

### 7d — Movimenti Kimodo: nome ed eliminazione
- `kimodo-service.js`: in `index.json` si aggiunge `name` accanto al prompt, più `rename` e
  `remove` (il file `.vrma` e la voce dell'indice).
- Impostazioni, scheda nuova "Movimenti": l'elenco dei generati con nome modificabile,
  prompt in piccolo, "Prova" ed "Elimina" con secondo clic. Il sottomenu "Prova" mostra il
  nome.
- Test: rinomina ed eliminazione su una cartella temporanea.

### 7e — Modalità foto (essenziale)
- Nella stanza, voce "Foto" nella barra del titolo:
  - nasconde barra, chat e fumetti;
  - un piccolo pannello per scegliere la posa (le animazioni della libreria, ferme sul
    fotogramma scelto o in loop), l'espressione (le emozioni) e lo sfondo (scena o
    trasparente);
  - "Scatta" salva il PNG con la finestra di dialogo.
- `webContents.capturePage()`. Con lo sfondo trasparente si nasconde la scena e si usa il
  canale alfa.
- La camera si muove già col mouse.
- Test: niente di puro di rilievo, si copre con un controllo nell'audit.

### 7f — Strumenti MCP (base)
- Dipendenza `@modelcontextprotocol/sdk` (MIT), da registrare in `THIRD_PARTY_NOTICES.md`.
  Client nel main con il trasporto stdio.
- Impostazioni, scheda "Strumenti":
  - server aggiunti a mano: nome, comando, argomenti, variabili d'ambiente; spento di base;
  - "Collega" elenca i suoi strumenti, e ogni strumento si spunta per ammetterlo.
- Gli strumenti ammessi entrano nel prompt (nome, descrizione, schema ridotto). Il modello
  li propone con una nuova azione `tool` (`server`, `name`, `args`), validata in `guards.js`
  contro l'elenco ammesso e lo schema.
- **Ogni chiamata passa dal dialogo di conferma**, con server, strumento e argomenti.
  Il risultato, tagliato a 4000 caratteri, torna al modello in un secondo giro, che
  risponde all'utente.
- Freni: timeout 30 s, un solo strumento per risposta, processi chiusi all'uscita.
- Test: validazione dell'azione (server o strumento non ammessi, argomenti fuori schema),
  taglio del risultato, configurazione dei server.

### 7g — Chiusura
README, README.it, CHANGELOG, PRIVACY (schermata, app attiva, MCP), THIRD_PARTY_NOTICES,
PORTING-NOTES, `docs/blocco-7.md`; smoke e audit estesi (prova del modello con l'OpenRouter
finto, visione con un'immagine finta, rinomina di un movimento, foto); prova dal vivo; port;
installer.

## File principali
Modificati:
- `src/main/ai-router.js` (il cuore del 7a e del 7b), `src/main/main.js`, `guards.js`,
  `preload.js`, `kimodo-service.js`;
- `src/renderer/provider-form.js`, `chat.html/js`, `settings.html/js`, `room-ui.js`.

Nuovi:
- `src/main/active-app.js` (puro), `src/main/mcp.js`, e i test relativi.

## Verifica
- `npm test`, `npm run smoke`, `npm run audit`, `check:publish` nel pubblico.
- Dal vivo:
  - con ogni provider di cui c'è una chiave: elenco dal vivo e "Prova il modello";
  - "guarda qui" su una finestra con del testo, con un modello con visione;
  - l'app attiva menzionata in chat;
  - rinominare ed eliminare un movimento;
  - una foto con sfondo trasparente;
  - un server MCP di esempio (per esempio il filesystem ufficiale su una cartella di
    prova), con dialogo di conferma e risposta.

## Rischi
- **Endpoint OpenAI-compatibili:** quelli di Gemini e Mistral hanno differenze piccole
  (`response_format`, `tools`). Si provano dal vivo con le chiavi che ci sono; senza chiave
  restano coperti solo dai test.
- **Privacy:** schermata e app attiva sono sempre esplicite. La schermata si conferma ogni
  volta, l'app attiva è spenta di base.
- **Sicurezza MCP:** i server sono comandi locali scelti dall'utente. Non si avvia nulla da
  solo, ogni chiamata si conferma, e solo gli strumenti spuntati sono visibili al modello.
