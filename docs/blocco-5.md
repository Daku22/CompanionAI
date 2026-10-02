# Blocco 5 — Presenza

Piano del 2 ottobre 2026. Parte dal Blocco 5 della roadmap del 28 settembre
(`~/.claude/plans/facciamo-un-piano-della-polymorphic-cherny.md`), con il
codice di oggi e le decisioni del 2 ottobre:
- la carezza è il mouse che va avanti e indietro sulla testa, senza tasti
  premuti;
- il ballo con la musica parte **spento**;
- solo i clic ripetuti sul **basso ventre** danno fastidio; le altre zone
  restano amichevoli;
- oggi il clic fa partire il trascinamento, va sistemato;
- ogni reazione ha un'animazione, dove si può.

Restano le regole della roadmap: codice uguale nei due repo, le cose pesanti
o che toccano la privacy sono spente di base, asset solo con licenza libera,
e alla chiusura `npm run check`, prova dal vivo, PORTING-NOTES, CHANGELOG e
port nel pubblico.

## Da dove si parte (codice al 2 ottobre)

- `companion-input.js`: il sinistro premuto diventa una presa appena il
  cursore si sposta di 4 px (`DRAG_THRESHOLD_PX`). Un clic normale, con un
  po' di tremolio o un mouse ad alta risoluzione, supera la soglia: parte
  `startDrag`, nel 3D si sente la clip `drag` più `surprised`, e
  `companion-poke` non arriva.
- `companion-poke` non porta coordinate. Ogni renderer risponde sempre allo
  stesso modo: 3D `react('happy')`, 2D `setAnim('happy')`, Live2D
  `play('click')`. Il main e l'umore non lo sanno.
- `dance` è uno slot di `AnimationLibrary` (clip Kimodo nella copia privata)
  con un ripiego procedurale a velocità fissa in `vrm-animation.js`. Non
  ascolta audio.
- `win-windows.js` (koffi) esiste già: servirà per bordi, app a schermo
  intero e sessioni audio.

## 5a — clic e presa separati

Va fatto prima del resto, perché tutti i tocchi passano di qui.

**Fatto il 2 ottobre** (`touch.js`, `scripts/test-touch.mjs`, controlli in
`audit.mjs`):
- clic = rilascio prima che parta la presa; presa = oltre 10 px, oppure tenuto
  oltre 350 ms con almeno 4 px;
- tenuto fermo 600 ms: preso in braccio senza spostarlo (un timer, perché da
  fermo non arrivano `pointermove`);
- `startDrag` parte solo a presa confermata, così la clip `drag` e
  `surprised` non scattano più al clic;
- la stessa tolleranza di 10 px vale per destro e centrale (menu o camera) e
  per il sinistro nella stanza;
- `companion-poke` porta `detail: { x, y }`, il punto premuto;
- niente scala con `devicePixelRatio`: `screenX` di Electron è già in DIP,
  al netto della scala di Windows.

## 5b — tocchi con reazioni

**Fatto il 2 ottobre.** Differenze dal piano:
- la parte del renderer (zone, carezza) sta in `touch.js`; stato dei clic,
  tabella delle reazioni e battute stanno nel main (`touch-react.js`,
  `touch-lines.js`), perche' `src/renderer/` e' a moduli ES e il main non
  puo' caricare `touch.js`. Il main rimanda al renderer la reazione da
  recitare, e l'interruttore vive li';
- nel 3D niente raycast sulle mesh: le ossa proiettate sullo schermo
  (`zoneFromBones`) bastano e costano una decina di proiezioni;
- un clic sulla testa (non una carezza) da' una carezza breve (`headTap`);
- la carezza vuole oscillazioni di almeno 12 px, perche' con passi piccoli
  il tremolio contava;
- la tabella delle altezze "full" e' misurata sugli sprite di Yanineko
  (circa sei teste); un Live2D largo usa quella del busto;
- seduto su una finestra il 3D tiene solo carezza, sussulto, rimprovero e
  giro di spalle; il 2D salta il saltello;
