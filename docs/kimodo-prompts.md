# Clip Kimodo per il companion

Le clip si generano sulla demo di Kimodo su Hugging Face
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
- Sul posto: la camminata la fa la finestra, e l'import toglie comunque lo
  spostamento orizzontale del bacino.

## Prima serie

| Gesto | Fase | Durata | Prompt | File |
|---|---|---|---|---|
| A riposo | ciclo | 6 s | A person stands relaxed, breathing slowly, shifting weight slightly from one foot to the other, arms loose at the sides. | `idle-respiro.bvh` |
| A riposo | ciclo | 6 s | A person stands still and looks around curiously to the left and to the right, then back to the front. | `idle-guarda.bvh` |
| A riposo | ciclo | 5 s | A person stands with hands clasped behind the back, rocking gently on the heels. | `idle-talloni.bvh` |
| Si stiracchia | gesto | 4 s | A person raises both arms above the head and stretches, leaning back a little, then lowers the arms. | `stretch.bvh` |
| Sbadiglio | gesto | 3 s | A person yawns, covering the mouth with the right hand, then lowers the hand. | `yawn.bvh` |
| Seduto a terra | entrata | 6 s | *(fatta: `output.bvh`, a terra con le braccia attorno alle ginocchia)* | `sit-enter-kimodo.bvh` |
| Seduto a terra | ciclo | 6 s | A person sits on the floor hugging their knees, breathing slowly and swaying slightly. | `sit-ginocchia.bvh` |
| Seduto a terra | uscita | 4 s | A person sitting on the floor hugging their knees stands up. | `sit-exit-alzati.bvh` |
| Seduto sul bordo | entrata | 3 s | A person sits down on a high ledge, legs hanging down in front. | `sit-edge-enter.bvh` |
| Seduto sul bordo | ciclo | 6 s | A person sits on a high ledge swinging the legs back and forth, hands resting on the ledge. | `sit-edge-dondola.bvh` |
| Seduto sul bordo | uscita | 3 s | A person sitting on a high ledge hops down and stands. | `sit-edge-exit.bvh` |
| In braccio | ciclo | 4 s | A person is lifted off the ground by the waist, legs dangling and swinging loosely, arms slightly raised. | `dangle.bvh` |
| Saluto | gesto | 3 s | A person waves hello with the right hand, smiling. | `wave.bvh` |
| Contento | gesto | 3 s | A person jumps slightly and raises both fists happily. | `happy.bvh` |
| Pensa | gesto | 4 s | A person puts a hand on the chin and thinks, tilting the head. | `think.bvh` |
| Sonnecchia | ciclo | 6 s | A person stands dozing off, head slowly dropping forward and jerking back up. | `doze.bvh` |
| Camminata | ciclo | 2 s | A person walks forward in place at a relaxed pace. | `walk-to.bvh` |
| Corsa | ciclo | 2 s | A person jogs forward in place. | `run-to.bvh` |
| Balla | ciclo | 6 s | A person dances happily, bouncing to the beat and swinging the arms. | `dance-allegro.bvh` |
| Balla | ciclo | 6 s | A person does a slow, relaxed sway dance. | `dance-lento.bvh` |

## Controllo dopo l'import

- Il gesto parte da solo appena importato: guardare la posa di partenza e
  quella finale.
- Una clip in ciclo che "salta" alla ripartenza va rigenerata, o importata
  come gesto singolo.
- Le clip che si vogliono pubblicare vanno copiate in `modelli-3d/animations/`
  (le integrate), con il credito a NVIDIA in `ASSETS-LICENSE.md`. Prima di
  pubblicare si confermano i termini sulle uscite di Kimodo.
