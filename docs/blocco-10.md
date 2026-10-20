# Blocco 10 — Bisogni, cibo e oggetti (piano)

## Contesto
Il Blocco 9 è chiuso, e dopo sono arrivati i tre avatar di base (Feniel, Shibahu e
Hiyori) e il Cubism Core dall'installer. Il Blocco 10 viene da `docs/blocchi-9-12.md`: i
bisogni, il cibo e gli oggetti di AikoMate, senza negozio né acquisti.

Scelte dell'utente (16 ottobre):
- **Bisogni:** fame e sete, accesi di base e spegnibili.
- **Trascurato:** effetti graduali.
  - Con un po' di fame: un po' di malumore, lo dice ogni tanto ("ho fame…"), sbadiglia,
    si muove più lento.
  - Con molta fame: si lamenta spesso, è scontroso nelle risposte, e il rapporto cala piano
    finché non mangia.
  - Mai niente di irreversibile.
- **Velocità:** una giornata d'uso, solo con l'app aperta: fame piena in circa 8 ore, sete
  in circa 5.
- **Dare il cibo:** trascinandolo sull'avatar.
- **Mentre mangia:**
  - 3D: il cibo compare nella sua mano durante la clip "mangia/beve";
  - 2D e Live2D: animazione e fumetto.
- **Catalogo:** lo sceglie l'utente da un foglio con le anteprime dei modelli CC0.
- **Pulsanti:** due nella capsula destra dell'HUD, "Cibo" e "Oggetti".
- **Oggetti:** pallone (pallavolo), gomitolo o giocattolo, peluche o cuscino, e l'import
  di un glTF. Il tipo di un oggetto importato lo sceglie l'utente all'import: Da lanciare,
  Da abbracciare, Cibo, Bevanda o Decorazione. Si può cambiare dopo.
- **Più companion:** ognuno ha i suoi bisogni; il cibo va a chi lo ricevi; gli oggetti
  sono per tutti (il pallone se lo passano, il gomitolo lo insegue il più vicino).
- **Iniziativa:** chiede quando ha fame o sete; gioca da solo quando si annoia; capisce la
  chat ("ti preparo un tè", "giochiamo a palla").
- **Pallavolo:** mini-gioco con punteggio. Un clic lancia il pallone, il companion lo
  ribatte, si contano i palleggi, c'è un record e una reazione quando lo batti.

Regole di sempre:
- un commit per sotto-blocco nei due repo (port in inglese), test puri, `npm test`, smoke,
  audit, documenti;
- a fine blocco: installer, push, release (`gh release upload v1.1.0 … --clobber`);
- i modelli inclusi devono poter essere ridistribuiti, e licenze e crediti vanno in
  `ASSETS-LICENSE.md` (niente crediti nelle card).

## Cosa c'è oggi
- **`mood.js` (puro):**
  - emozioni ed energia, con `decay`, `onUserMessage`, `promptLine`, `publicMood`;
  - l'energia scende di 0,02 a messaggio e si ricarica con un tempo di dimezzamento di
    2 ore;
  - salvato in `mood.json` nella cartella della persona.
- **Rapporto (`rapport.js`):** punteggio da 0 a 100 con 6 livelli; il calo per assenza è
  già graduale e limitato.
- **Iniziativa (`initiative.js`):** occasioni per tipo, 6 messaggi al giorno all'utente, un
  conto a parte fra companion.
- **HUD (`hud.html`):**
  - capsula sinistra con 3 anelli;
  - capsula destra con chat, stanza, avatar e nascondi;
  - una finestra sola, che cattura il mouse solo sui controlli.
- **Animazioni:**
  - `ANIMATION_SLOTS` in `AnimationLibrary.js`;
  - le 27 clip Kimodo in `modelli-3d/animations`, generate da `scripts/kimodo-series*.json`
    con `kimodo-generate.mjs`;
  - le animazioni che il modello può chiedere sono `ANIMATIONS` in `ai-router.js`.
- **Librerie da riusare:** `SceneLibrary` riusa la scansione, la copia e l'eliminazione di
  `AvatarLibrary`. Una libreria di oggetti può fare lo stesso.
