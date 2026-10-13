# Blocco 8 — Più companion (piano)

## Contesto
Roadmap, Blocco 8: fino a 3 companion insieme, uno per persona, con finestra, stato e vita
autonoma propri. Kimodo resta condiviso. Gli avatar non si sovrappongono, si guardano e
ogni tanto si commentano. Dopo vengono i Blocchi 9–12 (`docs/blocchi-9-12.md`).

Oggi l'app è costruita attorno a un companion solo:
- `companionWindow` (`src/main/main.js:39`) compare in 110 punti;
- umore, rapporto, memoria, vita autonoma, trascinamento, seduta, sbirciata, tocchi e
  stanza sono variabili globali di `main.js`;
- nessun gestore IPC sa da quale finestra arriva un messaggio;
- avatar e voce della persona attiva vengono copiati dentro e fuori `config.json`
  (`switchPersona`, `main.js:332`).

Decisioni dell'utente (5 ottobre):
- **Tutto alla pari:** ogni companion sa fare tutto (camminare, essere preso in braccio,
  sedersi su finestre e taskbar, sbirciare, tocchi, batti cinque, vita autonoma).
- **Chat di gruppo:** scrivi a tutti. Risponde chi è chiamato per nome; altrimenti uno, e
  a volte un secondo che reagisce al primo.
- **Tutti nella stanza:** fino a 3 avatar nella stessa scena 3D.
- **Iniziativa per companion:** 6 messaggi al giorno ciascuno.

Regole di sempre: un commit per sotto-blocco nei due repo (port in inglese), test puri
prima, `npm test`, smoke, audit, documenti. A fine blocco: installer 1.1.0, push dei due
repo, release (`gh release upload v1.1.0 … --clobber`). Il piano va copiato in
`docs/blocco-8.md`.

## Cosa si riusa
- `personas.js`: `systemPrompt(persona, base)` prende già la persona; `personaDir` per i
  dati; il limite di 20 persone.
