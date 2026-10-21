// test-twitch-chat.js — il collegamento alla chat di Twitch (src/main/twitch-chat.js,
// Blocco 11c) contro un IRC finto su WebSocket: ingresso nel canale, un
// messaggio, PING/PONG, RECONNECT, e la riconnessione dopo una caduta.
const assert = require('node:assert/strict')
const { createFakeWsServer } = require('./lib/fake-ws-server')
const { TwitchChat } = require('../src/main/twitch-chat')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function until(pred, ms = 3000) {
  for (let t = 0; t < ms; t += 20) { if (pred()) return true; await sleep(20) }
  return false
}

async function main() {
  let passed = 0
  const t = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name) }
  console.log('=== Collegamento a Twitch ===')

  const clients = []
  const received = []
  const server = createFakeWsServer((client) => {
    clients.push(client)
    client.onText = (text) => {
      for (const line of text.split('\r\n')) {
        received.push(line)
        if (line.startsWith('JOIN #')) {
          const ch = line.slice(5)
          client.send(':tmi.twitch.tv 001 justinfan :Welcome, GLHF!\r\n@emote-only=0 :tmi.twitch.tv ROOMSTATE ' + ch)
        }
      }
    }
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  process.env.TWITCH_IRC_URL = 'ws://127.0.0.1:' + server.address().port
  const lines = []
  const states = []
  const chat = new TwitchChat({ onLine: (m) => lines.push(m), onStatus: (s) => states.push(s.state) })
  try {
    await t('entra come utente anonimo, chiede i tag ed entra nel canale', async () => {
      chat.start('canale')
      assert.ok(await until(() => chat.status.state === 'connected'), 'collegato: ' + JSON.stringify(chat.status))
      assert.ok(received.includes('CAP REQ :twitch.tv/tags twitch.tv/commands'))
      assert.ok(received.some(l => /^NICK justinfan\d+$/.test(l)), 'utente anonimo, niente PASS')
      assert.ok(!received.some(l => l.startsWith('PASS')))
      assert.ok(received.includes('JOIN #canale'))
      assert.ok(states.indexOf('connecting') < states.indexOf('connected'), 'prima si collega, poi entra: ' + states.join(' '))
    })

    await t('i messaggi arrivano letti, e al PING risponde PONG', async () => {
      clients[0].send('@display-name=Marco;id=1;mod=0 :marco!marco@marco.tmi.twitch.tv PRIVMSG #canale :ciao Feniel\r\nPING :tmi.twitch.tv')
      assert.ok(await until(() => lines.some(m => m.type === 'message' && m.text === 'ciao Feniel')))
      assert.ok(await until(() => received.includes('PONG :tmi.twitch.tv')))
    })

    await t('RECONNECT: si ricollega subito', async () => {
      clients[0].send(':tmi.twitch.tv RECONNECT')
      assert.ok(await until(() => clients.length === 2 && chat.status.state === 'connected'), 'secondo collegamento: ' + clients.length)
    })

    await t('una caduta: riprova dopo un po\', e lo dice', async () => {
      clients[1].close()
      assert.ok(await until(() => chat.status.state === 'retry'), JSON.stringify(chat.status))
      assert.equal(chat.status.retryIn, 2, 'la prima attesa e\' di 2 s')
      assert.ok(await until(() => clients.length === 3 && chat.status.state === 'connected', 4000), 'ricollegato')
    })

    await t('spento: si chiude e non riprova', async () => {
      chat.stop()
      assert.equal(chat.status.state, 'off')
      await sleep(300)
      assert.equal(clients.length, 3)
    })
  } finally {
    chat.stop()
    server.close()
    for (const c of clients) c.close()
  }
  console.log('=== ' + passed + ' test superati ===')
}

main().catch((e) => { console.error('  FALLITO  ' + e.message); process.exitCode = 1 })
