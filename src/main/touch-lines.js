// touch-lines.js — le battute dei tocchi (touch-react.js), tutte qui per
// rivederle in un colpo solo. Niente modello e niente rete: sono locali.
//
// Regole del tono: imbarazzo e rimprovero, mai niente di allusivo. Nessun
// genere, ne' per il companion ne' per l'utente ("che bello", non "sono
// contenta"). Corte: stanno in un fumetto.

const LINES = {
  pat: ['Mmh… che bello.', "Ancora un po'?", 'Mi piace quando fai così.', '♪'],
  headTap: ['Ehi!', 'Toc toc, chi è?', 'Sono qui!'],
  face: ['Ehi, il naso!', 'Ah! Mi hai colto di sorpresa.', 'Occhio agli occhi!'],
  tickle: ['Ih ih, soffro il solletico!', 'Fa il solletico!', 'Ahah, basta… no, dai, ancora!'],
  hand: ['Ciao anche a te!', 'Mi tieni la mano?', 'Eccomi.'],
  legs: ['Oplà!', 'Ehi, così mi fai cadere!', 'Hop!'],
  shy: ['Ehm… lì no.', 'Ehi… un po’ di rispetto.', 'Mh… non è il posto giusto.'],
  scold: ['Ti ho detto di no.', 'Smettila, dai.', 'Basta, per favore.', 'Così non mi piace.'],
  turnaway: ['Hmpf. Non ti guardo.', 'Adesso mi giro, così impari.', 'Non ti parlo. Per un po’.'],
  spamGiggle: ['Ahah, quanti clic!', 'Calma, calma!'],
  spamScold: ['Ok, ok, basta clic.', 'Mi gira la testa…'],
}

module.exports = { LINES }
