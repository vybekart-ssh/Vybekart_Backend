# VybeKart Backend – build and run for Render (dist is inside the image)
# Use Debian-based image so Prisma engine has OpenSSL and runs reliably
FROM node:22-slim AS builder

WORKDIR /app

# Prisma engine requires OpenSSL
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build && ls -laR /app/dist && test -f /app/dist/main.js || test -f /app/dist/src/main.js || (echo "Expected dist/main.js or dist/src/main.js" && exit 1)

# Production image (slim = Debian; Prisma needs OpenSSL at runtime for migrate deploy)
FROM node:22-slim AS runner

WORKDIR /app

# Prisma migrate deploy needs OpenSSL in the runtime image
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Migrations then start (Render sets PORT)
CMD ["/bin/sh", "-c", "npx prisma migrate deploy && ls -la /app/dist && exec node /app/dist/main.js"]
