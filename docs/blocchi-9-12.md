# Grafica nuova e feature da AikoMate e HakkoAI (Blocchi 9–12, dopo "Più companion")

## Contesto
Il Blocco 7 è chiuso (privato `b8628e0` = pubblico `72c3a06`, release v1.1.0). L'utente vuole
ripensare la posizione e la grafica di tasti, menu e impostazioni, prendendo come riferimento
cinque immagini e due app, AikoMate (Steam) e HakkoAI. Ha scelto di portare **tutte** le
feature proposte (bisogni e cibo, oggetti e inventario, voce continua, compagna di gioco),
**tutti e tre** i significati di "streaming" (co-host per le live, risposte in streaming,
commento al gioco) e la **grafica mista** (barra a pillola, capsule laterali, impostazioni
con barra laterale e gallerie a card).

È troppo per un blocco. Il **Blocco 8 resta "Più companion"** come nella roadmap (deciso
dall'utente): fino a 3 companion, un'istanza per persona al posto dell'unico
`companionWindow`, un selettore di persona in chat, avatar che non si sovrappongono, si
guardano e ogni tanto si commentano entro i limiti dell'iniziativa. Il suo piano dettagliato
si fa all'inizio del blocco, in `docs/blocco-8.md`.
Dopo vengono quattro blocchi nuovi, 9–12. La grafica (Blocco 9) arriva dopo più companion,
quindi l'HUD nasce già **uno per companion**, attaccato alla sua finestra. Questo file fissa
l'ordine, l'ossatura di ogni blocco e il Blocco 9 nel dettaglio. Ogni blocco successivo avrà il suo `docs/blocco-N.md` all'inizio, come sempre.
La skill "taste" non c'è in questa sessione: le scelte visive si fanno con fogli di varianti
da scegliere (come per la posa della sbirciata nel 5d).

Regole di ogni blocco, invariate: un commit per sotto-blocco nei due repo (port in inglese),
test puri, `npm test` (con `node --check` di main.js), smoke, audit, documenti; a fine blocco
installer 1.1.0, push dei due repo e release su GitHub
(`gh release upload v1.1.0 … --clobber`).

## Ricerca (5 ottobre 2026)
- **AikoMate:** VRM qualsiasi; personalità a scelta; voce in tempo reale con sottotitoli
  in 30 lingue; visione del desktop; carezze, pallavolo, cibo e bevande; anelli dei bisogni
  (affetto, sete, energia, fame) in una capsula a sinistra dell'avatar, azioni (cibo,
  borsa, casa, spegni) a destra; pannello "Your items"; parla per primo; mani che seguono
  il mouse. Crediti e negozio a pagamento (da noi niente acquisti).
- **HakkoAI:** un modello che vede guarda il gioco in tempo reale e commenta a voce, in
  overlay; chat vocale continua; memoria tra giochi; ricerca web per guide; 8 personaggi.
- **Immagini 1–3:** barra a pillola (mic, pausa, tastiera, nascondi, persone, chat con
  badge, impostazioni, maniglia); impostazioni scure con barra laterale a icone; galleria
  di modelli a card con anteprima, badge e "Load".

## Cosa c'è oggi (dall'esplorazione)
- Tre finestre in `src/main/main.js`: avatar (trasparente, 180x260, click-through con
  `UI_SELECTOR` in `src/renderer/companion-input.js:26`), chat (380x520, agganciata nella
  stanza da `dockChat`, :2568) e impostazioni (560x640).
- Sull'avatar solo due tasti al passaggio del mouse (`#click-zone`, `#switch-zone`) e il
  `#model-menu` testuale (`companion.html`). Nessuna miniatura degli avatar da nessuna parte.
- Impostazioni: barra laterale di 160 px già presente (`settings.html:16-34`), pagine
  `#page-<id>`; `SETTINGS_PAGES` (main.js:690) non conosce `persone`, `movimenti`,
  `strumenti`: da correggere.
- `src/renderer/ui.css` è condiviso dalle tre finestre: token in `:root` (accento salvia
  `#93bf9f`), font Geist.
- Umore in `src/main/mood.js` (emozioni, energia; l'affetto è già un'emozione);
  `withMoodLine` (main.js:509) lo porta al modello.
- Voce: push-to-talk (`chat.js:364`, `mic-recorder.js` con `onLevel`), Whisper con VAD
  interno; TTS frase per frase (`voice.js:231`), ma parte solo a risposta finita; ogni
  pezzo audio porta già il suo testo (utile per i sottotitoli).
