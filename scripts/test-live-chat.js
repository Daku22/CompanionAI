// test-live-chat.js — la chat della live su Twitch (src/main/live-chat.js, Blocco 11c).
const assert = require('node:assert/strict')
const L = require('../src/main/live-chat')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FALLITO  ' + name)
    console.error('     ' + err.message)
    process.exitCode = 1
  }
}
console.log('=== Chat della live ===')

// Righe nel formato che manda Twitch (IRC con i tag IRCv3).
const PRIVMSG = '@badge-info=;badges=moderator/1;color=#1E90FF;display-name=MarcoRossi;emotes=;first-msg=0;id=885196de-cb67-427a-baa8-82f9b0fcd05f;mod=1;subscriber=0;tmi-sent-ts=1700000000000;user-id=1 :marcorossi!marcorossi@marcorossi.tmi.twitch.tv PRIVMSG #canale :Feniel come stai oggi?'
const FIRST = '@badges=;display-name=Nuova\\sArrivata;first-msg=1;id=b1;mod=0;subscriber=0 :nuova!nuova@nuova.tmi.twitch.tv PRIVMSG #canale :\x01ACTION saluta tutti\x01'
const SUBGIFT_MASS = '@badges=;display-name=Generoso;login=generoso;msg-id=submysterygift;msg-param-mass-gift-count=5;msg-param-origin-id=xyz;system-msg=Generoso\\sis\\sgifting\\s5\\sTier\\s1\\sSubs :tmi.twitch.tv USERNOTICE #canale'
const SUBGIFT_ONE = '@badges=;display-name=Generoso;login=generoso;msg-id=subgift;msg-param-recipient-display-name=Fortunato;msg-param-origin-id=xyz :tmi.twitch.tv USERNOTICE #canale'
const RAID = '@badges=;display-name=AmicoStreamer;login=amicostreamer;msg-id=raid;msg-param-viewerCount=42 :tmi.twitch.tv USERNOTICE #canale'
const RESUB = '@badges=subscriber/12;display-name=Fedele;login=fedele;msg-id=resub;msg-param-cumulative-months=12 :tmi.twitch.tv USERNOTICE #canale :un anno con voi!'

test('IRC: un messaggio con i tag, un /me, PING, RECONNECT, l\'ingresso nel canale', () => {
  const m = L.parseIrc(PRIVMSG)
  assert.deepEqual(m, { type: 'message', id: '885196de-cb67-427a-baa8-82f9b0fcd05f', login: 'marcorossi', user: 'MarcoRossi',
    text: 'Feniel come stai oggi?', mod: true, sub: false, first: false, broadcaster: false })
  const f = L.parseIrc(FIRST)
  assert.deepEqual([f.user, f.text, f.first, f.mod], ['Nuova Arrivata', 'saluta tutti', true, false])
  assert.deepEqual(L.parseIrc('PING :tmi.twitch.tv'), { type: 'ping', arg: 'tmi.twitch.tv' })
  assert.deepEqual(L.parseIrc(':tmi.twitch.tv RECONNECT'), { type: 'reconnect' })
  assert.deepEqual(L.parseIrc('@emote-only=0;room-id=1 :tmi.twitch.tv ROOMSTATE #canale'), { type: 'joined', channel: 'canale' })
  assert.equal(L.parseIrc(''), null)
  assert.equal(L.parseIrc(':tmi.twitch.tv 001 justinfan123 :Welcome, GLHF!').type, 'other')
})

test('IRC: abbonamenti, regali e raid', () => {
  assert.deepEqual(L.parseIrc(SUBGIFT_MASS), { type: 'event', kind: 'submysterygift', user: 'Generoso', count: 5, recipient: '', text: '' })
  assert.deepEqual(L.parseIrc(SUBGIFT_ONE), { type: 'event', kind: 'subgift', user: 'Generoso', count: 1, recipient: 'Fortunato', text: '' })
  assert.deepEqual(L.parseIrc(RAID), { type: 'event', kind: 'raid', user: 'AmicoStreamer', count: 42, recipient: '', text: '' })
  assert.deepEqual(L.parseIrc(RESUB), { type: 'event', kind: 'resub', user: 'Fedele', count: 12, recipient: '', text: 'un anno con voi!' })
  assert.equal(L.parseIrc('@msg-id=announcement :tmi.twitch.tv USERNOTICE #canale :ciao').type, 'other')
})

test('i regali a raffica diventano un solo ringraziamento', () => {
  const ev = (line, at) => ({ ...L.parseIrc(line), at })
  const folded = L.foldEvents([ev(SUBGIFT_MASS, 0), ev(SUBGIFT_ONE, 200), ev(SUBGIFT_ONE, 400), ev(RAID, 1000), ev(SUBGIFT_ONE, 60000)])
  assert.deepEqual(folded.map(e => e.kind), ['submysterygift', 'raid', 'subgift'], 'il regalo singolo di un minuto dopo e\' un altro')
})

const NAMES = [{ id: 'feniel', name: 'Feniel' }, { id: 'luma', name: 'Luma' }]
const rules = { ...L.streamConfig({ stream: { bots: ['nightbot'] } }), names: NAMES }
const msg = (login, text, at, extra = {}) => ({ type: 'message', id: login + at, login, user: login, text, mod: false, sub: false, first: false, at, ...extra })

