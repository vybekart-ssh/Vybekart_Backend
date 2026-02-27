# VybeKart Backend – build and run for Render (dist is inside the image)
# Use Debian-based image so Prisma engine has OpenSSL and runs reliably
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# Production image (slim = Debian; Prisma needs OpenSSL, avoid Alpine here)
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Migrations then start (Render sets PORT)
CMD ["/bin/sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
