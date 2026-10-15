# ═══════════════════════════════════════════════════
# EventAI API — Express + TypeScript
# Build context: repository root
#   docker build -f docker/api.Dockerfile .
# ═══════════════════════════════════════════════════

# ── Base ───────────────────────────────────────────
FROM node:20-alpine AS base

# ── Dependencies ───────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/validation/package.json ./packages/validation/
RUN npm ci

# ── Prisma generate + build ────────────────────────
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json turbo.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run db:generate --workspace=@eventai/database \
  && npm run build --workspace=@eventai/database \
  && npm run build --workspace=@eventai/types \
  && npm run build --workspace=@eventai/validation \
  && npm run build --workspace=@eventai/api

# ── Runtime ────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S eventai && adduser -S eventai -G eventai
RUN mkdir -p /app/uploads \
  && chown eventai:eventai /app/uploads \
  && chmod 0750 /app/uploads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

USER eventai
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