- con la voce accesa la battuta si dice anche, ma solo se la voce e' libera:
  non interrompe una risposta, e tace mentre si aspetta una risposta o il
  microfono ascolta (`shouldSayLine`);
- clip Kimodo delle sette reazioni nella serie privata
  (`scripts/kimodo-series-touch.json`); `turnaway` non si volta da sola.

**Zone:** `head`, `face`, `chest`, `belly`, `lowerBelly`, `hand`, `legs`.
**Tipi di tocco:**
- `poke`: un clic;
- `pat`: almeno 3 cambi di direzione orizzontale sopra la testa in 1,2 s,
  senza tasti;
- `repeat`: N clic sulla stessa zona in una finestra di tempo.

**Modulo puro** `src/renderer/touch.js` (UMD come `live2d-map.js`), con test
`scripts/test-touch.js`:
- `createRubDetector`, `createRepeatCounter` (accanto a `pressAction` del 5a);
- `zoneFromHeight(frac)` come ripiego;
- la tabella delle reazioni (sotto). Il fastidio sale a gradini: il contatore
  del basso ventre scende di uno ogni 20 s.

**Dove si trova la zona:**
- 3D: `Raycaster` sulle mesh della VRM (le SkinnedMesh hanno la posa
  attuale). Il punto colpito va all'osso umanoide più vicino: head e neck
  danno `head`, oppure `face` se il punto è davanti agli occhi; chest e
  upperChest danno `chest`; spine dà `belly`; hips sotto l'ombelico e verso
  il davanti dà `lowerBelly`; hand e lowerArm danno `hand`; le gambe danno
  `legs`.
- Live2D: `HitAreas` del model3.json (di solito Head e Body), poi per altezza
  dentro Body.
- Sprite 2D: zone nel manifest del pacchetto (`touchZones` con frazioni di
  altezza), con un ripiego standard se mancano.

**Reazioni.** Ogni riga ha un'animazione. Nel 3D prima una clip Kimodo
(serie base, solo nel privato), poi un ripiego procedurale nuovo in
`vrm-animation.js` (così anche il pubblico si muove). In Live2D si cerca un
gruppo per nome, altrimenti parametri procedurali. Nel 2D c'è l'animazione
dello sprite, più una trasformazione (saltello, tremolio, scatto indietro).

