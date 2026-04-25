# syntax=docker/dockerfile:1.7

# ---------- Stage 1: install all deps ----------
FROM node:20-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/

RUN pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .

# Generate Prisma client + build everything
RUN pnpm -F @modeldoctor/api exec prisma generate
RUN pnpm build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate && \
    addgroup -S app && adduser -S app -G app

# Copy manifests + build outputs
COPY --from=build /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml ./
COPY --from=build /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/web/package.json ./apps/web/
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist

# Install production deps + regenerate Prisma client.
# - argon2 postinstall needs a C toolchain on musl; install/uninstall in one RUN to keep image lean.
# - `prisma` is a prod dep (so the CLI is installed by --prod), and `prisma generate` must run here
#   because the just-installed @prisma/client ships without generated output.
RUN apk add --no-cache python3 make g++ && \
    pnpm install --prod --frozen-lockfile && \
    pnpm -F @modeldoctor/api exec prisma generate && \
    apk del python3 make g++ && \
    rm -rf /var/cache/apk/*

USER app
EXPOSE 3001
ENV PORT=3001

# Run migrations then start the API. Fail-fast on migration error.
CMD ["sh", "-c", "pnpm -F @modeldoctor/api exec prisma migrate deploy && node apps/api/dist/main.js"]
