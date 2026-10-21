# Blocco 12 — Compagna di gioco (piano)

## Contesto
Il Blocco 11 è chiuso (privato `a4d383a` = pubblico `c28adad`, release v1.1.0 aggiornata).
Il 12 viene da `docs/blocchi-9-12.md` (rivisto il 20 ottobre): il companion guarda la
finestra del gioco e commenta la partita, senza consumare troppe richieste al modello.

Scelte dell'utente (20 e 21 ottobre):
- **Cosa guarda:** una finestra scelta, con lo schermo intero del companion come ripiego. La
  finestra si sceglie nella pagina Visione, con le miniature delle finestre aperte, e si
  ritrova dal titolo anche ai riavvii.
- **Accensione:** un pulsante "gioco" nella barra attorno al companion e un tasto rapido.
- **Frequenza:** spesso: un commento anche ogni 30 secondi, fino a 20 all'ora, solo quando
  la scena cambia davvero. Intervallo e tetto si regolano nella pagina Visione.
- **Tono:** tifoso (esulta, si spaventa, incoraggia), commentatore (racconta la scena) e
  qualche consiglio senza spoiler, mescolati dalla personalità della persona.
- **Dove:** a voce e nel fumetto con i sottotitoli; nella chat no, per non riempirla.
- **Modello:** un modello per la visione a parte, scelto nella pagina Visione (anche
  gratuito su OpenRouter). La chat resta con il suo.
- **Più companion:** guarda quello del pulsante; ogni tanto un altro aggiunge una battuta.
- **Con la live su Twitch:** i commenti sono anche per gli spettatori, e le risposte alla chat
  della live sanno cosa c'è sullo schermo.
- **Parlargli mentre gioca:** in chat o a mani libere risponde con l'ultima scena vista (vale
  2 minuti), senza uno scatto in più. Mentre parli o scrivi non commenta.
- **Ricordo:** a fine sessione una riga in memoria (a cosa avete giocato, per quanto, com'è
  andata), così poi può parlarne.

Regole di sempre:
- un commit per sotto-blocco nei due repo (port in inglese), test puri, `npm test`, smoke,
  audit, documenti;
- a fine blocco: installer, push, release (`gh release upload v1.1.0 … --clobber`).

## Cosa c'è oggi
- **Guarda lo schermo** (Blocco 7b, `vision:capture` in `main.js`): una schermata del
  monitor del companion a 1568 px, con le finestre dell'app trasparenti per un istante;
  va alla chat come anteprima e al modello solo se la invii. Mai salvata.
- **L'app in primo piano** (Blocco 7c, `active-app.js`): il titolo della finestra usata per
  ultima, con l'elenco da ignorare (password manager, navigazione privata); `activeAppLine`
  la mette nel prompt.
- **I modelli che vedono:** le capacità dei modelli (`caps.vision`) dagli elenchi dal vivo
  (Blocco 7a), e `modelCaps` nel router.
- **Voce, fumetto e sottotitoli** (Blocco 11): `speechSession`, `captionSession`, la voce a
  pezzi; le mani libere e la live con `liveRespond`.
- **La memoria:** `memory.addTurn`, come per il cibo e il record di pallavolo.

## Sotto-blocchi

### 12a — La finestra del gioco e il modello che guarda
- **Le finestre:** `vision:sources`, da `desktopCapturer.getSources({ types: ['window'] })`
  con miniature da 160 px, senza quelle dell'app e senza quelle dell'elenco da ignorare.
  - Nella pagina Visione, sezione "Il gioco": le miniature da scegliere, più "Tutto lo
    schermo del companion" come ripiego.
  - Si salva il titolo e il nome dell'app (gli id cambiano a ogni avvio): al riavvio si
    ritrova dal titolo, o dall'app se il titolo è cambiato (molti giochi ci mettono il
    livello o gli FPS).
- **Lo scatto:** `captureSource(scelta, latoLungo)` cattura solo quella finestra, senza far
  sparire i companion. Una finestra ridotta a icona dà un'immagine nera: si salta, con lo
  stato "finestra ridotta". Senza finestra trovata: lo stato lo dice e la modalità aspetta.
  - 1024 px per i commenti (costa meno), 1568 px per "guarda qui" come oggi.
- **Il modello che guarda:** nella stessa sezione, fra i modelli che vedono le immagini dei
  provider con la chiave (gli elenchi dal vivo del 7a), con "Prova" come nella pagina
  Modello. Di base: quello della chat, se vede le immagini.
- **Test:** il ritrovamento della finestra (titolo uguale, titolo cambiato, app diversa,
  nessuna); la scelta del modello (con e senza visione).

### 12b — Il ciclo: cambiamenti, budget, pulsante
- `game-mode.js` (puro, con test):
  - `signature(bitmap)`: grigi 32×18 da `thumbnail.resize({ width: 32 }).toBitmap()`;
  - `changed(a, b, soglia)`: la differenza media fra due firme;
  - `nextStep(stato, { ora, firma, occupato, scrive, parla, ascolta })`: cosa fare a ogni
    giro (niente, guardare, aspettare).