| zona / tocco | slot nuovo | 3D (procedurale di ripiego) | espressione | umore |
|---|---|---|---|---|
| testa / pat | `pat` | testa inclinata verso la mano, spalle che scendono | occhi chiusi + happy | +affection, +calm |
| viso / poke | `flinch` | piccolo scatto indietro della testa, ammicca | surprised | +curiosity |
| petto, pancia / poke | `giggle` | busto che si piega, risatina | happy | +joy |
| mano / poke (fuori dal batti cinque) | `hop` leggero | guarda la mano e ricambia con un cenno | happy | +affection piccolo |
| gambe / poke | `hop` | saltello sul posto | surprised breve | +curiosity |
| basso ventre, 1° clic | `shy` | mani davanti, passo indietro, sguardo di lato | imbarazzo (blush se c'è, poi relaxed) | +curiosity |
| basso ventre, 2–3 clic | `scold` | braccia incrociate, testa che scuote | angry 0,6 | +annoyance |
| basso ventre, 4+ clic | `turnaway` | si gira di spalle per 5 s | angry | +annoyance forte, −affection |
| qualsiasi zona, tanti clic | `giggle` più veloce, poi `scold` leggero | | | +annoyance piccolo |

- **Battute:** a volte un fumetto da una lista locale per zona e gradino
  (niente AI, niente rete), più raro per i tocchi gentili. Con la voce
  accesa può anche dirlo.
- **Tono:** imbarazzo e rimprovero, mai niente di allusivo. Le battute sono
  in un file solo (`touch-lines.js`), facili da rivedere.
- **Main:** nuova IPC `touch(zone, kind, step)`, validata in `guards.js` e
  limitata (un evento ogni 300 ms). Chiama `mood.react`/`nudge` con delta
  piccoli. L'ultimo tocco va in `promptLine`, così il modello sa che lo hai
  appena infastidito. Il "fastidio" per zona è anche un segnale pronto per
  la relazione del Blocco 6.
- **Slot nuovi** (`pat`, `flinch`, `giggle`, `offer`, `highfive`, `hop`, `shy`,
  `scold`, `turnaway`) in `ANIMATION_SLOTS`, nelle etichette di Impostazioni
  e nei pattern di `live2d-map.js` (`tap@head`, `tap@body`, `shy`,
  `angry`...). Si possono riassegnare come gli altri.
- **Kimodo:** i prompt delle clip nuove si aggiungono a
  `docs/kimodo-prompts.md` e si generano nella serie privata.
- **Impostazioni:** "Reagisce ai tocchi" (acceso).

## 5c — ballo con la musica (spento di base)

- **Interruttore:** Impostazioni → "Balla con la musica", spento. Testo:
  "l'audio si analizza sul tuo PC, non si registra e non si invia".
  `allowPermission` ammette la cattura solo con l'interruttore acceso e
  dall'origine del renderer; test in test-guards.
- **Cattura:** audio di sistema in loopback con `getDisplayMedia` e
  `setDisplayMediaRequestHandler({ audio: 'loopback' })`; la traccia video
  si ferma subito.
- **App ammesse** (regola di Mate Engine): `src/main/win-audio.js` con koffi
  legge le sessioni audio di Windows (`IAudioSessionManager2` e
  `IAudioMeterInformation`): quale processo sta suonando e a che volume. Si
  balla solo se a suonare è un'app dell'elenco (predefiniti: Spotify,
  browser, VLC, foobar2000, MusicBee; modificabile). **Prima un prototipo**:
  le interfacce COM con koffi sono la parte rischiosa. Se non passa, il
  ripiego è "almeno un'app ammessa aperta" da `win-windows.js`.
- **Modulo puro** `src/renderer/beat.js`, con test `scripts/test-beat.js` su
  segnali sintetici (click a 90/120/140 BPM, rumore, voce simulata):
  - spectral flux sulla banda bassa a circa 43 Hz, su `AudioWorklet` come
    `mic-worklet.js`;
  - tempo con autocorrelazione su 6 s (70–180 BPM), fase agganciata ai picchi,
    più energia e confidence;
  - parte dopo 3 s con confidence sopra soglia, smette dopo 3 s di silenzio;
  - pausa mentre parla il companion, perché il loopback sente la sua voce.
- **Animazione:**
  - 3D: clip Kimodo `dance` (più varianti `dance-2`, `dance-3` nella serie
    base) con velocità riscalata sul BPM e fase agganciata alla battuta. Il
    ripiego procedurale prende `phase` ed `energy` invece del tempo. Da
    seduto su una finestra: solo testa e piedi a tempo.
  - Live2D: gruppo `dance` se c'è, sempre parametri a tempo (`ParamAngleX/Z`,
    `ParamBodyAngleX`).
  - 2D: animazione `dance` del pacchetto se c'è, altrimenti saltello a tempo.
  - Niente ballo se: lo tieni in braccio, dorme, sta parlando, o è appena
    stato infastidito (`turnaway`). La tristezza abbassa l'ampiezza.
- **Costo:** misurato con `npm run bench` e con il task manager prima di
  chiudere.

## 5d — chibi e bordi

- **Chibi (solo 3D umanoidi, deciso il 2 ottobre):**
  - Vale per VRM 0.x e 1.0, e per glTF/FBX se `humanoid-map.js` riconosce lo
    scheletro.
  - Testa più grande, busto e gambe più corti (head ×1,5, colonna e gambe
    ×0,8), con la scala compensata lungo la catena (la testa non deve
    rimpicciolire insieme alla colonna).
  - Dopo la scala: altezza dei piedi ricalcolata (`scene-fit.js`), spring
    bones reinizializzate, punti di seduta (`perch`) misurati di nuovo.
  - Funzione pura `chibiScales(boneMap)` con test.
  - Voce di menu e di Impostazioni, salvata per avatar. Con Live2D, 2D o uno
    scheletro non riconosciuto la voce è grigia e dice il motivo.
  - Live2D e 2D sono esclusi: niente ossa, e la dimensione della finestra
    esiste già.
