const assert = require('assert')
const { deliverWebhook } = require('../phlo-whatsapp.js')

let passed = 0
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ok -', msg); passed++ }

// A mock axios whose post() fails for the first `fail` calls (with the given error), then succeeds.
const mockAxios = (fail, error) => {
	const calls = []
	return {
		calls,
		post: async (url, payload, opts) => {
			calls.push({ url, payload, opts })
			if (calls.length <= fail) throw error
			return { status: 200, statusText: 'OK', data: null }
		},
	}
}

;(async () => {
	const netErr = new Error('ECONNREFUSED')

	// Retries a transient network failure and succeeds on the next attempt.
	let ax = mockAxios(1, netErr)
	let res = await deliverWebhook(ax, 'http://hook', { id: 'MSG1' }, 'sek', { retries: 3, backoff: 1 })
	ok(res.status === 200, 'transient failure is retried and then delivered')
	ok(ax.calls.length === 2, 'exactly two attempts were made (one failure, one success)')
	ok(ax.calls[0].opts.headers['idempotency-key'] === ax.calls[1].opts.headers['idempotency-key'], 'a delivery retry reuses the same idempotency key')
	ok(ax.calls[0].opts.timeout === 10000, 'a request timeout is set')

	// The key identifies an event, not a message: acks of the same message get distinct keys.
	const key = async payload => { const a = mockAxios(0); await deliverWebhook(a, 'http://hook', payload, 'sek', { retries: 1 }); return a.calls[0].opts.headers['idempotency-key'] }
	const kInbound = await key({ id: 'M', type: 'chat' })
	const kSent = await key({ id: 'M', type: 'ack', ack: 1 })
	const kRead = await key({ id: 'M', type: 'ack', ack: 3 })
	ok(kSent !== kRead, 'different ack statuses of one message yield different keys')
	ok(kInbound !== kSent && kInbound !== kRead, 'the inbound message and its acks yield different keys')
	ok(await key({ id: 'M', type: 'ack', ack: 3 }) === kRead, 'the same event yields a stable key')

	// Gives up after the retry budget and rethrows.
	ax = mockAxios(9, netErr)
	let threw = false
	try { await deliverWebhook(ax, 'http://hook', { id: 'MSG2' }, 'sek', { retries: 3, backoff: 1 }) }
	catch { threw = true }
	ok(threw && ax.calls.length === 3, 'exhausts the bounded retries then throws')

	// A 4xx (not 429) is not retried.
	const clientErr = Object.assign(new Error('bad request'), { response: { status: 400 } })
	ax = mockAxios(9, clientErr)
	threw = false
	try { await deliverWebhook(ax, 'http://hook', { id: 'MSG3' }, 'sek', { retries: 3, backoff: 1 }) }
	catch { threw = true }
	ok(threw && ax.calls.length === 1, 'a non-retriable 4xx fails fast without retrying')

	// The auth middleware compares req.headers.secret === secret; with an empty secret a caller sending no
	// header would match, so the module must refuse to start rather than run wide open.
	const start = require('../phlo-whatsapp.js')
	let refused = false
	try { start('wa-test', 8099) }
	catch { refused = true }
	ok(refused, 'the module refuses to start without a secret')

	console.log(`\nwebhook: ${passed} checks passed`)
	process.exit(0)
})().catch(e => { console.error('WEBHOOK TEST FAILED:', e.message); process.exit(1) })
