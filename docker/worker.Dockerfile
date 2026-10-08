# ═══════════════════════════════════════════════════
# EventAI Worker — BullMQ background processor
# Build context: repository root
#   docker build -f docker/worker.Dockerfile .
# ═══════════════════════════════════════════════════

# ── Base ───────────────────────────────────────────
FROM node:20-alpine AS base

# ── Dependencies ───────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/database/package.json ./packages/database/
COPY apps/worker/package.json ./apps/worker/
RUN npm ci

# ── Prisma generate + build ────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY package.json tsconfig.json ./
COPY packages/config ./packages/config
COPY packages/database ./packages/database
COPY packages/types ./packages/types
COPY apps/worker ./apps/worker
RUN npm run db:generate --workspace=@eventai/database \
  && npm run build --workspace=@eventai/worker

# ── Runtime ────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S eventai && adduser -S eventai -G eventai

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/database ./packages/database
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json

USER eventai

CMD ["node", "apps/worker/dist/index.js"]
