# ═══════════════════════════════════════════════════
# EventAI Web — Next.js (standalone output)
# Build context: repository root
#   docker build -f docker/web.Dockerfile .
# ═══════════════════════════════════════════════════

# ── Base ───────────────────────────────────────────
FROM node:20-alpine AS base

# ── Dependencies ───────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci

# ── Build ──────────────────────────────────────────
FROM base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/validation ./packages/validation
COPY apps/web ./apps/web
RUN test -n "$NEXT_PUBLIC_API_URL" \
  && npm run build --workspace=@eventai/web

# ── Runtime ────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S eventai && adduser -S eventai -G eventai

COPY --from=build --chown=eventai:eventai /app/apps/web/.next/standalone ./
COPY --from=build --chown=eventai:eventai /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=deps --chown=eventai:eventai /app/node_modules ./node_modules

USER eventai
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
