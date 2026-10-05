// mcp-oauth.js — l'accesso ai connettori remoti (Blocco 7f), come lo fa Claude:
// OAuth 2.1 con PKCE, secondo la specifica di autorizzazione MCP.
//
//  1. il server risponde 401: dall'intestazione WWW-Authenticate (o dal
//     percorso noto) si legge chi gestisce l'accesso (RFC 9728) e i suoi
//     indirizzi (RFC 8414);
//  2. l'app si registra da sola presso di lui (registrazione dinamica, RFC 7591);
//  3. il browser apre la pagina di accesso; il ritorno arriva a un piccolo
//     server su 127.0.0.1, solo per quel momento;
//  4. il codice diventa un token, che si rinnova quando scade.
//
// I token li conserva il main, cifrati. Qui nessun segreto finisce nei log.

const crypto = require('crypto')
const http = require('http')

const LOGIN_TIMEOUT_MS = 5 * 60000
const FETCH_TIMEOUT_MS = 10000

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Verificatore e sfida PKCE (S256). */
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32))
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }
}

/** L'indirizzo dei metadati della risorsa, se l'intestazione del 401 lo dice. */
function resourceMetadataFrom(wwwAuthenticate) {
  const m = String(wwwAuthenticate || '').match(/resource_metadata="([^"]+)"/i)
  return m ? m[1] : null
}

/** Dove cercare i metadati della risorsa protetta (RFC 9728): col percorso, poi senza. */
function resourceMetadataUrls(serverUrl) {
  const u = new URL(serverUrl)
  const path = u.pathname.replace(/\/+$/, '')
  return [...new Set([u.origin + '/.well-known/oauth-protected-resource' + path, u.origin + '/.well-known/oauth-protected-resource'])]
}

/** Dove cercare i metadati del server di autorizzazione (RFC 8414 e OpenID), percorso compreso. */
function authServerMetadataUrls(issuer) {
  const u = new URL(issuer)
  const path = u.pathname.replace(/\/+$/, '')
  const list = path
    ? [u.origin + '/.well-known/oauth-authorization-server' + path, u.origin + '/.well-known/openid-configuration' + path, u.origin + path + '/.well-known/openid-configuration']
    : []
  list.push(u.origin + '/.well-known/oauth-authorization-server', u.origin + '/.well-known/openid-configuration')
  return [...new Set(list)]
}

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    return res.ok ? await res.json() : null
  } catch (_) { return null }
}

/**
 * Chi gestisce l'accesso a questo server: i suoi indirizzi e gli scope.
 * @returns {Promise<{ issuer: string, authorization_endpoint: string, token_endpoint: string, registration_endpoint?: string, scopes?: string[] }>}
 */
async function discover(serverUrl, wwwAuthenticate) {
  const hinted = resourceMetadataFrom(wwwAuthenticate)
  let prm = null
  for (const url of [hinted, ...resourceMetadataUrls(serverUrl)].filter(Boolean)) {
    prm = await getJson(url)
    if (prm) break
  }
  const issuer = (prm && Array.isArray(prm.authorization_servers) && prm.authorization_servers[0]) || new URL(serverUrl).origin
  let meta = null
  for (const url of authServerMetadataUrls(issuer)) {
    meta = await getJson(url)
    if (meta && meta.authorization_endpoint && meta.token_endpoint) break
    meta = null
  }
  if (!meta) throw new Error('questo connettore non dice come si accede')
  return {
    issuer,
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    registration_endpoint: meta.registration_endpoint,
    scopes: (prm && Array.isArray(prm.scopes_supported) && prm.scopes_supported) || [],
  }
}

/** Registrazione dinamica dell'app presso il server di autorizzazione (RFC 7591). */
async function register(meta, redirectUri) {
  if (!meta.registration_endpoint) throw new Error('questo servizio non permette di collegare app nuove da sole: serve una chiave')
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'CompanionAI', redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || !body.client_id) throw new Error('registrazione dell\'app rifiutata (' + res.status + ')')
  return { client_id: body.client_id, client_secret: body.client_secret || null }
}

