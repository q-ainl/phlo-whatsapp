// The idempotency key identifies one EVENT, not one message: a message id fires an inbound event and then
// several ack events (sent/delivered/read/played) that all share that id, so the key also carries the type
// and the ack level. A delivery retry reuses the identical payload and therefore the identical key.
const webhookKey = payload => [payload.id || '', payload.type || 'msg', payload.ack == null ? '' : payload.ack].filter(p => p !== '').join(':')

// Deliver a payload to the webhook, retrying transient failures (network, timeout, 5xx, 429) with bounded
// backoff. axios is injected so this stays unit-testable.
const deliverWebhook = async (axios, url, payload, secret, { timeout = 10000, retries = 3, backoff = 500 } = {}) => {
	const headers = { secret, 'idempotency-key': webhookKey(payload) }
	for (let attempt = 1; attempt <= retries; attempt++){
		try {
			return await axios.post(url, payload, { headers, timeout })
		} catch (error) {
			const retriable = !error.response || error.response.status >= 500 || error.response.status === 429
			if (attempt === retries || !retriable) throw error
			await new Promise(r => setTimeout(r, backoff * 2 ** (attempt - 1)))
		}
	}
}

module.exports = (sessionId, port, secret, webhook = null) => {
	const path = require('path')
	const axios = require('axios')
	const express = require('express')
	const qrcode = require('qrcode-terminal')
	const QRCodeLib = require('qrcode-terminal/vendor/QRCode')
	const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel')
	const {
		Client,
		LocalAuth,
		MessageMedia,
		Location,
		Poll,
	} = require('whatsapp-web.js')

	const app = express()
	app.use((req, res, next) => req.headers.secret === secret ? next() : res.status(401).json({ error: 'Unauthorized' }))
	app.use(express.json({ limit: '96mb' }))

	const client = new Client({
		authStrategy: new LocalAuth({
			clientId: sessionId,
			dataPath: path.join(__dirname, '.wwebjs_auth'),
		}),
		puppeteer: {
			headless: true,
			executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
			],
		},
	})
	let clientReady = false
	let clientState = 'connecting'
	let latestQr = null
	const startedAt = Date.now()

	const qrToSvgDataUrl = qrString => {
		const qr = new QRCodeLib(-1, QRErrorCorrectLevel.L)
		qr.addData(qrString)
		qr.make()
		const n = qr.getModuleCount()
		const cell = 8
		const margin = 3
		const size = (n + margin * 2) * cell
		let rects = ''
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				if (qr.isDark(r, c)) {
					const x = (c + margin) * cell
					const y = (r + margin) * cell
					rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}"/>`
				}
			}
		}
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="white"/><g fill="black">${rects}</g></svg>`
		return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
	}

	const parseDataUrl = (value, fallbackMime) => {
		if (!value || typeof value !== 'string') return null
		const match = value.match(/^data:([^;]+);base64,(.*)$/s)
		if (match) return { mimetype: match[1], data: match[2] }
		return { mimetype: fallbackMime, data: value }
	}

	const toMessageMedia = (value, filename, fallbackMime) => {
		const parsed = parseDataUrl(value, fallbackMime)
		if (!parsed) throw new Error('Invalid media payload')
		return new MessageMedia(parsed.mimetype || 'application/octet-stream', parsed.data, filename)
	}

	const inferAudioMime = value => {
		const parsed = parseDataUrl(value)
		return parsed?.mimetype || 'audio/ogg; codecs=opus'
	}

	const toLocationText = msg => {
		const lat = msg.location?.latitude ?? msg.lat ?? null
		const lng = msg.location?.longitude ?? msg.lng ?? null
		return lat != null && lng != null ? `${lat},${lng}` : null
	}

	const getChatInfo = async msg => {
		try {
			const chat = await msg.getChat()
			return { name: chat?.name || null, isGroup: chat?.isGroup || false }
		} catch {
			return { name: null, isGroup: false }
		}
	}

	const getContactInfo = async msg => {
		try {
			const contact = await msg.getContact()
			return {
				name: contact?.pushname || contact?.name || null,
				number: contact?.number || null,
			}
		} catch {
			return { name: null, number: null }
		}
	}

	const getContactById = async id => {
		if (!id) return { name: null, number: null }
		try {
			const contact = await client.getContactById(id)
			return {
				name: contact?.pushname || contact?.name || null,
				number: contact?.number || null,
			}
		} catch {
			return { name: null, number: null }
		}
	}

	const normalizeMessage = async msg => {
		const media = msg.hasMedia ? await msg.downloadMedia().catch(() => null) : null
		const chatInfo = await getChatInfo(msg)
		const isGroup = chatInfo.isGroup || msg.from?.endsWith('@g.us')
		const senderContact = await getContactInfo(msg)
		const chatContact = msg.fromMe && !isGroup ? await getContactById(msg.to) : senderContact
		const chatNumber = chatContact.number || null
		const chatId = isGroup ? msg.from : (chatNumber ? `${chatNumber}@c.us` : (msg.fromMe ? msg.to : msg.from))
		// Multi-device JIDs may carry a device suffix (:NN@); strip it before self-message detection.
		const normalizeJid = jid => String(jid || '').replace(/:\d+@/, '@')
		const ownJid = normalizeJid(client.info?.wid?._serialized || client.info?.wid?.user || '')
		const selfMessage = !isGroup && !!msg.fromMe && !!ownJid && normalizeJid(msg.to).startsWith(ownJid.split('@')[0])
		return {
			id: msg.id?._serialized || msg.id || null,
			chat: chatId,
			chatName: chatInfo.name,
			from: msg.author || msg.from,
			fromName: senderContact.name,
			fromNumber: senderContact.number ? `+${senderContact.number}` : null,
			isGroup,
			to: msg.to || null,
			fromMe: !!msg.fromMe,
			selfMessage,
			timestamp: msg.timestamp || null,
			type: msg.type,
			media: media ? {
				mime: media.mimetype || null,
				content: media.data || null,
				filename: media.filename || null,
			} : (msg.type === 'location' ? toLocationText(msg) : null),
			text: msg.body || msg.caption || null,
			isForwarded: !!msg.isForwarded,
			isViewOnce: !!msg.isViewOnce,
		}
	}

	const shortenMediaContent = content => `${content.slice(0, 9)}.. - ${content.length}b`

	const logMessage = msg => {
		const logMsg = structuredClone(msg)
		if (logMsg.media?.content) logMsg.media.content = shortenMediaContent(logMsg.media.content)
		if (logMsg.quotedMsg?.media?.content) logMsg.quotedMsg.media.content = shortenMediaContent(logMsg.quotedMsg.media.content)
		console.log('')
		console.log(logMsg)
	}

	const asyncRoute = handler => async (req, res) => {
		try {
			await handler(req, res)
		} catch (error) {
			console.error(error)
			if (!res.headersSent) res.status(500).json({ error: error.message || 'Internal Server Error' })
		}
	}

	client.on('qr', qr => {
		console.log(`\nScan QR for session "${sessionId}"`)
		qrcode.generate(qr, { small: true })
		clientState = 'qr'
		latestQr = qrToSvgDataUrl(qr)
	})

	client.on('ready', () => {
		clientReady = true
		clientState = 'ready'
		latestQr = null
		console.log(`\nWhatsApp client "${sessionId}" ready`)
		if (webhook) console.log(`\nWebhook active: ${webhook}`)
	})
	client.on('authenticated', () => console.log(`\nWhatsApp client "${sessionId}" authenticated`))
	client.on('auth_failure', message => {
		clientState = 'disconnected'
		latestQr = null
		console.error(`\nWhatsApp auth failure "${sessionId}": ${message}`)
	})
	client.on('disconnected', reason => {
		clientReady = false
		clientState = 'disconnected'
		latestQr = null
		console.error(`\nWhatsApp client "${sessionId}" disconnected: ${reason}`)
	})
	client.on('message_create', async data => {
		const id = data.id?._serialized || data.id || '-'
		const from = data.author || data.from || '-'
		const to = data.to || '-'
		const text = (data.body || data.caption || '').replace(/\s+/g, ' ').trim().slice(0, 120)
		console.log(`\nmessage_create: ${data.type || 'unknown'} fromMe=${!!data.fromMe} from=${from} to=${to} id=${id}`)
		text && console.log(text)
	})

	app.get('/status', (req, res) => {
		res.json({ ok: true, status: clientState })
	})

	app.get('/health', (req, res) => {
		res.json({ ok: true, sessionId, status: clientState, ready: clientReady, webhook: !!webhook, uptime: Math.round((Date.now() - startedAt) / 1000) })
	})

	app.get('/qr', (req, res) => {
		res.json({ ok: true, status: clientState, qr: latestQr })
	})

	app.use((req, res, next) => {
		if (!clientReady) return res.status(503).json({ error: 'WhatsApp client not ready' })
		next()
	})

	const webhookTimeout = parseInt(process.env.WA_WEBHOOK_TIMEOUT, 10) || 10000
	const webhookRetries = parseInt(process.env.WA_WEBHOOK_RETRIES, 10) || 3

	const postWebhook = async payload => {
		try {
			const res = await deliverWebhook(axios, webhook, payload, secret, { timeout: webhookTimeout, retries: webhookRetries })
			console.log(`\nwebhook: ${res.status} ${res.statusText || 'OK'} id=${payload.id || '-'}`)
			if (res.data != null) console.log(res.data)
		} catch (error) {
			const status = error.response?.status || '-'
			const body = typeof error.response?.data === 'string' ? error.response.data : JSON.stringify(error.response?.data || {})
			console.error(`\nwebhook error: ${status} id=${payload.id || '-'}`)
			body && console.error(body)
		}
	}

	if (webhook) {
		client.on('message_create', async data => {
			if (data.from === 'status@broadcast' || data.to === 'status@broadcast') {
				console.log(`\nskipped status@broadcast from=${data.from}`)
				return
			}
			const msg = await normalizeMessage(data)
			if (msg.selfMessage) {
				console.log(`\nskipped self-message id=${msg.id || '-'}`)
				return
			}
			if (data.hasQuotedMsg) {
				const quoted = await data.getQuotedMessage().catch(() => null)
				msg.quotedMsg = quoted ? await normalizeMessage(quoted) : null
			} else {
				msg.quotedMsg = null
			}
			logMessage(msg)
			await postWebhook(msg)
		})

		client.on('message_ack', async (msg, ack) => {
			if (msg.from === 'status@broadcast' || msg.to === 'status@broadcast') return
			const ackLabels = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' }
			const label = ackLabels[ack] || `ack_${ack}`
			console.log(`\nmessage_ack: ${label} id=${msg.id?._serialized || msg.id} to=${msg.to}`)
			await postWebhook({
				id: msg.id?._serialized || msg.id || null,
				type: 'ack',
				ack: ack,
				ackLabel: label,
				chat: msg.to || msg.from,
				fromMe: !!msg.fromMe,
				timestamp: msg.timestamp || null,
			})
		})
	}

	app.post('/disconnect', asyncRoute(async (req, res) => {
		console.log(`\ndisconnect: ${sessionId}`)
		await client.logout()
		clientState = 'disconnected'
		clientReady = false
		latestQr = null
		res.json({ ok: true })
	}))

	app.post('/read', asyncRoute(async (req, res) => {
		const { chat } = req.body
		const target = await client.getChatById(chat)
		await target.sendSeen()
		console.log(`\nread: ${chat}`)
		res.send('ok')
	}))

	app.post('/reaction', asyncRoute(async (req, res) => {
		const { msg, emoji } = req.body
		const target = await client.getMessageById(msg)
		if (!target) throw new Error(`Message not found: ${msg}`)
		await target.react(emoji)
		console.log(`\nreaction: ${msg} - ${emoji}`)
		res.send('ok')
	}))

	app.post('/text', asyncRoute(async (req, res) => {
		const { to, text } = req.body
		await client.sendMessage(to, text)
		console.log(`\ntext: ${to}\n${text}`)
		res.send('ok')
	}))

	app.post('/image', asyncRoute(async (req, res) => {
		const { to, filename, image } = req.body
		const text = req.body.text || ''
		const media = toMessageMedia(image, filename, 'image/jpeg')
		await client.sendMessage(to, media, { caption: text })
		console.log(`\nimage: ${to} - ${filename} (${image.length}b)\n${text}`)
		res.send('ok')
	}))

	app.post('/location', asyncRoute(async (req, res) => {
		const { to, lat, lon, text } = req.body
		const address = req.body.address || ''
		const url = req.body.url || ''
		const description = [text, address, url].filter(Boolean).join('\n')
		await client.sendMessage(to, new Location(lat, lon, description))
		console.log(`\nlocation: ${lat},${lon}\n${description}`)
		res.send('ok')
	}))

	app.post('/document', asyncRoute(async (req, res) => {
		const { to, filename, document } = req.body
		const text = req.body.text || ''
		const media = toMessageMedia(document, filename, 'application/octet-stream')
		await client.sendMessage(to, media, {
			caption: text,
			sendMediaAsDocument: true,
		})
		console.log(`\ndocument: ${filename} (${document.length}b)\n${text}`)
		res.send('ok')
	}))

	app.post('/audio', asyncRoute(async (req, res) => {
		const { to, audio } = req.body
		const media = toMessageMedia(audio, 'audio', inferAudioMime(audio))
		await client.sendMessage(to, media)
		console.log(`\naudio: ${to} ${audio.length}b`)
		res.send('ok')
	}))

	app.post('/voice', asyncRoute(async (req, res) => {
		const { to, audio } = req.body
		const media = toMessageMedia(audio, 'voice', inferAudioMime(audio))
		await client.sendMessage(to, media, {
			sendAudioAsVoice: true,
		})
		console.log(`\nvoice: ${to} ${audio.length}b`)
		res.send('ok')
	}))

	app.post('/poll', asyncRoute(async (req, res) => {
		const { to, name, options } = req.body
		const multi = !!+req.body.multi
		await client.sendMessage(to, new Poll(name, options, { allowMultipleAnswers: multi }))
		console.log(`\npoll: ${to} ${multi}\n${name}`)
		console.log(options)
		res.send('ok')
	}))

	app.post('/typing/start', asyncRoute(async (req, res) => {
		const { to } = req.body
		const chat = await client.getChatById(to)
		await chat.sendStateTyping()
		console.log(`\ntyping/start: ${to}`)
		res.send('ok')
	}))

	app.post('/typing/stop', asyncRoute(async (req, res) => {
		const { to } = req.body
		const chat = await client.getChatById(to)
		await chat.clearState()
		console.log(`\ntyping/stop: ${to}`)
		res.send('ok')
	}))

	// Loopback by default (bare-metal); a container sets WA_HOST=0.0.0.0 so a sibling container can reach it.
	const listenHost = process.env.WA_HOST || '127.0.0.1'
	app.listen(port, listenHost, () => console.log(`\nServer "${sessionId}" running on ${listenHost}:${port}`))

	client.initialize().catch(error => {
		console.error(error)
		process.exitCode = 1
	})
}

module.exports.deliverWebhook = deliverWebhook