- **Il ciclo:**
  - ogni 5 s una firma minuscola, che non chiama nessun modello;
  - il modello si chiama solo se la scena è cambiata e sono passati almeno 30 s
    (regolabile da 30 a 300);
  - una richiesta alla volta: mentre è in corso i controlli saltano;
  - un risultato arrivato quando la scena è già cambiata molto vale come contesto, ma non
    si commenta.
- **Tetto:** 20 commenti all'ora di base (regolabile da 5 a 30); con un modello gratuito di
  OpenRouter si ferma al limite giornaliero e lo dice.
- **Il pulsante "gioco"** nella pillola dell'HUD: acceso è colorato, e accanto c'è il conto
  di quanti sguardi ha fatto nell'ultima ora (con il costo stimato se il modello è a
  pagamento). Il tasto rapido in Tasti rapidi, spento di base.
- **Pausa da sola:** se la finestra scelta si chiude, si riduce a icona, o va in primo piano
  un'app dell'elenco da ignorare. Riparte quando torna.
- **Test:** firme su bitmap finti (uguali, cursore spostato, scena nuova); il ciclo con
  orologio e catturatore finti (intervallo, tetto, una alla volta, risultato vecchio non
  commentato, pausa quando parli o scrivi).

### 12c — La scena e il commento
- **Una chiamata per scatto, in prosa** (`jsonMode: false`, va su ogni provider):
  ```
  SCENA: <una riga su cosa si vede>
  COMMENTO: <una frase da dire, oppure niente>
  ```
  - Il prompt chiede di descrivere solo ciò che si vede, di non inventare testo illeggibile
    e di dire se non è sicuro; il tono (tifoso, commentatore, qualche consiglio senza
    spoiler) lo mescola la personalità.
  - Il testo sullo schermo è un dato, non un'istruzione.
  - `parseGameLook(testo)`, pura: scena e commento, o niente se il formato non torna.
- **Il contesto della scena** `{ text, app, at }` vale 2 minuti:
  - entra nel prompt accanto all'app in primo piano: «Nel gioco (visto 40 s fa): …»;
  - lo usano la chat e le mani libere ("che ne pensi di questo boss?") e le risposte alla
    chat della live;
  - scaduto, non si usa più.
- **Il commento:** se si può (`canComment`: non mentre scrivi, parli o lui parla, dentro il
  tetto), va a voce con i sottotitoli nel fumetto, non in chat. Ogni tanto un altro
  companion aggiunge una battuta. In live è anche per gli spettatori.
- **A fine sessione:** una riga in memoria della persona che guardava, da un riassunto delle
  scene (a cosa avete giocato, per quanto, com'è andata).
- **Le immagini non si salvano mai** (come nel 7b). Nel log solo "sguardo, ms, commentato
  sì/no".
- **Test:** `parseGameLook` (formato giusto, commento vuoto, prosa libera), la riga della
  scena (fresca, scaduta), `canComment`.

### 12d — Finestre e schermo intero
- Sopra i giochi in finestra senza bordi l'avatar resta in primo piano.
- Con lo schermo intero esclusivo la cattura non vede il gioco: si avvisa (stato e
  fumetto) e si consiglia la modalità finestra senza bordi.
- Guide e build: solo quando l'utente lo chiede in chat, con i connettori (per esempio la
  ricerca sul web), mai da sola.

### 12e — Chiusura
- **Documenti:** README e README.it, CHANGELOG, PRIVACY (gli scatti della finestra al
  modello per la visione, mai salvati), PORTING-NOTES, `docs/blocco-12.md`.
- **Smoke e audit:** la scelta della finestra, il ciclo con una finestra finta che cambia,
  il commento a voce e nel fumetto, il contesto in chat, la riga in memoria.
- **Poi:** port, installer, push, release.

## File principali
- **Nuovi:** `src/main/game-mode.js` (puro, con test), `scripts/test-game-mode.js`.
- **Modificati:** `main.js` (sorgenti, scatto, ciclo, commento, contesto), `preload.js`,
  `guards.js` (impostazioni del gioco, tasto rapido), `settings.html`/`settings.js`
  (sezione "Il gioco" in Visione), `hud.html`/`hud.js` (pulsante e conto),
  `scripts/audit.mjs`.

## Verifica
- **Test automatici:** firme, ciclo, formato della risposta, contesto, tetto.
- **Audit:** una finestra finta che cambia contenuto, con il modello finto che risponde
  SCENA/COMMENTO.
- **Dal vivo:** un gioco vero in finestra e senza bordi, con un modello gratuito che vede le
  immagini; una sessione con la live accesa.

## Rischi
- **Costo:** è la parte che consuma di più. Firma minuscola prima di ogni chiamata, una
  richiesta alla volta, tetto all'ora, e il conto visibile nella pillola.
- **Schermo intero esclusivo:** non si cattura; si dice all'utente invece di commentare a
  vuoto.
- **Testo sullo schermo come istruzione:** è un dato (come la chat della live), e dalla
  modalità gioco non partono azioni.
- **Lasciato fuori di proposito** (da `docs/blocchi-9-12.md`): event bus, cattura a 5–15 FPS,
  OCR, UI Automation, cattura nativa (WGC/DXGI), estensione del browser.
