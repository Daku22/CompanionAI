// test-mcp-remote.js — connettori remoti (Blocco 7f): il client HTTP
// (src/main/mcp-http.js) e il login OAuth (src/main/mcp-oauth.js), contro un
// servizio finto su 127.0.0.1 con server MCP, accesso, registrazione dell'app,
// PKCE e rinnovo del token.

const assert = require('node:assert/strict')
const crypto = require('crypto')
const http = require('http')
const { HttpMcpClient, AuthRequiredError, parseSse, validUrl } = require('../src/main/mcp-http')
const O = require('../src/main/mcp-oauth')
const { CONNECTORS, catalog } = require('../src/main/connectors')

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

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Il servizio finto. valid: i token accettati in quel momento. */
function fakeService() {
  const state = { valid: new Set(), challenges: new Map(), registered: [], sessions: new Set() }
  const server = http.createServer(async (req, res) => {
    const origin = 'http://127.0.0.1:' + server.address().port
    const u = new URL(req.url, origin)
    let body = ''
    for await (const chunk of req) body += chunk
    const json = (code, data, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(data)) }
    if (u.pathname === '/.well-known/oauth-protected-resource/mcp') return json(200, { resource: origin + '/mcp', authorization_servers: [origin + '/as'], scopes_supported: ['read'] })
    if (u.pathname === '/.well-known/oauth-authorization-server/as') {
      return json(200, { issuer: origin + '/as', authorization_endpoint: origin + '/as/authorize', token_endpoint: origin + '/as/token', registration_endpoint: origin + '/as/register', code_challenge_methods_supported: ['S256'] })
    }
    if (u.pathname === '/as/register') {
      const reg = JSON.parse(body)
      state.registered.push(reg)
      return json(201, { client_id: 'cid-' + state.registered.length, redirect_uris: reg.redirect_uris })
    }
    if (u.pathname === '/as/authorize') {
      const p = u.searchParams
      if (p.get('code_challenge_method') !== 'S256' || p.get('resource') !== origin + '/mcp' || p.get('scope') !== 'read') return json(400, { error: 'bad_request' })
      state.challenges.set('code-1', p.get('code_challenge'))
      res.writeHead(302, { location: p.get('redirect_uri') + '?code=code-1&state=' + encodeURIComponent(p.get('state')) })
      return res.end()
    }
    if (u.pathname === '/as/token') {
      const f = new URLSearchParams(body)
      if (f.get('grant_type') === 'authorization_code') {
        const ok = f.get('code') === 'code-1' && b64url(crypto.createHash('sha256').update(f.get('code_verifier')).digest()) === state.challenges.get('code-1')
        if (!ok) return json(400, { error: 'invalid_grant' })
        state.valid.add('tok-1')
        return json(200, { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 3600, token_type: 'Bearer' })
      }
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 'ref-1') {
        state.valid.add('tok-2')
        return json(200, { access_token: 'tok-2', expires_in: 3600, token_type: 'Bearer' })
      }
      return json(400, { error: 'invalid_grant' })
    }
    if (u.pathname === '/mcp') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '')
      if (!state.valid.has(token)) {
        res.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource/mcp"' })
        return res.end()
      }
      if (req.method === 'DELETE') { state.sessions.delete(req.headers['mcp-session-id']); res.writeHead(200); return res.end() }
      const m = JSON.parse(body)
      if (m.method === 'initialize') { state.sessions.add('sess-1'); return json(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'finto' } } }, { 'mcp-session-id': 'sess-1' }) }
      if (!state.sessions.has(req.headers['mcp-session-id'])) return json(404, { error: 'sessione' })
      if (m.id === undefined) { res.writeHead(202); return res.end() }
      if (m.method === 'tools/list') {
        // In streaming, con una notifica prima della risposta.
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n')
        return res.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'search', description: 'Cerca', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] } }) + '\n\n')
      }
      if (m.method === 'tools/call') return json(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'trovato: ' + m.params.arguments.q }] } })
      return json(200, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'sconosciuto' } })
    }
    res.writeHead(404); res.end()
  })
  return { server, state }
}

/** Il "browser": apre la pagina di accesso e segue il ritorno a CompanionAI. */
async function fakeBrowser(url) {
  const r = await fetch(url, { redirect: 'manual' })
  const back = r.headers.get('location')
  const page = await fetch(back)
  assert.match(await page.text(), /Fatto!/)
}

