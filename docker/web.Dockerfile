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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json tsconfig.json ./
COPY packages/config ./packages/config
COPY packages/types ./packages/types
COPY packages/validation ./packages/validation
COPY apps/web ./apps/web
RUN npm run build --workspace=@eventai/web

# ── Runtime ────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S eventai && adduser -S eventai -G eventai

COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build --chown=eventai:eventai /app/apps/web/.next/standalone ./
COPY --from=build --chown=eventai:eventai /app/apps/web/.next/static ./apps/web/.next/static

USER eventai
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