- **Bordi:** se lo lasci oltre metà fuori dal bordo sinistro o destro dello
  schermo, si nasconde e sbircia: resta fuori lasciando visibili testa e una
  mano (clip `peek`, ripiego procedurale). Esce:
  - quando il cursore si avvicina;
  - quando arriva un messaggio;
  - con un doppio clic.
  Non sbircia sopra un'app a schermo intero (`win-windows.js`). La funzione
  pura `edgeState(bounds, workArea)` va in `perch.js` o in un file suo, con
  test.

## 5e — batti cinque

Deciso il 2 ottobre: la "mano verso il cursore" della Fase D diventa un batti
cinque.

**Stati** (macchina pura in `touch.js`, con test):
- `idle`;
- `offer`: alza la mano col palmo verso di te, sorride, e la mano segue un
  poco il cursore;
- `slap`: lo schiaffo;
- `missed`: abbassa la mano, un po' deluso;
- `cooldown`.

**Quando offre la mano:**
- il cursore resta per 1 s vicino all'avatar dal lato di una mano, ma fuori
  dalla sagoma;
- oppure lo chiedi in chat ("batti cinque!"): nuova animazione `highfive`
  nel contratto della risposta;
- oppure, ogni tanto, dopo un momento felice (umore joy alto), con il freno
  della vita autonoma.

Non lo fa mentre lo tieni in braccio, è seduto, balla, sbircia, dorme o è
girato di spalle.

**Mano che segue (3D):** `reach-ik.js`, IK a due ossa con limiti del gomito e
del polo (test `scripts/test-reach-ik.mjs`). Il bersaglio è il cursore
proiettato su un piano davanti all'avatar, limitato a una piccola zona
attorno alla posa `offer` (circa 15 cm), con un inseguimento morbido. Fade di
0,3 s sopra la clip.

**Il clic:**
- sulla zona `hand` durante `offer` → `slap`: clip `highfive` (schiaffo e
  rimbalzo), espressione happy, battuta, umore +joy e +affection;
- più batti cinque di fila valgono sempre meno (diminuzione per finestra di
  tempo);
- se dopo 5 s non hai cliccato → `missed`: piccola delusione, senza
  fastidio;
- poi 45 s di `cooldown` prima di offrire la mano da solo un'altra volta.

**Negli altri renderer:**
- Live2D: niente ossa da piegare. `offer` usa un gruppo `highfive`/`wave`
  oppure il parametro del braccio se il modello lo ha (`ParamArmR`...).
  Non segue il cursore; il clic su Body/Hand durante `offer` vale comunque.
- 2D: la stessa logica, con l'animazione del pacchetto se c'è, altrimenti
  `wave` e `happy`.

## Ordine dei commit

1. 5a: clic e presa separati, coordinate nel poke (con test).
2. 5b: touch.js e test, zone nei tre renderer, carezza.
3. 5b: slot e ripieghi procedurali delle reazioni, Live2D, 2D.
4. 5b: IPC `touch`, umore, battute, prompt Kimodo.
5. 5c: prototipo di win-audio.js (se fallisce ci si ferma e si decide).
6. 5c: beat.js e test.
7. 5c: loopback, interruttore, app ammesse, ballo nei tre renderer.
8. 5d: chibi (solo 3D).
9. 5d: bordi.
10. 5e: macchina del batti cinque, reach-ik.js, clip e integrazione nei tre renderer.
11. Chiusura: Impostazioni, README.it e README, CHANGELOG, PRIVACY, IDEA,
    PORTING-NOTES, audit e smoke, prova dal vivo, port.

## Rischi

- Sessioni audio con koffi e COM (5c): prototipo prima di tutto.
- Soglie clic/presa: vanno provate con il mouse vero e con il touchpad.
- Le spring bones con le ossa in scala (chibi) possono esplodere. Si
  ricalcolano i raggi o, al limite, le si spegne in chibi.
- Le clip Kimodo delle reazioni restano solo nel privato finché non si
  confermano i termini. Il pubblico usa i ripieghi procedurali.
