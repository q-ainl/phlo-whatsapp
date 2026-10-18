const assert = require('assert')
const { linkedInfo } = require('../phlo-whatsapp.js')

let passed = 0
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ok -', msg); passed++ }

// A phone account: whatsapp-web.js puts the number in wid.user on the c.us server.
const phone = linkedInfo({ wid: { server: 'c.us', user: '31612345678', _serialized: '31612345678@c.us' }, pushname: 'Q-AI Butler' })
ok(phone.number === '+31612345678', 'a phone account reports its number with a plus')
ok(phone.name === 'Q-AI Butler', 'the push name comes along')
ok(phone.id === '31612345678@c.us', 'the raw id is kept for logging')

// A lid is not a phone number: report no number instead of a wrong one.
const lid = linkedInfo({ wid: { server: 'lid', user: '260314327199995', _serialized: '260314327199995@lid' } })
ok(lid.number === null, 'a lid gives no number')
ok(lid.id === '260314327199995@lid', 'but the id is still there')

// Before the client is ready there is no info at all.
const none = linkedInfo(undefined)
ok(none.number === null && none.name === null && none.id === null, 'no info gives nulls, not a crash')

console.log(`\n${passed} passed`)
