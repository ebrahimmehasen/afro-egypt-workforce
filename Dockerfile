# Multi-stage build producing a minimal runtime image (Next.js "standalone" output).
# Build:  docker build -t afro-egypt-workforce .
# Run:    docker run -p 3000:3000 --env-file .env afro-egypt-workforce
# Migrations are NOT run automatically — run `npx prisma migrate deploy` against
# your database (from this image or elsewhere) before the container serves traffic.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time-only placeholders — real values are supplied at `docker run`, but
# `next build` needs *something* present to prerender and to run prisma generate.
ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
ENV SESSION_SECRET="build-time-placeholder-not-used-at-runtime"
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
