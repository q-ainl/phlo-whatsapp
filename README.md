# phloWA - Phlo WhatsApp gateway

WhatsApp Web gateway (whatsapp-web.js + Express) for the [Phlo](https://phlo.tech) framework. One process per WhatsApp number; inbound messages reach the app through a secret-protected webhook, outbound messages are sent through a local HTTP bridge.

phloWA is the messaging half of the Phlo server layer, next to [phloWS](https://github.com/q-ainl/phlo-websocket) for realtime. The engine's `WhatsApp` resource handles the webhook on the app side; the [Phlo Dashboard](https://github.com/q-ainl/phlo-dashboard) shows the status of every instance across the fleet.

## Usage
```js
require('./phloWA.js')('wa1', 8081, '<secret>', 'https://app.example.com/receive/whatsapp/web/wa1')
```
Arguments: `(instanceId, port, secret, webhookUrl)`.

On first start the instance prints a QR code in the terminal; scan it with the WhatsApp account that this instance should send and receive as. The session is persisted, so this is a one-time step per instance.

## Install
```sh
npm install   # deps: whatsapp-web.js, express, axios, qrcode-terminal
```

## Production

Keep one small config file per instance so the gateway and its webhook are managed in one place:

```js
// config/wa1.js
require('../whatsapp/phloWA.js')('wa1', 8081, process.env.WA1_SECRET, 'https://app.example.com/receive/whatsapp/web/wa1')
```

Run each instance under a process manager, for example pm2:

```sh
pm2 start config/wa1.js --name wa1
pm2 save
```

## License

MIT. See [LICENSE](LICENSE).