/** L'indirizzo della pagina di accesso. */
function authorizeUrl(meta, { clientId, redirectUri, challenge, state, resource, scopes }) {
  const u = new URL(meta.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', state)
  if (resource) u.searchParams.set('resource', resource)
  if (scopes && scopes.length) u.searchParams.set('scope', scopes.join(' '))
  return u.href
}

/** Una richiesta al token endpoint (codice o rinnovo), con la data di scadenza. */
async function tokenRequest(tokenEndpoint, form) {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(form).filter(([, v]) => v != null))).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || !body.access_token) throw new Error('accesso non riuscito (' + res.status + (body && body.error ? ', ' + body.error : '') + ')')
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || form.refresh_token || null,
    expires_at: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
  }
}

const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>CompanionAI</title><body style="font-family:system-ui;background:#151417;color:#eee;display:grid;place-items:center;height:90vh">' +
  '<div style="text-align:center"><h2>Fatto!</h2><p>Il connettore è collegato: puoi chiudere questa pagina e tornare a CompanionAI.</p></div>'
const FAIL_PAGE = '<!doctype html><meta charset="utf-8"><title>CompanionAI</title><body style="font-family:system-ui;background:#151417;color:#eee;display:grid;place-items:center;height:90vh">' +
  '<div style="text-align:center"><h2>Accesso non riuscito</h2><p>Torna a CompanionAI e riprova.</p></div>'

/**
 * Il login completo. openBrowser(url) apre la pagina di accesso.
 * @returns {Promise<{ tokens: object, client: object, meta: object }>}
 */
async function login(serverUrl, wwwAuthenticate, openBrowser) {
  const meta = await discover(serverUrl, wwwAuthenticate)
  const { verifier, challenge } = pkcePair()
  const state = b64url(crypto.randomBytes(16))
  // Il ritorno dal browser: un server solo su 127.0.0.1, una porta libera, una richiesta sola.
  let finish
  const result = new Promise((resolve, reject) => { finish = { resolve, reject } })
  // Il rifiuto (accesso annullato, tempo scaduto) puo' arrivare mentre il
  // browser e' ancora aperto, prima dell'await: senza questo sarebbe un errore
  // non gestito, che in Node chiude il processo.
  result.catch(() => {})
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
    res.end(ok ? DONE_PAGE : FAIL_PAGE)
    if (ok) finish.resolve(u.searchParams.get('code'))
    else finish.reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || 'accesso annullato'))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const redirectUri = 'http://127.0.0.1:' + server.address().port + '/callback'
  const timer = setTimeout(() => finish.reject(new Error('nessun accesso entro 5 minuti')), LOGIN_TIMEOUT_MS)
  try {
    const client = await register(meta, redirectUri)
    await openBrowser(authorizeUrl(meta, { clientId: client.client_id, redirectUri, challenge, state, resource: serverUrl, scopes: meta.scopes }))
    const code = await result
    const tokens = await tokenRequest(meta.token_endpoint, {
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: client.client_id,
      client_secret: client.client_secret, code_verifier: verifier, resource: serverUrl,
    })
    return { tokens, client, meta }
  } finally {
    clearTimeout(timer)
    server.close()
  }
}

/** Rinnova il token con il refresh token salvato. */
function refresh(saved, serverUrl) {
  if (!saved || !saved.refresh_token || !saved.token_endpoint || !saved.client_id) return Promise.reject(new Error('niente da rinnovare'))
  return tokenRequest(saved.token_endpoint, {
    grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.client_id,
    client_secret: saved.client_secret, resource: serverUrl,
  })
}

/** Scaduto (o quasi)? Un minuto di margine. */
const expired = (saved) => !!(saved && saved.expires_at && Date.now() > saved.expires_at - 60000)

module.exports = { pkcePair, resourceMetadataFrom, resourceMetadataUrls, authServerMetadataUrls, discover, register, authorizeUrl, login, refresh, expired }