test('chi viene chiamato: il nome come parola (anche @), o il comando', () => {
  assert.equal(L.addressedTo('ciao @Feniel!', NAMES, '!chiedi'), 'feniel')
  assert.equal(L.addressedTo('luma sei simpatica', NAMES, '!chiedi'), 'luma')
  assert.equal(L.addressedTo('lumaca e feniello', NAMES, '!chiedi'), null, 'dentro un\'altra parola no')
  assert.equal(L.addressedTo('!chiedi che ore sono?', NAMES, '!chiedi'), 'command')
  assert.equal(L.addressedTo('!chiediamo', NAMES, '!chiedi'), null)
})

test('bot, link, doppioni e messaggi lunghissimi non passano', () => {
  assert.equal(L.classify(msg('nightbot', 'Feniel segui il canale!', 0), rules, []).verdict, 'bot')
  assert.equal(L.classify(msg('a', 'https://spam.example/x www.altro.it', 0), rules, []).verdict, 'link')
  assert.equal(L.classify(msg('a', 'Feniel ' + 'a'.repeat(400), 0), rules, []).verdict, 'lungo')
  assert.equal(L.classify(msg('a', 'Feniel   CIAO', 0), rules, [L.fold('feniel ciao')]).verdict, 'doppione')
  assert.deepEqual(L.classify(msg('a', 'Feniel ciao', 0), rules, []), { verdict: 'menzione', to: 'feniel' })
  assert.deepEqual(L.classify(msg('a', 'che bel gioco', 0), rules, []), { verdict: 'chat', to: null })
})

test('tetto al minuto, attesa per spettatore, e con tanti messaggi prima mod, nuovi e domande', () => {
  const memory = { answeredAt: [], lastByUser: {} }
  const queue = [msg('a', 'Feniel ciao', 1000), msg('b', 'Feniel come stai?', 2000), msg('c', 'Feniel ehi', 3000, { mod: true }), msg('d', 'Feniel prima volta qui', 3500, { first: true })]
  let r = L.pickChatMessage(queue, rules, memory, 5000)
  assert.equal(r.pick.login, 'c', 'prima il mod')
  memory.answeredAt.push(5000); memory.lastByUser.c = 5000
  r = L.pickChatMessage(r.queue, rules, memory, 6000)
  assert.equal(r.pick.login, 'd', 'poi chi scrive per la prima volta')
  memory.answeredAt.push(6000, 6100, 6200)
  r = L.pickChatMessage(r.queue, rules, memory, 7000)
  assert.equal(r.pick, null, 'quattro risposte nell\'ultimo minuto: si aspetta')
  assert.equal(r.queue.length, 2)
  r = L.pickChatMessage(r.queue, rules, memory, 60000)
  assert.ok(r.discarded.every(d => /vecchio/.test(d.reason)) && r.discarded.length === 2, 'dopo 45 s le menzioni scadono invece di accodarsi')
  const again = L.pickChatMessage([msg('c', 'Feniel di nuovo', 20000)], rules, { answeredAt: [], lastByUser: { c: 5000 } }, 20000)
  assert.equal(again.pick, null)
  assert.match(again.discarded[0].reason, /da poco/)
})

test('commenti spontanei: ogni N minuti, solo se la chat ha scritto, prima le domande', () => {
  const chat = [msg('a', 'bello', 200000), msg('b', 'ma questo gioco com\'e\' finito?', 210000), msg('c', 'che partita incredibile ragazzi davvero', 220000)]
  assert.equal(L.pickSpontaneous(chat, 0, 230000, 5), null, 'non prima di 5 minuti dall\'ultimo')
  assert.equal(L.pickSpontaneous(chat, 0, 5 * 60000 + 1000, 0), null, 'spenti')
  const p = L.pickSpontaneous(chat, 0, 300000, 5)
  assert.equal(p.login, 'b', 'una domanda prima di tutto')
  assert.equal(L.pickSpontaneous(chat, 225000, 540000, 5), null, 'niente di nuovo dall\'ultimo commento')
  assert.equal(L.pickSpontaneous(chat, 0, 500000, 5), null, 'messaggi di piu\' di due minuti fa: troppo vecchi')
})

test('impostazioni: canale da un link, comando, tetti, bot', () => {
  const s = L.mergeStream({}, { channel: 'https://www.twitch.tv/Il_Mio_Canale?x=1', command: '!AI', perMinute: 50, userCooldownS: -3, spontaneousMin: 1, bots: ['NightBot', 'no spazi', 'x'] })
  assert.deepEqual(s, { channel: 'il_mio_canale', command: '!ai', perMinute: 10, userCooldownS: 0, spontaneousMin: 2, bots: ['nightbot', 'x'] })
  assert.equal(L.mergeStream(s, { channel: '#ab' }).channel, '', 'troppo corto')
  assert.equal(L.mergeStream(s, { command: 'senza punto' }).command, '!chiedi')
  assert.deepEqual(L.streamConfig({}), { ...L.STREAM_DEFAULTS })
  assert.equal(L.mergeStream(s, { spontaneousMin: 0 }).spontaneousMin, 0, 'spenti si puo\'')
})

console.log('=== ' + passed + ' test superati ===')
