// ghost.js — l'icona del cibo o dell'oggetto trascinato (Blocchi 10b e 10c).
// L'icona arriva nell'indirizzo (?src=): solo quelle del cibo e degli oggetti
// inclusi (vrm://) o le miniature degli oggetti importati (object://thumbs/).
const ICON = /^(vrm:\/\/(food|objects)\/icons\/[a-z0-9-]{1,64}\.png|object:\/\/thumbs\/[0-9a-f]{32}\.png(\?v=\d+)?)$/
const src = new URLSearchParams(location.search).get('src') || ''
if (ICON.test(src)) document.getElementById('item').src = src
