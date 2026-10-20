// ghost.js — l'icona del cibo trascinato (Blocco 10b). L'id arriva
// nell'indirizzo (?id=), l'icona da vrm://food/icons/.
const id = new URLSearchParams(location.search).get('id') || ''
if (/^[a-z0-9-]{1,32}$/.test(id)) document.getElementById('item').src = 'vrm://food/icons/' + id + '.png'
