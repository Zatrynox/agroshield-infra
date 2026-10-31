# syntax=docker/dockerfile:1.7
# Development image for the hot-reload stack (compose.dev.yaml).
#
# Dependencies are installed once at image build time. compose.dev.yaml bind
# mounts the repository over /workspace and keeps node_modules in named volumes,
# so source edits trigger Vite/Astro/tsx immediately without reinstalling.

ARG NODE_IMAGE=node:24.15.0-alpine3.22@sha256:b689d4005875ae167178471a7a622ec2909459a3bbb32277260be1971af7a99f

FROM ${NODE_IMAGE} AS dev

RUN npm install --global pnpm@11.1.2 \
 && addgroup -g 10001 -S dev \
 && adduser -u 10001 -S -G dev -h /home/dev -s /bin/sh dev

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY landing/package.json landing/
COPY packages/design-tokens/package.json packages/design-tokens/

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile \
    --filter "@agroshield/backend..." \
    --filter "@agroshield/frontend..." \
    --filter "@agroshield/landing..." \
 && chown -R dev:dev /workspace

COPY --chown=dev:dev . .

ENV CI=true \
    HOME=/home/dev

USER dev

CMD ["pnpm", "--version"]