- **Finestre trasparenti piccole:** il companion e l'HUD mostrano già come si fa:
  click-through tranne sul contenuto, posizione aggiornata dal giro del cursore (33 ms).

## Sotto-blocchi

### 10a — Fame e sete
- **`needs.js` (puro, con test):** `{ hunger, thirst, updatedAt }` da 0 (sazio) a 1.
  - `grow(needs, ms)` le fa salire solo con il tempo di app aperta (`HUNGER_FULL_H` 8,
    `THIRST_FULL_H` 5);
  - `feed(needs, item)` le fa scendere quanto dice l'oggetto;
  - `level(needs)` dice `ok`, `poca` (oltre 0,5) o `molta` (oltre 0,8);
  - `promptLine` scrive la riga del prompt.
  - Salvato in `needs.json` nella cartella della persona. Al riavvio non conta il tempo ad
    app chiusa, e con la pausa dell'HUD si ferma.
- **Effetti graduali:**
  - *Un po' di fame o sete:*
    - una riga nel prompt ("hai un po' fame");
    - una spinta leggera verso il malumore in `mood.js`;
    - più sbadigli nella vita a riposo e camminata un po' più lenta;
    - ogni tanto un fumetto breve ("Ho un po' fame…"), senza chiamare il modello.
  - *Molta fame o sete:*
    - nel prompt il tono scontroso, "ti lamenti della fame";
    - un fumetto ogni 10–15 minuti circa;
    - un'occasione di iniziativa `hungry`/`thirsty`, dentro i 6 messaggi al giorno;
    - il rapporto cala piano: circa 0,5 punti l'ora, al massimo 3 al giorno, con
      `Rapport.onNeglect`, puro e con test.
  - Mangiato e bevuto, tutto torna normale. Il rapporto risale come sempre.
- **Dove si vedono:**
  - due anelli in più, fame e sete, nella capsula sinistra dell'HUD e nella barra in basso
    della chat, con il dettaglio nel tooltip;
  - un interruttore "Fame e sete" in Impostazioni > Generale, acceso di base. Spento, gli
    anelli spariscono e nessun effetto.
- **Test:** crescita, sazietà, livelli, il tempo ad app chiusa che non conta, il calo del
  rapporto limitato e mai sotto il livello di partenza.

### 10b — Cibo e bevande
- **Foglio di scelta:**
  - prima di scrivere codice, un foglio con le anteprime dei cibi e delle bevande CC0
    (Kenney Food Kit, Poly Pizza, Quaternius…), con il nome e la licenza;
  - l'utente sceglie quali includere;
  - i modelli scelti vanno in `modelli-3d/food/`, con `food.json` (id, nome, cibo o
    bevanda, quanto sazia, modello, posizione in mano).
- **Pannello "Cibo":**
  - pulsante nella capsula destra dell'HUD;
  - apre un pannellino a card accanto al companion, una finestra trasparente
    `items.html`, la stessa per Cibo e Oggetti;
  - ogni card ha la miniatura del cibo (scattata come le foto del viso) e il nome.
- **Trascinare:**
  - premendo su una card, il main apre una piccola finestra "fantasma" con il cibo che
    segue il cursore;
  - lasciato sopra un companion (il riquadro dell'avatar, come per i tocchi), il cibo va a
    lui; lasciato altrove torna nel pannello.
- **Mangiare e bere:**
  - due clip nuove fatte con Kimodo, "mangia" e "beve", aggiunte a `kimodo-series.json`,
    `ANIMATION_SLOTS` e `ANIMATIONS`;
  - nel 3D il modello del cibo si aggancia all'osso della mano destra per la durata della
    clip, in scala con l'avatar, poi sparisce;
  - nel 2D e nel Live2D: il gesto "happy" e un fumetto ("Gnam!");
  - effetti: `feed` su fame o sete, un po' di gioia, un ringraziamento breve e una riga in
    memoria ("[ti ha dato un tè]"), così se lo ricorda.
- **Dalla chat:**
  - due animazioni nuove, `eat` e `drink`, con un campo facoltativo `item`, che si cerca
    nel catalogo per nome;
  - "Ti preparo un tè" e il modello sceglie `drink` con `item: "tè"`: il companion beve
    davvero (sazia, clip, tazza in mano).

### 10c — Oggetti e inventario
- **Pannello "Oggetti"** (la borsa nella capsula destra): le card degli oggetti inclusi
  (pallone, gomitolo, peluche, scelti dallo stesso foglio CC0) e di quelli importati,
  con il pulsante "Importa".
- **Import** (`ObjectLibrary`, sul modello di `SceneLibrary`):
  - glTF/GLB e OBJ;
  - una finestrella con l'anteprima 3D, il nome, il tipo (Da lanciare, Da abbracciare,
    Cibo, Bevanda, Decorazione) e la dimensione (le misure del modello come punto di
    partenza);
  - tipo e dimensione si cambiano dopo dalla card;
  - Cibo e Bevanda finiscono anche nel pannello "Cibo".