- Router: nessuno streaming (`requestJSON` legge tutto); `reply` è il primo campo dello
  schema e `recoverRaw` già legge una stringa non chiusa.
- Schermata: `vision:capture` (main.js:1018) nasconde le finestre per 250 ms.
  L'iniziativa (`initiative.js`) è un buon modello per un timer.
- 3D: three.js puro, `GLTFLoader` già importato, nessuna fisica, nessun oggetto oltre
  all'avatar; nessuna clip per mangiare o bere.

## Blocco 9 — Grafica nuova (dettaglio)

### 9a — Stile: tavolozza e componenti
- Un foglio di 3 varianti (schermate generate da una pagina di prova): tavolozza scura con
  accento rosa-viola come nelle immagini, la salvia di oggi, e una terza. L'utente sceglie.
- La scelta va nei token di `ui.css`, più i componenti nuovi condivisi: pillola, capsula,
  anello di progresso (SVG), card con anteprima, badge (Attivo, Consigliato, numero),
  pulsante primario pieno.
- Test: niente di puro; un controllo nell'audit che le tre finestre caricano i token.

### 9b — HUD attorno all'avatar: barra a pillola e capsule
- Una finestra nuova, trasparente e senza cornice, `hud.html`, più grande dell'avatar e
  centrata su di lui. Lascia passare i clic tranne sui controlli (stesso schema di
  `companion-input.js`). Segue l'avatar quando si sposta, si siede, sbircia o entra nella
  stanza (riuso della logica di `dockChat`).
