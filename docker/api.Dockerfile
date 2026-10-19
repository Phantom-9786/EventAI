# ═══════════════════════════════════════════════════
# EventAI API — Express + TypeScript
# Build context: repository root
#   docker build -f docker/api.Dockerfile .
# ═══════════════════════════════════════════════════

# ── Base ───────────────────────────────────────────
# ONNX Runtime uses glibc; Debian keeps local semantic inference compatible.
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/*

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

RUN groupadd --system eventai && useradd --system --gid eventai --create-home eventai
ENV SEMANTIC_MODEL_CACHE_DIR=/app/model-cache
RUN mkdir -p /app/uploads /app/model-cache \
  && chown eventai:eventai /app/uploads /app/model-cache \
  && chmod 0750 /app/uploads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

USER eventai
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