- **Oggetti sul desktop:**
  - si trascinano dal pannello fuori dal companion e restano sul desktop, ognuno in una sua
    finestra trasparente piccola (`object.html`, three.js);
  - fisica scritta a mano in `physics.js` (puro, con test): gravità, rimbalzo sul fondo
    dell'area di lavoro, sulla taskbar e sui bordi, attrito;
  - si prendono e si lanciano con il mouse (la velocità del rilascio);
  - al massimo 5 sul desktop, e tornano nella borsa con il doppio clic.
- **Comportamenti per tipo:**
  - *Da lanciare:* il companion più vicino lo insegue (walk-to o run-to), lo prende (clip
    "raccoglie": l'oggetto in mano) e lo riporta vicino al mouse.
  - *Da abbracciare:* lasciato sul companion, lo tiene in braccio (clip "abbraccia",
    agganciato alle due mani) e ci sonnecchia con la vita a riposo; con un clic lo posa.
  - *Decorazione:* resta dove lo lasci, e i companion ci camminano davanti.
- **Più companion:** gli oggetti sul desktop sono di tutti; chi insegue un oggetto lo
  decide la distanza; uno solo alla volta.

### 10d — Pallavolo
- **Il gioco:**
  - un clic sul pallone lo lancia verso il companion più vicino;
  - lui corre sotto il pallone e lo ribatte verso il mouse, con la clip "palleggio" di
    Kimodo;
  - tu lo ribatti cliccandolo in aria;
  - se tocca terra, la partita finisce.
- **Con più companion:** si passano il pallone fra loro e con te.
- **Punteggio:**
  - il conto dei palleggi in un fumetto sopra il pallone;
  - a fine partita il totale e una reazione (felice, o dispiaciuto se è caduto subito);
  - il record per persona va in `needs.json`; batterlo dà una reazione speciale e un po'
    di gioia;
  - giocare fa scendere l'energia e fa venire sete, più in fretta del solito.
- **La traiettoria** (puro, in `physics.js`): dove arriva il pallone, così il companion sa
  dove andare.
- **Test:** traiettoria e punto di arrivo, rimbalzi, conto dei palleggi, record.

### 10e — Iniziativa e gioco da solo
- **Chiede da mangiare:**
  - con fame o sete "molta", le occasioni `hungry` e `thirsty` in `initiative.js`, dentro
    il limite di 6 al giorno;
  - il prompt dice cosa manca, e la risposta può proporre un cibo del catalogo.
- **Gioca da solo:**
  - a riposo, se si annoia (nessun messaggio da un po') e c'è un oggetto Da lanciare sul
    desktop, ogni tanto ci gioca: lo calcia, lo insegue, palleggia da solo;
  - è un'occasione di `idle-life.js`, con la sua probabilità.
- **Dalla chat:**
  - "giochiamo a palla": l'azione `play` con `item`, che tira fuori il pallone se non c'è
    e lo lancia;
  - "prendi il gomitolo": lo insegue.

### 10f — Chiusura
- **Documenti:** README e README.it, CHANGELOG, PRIVACY (`needs.json` e la cartella degli
  oggetti), `ASSETS-LICENSE.md` con i modelli CC0, PORTING-NOTES, `docs/blocco-10.md`.
- **Smoke e audit:**
  - i bisogni che salgono;
  - un cibo trascinato sull'avatar, con la clip e la mano;
  - un oggetto lanciato che rimbalza;
  - una partita di pallavolo con il conto;
  - le azioni dalla chat.
- **Poi:** port, installer, push, release.

## File principali
- **Nuovi:**
  - `src/main/needs.js`, `physics.js` (puri) e `ObjectLibrary.js`;
  - `src/renderer/items.html/js` (pannelli Cibo e Oggetti) e `object.html/js` (oggetto
    sul desktop);
  - `modelli-3d/food/`, `modelli-3d/objects/` (CC0);
  - le clip Kimodo nuove (mangia, beve, raccoglie, abbraccia, palleggio);
  - i test `test-needs.js`, `test-physics.js` e `test-object-library.js`.
- **Modificati:**
  - `mood.js`, `rapport.js`, `initiative.js`, `idle-life.js`, `ai-router.js` (azioni e
    campo `item`);
  - `companion.js` (bisogni, mangiare, inseguire), `main.js` (finestre dei pannelli e
    degli oggetti, trascinamento, IPC), `preload.js`;
  - `hud.html/js` (pulsanti e anelli), `chat.html/js` (anelli), `companion-3d.js`
    (oggetto in mano);
  - `settings.html/js` (interruttore), `AnimationLibrary.js`,
    `scripts/kimodo-series.json`;
  - `audit.mjs`, `smoke.mjs`.

## Verifica
- **Test automatici:** `npm test` con le funzioni pure nuove (bisogni, calo del rapporto,
  fisica, traiettoria, punteggio, catalogo, libreria degli oggetti).
- **Audit con schermate:**
  - anelli di fame e sete;
  - il pannello del cibo;
  - un tè trascinato su Feniel, con la tazza in mano;
  - il pallone in aria con il conto;
  - un peluche in braccio;
  - un oggetto importato con il suo tipo.
- **Dal vivo:**
  - una giornata con i bisogni accesi;
  - cibo a due companion diversi;
  - una partita di pallavolo in due;
  - "ti preparo un tè" in chat.

## Rischi
- **Trascinare fra finestre:** il cibo esce dal pannello e arriva sul companion, che è
  un'altra finestra. Lo gestisce il main con la finestra "fantasma" e il giro del cursore,
  come la presa in braccio: niente drag and drop del sistema.
- **Oggetto in mano:** gli avatar hanno misure e mani diverse. L'oggetto si scala sulla
  lunghezza dell'avambraccio, e ogni cibo ha una sua posizione in mano in `food.json`.
  Da tarare a occhio su Feniel, Shibahu e Dust.
- **Prestazioni:** una finestra WebGL per oggetto. Al massimo 5 sul desktop, e la fisica
  si ferma quando l'oggetto è fermo.
- **Clip Kimodo:** mangiare, bere e palleggiare vanno generati e controllati con
  `npm run preview`. Se una clip viene male, si ripiega su una posa procedurale.
- **2D e Live2D:** niente oggetti in mano; per il resto (bisogni, cibo, inseguire,
  pallavolo con il gesto "happy") funzionano.

## Com'è andata (chiusura, 20 ottobre)
- **10a:** come da piano. Il rapporto cala al massimo di 3 punti al giorno e mai
  sotto il livello iniziale.
- **10b:** 21 cibi e bevande del Food Kit di Kenney (CC0), scelti da Claude su
  richiesta dell'utente; clip Kimodo `eat` e `drink`. Il cibo in mano sta
  davanti al palmo, verso la camera, e senza luci.
- **10c:** gli oggetti inclusi sono fatti da noi (Poly Pizza rifiutava le
  richieste); import di glTF/GLB, FBX e OBJ, con la texture fuori dal `.glb`
  copiata. Nel 3D l'oggetto riportato sta fra le due mani; clip `pickup` e
  `hug`. La capsula destra dell'HUD si adatta all'altezza del companion.
- **10d:** come da piano, con la clip `volley` scelta fra tre varianti (una si
  copriva il viso). Il conto dei palleggi è disegnato sul pallone.
- **10e:** la richiesta di cibo nomina cose vere del catalogo; il gioco da solo
  calcia il pallone o palleggia (senza record); `play` e `fetch` in chat.
- **Non fatto:** gli oggetti sul desktop non si ricordano alla chiusura
  dell'app (tornano nella borsa).
- **Verifica:** `npm test`, smoke e audit (137 controlli) verdi.
