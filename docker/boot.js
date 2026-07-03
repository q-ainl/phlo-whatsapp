// Launch the Phlo WhatsApp bridge for the demo. Scan the QR printed to the logs on
// the first run; the linked session persists in .wwebjs_auth so restarts skip it.
const port = parseInt(process.env.WA_PORT || '3000', 10)
const secret = process.env.WA_SECRET || ''
if (!secret) { console.error('WA_SECRET is required; refusing to start with an empty secret.'); process.exit(1) }
const webhook = process.env.WA_WEBHOOK || null
require('/opt/phlo/phlo-whatsapp.js')('demo', port, secret, webhook)
