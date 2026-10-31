# syntax=docker/dockerfile:1.7
# Production web image: Astro landing + Vue app + Caddy in one non-root
# container. The API is reached through Caddy's /api reverse proxy.
#
# Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile -t agroshield-web:local \
#     --build-arg PUBLIC_LANDING_URL=http://localhost:8080 \
#     --build-arg PUBLIC_APP_URL=http://localhost:8080/app .

ARG NODE_IMAGE=node:24.15.0-alpine3.22@sha256:b689d4005875ae167178471a7a622ec2909459a3bbb32277260be1971af7a99f
ARG CADDY_IMAGE=caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
ARG GO_IMAGE=golang:1.27.3-alpine3.23@sha256:8a5046497cda39860b832ffdbe8dd66018a0f05bb01352f533a36e7e2ced66a0

# ---------- build ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /workspace

RUN npm install --global pnpm@11.1.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY landing/package.json landing/
COPY packages/design-tokens/package.json packages/design-tokens/

RUN pnpm install --frozen-lockfile \
    --filter "@agroshield/landing..." \
    --filter "@agroshield/frontend..."

COPY . .

ARG PUBLIC_SITE_NAME=AgroShield
ARG PUBLIC_LANDING_URL=http://localhost:8080
ARG PUBLIC_APP_URL=http://localhost:8080/app
ARG PUBLIC_SUPPORT_EMAIL=
ARG PUBLIC_WHATSAPP_NUMBER=
ARG PUBLIC_DEMO_MODE=true
ARG PUBLIC_LEGAL_ENTITY=AgroShield, entorno local
ARG PUBLIC_LEGAL_ADDRESS=

ENV PUBLIC_SITE_NAME=${PUBLIC_SITE_NAME} \
    PUBLIC_LANDING_URL=${PUBLIC_LANDING_URL} \
    PUBLIC_APP_URL=${PUBLIC_APP_URL} \
    PUBLIC_SUPPORT_EMAIL=${PUBLIC_SUPPORT_EMAIL} \
    PUBLIC_WHATSAPP_NUMBER=${PUBLIC_WHATSAPP_NUMBER} \
    PUBLIC_DEMO_MODE=${PUBLIC_DEMO_MODE} \
    PUBLIC_LEGAL_ENTITY=${PUBLIC_LEGAL_ENTITY} \
    PUBLIC_LEGAL_ADDRESS=${PUBLIC_LEGAL_ADDRESS} \
    VITE_PUBLIC_BASE=/app/ \
    VITE_API_BASE_URL=/api/v1 \
    VITE_LANDING_URL=${PUBLIC_LANDING_URL} \
    VITE_SUPPORT_EMAIL=${PUBLIC_SUPPORT_EMAIL} \
    VITE_APP_ENV=production

RUN pnpm --filter @agroshield/landing build \
 && pnpm --filter @agroshield/frontend build \
 && test -f landing/dist/index.html \
 && test -f landing/dist/404.html \
 && test -f frontend/dist/index.html \
 && grep -q 'src="/app/assets/' frontend/dist/index.html

# ---------- caddy ----------
# Caddy 2.11.7 ships a Go 1.26.8 binary that Trivy flags with HIGH-severity
# stdlib, x/net and go-jose CVEs. Build the same release as a module dependency
# with a patched Go toolchain and dependency set. Keeping Caddy as a dependency
# (rather than building its source checkout) makes the binary report v2.11.7,
# so vulnerability scanners assess the actual release instead of a pseudo
# version. The resulting binary is static and has no file capabilities, which
# also makes it compatible with `cap_drop: ALL` below.
FROM ${GO_IMAGE} AS caddy-build
WORKDIR /src
RUN go mod init agroshield.local/caddy \
 && go get github.com/caddyserver/caddy/v2@v2.11.7 \
 && go get github.com/go-jose/go-jose/v4@v4.1.6 golang.org/x/net@v0.60.0
COPY infra/docker/caddy-main.go ./main.go
RUN go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/caddy .

# ---------- runtime ----------
FROM ${CADDY_IMAGE} AS runtime

RUN apk upgrade --no-cache \
 && apk add --no-cache curl \
 && addgroup -g 10001 -S web \
 && adduser -u 10001 -S -G web -H -s /sbin/nologin web \
 && mkdir -p /srv/landing /srv/app /data/caddy /config/caddy \
 && chown -R web:web /srv /data /config

COPY --from=caddy-build /out/caddy /usr/bin/caddy

COPY --from=build --chown=web:web /workspace/landing/dist/ /srv/landing/
COPY --from=build --chown=web:web /workspace/frontend/dist/ /srv/app/
COPY --chown=web:web infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --chown=web:web infra/docker/Caddyfile.prod /etc/caddy/Caddyfile.prod

ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data \
    HOME=/tmp \
    WEB_PORT=8080 \
    API_UPSTREAM=backend:3000 \
    LANDING_ROOT=/srv/landing \
    APP_ROOT=/srv/app

USER web
EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT}/healthz" || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
