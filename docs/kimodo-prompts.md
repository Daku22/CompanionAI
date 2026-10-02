# Clip Kimodo per il companion

**In locale (consigliato).** Con kimodo.cpp installato
([kimodo-locale.md](kimodo-locale.md)) tutta la serie si genera con un
comando, in circa 5 minuti, già in .vrma e con i nomi giusti:

```
npm run kimodo -- --series scripts/kimodo-series.json --out private-assets/animations --keep-raw
```

I prompt stanno in `scripts/kimodo-series.json`; la tabella qui sotto li
riporta. In locale entrata, ciclo e uscita dello stesso gesto escono da una
sola richiesta, e i cicli si tagliano e si chiudono da soli.

**Dalla demo.** Le clip si generano anche sulla demo di Kimodo su Hugging Face
(`huggingface.co/spaces/nvidia/Kimodo`), con un modello **SOMA** (licenza
NVIDIA Open Model License, uso commerciale permesso; mai SMPL-X), e si
esportano in **BVH**. L'NPZ non serve.

Poi, nell'app: tasto destro sull'avatar → Animazioni → Importa animazione. Si
sceglie il gesto e, per i gesti che durano finché non arriva altro, la fase.
Se si dà al file il nome della colonna "File", l'app propone da sola gesto e
fase.

## Come scrivere i prompt

- In inglese, in terza persona, con un solo gesto per prompt: "A person
  slowly sits down on the floor and hugs their knees."
- **Clip in ciclo** (fase *ciclo*): chiedere un movimento che finisca nella
  posa da cui parte ("...and returns to the starting pose", oppure un gesto
  piccolo e ripetuto). Durata 4–6 s.
- **Clip di passaggio** (*entrata*, *uscita*): partire da in piedi, o dalla
  posa seduta, e fermarsi nella posa finale. Durata 3–6 s.
- La camminata la fa la finestra: l'import toglie lo spostamento orizzontale
  del bacino, quindi "walks forward" va bene (e viene più naturale di "in
  place").
- Kimodo muove solo il corpo e non vede oggetti: "seduto su un ripiano alto"
  lo fa sedere a terra. Per il bordo si chiede una sedia: la posa (cosce
  orizzontali, gambe giù) è la stessa, e il bordo lo mette la finestra.
- Per lo stesso motivo non si stacca da terra: "sollevato" lo fa accovacciare,
  "fluttua" lo sdraia, "appeso a una sbarra" lo mette in verticale sulle mani.
  "In braccio" è in punta di piedi con le braccia in alto: con la finestra
  tenuta dal mouse sembra appeso.
- La clip `output.bvh` della demo (seduta a terra) resta nei test come
  `scripts/fixtures/kimodo-soma77-sit.bvh`.

## Prima serie

| Gesto | Fase | Durata | Prompt | File |
|---|---|---|---|---|
| A riposo | ciclo | 6 s | A person stands relaxed, breathing slowly, shifting weight slightly from one foot to the other, arms loose at the sides. | `idle-respiro.bvh` |
| A riposo | ciclo | 6 s | A person stands still and looks around curiously to the left and to the right, then back to the front. | `idle-guarda.bvh` |
| A riposo | ciclo | 5 s | A person stands with hands clasped behind the back, rocking gently on the heels. | `idle-talloni.bvh` |
| Si stiracchia | gesto | 4 s | A person raises both arms above the head and stretches, leaning back a little, then lowers the arms. | `stretch.bvh` |
| Sbadiglio | gesto | 3 s | A person yawns, covering the mouth with the right hand, then lowers the hand. | `yawn.bvh` |
| Seduto a terra | entrata | 5 s | A person slowly sits down on the floor and hugs their knees. | `sit-enter-terra.bvh` |
| Seduto a terra | ciclo | 6 s | A person sits on the floor hugging their knees, breathing slowly and swaying slightly. | `sit-ginocchia.bvh` |
| Seduto a terra | uscita | 4 s | A person sitting on the floor hugging their knees stands up. | `sit-exit-alzati.bvh` |
| Seduto sul bordo | entrata | 3 s | A person sits down on a chair, hands resting on the thighs. | `sit-edge-enter.bvh` |
| Seduto sul bordo | ciclo | 6 s | A person sits on a chair, relaxed, gently swinging the lower legs back and forth. | `sit-edge-dondola.bvh` |
| Seduto sul bordo | uscita | 3 s | A person sitting on a chair stands up. | `sit-edge-exit.bvh` |
| In braccio | ciclo | 4 s | A person stands on tiptoe with both arms raised overhead, legs relaxed, swaying gently. | `dangle.bvh` |
| Saluto | gesto | 3 s | A person waves hello with the right hand, smiling. | `wave.bvh` |
| Contento | gesto | 3 s | A person jumps slightly and raises both fists happily. | `happy.bvh` |
| Pensa | gesto | 4 s | A person puts a hand on the chin and thinks, tilting the head. | `think.bvh` |
| Sonnecchia | ciclo | 6 s | A person stands dozing off, head slowly dropping forward and jerking back up. | `doze.bvh` |
| Camminata | ciclo | 4 s | A person walks forward at a relaxed pace. | `walk-to.bvh` |
| Corsa | ciclo | 4 s | A person jogs forward. | `run-to.bvh` |
| Balla | ciclo | 6 s | A person dances happily, bouncing to the beat and swinging the arms. | `dance-allegro.bvh` |
| Balla | ciclo | 6 s | A person does a slow, relaxed sway dance. | `dance-lento.bvh` |

## Reazioni ai tocchi (Blocco 5b)

Gesti brevi, da generare nella serie privata. Senza clip vale il ripiego
procedurale di `vrm-animation.js`.

| Gesto | Fase | Durata | Prompt | File |
|---|---|---|---|---|
| Carezza | gesto | 2 s | A person tilts the head to one side and lowers the shoulders, relaxed, as if enjoying a pat on the head. | `pat.bvh` |
| Sussulto | gesto | 1 s | A person flinches, pulling the head back quickly, then relaxes. | `flinch.bvh` |
| Risatina | gesto | 2 s | A person giggles, bending forward slightly with both hands on the belly. | `giggle.bvh` |
| Saltello | gesto | 1 s | A person does a small hop in place. | `hop.bvh` |
| Imbarazzo | gesto | 2 s | A person looks away shyly, hands together in front of the body, taking a small step back. | `shy.bvh` |
| Rimprovero | gesto | 3 s | A person crosses the arms and shakes the head disapprovingly. | `scold.bvh` |
| Si gira di spalle | gesto | 5 s | A person turns around, stands with the back to the viewer with arms crossed, then turns back. | `turnaway.bvh` |

Nota per `turnaway`: il ripiego procedurale gira tutto il corpo da se'
(`yaw` della clip). Una clip che si gira gia' da sola si somma a quel giro:
se la si importa, va controllata.

## Controllo dopo l'import

- Il gesto parte da solo appena importato: guardare la posa di partenza e
  quella finale.
- Una clip in ciclo che "salta" alla ripartenza va rigenerata, o importata
  come gesto singolo.
- Le clip che si vogliono pubblicare vanno copiate in `modelli-3d/animations/`
  (le integrate), con il credito a NVIDIA in `ASSETS-LICENSE.md`. Prima di
  pubblicare si confermano i termini sulle uscite di Kimodo.
