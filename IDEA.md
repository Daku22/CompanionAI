# CompanionAI — l'idea

Questo documento tiene la visione e le decisioni prese. Per lo stato del codice
e per come si avvia, vedi [README.md](README.md).

## Cosa vuole essere

Un'entita' che vive nello spazio di lavoro dell'utente. Non un chatbot con un
personaggio disegnato sopra: un avatar che sta sul desktop, si muove, agisce sul
sistema con animazioni legate a cio' che sta facendo, e nel tempo costruisce una
continuita' con chi lo usa.

Le tre cose che distinguono un companion da un'interfaccia di chat sono la
presenza sullo schermo, la capacita' di fare e non solo di rispondere, e la
memoria che attraversa le sessioni. Le prime due sono ora nel codice. La terza
c'e' ma va vissuta per settimane prima di sapere se regge.

## Vincoli

L'avatar deve poter essere 2D o 3D in formato VRM, perche' la scelta del
personaggio non deve dipendere dall'architettura.

Nessuna inferenza locale pesante obbligatoria e nessun layer di
virtualizzazione. Il progetto deve girare su hardware modesto senza portarsi
dietro un runtime da un gigabyte. Cio' che e' pesante (Kimodo, e piu' avanti la
voce locale) e' facoltativo, spento di base, e si installa o si scarica a parte.

Le azioni sul sistema operativo sono la parte pericolosa. La superficie resta
ristretta per scelta, non per mancanza di tempo.

## Decisioni prese

### Standalone, senza sidecar agentico (12 settembre 2026)

Questa decisione sostituisce il piano precedente, descritto piu' sotto.

Memoria, router e animazioni vivono dentro Electron e Node. Non c'e' nessun
processo esterno da installare, aggiornare o far combaciare con il resto. Il
codice sotto `src/` e' tutto quello che gira.

Il motivo e' che la parte davvero difficile di questo progetto non era il loop
agentico. Era far sembrare vivo un avatar, e legare le sue animazioni a cio' che
sta accadendo. Un sidecar avrebbe aggiunto un confine di processo proprio nel
punto in cui serve la latenza piu' bassa, in cambio di un'orchestrazione che qui
non serve ancora: il companion esegue azioni discrete e brevi, non catene di
strumenti lunghe.

Conseguenza accettata: se un giorno servisse una vera autonomia con
pianificazione a piu' passi, quel pezzo andra' costruito o reintrodotto.

### Perche' il router multi-provider resta

Con il sidecar sarebbe stato ridondante. Senza, e' il cuore del progetto: un
punto solo dove si aggiunge un provider, e un contratto di risposta unico che
tutti devono rispettare. Vincolare quel contratto lato API, invece che sperarlo
dal prompt, e' quello che rende affidabile il resto.

### Il formato della risposta e' un contratto, non una speranza

L'avatar reagisce a un campo `action.animation`. Se il modello risponde in prosa
il companion resta immobile e sembra rotto. Per questo lo schema viene imposto
dove l'API lo consente, e il parser di recupero esiste solo per i provider che
non lo permettono.

## Storia: il piano con sidecar, abbandonato

Conservato perche' spiega perche' oggi non c'e' un sidecar, e perche' l'errore
non venga rifatto.

Il piano iniziale era appoggiarsi a un framework agentico maturo come motore
conversazionale, e limitare lo sviluppo custom ad avatar, animazioni, azioni OS
e persona. Sono stati valutati OpenClaw e Hermes Agent.

OpenClaw e' stato scartato subito: richiede WSL2 obbligatoriamente, e
l'installazione si e' fermata sull'errore del gateway. Sulla macchina di allora,
un portatile con 4 GB di RAM, aggiungere un layer Linux virtualizzato sopra
Windows significava swap su disco a prescindere dalla qualita' del software.

Hermes Agent era stato scelto al suo posto perche' gira nativo su Windows. Poi
la decisione e' cambiata del tutto, per i motivi scritti sopra, e anche perche'
bundlare un agente di terzi significa ereditarne la roadmap e i breaking change.

Il vincolo hardware originale non e' piu' quello di sviluppo, ma il principio
resta valido: l'app deve poter girare anche su macchine modeste.

## Riferimenti studiati

AIRI, Open-LLM-VTuber, Mate Engine, Shimeji-ee per il comportamento dell'avatar
sul desktop. companion-emergence per il modello di memoria che sfuma. Sono
stati letti come riferimento: nessuna riga del loro codice e' nel progetto.

## Rischi aperti

La superficie delle azioni OS e' ristretta oggi, ma ogni nuova azione la allarga.
Ogni aggiunta va valutata con la stessa diffidenza di `run-command`.

Le pose 3D sono procedurali e scritte a mano. Reggono per i movimenti semplici;
per qualcosa di piu' espressivo servira' un vero sistema di clip.

La memoria decide da sola cosa vale la pena ricordare, tramite un riassunto
generato da un modello. Se quel riassunto deriva, il companion deriva con lui, e
non c'e' ancora modo di accorgersene se non leggendo l'archivio.

## Prossimi passi

Vivere con il companion abbastanza a lungo da vedere se la memoria produce
continuita' vera o solo un riassunto che invecchia male.

Fatti a settembre 2026:
- umore con emivite, ispirato a companion-emergence, e gesti a riposo;
- clic attraverso i pixel trasparenti, presa in braccio e sguardo verso il
  mouse;
- clip 3D in un solo formato (.vrma);
- movimenti nuovi generati da Kimodo in locale, dopo una richiesta in chat
  (facoltativo).

La roadmap decisa il 28 settembre 2026 prosegue, in ordine, con:
- seduta su finestre e taskbar;
- modalita' stanza con scene 3D e camera libera;
- voce;
- Live2D;
- tocchi e ballo;
- persone con relazione che cresce e cala;
- sensi e strumenti;
- piu' companion insieme.

La memoria leggibile e correggibile dall'utente, che risponde al rischio del
riassunto che deriva, fa parte delle persone.
