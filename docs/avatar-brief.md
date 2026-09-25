# Brief: avatar 2D originale di CompanionAI

Questo documento serve a produrre l'avatar 2D integrato nella versione
pubblica, con un generatore di immagini o dandolo a un artista. Vale anche per
chi vuole creare un proprio avatar e importarlo nell'app.

## Perché serve un personaggio nuovo

Il primo avatar 2D del progetto era Yanineko, un personaggio di un anime
esistente. Non è nostro e non si può pubblicare. Resta importabile da chi lo
possiede, come pacchetto privato, ma l'app pubblica ha bisogno di un personaggio
originale.

## Concept

Una ragazza gatto trasandata, pigra e un po' sfacciata, che vive sul desktop.
Fuma quando si annoia.

- Capelli spettinati e disordinati, da chi si è appena alzata e non se ne preoccupa.
- Orecchie da gatto e coda.
- Orecchini e piercing (orecchio, sopracciglio o labbro), ben visibili anche in piccolo.
- Espressione di base annoiata o assonnata, che si accende nelle animazioni felici.
- Abiti comodi e larghi.

## Cosa deve distinguerla da Yanineko

Il concept "ragazza gatto trasandata che fuma" non appartiene a nessuno. Il
design di Yanineko sì: il nuovo personaggio non deve poter essere scambiato per
lei, né sembrarne una variante.

| Yanineko (da evitare) | Direzione per il nuovo personaggio |
|---|---|
| Capelli grigio-verdi, medi | Palette diversa, per esempio nero con ciocche viola o rosso scuro, oppure biondo platino con ricrescita scura |
| T-shirt verde chiaro oversize | Felpa col cappuccio, canotta sotto una giacca aperta, maglione sformato |
| Pantaloni blu larghi | Shorts, pantaloni cargo, pantaloni della tuta a righe |
| Ciabatte gialle a macchie | Anfibi slacciati, sneakers consumate, calzini spaiati |
| Fermagli dorati sulle orecchie | Piercing e orecchini ad anello, nessun fermaglio |
| Orecchie e coda grigie | Colore coerente con la nuova palette |

Per i generatori di immagini: **non usare mai "Yanineko"**, né il titolo
dell'anime né immagini di Yanineko come riferimento. Descrivi il personaggio
solo con le parole di questo documento.

Scegli anche un **nome nuovo**. Il nome finisce nel manifest delle strip
(`--name` di `build-strips.js`) e compare nel menu degli avatar.

## Animazioni

Nove animazioni, le stesse che l'AI sa chiedere. `idle` è obbligatoria: le
altre, se mancano, ripiegano su idle.

| Animazione | Fotogrammi | Cosa succede |
|---|---|---|
| `idle` | 8 | In piedi, respira, si gratta, sbadiglia |
| `walk` | 8 | Ciclo di camminata di profilo verso destra |
| `run` | 8 | Ciclo di corsa di profilo verso destra |
| `wave` | 8 | Saluta con la mano |
| `think` | 8 | Mano al mento; può avere nuvolette con ?, lampadina, … |
| `sit` | 8 | Si siede per terra, si mette comoda |
| `smoke` | 8 | Porta la sigaretta alla bocca, soffia il fumo |
| `click` | 12 | Reazione quando viene toccata o sollevata |
| `happy` | 8 | Contenta, saltella |

Camminata e corsa vanno disegnate verso **destra**: l'app specchia lo sprite
quando cammina verso sinistra.

## Specifiche tecniche

- **Un PNG per animazione**, con il nome dell'animazione: `idle.png`, `walk.png`, …
- **Trasparenza vera**, cioè canale alfa. Niente sfondo bianco o a scacchi da
  scontornare dopo.
- **Fotogrammi in una riga**, da sinistra a destra nell'ordine di riproduzione.
- **Almeno 40 px di spazio vuoto** fra un fotogramma e l'altro, e nessun elemento
  che li colleghi.
- **Niente testo, numeri, etichette o griglie** nel foglio.
- **Personaggio alto almeno 800 px**, sempre alla stessa scala in tutti i
  fotogrammi e in tutte le animazioni.
- **Piedi sulla stessa linea** in tutti i fotogrammi, tranne dove il movimento
  lo richiede (salto, sollevamento).
- Elementi staccati (nuvolette, fumo, gocce) vicini al personaggio: restano nel
  suo fotogramma se distano meno di 24 px da lui.

## Dalla master all'app

Metti i PNG in una cartella e lancia:

```bash
npm run strips -- --masters <cartella> --name "Nome"
```

Lo script trova i fotogrammi da solo, li ritaglia, li riduce a 480 px di
altezza e scrive strip e manifest in `src/renderer/assets/strips/`. Da quel
momento il personaggio è l'avatar 2D integrato e predefinito. `npm test`
verifica che strip e manifest combacino.

Per un avatar personale da non pubblicare, aggiungi `--pack --out <cartella>`
e importa la cartella generata dall'app, con "Importa avatar".

## Licenza

L'arte del personaggio ha una licenza sua, diversa da quella del codice: vedi
[ASSETS-LICENSE.md](../ASSETS-LICENSE.md). Se l'arte è di un artista, serve il
suo permesso scritto a pubblicarla con quella licenza. Se è generata da
un'AI, controlla i termini del servizio usato.
