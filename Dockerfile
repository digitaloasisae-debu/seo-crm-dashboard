# Rankflow as a Docker image, for the Hostinger VPS (see deploy/HOSTINGER.md).
# Built by GitHub Actions on every push to main, so the VPS never has to build anything itself.
FROM node:22-bookworm-slim

# openssl for Prisma, CA certificates for the outbound HTTPS calls (Gemini, DataForSEO, Google, WordPress).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Same as the Vercel build did: bring the database schema up to date (never with data loss),
# make sure the Super Admin exists, then serve.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && exec npx next start -H 0.0.0.0 -p 3000"]
