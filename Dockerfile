# ============================================================
# Zyrix FinSuite Backend — Dockerfile
#
# Why a Dockerfile (Sprint D-2):
#   Nixpacks 1.41 silently dropped our `aptPkgs` and `phases.install`
#   apt commands, so Chromium couldn't find its runtime .so libraries.
#   Switching to a Dockerfile gives explicit, deterministic control
#   over the system-lib install. Railway uses this file when present
#   and ignores nixpacks.toml.
#
# Footprint: ~+150 MB image (Chromium runtime libs). Build adds
# ~60-90s (apt-get) on cache miss; near-zero on cache hit.
# ============================================================

FROM node:20-bookworm-slim

# Chromium runtime dependencies — needed by both the legacy
# `puppeteer` bundled Chromium and `@sparticuz/chromium` used
# by the Sprint D-2 PDF service. Keep this list in sync with
# Puppeteer's official Debian troubleshooting guide.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      lsb-release \
      openssl \
      wget \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (cache-friendly: copy lockfiles first)
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source
COPY . .

# Generate Prisma client (postinstall already does this, but be explicit)
RUN npx prisma generate

# Production runtime via tsx (no tsc compile step — matches the
# original nixpacks setup; avoids pre-existing TS errors in
# auditLogger.ts and routes/admin/auth.ts).
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
