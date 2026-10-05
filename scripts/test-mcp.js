// test-mcp.js — strumenti MCP (src/main/mcp.js): regole pure e il client stdio
// contro un server finto, un processo Node vero.

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const M = require('../src/main/mcp')

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}

const READ = { name: 'read_file', description: 'Legge un file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, max: { type: 'integer' } }, required: ['path'] } }
const WRITE = { name: 'write_file', description: 'Scrive un file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }
const server = (over = {}) => M.cleanServers([{ id: 'files', name: 'File', command: 'node', args: ['x.js'], enabled: true, tools: [READ, WRITE], allowed: ['read_file'], ...over }])

// Un server MCP finto: initialize, tools/list (in due pagine), tools/call, e un ping al client.
const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') { send({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' }); send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'finto' } } }) }
  else if (m.method === 'tools/list' && !m.params.cursor) send({ jsonrpc: '2.0', id: m.id, result: { tools: [${JSON.stringify(READ)}], nextCursor: 'p2' } })
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [${JSON.stringify(WRITE)}] } })
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'letto: ' + m.params.arguments.path }] } })
  else if (m.id === 'srv-1') process.stderr.write('pong ricevuto\\n')
})
`

async function main() {
  console.log('=== Strumenti MCP ===')

  await test('config: server e strumenti controllati, spuntati solo quelli esistenti', () => {
    const s = M.cleanServers([
      { id: 'Files!', command: 'node' },
      { id: 'ok', command: '  ', name: 'x' },
      { id: 'files', name: 'File', command: 'node', args: ['a', 3], env: { TOKEN: 'x', 'bad key': 'y' }, tools: [READ, { name: 'bad name!' }], allowed: ['read_file', 'inventato'] },
      { id: 'files', command: 'doppio' },
    ])
    assert.equal(s.length, 1)
    assert.deepEqual(s[0].args, ['a'])
    assert.deepEqual(s[0].env, { TOKEN: 'x' })
    assert.deepEqual(s[0].tools.map(t => t.name), ['read_file'])
    assert.deepEqual(s[0].allowed, ['read_file'])
    assert.equal(s[0].enabled, false, 'spento di base')
  })

  await test('prompt: solo strumenti spuntati di server accesi', () => {
    const p = M.toolsPrompt(server())
    assert.ok(p.includes('"read_file"') && p.includes('path (string, obbligatorio)'))
    assert.ok(!p.includes('write_file'))
    assert.equal(M.toolsPrompt(server({ enabled: false })), '')
    assert.equal(M.toolsPrompt([]), '')
  })

  await test('azione: server, strumento e argomenti controllati', () => {
    const s = server()
    const ok = M.checkToolAction({ type: 'tool', server: 'files', tool: 'read_file', args: { path: 'a.txt', max: 3 } }, s)
    assert.equal(ok.tool.name, 'read_file')
    const err = (a) => M.checkToolAction({ type: 'tool', server: 'files', tool: 'read_file', ...a }, s).error
    assert.equal(M.checkToolAction({ type: 'tool', server: 'altro', tool: 'read_file', args: { path: 'a' } }, s).server.id, 'files', 'server sbagliato, strumento unico: vale il suo')
    assert.match(err({ server: 'altro', tool: 'boh' }), /server non ammesso/)
    assert.match(M.errorPrompt('manca l\'argomento path'), /Correggila/)
    const enumTool = { name: 'search', inputSchema: { type: 'object', properties: { order: { type: 'string', enum: ['relevance', 'modified_descending'] } } } }
    assert.match(M.toolsPrompt(M.cleanServers([{ id: 'c', name: 'C', url: 'https://c.com/mcp', enabled: true, tools: [enumTool], allowed: ['search'] }])), /uno tra: "relevance" "modified_descending"/)
    assert.match(err({ tool: 'write_file', args: { path: 'a' } }), /non ammesso/, 'non spuntato')
    assert.match(err({ args: {} }), /manca l'argomento path/)
    assert.match(err({ args: { path: 3 } }), /tipo sbagliato/)
    assert.match(err({ args: { path: 'a', max: 1.5 } }), /tipo sbagliato/)
    assert.match(err({ args: ['a'] }), /non validi/)
    assert.match(err({ args: { path: 'x'.repeat(5000) } }), /troppo lunghi/)
    assert.match(M.checkToolAction({ type: 'tool', server: 'files', tool: 'read_file', args: { path: 'a' } }, server({ enabled: false })).error, /server non ammesso/)
  })

  await test('risultato: testo, errori e contenuti non testuali, tagliato', () => {
    assert.equal(M.resultText({ content: [{ type: 'text', text: 'ciao' }, { type: 'image', data: 'x' }] }), 'ciao\n[contenuto image]')
    assert.equal(M.resultText({ isError: true, content: [{ type: 'text', text: 'no' }] }), 'ERRORE: no')
    assert.equal(M.resultText(null), '(nessun risultato)')
    assert.equal(M.resultText({ content: [{ type: 'text', text: 'x'.repeat(9000) }] }).length, M.MAX_RESULT + 1)
    assert.ok(M.resultPrompt('files', 'read_file', 'ok').includes('chiama un altro strumento'))
  })

  await test('a parole semplici: nomi, "legge" o "modifica", argomenti leggibili', () => {
    assert.equal(M.toolLabel('read_text_file'), 'leggere un file di testo')
    assert.equal(M.toolLabel('getWeatherNow'), 'Get weather now')
    assert.equal(M.argsText({ path: 'C:\\a\\b.txt', depth: 2 }), 'path: C:\\a\\b.txt\ndepth: 2')
    assert.equal(M.argsText({}), '(nessun argomento)')
    const s = M.cleanServers([{ id: 'f', command: 'npx', enabled: true,
      tools: [{ name: 'read_file' }, { name: 'write_file' }, { name: 'leggi', annotations: { readOnlyHint: true } }, { name: 'guarda', annotations: { destructiveHint: true } }],
      allowed: ['read_file', 'write_file', 'leggi'], trusted: ['read_file', 'write_file', 'guarda', 'nessuno'] }])
    assert.deepEqual(s[0].tools.map(t => t.readOnly), [true, false, true, false])
    // "Non chiedere piu'" solo per chi legge soltanto, ed e' ammesso.
    assert.deepEqual(s[0].trusted, ['read_file'])
  })

  await test('strumento pronto: i file di una cartella', () => {
    const f = M.filesServer('C:\\Users\\Tu\\Documents\\prova\\')
    assert.equal(f.name, 'File: prova')
    assert.equal(f.command, 'npx')
    assert.deepEqual(f.args.slice(0, 2), ['-y', '@modelcontextprotocol/server-filesystem'])
  })

  await test('client stdio con un server vero: initialize, tools/list a pagine, tools/call, chiusura', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'))
    const file = path.join(dir, 'server.js')
    fs.writeFileSync(file, FAKE)
    const client = new M.McpClient({ id: 'finto', command: process.execPath, args: [file], env: {} })
    try {
      const tools = await client.listTools()
      assert.deepEqual(tools.map(t => t.name), ['read_file', 'write_file'])
      assert.deepEqual(tools[0].schema.required, ['path'])
      const r = await client.callTool('read_file', { path: 'a.txt' })
      assert.equal(M.resultText(r), 'letto: a.txt')
    } finally {
      client.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await test('client: un comando che non esiste da\' un errore, non resta appeso', async () => {
    const client = new M.McpClient({ id: 'x', command: path.join(os.tmpdir(), 'non-esiste-mcp.exe'), args: [], env: {} })
    await assert.rejects(() => client.listTools(), /non parte|chiuso/)
    client.stop()
  })

  console.log(`=== ${passed} test superati ===`)
}

main()
