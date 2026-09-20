# ── Build stage ──
FROM oven/bun:1.4.2-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build src/index.ts --outdir dist --target bun

# ── Production stage ──
FROM oven/bun:1.4.2-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 -S bot && adduser -S bot -u 1001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER bot
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:9090/health || exit 1
CMD ["bun", "run", "dist/index.js"]