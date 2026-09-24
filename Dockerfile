# ---------- Abhängigkeiten ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Build ----------
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# ---------- Laufzeit ----------
FROM node:22-bookworm-slim
# Tesseract (Texterkennung, Deutsch + Englisch), Poppler (PDF) und libheif (iPhone-Fotos) – laufen komplett lokal
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils libheif-examples ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json next.config.mjs tsconfig.json ./
COPY migrations ./migrations
COPY fixtures ./fixtures
COPY src ./src
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/tsx src/scripts/migrate.ts && node_modules/.bin/next start"]