- `MemoryManager` per persona (oggi uno solo, `main.js:442`; per le persone non attive ce
  n'è già uno temporaneo a `:1700`).
- `mood.js`, `rapport.js` e `initiative.js` sono puri: cambia solo chi tiene lo stato.
- `perch.js`, `edge-peek.js`, `walk-target.js`, `room.js` sono puri: prendono la
  finestra come argomento.
- Lo sguardo: main manda `cursor {x, y, follow}` relativo alla finestra
  (`main.js:2817`). Per guardare un altro companion basta mandare il punto della sua testa
  al posto del cursore; nel renderer non cambia nulla.
- La voce: una coda sola (`voice.js:231`) va bene, perché parla uno alla volta. Il labiale
  è già per finestra (`voice-player.js`). Basta mandare `voice-audio` alla finestra di chi
  parla, con la voce della sua persona (stessa unione di `personasPublic`, `main.js:325`).

## Sotto-blocchi

### 8a — Un "companion" per persona, ancora uno solo aperto (rifacimento senza cambi visibili)
- **Registro puro**, `src/main/companions.js`:
  - l'elenco degli aperti (massimo 3);
  - chi è il primario, cioè il primo aperto, che ospita la stanza;
  - i posti di partenza senza sovrapposizioni: una funzione pura che riceve l'area di
    lavoro e i rettangoli occupati;
  - la posizione salvata di ciascuno.
- **Un oggetto per companion in `main.js`.** Contiene:
  - finestra e id della persona;
  - `mood`/`moodSave`, `rapport`/`rapportSave`, il `MemoryManager`;
  - la vita autonoma (`gestureTimer`, `awaitingReply`, `asleep`, `lastActivityAt`, …);
  - `walkTimer`, `drag`, `peek`, `slideTimer`, `perch`, `seatAnchor`;
  - `dancingNow`, `live2dModel`, `avatarInfo`, i tocchi, il batti cinque;
  - `lastChatAt`, `motionJob`.
  Le funzioni che oggi leggono queste variabili globali le ricevono come argomento (`c`):
  `idleTick(c)`, `startWalk(c)`, `tryPerch(c)`, `withMoodLine(c, …)`, `speakReply(c, …)`,
  `animateCompanion(c, …)`, `sendCompanion(c, …)`, …
- **Chi manda un messaggio.** `companionOf(event)` legge la finestra con
  `BrowserWindow.fromWebContents` e si usa in tutti i gestori del companion (`drag:*`,
  `mouse:capture`, `companion:*`, `avatar:report`, `live2d:report-model`,
  `motions:store`, …).
- **Restano globali:**
  - chat, tray e impostazioni;
  - librerie, Kimodo e voce;
  - microfono, connettori e meteo;
  - musica: un solo companion cattura l'audio, la notizia del ritmo va a tutti;
  - le preferenze (`followMouse`, `perchEnabled`, …).
- **Avatar e voce dentro la persona.** Restano in `personas.json`, niente più copia in
  `cfg.avatarModel`/`cfg.voice`; si migra una volta alla lettura.
  - La finestra si apre con `companion.html?persona=<id>` e chiede a main il suo avatar.
  - Il cambio avatar (`companion-3d.js:1148`) scrive nella persona di chi lo chiede, non
    in config.
  - La scala resta globale.
- **Test:**
  - `scripts/test-companions.js`: registro, massimo 3, posti senza sovrapposizione,
    primario dopo una chiusura;
  - `test-personas.js` esteso alla migrazione di avatar e voce;
  - smoke e audit trovano la finestra col marcatore `primary=1` invece del primo
    `companion.html`.

### 8b — Fino a 3 sul desktop
- **Dove si sceglie chi è sul desktop:**
  - Impostazioni → Persone: interruttore "Sul desktop" per ogni persona, al massimo 3;
  - menu della tray e tasto destro: sottomenu "Companion" con le persone, spuntate se
    aperte.
  - La lista si salva in `config.openPersonas`.
- **All'avvio:** si aprono tutti, ciascuno dove l'avevi lasciato; per un companion nuovo
  si sceglie un posto libero.
- **Senza sovrapposizioni:**
  - quando lo lasci o cammina, un companion evita i rettangoli degli altri: si estende
    `walk-target.js`, e un rilascio sopra un altro lo fa scivolare di lato;
  - un posto su una finestra o sulla taskbar è di uno solo: `perch.js` riceve anche i
    posti occupati.
- **Timer:**
  - un solo ciclo per la vita autonoma e uno per il cursore, che girano su tutti;
  - i timer di camminata, seduta, sbirciata e trascinamento stanno in ogni companion.
- **Voce:** parla uno alla volta, con la voce della sua persona, e il labiale nella sua
  finestra.
- **Test:** posti liberi e ripiego quando lo schermo è pieno; seduta occupata;
  `openPersonas` pulito (id che non esistono, più di 3).

### 8c — Chat di gruppo
- **Intestazione della chat:** al posto del titolo, le pastiglie dei companion aperti
  (nome e colore). Un clic su una pastiglia scrive solo a lui, che è la "menzione"; senza
  scelta il messaggio va al gruppo.
- **Chi risponde** (funzione pura `pickResponders(text, open, lastSpeaker)` in un nuovo
  `src/main/group-chat.js`):
  - i companion chiamati per nome;
  - altrimenti uno, a turno o quello appena interpellato;
  - con una certa probabilità, un secondo che reagisce al primo;
  - al massimo 2 risposte per messaggio.
- **Il giro:** le risposte vanno una dopo l'altra. Ogni companion riceve:
  - la sua personalità e la sua memoria;
  - una riga su chi altro c'è;
  - le battute degli altri in questo turno, scritte come "[Nome ha detto: …]".
- **Memoria:** in quella di ciascuno vanno il messaggio dell'utente, la sua risposta e le
  risposte degli altri come contesto. Va verificato come `MemoryManager` tratta un terzo
  tipo di autore; se serve, si usa `speaker: 'user'` con il prefisso del nome.
- **Azioni, animazioni, emozioni, rapporto e strumenti:** valgono per chi ha risposto.
  - `os:execute` e il risultato portano il `companionId`.
  - Se un'azione chiede conferma, il dialogo dice chi la propone.
- **In chat:** ogni fumetto porta nome e colore di chi parla; la voce legge in ordine.
- **Con un companion solo,** la chat resta come oggi.
- **Test:** `pickResponders` (nomi, nessun nome, alternanza, massimo 2); costruzione della
  cronologia del secondo che risponde.

### 8d — Si guardano e si commentano
- **Lo sguardo:**
  - chi ascolta guarda chi sta parlando;
  - a riposo, ogni tanto un companion guarda un vicino per qualche secondo;
  - il resto del tempo, il mouse come oggi.
  Un "bersaglio dello sguardo" per companion in main, mandato con il canale `cursor`.
- **Iniziativa per companion:**
  - lo stato passa da `initiative.json` globale a uno per persona (`personaDir`), 6 al
    giorno ciascuno;
  - `canSpeak` resta per companion, più un lucchetto globale "qualcuno sta parlando";
  - tra due messaggi spontanei di companion diversi passano almeno 10 minuti, perché non
    arrivino a raffica.
- **Occasione nuova, `peer`:** un companion commenta un altro (cosa ha detto da poco, cosa
  sta facendo: dorme, balla, è seduto), e l'altro può rispondere una volta.
  - Conta su tutti e due i limiti.
  - Arriva come fumetti e in chat, come i messaggi spontanei di oggi.
- **Test:** `initiative.js` con l'occasione `peer` e il distacco tra companion; la scelta
  del bersaglio dello sguardo, che è pura.

### 8e — Tutti nella stanza
- La stanza resta la finestra del primario. Entrando, gli altri companion nascondono la
  loro finestra, e i loro avatar si caricano come **ospiti** nella stessa scena 3D.
  Uscendo tornano sul desktop dove erano.
- **Gli ospiti** (in `companion-3d.js`, un piccolo gestore di avatar in più):
  - si caricano in VRM, glTF o FBX con il loro avatar;
  - si dispongono attorno al primario sul pavimento, senza sovrapporsi;
  - hanno la vita a riposo con le clip della libreria, gesti ed emozioni, lo sguardo, e il
    labiale quando parlano;
  - prendono i tocchi con il clic (zona e reazione, come il primario).
  - Camminata, trascinamento e seduta: solo il primario, perché nella stanza non ci sono
    finestre su cui sedersi.
  - Un companion Live2D o 2D non può entrare in una scena 3D: resta sul desktop, e la
    stanza lo dice.
- **Messaggi:** `voice-audio`, `trigger-animation` e `mood-changed` di un ospite arrivano
  alla finestra della stanza con il suo id.
- **Memoria video:** si misura con 3 VRM; se serve, ombre e qualità più basse per gli
  ospiti.
- **Test:** la disposizione degli ospiti, pura, in `room.js`; un controllo nell'audit con
  2 companion nella stanza.

### 8f — Chiusura
README, README.it, CHANGELOG, PRIVACY (memoria condivisa tra companion nella chat di
gruppo), PORTING-NOTES, `docs/blocco-8.md`; smoke e audit con 2–3 companion aperti; prova
dal vivo; port; installer; push; release.

## File principali
- **Nuovi:**
  - `src/main/companions.js` e `src/main/group-chat.js`;
  - `scripts/test-companions.js` e `scripts/test-group-chat.js`.
- **Modificati:**
  - `src/main/main.js` (quasi tutto);
  - `personas.js`, `initiative.js`, `walk-target.js`, `perch.js`, `room.js`,
    `preload.js`;
  - `src/renderer/companion-3d.js` (identità della finestra, ospiti), `companion-2d.js`,
    `companion-live2d.js`;
  - `chat.js`/`chat.html` (pastiglie, fumetti con nome), `settings.html/js` (interruttore
    "Sul desktop");
  - `scripts/smoke.mjs`, `scripts/audit.mjs`.

## Verifica
- **Test:** `npm test` con le suite nuove.
- **Smoke e audit:**
  - l'audit apre 2 companion nella sua HOME finta;
  - controlla che non si sovrappongano, la chat di gruppo con l'OpenRouter finto (chi
    risponde, un'azione sul companion giusto), e la stanza con un ospite.
- **Dal vivo:**
  - 3 companion aperti;
  - trascinarli uno sull'altro;
  - sedersi due sulla stessa finestra;
  - un messaggio a tutti e uno con il nome;
  - un commento spontaneo tra loro;
  - la stanza con tre avatar;
  - chiusura e riapertura, ciascuno al suo posto.

## Rischi
- **`main.js`:** il rifacimento tocca quasi tutto il file. Per questo l'8a non cambia
  niente di visibile e si chiude con smoke e audit verdi prima di aprire il secondo
  companion.
- **Costi:** nella chat di gruppo ogni messaggio può fare fino a 2 chiamate al modello,
  più gli strumenti; l'iniziativa arriva fino a 18 messaggi al giorno con 3 companion.
  Va scritto nelle impostazioni.
- **Prestazioni:** con 3 finestre WebGL sul desktop e 3 avatar nella stanza, la memoria
  video su una RTX 3060 va misurata.

## Com'è andata (chiusura, 13 ottobre)
- **Prima del blocco:** su richiesta dell'utente, una pagina **Memoria** nelle impostazioni
  (memoria e diario di ogni persona); in Persone restano nome, voce e personalità.
- **8a–8e** come da piano: un companion per persona in `companion.js`, fino a 3 sul desktop
  senza sovrapporsi, chat di gruppo, sguardi e commenti, tutti nella stanza come ospiti.
- **8d, dopo la prova:** commenti fra companion più frequenti (circa ogni 8 minuti, con un
  conto a parte di 12 al giorno e 15 minuti fra due commenti dello stesso), e il saluto di chi
  arriva sul desktop, con la risposta di uno degli altri.
- **8e:** gli ospiti non camminano, non si prendono in braccio e non si siedono; Live2D e 2D
  restano sul desktop.