- **Barra a pillola** sotto l'avatar (al passaggio del mouse, oppure fissa da
  impostazione):
  - microfono (verde quando ascolta);
  - pausa (zittisce la voce e ferma la vita autonoma);
  - chat (con il badge dei messaggi non letti dell'iniziativa);
  - nascondi;
  - persone (cambio rapido);
  - impostazioni;
  - maniglia per trascinare.
  Sostituisce `#click-zone` e `#switch-zone`.
- **Capsule laterali** come AikoMate:
  - a destra le azioni: cibo, oggetti, stanza, nascondi;
  - a sinistra gli anelli, che in questo blocco mostrano umore, energia e rapporto (fame
    e sete si aggiungono nel Blocco 10).
  Si aprono con un clic sull'avatar tenuto premuto o dalla pillola. Le icone sono SVG
  disegnate da noi, niente emoji.
- Anche nella stanza: la pillola sostituisce i tasti della `#room-bar`, tranne i controlli
  della finestra.
- Test: la posizione dell'HUD rispetto all'avatar e ai bordi dello schermo (funzione pura,
  in `src/main/`, accanto a `room.js`).

### 9c — Impostazioni: barra laterale e gallerie a card
- Barra laterale a icone, con gruppi come nell'immagine:
  - **Generale**;
  - **Personaggi:** schede *Persone* e *Avatar*, entrambe a card;
  - **AI:** Modello;
  - **Voce**;
  - **Parlato**, cioè il microfono;
  - **Visione:** schermo e app attiva, poi la modalità gioco;
  - **Connettori**;
  - **Movimenti**;
  - **Cronologia:** memoria e diario, spostati da Persone;
  - **Streaming:** vuota fino al Blocco 11;
  - **Tasti rapidi**;
  - **Live2D**.
  `SETTINGS_PAGES` si allinea, così `openSettings('persone')` funziona.
- **Galleria degli avatar:** card con miniatura, tipo (VRM, Live2D, 2D), "Carica",
  "Attuale", "Elimina" per quelli importati, "+ Importa".
  - Le miniature non esistono: la finestra dell'avatar ne scatta una (`capturePage` sul
    canvas, sfondo trasparente) la prima volta che un avatar si carica. Si salvano in
    `%APPDATA%\CompanionAI\avatars\thumbs\`. Al loro posto resta un segnaposto con le
    iniziali.
- **Persone a card:** nome, avatar in miniatura, livello del rapporto, "Attiva".
- **Tasti rapidi:** la scorciatoia del microfono, più due nuove: apri o chiudi la chat,
  e mostra o nascondi.
- Test: l'elenco delle miniature e i nomi dei file (puri); `SETTINGS_PAGES` contro le
  pagine dell'HTML (un test che legge `settings.html`).

### 9d — Chat ridisegnata
- Intestazione con l'avatar in miniatura e il nome della persona; fumetti nello stile
  nuovo; la riga in basso con umore e rapporto diventa una fila di piccoli anelli.
- Nella stanza resta agganciata a destra.

### 9e — Chiusura
README, CHANGELOG, PORTING-NOTES, `docs/blocco-9.md`; smoke e audit estesi (HUD visibile
e allineato, galleria con miniature, ogni pagina delle impostazioni apribile per nome);
port; installer; push; release.

## Blocco 10 — Bisogni, cibo e oggetti (ossatura)
- **10a Bisogni** (spegnibili, accesi di base):
  - fame e sete in `mood.js` accanto all'energia: salgono con il tempo mentre l'app è
    aperta, non scendono da sole;
  - `feed(mood, item)` puro;
  - effetti morbidi: riga nel prompt, un po' di malumore se trascurati, sbadigli con poca
    energia, ogni tanto un "ho fame" come iniziativa. Non muore mai, non punisce.
  Anelli nella capsula sinistra.
- **10b Cibo e bevande:** un piccolo catalogo gratuito (icone nostre; modelli 3D CC0 dove
  servono). Dalla capsula si trascina sull'avatar, oppure si clicca. Nuove clip "mangia"
  e "beve" fatte con Kimodo in `modelli-3d/animations`, con gli slot in
  `AnimationLibrary`, `ANIMATIONS` e `CLIPS`.
- **10c Oggetti e inventario:** pannello "I tuoi oggetti" (pallone e pochi altri,
  gratuiti, più l'import di un glTF come oggetto).
  - Il pallone vive in una sua finestra trasparente piccola, con gravità e rimbalzo scritti
    a mano (sul fondo dello schermo e sulla taskbar).
  - Un clic lo lancia, l'avatar lo ribatte (pallavolo).
- **10d** Chiusura.

## Blocco 11 — Voce continua e streaming (ossatura)
- **11a Risposte in streaming:** `stream: true` sulla strada comune, su Claude e su
  Ollama.
  - Dal JSON che arriva si estrae `reply` man mano (regex di `recoverRaw`); emozione e
    azione arrivano alla fine.
  - La chat scrive mentre arriva e la voce parte alla prima frase completa.
  - Con la tool call forzata di OpenRouter e con gli strumenti MCP, si ripiega sulla
    risposta intera.
- **11b Voce continua con sottotitoli:**
  - un interruttore nella pillola (microfono verde fisso);
  - una soglia di volume in `mic-recorder.js` (`onLevel`) apre e chiude il turno da sola;
  - il microfono tace mentre parla il companion, e parlare sopra di lui lo interrompe;
  - sottotitoli sotto l'avatar dal testo di ogni pezzo audio (`voice-player.js`).
- **11c Co-host per le live:**
  - legge la chat di Twitch (IRC anonimo via WebSocket, senza account) e di YouTube (con
    una chiave API dell'utente);
  - risponde a menzioni o a un comando, con una coda e un limite al minuto, e un filtro;
  - "Sfondo per OBS": colore pieno o verde chroma, e la finestra visibile per la cattura.
- **11d** Chiusura.

## Blocco 12 — Compagna di gioco (ossatura)
- Una "modalità gioco" dalla pillola e da Visione, ogni 30–120 s (regolabile):
  - **schermata:** senza far sparire le finestre. Si usa `setContentProtection`, che su
    Windows 10 2004+ le esclude dalla cattura; altrimenti resta il nascondere di oggi;
  - **commento:** breve e a voce, a un modello che vede. Il nome del gioco viene dal
    titolo dell'app attiva;
  - **limiti:** salta se lo schermo non cambia; un limite di chiamate all'ora e il costo
    stimato in vista.
- Sopra i giochi in finestra senza bordi l'avatar resta in primo piano; a schermo intero
  esclusivo si avvisa che non si vede.
- Guide e build: le cerca con il connettore Exa, se c'è.

## Verifica
- Per ogni sotto-blocco:
  - **controlli automatici:** `npm test`, `npm run smoke`, `npm run audit` con i nuovi
    controlli;
  - **dal vivo:** l'app riaperta, poi le schermate per l'utente;
  - **per le scelte visive:** un foglio di varianti da scegliere prima di fissarle.
- Blocco 9 nello specifico: HUD allineato su desktop, seduto, sbirciando e nella stanza;
  i clic passano dove non ci sono controlli; la galleria mostra le miniature;
  `openSettings` apre ogni pagina per nome.