async function main() {
  console.log('=== Connettori remoti ===')

  await test('flussi SSE, indirizzi ammessi, dove cercare i metadati', () => {
    assert.deepEqual(parseSse('event: message\ndata: {"a":1}\n\n: commento\n\ndata: {"b":\ndata: 2}\n\ndata: rotto\n\n'), [{ a: 1 }, { b: 2 }])
    assert.ok(validUrl('https://mcp.notion.com/mcp') && validUrl('http://127.0.0.1:3000/mcp'))
    assert.ok(!validUrl('http://esempio.com/mcp') && !validUrl('file:///C:/x') && !validUrl('nonunurl'))
    assert.deepEqual(O.resourceMetadataUrls('https://a.com/v1/mcp/'), ['https://a.com/.well-known/oauth-protected-resource/v1/mcp', 'https://a.com/.well-known/oauth-protected-resource'])
    assert.equal(O.authServerMetadataUrls('https://a.com/as')[0], 'https://a.com/.well-known/oauth-authorization-server/as')
    assert.equal(O.resourceMetadataFrom('Bearer realm="x", resource_metadata="https://a.com/m"'), 'https://a.com/m')
    const { verifier, challenge } = O.pkcePair()
    assert.equal(challenge, b64url(crypto.createHash('sha256').update(verifier).digest()))
  })

  await test('catalogo: indirizzi validi, id unici, i gia\' aggiunti segnati', () => {
    assert.equal(new Set(CONNECTORS.map(c => c.id)).size, CONNECTORS.length)
    for (const c of CONNECTORS) {
      assert.ok(validUrl(c.url) && c.url.startsWith('https://'), c.id)
      assert.ok(['none', 'oauth', 'token'].includes(c.auth) && c.description, c.id)
      if (c.auth === 'token') assert.ok(c.tokenUrl && c.tokenHelp, c.id)
    }
    assert.ok(!CONNECTORS.some(c => /paypal|square|stripe/i.test(c.url)), 'niente connettori che muovono soldi')
    assert.equal(catalog([{ url: CONNECTORS[0].url }])[0].added, true)
  })

  const { server, state } = fakeService()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port + '/mcp'
  let saved = null

  await test('senza accesso: 401 diventa "serve l\'accesso", con dove farlo', async () => {
    const client = new HttpMcpClient({ url })
    const err = await client.listTools().catch(e => e)
    assert.ok(err instanceof AuthRequiredError)
    assert.match(err.wwwAuthenticate, /resource_metadata=/)
  })

  await test('login: scoperta, registrazione dell\'app, PKCE, ritorno dal browser, token', async () => {
    const www = 'Bearer resource_metadata="' + url.replace('/mcp', '/.well-known/oauth-protected-resource/mcp') + '"'
    const { tokens, client, meta } = await O.login(url, www, fakeBrowser)
    assert.equal(tokens.access_token, 'tok-1')
    assert.equal(tokens.refresh_token, 'ref-1')
    assert.ok(tokens.expires_at > Date.now())
    assert.equal(client.client_id, 'cid-1')
    assert.match(state.registered[0].redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    assert.equal(state.registered[0].token_endpoint_auth_method, 'none')
    saved = { ...tokens, token_endpoint: meta.token_endpoint, client_id: client.client_id }
  })

  await test('con il token: sessione, elenco in streaming, chiamata, chiusura', async () => {
    const client = new HttpMcpClient({ url }, { token: () => saved.access_token })
    const tools = await client.listTools()
    assert.deepEqual(tools.map(t => t.name), ['search'])
    const r = await client.callTool('search', { q: 'gatti' })
    assert.equal(r.content[0].text, 'trovato: gatti')
    client.stop()
    await new Promise(res => setTimeout(res, 200))
    assert.equal(state.sessions.size, 0, 'la sessione si chiude sul server')
  })

  await test('token scaduto o revocato: si rinnova con il refresh token', async () => {
    state.valid.delete('tok-1')
    const client = new HttpMcpClient({ url }, { token: () => saved.access_token })
    assert.ok((await client.listTools().catch(e => e)) instanceof AuthRequiredError)
    const tokens = await O.refresh(saved, url)
    assert.equal(tokens.access_token, 'tok-2')
    assert.equal(tokens.refresh_token, 'ref-1', 'il refresh token resta se non ne arriva uno nuovo')
    saved = { ...saved, ...tokens }
    assert.deepEqual((await client.listTools()).map(t => t.name), ['search'])
    assert.equal(O.expired({ expires_at: Date.now() + 30000 }), true, 'un minuto di margine')
    assert.equal(O.expired({ expires_at: Date.now() + 3600000 }), false)
  })

  await test('accesso annullato nel browser: errore chiaro, nessun token', async () => {
    const www = 'Bearer resource_metadata="' + url.replace('/mcp', '/.well-known/oauth-protected-resource/mcp') + '"'
    const deny = async (authUrl) => {
      const p = new URL(authUrl).searchParams
      await fetch(p.get('redirect_uri') + '?error=access_denied&state=' + encodeURIComponent(p.get('state')))
    }
    await assert.rejects(() => O.login(url, www, deny), /access_denied/)
  })

  server.close()
  console.log(`=== ${passed} test superati ===`)
}

main()
