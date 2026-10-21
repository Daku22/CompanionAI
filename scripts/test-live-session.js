// test-live-session.js — una live su Twitch (src/main/live-session.js, Blocco 11c),
// con un collegamento finto e un orologio a mano: cosa si scarta, cosa si
// sceglie, in che ordine, e il riassunto alla fine.
const assert = require('node:assert/strict')
const { createLiveSession } = require('../src/main/live-session')
const L = require('../src/main/live-chat')

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

class FakeClient {
  constructor({ onStatus }) { this.onStatus = onStatus; FakeClient.last = this }
  start(channel) { this.channel = channel; this.onStatus({ state: 'connected', channel, retryIn: 0, note: '' }) }
  stop() { this.stopped = true }
}

function session({ respond = null, stream = {} } = {}) {
  let t = 1000000
  const live = createLiveSession({
    config: () => L.streamConfig({ stream: { channel: 'canale', ...stream } }),
    names: () => [{ id: 'feniel', name: 'Feniel' }, { id: 'luma', name: 'Luma' }],
    respond, Client: FakeClient, now: () => t, tickMs: 60 * 60 * 1000,
  })
  return { live, at: (ms) => { t = 1000000 + ms } }
}
const line = (raw) => L.parseIrc(raw)
const PRIV = (login, text, tags = '') => '@display-name=' + login + ';id=' + Math.random() + ';mod=0' + tags + ' :' + login + '!' + login + '@x PRIVMSG #canale :' + text

async function main() {
  console.log('=== Sessione della live ===')

  await test('senza canale non parte; con il canale si collega', async () => {
    const empty = createLiveSession({ config: () => L.streamConfig({}), names: () => [], Client: FakeClient })
    const r = empty.start()
    assert.equal(r.ok, false)
    assert.match(r.error, /canale/)
    const { live } = session()
    assert.equal(live.start().ok, true)
    assert.equal(FakeClient.last.channel, 'canale')
    assert.equal(live.state().status.state, 'connected')
    live.stop()
  })

  await test('si scartano bot e link, le menzioni si scelgono, il resto aspetta i commenti', async () => {
    const picked = []
    const { live, at } = session({ respond: async (item) => { picked.push(item); return { ok: true, by: 'Feniel' } }, stream: { bots: ['nightbot'] } })
    live.start()
    live._line(line(PRIV('nightbot', 'Feniel seguite il canale')))
    live._line(line(PRIV('spam', 'https://spam.example/x')))
    live._line(line(PRIV('marco', 'che bel gioco')))
    live._line(line(PRIV('anna', 'Luma come stai?')))
    at(1000)
    await live._tick()
    assert.deepEqual(picked.map(p => [p.kind, p.to, p.msg.login]), [['mention', 'luma', 'anna']])
    const st = live.state()
    assert.deepEqual([st.counts.received, st.counts.discarded, st.counts.answered], [4, 2, 1])
    assert.deepEqual(st.log.filter(e => e.outcome === 'scartato').map(e => e.reason).sort(), ['solo link', 'un bot'])
    assert.equal(st.log[0].outcome, 'risposto')
    assert.equal(st.log[0].by, 'Feniel')
    live.stop()
  })

  await test('gli eventi si ringraziano (i regali a raffica una volta), poi i commenti spontanei', async () => {
    const picked = []
    const { live, at } = session({ respond: async (item) => { picked.push(item); return true }, stream: { spontaneousMin: 5 } })
    live.start()
    live._line(line('@display-name=Generoso;login=generoso;msg-id=submysterygift;msg-param-mass-gift-count=3 :tmi.twitch.tv USERNOTICE #canale'))
    live._line(line('@display-name=Generoso;login=generoso;msg-id=subgift;msg-param-recipient-display-name=A :tmi.twitch.tv USERNOTICE #canale'))
    live._line(line('@display-name=Amico;login=amico;msg-id=raid;msg-param-viewerCount=7 :tmi.twitch.tv USERNOTICE #canale'))
    for (let i = 0; i < 4; i++) { at(1000 + i); await live._tick() }
    assert.deepEqual(picked.map(p => p.event && p.event.kind), ['submysterygift', 'raid'], 'il regalo singolo e\' assorbito')
    live._line(line(PRIV('marco', 'ma voi giocate anche la sera?')))
    at(60 * 1000)
    await live._tick()
    assert.equal(picked.length, 2, 'prima di 5 minuti niente commento')
    at(5 * 60 * 1000 + 1000)
    live._line(line(PRIV('sara', 'ciao a tutti, che si gioca oggi?')))
    await live._tick()
    assert.equal(picked[2] && picked[2].kind, 'spontaneous')
    const summary = live.stop()
    assert.equal(summary.counts.events, 3)
    assert.equal(summary.answered.length, 3)
    assert.ok(summary.endedAt > summary.startedAt)
    assert.equal(FakeClient.last.stopped, true)
    assert.equal(live.stop(), null, 'gia\' spenta')
  })

  await test('una risposta alla volta: mentre una e\' in corso le altre aspettano', async () => {
    let release = null
    const picked = []
    const { live, at } = session({ respond: (item) => { picked.push(item); return new Promise(r => { release = r }) } })
    live.start()
    live._line(line(PRIV('a', 'Feniel uno')))
    live._line(line(PRIV('b', 'Feniel due')))
    at(1000)
    const first = live._tick()
    await live._tick()
    assert.equal(picked.length, 1)
    release(true)
    await first
    at(2000)
    const second = live._tick()
    assert.equal(picked.length, 2)
    release(true)
    await second
    live.stop()
  })

  console.log('=== ' + passed + ' test superati ===')
}
main()
