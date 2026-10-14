# Blocco 9 — Grafica nuova (piano)

## Contesto
Il Blocco 8 è chiuso (privato `817792b` = pubblico `5031e28`, release v1.1.0 aggiornata).
Il Blocco 9 viene da `docs/blocchi-9-12.md`: rinnovare la posizione e la grafica di tasti,
menu e impostazioni, sulle immagini di riferimento (barra a pillola, capsule ai lati
dell'avatar come in AikoMate, impostazioni con barra laterale e gallerie a card). Ora ci sono
fino a 3 companion, quindi l'HUD deve funzionare per ognuno.

Scelte dell'utente (14 ottobre):
- **Tavolozza:** ambra calda. Il foglio delle varianti mostra 2–3 sfumature di ambra sulle
  schermate vere; l'utente ne sceglie una.
- **Barra e capsule:** compaiono al passaggio del mouse sopra un companion e spariscono
  poco dopo. Un'opzione le tiene fisse.
- **Miniature:** scattate in automatico, inquadrando il **viso** (non il busto). Finché non
  ci sono, iniziali colorate.

Skill di riferimento: `taste-skill:redesign-skill`. Si lavora sullo stack esistente, CSS
vanilla e i token di `ui.css`. Niente cornici generiche: un solo accento, ombre tinte, stati
hover/premuto/focus su tutto, `text-wrap: pretty`, numeri tabellari dove servono.

Regole di sempre:
- un commit per sotto-blocco nei due repo (port in inglese), test puri, `npm test`, smoke,
  audit, documenti;
- a fine blocco: installer, push, release (`gh release upload v1.1.0 … --clobber`);
- il piano va in `docs/blocco-9.md`.

## Cosa c'è oggi
- `src/renderer/ui.css` è condiviso da tutte le pagine:
  - token in `:root`: neutri caldi (`#151416`, testo `#ece7df`) e accento salvia
    `#93bf9f`;
  - font Geist;
  - componenti `.pf-*`.
  L'ambra si appoggia bene sui neutri che già ci sono.
- Sull'avatar oggi ci sono due tasti al passaggio del mouse: `#click-zone` (chat) e
  `#switch-zone` (menu avatar). Stanno in `companion.html` e sono usati da
  `companion-2d.js:762-769` e `companion-3d.js:1365`.
  - Il click-through della finestra lascia passare i clic tranne su
    `UI_SELECTOR` (`companion-input.js:26`).
  - La finestra di un companion è piccola (180x260, `WINDOW_SCALES`): una pillola larga
    ~320 px non ci sta.
- Impostazioni:
  - finestra 560x640 (`main.js`, `openSettings`);
  - barra laterale di 160 px a gruppi (Companion, Voce, Avatar), 10 pagine;
  - `SETTINGS_PAGES` già completo;
  - Persone e Memoria hanno un `<select>`, non ci sono card;
  - nessuna miniatura degli avatar.
- Chat:
  - l'intestazione ha l'avatar-dot "C" e le pastiglie del gruppo (8c);
  - in basso ci sono l'umore, il rapporto, Compatta e Dimentica.
- I companion sono istanze di `companion.js`. `companionOf(event)`, `chatTarget()` e
  `roomHost()` sono in `main.js`.

## Sotto-blocchi

### 9a — Tavolozza ambra e componenti condivisi
- **Foglio di varianti:** una pagina di prova con 3 sfumature di ambra applicate alle
  schermate vere (chat, impostazioni, una pillola). Le schermate escono dall'audit, con lo
  stesso metodo delle foto 8e. L'utente sceglie, e la scelta va nei token di `ui.css`:
  `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, ombre tinte di ambra.
- **Componenti nuovi in `ui.css`:**
  - `.pill` (barra a pillola);
  - `.capsule` (colonna arrotondata);
  - `.ring` (anello di progresso SVG con `--value`);
  - `.card` (anteprima, titolo, azioni allineate in basso);
  - `.badge` (Attivo, numero);
  - pulsante primario pieno, con hover, premuto (`scale(.98)`), `:focus-visible` e
    transizioni di 200 ms.
- **Icone:** SVG disegnate a mano a tratto unico 1.6, nello stile di quelle che ci sono
  già. Niente emoji nei controlli.
- **Test:** un controllo nell'audit che le pagine usano i token nuovi (colore calcolato del
  pulsante primario).

### 9b — HUD: barra a pillola e capsule attorno al companion
- **Una finestra sola, `hud.html`**, trasparente, senza cornice, sempre in primo piano,
  condivisa da tutti i companion. Quando il mouse è sopra un companion, si mette attorno
  a lui:
  - **pillola sotto:**
    - microfono (verde quando ascolta);
    - pausa (zittisce la voce e ferma la vita autonoma);
    - chat, con il badge dei messaggi non letti;
    - persone (menu rapido di chi è sul desktop);
    - nascondi;
    - impostazioni;
    - maniglia per trascinare.
  - **capsula a sinistra:** gli anelli di umore, energia e rapporto del companion. Fame e
    sete arrivano nel Blocco 10.
  - **capsula a destra:** chat, stanza, cambio avatar (il menu che oggi apre
    `#switch-zone`), nascondi.
- **Comparsa:**
  - compare al passaggio del mouse sul companion e resta mentre il mouse è sull'HUD;
  - sparisce dopo ~1,2 s fuori da entrambi;
  - l'opzione "Barra sempre visibile" (Impostazioni → Generale) la tiene fissa sul
    companion della chat.
- **Mai durante** la presa in braccio, la sbirciata, il batti cinque, la stanza (lì i
  comandi restano nella barra della stanza) o un'app a schermo intero.
- **Posizione:** una funzione pura `hudPlacement(companionBounds, hudSize, workArea)` in
  `src/main/companions.js`. Mette la pillola sotto, o sopra se sotto non c'è spazio (per
  esempio quando il companion è seduto sulla taskbar), e le capsule ai lati, dentro lo
  schermo. Ha i suoi test.
