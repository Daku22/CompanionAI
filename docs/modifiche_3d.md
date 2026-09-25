# Log Modifiche Implementazione 3D

## Modifiche apportate
1.  **Architettura Rendering:**
    *   Introdotto un secondo contenitore (`#three-mount`) per il rendering WebGL (Three.js).
    *   Implementata logica di switch tra PixiJS (2D) e Three.js (3D) tramite manipolazione CSS (`display: none/block`) e gestione del ticker.
2.  **Protocollo Asset (vrm://):**
    *   Registrato un protocollo personalizzato in `main.js` per servire i file `.vrm` dalla cartella `modelli-3d/` in modo sicuro e performante.
    *   Implementata validazione dei percorsi per prevenire accessi arbitrari al filesystem.
3.  **UI Switcher:**
    *   Aggiunta interfaccia di switch rapido nel companion per alternare fra gli avatar. Oggi il menu
        è generato dall'elenco degli avatar integrati e importati; Dust e Neko non fanno più parte
        dell'app pubblica (licenze non ridistribuibili, vedi ASSETS-LICENSE.md).
    *   Persistenza della configurazione del modello selezionato tramite `api.setConfig()`.
4.  **Animazioni (aggiornato il 13 settembre 2026):**
    *   Prima c'erano solo respiro e battito di ciglia, e la posa di riposo
        veniva riapplicata a ogni frame: nessun movimento del corpo era
        possibile, quindi scegliere un avatar 3D disattivava in silenzio le
        animazioni contestuali.
    *   Aggiunto un livello di pose procedurali con fusione in entrata e
        uscita, una clip per ogni animazione del contratto AI, e
        l'orientamento verso la direzione di marcia. Le clip stanno nella
        tabella `CLIPS` di `src/renderer/vrm-animation.js`,
        separata dall'HTML per poterla testare da Node.

## Possibili Miglioramenti Futuri

1.  **Taratura delle pose:** i valori in `CLIPS` sono stati scritti senza poter
    guardare il risultato a schermo. Vanno ritoccati a occhio nell'app.
2.  **Eye Tracking:** usare `vrm.lookAt` per far seguire il cursore agli occhi.
    Il bersaglio e' gia' impostato sulla camera.
3.  **Gestione Asset:** cache dei modelli VRM, oggi riletti a ogni cambio.

Gia' risolti rispetto alla stesura originale: il rendering non spreca piu'
risorse in parallelo (il ticker Pixi si ferma e il loop 3D esce subito quando il
mount e' nascosto), e la validazione dei percorsi nel protocollo `vrm://`
respinge tutto cio' che esce da `modelli-3d/`.
