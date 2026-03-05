# ── NovaPulse Backend ────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./backend/

EXPOSE 3000

CMD ["node", "backend/server.js"]
