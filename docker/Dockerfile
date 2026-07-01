# ghcr.io/q-ainl/phlo-whatsapp
#
# The Phlo WhatsApp bridge (whatsapp-web.js) as a compose sidecar. It links a real
# WhatsApp account (scan the QR from the container logs on the first run), exposes
# a small HTTP API to send text/images/polls/locations, and posts inbound messages
# to WA_WEBHOOK with the shared WA_SECRET. The session persists in .wwebjs_auth.
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN mkdir -p /opt/phlo && cd /opt/phlo \
 && npm init -y >/dev/null 2>&1 \
 && npm install --no-audit --no-fund phlo-whatsapp

COPY boot.js /opt/phlo/boot.js
WORKDIR /opt/phlo
CMD ["node", "/opt/phlo/boot.js"]