- **Clic:** la pagina dell'HUD lascia passare i clic tranne che sui controlli, con lo stesso
  schema di `companion-input.js`. Le azioni arrivano al main con l'id del companion, e
  `companionOf` diventa "il companion a cui è attaccato l'HUD".
- **Da togliere:** `#click-zone` e `#switch-zone` spariscono dall'avatar, con il CSS e il
  `UI_SELECTOR` relativi. Il doppio clic per la chat resta.
- **Test:** `hudPlacement`; nell'audit, l'HUD che compare sopra il companion giusto con due
  companion aperti, e il clic su "chat" che apre la chat.

### 9c — Impostazioni: barra laterale a icone e gallerie a card
- **Finestra:** più larga (circa 920x680, minimo 720x520), barra laterale di 200 px, gruppi
  con titoletti in maiuscoletto leggero. Ordine come nell'immagine:
  - Generale;
  - Personaggi;
  - AI (Modello, Connettori);
  - Voce e Parlato;
  - Visione (schermo, app attiva);
  - Memoria;
  - Movimenti;
  - Tasti rapidi;
  - Live2D.
  Le pagine di oggi restano: si spostano e si rinominano solo le voci, e
  `SETTINGS_PAGES` si allinea.
- **Personaggi:** pagina nuova con due schede.
  - *Persone*: card con miniatura del viso, nome, livello del rapporto, interruttore
    "Sul desktop" e "Attiva"; un clic apre il dettaglio (nome, voce, personalità) che
    sostituisce l'attuale `<select>`.
  - *Avatar*: card con miniatura, tipo (VRM, Live2D, 2D), "Usa" sul companion della
    chat, "Elimina" per quelli importati, "+ Importa".
- **Miniature del viso:**
  - **Avatar 3D:** la prima volta che si carica, il companion fa uno scatto fuori
    schermo con sfondo trasparente e camera puntata alla testa (osso `head`), 256x256.
    Il vecchio `photoShot` della modalità foto mostra la strada.
  - **Live2D:** la parte alta del modello.
  - **2D:** il primo fotogramma, ritagliato in alto.
  - Lo scatto va al main (`avatars:thumb`, PNG controllato come `photo:save`) e si salva
    in `%APPDATA%\CompanionAI\avatars\thumbs\<id>.png`. Le pagine lo leggono con
    `avatar://thumbs/<id>`.
  - Finché manca, al suo posto ci sono le iniziali con il colore della persona.
- **Tasti rapidi:** pagina nuova con la scorciatoia del microfono, spostata da Parlato, più
  due nuove: apri/chiudi la chat e mostra/nascondi i companion (`globalShortcut`,
  valori controllati in `guards.js` come `MIC_SHORTCUTS`).
