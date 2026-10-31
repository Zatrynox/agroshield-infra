# Infraestructura — AgroShield

[![CI](https://github.com/Zatrynox/agroshield-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/Zatrynox/agroshield-infra/actions/workflows/ci.yml)

Dockerfiles, Compose y Caddy para ejecutar el monorepo en local, en desarrollo con hot reload y en producción. El objetivo es **un solo origen**: la landing en `/`, el panel en `/app`, la API en `/api` y la documentación en `/docs` (solo local).

> **Repositorio de infraestructura.** Se extrae del monorepo [`Zatrynox/agroshield`](https://github.com/Zatrynox/agroshield), que sigue siendo la fuente de verdad y el contexto de build de las imágenes. Este repositorio conserva la carpeta `infra/`, los Compose y el validador para revisar y reutilizar la topología; no incluye el código de la API, el panel ni la landing. Para construir y levantar el stack completo, usa el monorepo. Aquí se valida la configuración de forma estática y con Docker.

## Componentes

```text
infra/
├── docker/
│   ├── backend.Dockerfile   API de producción, no-root, multi-stage
│   ├── web.Dockerfile       landing + app + Caddy, no-root, multi-stage
│   ├── dev.Dockerfile       imagen de desarrollo con hot reload
│   ├── caddy-main.go        entrypoint del Caddy recompilado
│   ├── Caddyfile            routing local HTTP (puerto 8080)
│   └── Caddyfile.prod       TLS, HSTS y ACME (8080/8443 internos)
└── env/
    └── prod.env.example     plantilla de producción sin secretos
```

En la raíz:

| Archivo | Uso |
| --- | --- |
| `compose.yaml` | Stack local autocontenido: Postgres, migración/seed, backend y web. `http://localhost:8080`. |
| `compose.dev.yaml` | Hot reload: Postgres, backend, frontend y landing con bind mount. |
| `compose.prod.yaml` | Producción: Postgres privado, migración, backend y Caddy con TLS. |

El `Makefile`, `scripts/stack.mjs` y los scripts de escaneo viven en el monorepo; aquí solo se incluye `scripts/validate-infra.mjs`.

## Imágenes

Todas las imágenes base están fijadas por digest:

| Imagen | Versión |
| --- | --- |
| Node | `node:24.15.0-alpine3.22` |
| Caddy (base y binario) | `caddy:2.11.7-alpine`; binario recompilado `v2.11.7` |
| Go (build de Caddy) | `golang:1.27.3-alpine3.23` |
| PostgreSQL | `postgres:17.6-alpine3.22` |
| Trivy | `aquasec/trivy:0.76.1` |
| Gitleaks | `zricethezav/gitleaks:v8.30.1` |

### Backend

- Build multi-stage; `pnpm deploy --prod --legacy` genera el runtime.
- Se eliminan `src`, tests, configs de desarrollo, `.env`, `.data` y cachés.
- El build falla si faltan `dist/main.js`, `dist/tools/migrate.js`, `dist/tools/seed.js` o `migrations/0001_core.sql`.
- Runtime Alpine con `tini`, usuario `app` (UID 10001), `HOME=/tmp`, healthcheck contra `/health`.
- `apk upgrade` en el runtime y eliminación de npm/corepack: solo se ejecuta `node`.
- `/app/.data/demo-keys` se crea con propietario `app` para que el volumen nombrado del seed no nazca como root.
- `ENTRYPOINT` usa `tini` para reenviar señales correctamente.

### Web

- Build de Astro y Vue; el panel se compila con `VITE_PUBLIC_BASE=/app/`.
- Se comprueba que existen `landing/dist/index.html`, `landing/dist/404.html`, `frontend/dist/index.html` y que el HTML referencia `/app/assets/`.
- Runtime Caddy con usuario `web` (UID 10001), `curl` para el healthcheck.
- Caddy no se usa desde el binario de la imagen base: se compila `github.com/caddyserver/caddy/v2@v2.11.7` como dependencia con Go `1.27.3` y se parchean `go-jose` `4.1.6` y `x/net` `0.60.0`. Así se eliminan los CVEs HIGH del binario upstream y se obtiene un binario estático sin file capabilities, compatible con `cap_drop: ALL`.
- `apk upgrade` en el runtime para incorporar parches de Alpine.
- Sirve assets con caché inmutable y HTML con `no-cache`.

### Desarrollo

- Imagen Node con pnpm y dependencias instaladas.
- `compose.dev.yaml` monta el repositorio y conserva `node_modules` en volúmenes nombrados.
- Usuario no-root `dev`; `CI=true` para instalaciones no interactivas.

## Routing de Caddy

### Local (`Caddyfile`)

- `:8080`, HTTP explícito. Sin HSTS ni TLS.
- `/healthz` responde `ok`.
- `/api/*` quita el prefijo y proxy a `backend:3000`; `Cache-Control: no-store`.
- `/app` redirige a `/app/` con `308` y conserva la query (`/app/?…`).
- `/app/assets/*` caché inmutable; `/app/*` fallback a `index.html` para deep links.
- `/_astro/*` caché inmutable de la landing.
- Resto: landing con `try_files`; los 404 devuelven `landing/dist/404.html` con estado 404.
- `handle_errors` reimporta las cabeceras de seguridad y añade `no-store`; los errores de `/api` conservan su cuerpo.

### Producción (`Caddyfile.prod`)

- `{$SITE_ADDRESS}` con ACME y `email {$ACME_EMAIL}`.
- Escucha en `8080` (HTTP/ACME) y `8443` (HTTPS) para poder correr como no-root; Compose publica `80:8080` y `443:8443`.
- HSTS `max-age=31536000; includeSubDomains; preload`.
- Mismo routing que local, sin `/docs` público (el backend desactiva OpenAPI en producción).
- Healthcheck con `curl --resolve` contra `https://$SITE_DOMAIN:8443/healthz`.

Cabeceras comunes: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP`, `CORP` y CSP estricta con `worker-src 'self' blob:` para el captcha.

## Puesta en marcha

### Requisitos

- Docker Engine o Docker Desktop con Compose v2.
- Para los targets de calidad: Node `>=22` y pnpm `11.1.2`.

Los contextos de build de Compose (`context: .`) apuntan a la raíz del monorepo y esperan `backend/`, `frontend/`, `landing/` y `packages/design-tokens/`. Por eso `docker compose up --build` debe ejecutarse desde el monorepo; en este repositorio se validan los archivos con `pnpm verify:infra` y `docker compose config`.

### Verificar Docker

```bash
docker run --rm hello-world
```

### Stack local

Desde el monorepo:

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml up -d --build
# o: pnpm stack:up
```

- Un solo puerto publicado: `8080`.
- Postgres y backend quedan en redes internas (`data`, `app`); solo `web` está en `edge`.
- `seed` es un servicio one-shot que recrea la organización demo; el backend espera a que termine.
- El simulador es opcional: `docker compose --profile tools run --rm simulator` o `pnpm stack:simulate`.

Detener / reiniciar:

```bash
# desde el monorepo
pnpm stack:down
pnpm stack:reset   # elimina volúmenes, incluida la base
pnpm stack:logs
pnpm stack:ps
```

### Desarrollo

Desde el monorepo:

```bash
docker compose -f compose.dev.yaml up
# en otra terminal, tras arrancar la base:
docker compose -f compose.dev.yaml exec backend pnpm --filter @agroshield/backend exec tsx src/tools/seed.ts
# o: pnpm stack:dev:seed
```

Puertos: API `3000`, app `5173`, landing `4321`, Postgres solo en `127.0.0.1:5432`.

### Producción

Desde el monorepo:

```bash
cp infra/env/prod.env.example infra/env/prod.env
chmod 600 infra/env/prod.env
# completar todos los valores
docker compose --env-file infra/env/prod.env -f compose.prod.yaml up -d --build
# o: pnpm stack:prod
```

Compose falla antes de construir si faltan `PROD_SITE_DOMAIN`, `PROD_ACME_EMAIL`, `PROD_POSTGRES_PASSWORD`, `PROD_DATABASE_URL`, `PROD_SESSION_SECRET`, `PROD_LEGAL_ENTITY` o `PROD_LEGAL_ADDRESS`.

El backend de producción además falla al arrancar si detecta:

- `DEMO_MODE=true`
- `COOKIE_SECURE=false`
- `SESSION_SECRET` de ejemplo o menor de 32 caracteres
- `DATABASE_URL` que no sea `postgresql://` o `postgres://`
- `CORS_ORIGINS` con HTTP
- `TRUST_PROXY=false`
- `ENABLE_API_DOCS=true`

## Endurecimiento

- Contenedores `read_only: true` con `tmpfs` solo para `/tmp`.
- `cap_drop: ALL` y `no-new-privileges:true`.
- Usuarios no-root en todas las imágenes.
- Redes `app` y `data` internas; Postgres y backend sin puertos publicados.
- Volúmenes nombrados para base, secretos de demo, datos y configuración de Caddy.
- Límites de CPU/memoria y logs rotados.
- Sin secretos en imágenes: los valores llegan por entorno; `.env` y `infra/env/prod.env` están ignorados.
- Healthchecks en base, backend y web; dependencias con `condition: service_healthy` / `service_completed_successfully`.

## Verificación

```bash
pnpm install --frozen-lockfile
pnpm verify:infra
```

En el monorepo, además:

```bash
pnpm stack:verify     # docker run hello-world + config de los tres stacks
pnpm scan:secrets     # Gitleaks (requiere Docker)
pnpm scan:images      # Trivy sobre imágenes locales (requiere Docker)
pnpm scan             # ambos
```

`scripts/validate-infra.mjs` comprueba sin Docker:

- Que los tres Compose parsean y declaran los servicios esperados.
- Que las imágenes están fijadas y no hay `latest`.
- Que los Dockerfiles usan multi-stage, usuario no-root, healthcheck y limpieza.
- Que Caddy valida con el binario o la imagen disponible.
- Que los Compose construyen desde los Dockerfiles de `infra/docker/`.

`scripts/stack.mjs` y `scripts/scan.mjs` viven en el monorepo.

### Resultados locales (2026-10-30)

- `docker run --rm hello-world`: correcto.
- `docker compose -f compose.yaml config -q` y `compose.dev.yaml`: correctos.
- `compose.prod.yaml config -q` con un env de prueba: correcto; el stack real no se levantó.
- `agroshield-backend:local` y `agroshield-web:local`: construidas correctamente.
- Trivy `HIGH,CRITICAL --ignore-unfixed`: **0 hallazgos** en ambas imágenes.
- Gitleaks: **sin hallazgos** en working tree e historial.
- Smoke de API contra el stack: **23/23**.
- Caddy del contenedor: `v2.11.7 h1:yj0Y4fYZGPkSvibBJ1sTWE33xC0fxztVyXEW5iIdUT4=`, sin file capabilities.

El puerto `8080` del host estaba ocupado por `httpd.exe`, así que el stack se publicó en `8088` con un override temporal no versionado (ver el README raíz). `scripts/scan.mjs` usa un volumen de caché `agroshield-trivy-cache` y Gitleaks escanea una instantánea de archivos rastreados y no ignorados.

## CI

Este repositorio tiene un workflow con dos jobs:

1. **quality** — instala dependencias y ejecuta `pnpm verify:infra`.
2. **compose** — renderiza los tres Compose con variables de producción ficticias y valida ambos Caddyfiles con la imagen fijada de Caddy 2.11.7.

El monorepo conserva el workflow completo de cuatro jobs:

1. **quality** — install, typecheck, test, build y validación estática.
2. **infra** — `hello-world`, render de los tres Compose y validación de ambos Caddyfiles con Caddy 2.11.7.
3. **secrets** — falla si hay `.env` versionados y ejecuta Gitleaks sobre working tree e historial.
4. **containers** — construye backend y web, escanea con Trivy (HIGH/CRITICAL corregibles), levanta el stack local y prueba landing, demo, 404, app, deep link, API, 401, OpenAPI y login demo.

El workflow del monorepo se ejecutó en GitHub Actions el **2026-10-31** (run `41223672231`) y los cuatro jobs terminaron en verde, incluidos los escaneos y el smoke del stack.

## Limitaciones de esta entrega

- **El stack de producción no se ha ejecutado:** requiere dominio real, TLS/ACME, secretos de producción e identidad legal. El stack local sí está verificado.
- **Este repositorio no construye imágenes por sí solo:** los contextos de build viven en el monorepo. La CI valida la configuración, no un `up --build` desde aquí.
- El puerto `8080` de la máquina de desarrollo está ocupado por `httpd.exe`; usa un override a `8088` o libera el puerto.
- No hay orquestador (Kubernetes/Swarm), registro de imágenes, backup automatizado ni monitorización centralizada.
- El stack local usa HTTP; solo producción exige HTTPS/HSTS.
- El certificado de producción depende de que el dominio resuelva al host y de que los puertos 80/443 sean accesibles para ACME.
- No se incluye WAF, mTLS ni gestión externa de secretos.
