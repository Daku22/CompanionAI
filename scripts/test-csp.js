// test-csp.js — verifica la Content Security Policy delle pagine del renderer.
//
// La CSP blocca qualunque script che non sia un file del progetto. Si rompe in
// silenzio in due modi: qualcuno aggiunge uno script inline (che la CSP poi
// blocca, e la pagina smette di funzionare solo nell'app), oppure l'importmap
// cambia e il suo hash non corrisponde piu'. Qui si controllano entrambi.

const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'src', 'renderer')
const PAGES = ['companion.html', 'chat.html', 'settings.html']

let passed = 0
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(DIR, page), 'utf8')
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
  assert.ok(meta, page + ': manca la Content-Security-Policy')
  const policy = Object.fromEntries(meta[1].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))

  assert.deepEqual(policy['default-src'], ["'none'"], page + ': default-src deve essere none')
  const scriptSrc = policy['script-src'] || []
  assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"),
    page + ': script-src non deve ammettere unsafe-inline o unsafe-eval')
  assert.ok(!scriptSrc.some(s => /^https?:|^\*/.test(s)), page + ': nessuno script da rete')

  // Gli script inline ammessi sono solo quelli con un hash nella policy.
  const hashes = scriptSrc.filter(s => s.startsWith("'sha256-")).map(s => s.slice(8, -1))
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = m
    if (/\bsrc=/.test(attrs)) continue
    const hash = crypto.createHash('sha256').update(body, 'utf8').digest('base64')
    assert.ok(hashes.includes(hash),
      page + ': script inline senza hash nella CSP (' + attrs.trim() + '). Metti in script-src: \'sha256-' + hash + '\'')
  }
  assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')),
    page + ': gestori inline (onclick=...) bloccati dalla CSP: usa addEventListener')

  // Ogni file caricato con src deve esistere, o la pagina si rompe solo nell'app.
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    const file = path.join(DIR, m[1])
    const generated = m[1].startsWith('vendor/')
    assert.ok(generated || fs.existsSync(file), page + ': script mancante ' + m[1])
  }
  passed++
}
console.log('=== CSP: ' + passed + ' pagine verificate ===')

// Sintassi degli script delle pagine: un errore li' si vedeva solo aprendo
// l'app (la pagina restava senza avatar), mai nei test.
const { execFileSync } = require('child_process')
let checked = 0
for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', path.join(DIR, file)], { stdio: 'pipe' })
    checked++
  } catch (err) {
    console.error('  FALLITO  sintassi di ' + file + '\n' + String(err.stderr || err.message))
    process.exitCode = 1
  }
}
console.log('=== Sintassi: ' + checked + ' script del renderer ===')
