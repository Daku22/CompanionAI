// test-captions.js — i sottotitoli nel fumetto (src/renderer/captions.js, Blocco 11b),
// caricato in Node con una pagina finta: come si divide una frase lunga.
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const window = { innerWidth: 180 }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'captions.js'), 'utf8'), { window, document: {}, setTimeout, clearTimeout })
const parts = (text, max) => JSON.parse(JSON.stringify(window.CompanionCaption.captionParts(text, max)))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name) }
console.log('=== Sottotitoli ===')

t('una frase corta resta intera', () => {
  assert.deepEqual(parts('Ciao, come stai?', 60), ['Ciao, come stai?'])
  assert.deepEqual(parts('  ', 60), [])
})

t('una frase lunga in pezzi che stanno nel fumetto, senza perdere parole', () => {
  const text = 'Oggi ho pensato tanto a quella storia della barca, sai, quella che voleva vedere il mare aperto e partire verso isole lontane.'
  const p = parts(text, 50)
  assert.ok(p.length >= 3, p.join(' | '))
  assert.ok(p.every(x => x.length <= 50), 'ogni pezzo sta nel fumetto')
  assert.equal(p.join(' '), text, 'nessuna parola persa o spostata')
  assert.ok(p.some(x => x.endsWith(',')), 'dove si puo\' si taglia dopo una virgola')
})

t('una parola piu\' lunga del fumetto non si blocca', () => {
  assert.deepEqual(parts('supercalifragilistichespiralidoso ok', 10), ['supercalifragilistichespiralidoso', 'ok'])
})

console.log('=== ' + passed + ' test superati ===')