- **Test:**
  - `SETTINGS_PAGES` contro le pagine di `settings.html` (letto da Node);
  - il nome del file della miniatura e il controllo del PNG;
  - le scorciatoie ammesse;
  - nell'audit: ogni pagina si apre per nome, la galleria mostra una miniatura vera
    dell'avatar di prova.

### 9d — Chat ridisegnata
- **Intestazione:** la miniatura del viso della persona al posto della "C" (in gruppo, le
  miniature affiancate) e il nome.
- **Fumetti:** ambra per l'utente; superficie calda con il nome colorato per i companion.
- **Barra in basso:** umore, energia e rapporto diventano tre piccoli anelli, con il
  dettaglio nel tooltip. Compatta e Dimentica vanno in un menu "⋯".
- **Stati da rifinire:** la chat vuota (benvenuto), l'attesa (puntini), l'errore inline.
- **Nella stanza** resta agganciata a destra.

### 9e — Chiusura
- **Documenti:** README e README.it (schermate nuove), CHANGELOG, PORTING-NOTES,
  `docs/blocco-9.md`.
- **Smoke e audit:** HUD, gallerie, miniature, pagine per nome, chat.
- **Poi:** port, installer, push, release.

## File principali
- **Nuovi:**
  - `src/renderer/hud.html`, `hud.js` (e lo stile in `ui.css`);
  - le icone SVG in linea.
- **Modificati:**
  - `src/renderer/ui.css`, `settings.html/js`, `chat.html/js`, `companion.html`,
    `companion-input.js`, `companion-2d.js`, `companion-3d.js`, `companion-live2d.js`
    (miniature);
  - `src/main/main.js` (finestra HUD, `avatars:thumb`, scorciatoie, finestra delle
    impostazioni), `companion.js`, `companions.js`, `AvatarLibrary.js` (cartella `thumbs`),
    `guards.js`, `preload.js`;
  - `scripts/audit.mjs`, `smoke.mjs`.

## Verifica
- **Test automatici:** `npm test` con le funzioni pure nuove (`hudPlacement`, scorciatoie,
  nome della miniatura, `SETTINGS_PAGES` contro l'HTML).
- **Audit con schermate:**
  - il foglio delle varianti di ambra;
  - HUD su desktop, seduto e con due companion;
  - le gallerie con le miniature;
  - la chat nuova.
- **Dal vivo:**
  - mouse sopra ciascun companion;
  - clic su ogni tasto della pillola;
  - un avatar nuovo che si fotografa da solo;
  - le scorciatoie nuove;
  - la chat in gruppo con le miniature.

## Rischi
- **Una finestra in più per l'HUD:** deve seguire il companion mentre cammina o viene
  trascinato senza ritardi visibili. Si aggiorna con lo stesso timer del cursore (33 ms),
  e durante la presa si nasconde.
- **Click-through:** la pagina dell'HUD deve catturare il mouse solo sui controlli, o
  coprirebbe le finestre sotto.
- **Miniature:** lo scatto fuori schermo va fatto senza disturbare il companion (un
  render a parte, dopo il caricamento) e una volta sola per avatar.

## Com'è andata (chiusura, 14 ottobre)
- **9a:** l'ambra scelta è la variante "Ambra" (`#e49b45`); i componenti comuni in `ui.css`.
- **9b:** HUD come da piano. Dopo la prova: il tasto chat della capsula apre la chat con quel
  companion, quello della pillola la chat di gruppo (solo con almeno due); niente "Ora parli
  con" nel gruppo; poi chat singole e chat di gruppo in finestre separate, affiancate.
- **9c:** barra laterale a gruppi (Companion, AI, Voce e parlato, Sensi e ricordi, Avatar,
  Comandi), con Tasti rapidi in fondo invece che fra Movimenti e Live2D. Ctrl+Alt+C e
  Ctrl+Alt+H accese di base. Dopo la prova: la foto 3D con il modello fermo, dritto e con
  gli occhi aperti (`holdStill`), e `THUMB_VERSION` per rifare le foto vecchie.
- **9d:** come da piano, più "Riprova" sugli invii senza risposta e i visi accanto ai
  fumetti nella chat di gruppo.
- **Verifica:** `npm test`, smoke e audit (124 controlli) verdi.
