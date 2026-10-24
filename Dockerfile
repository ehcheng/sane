FROM node:20-alpine AS base
RUN apk add --no-cache openssl


# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN npm run build

# Production image for worker (not the default target — worker uses Dockerfile.worker)
FROM base AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/app.config.defaults.ts ./
COPY --from=builder /app/package.json ./

USER worker

CMD ["./node_modules/.bin/tsx", "src/worker/index.ts"]

# Production image for web server (default target)
FROM base AS web
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + its @prisma/* deps for pre-deploy migrations
# Do NOT copy @prisma/client — the standalone output already has the generated version
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma/debug ./node_modules/@prisma/debug
COPY --from=deps /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=deps /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version
COPY --from=deps /app/node_modules/@prisma/fetch-engine ./node_modules/@prisma/fetch-engine
COPY --from=deps /app/node_modules/@prisma/get-platform ./node_modules/@prisma/get-platform

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
