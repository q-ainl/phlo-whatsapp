# ghcr.io/q-ainl/phlo-whatsapp
#
# The Phlo WhatsApp bridge (whatsapp-web.js) as a compose sidecar. It links a real
# WhatsApp account (scan the QR from the container logs on the first run), exposes
# a small HTTP API to send text/images/polls/locations, and posts inbound messages
# to WA_WEBHOOK with the shared WA_SECRET. The session persists in .wwebjs_auth.
# Build from the repo root: docker build -f docker/Dockerfile .
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json phlo-whatsapp.js /opt/phlo/
RUN cd /opt/phlo && npm install --omit=dev --no-audit --no-fund && rm -rf /root/.npm

COPY docker/boot.js /opt/phlo/boot.js
WORKDIR /opt/phlo
CMD ["node", "/opt/phlo/boot.js"]
