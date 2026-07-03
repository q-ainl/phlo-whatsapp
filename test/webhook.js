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
	ok(ax.calls[0].opts.headers['idempotency-key'] === 'MSG1', 'every attempt carries the message id as the idempotency key')
	ok(ax.calls[0].opts.timeout === 10000, 'a request timeout is set')

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

	console.log(`\nwebhook: ${passed} checks passed`)
	process.exit(0)
})().catch(e => { console.error('WEBHOOK TEST FAILED:', e.message); process.exit(1) })
