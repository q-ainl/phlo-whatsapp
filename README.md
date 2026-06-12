# phloWA - Phlo WhatsApp gateway

WhatsApp Web gateway (whatsapp-web.js + Express) for the [Phlo](https://phlo.tech) framework. One process per instance; delivers inbound messages to the app through a secret webhook.

## Usage
```js
require('./phloWA.js')('wa1', 8081, '<secret>', 'https://app.example.com/receive/whatsapp/web/wa1')
```
Arguments: `(instanceId, port, secret, webhookUrl)`.

## Install
```sh
npm install   # deps: whatsapp-web.js, express, axios, qrcode-terminal
```
